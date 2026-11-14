(async function () {
  await I18N.init();
  const root = document.getElementById('root');
  root.innerHTML = `
    <header class="siri-head">
      <div class="siri-brand">
        <svg class="siri-orb" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <defs>
            <radialGradient id="siriPaneOrb" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stop-color="#6ee7b7"/>
              <stop offset="45%" stop-color="#38bdf8"/>
              <stop offset="100%" stop-color="#4f46e5"/>
            </radialGradient>
            <linearGradient id="siriPaneRing" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
              <stop offset="50%" stop-color="#a5f3fc" stop-opacity="0.45"/>
              <stop offset="100%" stop-color="#818cf8" stop-opacity="0.75"/>
            </linearGradient>
          </defs>
          <circle cx="10" cy="10" r="8" fill="url(#siriPaneOrb)"/>
          <path d="M3.2 10.4c2.2-2.6 4.6-2.4 6.8 0s4.6 2.6 6.8 0" fill="none" stroke="url(#siriPaneRing)" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="7.4" cy="7.2" r="2.1" fill="#ffffff" fill-opacity="0.38"/>
        </svg>
        <h2>页面助手</h2>
      </div>
      <button type="button" class="siri-clear" id="siriClear" title="清空对话" aria-label="清空对话">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.5a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.5"/></svg>
      </button>
    </header>
    <div class="siri-chips" role="toolbar" aria-label="快捷方式">
      <button type="button" class="siri-chip" id="sum" title="生成当前网页或 PDF 的摘要，并标注原文出处">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2" width="11" height="12" rx="2"/><path d="M5 5.5h6M5 8h6M5 10.5h3.5"/></svg>
        <span>一键摘要</span>
      </button>
      <button type="button" class="siri-chip" id="tr" title="对照翻译当前页面">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h7M5.5 2.5V4M3.5 4c.2 2.4 1.8 4.4 4.2 5.2M7 4c-.4 2-1.8 3.8-4 4.8"/><path d="M8.5 13.5l2.5-6 2.5 6M9.3 11.5h3.4"/></svg>
        <span>对照翻译</span>
      </button>
    </div>
    <div id="out" class="siri-out siri-thread" role="log" aria-live="polite"></div>
    <form class="siri-composer" id="siriForm">
      <textarea id="q" rows="1" placeholder="请输入关于当前网页或 PDF 的问题"></textarea>
      <button type="submit" class="primary siri-send" id="ask" title="提交问题" aria-label="提交问题">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12.5V3.5M4.5 7L8 3.5 11.5 7"/></svg>
      </button>
    </form>
  `;

  const out = document.getElementById('out');
  const qInput = document.getElementById('q');
  const form = document.getElementById('siriForm');
  const clearBtn = document.getElementById('siriClear');
  let busy = false;

  const resizeInput = () => {
    qInput.style.height = 'auto';
    qInput.style.height = Math.min(qInput.scrollHeight, 108) + 'px';
  };
  qInput.addEventListener('input', resizeInput);

  function appendTurn(label) {
    const turn = document.createElement('div');
    turn.className = 'siri-turn';
    const userBubble = document.createElement('div');
    userBubble.className = 'siri-msg user';
    userBubble.setAttribute('data-prompt', label);
    const aiBubble = document.createElement('div');
    aiBubble.className = 'siri-msg ai loading';
    aiBubble.textContent = '正在处理…';
    turn.append(userBubble, aiBubble);
    out.appendChild(turn);
    out.scrollTop = out.scrollHeight;
    return aiBubble;
  }

  const history = [];
  function renderAnswer(bubble, r) {
    const cites = {};
    for (const c of (r && r.cited) || []) cites[c.n] = { url: '#p' + c.n, title: (c.page ? '第 ' + c.page + ' 页：' : '') + c.text.slice(0, 160) };
    bubble.innerHTML = MD.render((r && r.text) || '', cites);
    if (r && r.cited && r.cited.length) {
      const box = document.createElement('details'); box.className = 'siri-sources';
      box.innerHTML = `<summary>引用的原文（${r.cited.length}）</summary>` + r.cited.map(c => `<button type="button" class="siri-src" data-n="${c.n}"><b>[${c.n}]</b>${c.page ? `<em>第 ${c.page} 页</em>` : ''}<span></span></button>`).join('');
      box.querySelectorAll('.siri-src').forEach((b, i) => { b.querySelector('span').textContent = r.cited[i].text; });
      bubble.appendChild(box);
    }
  }
  async function reveal(n, el) {
    const r = await window.aib.invoke('siri:reveal', Number(n)).catch(() => false);
    if (r && typeof r === 'object' && r.text) { // PDF: show the passage here
      const tip = document.createElement('div'); tip.className = 'siri-src-tip'; tip.textContent = '第 ' + r.page + ' 页：' + r.text;
      const host = el.closest('.siri-msg') || out; host.appendChild(tip); setTimeout(() => tip.remove(), 8000);
    }
  }
  out.addEventListener('click', (e) => {
    const a = e.target.closest('a.cite, span.cite, .siri-src');
    if (!a) return;
    e.preventDefault();
    const n = a.dataset.n || (a.getAttribute('href') || '').replace('#p', '') || a.textContent;
    reveal(n, a);
  });

  async function run(kind) {
    if (busy) return;
    const rawQ = qInput.value.trim();
    if (kind === 'ask' && !rawQ) {
      qInput.focus();
      return;
    }
    const label = kind === 'summary' ? '一键摘要' : kind === 'translate' ? '对照翻译' : rawQ;
    const payload = kind === 'ask' ? rawQ : '';
    if (kind === 'ask') {
      qInput.value = '';
      resizeInput();
    }
    busy = true;
    const aiBubble = appendTurn(label);
    try {
      const r = await window.aib.invoke('siri:ask', kind, payload, history.slice(-4));
      aiBubble.classList.remove('loading');
      if (kind === 'translate') aiBubble.textContent = (r && r.text) || '';
      else { renderAnswer(aiBubble, r); history.push({ q: kind === 'summary' ? '请总结本页内容。' : payload, a: (r && r.text) || '' }); }
    } catch (e) {
      aiBubble.classList.remove('loading');
      aiBubble.classList.add('error');
      aiBubble.textContent = String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      busy = false;
      out.scrollTop = out.scrollHeight;
    }
  }

  document.getElementById('sum').onclick = () => run('summary');
  document.getElementById('tr').onclick = () => run('translate');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run('ask');
  });
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      run('ask');
    }
  });
  clearBtn.onclick = () => {
    out.innerHTML = ''; history.length = 0;
    qInput.focus();
  };
})();
