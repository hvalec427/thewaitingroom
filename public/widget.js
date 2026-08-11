(function () {
  if (window.__presenceWidgetLoaded) return;
  window.__presenceWidgetLoaded = true;

  var scriptEl = document.currentScript;
  var room = (scriptEl && scriptEl.getAttribute('data-room')) || location.hostname || 'default';

  var serverOrigin = 'https://presence.hvalec.com';
  try {
    if (scriptEl && scriptEl.src) serverOrigin = new URL(scriptEl.src).origin;
  } catch (e) { }

  // Callers that manage their own identity lifecycle (e.g. a page that wants a
  // fresh presence identity on every reload) can pass data-uid explicitly.
  // Otherwise we persist a stable id in sessionStorage (not localStorage) so a
  // reload of *this tab* keeps the same identity, but two tabs of the same
  // browser still count and appear as two separate people.
  var explicitUid = scriptEl && scriptEl.getAttribute('data-uid');
  var showBadge = !(scriptEl && scriptEl.getAttribute('data-badge') === 'false');
  var UID_KEY = 'presence_widget_uid';
  var uid = explicitUid;
  if (!uid) {
    try {
      uid = sessionStorage.getItem(UID_KEY);
      if (!uid) {
        uid = Date.now() + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(UID_KEY, uid);
      }
    } catch (e) {
      uid = Date.now() + Math.random().toString(36).slice(2, 10);
    }
  }

  function isEditableTarget(el) {
    while (el) {
      if (el.isContentEditable) return true;
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      el = el.parentElement;
    }
    return false;
  }

  function injectStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '.pwgt-overlay{position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;}',
      '.pwgt-dot{position:absolute;width:8px;height:8px;border-radius:50%;background:#a78bfa;opacity:0.85;transform:translate(-50%,-50%);transition:left 60ms linear,top 60ms linear;}',
      '.pwgt-dot.pwgt-me{background:#22d3ee;opacity:1;transition:none;}',
      '.pwgt-bubble{position:absolute;transform:translate(-50%,-100%);color:#e5e7eb;background:rgba(2,6,23,0.85);border:1px solid #334155;padding:4px 8px;border-radius:10px;font:12px/1.3 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:inline-block;width:max-content;max-width:240px;white-space:normal;word-wrap:break-word;pointer-events:none;}',
      '.pwgt-bubble.pwgt-hidden{display:none;}',
      '.pwgt-badge{position:fixed;right:14px;bottom:14px;display:flex;align-items:center;gap:6px;background:rgba(17,24,39,0.9);color:#e5e7eb;border:1px solid #374151;border-radius:999px;padding:6px 12px;font:600 12px/1 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;pointer-events:auto;z-index:2147483001;box-shadow:0 2px 10px rgba(0,0,0,0.25);text-decoration:none;}',
      '.pwgt-badge .pwgt-led{width:7px;height:7px;border-radius:50%;background:#22d3ee;box-shadow:0 0 0 3px rgba(34,211,238,0.25);}',
    ].join('');
    document.head.appendChild(style);
  }

  function build() {
    injectStyles();

    var overlay = document.createElement('div');
    overlay.className = 'pwgt-overlay';
    document.body.appendChild(overlay);

    var countEl = null;
    if (showBadge) {
      var badge = document.createElement('a');
      badge.className = 'pwgt-badge';
      badge.href = serverOrigin + '/' + encodeURIComponent(room);
      badge.target = '_blank';
      badge.rel = 'noopener noreferrer';
      badge.innerHTML = '<span class="pwgt-led"></span><span class="pwgt-count">—</span>';
      document.body.appendChild(badge);
      countEl = badge.querySelector('.pwgt-count');
    }

    var myDot = document.createElement('div');
    myDot.className = 'pwgt-dot pwgt-me';
    myDot.style.display = 'none';
    overlay.appendChild(myDot);
    var myBubble = document.createElement('div');
    myBubble.className = 'pwgt-bubble pwgt-hidden';
    myBubble.appendChild(document.createElement('span'));
    overlay.appendChild(myBubble);
    function placeMyBubble(x, y) {
      var w = window.innerWidth, h = window.innerHeight;
      myBubble.style.left = (x * w) + 'px';
      myBubble.style.top = Math.max(20, (y * h) - 10) + 'px';
    }

    var peers = new Map();
    function ensurePeer(id) {
      var p = peers.get(id);
      if (!p) {
        var dot = document.createElement('div');
        dot.className = 'pwgt-dot';
        overlay.appendChild(dot);
        var bubble = document.createElement('div');
        bubble.className = 'pwgt-bubble pwgt-hidden';
        bubble.appendChild(document.createElement('span'));
        overlay.appendChild(bubble);
        p = { dot: dot, bubble: bubble };
        peers.set(id, p);
      }
      return p;
    }
    function removePeer(id) {
      var p = peers.get(id);
      if (p) {
        if (p.dot.parentNode) p.dot.parentNode.removeChild(p.dot);
        if (p.bubble.parentNode) p.bubble.parentNode.removeChild(p.bubble);
      }
      peers.delete(id);
    }
    function placePeer(id, x, y) {
      var p = ensurePeer(id);
      var w = window.innerWidth, h = window.innerHeight;
      p.dot.style.left = (x * w) + 'px';
      p.dot.style.top = (y * h) + 'px';
      p.bubble.style.left = (x * w) + 'px';
      p.bubble.style.top = Math.max(20, (y * h) - 10) + 'px';
    }
    function placePeerTyping(id, x, y, text) {
      if (!text && !peers.has(id)) return;
      var p = ensurePeer(id);
      p.bubble.firstChild.textContent = text || '';
      p.bubble.classList.toggle('pwgt-hidden', !text);
      placePeer(id, x, y);
    }

    var ws;
    var lastPos = { x: 0.5, y: 0.5 };
    function connect() {
      var wsProto = serverOrigin.indexOf('https') === 0 ? 'wss:' : 'ws:';
      var wsUrl = wsProto + '//' + serverOrigin.replace(/^https?:\/\//, '') +
        '/ws?room=' + encodeURIComponent(room) + '&uid=' + encodeURIComponent(uid);
      ws = new WebSocket(wsUrl);
      ws.addEventListener('close', function () { setTimeout(connect, 1500); });
      ws.addEventListener('message', function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === 'peer-mousemove') {
          placePeer(msg.id, msg.x, msg.y);
        } else if (msg.type === 'peer-typing') {
          placePeerTyping(msg.id, msg.x, msg.y, msg.text);
        } else if (msg.type === 'peer-disconnect') {
          removePeer(msg.id);
        } else if (msg.type === 'presence' || msg.type === 'welcome' || msg.type === 'rank') {
          if (typeof msg.count === 'number' && countEl) {
            countEl.textContent = msg.count + (msg.count === 1 ? ' person here' : ' people here');
          }
          window.dispatchEvent(new CustomEvent('presence:update', {
            detail: { room: room, count: msg.count, you: msg.you },
          }));
        }
      });
    }
    connect();

    document.addEventListener('mousemove', function (e) {
      var x = e.clientX / window.innerWidth;
      var y = e.clientY / window.innerHeight;
      lastPos = { x: x, y: y };
      myDot.style.display = '';
      myDot.style.left = e.clientX + 'px';
      myDot.style.top = e.clientY + 'px';
      if (typingText) placeMyBubble(x, y);
      if (typingText) sendTyping();
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'mousemove', x: x, y: y }));
      }
    });

    var typingText = '';
    var lastTypedAt = 0;
    var INACTIVITY_TTL_MS = 10000;
    function sendTyping() {
      myBubble.firstChild.textContent = typingText;
      myBubble.classList.toggle('pwgt-hidden', typingText.length === 0);
      placeMyBubble(lastPos.x, lastPos.y);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'typing', x: lastPos.x, y: lastPos.y, text: typingText }));
      }
    }

    document.addEventListener('keydown', function (e) {
      // Never hijack typing inside the host page's own form fields.
      if (isEditableTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1) {
        e.preventDefault();
        typingText += e.key;
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        typingText = typingText.slice(0, -1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        typingText = '';
      } else {
        return;
      }
      lastTypedAt = Date.now();
      sendTyping();
    });

    setInterval(function () {
      if (typingText && Date.now() - lastTypedAt >= INACTIVITY_TTL_MS) {
        typingText = '';
        sendTyping();
      }
    }, 500);
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
