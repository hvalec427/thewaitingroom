import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';

const app = express();
app.use(cors());

// Basic health route
app.get('/health', (_req, res) => {
  res.json({ ok: true });
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
  console.log('WS connected:', client);

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
        if (clientWs !== ws && clientWs.readyState === clientWs.OPEN) {
          clientWs.send(JSON.stringify({ type: 'peer-mousemove', id: uid, x: msg.x, y: msg.y }));
        }
      });
    } else if (msg && msg.type === 'typing') {
      const payload = { type: 'peer-typing', id: uid, x: msg.x, y: msg.y, text: String(msg.text || '') };
      wss.clients.forEach((clientWs) => {
        if (clientWs !== ws && clientWs.readyState === clientWs.OPEN) {
          clientWs.send(JSON.stringify(payload));
        }
      });
    }
  });

  ws.on('close', () => {
    console.log('WS closed:', client);
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
    setTimeout(() => broadcastRanks(), 0);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`BE listening on http://localhost:${PORT}`);
  console.log(`WebSocket on ws://localhost:${PORT}/`);
});
