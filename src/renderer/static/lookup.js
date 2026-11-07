(async function () {
  await I18N.init();
  const params = new URLSearchParams(location.search);
  const word = params.get('q') || '';
  const kind = params.get('k') || 'word';
  const root = document.getElementById('root');
  root.innerHTML = `<div class="lookup-card"><div class="lk-head"><span id="lw"></span><span class="x" id="lx">✕</span></div><div id="lb" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>`;
  document.getElementById('lw').textContent = word;
  document.getElementById('lx').onclick = () => window.aib.invoke('lookup:close');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.aib.invoke('lookup:close'); });
  const body = document.getElementById('lb');
  body.innerHTML = `<div class="lk-msg">…</div>`;

  const applyAi = (target) => {
    target.innerHTML = `<div class="lk-msg">${MD.esc(t('dict.aiGenerating') || '正在生成词条…')}</div>`;
    window.aib.invoke('chat:aiEntry', word).then(entry => {
      target.innerHTML = `<span class="ai-note">${MD.esc(t('dict.aiNote'))}</span>`;
      const inner = document.createElement('div');
      target.appendChild(inner);
      target.style.overflow = 'auto';
      DictView.renderAiEntry(inner, entry);
    }).catch(e => { target.innerHTML = `<div class="lk-msg">${MD.esc(e.message)}</div>`; });
  };

  try {
    if (kind === 'sentence') {
      const r = await window.aib.invoke('translate:run', word, {});
      body.innerHTML = `<div class="lk-msg selectable">${MD.esc((r && r.text) || '')}</div>`;
      return;
    }
    const r = await window.aib.invoke('lookup:run', word);
    if (r && r.type === 'dictionary') {
      if (!Array.isArray(r.results)) r.results = [];
      const wrap = document.createElement('div'); wrap.className = 'dict-page'; body.innerHTML = ''; body.appendChild(wrap);
      DictView.render(wrap, r, {
        ai: applyAi,
        manage: () => { window.aib.invoke('nav:open', 'settings'); window.aib.invoke('lookup:close'); },
        onSuggest: (w) => { location.search = '?q=' + encodeURIComponent(w) + '&k=word'; }
      });
    } else {
      applyAi(body);
    }
  } catch (e) { body.innerHTML = `<div class="lk-msg">${MD.esc(e.message)}</div>`; }
})();
