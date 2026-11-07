(async function () {
  await I18N.init();
  const $ = id => document.getElementById(id);
  const tr = key => (typeof I18N !== 'undefined' && I18N.t ? I18N.t(key) : (typeof t === 'function' ? t(key) : key));
  const tabsEl = $('tabs'), addr = $('addr');
  document.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    window.aib.invoke('kbd:key', { code: ev.code, ctrl: ev.ctrlKey, meta: ev.metaKey, shift: ev.shiftKey, alt: ev.altKey }).then(() => {}).catch(() => {});
  });
  let state = { tabs: [], activeId: null, mode: 'chat' };
  const LOCK = '<svg width="12" height="12" viewBox="0 0 16 16"><rect x="4" y="7" width="8" height="7" rx="1.5" fill="none" stroke="currentColor"/><path d="M6 7V5a2 2 0 0 1 4 0v2" fill="none" stroke="currentColor"/></svg>';

  const seen = new Set(); let firstRender = true; let prevEls = new Map();
  function render() {
    const prevIds = [...prevEls.keys()];
    const nextEls = new Map();
    tabsEl.innerHTML = '';
    for (const tb of state.tabs) {
      const el = document.createElement('div');
      el.className = 'tab' + (tb.active ? ' active' : '') + (tb.incognito ? ' incognito' : '') + (!firstRender && !seen.has(tb.id) ? ' enter' : '');
      seen.add(tb.id);
      el.dataset.id = tb.id;
      const fav = document.createElement('div'); fav.className = 'favicon';
      if (tb.favicon) {
        const im = document.createElement('img');
        im.src = tb.favicon;
        im.onerror = () => { fav.textContent = (tb.title || '·').slice(0, 1); im.remove(); };
        fav.appendChild(im);
      } else {
        fav.textContent = (tb.title || tb.url || '·').replace(/^https?:\/\//, '').slice(0, 1).toUpperCase();
      }
      const ti = document.createElement('div'); ti.className = 'title';
      ti.textContent = tb.kind === 'home' ? tr('tab.newtab') : (tb.kind === 'chat' ? (tb.display || tb.title) : (tb.title || tb.url));
      const x = document.createElement('div'); x.className = 'close-tab'; x.textContent = '×'; x.dataset.close = tb.id; x.title = tr('tab.close');
      if (tb.incognito) {
        const bd = document.createElement('span'); bd.className = 'incog-badge'; bd.textContent = tr('tab.incognito');
        el.append(fav, bd, ti, x);
      } else {
        el.append(fav, ti, x);
      }
      nextEls.set(tb.id, el);
      tabsEl.appendChild(el);
    }
    {
      const a = state.tabs.find(t => t.active);
      document.body.classList.toggle('incog-active', !!(a && a.incognito));
    }
    // closing animation: a non-interactive ghost of each tab that just disappeared collapses in place
    if (!firstRender) {
      prevIds.filter(id => !nextEls.has(id)).forEach(id => {
        const old = prevEls.get(id); if (!old) return;
        const g = document.createElement('div'); g.className = 'tab-ghost';
        g.innerHTML = old.innerHTML; g.querySelectorAll('[data-close]').forEach(n => n.removeAttribute('data-close'));
        const idx = Math.min(prevIds.indexOf(id), tabsEl.children.length);
        tabsEl.insertBefore(g, tabsEl.children[idx] || null);
        setTimeout(() => g.remove(), 260);
      });
    }
    prevEls = nextEls; firstRender = false;
    const add = document.createElement('div'); add.className = 'tab-add'; add.id = 'tabadd'; add.textContent = '+';
    tabsEl.appendChild(add);
    const a = state.tabs.find(t => t.active);
    if (a) {
      $('back').classList.toggle('disabled', !a.canBack);
      $('fwd').classList.toggle('disabled', !a.canForward);
      $('reload').classList.toggle('loading', a.loading);
      $('bookmark').classList.toggle('bookmarked', !!a.bookmarked);
      cwsUpdate(a);
      $('lock').innerHTML = LOCK;
      $('lock').classList.remove('spark');
      if (document.activeElement !== addr) addr.value = a.display || '';
      const activeTool = (a.url && a.url.startsWith('aibrowser://tool')) ? new URLSearchParams(a.url.split('?')[1] || '').get('id') : '';
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === activeTool));
    }
    document.querySelectorAll('#modeseg .seg').forEach(s => s.classList.toggle('active', s.dataset.mode === state.mode));
    placeIndicator();
  }
  // sliding indicator behind the active Chat/Search segment
  const seg = $('modeseg'); let indReady = false;
  function placeIndicator() {
    const a = seg.querySelector('.seg.active'); if (!a || !a.offsetWidth) return;
    seg.dataset.mode = state.mode;
    seg.style.setProperty('--ind-x', a.offsetLeft + 'px');
    seg.style.setProperty('--ind-w', a.offsetWidth + 'px');
    seg.classList.add('has-ind');
    if (!indReady) { indReady = true; requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.add('anim'))); }
  }
  window.addEventListener('resize', placeIndicator);
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
  // Chrome Web Store page -> one-click "Add to browser"
  let cwsBusy = false, cwsUrl = '', cwsMsgT = null;
  function cwsUpdate(a) {
    const b = $('cwsadd'); if (!b) return;
    b.hidden = !a.storeExt || (a.storeExt.installed && !cwsBusy && !b.dataset.flash);
    if (a.storeExt) { cwsUrl = a.storeExt.id; if (!cwsBusy && !b.dataset.flash) { b.textContent = tr('cws.add'); b.className = 'cws-add'; } }
  }
  $('cwsadd').onclick = async () => {
    if (cwsBusy) return; const b = $('cwsadd'); cwsBusy = true; b.className = 'cws-add busy'; b.textContent = tr('cws.installing');
    const r = await window.aib.invoke('cx:installStore', cwsUrl);
    cwsBusy = false; b.dataset.flash = '1';
    if (r.ok) { b.className = 'cws-add ok'; b.textContent = tr('cws.done') + ' · ' + r.ext.name; } else { b.className = 'cws-add bad'; b.textContent = tr('cws.fail') + ' ' + r.error; b.title = r.error; }
    clearTimeout(cwsMsgT); cwsMsgT = setTimeout(() => { delete b.dataset.flash; const a = state && state.tabs.find(x => x.active); if (a) cwsUpdate(a); }, r.ok ? 4000 : 9000);
  };
  $('menu').onclick = () => window.aib.invoke('menu:toggle');
  const fold = document.getElementById('toolfold');
  const icons = document.getElementById('toolicons');
  if (fold && icons) {
    fold.onclick = () => {
      const collapsed = icons.classList.toggle('collapsed');
      fold.classList.toggle('collapsed', collapsed);
      fold.setAttribute('aria-expanded', String(!collapsed));
    };
  }
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => window.aib.invoke('nav:openUrl', 'aibrowser://tool?id=' + b.dataset.tool));
  const siri = document.getElementById('siri');
  if (siri) {
    siri.onclick = () => {
      siri.classList.toggle('active');
      window.aib.invoke('siri:toggle');
    };
  }
  document.querySelectorAll('#modeseg .seg').forEach(s => s.onclick = async () => {
    const next = s.dataset.mode;
    let q = '';
    if (document.activeElement === addr) q = addr.value;
    else {
      const a = state.tabs.find(t => t.active);
      if (a && a.kind === 'chat') q = a.display || a.title || '';
      else if (a && a.kind === 'home') {
        try { q = await window.aib.invoke('home:query'); } catch {}
      } else if (a && a.kind !== 'web' && addr.value) q = addr.value;
      else if (addr.value && !/^https?:\/\//i.test(addr.value) && addr.value !== (a && a.display)) q = addr.value;
    }
    await window.aib.invoke('mode:set', next, q);
  });
  addr.addEventListener('focus', () => { const a = state.tabs.find(t => t.active); if (a && a.kind !== 'chat') addr.value = a.kind === 'home' ? '' : a.url; setTimeout(() => addr.select(), 0); });
  addr.addEventListener('blur', () => { const a = state.tabs.find(t => t.active); addr.value = a ? a.display || '' : ''; });
  addr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { const v = addr.value.trim(); if (v) window.aib.invoke('nav:submit', v); addr.blur(); }
    else if (e.key === 'Escape') addr.blur();
  });
  addr.addEventListener('paste', (e) => {
    const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (/\n/.test(txt.trim())) {
      e.preventDefault();
      if (state.mode === 'chat') { window.aib.invoke('nav:submit', txt); addr.blur(); }
      else {
        const clean = txt.replace(/\s*\n\s*/g, ' ');
        const start = addr.selectionStart ?? addr.value.length;
        const end = addr.selectionEnd ?? addr.value.length;
        addr.setRangeText(clean, start, end, 'end');
      }
    }
  });
  window.aib.on('tabs:state', (s) => { state = s; render(); });
  window.aib.on('addr:focus', () => { addr.focus(); });
  I18N.onChange(render);
  state = await window.aib.invoke('tabs:state');
  render();
})();
