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
  const tools = [
    ['geogebra', 'GeoGebra', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13.5h12M2.5 14V2"/><path d="M3 11.5c2.2-6 4.8-6 7-1.5s2.5 1.5 3.5-3"/><circle cx="6.5" cy="7" r="1.3"/><circle cx="11.5" cy="9.5" r="1.3"/></svg>'],
    ['physics', '物理', '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(-30 8 8)"/><ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(30 8 8)"/><circle cx="8" cy="8" r="1.2"/></svg>'],
    ['solve', '解题', '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2" width="11" height="12" rx="2"/><path d="M5.2 6.2l1.6 1.6 3.8-3.4"/><path d="M5.2 10.8h5.6"/></svg>'],
    ['wiki', '百科', '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><path d="M2.3 6h11.4M2.3 10h11.4"/></svg>'],
    ['dict', '词典', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5c1.8-.6 4.2-.6 6 .5 1.8-1.1 4.2-1.1 6-.5v9.2c-1.8-.6-4.2-.6-6 .5-1.8-1.1-4.2-1.1-6-.5z"/><path d="M8 4v9.2"/></svg>']
  ];
  const host = document.getElementById('hometools');
  host.innerHTML = tools.map(([id, label, svg]) => `<button type="button" class="ticon" data-tool="${id}" title="${label}" aria-label="${label}">${svg}</button>`).join('');
  host.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => window.aib.invoke('nav:openUrl', 'aibrowser://tool?id=' + b.dataset.tool));
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
