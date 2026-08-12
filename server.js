import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
// Behind a reverse proxy (TLS-terminating), trust X-Forwarded-Proto so
// req.protocol correctly reports "https" instead of always "http".
app.set('trust proxy', true);
app.use(cors());
app.use(express.static(PUBLIC_DIR, { index: false }));

// --- Abuse prevention: per-IP rate limiting (no external deps) ---
// Simple sliding-window counter per IP. Kept in-memory since this is a
// single-process server; swept periodically so idle IPs don't leak memory.
function makeRateLimiter({ windowMs, max, message }) {
  const hitsByIp = new Map(); // ip -> timestamps[]

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, hits] of hitsByIp) {
      const fresh = hits.filter((t) => t > cutoff);
      if (fresh.length === 0) hitsByIp.delete(ip);
      else hitsByIp.set(ip, fresh);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const cutoff = now - windowMs;
    const hits = (hitsByIp.get(ip) || []).filter((t) => t > cutoff);
    if (hits.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: message || 'Too many requests' });
      return;
    }
    hits.push(now);
    hitsByIp.set(ip, hits);
    next();
  };
}

// Broad safety net for all dynamic routes (static assets are served above
// and never reach this point).
app.use(makeRateLimiter({ windowMs: 5 * 60_000, max: 300, message: 'Too many requests, please slow down.' }));

// Tighter limit specifically on room-page generation, since each hit does a
// disk read + string templating and can mint an arbitrary new room id.
const roomPageLimiter = makeRateLimiter({ windowMs: 60_000, max: 20, message: 'Too many rooms requested, please slow down.' });

const EVENT_MONTH = 0;
const EVENT_DAY = 22;
const EVENT_HOUR = 14;
const EVENT_MINUTE = 44;

// Internal room id used by the standalone waiting-room page (not reachable via /:room)
const WAITING_ROOM_ID = '__waiting-room__';

// True only on the event's UTC calendar day, at or after its target time.
// Uses UTC getters throughout — EVENT_HOUR/EVENT_MINUTE are UTC, and mixing
// them with local-timezone getters would shift this window by the server's
// UTC offset depending on where it happens to be deployed.
const isCelebrationLive = (now = new Date()) => {
  const todaysTarget = new Date(Date.UTC(now.getUTCFullYear(), EVENT_MONTH, EVENT_DAY, EVENT_HOUR, EVENT_MINUTE));
  const isTargetDate = now.getUTCMonth() === EVENT_MONTH && now.getUTCDate() === EVENT_DAY;
  return isTargetDate && now >= todaysTarget;
};

// Basic health route
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// New product landing page
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'landing.html'));
});

// The original waiting room page, preserved as-is
app.get('/waiting-room', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'waiting-room.html'));
});

// Not served from the static public/ dir on purpose — only reachable while
// the event is actually live, everyone else gets a plain 404. Its CSS/JS live
// alongside it in secret/ and are gated the same way so they can't be probed
// for ahead of time either.
app.get('/celebration.html', (_req, res) => {
  if (!isCelebrationLive()) {
    res.status(404).end();
    return;
  }
  res.sendFile(path.join(__dirname, 'secret', 'celebration.html'));
});

app.get('/celebration.css', (_req, res) => {
  if (!isCelebrationLive()) {
    res.status(404).end();
    return;
  }
  res.sendFile(path.join(__dirname, 'secret', 'celebration.css'));
});

app.get('/celebration.js', (_req, res) => {
  if (!isCelebrationLive()) {
    res.status(404).end();
    return;
  }
  res.sendFile(path.join(__dirname, 'secret', 'celebration.js'));
});

