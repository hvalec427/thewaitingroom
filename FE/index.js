(function() {
  const canvas = document.getElementById('canvas');
  const BUBBLE_WIDTH = 300;
  const BUBBLE_EDGE_PAD = 16;
  const BUBBLE_EDGE_PAD_Y = 8;
  const DOT_EDGE_PAD = 8;
  const DOT_RADIUS = 4;

  const defaultWs = 'ws://localhost:3001/ws';
  const search = new URLSearchParams(location.search);
  const wsParam = search.get('ws');
  // Generate or reuse a stable uid for this browser
  let uid = localStorage.getItem('twroom_uid');
  if (!uid) {
    uid = Date.now() + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem('twroom_uid', uid); } catch { }
  }
  const wsBase = wsParam || defaultWs;
  // Per-tab session id for detecting post-refresh notice
  let sid = sessionStorage.getItem('twroom_sid');
  if (!sid) {
    sid = Date.now() + Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('twroom_sid', sid); } catch {}
  }
  const wsUrl = (wsBase.includes('?') ? `${wsBase}&` : `${wsBase}?`) + `uid=${encodeURIComponent(uid)}&sid=${encodeURIComponent(sid)}`;

  let ws;
  let myDot = document.createElement('div');
  myDot.className = 'dot';
  canvas.appendChild(myDot);
  let myBubble = document.createElement('div');
  myBubble.className = 'bubble hidden';
  canvas.appendChild(myBubble);
  let lastPos = { x: 0.5, y: 0.5 };

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => { });
    ws.addEventListener('close', () => { retry(); });
    ws.addEventListener('error', () => { });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        console.log('[WS]', msg);
        if (msg.type === 'peer-mousemove') {
          showPeer(msg.x, msg.y);
        } else if (msg.type === 'peer-typing') {
          showPeerTyping(msg.x, msg.y, msg.text);
        } else if (msg.type === 'presence') {
          if (window.updatePresence) window.updatePresence(msg.count);
        } else if (msg.type === 'welcome') {
          if (window.setYouNumber) window.setYouNumber(msg.you);
          if (window.updatePresence) window.updatePresence(msg.count);
        } else if (msg.type === 'rank') {
          if (window.setYouNumber) window.setYouNumber(msg.you);
          if (window.updatePresence && typeof msg.count === 'number') window.updatePresence(msg.count);
        }
      } catch { }
    });
  }

  let peerDot, peerBubble;
  function showPeer(x, y) {
    if (!peerDot) {
      peerDot = document.createElement('div');
      peerDot.className = 'dot peer';
      canvas.appendChild(peerDot);
    }
    const rect = canvas.getBoundingClientRect();
    peerDot.style.left = (x * rect.width) + 'px';
    peerDot.style.top = (y * rect.height) + 'px';
    if (peerBubble) {
      const px = x * rect.width;
      const left = Math.min(rect.width - BUBBLE_WIDTH / 2 - BUBBLE_EDGE_PAD, Math.max(BUBBLE_WIDTH / 2 + BUBBLE_EDGE_PAD, px));
      peerBubble.style.left = left + 'px';
      const py = y * rect.height;
      const h = peerBubble.offsetHeight || 20;
      const desiredTop = py - 10;
      const minTop = BUBBLE_EDGE_PAD_Y + h;
      const maxTop = rect.height - BUBBLE_EDGE_PAD_Y;
      const top = Math.min(maxTop, Math.max(minTop, desiredTop));
      peerBubble.style.top = top + 'px';
    }
  }

  function showPeerTyping(x, y, text) {
    if (!peerBubble) {
      peerBubble = document.createElement('div');
      peerBubble.className = 'bubble';
      const span = document.createElement('span');
      peerBubble.appendChild(span);
      canvas.appendChild(peerBubble);
    }
    const rect = canvas.getBoundingClientRect();
    const span = peerBubble.firstChild;
    span.textContent = String(text || '');
    const px = x * rect.width;
    const left = Math.min(rect.width - BUBBLE_WIDTH / 2 - BUBBLE_EDGE_PAD, Math.max(BUBBLE_WIDTH / 2 + BUBBLE_EDGE_PAD, px));
    peerBubble.style.left = left + 'px';
    const pyPeer = y * rect.height;
    const hPeer = peerBubble.offsetHeight || 20;
    const desiredTopPeer = pyPeer - 10;
    const minTopPeer = BUBBLE_EDGE_PAD_Y + hPeer;
    const maxTopPeer = rect.height - BUBBLE_EDGE_PAD_Y;
    const topPeer = Math.min(maxTopPeer, Math.max(minTopPeer, desiredTopPeer));
    peerBubble.style.top = topPeer + 'px';
    peerBubble.classList.toggle('hidden', !text);
  }

  function retry() { setTimeout(connect, 1000); }

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const minX = DOT_EDGE_PAD + DOT_RADIUS, maxX = rect.width - (DOT_EDGE_PAD + DOT_RADIUS);
    const minY = DOT_EDGE_PAD + DOT_RADIUS, maxY = rect.height - (DOT_EDGE_PAD + DOT_RADIUS);
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const pxX = Math.min(maxX, Math.max(minX, rawX));
    const pxY = Math.min(maxY, Math.max(minY, rawY));
    const x = pxX / rect.width;
    const y = pxY / rect.height;
    myDot.style.left = pxX + 'px';
    myDot.style.top = pxY + 'px';
    lastPos = { x, y };
    if (typingText && typingText.length > 0) {
      updateMyBubble(x, y);
    }
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'mousemove', x, y }));
    }
  });

  let typingText = '';
  let typedBuffer = [];
  const INACTIVITY_TTL_MS = 10000;
  let lastTypedAt = 0;
  function sendTyping(x, y) {
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'typing', x, y, text: typingText }));
    }
  }
  function updateMyBubble(x, y) {
    if (!myBubble.firstChild) {
      myBubble.appendChild(document.createElement('span'));
    }
    const span = myBubble.firstChild;
    span.textContent = typingText;
    const rect = canvas.getBoundingClientRect();
    const px = x * rect.width;
    const left = Math.min(rect.width - BUBBLE_WIDTH / 2 - BUBBLE_EDGE_PAD, Math.max(BUBBLE_WIDTH / 2 + BUBBLE_EDGE_PAD, px));
    myBubble.style.left = left + 'px';
    const pySelf = y * rect.height;
    const hSelf = myBubble.offsetHeight || 20;
    const desiredTopSelf = pySelf - 10;
    const minTopSelf = BUBBLE_EDGE_PAD_Y + hSelf;
    const maxTopSelf = rect.height - BUBBLE_EDGE_PAD_Y;
    const topSelf = Math.min(maxTopSelf, Math.max(minTopSelf, desiredTopSelf));
    myBubble.style.top = topSelf + 'px';
    myBubble.classList.toggle('hidden', typingText.length === 0);
  }
  function cleanupExpired() {
    const now = Date.now();
    if (typingText && now - lastTypedAt >= INACTIVITY_TTL_MS) {
      typedBuffer = [];
      typingText = '';
      updateMyBubble(lastPos.x, lastPos.y);
      sendTyping(lastPos.x, lastPos.y);
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.key.length === 1 && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const now = Date.now();
      typedBuffer.push({ ch: e.key, t: now });
      typingText += e.key;
      lastTypedAt = now;
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      typedBuffer.pop();
      typingText = typingText.slice(0, -1);
      lastTypedAt = Date.now();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      typedBuffer = [];
      typingText = '';
      lastTypedAt = Date.now();
    } else {
      return;
    }
    updateMyBubble(lastPos.x, lastPos.y);
    sendTyping(lastPos.x, lastPos.y);
  });

  setInterval(cleanupExpired, 500);

  requestAnimationFrame(() => {
    const rect = canvas.getBoundingClientRect();
    const pxX = Math.min(rect.width - (DOT_EDGE_PAD + DOT_RADIUS), Math.max(DOT_EDGE_PAD + DOT_RADIUS, lastPos.x * rect.width));
    const pxY = Math.min(rect.height - (DOT_EDGE_PAD + DOT_RADIUS), Math.max(DOT_EDGE_PAD + DOT_RADIUS, lastPos.y * rect.height));
    myDot.style.left = pxX + 'px';
    myDot.style.top = pxY + 'px';
  });

  connect();
})();

