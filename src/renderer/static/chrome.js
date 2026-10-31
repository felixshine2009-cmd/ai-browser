(async function () {
  await I18N.init();
  const $ = id => document.getElementById(id);
  const tabsEl = $('tabs'), addr = $('addr');
  let state = { tabs: [], activeId: null, mode: 'chat' };
  const SPARK = '<svg class="spark-inline" viewBox="0 0 100 100" width="14" height="14"><defs><linearGradient id="fgc" gradientUnits="userSpaceOnUse" x1="14" y1="10" x2="86" y2="92"><stop offset="0" stop-color="#fde047"/><stop offset="0.28" stop-color="#fb923c"/><stop offset="0.62" stop-color="#22d3ee"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><path d="M50 2 C54 30 70 46 98 50 C70 54 54 70 50 98 C46 70 30 54 2 50 C30 46 46 30 50 2 Z" fill="url(#fgc)"/></svg>';
  const LOCK = '<svg width="12" height="12" viewBox="0 0 16 16"><rect x="4" y="7" width="8" height="7" rx="1.5" fill="none" stroke="currentColor"/><path d="M6 7V5a2 2 0 0 1 4 0v2" fill="none" stroke="currentColor"/></svg>';

  function render() {
    tabsEl.innerHTML = '';
    for (const tb of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (tb.active ? ' active' : '');
      el.dataset.id = tb.id;
      const fav = document.createElement('div'); fav.className = 'favicon' + (tb.icon === 'spark' ? ' fav-spark' : '');
      if (tb.icon === 'spark') fav.innerHTML = SPARK;
      else if (tb.favicon) { const im = document.createElement('img'); im.src = tb.favicon; im.onerror = () => { fav.textContent = (tb.title || '·').slice(0, 1); im.remove(); }; fav.appendChild(im); }
      else fav.textContent = (tb.title || tb.url || '·').replace(/^https?:\/\//, '').slice(0, 1).toUpperCase();
      const ti = document.createElement('div'); ti.className = 'title';
      ti.textContent = tb.kind === 'home' ? I18N.t('tab.newtab') : (tb.kind === 'chat' ? (tb.display || tb.title) : (tb.title || tb.url));
      const x = document.createElement('div'); x.className = 'close-tab'; x.textContent = '×'; x.dataset.close = tb.id;
      el.append(fav, ti, x);
      tabsEl.appendChild(el);
    }
    const add = document.createElement('div'); add.className = 'tab-add'; add.id = 'tabadd'; add.textContent = '+';
    tabsEl.appendChild(add);
    const a = state.tabs.find(t => t.active);
    if (a) {
      $('back').classList.toggle('disabled', !a.canBack);
      $('fwd').classList.toggle('disabled', !a.canForward);
      $('reload').classList.toggle('loading', a.loading);
      $('bookmark').classList.toggle('bookmarked', !!a.bookmarked);
      $('lock').innerHTML = a.icon === 'spark' ? '✦' : LOCK;
      $('lock').classList.toggle('spark', a.icon === 'spark');
      if (document.activeElement !== addr) addr.value = a.display || '';
    }
    document.querySelectorAll('#modeseg .seg').forEach(s => s.classList.toggle('active', s.dataset.mode === state.mode));
  }
  tabsEl.addEventListener('click', (e) => {
    const c = e.target.closest('[data-close]');
    if (c) return window.aib.invoke('tab:close', Number(c.dataset.close));
    if (e.target.closest('#tabadd')) return window.aib.invoke('tab:new');
    const t = e.target.closest('.tab'); if (t) window.aib.invoke('tab:activate', Number(t.dataset.id));
  });
  tabsEl.addEventListener('auxclick', (e) => { if (e.button === 1) { const t = e.target.closest('.tab'); if (t) window.aib.invoke('tab:close', Number(t.dataset.id)); } });
  $('back').onclick = () => window.aib.invoke('nav:back');
  $('fwd').onclick = () => window.aib.invoke('nav:forward');
  $('reload').onclick = () => window.aib.invoke('nav:reload');
  $('bookmark').onclick = () => window.aib.invoke('bm:toggle');
  $('menu').onclick = () => window.aib.invoke('menu:toggle');
  document.querySelectorAll('#modeseg .seg').forEach(s => s.onclick = () => window.aib.invoke('mode:set', s.dataset.mode));
  addr.addEventListener('focus', () => { const a = state.tabs.find(t => t.active); if (a && a.kind !== 'chat') addr.value = a.kind === 'home' ? '' : a.url; setTimeout(() => addr.select(), 0); });
  addr.addEventListener('blur', () => { const a = state.tabs.find(t => t.active); addr.value = a ? a.display || '' : ''; });
  addr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = addr.value; window.aib.invoke('nav:submit', v); addr.blur(); }
    else if (e.key === 'Escape') addr.blur();
  });
  addr.addEventListener('paste', (e) => {
    const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (/\n/.test(txt.trim())) {
      e.preventDefault();
      if (state.mode === 'chat') { window.aib.invoke('nav:submit', txt); addr.blur(); }
      else { document.execCommand('insertText', false, txt.replace(/\s*\n\s*/g, ' ')); }
    }
  });
  window.aib.on('tabs:state', (s) => { state = s; render(); });
  window.aib.on('addr:focus', () => { addr.focus(); });
  I18N.onChange(render);
  state = await window.aib.invoke('tabs:state');
  render();
})();
