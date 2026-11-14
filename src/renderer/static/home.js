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
  const tools = ['solve', 'geogebra', 'physics', 'wiki', 'dict', 'code', 'readlater'];
  const host = document.getElementById('hometools');
  host.innerHTML = tools.map(id => `<button type="button" class="ticon labeled" data-tool="${id}" title="${IC ? IC.tip(id) : id}" aria-label="${IC ? IC.label(id) : id}">${IC ? IC.svg(id) : ''}<span class="ticon-label">${IC ? IC.label(id) : id}</span></button>`).join('');
  host.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => window.aib.invoke('tool:open', b.dataset.tool));
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
