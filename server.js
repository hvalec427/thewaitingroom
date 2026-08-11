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

const EVENT_MONTH = 0;
const EVENT_DAY = 22;
const EVENT_HOUR = 14;
const EVENT_MINUTE = 44;

// Internal room id used by the standalone waiting-room page (not reachable via /:room)
const WAITING_ROOM_ID = '__waiting-room__';

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

// Serve the celebration page
app.get('/celebration.html', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'celebration.html'));
});

// Get celebration countdown configuration
app.get('/celebration-date', (_req, res) => {
  const now = new Date();
  const currentYear = now.getFullYear();

  // Check if it's the target date and we're past the target time
  const todaysTarget = new Date(Date.UTC(currentYear, EVENT_MONTH, EVENT_DAY, EVENT_HOUR, EVENT_MINUTE));
  const isTodayTargetDate = now.getMonth() === EVENT_MONTH && now.getDate() === EVENT_DAY;

  if (isTodayTargetDate && now >= todaysTarget) {
    // It's the target date and past the target time - redirect immediately
    res.json({
      redirectNow: true,
      redirectTo: '/celebration.html',
      message: "It's time! 🎉"
    });
    return;
  }

  // Target is this year's event, or next year if it already passed
  let targetDate = new Date(Date.UTC(currentYear, EVENT_MONTH, EVENT_DAY, EVENT_HOUR, EVENT_MINUTE));
  if (now > targetDate) {
    targetDate = new Date(Date.UTC(currentYear + 1, EVENT_MONTH, EVENT_DAY, EVENT_HOUR, EVENT_MINUTE));
  }

  // Start is always one year before the target
  const startDate = new Date(Date.UTC(targetDate.getFullYear() - 1, EVENT_MONTH, EVENT_DAY, EVENT_HOUR, EVENT_MINUTE));

  res.json({
    targetDate: targetDate.toISOString(),
    targetTimestamp: targetDate.getTime(),
    startTimestamp: startDate.getTime(),
  });
});

// celebration endpoint - called when timer reaches zero
app.get('/celebration', (_req, res) => {
  const now = new Date();
  const iscelebrationToday = now.getMonth() === EVENT_MONTH && now.getDate() === EVENT_DAY;

  // Only respond with celebration page when timer completes
  res.json({
    redirect: true,
    redirectTo: '/celebration.html',
    message: iscelebrationToday ? "It's the special day! 🎉" : "Time's up! Special celebration time! 🎊",
    iscelebrationToday
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

app.get('/:room', (req, res, next) => {
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
const wss = new WebSocketServer({ server, path: '/ws' });

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

  ws.on('message', (data) => {
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
