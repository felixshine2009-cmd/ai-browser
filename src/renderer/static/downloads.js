(async function () {
  await I18N.init();
  const esc = MD.esc;
  const sz = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n > 1e3 ? (n / 1e3).toFixed(0) + ' KB' : n + ' B';
  ListPage({ title: 'menu.downloads', clear: 'downloads.clear', empty: 'downloads.empty', events: ['downloads:changed'],
    load: async q => { const l = await window.aib.invoke('dl:list'); return q ? l.filter(x => (x.filename + x.url).toLowerCase().includes(q.toLowerCase())) : l; },
    row: it => `<div class="main"><div class="ttl">${esc(it.filename)}</div><div class="sub">${esc(it.url)}</div></div><div class="time">${esc(t('dl.state.' + it.state))}${it.state === 'progressing' ? ' ' + sz(it.received) + (it.total ? ' / ' + sz(it.total) : '') : (it.state === 'completed' ? ' · ' + sz(it.received) : '')}</div>
      ${it.state === 'completed' ? `<button class="btn-secondary" data-open>${esc(t('dl.open'))}</button><button class="btn-secondary" data-show>${esc(t('dl.show'))}</button>` : ''}${it.state === 'progressing' ? `<button class="btn-secondary" data-cancel>${esc(t('common.cancel'))}</button>` : ''}<div class="x" data-del>✕</div>`,
    bind: (r, it, rerender) => {
      const b = (s, fn) => { const e = r.querySelector(s); if (e) e.onclick = fn; };
      b('[data-open]', () => window.aib.invoke('dl:open', it.id)); b('[data-show]', () => window.aib.invoke('dl:show', it.id));
      b('[data-cancel]', () => window.aib.invoke('dl:cancel', it.id)); b('[data-del]', async () => { await window.aib.invoke('dl:remove', it.id); rerender(); });
    },
    confirm: async () => { const n = (await window.aib.invoke('dl:list')).length; return { count: n, title: t('confirm.dl.title'), message: t('confirm.dl.msg', { n }), detail: t('confirm.dlKeep'), confirmText: t('confirm.ok') }; },
    doClear: async () => { const n = (await window.aib.invoke('dl:list')).length; await window.aib.invoke('dl:clear'); return n; } });
})();
