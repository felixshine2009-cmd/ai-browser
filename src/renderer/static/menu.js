(async function () {
  await I18N.init();
  const root = document.getElementById('root');
  const items = [
    ['incognito', 'menu.incognito', '⇧⌘N'], ['sep'], ['history', 'menu.history', '⌘Y'], ['downloads', 'menu.downloads', '⇧⌘J'], ['extensions', 'menu.extensions', ''], ['passwords', 'menu.passwords', ''], ['bookmarks', 'menu.bookmarks', '⇧⌘O'],
    ['sep'], ['find', 'menu.find', '⌘F'], ['print', 'menu.print', '⌘P'], ['zoom'], ['devtools', 'menu.devtools', '⌥⌘I'], ['sep'], ['settings', 'menu.settings', '⌘,']
  ];
  const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
  const keyHint = (k) => (IS_MAC || !k) ? k : k.replace('⇧', 'Shift+').replace('⌥', 'Alt+').replace('⌘', 'Ctrl+');
  let zoomPct = 100;
  function render() {
    const m = document.createElement('div'); m.className = 'overflow-menu'; m.id = 'menu';
    for (const it of items) {
      if (it[0] === 'sep') { const s = document.createElement('div'); s.className = 'sep'; m.appendChild(s); continue; }
      const r = document.createElement('div'); r.className = 'omi'; r.dataset.action = it[0];
      if (it[0] === 'zoom') {
        r.classList.add('zoomrow');
        r.innerHTML = `<span>${t('menu.zoom')}</span><span class="zc"><button data-z="out">−</button><span id="zv">${zoomPct}%</span><button data-z="in">+</button><button data-z="reset" title="100%">⟲</button></span>`;
      } else r.innerHTML = `<span>${t(it[1])}</span><span class="kbd">${keyHint(it[2])}</span>`;
      m.appendChild(r);
    }
    if (!entered) { m.classList.add('enter'); entered = true; }
    root.innerHTML = ''; root.appendChild(m);
  }
  let entered = false;
  render(); I18N.onChange(render);
  window.aib.invoke('zoom:get').then(z => { zoomPct = Math.round(z * 100); render(); });
  root.addEventListener('click', async (e) => {
    const z = e.target.closest('[data-z]');
    if (z) { const f = await window.aib.invoke('zoom:step', z.dataset.z); zoomPct = Math.round(f * 100); document.getElementById('zv').textContent = zoomPct + '%'; return; }
    const a = e.target.closest('[data-action]');
    if (a && a.dataset.action !== 'zoom') window.aib.invoke('menu:action', a.dataset.action);
  });
  window.aib.on('overlay:leave', () => { const m = document.getElementById('menu'); if (m) { m.classList.remove('enter'); m.classList.add('leave'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.aib.invoke('menu:close'); });
})();