// Get celebration countdown configuration
app.get('/celebration-date', (_req, res) => {
  const now = new Date();

  if (isCelebrationLive()) {
    // It's the target date and past the target time - redirect immediately
    res.json({
      redirectNow: true,
      redirectTo: '/celebration.html',
      message: "It's time! 🎉"
    });
    return;
  }

  // Target is this year's event, or next year if it already passed
  const currentYear = now.getUTCFullYear();
  let targetDate = new Date(Date.UTC(currentYear, EVENT_MONTH, EVENT_DAY, EVENT_HOUR, EVENT_MINUTE));
  if (now > targetDate) {
    targetDate = new Date(Date.UTC(currentYear + 1, EVENT_MONTH, EVENT_DAY, EVENT_HOUR, EVENT_MINUTE));
  }

  // Start is always one year before the target
  const startDate = new Date(Date.UTC(targetDate.getUTCFullYear() - 1, EVENT_MONTH, EVENT_DAY, EVENT_HOUR, EVENT_MINUTE));

  res.json({
    targetDate: targetDate.toISOString(),
    targetTimestamp: targetDate.getTime(),
    startTimestamp: startDate.getTime(),
  });
});

// celebration endpoint - called when timer reaches zero
app.get('/celebration', (_req, res) => {
  const live = isCelebrationLive();

  // Only respond with celebration page when timer completes
  res.json({
    redirect: true,
    redirectTo: '/celebration.html',
    message: live ? "It's the special day! 🎉" : "Time's up! Special celebration time! 🎊",
    iscelebrationToday: live,
  });
});

// --- Presence-as-a-service: per-room setup page ---

const ROOM_SLUG_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-_.]{0,61}[a-zA-Z0-9])?$/;
// Well-known single-segment paths that browsers/crawlers request automatically;
// these should 404 instead of being treated as a room name.
const RESERVED_SLUGS = new Set([
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'apple-touch-icon.png',
  'apple-touch-icon-precomposed.png', 'ws',
]);

const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

app.get('/:room', roomPageLimiter, (req, res, next) => {
  const room = req.params.room;
  if (RESERVED_SLUGS.has(room.toLowerCase()) || !ROOM_SLUG_RE.test(room)) {
    return next(); // fall through to 404
  }
  const safeRoom = escapeHtml(room);
  const origin = `${req.protocol}://${req.get('host')}`;
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'room.html'), 'utf8')
    .split('{{ORIGIN}}').join(origin)
    .split('{{ROOM_ATTR}}').join(safeRoom)
    .split('{{ROOM}}').join(safeRoom);
  res.type('html').send(html);
});

const server = http.createServer(app);
// maxPayload caps inbound WS frame size so a single message can't be used
// to exhaust memory/bandwidth; legit payloads (mousemove/typing) are tiny.
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 });

// Presence state, namespaced per room so unrelated sites/rooms never see each other.
const rooms = new Map(); // roomId -> { firstSeenByUid: Map, socketsByUid: Map }
const getRoomState = (roomId) => {
  let state = rooms.get(roomId);
  if (!state) {
    state = { firstSeenByUid: new Map(), socketsByUid: new Map() };
    rooms.set(roomId, state);
  }
  return state;
};
// Rooms otherwise live forever once created, so an attacker who keeps
// connecting-then-disconnecting with fresh room ids could grow this Map
// without bound. Sweep out rooms that have had nobody active for a while.
const ROOM_EMPTY_TTL_MS = 5 * 60_000;
setInterval(() => {
  const cutoff = Date.now() - ROOM_EMPTY_TTL_MS;
  for (const [roomId, state] of rooms) {
    if (roomId === WAITING_ROOM_ID) continue;
    if (activeCount(state) > 0) continue;
    const lastSeen = Math.max(0, ...state.firstSeenByUid.values());
    if (lastSeen < cutoff) rooms.delete(roomId);
  }
}, ROOM_EMPTY_TTL_MS).unref();

// --- Abuse prevention: cap concurrent WS connections per IP ---
// Prevents one client from inflating presence counts or exhausting server
// resources by opening large numbers of sockets.
const MAX_WS_CONNECTIONS_PER_IP = 5;
const wsConnectionsByIp = new Map(); // ip -> Set<ws>
const getWsIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress;
};

// Per-socket inbound message rate limit, independent of connection count,
// so a single open tab can't flood the room with mousemove/typing spam.
const WS_MSG_WINDOW_MS = 1000;
const WS_MSG_MAX_PER_WINDOW = 40;

const getActiveUids = (state) => Array.from(state.socketsByUid.entries())
  .filter(([_u, set]) => set.size > 0)
  .map(([u]) => u);
