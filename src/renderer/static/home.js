(async function () {
  await I18N.init();
  const g = document.getElementById('greet');
  let S = await window.aib.invoke('settings:get');
  // greeting: custom text (or localized default) with {name}; empty name drops the placeholder and its trailing comma
  const greetText = (st) => {
    const tpl = (st.greeting || '').trim() || t('home.greeting');
    const name = (st.displayName || '').trim();
    return name ? tpl.split('{name}').join(name) : tpl.replace(/\{name\}[，,、:：\s]*/g, '').trim();
  };
  const set = () => { g.textContent = greetText(S); document.title = t('tab.newtab'); };
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
