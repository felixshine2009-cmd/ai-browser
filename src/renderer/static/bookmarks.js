(async function () {
  await I18N.init();
  const esc = MD.esc;
  ListPage({ title: 'menu.bookmarks', empty: 'bookmarks.empty', events: ['bookmarks:changed'],
    load: q => window.aib.invoke('bm:list', q),
    row: it => `<div class="main"><div class="ttl"><a href="#" data-url="${esc(it.url)}">${esc(it.title || it.url)}</a></div><div class="sub">${esc(it.url)}</div></div><div class="x" data-del>✕</div>`,
    bind: (r, it, rerender) => { r.querySelector('[data-del]').onclick = async () => { await window.aib.invoke('bm:remove', it.url); rerender(); }; } });
})();
