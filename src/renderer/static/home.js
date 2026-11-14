(async function () {
  await I18N.init();
  const tr = key => (typeof I18N !== 'undefined' && I18N.t ? I18N.t(key) : (typeof t === 'function' ? t(key) : key));
  const g = document.getElementById('greet');
  let S = await window.aib.invoke('settings:get');
  // greeting: custom text (or localized default) with {name}; empty name drops the placeholder and its trailing comma
  const greetText = (st) => {
    const tpl = (st.greeting || '').trim() || tr('home.greeting');
    const name = (st.displayName || '').trim();
    return name ? tpl.split('{name}').join(name) : tpl.replace(/\{name\}[，,、:：\s]*/g, '').trim();
  };
  // tools (U8): the same hand-drawn icons and Chinese captions as the toolbar; each tool opens in its own view (U1)
  const IC = window.AIB_ICONS;
  // v3.1: the home tools are the extensions' homepage contributions (each tool is a bundled first-party extension)
  const host = document.getElementById('hometools');
  const escA = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const svgOf = (t) => {
    if (t.icon && typeof t.icon === 'object' && t.icon.svg) return `<svg class="hd-icon" viewBox="0 0 16 16" aria-hidden="true">${t.icon.svg}</svg>`;
    const n = typeof t.icon === 'string' && t.icon.startsWith('builtin:') ? t.icon.slice(8) : t.id;
    return IC && IC.list[n] ? IC.svg(n) : (IC ? IC.svg('spaces') : '');
  };
  let homeTiles = ['solve', 'geogebra', 'physics', 'wiki', 'dict', 'code', 'readlater'].map(id => ({ key: id, id, label: IC ? IC.label(id) : id, tip: IC ? IC.tip(id) : id, icon: 'builtin:' + id, action: { type: 'toolView' } }));
  const paintHomeTools = () => {
    host.innerHTML = homeTiles.map(t => `<button type="button" class="ticon labeled" data-tool="${escA(t.key)}" title="${escA(t.tip)}" aria-label="${escA(t.label)}">${svgOf(t)}<span class="ticon-label">${escA(t.label)}</span></button>`).join('');
    host.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
      const t = homeTiles.find(x => x.key === b.dataset.tool) || {}; const a = t.action || {};
      if (a.type === 'command') return window.aib.invoke(a.command);
      if (a.type === 'page' || a.type === 'panel') return t.url && window.aib.invoke('nav:openUrl', t.url);
      return window.aib.invoke('tool:open', t.id);
    });
  };
  const loadHomeTools = async () => { try { const t = await window.aib.invoke('ext:toolPanel'); if (Array.isArray(t)) { homeTiles = t.filter(x => x.home); paintHomeTools(); } } catch (e) { console.warn('toolPanel', e); } };
  paintHomeTools(); loadHomeTools();
  if (window.aib.on) window.aib.on('ext:changed', loadHomeTools);
  const paintWork = () => document.querySelectorAll('#workswitch button').forEach(b => b.classList.toggle('on', b.dataset.work === (S.workMode || 'chat')));
  document.querySelectorAll('#workswitch button').forEach(b => b.onclick = async () => { S = await window.aib.invoke('settings:patch', { workMode: b.dataset.work }); paintWork(); });
  const set = () => {
    g.textContent = greetText(S); document.title = tr('tab.newtab'); paintWork();
    const bg = (S.home && S.home.background) || '';
    document.body.style.background = bg || '';
    document.querySelector('.home-ai').style.alignItems = (S.home && S.home.layout) === 'top' ? 'flex-start' : '';
  };
  set(); I18N.onChange(set);
  window.aib.on('settings:changed', (s) => { S = s; set(); });
  // model switcher: the choice becomes the current model for new conversations
  if (window.AIBModelPicker) {
    const mp = AIBModelPicker.mount(document.getElementById('homemodel'), {
      lang: () => (S.lang === 'en' ? 'en' : 'zh'),
      load: () => window.aib.invoke('models:picker'),
      select: (ref) => window.aib.invoke('models:select', ref),
      thinking: { load: () => window.aib.invoke('models:thinking'), select: (lv) => window.aib.invoke('models:setThinking', lv) },
      onManage: () => window.aib.invoke('nav:openUrl', 'aibrowser://settings#ai')
    });
    window.__AIB_MP__ = mp;
    window.aib.on('models:changed', () => mp.refresh());
    window.aib.on('settings:changed', () => mp.refresh());
  }
  const q = document.getElementById('q');
  document.getElementById('form').addEventListener('submit', (e) => { e.preventDefault(); const v = q.value.trim(); if (v) window.aib.invoke('nav:submit', v); });
  const grow = () => { q.style.height = '24px'; q.style.height = Math.min(q.scrollHeight, 168) + 'px'; };
  const report = () => window.aib.invoke('home:query', q.value); report();
  q.addEventListener('input', () => { grow(); report(); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); document.getElementById('form').requestSubmit(); } });
  q.focus();
  window.aib.on('addr:focus', () => q.focus());
  const vk = VKeyboard.mount(document.getElementById('vkhost'), { getTarget: () => q, collapsed: true });
  window.__AIB_VK__ = vk;
  window.aib.on('vkeyboard:cmd', (msg) => {
    if (!msg) return;
    if (msg.action === 'toggle') vk.setCollapsed(!vk.isCollapsed());
    else if (msg.action === 'show') vk.setCollapsed(false);
    else if (msg.action === 'hide') vk.setCollapsed(true);
    else if (msg.action === 'insert' && msg.text) vk.insert(msg.text);
    else if (msg.action === 'tab' && msg.tab) vk.setTab(msg.tab);
  });
})();