// Countdown + progress
(function() {
  const el = document.getElementById('countdown');
  const prog = document.getElementById('progress');
  if (!el || !prog) return;
  const tz = 'Europe/Ljubljana';
  const target = new Date(Date.UTC(2026, 0, 22, 14, 44));
  const start = new Date(Date.UTC(2025, 0, 22, 14, 44));
  const totalMs = target - start;

  function pad(n) { return String(n).padStart(2, '0'); }
  function tick() {
    const now = new Date();
    const nowTz = new Date(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now).replace(/(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})/, '$3-$1-$2T$4:$5:$6Z'));
    const targetTz = new Date(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(target).replace(/(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})/, '$3-$1-$2T$4:$5:$6Z'));
    let diff = targetTz - nowTz;
    if (diff < 0) diff = 0;
    const d = Math.floor(diff / (24 * 3600e3));
    const h = Math.floor((diff % (24 * 3600e3)) / 3600e3);
    const m = Math.floor((diff % 3600e3) / 60e3);
    const s = Math.floor((diff % 60e3) / 1e3);
    const nbsp = '\u00A0';
    el.innerHTML = `
      <span class="seg">${pad(d)}</span>
      <span class="colon">${nbsp}:${nbsp}</span>
      <span class="seg">${pad(h)}</span>
      <span class="colon">${nbsp}:${nbsp}</span>
      <span class="seg">${pad(m)}</span>
      <span class="colon">${nbsp}:${nbsp}</span>
      <span class="seg">${pad(s)}</span>
    `;
    const elapsed = Math.max(0, totalMs - diff);
    const pct = totalMs > 0 ? Math.min(1, elapsed / totalMs) : 1;
    prog.style.width = `${Math.max(16, pct * (prog.parentElement.clientWidth - 0))}px`;
  }
  tick();
  setInterval(tick, 1000);
})();

(function() {
  const el = document.getElementById('presence');
  if (!el) return;
  function plural(n) { return n === 1 ? 'person' : 'people'; }
  window.updatePresence = function(count) {
    el.textContent = `${count} ${plural(count)} here now`;
  };
})();

// Post-refresh notice logic
(function(){
  const KEY = 'twroom_refreshed_at';
  const SHOW_MS = 5000;
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (last && now - last < SHOW_MS) {
      const el = document.getElementById('post-refresh');
      if (el) {
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
      }
    }
    // Mark unload so a refresh triggers the notice
    window.addEventListener('beforeunload', () => {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch {}
    });
  } catch {}
})();

(function() {
  const el = document.getElementById('you');
  if (!el) return;
  window.setYouNumber = function(n) {
    el.textContent = `You are #${n}`;
  };
})();
