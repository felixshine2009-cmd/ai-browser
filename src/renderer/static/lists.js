// Shared by history / bookmarks / downloads pages
window.ListPage = function (opts) {
  const root = opts.root || document.getElementById('root');
  const embedded = !!opts.root;
  const offs = []; let dead = false;
  const esc = MD.esc;
  let q = ''; let rangeSel = opts.ranges ? opts.ranges[opts.ranges.length - 1] : '';
  async function render() {
    if (dead || !root.isConnected) return;
    const items = await opts.load(q);
    root.innerHTML = `<div class="list-page"><h1>${esc(t(opts.title))}</h1><div class="tools"><input id="lq" placeholder="${esc(t(opts.search || 'list.search'))}" value="${esc(q)}"/>${opts.clear && opts.ranges ? `<select id="lrange" class="btn-secondary" style="margin-right:6px">${opts.ranges.map(r => `<option value="${r}" ${r === rangeSel ? 'selected' : ''}>${esc(t('range.' + r))}</option>`).join('')}</select>` : ''}${opts.clear ? `<button class="btn-secondary" id="lclear">${esc(t(opts.clear))}</button>` : ''}</div><div id="rows"></div></div>`;
    const rows = document.getElementById('rows');
    if (!items.length) rows.innerHTML = `<div class="empty">${esc(t(opts.empty))}</div>`;
    items.forEach(it => { const r = document.createElement('div'); r.className = 'lrow'; r.innerHTML = opts.row(it); rows.appendChild(r); opts.bind && opts.bind(r, it, render); });
    const inp = document.getElementById('lq');
    inp.oninput = () => { q = inp.value; clearTimeout(inp._t); inp._t = setTimeout(async () => { const pos = inp.selectionStart; await render(); const n = document.getElementById('lq'); n.focus(); n.setSelectionRange(pos, pos); }, 200); };
    const c = document.getElementById('lclear'); if (c) c.onclick = async () => {
      const sel = document.getElementById('lrange'); if (sel) rangeSel = sel.value;
      if (opts.confirm) {
        const spec = await opts.confirm(rangeSel);
        if (spec && spec.count === 0) { window.AIBConfirm.done(t('confirm.nothing')); return; }
        if (spec && !(await window.AIBConfirm.ask(spec))) return;
      }
      const n = await opts.doClear(rangeSel);
      if (opts.confirm) window.AIBConfirm.done(t('confirm.cleared', { n: typeof n === 'number' ? n : 0 }));
      render();
    };
  }
  if (!embedded) document.title = t(opts.title);
  render();
  I18N.onChange(() => { if (!embedded) document.title = t(opts.title); render(); });
  (opts.events || []).forEach(ev => { const off = window.aib.on(ev, render); if (typeof off === 'function') offs.push(off); });
  const onClick = (e) => { if (!root.contains(e.target)) return; const a = e.target.closest('a[data-url]'); if (a) { e.preventDefault(); window.aib.invoke('nav:openUrl', a.dataset.url); } };
  document.addEventListener('click', onClick);
  return { destroy() { dead = true; offs.forEach(f => f()); document.removeEventListener('click', onClick); } };
};
