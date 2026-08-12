(function () {
  function slugify(raw) {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63);
  }

  var form = document.getElementById('try-form');
  var input = document.getElementById('domain-input');
  var preview = document.getElementById('preview');

  function updatePreview() {
    var slug = slugify(input.value) || 'your-domain.com';
    preview.innerHTML = '&lt;script src=<span class="str">"' + location.origin + '/widget.js"</span> <span class="attr">data-room</span>=<span class="str">"' + slug + '"</span> async&gt;&lt;/script&gt;';
  }

  input.addEventListener('input', updatePreview);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var slug = slugify(input.value);
    if (!slug) { input.focus(); return; }
    window.location.href = '/' + encodeURIComponent(slug);
  });
  updatePreview();
})();
