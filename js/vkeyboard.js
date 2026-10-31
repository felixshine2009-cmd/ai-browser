// Collapsible math + chemistry virtual keyboard. Inserts into a target <textarea|input>.
// Usage: VKeyboard.mount(container, { getTarget, collapsed:true, onToggle })
(function () {
  const TABS = [
    { id: 'math', zh: '数学', en: 'Math' },
    { id: 'chem', zh: '化学', en: 'Chem' },
    { id: 'greek', zh: '希腊', en: 'Greek' },
    { id: 'ops', zh: '运算', en: 'Ops' },
  ];
  const KEYS = {
    math: [
      ['π','θ','α','β','γ','δ','λ','μ','σ','ω','Δ','Σ','Π','∞'],
      ['√','∛','²','³','ⁿ','₀','₁','₂','₃','₄','½','⅓','¼','‰'],
      ['∫','∮','∂','∇','∑','∏','lim','→','⇒','⇔','≈','≠','≤','≥'],
      ['∈','∉','⊂','⊆','∪','∩','∅','∠','⊥','∥','△','□','°','′'],
      ['sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','log','ln','lg','exp','abs'],
    ],
    chem: [
      ['H','C','N','O','Na','Mg','Al','Si','P','S','Cl','K','Ca','Fe','Cu','Zn','Ag','Ba'],
      ['→','←','⇌','↔','≡','↑','↓','Δ','≠','≈'],
      ['⁺','⁻','²⁺','²⁻','³⁺','³⁻','₄','₂','₃','₀','₁','ₙ'],
      ['(s)','(l)','(g)','(aq)','mol','L','M','ppm','pH','Kₐ','Kᵦ','Kₛₚ'],
      ['—','=','≡','⋯','·','°C','kJ','atm','Pa','e⁻','H⁺','OH⁻','H₃O⁺','e⁻'],
    ],
    greek: [
      ['α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ','ν','ξ'],
      ['ο','π','ρ','σ','τ','υ','φ','χ','ψ','ω'],
      ['Α','Β','Γ','Δ','Ε','Ζ','Η','Θ','Ι','Κ','Λ','Μ','Ν','Ξ'],
      ['Ο','Π','Ρ','Σ','Τ','Υ','Φ','Χ','Ψ','Ω'],
    ],
    ops: [
      ['+','−','×','÷','·','±','∓','=','≠','≈','∝','%'],
      ['(',')','[',']','{','}','⟨','⟩','|','‖','⌊','⌋','⌈','⌉'],
      ['<','>','≤','≥','≪','≫','∶','∷','∴','∵','∀','∃'],
      ['←','→','↔','⇐','⇒','⇔','↦','∘','∗','⋆','⊕','⊗'],
    ],
  };

  function insertAtCursor(el, text) {
    if (!el) return;
    el.focus();
    const start = el.selectionStart == null ? el.value.length : el.selectionStart;
    const end = el.selectionEnd == null ? start : el.selectionEnd;
    const v = el.value || '';
    el.value = v.slice(0, start) + text + v.slice(end);
    const pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function mount(host, opts) {
    opts = opts || {};
    let collapsed = opts.collapsed !== false;
    let tab = 'math';
    const root = document.createElement('div');
    root.className = 'vk' + (collapsed ? ' collapsed' : '');
    root.innerHTML = `
      <button type="button" class="vk-toggle" id="vkToggle" aria-expanded="${!collapsed}">
        <span class="vk-ico">∑</span> <span class="vk-lab"></span>
        <span class="vk-chev">▾</span>
      </button>
      <div class="vk-panel" ${collapsed ? 'hidden' : ''}>
        <div class="vk-tabs"></div>
        <div class="vk-keys"></div>
      </div>`;
    host.appendChild(root);
    const lab = root.querySelector('.vk-lab');
    const panel = root.querySelector('.vk-panel');
    const tabsEl = root.querySelector('.vk-tabs');
    const keysEl = root.querySelector('.vk-keys');
    const toggle = root.querySelector('#vkToggle');

    function lang(){ return (window.I18N && I18N.lang) || 'zh'; }
    function setLab(){ lab.textContent = collapsed ? (lang()==='zh'?'数学 / 化学键盘':'Math / Chem keyboard') : (lang()==='zh'?'收起键盘':'Hide keyboard'); root.querySelector('.vk-chev').textContent = collapsed ? '▾' : '▴'; }

    function paintTabs(){
      tabsEl.innerHTML = TABS.map(t => `<button type="button" class="vk-tab${t.id===tab?' on':''}" data-t="${t.id}">${lang()==='zh'?t.zh:t.en}</button>`).join('');
      tabsEl.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tab = b.dataset.t; paint(); });
    }
    function paintKeys(){
      keysEl.innerHTML = KEYS[tab].map(row => `<div class="vk-row">${row.map(k => `<button type="button" class="vk-key${k.length>2?' wide':''}" data-k="${k.replace(/"/g,'&quot;')}">${k}</button>`).join('')}</div>`).join('');
      keysEl.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
        const el = typeof opts.getTarget === 'function' ? opts.getTarget() : opts.target;
        insertAtCursor(el, b.dataset.k);
        if (opts.onInsert) opts.onInsert(b.dataset.k);
      });
    }
    function paint(){ setLab(); paintTabs(); paintKeys(); toggle.setAttribute('aria-expanded', String(!collapsed)); }

    function setCollapsed(v){
      collapsed = !!v;
      root.classList.toggle('collapsed', collapsed);
      panel.hidden = collapsed;
      paint();
      if (opts.onToggle) opts.onToggle(collapsed);
    }
    toggle.onclick = () => setCollapsed(!collapsed);
    paint();

    const api = {
      root, setCollapsed, isCollapsed: () => collapsed, setTab: (t) => { if (KEYS[t]) { tab = t; paint(); } },
      insert: (text) => { const el = typeof opts.getTarget === 'function' ? opts.getTarget() : opts.target; insertAtCursor(el, text); },
      catalog: () => JSON.parse(JSON.stringify({ tabs: TABS, keys: KEYS })),
    };
    root._vk = api;
    return api;
  }

  window.VKeyboard = { mount, insertAtCursor, catalog: () => ({ tabs: TABS, keys: KEYS }) };
})();
