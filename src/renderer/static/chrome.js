(async function () {
  await I18N.init();
  const $ = id => document.getElementById(id);
  const tr = key => (typeof I18N !== 'undefined' && I18N.t ? I18N.t(key) : (typeof t === 'function' ? t(key) : key));
  const tabsEl = $('tabs'), addr = $('addr');
  document.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    window.aib.invoke('kbd:key', { code: ev.code, ctrl: ev.ctrlKey, meta: ev.metaKey, shift: ev.shiftKey, alt: ev.altKey }).then(() => {}).catch(() => {});
  });
  let state = { tabs: [], activeId: null, mode: 'chat', tools: [], spaces: [] };
  const cur = () => state.current || state.tabs.find(t => t.active) || null;
  const ICONS = window.AIB_ICONS;
  const IPAD = !!(window.aib && window.aib.ipad);
  // toolbar tools (U8): hand-drawn icons with a visible Chinese caption; one view per tool (U1)
  const TOOLS = ['solve', 'snap', 'geogebra', 'physics', 'wiki', 'dict', 'code', 'readlater'].concat(IPAD ? ['scan'] : []);
  {
    const box = $('toolicons');
    if (box && ICONS) box.innerHTML = TOOLS.map(id => `<button type="button" class="ticon labeled" data-tool="${id}" title="${ICONS.tip(id)}" aria-label="${ICONS.label(id)}">${ICONS.svg(id)}<span class="ticon-label">${ICONS.label(id)}</span></button>`).join('');
    const sb = $('splitbtn'); if (sb && ICONS) sb.innerHTML = ICONS.svg('split');
  }
  const LOCK = '<svg width="12" height="12" viewBox="0 0 16 16"><rect x="4" y="7" width="8" height="7" rx="1.5" fill="none" stroke="currentColor"/><path d="M6 7V5a2 2 0 0 1 4 0v2" fill="none" stroke="currentColor"/></svg>';

  const seen = new Set(); let firstRender = true; let prevEls = new Map();
  function render() {
    const prevIds = [...prevEls.keys()];
    const nextEls = new Map();
    tabsEl.innerHTML = '';
    for (const tl of state.tools || []) {
      const el = document.createElement('div');
      el.className = 'tab tool-pill' + (tl.active ? ' active' : '');
      el.dataset.id = tl.tabId; el.dataset.tool = tl.id; el.title = tl.name;
      el.innerHTML = (ICONS ? ICONS.svg(tl.id, 'pill-icon') : '') + `<div class="title"></div><div class="close-tab" data-closetool="${tl.id}" title="关闭工具">×</div>`;
      el.querySelector('.title').textContent = tl.name;
      tabsEl.appendChild(el);
    }
    if ((state.tools || []).length) { const sep = document.createElement('div'); sep.className = 'tool-sep'; tabsEl.appendChild(sep); }
    for (const tb of state.tabs) {
      const el = document.createElement('div');
      const inSplit = state.split && !state.split.hidden && (state.split.left === tb.id || state.split.right === tb.id);
      el.className = 'tab' + (tb.active ? ' active' : '') + (inSplit ? ' split' : '') + (tb.incognito ? ' incognito' : '') + (!firstRender && !seen.has(tb.id) ? ' enter' : '');
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
    const a = cur();
    if (a) {
      $('back').classList.toggle('disabled', !a.canBack);
      $('fwd').classList.toggle('disabled', !a.canForward);
      $('reload').classList.toggle('loading', a.loading);
      $('bookmark').classList.toggle('bookmarked', !!a.bookmarked);
      cwsUpdate(a);
      $('lock').innerHTML = LOCK;
      $('lock').classList.remove('spark');
      if (document.activeElement !== addr) addr.value = a.display || '';
    }
    const activeTool = state.activeTool || '';
    document.querySelectorAll('.ticon[data-tool]').forEach(b => { b.classList.toggle('active', b.dataset.tool === activeTool); b.classList.toggle('open', (state.tools || []).some(x => x.id === b.dataset.tool)); });
    document.body.classList.toggle('tool-active', !!activeTool);
    // spaces chip
    const sc = $('spacechip');
    if (sc) { const sp = (state.spaces || []).find(x => x.active); sc.innerHTML = (ICONS ? ICONS.svg('spaces') : '') + `<span></span>`; sc.querySelector('span').textContent = sp ? sp.name : '默认'; sc.classList.toggle('multi', (state.spaces || []).length > 1); }
    // split view: bar between the two views (drawn by this page under the native views)
    const sbar = $('splitbar'), sbtn = $('splitbtn');
    if (sbtn) sbtn.classList.toggle('active', !!(state.split && !state.split.hidden));
    if (sbar) { const sv = state.split && !state.split.hidden ? state.split : null; sbar.hidden = !sv; if (sv) { sbar.style.left = sv.x + 'px'; sbar.style.top = sv.top + 'px'; } }
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
    const ct = e.target.closest('[data-closetool]');
    if (ct) return window.aib.invoke('tool:close', ct.dataset.closetool);
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
    clearTimeout(cwsMsgT); cwsMsgT = setTimeout(() => { delete b.dataset.flash; const a = state && cur(); if (a) cwsUpdate(a); }, r.ok ? 4000 : 9000);
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
  function toolAction(id) {
    if (id === 'scan') return window.aib.invoke('scan:qr');
    if (id === 'snap') return window.aib.invoke('snap:solve');
    if (state.activeTool === id) return window.aib.invoke('tool:hide'); // second tap returns to the page
    return window.aib.invoke('tool:open', id);
  }
  document.querySelectorAll('.ticon[data-tool]').forEach(b => b.onclick = () => toolAction(b.dataset.tool));
  // iPad (v3.0.0): the tool strip is one Liquid Glass button; the native host shows the tools in a glass popover
  // that grows downward from under it (ipad/App/Chrome/ToolPopover.swift) and can expand to the whole content area.
  if (IPAD && ICONS) {
    const cluster = $('toolcluster');
    if (cluster) {
      cluster.classList.add('glass-mode');
      const gb = document.createElement('button');
      gb.type = 'button'; gb.id = 'toolglass'; gb.className = 'tb-btn tool-glass';
      gb.title = '工具：解题、拍题、GeoGebra、物理、百科、词典、代码、稍后读、扫码'; gb.setAttribute('aria-label', '工具'); gb.setAttribute('aria-haspopup', 'dialog');
      gb.innerHTML = '<svg class="tg-dots" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="3" r="1.35"/><circle cx="8" cy="3" r="1.35"/><circle cx="13" cy="3" r="1.35"/><circle cx="3" cy="8" r="1.35"/><circle cx="8" cy="8" r="1.35"/><circle cx="13" cy="8" r="1.35"/><circle cx="3" cy="13" r="1.35"/><circle cx="8" cy="13" r="1.35"/><circle cx="13" cy="13" r="1.35"/></svg><span class="tg-label">工具</span>';
      cluster.appendChild(gb);
      let open = false;
      gb.onclick = async () => {
        if (open) return;
        open = true; gb.classList.add('open'); gb.setAttribute('aria-expanded', 'true');
        try {
          const r = gb.getBoundingClientRect(), tb = document.querySelector('.toolbar');
          const items = TOOLS.map(id => ({ id, label: ICONS.label(id), tip: ICONS.tip(id), active: state.activeTool === id }));
          const res = await window.aib.invoke('tools:popover', { x: r.left, y: r.top, w: r.width, h: r.height }, items, tb ? tb.getBoundingClientRect().bottom : r.bottom);
          if (res && res.unsupported) { cluster.classList.remove('glass-mode'); return; } // older host: back to the strip
          // v3.0.1: the button is free again as soon as the popover closes, not only once the chosen tool has
          // finished opening (a tool or the camera can take a while, and the next tap on the button was ignored)
          open = false; gb.classList.remove('open'); gb.setAttribute('aria-expanded', 'false');
          if (res && res.id) toolAction(res.id).catch((e) => console.warn('tool', res.id, e));
        } catch (e) { console.warn('tools popover', e); }
        finally { open = false; gb.classList.remove('open'); gb.setAttribute('aria-expanded', 'false'); }
      };
    }
  }
  { const sb = $('splitbtn'); if (sb) sb.onclick = () => window.aib.invoke('split:toggle'); }
  { const sc = $('spacechip'); if (sc) sc.onclick = () => { const r = sc.getBoundingClientRect(); window.aib.invoke('space:menu', r.left, r.bottom); }; }
  {
    const bar = $('splitbar');
    if (bar) {
      let drag = false;
      bar.addEventListener('pointerdown', (e) => { drag = true; bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); });
      bar.addEventListener('pointermove', (e) => { if (!drag) return; const w = document.documentElement.clientWidth; bar.style.left = e.clientX + 'px'; window.aib.invoke('split:ratio', e.clientX / Math.max(1, w)); });
      const end = () => { drag = false; bar.classList.remove('drag'); };
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
      bar.addEventListener('dblclick', () => window.aib.invoke('split:swap'));
    }
  }
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
      const a = cur();
      if (a && a.kind === 'chat') q = a.display || a.title || '';
      else if (a && a.kind === 'home') {
        try { q = await window.aib.invoke('home:query'); } catch {}
      } else if (a && a.kind !== 'web' && addr.value) q = addr.value;
      else if (addr.value && !/^https?:\/\//i.test(addr.value) && addr.value !== (a && a.display)) q = addr.value;
    }
    await window.aib.invoke('mode:set', next, q);
  });
  addr.addEventListener('focus', () => { const a = cur(); if (a && a.kind !== 'chat') addr.value = (a.kind === 'home' || a.tool) ? '' : a.url; setTimeout(() => addr.select(), 0); });
  addr.addEventListener('blur', () => { const a = cur(); addr.value = a ? a.display || '' : ''; });
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
  window.aib.on('addr:fill', (text) => { addr.focus(); addr.value = String(text || ''); setTimeout(() => addr.select(), 0); });
  I18N.onChange(render);
  state = await window.aib.invoke('tabs:state');
  render();
})();
