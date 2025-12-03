import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.static(__dirname));

const EVENT_MONTH = 0;
const EVENT_DAY = 22;
const EVENT_HOUR = 14;
const EVENT_MINUTE = 44;

// Basic health route
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Serve the main waiting room page
app.get('/', (_req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Serve the celebration page
app.get('/celebration.html', (_req, res) => {
  res.sendFile(__dirname + '/celebration.html');
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/' });

// Legacy incremental index retained for compatibility (not used for rank)
let nextJoinIndex = 1;
const joinIndexBySocket = new Map();      // ws -> legacy index
const indexByUserId = new Map();          // uid -> legacy index

// Ranking and presence (single-tab identity)
const firstSeenByUid = new Map(); // uid -> timestamp
const socketsByUid = new Map();   // uid -> Set<ws>

// Helpers
const getActiveUids = () => Array.from(socketsByUid.entries())
  .filter(([_u, set]) => set.size > 0)
  .map(([u]) => u);
const activeCount = () => getActiveUids().length;
const computeRank = (u) => {
  const active = getActiveUids();
  const meTs = firstSeenByUid.get(u) || 0;
  const ahead = active.filter(x => (firstSeenByUid.get(x) || 0) < meTs).length;
  return Math.min(ahead + 1, active.length);
};
const safeSend = (sock, obj) => { if (sock && sock.readyState === sock.OPEN) { try { sock.send(JSON.stringify(obj)); } catch { } } };
const broadcast = (obj) => {
  const payload = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === c.OPEN) { try { c.send(payload); } catch { } } });
};

// Track connections and simple broadcast of mouse events
wss.on('connection', (ws, req) => {
  const client = req.socket.remoteAddress;

  // Parse a client-provided stable id from query (?uid=...) and session id (?sid=...)
  const url = new URL(req.url, 'http://localhost');
  const uid = url.searchParams.get('uid') || (Date.now() + Math.random().toString(36).slice(2, 8));
  const sid = url.searchParams.get('sid') || '';
  ws._id = uid;
  ws._sid = sid;
  // First seen timestamp: on reconnect, push to back of line
  firstSeenByUid.set(uid, Date.now());
  // Track sockets per uid (single-tab identity: count user once if any socket open)
  if (!socketsByUid.has(uid)) socketsByUid.set(uid, new Set());
  socketsByUid.get(uid).add(ws);
  // Maintain legacy index mapping but recompute display rank from firstSeen among active uids
  let you = indexByUserId.get(uid);
  if (!you) { you = nextJoinIndex++; indexByUserId.set(uid, you); }
  joinIndexBySocket.set(ws, you);

  // Broadcast presence on join
  const broadcastPresence = () => { broadcast({ type: 'presence', count: activeCount() }); };
  // Send welcome with your computed rank (first-seen among active uids)
  safeSend(ws, { type: 'welcome', you: computeRank(uid), count: activeCount() });
  broadcastPresence();

  // Notify everyone of rank updates (optional simple broadcast)
  const broadcastRanks = () => {
    const count = activeCount();
    wss.clients.forEach(c => {
      const cu = c._id;
      if (c.readyState !== c.OPEN || !cu) return;
      safeSend(c, { type: 'rank', you: computeRank(cu), count });
    });
  };

  broadcastRanks();

  const removePeer = (id) => {
    wss.clients.forEach(c => {
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

    // Expecting {type: 'mousemove'|'typing', x, y, text?}
    if (msg && msg.type === 'mousemove') {
      // Optionally broadcast to others
      wss.clients.forEach((clientWs) => {
        if (clientWs === ws) return;
        safeSend(clientWs, { type: 'peer-mousemove', id: uid, x: msg.x, y: msg.y });
      });
    } else if (msg && msg.type === 'typing') {
      const payload = { type: 'peer-typing', id: uid, x: msg.x, y: msg.y, text: String(msg.text || '') };
      wss.clients.forEach((clientWs) => {
        if (clientWs === ws) return;
        safeSend(clientWs, payload);
      });
    }
  });

  ws.on('close', () => {
    joinIndexBySocket.delete(ws);
    // Remove socket from uid set; keep firstSeen for future sessions
    const uset = socketsByUid.get(uid);
    if (uset) {
      uset.delete(ws);
      if (uset.size === 0) {
        // single-tab identity: user is no longer active
      }
    }
    broadcastPresence();
    // Broadcast updated ranks after disconnect
    setTimeout(() => {
      broadcastRanks();
      removePeer(uid);
    }, 0);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
});
