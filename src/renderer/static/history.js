(function () {
  const esc = MD.esc;
  // mount(root) renders the history manager into any container (settings embeds it); standalone page auto-mounts.
  window.mountHistory = function (root) {
    return ListPage({ root, title: 'menu.history', clear: 'history.clear', empty: 'history.empty', events: ['history:changed'],
      load: q => window.aib.invoke('hist:list', q),
      row: it => `<div class="main"><div class="ttl"><a href="#" data-url="${esc(it.url)}">${esc(it.title || it.url)}</a></div><div class="sub">${esc(it.url)}</div></div><div class="time">${new Date(it.time).toLocaleString(I18N.lang === 'en' ? 'en-US' : 'zh-CN')}</div><div class="x" data-del>✕</div>`,
      bind: (r, it, rerender) => { r.querySelector('[data-del]').onclick = async () => { await window.aib.invoke('hist:delete', it.url); rerender(); }; },
      doClear: () => window.aib.invoke('hist:clear') });
  };
  if (!document.body.dataset.embed) (async function () { await I18N.init(); window.mountHistory(document.getElementById('root')); })();
})();
