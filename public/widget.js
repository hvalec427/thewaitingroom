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

  var accent = (scriptEl && scriptEl.getAttribute('data-accent')) || '#eecf6d';
  var surface = (scriptEl && scriptEl.getAttribute('data-surface')) || '#45050c';
  function withAlpha(hex, alpha) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
  }

  var showBadge = !(scriptEl && scriptEl.getAttribute('data-badge') === 'false');
  var showCursors = !(scriptEl && scriptEl.getAttribute('data-cursors') === 'false');
  var showMessages = !(scriptEl && scriptEl.getAttribute('data-messages') === 'false');

  // Cursors and typing are ambient, mouse/keyboard-driven features that don't
  // translate well to a touchscreen, so they're off by default on mobile.
  // Pass data-mobile="true" to opt back in (cursors follow touch drags, and
  // messages get a small tap-to-type bar instead of global key capture).
  var isMobile = (function () {
    try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return 'ontouchstart' in window; }
  })();
  var mobileEnabled = scriptEl && scriptEl.getAttribute('data-mobile') === 'true';
  if (isMobile && !mobileEnabled) {
    showCursors = false;
    showMessages = false;
  }
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

  var styleEl = null;
  function buildStyleText() {
    var border = withAlpha(accent, 0.55);
    var glow = withAlpha(accent, 0.25);
    var surfaceBubble = withAlpha(surface, 0.85);
    var surfaceBadge = withAlpha(surface, 0.9);

    return [
      '.pwgt-overlay{position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:hidden;}',
      '.pwgt-dot{position:absolute;width:8px;height:8px;border-radius:50%;background:' + accent + ';opacity:0.85;transform:translate(-50%,-50%);transition:left 60ms linear,top 60ms linear;}',
      '.pwgt-dot.pwgt-me{background:' + accent + ';opacity:1;transition:none;}',
      '.pwgt-bubble{position:absolute;transform:translate(-50%,-100%);color:' + accent + ';background:' + surfaceBubble + ';border:1px solid ' + border + ';padding:4px 8px;border-radius:10px;font:12px/1.3 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:inline-block;width:max-content;max-width:240px;white-space:normal;word-wrap:break-word;pointer-events:none;}',
      '.pwgt-bubble.pwgt-hidden{display:none;}',
      '.pwgt-badge{position:fixed;right:14px;bottom:14px;display:flex;align-items:center;gap:6px;background:' + surfaceBadge + ';color:' + accent + ';border:1px solid ' + border + ';border-radius:999px;padding:6px 12px;font:600 12px/1 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;pointer-events:auto;z-index:2147483001;box-shadow:0 2px 10px rgba(0,0,0,0.25);text-decoration:none;}',
      '.pwgt-badge .pwgt-led{width:7px;height:7px;border-radius:50%;background:' + accent + ';box-shadow:0 0 0 3px ' + glow + ';}',
      '.pwgt-mobile-bar{position:fixed;left:12px;right:12px;bottom:14px;display:flex;pointer-events:auto;z-index:2147483001;}',
      '.pwgt-mobile-bar input{flex:1;min-width:0;border:1px solid ' + border + ';border-radius:999px;padding:10px 14px;font:14px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:' + surfaceBadge + ';color:' + accent + ';outline:none;}',
      '.pwgt-mobile-bar input::placeholder{color:#9ca3af;}',
    ].join('');
  }

  function injectStyles() {
    styleEl = document.createElement('style');
    styleEl.textContent = buildStyleText();
    document.head.appendChild(styleEl);
  }

  window.PresenceWidget = window.PresenceWidget || {};
  window.PresenceWidget.setColors = function (newAccent, newSurface) {
    if (newAccent) accent = newAccent;
    if (newSurface) surface = newSurface;
    if (styleEl) styleEl.textContent = buildStyleText();
  };

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

    var myDot = null;
    if (showCursors) {
      myDot = document.createElement('div');
      myDot.className = 'pwgt-dot pwgt-me';
      myDot.style.display = 'none';
      overlay.appendChild(myDot);
    }
    var myBubble = null;
    if (showMessages) {
      myBubble = document.createElement('div');
      myBubble.className = 'pwgt-bubble pwgt-hidden';
      myBubble.appendChild(document.createElement('span'));
      overlay.appendChild(myBubble);
    }
    function placeMyBubble(x, y) {
      if (!myBubble) return;
      var w = window.innerWidth, h = window.innerHeight;
      myBubble.style.left = (x * w) + 'px';
      myBubble.style.top = Math.max(20, (y * h) - 10) + 'px';
    }

    var peers = new Map();
    function ensurePeer(id) {
      var p = peers.get(id);
      if (!p) {
        p = {};
        if (showCursors) {
          var dot = document.createElement('div');
          dot.className = 'pwgt-dot';
          overlay.appendChild(dot);
          p.dot = dot;
        }
        if (showMessages) {
          var bubble = document.createElement('div');
          bubble.className = 'pwgt-bubble pwgt-hidden';
          bubble.appendChild(document.createElement('span'));
          overlay.appendChild(bubble);
          p.bubble = bubble;
        }
        peers.set(id, p);
      }
      return p;
    }
    function removePeer(id) {
      var p = peers.get(id);
      if (p) {
        if (p.dot && p.dot.parentNode) p.dot.parentNode.removeChild(p.dot);
        if (p.bubble && p.bubble.parentNode) p.bubble.parentNode.removeChild(p.bubble);
      }
      peers.delete(id);
    }
    function placePeer(id, x, y) {
      if (!showCursors) return;
      var p = ensurePeer(id);
      if (!p.dot) return;
      var w = window.innerWidth, h = window.innerHeight;
      p.dot.style.left = (x * w) + 'px';
      p.dot.style.top = (y * h) + 'px';
    }
    function placePeerTyping(id, x, y, text) {
      if (!showMessages) return;
      if (!text && !peers.has(id)) return;
      var p = ensurePeer(id);
      if (!p.bubble) return;
      var w = window.innerWidth, h = window.innerHeight;
      p.bubble.firstChild.textContent = text || '';
      p.bubble.classList.toggle('pwgt-hidden', !text);
      p.bubble.style.left = (x * w) + 'px';
      p.bubble.style.top = Math.max(20, (y * h) - 10) + 'px';
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

    function handlePointerMove(clientX, clientY) {
      var x = clientX / window.innerWidth;
      var y = clientY / window.innerHeight;
      lastPos = { x: x, y: y };
      if (showCursors) {
        myDot.style.display = '';
        myDot.style.left = clientX + 'px';
        myDot.style.top = clientY + 'px';
        if (ws && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'mousemove', x: x, y: y }));
        }
      }
      if (showMessages && typingText) {
        placeMyBubble(x, y);
        sendTyping();
      }
    }

    document.addEventListener('mousemove', function (e) {
      handlePointerMove(e.clientX, e.clientY);
    });
    document.addEventListener('touchmove', function (e) {
      if (!showCursors || e.touches.length === 0) return;
      handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    var typingText = '';
    var lastTypedAt = 0;
    var INACTIVITY_TTL_MS = 10000;
    function sendTyping() {
      if (!showMessages) return;
      myBubble.firstChild.textContent = typingText;
      myBubble.classList.toggle('pwgt-hidden', typingText.length === 0);
      placeMyBubble(lastPos.x, lastPos.y);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'typing', x: lastPos.x, y: lastPos.y, text: typingText }));
      }
    }

    if (showMessages && !isMobile) {
      // Desktop: capture typing ambiently anywhere on the page.
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
    } else if (showMessages && isMobile) {
      // Mobile: there's no ambient keyboard, so give a small tap-to-type bar.
      var bar = document.createElement('div');
      bar.className = 'pwgt-mobile-bar';
      if (showBadge) bar.style.bottom = '58px'; // stack above the visitor-count badge
      var input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 280;
      input.placeholder = 'Type a message…';
      bar.appendChild(input);
      document.body.appendChild(bar);
      input.addEventListener('input', function () {
        typingText = input.value;
        lastTypedAt = Date.now();
        sendTyping();
      });
      input.addEventListener('blur', function () {
        typingText = '';
        input.value = '';
        sendTyping();
      });
    }

    if (showMessages) {
      setInterval(function () {
        if (typingText && Date.now() - lastTypedAt >= INACTIVITY_TTL_MS) {
          typingText = '';
          sendTyping();
        }
      }, 500);
    }
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