const activeCount = (state) => getActiveUids(state).length;
const computeRank = (state, u) => {
  const active = getActiveUids(state);
  const meTs = state.firstSeenByUid.get(u) || 0;
  const ahead = active.filter(x => (state.firstSeenByUid.get(x) || 0) < meTs).length;
  return Math.min(ahead + 1, active.length);
};
const safeSend = (sock, obj) => { if (sock && sock.readyState === sock.OPEN) { try { sock.send(JSON.stringify(obj)); } catch { } } };
const roomClients = (roomId) => Array.from(wss.clients).filter(c => c._room === roomId);
const broadcastRoom = (roomId, obj) => {
  const payload = JSON.stringify(obj);
  roomClients(roomId).forEach(c => { if (c.readyState === c.OPEN) { try { c.send(payload); } catch { } } });
};

wss.on('connection', (ws, req) => {
  const ip = getWsIp(req);
  let ipConns = wsConnectionsByIp.get(ip);
  if (!ipConns) {
    ipConns = new Set();
    wsConnectionsByIp.set(ip, ipConns);
  }
  if (ipConns.size >= MAX_WS_CONNECTIONS_PER_IP) {
    ws.close(1008, 'Too many connections from this IP');
    return;
  }
  ipConns.add(ws);
  ws.on('close', () => {
    ipConns.delete(ws);
    if (ipConns.size === 0) wsConnectionsByIp.delete(ip);
  });

  const url = new URL(req.url, 'http://localhost');
  const roomId = (url.searchParams.get('room') || WAITING_ROOM_ID).slice(0, 128);
  const uid = url.searchParams.get('uid') || (Date.now() + Math.random().toString(36).slice(2, 8));
  ws._id = uid;
  ws._room = roomId;

  const state = getRoomState(roomId);
  // First seen timestamp: on reconnect, push to back of line
  state.firstSeenByUid.set(uid, Date.now());
  // Track sockets per uid (single-tab identity: count user once if any socket open)
  if (!state.socketsByUid.has(uid)) state.socketsByUid.set(uid, new Set());
  state.socketsByUid.get(uid).add(ws);

  const broadcastPresence = () => { broadcastRoom(roomId, { type: 'presence', count: activeCount(state) }); };
  safeSend(ws, { type: 'welcome', you: computeRank(state, uid), count: activeCount(state) });
  broadcastPresence();

  const broadcastRanks = () => {
    const count = activeCount(state);
    roomClients(roomId).forEach(c => {
      const cu = c._id;
      if (c.readyState !== c.OPEN || !cu) return;
      safeSend(c, { type: 'rank', you: computeRank(state, cu), count });
    });
  };

  broadcastRanks();

  const removePeer = (id) => {
    roomClients(roomId).forEach(c => {
      const cu = c._id;
      if (c.readyState !== c.OPEN || !cu) return;
      safeSend(c, { type: 'peer-disconnect', id });
    });
  };

  ws._msgTimestamps = [];
  ws.on('message', (data) => {
    const now = Date.now();
    ws._msgTimestamps = ws._msgTimestamps.filter((t) => now - t < WS_MSG_WINDOW_MS);
    if (ws._msgTimestamps.length >= WS_MSG_MAX_PER_WINDOW) return; // drop, sender is over the limit
    ws._msgTimestamps.push(now);

    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return; // ignore non-JSON
    }

    if (msg && msg.type === 'mousemove') {
      roomClients(roomId).forEach((clientWs) => {
        if (clientWs === ws) return;
        safeSend(clientWs, { type: 'peer-mousemove', id: uid, x: msg.x, y: msg.y });
      });
    } else if (msg && msg.type === 'typing') {
      const payload = { type: 'peer-typing', id: uid, x: msg.x, y: msg.y, text: String(msg.text || '').slice(0, 280) };
      roomClients(roomId).forEach((clientWs) => {
        if (clientWs === ws) return;
        safeSend(clientWs, payload);
      });
    }
  });

  ws.on('close', () => {
    const uset = state.socketsByUid.get(uid);
    if (uset) uset.delete(ws);
    broadcastPresence();
    setTimeout(() => {
      broadcastRanks();
      removePeer(uid);
    }, 0);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`, 'http://localhost:' + PORT);
});
