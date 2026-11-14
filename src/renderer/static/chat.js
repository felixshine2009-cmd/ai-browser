// Chat-mode result page: renders word / sentence / article / question sessions from main-process events.
(async function () {
  await I18N.init();
  const params = new URLSearchParams(location.search);
  // v3.0.0: one page per conversation thread. Earlier turns stay above (frozen), the live turn streams below, and the
  // input stays at the bottom; a follow-up is appended under the last answer instead of opening a new page.
  let sid = params.get('sid');
  const root = document.getElementById('root');
  const esc = MD.esc;
  const freshState = () => ({ kind: null, input: '', answer: '', sources: [], cites: {}, tools: [], queries: [], pages: [], done: false, error: null, direct: false, phase: 'init', pngs: [], think: '', thinkStart: 0, thinkEnd: 0 });
  let st = freshState();
  // tool names in formal Chinese (ai/tools.js LABELS); unknown names are shown as they are
  let TOOL_LABELS = {};
  const toolLabel = (n) => (I18N.lang === 'en' ? n : (TOOL_LABELS[n] || n));
  window.aib.invoke('tools:catalog').then(c => { (c || []).forEach(x => { TOOL_LABELS[x.name] = x.label; }); try { renderTools(); } catch {} document.querySelectorAll('.tool-card').forEach(d => { const n = d.querySelector('.tc-name'); if (n) n.textContent = toolLabel(d.dataset.name); }); }).catch(() => {});
  root.innerHTML = '<div class="chat-shell"><aside class="chat-drawer" id="drawer" hidden><div class="drawer-head"><b id="drawertitle"></b><button type="button" class="btn-ghost" id="drawerclose">✕</button></div><input type="search" id="threadq" spellcheck="false"/><div class="thread-list" id="threadlist"></div></aside>'
    + '<div class="chat-app"><div class="chat-head"><button type="button" class="chip" id="histbtn"></button><span class="chat-title" id="chattitle"></span></div><div class="chat-scroll" id="chatscroll"><div class="chat-turns" id="turns"></div></div><div id="followhost"></div></div></div>';
  const turnsEl = document.getElementById('turns'), scroller = document.getElementById('chatscroll');
  let live = null; // container of the turn being rendered
  function newTurn(input, kind) {
    const w = document.createElement('div'); w.className = 'chat-turn';
    if (kind && kind !== 'question') { const u = document.createElement('div'); u.className = 'chat-user'; u.innerHTML = '<div class="bubble selectable"></div>'; u.firstChild.textContent = input; w.appendChild(u); }
    const body = document.createElement('div'); body.className = 'chat-turn-body'; w.appendChild(body);
    turnsEl.appendChild(w); return body;
  }
  // keeps a finished turn on the page: element ids are removed so the next turn can use them
  function freeze() {
    if (!live) return;
    const w = live.parentElement; w.classList.add('frozen');
    w.querySelectorAll('[id]').forEach(n => { n.dataset.fid = n.id; n.removeAttribute('id'); });
    w.querySelectorAll('iframe[data-ext]').forEach(f => { f.dataset.frozenExt = f.dataset.ext; f.removeAttribute('data-ext'); });
    w.querySelectorAll('.q-edit, .rerun').forEach(n => { n.disabled = true; });
    live = null; els = {}; runs = null;
  }
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
  const toBottom = (force) => { if (force || nearBottom()) scroller.scrollTop = scroller.scrollHeight; };
  let els = {};
  let runs = null;
  let renderQueued = false;

  const SPARK_Q = '';
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  // ----- skeletons per kind
  function buildQuestion() {
    live.innerHTML = '';
    const page = el('div', 'ai-page');
    const qbar = el('div', 'ai-query-bar');
    qbar.innerHTML = `<div class="q selectable" id="q"></div><div class="ai-label" id="qlabel" style="margin-top:8px;display:none"></div><div class="query-rewrites" id="rewrites"></div>`;
    const body = el('div', 'ai-body');
    const main = el('div', 'ai-main');
    main.innerHTML = `<div class="ai-label" id="alabel"></div><div id="status" class="status-line"></div><details class="think-box" id="thinkbox" hidden><summary id="thinksum"></summary><div class="think-body selectable" id="thinking"></div></details><div id="toolsrow"></div><div id="trace" class="trace"></div><div id="runs" class="runs"></div><div class="ai-answer selectable" id="answer"></div><div id="figs" class="run-figs"></div><div id="pngs"></div><div id="err"></div>`;
    const side = el('div', 'ai-side');
    side.style.display = 'none';
    side.innerHTML = `<div class="ai-label" id="plabel"></div><div class="pages-read" id="pages"></div><div class="ai-label" id="slabel"></div><div id="sources"></div>`;
    body.append(main, side);
    page.append(qbar, body);
    live.appendChild(page);
    els = { q: qs('q'), qlabel: qs('qlabel'), rewrites: qs('rewrites'), alabel: qs('alabel'), status: qs('status'), trace: qs('trace'), answer: qs('answer'), toolsrow: qs('toolsrow'), pngs: qs('pngs'), err: qs('err'), side, plabel: qs('plabel'), pages: qs('pages'), slabel: qs('slabel'), sources: qs('sources'), body, main, thinkbox: qs('thinkbox'), thinksum: qs('thinksum'), thinking: qs('thinking') };
    els.runs = qs('runs'); els.figs = qs('figs');
    runs = window.RunPanels ? RunPanels.create(els.runs, els.figs, { lang: () => I18N.lang, onStop: (id) => window.aib.invoke('chat:stopTool', id) }) : null;
    els.q.textContent = st.input;
    els.alabel.textContent = t('chat.answer') + (st.modelLabel ? ' · ' + st.modelLabel : '');
    els.plabel.textContent = t('chat.pagesRead');
    els.slabel.textContent = t('chat.sources');
  }
  const qs = id => document.getElementById(id);

  // ----- the input at the bottom (one per page): model switcher, send / stop, new conversation
  let fq = null, goBtn = null;
  function buildFollow() {
    const host = qs('followhost');
    host.className = 'chat-follow';
    host.innerHTML = `<div class="chat-follow-bar"><div id="followmodel"></div><button type="button" class="chip chat-new" id="newchat"></button></div><div class="home-search-box chat-follow-box"><textarea id="followq" rows="1" spellcheck="false" placeholder=""></textarea><button type="button" class="go" id="followgo"></button></div><div id="vkhost"></div>`;
    // per-conversation model switcher: applies to follow-up questions in this conversation
    if (window.AIBModelPicker && qs('followmodel')) {
      const mp = AIBModelPicker.mount(qs('followmodel'), {
        lang: () => I18N.lang,
        scopeNote: () => (I18N.lang === 'en' ? 'This chat' : '本对话'),
        load: () => window.aib.invoke('models:picker', sid),
        select: (ref) => window.aib.invoke('models:select', ref, sid),
        thinking: { load: () => window.aib.invoke('models:thinking'), select: (lv) => window.aib.invoke('models:setThinking', lv) },
        onManage: () => window.aib.invoke('nav:openUrl', 'aibrowser://settings#ai')
      });
      window.__AIB_MP__ = mp;
      if (!window.__AIB_MP_SUB__) { window.__AIB_MP_SUB__ = true; window.aib.on('models:changed', () => window.__AIB_MP__ && window.__AIB_MP__.refresh()); }
    }

    fq = qs('followq'); goBtn = qs('followgo');
    fq.placeholder = t('home.placeholder');
    const nb = qs('newchat'); nb.textContent = I18N.lang === 'en' ? 'New chat' : '新对话'; nb.title = nb.textContent;
    nb.onclick = () => { location.href = 'aibrowser://home'; };
    goBtn.onclick = () => (busy() ? stop() : sendFollow());
    fq.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy()) sendFollow(); } });
    fq.addEventListener('input', () => { fq.style.height = 'auto'; fq.style.height = Math.min(200, fq.scrollHeight) + 'px'; });
    if (window.VKeyboard) {
      const vk = VKeyboard.mount(qs('vkhost'), { getTarget: () => fq, collapsed: true });
      window.__AIB_VK__ = vk;
      window.aib.on('vkeyboard:cmd', (msg) => {
        if (!msg) return;
        if (msg.action === 'toggle') vk.setCollapsed(!vk.isCollapsed());
        else if (msg.action === 'show') vk.setCollapsed(false);
        else if (msg.action === 'hide') vk.setCollapsed(true);
        else if (msg.action === 'insert' && msg.text) vk.insert(msg.text);
        else if (msg.action === 'tab' && msg.tab) vk.setTab(msg.tab);
      });
    }
    setBusy(false);
  }
  let liveBusy = false;
  const busy = () => liveBusy;
  function setBusy(b) {
    liveBusy = !!b;
    if (!goBtn) return;
    goBtn.classList.toggle('stop', liveBusy);
    goBtn.textContent = liveBusy ? '■' : '↵';
    goBtn.title = liveBusy ? (I18N.lang === 'en' ? 'Stop (Esc)' : '停止生成（Esc）') : (I18N.lang === 'en' ? 'Send' : '发送');
    goBtn.setAttribute('aria-label', goBtn.title);
  }
  async function stop() { if (!liveBusy || !sid) return; await window.aib.invoke('chat:cancel', sid); }
  document.addEventListener('keydown', (e) => {
    if (!liveBusy) return;
    if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === '.')) { e.preventDefault(); stop(); }
  });
  // the address stays on the newest turn, so reopening the tab (or a restart) shows the whole thread again
  function setUrl(id) { try { if (new URLSearchParams(location.search).get('sid') !== id) history.replaceState(null, '', '?sid=' + encodeURIComponent(id)); } catch (e) { console.warn('replaceState', e && e.message); } }
  async function sendFollow() {
    const v = fq.value.trim(); if (!v) return;
    fq.value = ''; fq.style.height = '';
    const nsid = await window.aib.invoke('chat:follow', sid, v);
    if (!nsid) return;
    freeze();
    if (!turnsEl.querySelector('.chat-turn')) turnsEl.innerHTML = '';
    if (!curThread) curThread = nsid;
    sid = nsid;
    setUrl(nsid);
    await startLive(nsid, v);
  }

  function buildSentence() {
    live.innerHTML = `<div class="sent-page"><h2>${esc(t('sent.orig'))}</h2><div id="sorig" class="sent-orig selectable"></div>
      <div class="legend" id="legend"></div><div id="strans"></div><h2 id="sbh" style="display:none">${esc(t('sent.breakdown'))}</h2><div id="sbreak"></div><div id="status" class="status-line"></div><div id="err"></div></div>`;
    qs('sorig').textContent = st.input;
    qs('status').textContent = t('chat.thinking');
    els = { status: qs('status'), err: qs('err') };
  }
  function buildArticle() {
    live.innerHTML = `<div class="article-page"><div class="article-toolbar"><div style="font-weight:600">${esc(t('article.title'))}</div><div><button class="btn-secondary copy-btn" id="copybtn">${esc(t('article.copy'))}</button></div></div>
      <div class="article-cols"><div class="article-col selectable" id="asrc"><div class="lang">${esc(t('article.src'))}</div></div><div class="article-col selectable" id="adst"><div class="lang">${esc(t('article.dst'))}</div><div id="atext"></div></div></div><div id="err" style="padding:0 28px"></div></div>`;
    els = { asrc: qs('asrc'), atext: qs('atext'), err: qs('err') };
    qs('copybtn').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(qs('atext').innerText); };
  }
  function buildWord() {
    live.innerHTML = `<div class="dict-page" id="dictpage"><div class="dict-title" id="dtitle"></div><div id="dwrap" style="flex:1;min-height:0;display:flex;flex-direction:column"></div><div id="err" style="padding:0 40px"></div></div>`;
    els = { dwrap: qs('dwrap'), dtitle: qs('dtitle'), err: qs('err'), dictpage: qs('dictpage') };
    els.dtitle.innerHTML = `<span class="dict-headword" style="font-size:28px;color:var(--text-primary)">${esc(st.input)}</span>`;
    els.dwrap.innerHTML = `<div class="status-line" style="padding:0 40px">${esc(t('chat.thinking'))}</div>`;
  }

  // ----- event handling
  function onEvent(ev) {
    switch (ev.type) {
      case 'kind':
        st.kind = ev.kind === 'solve' ? 'question' : ev.kind;
        ({ word: buildWord, sentence: buildSentence, article: buildArticle }[ev.kind] || buildQuestion)();
        if (st.kind !== 'question' && live && !live.parentElement.querySelector('.chat-user')) { const u = el('div', 'chat-user'); u.innerHTML = '<div class="bubble selectable"></div>'; u.firstChild.textContent = st.input; live.parentElement.insertBefore(u, live); }
        break;
      case 'queries': st.queries = ev.queries; st.direct = ev.direct; renderQueries(); if (ev.direct) setStatus(t('chat.generating')); else if (!ev.queries.length) setStatus(t('chat.thinking')); break;
      case 'search-start': break;
      case 'model': st.modelLabel = ev.label || ''; if (els.alabel) els.alabel.textContent = t('chat.answer') + (st.modelLabel ? ' · ' + st.modelLabel : ''); break;
      case 'status': setStatus(ev.text); addTrace(ev.text); break;
      case 'thinking': st.think = (st.think || '') + ev.text; if (!st.thinkStart) st.thinkStart = Date.now(); st.thinkEnd = Date.now(); renderThinking(); break;
      case 'translate-error': setStatus((t('chat.translateFail') || 'Translation failed') + ': ' + (ev.error || '')); addTrace('✕ ' + (ev.error || '')); break;
      case 'answer-reset': st.answer = ''; st.translation = ''; queueRender(); break;
      case 'serp': break;
      case 'pages': st.pages = ev.pages; els.side.style.display = ''; renderPages(); break;
      case 'page-update': { const p = st.pages.find(x => x.n === ev.n); if (p) { p.status = ev.status; if (ev.title) p.title = ev.title; renderPages(); } break; }
      case 'sources': st.sources = ev.sources; st.cites = {}; ev.sources.forEach(s => st.cites[s.n] = s); renderSources(); setStatus(t('chat.generating')); break;
      case 'answer-delta': st.answer += ev.text; setStatus(''); if (st.think && !st.thinkDone) { st.thinkDone = true; renderThinking(); } queueRender(); break;
      case 'tool-step': if (!(runs && runs.step(ev))) traceStep(ev); thinkStep(ev); break;
      case 'tool-stream': if (runs) runs.stream(ev); break;
      case 'notice': if (els.trace) { const d = el('div', 'trace-line notice'); d.textContent = ev.text; els.trace.appendChild(d); } break;
      case 'tool': st.tools.push(ev); renderTools(); if (!(runs && runs.isRun(ev.name))) traceTool(ev); if (runs) runs.tool(ev); if (!replaying && (ev.name === 'ggb_eval' || ev.name === 'ggb_clear' || ev.name === 'ggb_export_png')) ensurePlotLayout(); break;
      case 'handler-result': renderHandlerResult(ev); break;
      case 'ai-entry-pending': els.dwrap.innerHTML = `<div class="status-line" style="padding:0 40px">${esc(t('dict.aiGenerating'))}</div>`; break;
      case 'ai-entry': {
        // Single headword: clear the pending title so DictView owns the only big word
        if (els.dtitle) els.dtitle.innerHTML = '';
        els.dwrap.innerHTML = '';
        const box = el('div', 'dict-body selectable'); box.style.overflow = 'auto';
        box.innerHTML = `<span class="ai-note">${esc(t('dict.aiNote'))}</span>`;
        const inner = el('div'); box.appendChild(inner); DictView.renderAiEntry(inner, ev.entry);
        els.dwrap.appendChild(box); break;
      }
      case 'sentence': renderSentence(ev.data); break;
      case 'article-src': buildArticleSrc(ev); break;
      case 'translation-delta': st.translation = (st.translation || '') + ev.text; renderTranslation(); break;
      case 'error': showError(ev); break;
      case 'stopped': st.stopped = true; break;
      case 'done': st.done = true; st.thinkDone = true; setStatus(''); if (st.kind === 'question') finalizeQuestion(); renderThinking(ev.thinkMs); renderMeta(ev); setBusy(false); if (!replaying && !drawer.hidden) setTimeout(renderList, 300); break;
    }
  }
  // ----- thinking (collapsed by default; streams while expanded) and tool steps
  function thinkSecs(ms) { return Math.max(1, Math.round(ms / 1000)); }
  function renderThinking(storedMs) {
    if (!els.thinkbox || (!st.think && !(st.thinkSteps || []).length)) return;
    els.thinkbox.hidden = false;
    const ms = storedMs || (st.thinkStart ? (st.thinkDone ? st.thinkEnd : Date.now()) - st.thinkStart : 0);
    const en = I18N.lang === 'en', fin = st.thinkDone || st.done;
    els.thinksum.textContent = (en ? 'Thinking' : '思考过程') + ' · ' + (fin ? (en ? `thought for ${thinkSecs(ms)} s` : `已思考 ${thinkSecs(ms)} 秒`) : (en ? 'thinking…' : '正在思考…'));
    els.thinking.textContent = st.think || '';
    (st.thinkSteps || []).forEach(x => { const d = el('div', 'think-step'); d.textContent = x; els.thinking.appendChild(d); });
    if (els.thinkbox.open) els.thinking.scrollTop = els.thinking.scrollHeight;
    if (!st.thinkTimer && !fin) {
      const box = els.thinkbox, mine = st;
      mine.thinkTimer = setInterval(() => { if (mine.thinkDone || mine.done || !box.isConnected || st !== mine) { clearInterval(mine.thinkTimer); return; } renderThinking(); }, 1000);
    }
  }
  function thinkStep(ev) {
    if (ev.status === 'run' || !ev.label) return;
    st.thinkSteps = st.thinkSteps || [];
    st.thinkSteps.push((ev.status === 'ok' ? '✓ ' : '✕ ') + toolLabel(ev.name || String(ev.label || '').split(' · ')[0]) + (String(ev.label || '').includes(' · ') ? ' · ' + String(ev.label).split(' · ').slice(1).join(' · ') : '') + (ev.ms != null ? ` · ${(ev.ms / 1000).toFixed(1)} 秒` : ''));
    renderThinking();
  }
  function renderMeta(ev) {
    if (!live) return;
    const host = els.main || live;
    let m = host.querySelector('.turn-meta');
    if (!m) { m = el('div', 'turn-meta'); host.appendChild(m); }
    const stopped = !!(st.stopped || (ev && ev.stopped));
    const parts = [];
    const line = ev && ev.stats && ev.stats.line; if (line) parts.push(line);
    if (stopped) parts.push(I18N.lang === 'en' ? 'Stopped' : '已中止');
    m.textContent = parts.join(' · ');
    m.classList.toggle('stopped', stopped);
    if (!parts.length) m.remove();
  }
  // v3.0.0: every tool call is a visible card (formal Chinese name, argument, state, time; details with arguments and result)
  function toolCard(id, name) {
    if (!els.trace) return null;
    let d = id != null ? els.trace.querySelector(`.tool-card[data-step="${id}"]`) : null;
    if (!d && id == null) d = Array.from(els.trace.querySelectorAll('.tool-card:not([data-filled])')).find(x => x.dataset.name === name) || null;
    if (!d) {
      d = el('div', 'tool-card'); if (id != null) d.dataset.step = id; d.dataset.name = name; d.dataset.status = 'run';
      d.innerHTML = '<div class="tc-head"><span class="tc-dot" aria-hidden="true"></span><span class="tc-name"></span><span class="tc-arg"></span><span class="tc-time"></span></div><details class="tc-detail" hidden><summary></summary><pre class="tc-args"></pre><pre class="tc-result"></pre></details>';
      d.querySelector('.tc-name').textContent = toolLabel(name);
      d.querySelector('.tc-detail summary').textContent = I18N.lang === 'en' ? 'Details' : '详情';
      els.trace.appendChild(d);
    }
    return d;
  }
  function traceStep(ev) {
    const d = toolCard(ev.id, ev.name || String(ev.label || '').split(' · ')[0]); if (!d) return;
    d.dataset.status = ev.status;
    const arg = String(ev.label || '').split(' · ').slice(1).join(' · ').replace(/ ✕ .*$/, '');
    d.querySelector('.tc-arg').textContent = arg;
    const stateText = ev.status === 'run' ? (I18N.lang === 'en' ? 'running…' : '运行中…') : ev.status === 'ok' ? '' : (I18N.lang === 'en' ? 'failed' : '失败');
    d.querySelector('.tc-time').textContent = ev.ms != null && ev.status !== 'run' ? `${(ev.ms / 1000).toFixed(1)} ${I18N.lang === 'en' ? 's' : '秒'}${stateText ? ' · ' + stateText : ''}` : stateText;
    d.setAttribute('aria-label', toolLabel(d.dataset.name) + ' ' + arg + ' ' + stateText);
  }
  function traceTool(ev) {
    const d = toolCard(ev.id != null ? ev.id : null, ev.name); if (!d) return;
    d.dataset.filled = '1';
    if (ev.error) d.dataset.status = 'error'; else if (d.dataset.status === 'run' && ev.result !== undefined) d.dataset.status = 'ok';
    const det = d.querySelector('.tc-detail');
    const fmt = (v) => { try { const j = typeof v === 'string' ? v : JSON.stringify(v, null, 1); return j.length > 1600 ? j.slice(0, 1600) + '…' : j; } catch { return String(v); } };
    const args = ev.args && Object.keys(ev.args).length ? fmt(ev.args) : '';
    const res = ev.error ? (I18N.lang === 'en' ? 'Error: ' : '错误：') + ev.error : (ev.result !== undefined ? fmt(ev.result) : '');
    det.querySelector('.tc-args').textContent = args ? (I18N.lang === 'en' ? 'Arguments\n' : '参数\n') + args : '';
    det.querySelector('.tc-result').textContent = res ? (I18N.lang === 'en' ? 'Result\n' : '结果\n') + res : '';
    det.hidden = !(args || res);
    if (!d.querySelector('.tc-arg').textContent && args) d.querySelector('.tc-arg').textContent = fmt(ev.args).replace(/\s+/g, ' ').slice(0, 60);
    if (!ev.error && ev.result && ev.result.doc && ev.result.doc.id) docCard(d, ev.result);
  }
  // v3.0.0 document card (layout engine / generator agents): live thumbnail, open, export PDF / HTML
  const DOC_KINDS = { slides: '幻灯片', 'table-chart': '表格与图表', exam: '试卷', mistakes: '错题本', 'word-cards': '单词卡', mindmap: '思维导图' };
  function docCard(toolEl, r) {
    const info = r.doc; const en = I18N.lang === 'en';
    (els.trace || document).querySelectorAll(`.doc-card[data-doc="${CSS.escape(info.id)}"]`).forEach(x => x.remove()); // only the latest state of a document is shown
    const c = el('div', 'doc-card'); c.dataset.doc = info.id;
    const kind = DOC_KINDS[info.kind] || (en ? 'Document' : '文档');
    c.innerHTML = '<div class="dc-thumb"><iframe sandbox="" tabindex="-1" aria-hidden="true"></iframe></div><div class="dc-body"><div class="dc-title"></div><div class="dc-meta"></div><div class="dc-actions"><button type="button" class="chip dc-open"></button><button type="button" class="chip dc-pdf"></button><button type="button" class="chip dc-html"></button></div><div class="dc-file"></div></div>';
    c.querySelector('.dc-title').textContent = info.title || kind;
    c.querySelector('.dc-meta').textContent = en ? `${kind} · ${info.pages} page(s) · ${info.size}` : `${kind} · 共 ${info.pages} 页 · ${String(info.size || '').replace(/^slide16x9$/, '16:9').replace(/^slide4x3$/, '4:3')}`;
    c.querySelector('.dc-open').textContent = en ? 'Open' : '打开预览';
    c.querySelector('.dc-pdf').textContent = en ? 'Export PDF' : '导出 PDF';
    c.querySelector('.dc-html').textContent = en ? 'Export HTML' : '导出 HTML';
    const fileRow = c.querySelector('.dc-file');
    const showFile = (x) => {
      fileRow.innerHTML = ''; if (!x || !x.path) return;
      const n = el('span', 'dc-filename'); n.textContent = (en ? 'Saved: ' : '已保存：') + x.file; fileRow.appendChild(n);
      const o = el('button', 'btn-ghost dc-openfile'); o.type = 'button'; o.textContent = en ? 'Open file' : '打开文件'; o.onclick = () => window.aib.invoke('doc:openFile', x.path); fileRow.appendChild(o);
      const f = el('button', 'btn-ghost dc-reveal'); f.type = 'button'; f.textContent = en ? 'Show in folder' : '在文件夹中显示'; f.onclick = () => window.aib.invoke('doc:reveal', x.path); fileRow.appendChild(f);
    };
    if (r.exported) showFile(r.exported);
    const exp = (fmt, b) => async () => {
      b.disabled = true; const old = b.textContent; b.textContent = en ? 'Exporting…' : '正在导出…';
      try { showFile(await window.aib.invoke('doc:export', info.id, fmt)); } catch (e) { fileRow.textContent = (en ? 'Export failed: ' : '导出失败：') + (e && e.message || e); }
      b.disabled = false; b.textContent = old;
    };
    c.querySelector('.dc-open').onclick = () => window.aib.invoke('doc:open', info.id);
    const pb = c.querySelector('.dc-pdf'), hb = c.querySelector('.dc-html'); pb.onclick = exp('pdf', pb); hb.onclick = exp('html', hb);
    c.querySelector('.dc-thumb').onclick = () => window.aib.invoke('doc:open', info.id);
    window.aib.invoke('doc:html', info.id).then(h => { const f = c.querySelector('iframe'); if (f && h) f.srcdoc = h; }).catch(() => { c.querySelector('.dc-thumb').hidden = true; });
    toolEl.after(c);
  }
  function addTrace(text) {
    if (!els.trace || !/^(用 |Searching |阅读：|Reading: |.*(不可用|没有找到相关结果|没有相关结果|已改用|nothing relevant|unavailable|had nothing))/.test(text || '')) return;
    const d = el('div', 'trace-line'); d.textContent = text; els.trace.appendChild(d);
  }
  function setStatus(s) { if (els.status) els.status.textContent = s || ''; }
  function showError(ev) {
    setStatus('');
    if (!els.err) return;
    const needCfg = ev.code === 'NO_CONFIG' || ev.code === 'NO_LOCAL_MODEL' || /401|403|API/.test(ev.message);
    els.err.innerHTML = `<div class="chat-error"><b>${esc(t('chat.error'))}</b> ${esc(ev.message)}${needCfg ? `<br><button class="btn-secondary" id="gocfg">${esc(t('chat.gotoSettings'))}</button>` : ''}</div>`;
    const b = qs('gocfg'); if (b) b.onclick = () => window.aib.invoke('nav:open', 'settings');
  }

  // ----- question rendering
  function queueRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; const stick = nearBottom(); renderAnswer(); if (stick) toBottom(true); }); }
  function renderAnswer() { if (els.answer) els.answer.innerHTML = MD.render(String(st.answer || '').replace(/(^|\n).*((调用了|使用了).{0,16}工具|I used the \w+ tool).*/gi, '$1'), st.cites); }
  function finalizeQuestion() { renderAnswer(); renderAnswerActions(); if (window.AnswerBlocks) AnswerBlocks.enhance(els.answer, { live: !replaying }); }
  function renderAnswerActions() {
    if (!st.answer || qs('actions')) return;
    const a = el('div', 'turn-actions'); a.id = 'actions'; a.style.cssText = 'display:flex;gap:8px;margin-top:12px';
    const copy = el('button', 'chip'); copy.textContent = t('chat.copy'); copy.onclick = () => navigator.clipboard && navigator.clipboard.writeText(st.answer);
    a.appendChild(copy); els.main.appendChild(a);
  }
  function renderQueries() {
    if (!els.rewrites || st.direct || !(st.queries || []).length) { if (els.qlabel) els.qlabel.style.display = 'none'; if (els.rewrites) els.rewrites.innerHTML = ''; return; }
    els.qlabel.style.display = ''; els.qlabel.textContent = t('chat.queries');
    els.rewrites.innerHTML = '';
    st.queries.forEach(q => { const c = el('span', 'chip'); const i = el('input'); i.value = q; i.className = 'q-edit'; i.size = Math.max(8, q.length); i.addEventListener('input', () => { i.size = Math.max(8, i.value.length); }); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') rerun(); }); c.appendChild(i); els.rewrites.appendChild(c); });
    const b = el('button', 'btn-ghost rerun'); b.textContent = t('chat.rerun'); b.onclick = rerun; els.rewrites.appendChild(b);
  }
  async function rerun() {
    const qsx = Array.from(document.querySelectorAll('.q-edit:not(:disabled)')).map(i => i.value.trim()).filter(Boolean);
    if (!qsx.length) return;
    const nsid = await window.aib.invoke('chat:rerun', sid, qsx);
    if (nsid) location.href = 'aibrowser://chat?sid=' + nsid;
  }
  function renderPages() {
    els.pages.innerHTML = '';
    st.pages.forEach(p => {
      const r = el('div', 'page-row'); r.innerHTML = `<span class="dot ${p.status === 'ok' ? '' : p.status}"></span><a href="${esc(p.url)}">${esc(p.site)} — ${esc((p.title || '').slice(0, 48))}</a>`;
      els.pages.appendChild(r);
    });
  }
  function renderSources() {
    els.sources.innerHTML = '';
    st.sources.forEach(s => {
      const c = el('div', 'source-card'); c.innerHTML = `<div class="num">${s.n}</div><div class="meta"><div class="site">${esc(s.site)}</div><div class="t"><a href="${esc(s.url)}">${esc(s.title)}</a></div></div>`;
      // Don't also fire the document-level <a> handler (would open the URL twice)
      c.onclick = (e) => { e.preventDefault(); e.stopPropagation(); window.aib.invoke('nav:openUrl', s.url); };
      els.sources.appendChild(c);
    });
    if (!st.sources.length && !st.pages.length) els.side.style.display = 'none';
    else els.side.style.display = '';
    renderAnswer();
  }
  function renderTools() {
    if (!els.toolsrow) return;
    const short = (a) => { try { if (a && a.code) return String(a.code).split('\n').find(l => l.trim() && !/^\s*(#|import |from )/.test(l)) || '…'; if (a && a.command) return a.command; if (a && a.packages) return [].concat(a.packages).join(' '); if (a && a.path) return a.path; const c = a && a.commands; if (c) return c.join('; '); for (const k of ['title', 'tool', 'action', 'query', 'word', 'url', 'text', 'tex', 'name', 'id']) if (a && a[k] != null && typeof a[k] !== 'object') return String(a[k]).split('\n')[0]; const v = a && Object.values(a).find(x => typeof x === 'string' || typeof x === 'number'); return v != null ? String(v).split('\n')[0] : ''; } catch { return ''; } };
    els.toolsrow.innerHTML = `<div class="tools-row"><span>${esc(t('chat.toolsUsed'))}</span> ` + st.tools.map(x => `<span class="tool-chip ${x.error ? 'err' : ''}" title="${esc(x.error || x.name)}">${esc(toolLabel(x.name))}${(s => s ? '(' + esc(s.slice(0, 80)) + ')' : '')(short(x.args))}</span>`).join('') + '</div>';
  }

  // ----- GeoGebra / panels
  function mountPanel(extId, panelId) {
    ensurePlotLayout();
    let f = Bridge.frameFor(extId, panelId);
    if (f) return f;
    const holder = document.getElementById('plotcanvas');
    f = document.createElement('iframe'); f.dataset.ext = extId; f.dataset.panel = panelId;
    f.addEventListener('load', () => { f.dataset.loaded = '1'; });
    f.src = `aibext://${extId}/panel.html`;
    holder.appendChild(f);
    showPanel(f);
    return f;
  }
  // Only the panel the AI is driving is visible (GeoGebra and Physics share this area); the title follows it.
  function showPanel(f) {
    const holder = document.getElementById('plotcanvas'); if (!holder || !f) return;
    holder.querySelectorAll('iframe').forEach(x => { x.style.display = x === f ? '' : 'none'; });
    const logo = document.querySelector('#plotpanel .gg-bar .logo');
    if (logo) logo.innerHTML = f.dataset.ext === 'aib.physics' ? `<span>${esc(t('plot.physics'))}</span>` : 'Geo<span>Gebra</span>';
  }
  Bridge.showPanel = showPanel;
  Bridge.mountPanel = mountPanel;
  function ensurePlotLayout() {
    if (document.getElementById('plotpanel')) return;
    if (!els.body) return;
    const p = el('div', 'plot-panel'); p.id = 'plotpanel';
    p.innerHTML = `<div class="gg-bar"><span class="logo">Geo<span>Gebra</span></span><span>|</span><span>${esc(t('plot.area'))}</span><span style="margin-left:auto">${esc(t('plot.byAi'))}</span></div><div class="gg-canvas" id="plotcanvas"></div>`;
    els.body.classList.add('tool-split');
    els.body.insertBefore(p, els.main);
  }
  Bridge.onPanelEvent((m) => {
    if (m.aibPanelEvent === 'png' && els.pngs) {
      const d = el('div', 'png-out'); const im = document.createElement('img'); im.src = m.data; d.appendChild(im); els.pngs.appendChild(d);
    }
  });

  // ----- word / handler results
  function renderHandlerResult(ev) {
    const r = ev.result;
    els.dwrap && (els.dwrap.innerHTML = '');
    if (r.type === 'dictionary') {
      const aiFn = (body) => {
        body.innerHTML = `<div class="status-line">${esc(t('dict.aiGenerating'))}</div>`;
        window.aib.invoke('chat:aiEntry', r.word).then(entry => {
          body.innerHTML = `<span class="ai-note">${esc(t('dict.aiNote'))}</span>`; const inner = el('div'); body.appendChild(inner); DictView.renderAiEntry(inner, entry); body.style.overflow = 'auto';
        }).catch(e => { body.innerHTML = `<div class="chat-error">${esc(e.message)}</div>`; });
      };
      DictView.render(els.dwrap, r, { ai: aiFn, manage: () => window.aib.invoke('nav:open', 'settings'), onSuggest: (w) => window.aib.invoke('nav:submit', w) });
    } else if (r.type === 'html') {
      const f = document.createElement('iframe'); f.className = 'dict-frame'; f.setAttribute('sandbox', ''); f.srcdoc = r.html; els.dwrap.appendChild(f);
    } else if (r.type === 'markdown') {
      const d = el('div', 'dict-body ai-answer selectable'); d.innerHTML = MD.render(r.text || ''); els.dwrap.appendChild(d);
    } else { const d = el('pre', 'dict-body selectable'); d.textContent = JSON.stringify(r, null, 2); els.dwrap.appendChild(d); }
  }

  // ----- sentence
  const ROLE_ZH = { subj: 'role.subj', pred: 'role.pred', obj: 'role.obj', attr: 'role.attr', adv: 'role.adv', comp: 'role.comp' };
  function renderSentence(d) {
    setStatus('');
    const roles = ['subj', 'pred', 'obj', 'attr', 'adv', 'comp'];
    qs('legend').innerHTML = roles.map(r => `<span><i class="l-${r}"></i>${esc(t(ROLE_ZH[r]))}</span>`).join('');
    const orig = st.input;
    const toks = Array.isArray(d.tokens) ? d.tokens : [];
    const joined = toks.map(x => x.text).join('');
    const o = qs('sorig'); o.innerHTML = '';
    if (toks.length && joined.replace(/\s+/g, '') === orig.replace(/\s+/g, '')) {
      toks.forEach((tk, i) => {
        const s = document.createElement('span'); s.className = 'tok ' + (roles.includes(tk.role) ? tk.role : 'other'); s.textContent = tk.text; o.appendChild(s);
        // preserve whitespace between tokens when the model dropped it
        if (!/\s$/.test(tk.text) && toks[i + 1] && !/^\s/.test(toks[i + 1].text) && !/^[.,;:!?)]/.test(toks[i + 1].text)) o.appendChild(document.createTextNode(' '));
      });
    } else o.textContent = orig;
    qs('strans').innerHTML = `<div class="trans-box"><div class="lbl">${esc(t('sent.translation'))}</div><div class="txt selectable">${esc(d.translation || '')}</div></div>`;
    const bd = Array.isArray(d.breakdown) ? d.breakdown : [];
    qs('sbh').style.display = bd.length ? '' : 'none';
    qs('sbreak').innerHTML = bd.length ? '<div class="tree selectable">' + bd.map(b => {
      const r = roles.includes(b.role) ? b.role : 'attr';
      return `<div class="row"><span class="role ${r}">${esc(t(ROLE_ZH[r]))}</span><span><b>${esc(b.text || '')}</b> — ${esc(b.note || '')}</span></div>`;
    }).join('') + '</div>' : '';
  }

  // ----- article
  function buildArticleSrc(ev) {
    els.asrc.innerHTML = `<div class="lang">${esc(t('article.src'))}</div>` + ev.paragraphs.map(p => `<p>${esc(p)}</p>`).join('');
    els.atext.innerHTML = `<div class="status-line">${esc(t('chat.thinking'))}</div>`;
  }
  function renderTranslation() {
    if (!els.atext) return;
    els.atext.innerHTML = String(st.translation).split(/\n\s*\n|\n/).filter(x => x.trim()).map(p => `<p>${esc(p.trim())}</p>`).join('');
  }

  // link handling: open web links in new tabs
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a && /^https?:/i.test(a.getAttribute('href'))) { e.preventDefault(); window.aib.invoke('nav:openUrl', a.getAttribute('href')); }
  });
  I18N.onChange(() => { if (st.kind === 'question' && els.alabel) { els.alabel.textContent = t('chat.answer'); els.plabel.textContent = t('chat.pagesRead'); els.slabel.textContent = t('chat.sources'); renderQueries(); } });

  // ----- start
  let liveReady = false; const liveBuf = [];
  window.aib.on('chat:event', (ev) => { if (ev.sid !== sid || !live) return; if (!liveReady) liveBuf.push(ev); else { onEvent(ev); toBottom(); } });
  async function startLive(id, input) {
    liveReady = false; liveBuf.length = 0;
    st = freshState(); st.input = input || '';
    live = newTurn(st.input, null);
    buildQuestion(); if (els.q) els.q.textContent = st.input; setStatus(t('chat.thinking')); st.kind = null;
    setBusy(true); toBottom(true);
    const snap = await window.aib.invoke('chat:attach', id);
    if (!snap) { live.innerHTML = `<div class="empty">${esc(t('chat.expired'))}</div>`; setBusy(false); return false; }
    st.input = snap.input; if (els.q) els.q.textContent = st.input;
    for (const ev of snap.events) onEvent(ev);
    liveReady = true; liveBuf.splice(0).forEach(onEvent);
    if (snap.done || st.done) setBusy(false);
    if (els.q && st.kind === 'question') els.q.textContent = st.input;
    toBottom(true);
    return true;
  }
  // a stored turn rendered with the same code as a live one (answers become synthetic events)
  let replaying = false;
  function replayTurn(tn) {
    st = freshState(); st.input = tn.input;
    const evs = tn.events && tn.events.length ? tn.events.slice() : [];
    live = newTurn(tn.input, null);
    if (!evs.length) {
      evs.push({ type: 'kind', kind: 'question' });
      if (tn.model) evs.push({ type: 'model', label: tn.model });
      if (tn.thinking) evs.push({ type: 'thinking', text: tn.thinking });
      (tn.tools || []).forEach(x => evs.push({ type: 'tool', name: x.name, args: {}, error: x.error }));
      if ((tn.sources || []).length) evs.push({ type: 'sources', sources: tn.sources });
      if (tn.answer) evs.push({ type: 'answer-delta', text: tn.answer });
      if (tn.error) evs.push({ type: 'error', message: tn.error });
    }
    if (!evs.some(e => e.type === 'kind')) evs.unshift({ type: 'kind', kind: 'question' });
    const body = evs.filter(e => e.type !== 'done' && e.type !== 'stopped');
    if (tn.stopped) body.push({ type: 'stopped' });
    body.push({ type: 'done', stopped: !!tn.stopped, thinkMs: tn.thinkMs, stats: { line: tn.line || '' } });
    replaying = true;
    for (const ev of body) { try { onEvent(ev); } catch (e) { console.error('replay', e); } }
    replaying = false;
    if (st.kind === 'question') { renderAnswer(); if (els.q) els.q.textContent = tn.input; }
    freeze();
  }

  // ----- conversation list (drawer): every stored thread, newest first; open, search, rename, delete
  const drawer = document.getElementById('drawer'), listEl = document.getElementById('threadlist'), tq = document.getElementById('threadq');
  let curThread = null;
  const fmtTime = (ms) => { const d = new Date(ms), now = new Date(); const same = d.toDateString() === now.toDateString(); return same ? d.toLocaleTimeString(I18N.lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(I18N.lang === 'en' ? 'en-US' : 'zh-CN'); };
  function paintHead() {
    const en = I18N.lang === 'en';
    document.getElementById('histbtn').textContent = en ? '☰ Chats' : '☰ 对话记录';
    document.getElementById('drawertitle').textContent = en ? 'Chats' : '对话记录';
    tq.placeholder = en ? 'Search chats' : '搜索对话';
  }
  async function renderList() {
    const rows = await window.aib.invoke('chat:list', tq.value).catch(() => []);
    const en = I18N.lang === 'en';
    listEl.innerHTML = rows.length ? '' : `<div class="empty">${esc(tq.value ? (en ? 'No matching chats' : '没有匹配的对话') : (en ? 'No chats yet' : '还没有对话'))}</div>`;
    for (const r of rows) {
      const it = el('div', 'thread-item' + (r.id === curThread ? ' current' : ''));
      it.dataset.id = r.id;
      it.innerHTML = `<div class="ti-main"><div class="ti-title"></div><div class="ti-sub"></div></div><div class="ti-side"><span class="ti-time">${esc(fmtTime(r.updated || Date.now()))}</span><span class="ti-acts"><button type="button" class="btn-ghost ti-ren" title="${esc(en ? 'Rename' : '重命名')}">✎</button><button type="button" class="btn-ghost ti-del" title="${esc(en ? 'Delete' : '删除')}">✕</button></span></div>`;
      it.querySelector('.ti-title').textContent = r.title || r.preview || (en ? 'Chat' : '对话');
      it.querySelector('.ti-sub').textContent = (en ? `${r.turns} turns · ` : `${r.turns} 轮 · `) + (r.preview || '');
      it.onclick = (e) => { if (e.target.closest('button')) return; if (r.id === curThread) { drawer.hidden = true; return; } location.href = 'aibrowser://chat?sid=' + encodeURIComponent(r.lastSid); };
      it.querySelector('.ti-ren').onclick = async () => {
        const tEl = it.querySelector('.ti-title'); const inp = document.createElement('input'); inp.value = r.title || ''; inp.className = 'ti-input'; tEl.replaceWith(inp); inp.focus(); inp.select();
        const done = async (save) => { if (save && inp.value.trim()) await window.aib.invoke('chat:renameThread', r.id, inp.value.trim()); renderList(); if (r.id === curThread && save) document.getElementById('chattitle').textContent = inp.value.trim(); };
        inp.onkeydown = (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
        inp.onblur = () => done(true);
      };
      it.querySelector('.ti-del').onclick = async () => {
        const ok = await window.AIBConfirm.ask({ title: en ? 'Delete this chat?' : '删除这段对话？', message: (en ? 'All turns of “' : '将删除“') + (r.title || r.preview || '') + (en ? '” will be removed.' : '”中的全部内容。'), detail: en ? 'This cannot be undone.' : '此操作无法撤销。', confirmText: en ? 'Delete' : '删除', danger: true });
        if (!ok) return;
        await window.aib.invoke('chat:deleteThread', r.id);
        if (r.id === curThread) { location.href = 'aibrowser://home'; return; }
        renderList();
      };
      listEl.appendChild(it);
    }
  }
  document.getElementById('histbtn').onclick = () => { drawer.hidden = !drawer.hidden; if (!drawer.hidden) { renderList(); tq.focus(); } };
  document.getElementById('drawerclose').onclick = () => { drawer.hidden = true; };
  let tqT = 0; tq.oninput = () => { clearTimeout(tqT); tqT = setTimeout(renderList, 150); };
  window.aib.on('chats:changed', () => { if (!drawer.hidden) renderList(); });
  paintHead(); I18N.onChange(paintHead);
  buildFollow();
  if (!sid) {
    // 对话记录 (menu): the list is open and a question typed below starts a new conversation
    drawer.hidden = false; renderList(); setBusy(false);
    turnsEl.innerHTML = `<div class="empty">${esc(I18N.lang === 'en' ? 'Pick a chat on the left, or ask something below to start a new one.' : '从左侧选择一段对话，或在下方输入问题开始新的对话。')}</div>`;
    window.__AIB_CHAT__ = { sid: () => sid, busy, stop };
    return;
  }
  const th = await window.aib.invoke('chat:thread', sid).catch(() => null);
  if (th && th.turns) for (const tn of th.turns) replayTurn(tn);
  if (th && th.title) document.title = th.title;
  if (th) { curThread = th.threadId; document.getElementById('chattitle').textContent = th.title || ''; }
  if (th && th.liveSid) { sid = th.liveSid; setUrl(sid); const ok = await startLive(sid, ''); if (ok && !th.turns.length) { document.title = st.input.slice(0, 60) || document.title; document.getElementById('chattitle').textContent = document.title; } }
  else if (!th || !th.turns.length) turnsEl.innerHTML = `<div class="empty">${esc(t('chat.expired'))}</div>`;
  else { sid = th.turns[th.turns.length - 1].sid || sid; setUrl(sid); setBusy(false); }
  toBottom(true);
  window.__AIB_CHAT__ = { sid: () => sid, busy, stop };
})();
