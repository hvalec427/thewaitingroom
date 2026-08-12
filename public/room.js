(function () {
  var btn = document.getElementById('copy-btn');
  var snippet = document.getElementById('snippet');
  btn.addEventListener('click', function () {
    navigator.clipboard && navigator.clipboard.writeText(snippet.textContent).then(function () {
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
    });
  });

  var countEl = document.getElementById('room-count');
  window.addEventListener('presence:update', function (e) {
    var count = e.detail && e.detail.count;
    if (typeof count !== 'number') return;
    countEl.textContent = count + (count === 1 ? ' person here right now' : ' people here right now');
  });
})();
