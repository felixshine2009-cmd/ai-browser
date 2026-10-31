// Shared by history / bookmarks / downloads pages
window.ListPage = function (opts) {
  const root = document.getElementById('root');
  const esc = MD.esc;
  let q = '';
  async function render() {
    const items = await opts.load(q);
    root.innerHTML = `<div class="list-page"><h1>${esc(t(opts.title))}</h1><div class="tools"><input id="lq" placeholder="${esc(t(opts.search || 'list.search'))}" value="${esc(q)}"/>${opts.clear ? `<button class="btn-secondary" id="lclear">${esc(t(opts.clear))}</button>` : ''}</div><div id="rows"></div></div>`;
    const rows = document.getElementById('rows');
    if (!items.length) rows.innerHTML = `<div class="empty">${esc(t(opts.empty))}</div>`;
    items.forEach(it => { const r = document.createElement('div'); r.className = 'lrow'; r.innerHTML = opts.row(it); rows.appendChild(r); opts.bind && opts.bind(r, it, render); });
    const inp = document.getElementById('lq');
    inp.oninput = () => { q = inp.value; clearTimeout(inp._t); inp._t = setTimeout(async () => { const pos = inp.selectionStart; await render(); const n = document.getElementById('lq'); n.focus(); n.setSelectionRange(pos, pos); }, 200); };
    const c = document.getElementById('lclear'); if (c) c.onclick = async () => { await opts.doClear(); render(); };
  }
  document.title = t(opts.title);
  render();
  I18N.onChange(() => { document.title = t(opts.title); render(); });
  (opts.events || []).forEach(ev => window.aib.on(ev, render));
  document.addEventListener('click', (e) => { const a = e.target.closest('a[data-url]'); if (a) { e.preventDefault(); window.aib.invoke('nav:openUrl', a.dataset.url); } });
};
