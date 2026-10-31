// Renders a dictionary handler result ({type:'dictionary', results:[{dictId,name,url}], suggestions}) into a container.
(function () {
  function render(container, result, opts) {
    opts = opts || {};
    container.innerHTML = '';
    const tabs = document.createElement('div'); tabs.className = 'dict-tabs';
    const body = document.createElement('div'); body.className = 'dict-body dict-frame-wrap';
    container.appendChild(tabs); container.appendChild(body);
    const items = result.results.map(r => ({ kind: 'dict', label: r.name, url: r.url, id: r.dictId }));
    let aiTab = null;
    if (opts.ai) { aiTab = { kind: 'ai', label: t('dict.aiTab') }; items.push(aiTab); }
    const els = [];
    function select(i) {
      els.forEach((e, j) => e.classList.toggle('active', i === j));
      body.innerHTML = '';
      const it = items[i];
      if (it.kind === 'dict') {
        const f = document.createElement('iframe');
        f.className = 'dict-frame'; f.setAttribute('sandbox', 'allow-scripts allow-popups'); f.src = it.url; f.dataset.dictId = it.id;
        body.appendChild(f);
      } else opts.ai(body);
    }
    items.forEach((it, i) => {
      const d = document.createElement('div'); d.className = 'dt'; d.textContent = it.label; d.dataset.kind = it.kind;
      d.onclick = () => select(i); tabs.appendChild(d); els.push(d);
    });
    if (opts.manage) { const m = document.createElement('div'); m.className = 'dt manage'; m.style.cssText = 'margin-left:auto;color:var(--accent);'; m.textContent = t('dict.manage'); m.onclick = opts.manage; tabs.appendChild(m); }
    select(0);
    if (result.suggestions && result.suggestions.length > 1 && opts.onSuggest) {
      const sg = document.createElement('div'); sg.className = 'dict-suggest';
      const l = document.createElement('span'); l.textContent = t('dict.related'); sg.appendChild(l);
      result.suggestions.filter(s => s.toLowerCase() !== (result.word || '').toLowerCase()).slice(0, 8).forEach(s => {
        const c = document.createElement('span'); c.className = 'chip'; c.textContent = s; c.onclick = () => opts.onSuggest(s); sg.appendChild(c);
      });
      container.insertBefore(sg, body);
    }
  }
  function renderAiEntry(container, e) {
    const esc = MD.esc;
    let h = `<div class="ai-label">${esc(t('dict.aiLabel'))}</div><div class="dict-headword">${esc(e.word || '')}</div>`;
    h += `<div class="dict-ipa">${e.ipa_uk ? `<span class="play">${esc(t('dict.uk'))} ${esc(e.ipa_uk)}</span>` : ''}${e.ipa_us ? `<span class="play">${esc(t('dict.us'))} ${esc(e.ipa_us)}</span>` : ''}</div>`;
    (e.pos || []).forEach(p => {
      h += `<div class="pos-block"><div class="pos">${esc(p.pos || '')}</div>`;
      (p.defs || []).forEach((d, i) => {
        h += `<div class="def">${i + 1}. ${esc(d.zh || '')}${d.en ? ` <span class="en-gloss">${esc(d.en)}</span>` : ''}</div>`;
        if (d.ex_en) h += `<div class="ex">${esc(d.ex_en)}<br/><span class="cn">${esc(d.ex_zh || '')}</span></div>`;
      });
      h += '</div>';
    });
    if ((e.phrases || []).length) {
      h += `<div class="phrase-sec"><h4>${esc(t('dict.phrases'))}</h4>` + e.phrases.map(p => `<div class="ph"><b>${esc(p.en || '')}</b> — ${esc(p.zh || '')}</div>`).join('') + '</div>';
    }
    container.innerHTML = h;
  }
  window.DictView = { render, renderAiEntry };
})();
