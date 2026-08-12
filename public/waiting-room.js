// The presence layer (badge, cursors, typing bubbles) is provided by the same
// widget.js service every third-party site uses, always loaded from the
// canonical presence.hvalec.com origin regardless of what host is currently
// serving this page.
const PRESENCE_ORIGIN = 'https://presence.hvalec.com';

(function () {
  // A fresh, unpersisted identity every page load: refreshing intentionally
  // sends you to the back of the line, so we never reuse widget.js's normal
  // persisted-uid behavior here.
  const uid = Date.now() + Math.random().toString(36).slice(2, 10);

  function plural(n) { return n === 1 ? 'person' : 'people'; }
  window.addEventListener('presence:update', (e) => {
    const { count, you } = e.detail || {};
    const presenceEl = document.getElementById('presence');
    if (presenceEl && typeof count === 'number') {
      presenceEl.textContent = `${count} ${plural(count)} here now`;
    }
    const youEl = document.getElementById('you');
    if (youEl && typeof you === 'number') {
      youEl.textContent = `You are #${you}`;
    }
  });

  const widgetScript = document.createElement('script');
  widgetScript.src = `${PRESENCE_ORIGIN}/widget.js`;
  widgetScript.setAttribute('data-room', '__waiting-room__');
  widgetScript.setAttribute('data-uid', uid);
  widgetScript.setAttribute('data-badge', 'false');
  widgetScript.async = true;
  document.head.appendChild(widgetScript);
})();

(function () {
  const el = document.getElementById('countdown');
  const prog = document.getElementById('progress');
  if (!el || !prog) return;
  const tz = 'Europe/Ljubljana';

  let target = null;
  let start = null;
  let totalMs = 0;
  let countdownInitialized = false;

  // Fetch countdown configuration from backend
  async function initializeCountdown() {
    try {
      const response = await fetch(`${PRESENCE_ORIGIN}/celebration-date`);
      const data = await response.json();

      // Check if we should redirect immediately
      if (data.redirectNow && data.redirectTo) {
        window.location.href = PRESENCE_ORIGIN + data.redirectTo;
        return;
      }

      target = new Date(data.targetTimestamp);
      start = new Date(data.startTimestamp);
      totalMs = target - start;
      countdownInitialized = true;
    } catch (error) {
      console.warn('Failed to load countdown configuration:', error);

      countdownInitialized = false;
    }
  }

  // Initialize countdown
  initializeCountdown();

  function pad(n) { return String(n).padStart(2, '0'); }
  function tick() {
    if (!countdownInitialized || !target) {
      el.innerHTML = '<span class="seg">--</span><span class="colon">\u00A0:\u00A0</span><span class="seg">--</span><span class="colon">\u00A0:\u00A0</span><span class="seg">--</span><span class="colon">\u00A0:\u00A0</span><span class="seg">--</span>';
      return;
    }

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

    // Check if countdown reached zero (all values are 0)
    if (d === 0 && h === 0 && m === 0 && s === 0 && diff === 0) {
      // Trigger countdown completion
      if (window.triggerCountdownComplete) {
        window.triggerCountdownComplete();
      }
    }
  }
  tick();
  setInterval(tick, 1000);
})();

(function () {
  const KEY = 'twroom_refreshed_at';
  const SHOW_MS = 5000;
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (last && now - last < SHOW_MS) {
      const el = document.getElementById('post-refresh');
      if (el) {
        el.classList.add('visible');
        setTimeout(() => { el.classList.remove('visible'); }, 4000);
      }
    }
    window.addEventListener('beforeunload', () => {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch { }
    });
  } catch { }
})();

// Countdown completion check - redirect when timer reaches zero
(function () {
  let countdownFinished = false;

  async function triggerCountdownComplete() {
    if (countdownFinished) return; // Prevent multiple calls
    countdownFinished = true;

    try {
      const response = await fetch(`${PRESENCE_ORIGIN}/celebration`);
      const data = await response.json();

      if (data.redirect && data.redirectTo) {
        // Small delay for dramatic effect
        setTimeout(() => {
          window.location.href = PRESENCE_ORIGIN + data.redirectTo;
        }, 1000);
      }
    } catch (error) {
    }
  }

  // Expose function globally so tick() can access it
  window.triggerCountdownComplete = triggerCountdownComplete;

  // Monitor countdown completion
  const countdownEl = document.getElementById('countdown');
  if (countdownEl) {
    // Create observer to watch for countdown changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          const countdownText = countdownEl.textContent || '';
          // Check if countdown shows all zeros (timer finished) - handle both regular and non-breaking spaces
          const isCountdownFinished = countdownText.includes('00 : 00 : 00 : 00') ||
            countdownText.includes('00\u00A0:\u00A000\u00A0:\u00A000\u00A0:\u00A000') ||
            countdownText.replace(/\u00A0/g, ' ').includes('00 : 00 : 00 : 00');

          if (isCountdownFinished && !countdownFinished) {
            triggerCountdownComplete();
          }
        }
      });
    });

    // Start observing
    observer.observe(countdownEl, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
})();
