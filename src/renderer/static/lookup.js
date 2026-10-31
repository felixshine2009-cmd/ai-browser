(async function () {
  await I18N.init();
  const word = new URLSearchParams(location.search).get('q') || '';
  const root = document.getElementById('root');
  root.innerHTML = `<div class="lookup-card"><div class="lk-head"><span id="lw"></span><span class="x" id="lx">✕</span></div><div id="lb" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>`;
  document.getElementById('lw').textContent = word;
  document.getElementById('lx').onclick = () => window.aib.invoke('lookup:close');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.aib.invoke('lookup:close'); });
  const body = document.getElementById('lb');
  body.innerHTML = `<div class="lk-msg">…</div>`;
  try {
    const r = await window.aib.invoke('lookup:run', word);
    if (r && r.type === 'dictionary') {
      const wrap = document.createElement('div'); wrap.className = 'dict-page'; body.innerHTML = ''; body.appendChild(wrap);
      DictView.render(wrap, r, { manage: () => { window.aib.invoke('nav:open', 'settings'); window.aib.invoke('lookup:close'); } });
    } else body.innerHTML = `<div class="lk-msg">${MD.esc(t('lookup.notfound'))}</div>`;
  } catch (e) { body.innerHTML = `<div class="lk-msg">${MD.esc(e.message)}</div>`; }
})();
