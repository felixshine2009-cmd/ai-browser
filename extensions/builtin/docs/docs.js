// aibrowser://docs/<name> → <name>.md from this extension, rendered with the browser's Markdown renderer.
(function () {
  const DOCS = [['extensions', '拓展框架开发指南'], ['contributions', '贡献点参考'], ['migration', '内置功能与迁移记录']];
  const name = (location.pathname.replace(/^\/+|\/+$/g, '') || 'extensions').split('/')[0];
  const cur = DOCS.some(d => d[0] === name) ? name : 'extensions';
  const nav = document.getElementById('nav'), doc = document.getElementById('doc');
  const slug = (t) => t.trim().toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
  fetch('/' + cur + '.md').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(md => {
    doc.innerHTML = window.MD ? window.MD.render(md) : '<pre></pre>';
    if (!window.MD) doc.querySelector('pre').textContent = md;
    const hs = [...doc.querySelectorAll('h4.md-h2')];
    hs.forEach(h => { h.id = slug(h.textContent); });
    nav.innerHTML = DOCS.map(([k, t]) => `<a href="aibrowser://docs/${k}" class="${k === cur ? 'on' : ''}" data-doc="${k}">${t}</a>` +
      (k === cur ? `<div class="toc">${hs.map(h => `<a href="#${h.id}">${h.textContent.replace(/</g, '&lt;')}</a>`).join('')}</div>` : '')).join('');
    document.title = (DOCS.find(d => d[0] === cur) || [0, '开发文档'])[1] + ' — 开发文档';
    if (location.hash) { const t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }
    document.body.dataset.ready = cur;
  }).catch(e => { doc.textContent = '文档加载失败：' + e.message; document.body.dataset.ready = 'error'; });
})();
