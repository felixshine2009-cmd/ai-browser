// Chat-mode result page: renders word / sentence / article / question sessions from main-process events.
(async function () {
  await I18N.init();
  const params = new URLSearchParams(location.search);
  const sid = params.get('sid');
  const root = document.getElementById('root');
  const esc = MD.esc;
  const st = { kind: null, input: '', answer: '', sources: [], cites: {}, tools: [], queries: [], pages: [], done: false, error: null, direct: false, phase: 'init', pngs: [] };
  let els = {};
  let renderQueued = false;

  const SPARK_Q = '';
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  // ----- skeletons per kind
  function buildQuestion() {
    root.innerHTML = '';
    const page = el('div', 'ai-page');
    const qbar = el('div', 'ai-query-bar');
    qbar.innerHTML = `<div class="q selectable" id="q"></div><div class="ai-label" id="qlabel" style="margin-top:8px;display:none"></div><div class="query-rewrites" id="rewrites"></div>`;
    const body = el('div', 'ai-body');
    const main = el('div', 'ai-main');
    main.innerHTML = `<div class="ai-label" id="alabel"></div><div id="status" class="status-line"></div><div class="ai-answer selectable" id="answer"></div><div id="toolsrow"></div><div id="pngs"></div><div id="err"></div>`;
    const side = el('div', 'ai-side');
    side.style.display = 'none';
    side.innerHTML = `<div class="ai-label" id="plabel"></div><div class="pages-read" id="pages"></div><div class="ai-label" id="slabel"></div><div id="sources"></div>`;
    body.append(main, side);
    page.append(qbar, body);
    root.appendChild(page);
    els = { q: qs('q'), qlabel: qs('qlabel'), rewrites: qs('rewrites'), alabel: qs('alabel'), status: qs('status'), answer: qs('answer'), toolsrow: qs('toolsrow'), pngs: qs('pngs'), err: qs('err'), side, plabel: qs('plabel'), pages: qs('pages'), slabel: qs('slabel'), sources: qs('sources'), body, main };
    els.q.textContent = st.input;
    els.alabel.textContent = t('chat.answer');
    els.plabel.textContent = t('chat.pagesRead');
    els.slabel.textContent = t('chat.sources');
  }
  const qs = id => document.getElementById(id);

  function buildSentence() {
    root.innerHTML = `<div class="sent-page"><h2>${esc(t('sent.orig'))}</h2><div id="sorig" class="sent-orig selectable"></div>
      <div class="legend" id="legend"></div><div id="strans"></div><h2 id="sbh" style="display:none">${esc(t('sent.breakdown'))}</h2><div id="sbreak"></div><div id="status" class="status-line"></div><div id="err"></div></div>`;
    qs('sorig').textContent = st.input;
    qs('status').textContent = t('chat.thinking');
    els = { status: qs('status'), err: qs('err') };
  }
  function buildArticle() {
    root.innerHTML = `<div class="article-page"><div class="article-toolbar"><div style="font-weight:600">${esc(t('article.title'))}</div><div><button class="btn-secondary copy-btn" id="copybtn">${esc(t('article.copy'))}</button></div></div>
      <div class="article-cols"><div class="article-col selectable" id="asrc"><div class="lang">${esc(t('article.src'))}</div></div><div class="article-col selectable" id="adst"><div class="lang">${esc(t('article.dst'))}</div><div id="atext"></div></div></div><div id="err" style="padding:0 28px"></div></div>`;
    els = { asrc: qs('asrc'), atext: qs('atext'), err: qs('err') };
    qs('copybtn').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(qs('atext').innerText); };
  }
  function buildWord() {
    root.innerHTML = `<div class="dict-page" id="dictpage"><div class="dict-title" id="dtitle"></div><div id="dwrap" style="flex:1;min-height:0;display:flex;flex-direction:column"></div><div id="err" style="padding:0 40px"></div></div>`;
    els = { dwrap: qs('dwrap'), dtitle: qs('dtitle'), err: qs('err'), dictpage: qs('dictpage') };
    els.dtitle.innerHTML = `<span class="dict-headword" style="font-size:28px;color:var(--text-primary)">${esc(st.input)}</span>`;
    els.dwrap.innerHTML = `<div class="status-line" style="padding:0 40px">${esc(t('chat.thinking'))}</div>`;
  }

  // ----- event handling
  function onEvent(ev) {
    switch (ev.type) {
      case 'kind':
        st.kind = ev.kind;
        ({ word: buildWord, sentence: buildSentence, article: buildArticle }[ev.kind] || buildQuestion)();
        break;
      case 'queries': st.queries = ev.queries; st.direct = ev.direct; renderQueries(); setStatus(ev.direct ? t('chat.generating') : t('chat.searching')); break;
      case 'search-start': break;
      case 'serp': break;
      case 'pages': st.pages = ev.pages; els.side.style.display = ''; renderPages(); setStatus(t('chat.reading')); break;
      case 'page-update': { const p = st.pages.find(x => x.n === ev.n); if (p) { p.status = ev.status; if (ev.title) p.title = ev.title; renderPages(); } break; }
      case 'sources': st.sources = ev.sources; st.cites = {}; ev.sources.forEach(s => st.cites[s.n] = s); renderSources(); setStatus(t('chat.generating')); break;
      case 'answer-delta': st.answer += ev.text; setStatus(''); queueRender(); break;
      case 'tool': st.tools.push(ev); renderTools(); if (ev.name === 'ggb_eval' || ev.name === 'ggb_clear' || ev.name === 'ggb_export_png') ensurePlotLayout(); break;
      case 'handler-result': renderHandlerResult(ev); break;
      case 'ai-entry-pending': els.dwrap.innerHTML = `<div class="status-line" style="padding:0 40px">${esc(t('dict.aiGenerating'))}</div>`; break;
      case 'ai-entry': {
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
      case 'done': st.done = true; setStatus(''); if (st.kind === 'question') finalizeQuestion(); break;
    }
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
  function queueRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderAnswer(); }); }
  function renderAnswer() { if (els.answer) els.answer.innerHTML = MD.render(st.answer, st.cites); }
  function finalizeQuestion() { renderAnswer(); renderAnswerActions(); }
  function renderAnswerActions() {
    if (!st.answer || qs('actions')) return;
    const a = el('div'); a.id = 'actions'; a.style.cssText = 'display:flex;gap:8px;margin-top:12px';
    const copy = el('button', 'chip'); copy.textContent = t('chat.copy'); copy.onclick = () => navigator.clipboard && navigator.clipboard.writeText(st.answer);
    a.appendChild(copy); els.main.appendChild(a);
  }
  function renderQueries() {
    if (!els.rewrites || st.direct) { if (els.qlabel) els.qlabel.style.display = 'none'; if (els.rewrites) els.rewrites.innerHTML = ''; return; }
    els.qlabel.style.display = ''; els.qlabel.textContent = t('chat.queries');
    els.rewrites.innerHTML = '';
    st.queries.forEach(q => { const c = el('span', 'chip'); const i = el('input'); i.value = q; i.className = 'q-edit'; i.size = Math.max(8, q.length); i.addEventListener('input', () => { i.size = Math.max(8, i.value.length); }); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') rerun(); }); c.appendChild(i); els.rewrites.appendChild(c); });
    const b = el('button', 'btn-ghost rerun'); b.textContent = t('chat.rerun'); b.onclick = rerun; els.rewrites.appendChild(b);
  }
  async function rerun() {
    const qsx = Array.from(document.querySelectorAll('.q-edit')).map(i => i.value.trim()).filter(Boolean);
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
      c.onclick = () => window.aib.invoke('nav:openUrl', s.url);
      els.sources.appendChild(c);
    });
    if (!st.sources.length && !st.pages.length) els.side.style.display = 'none';
    else els.side.style.display = '';
    renderAnswer();
  }
  function renderTools() {
    if (!els.toolsrow) return;
    const short = (a) => { try { const c = a && a.commands; return c ? c.join('; ') : JSON.stringify(a || {}); } catch { return ''; } };
    els.toolsrow.innerHTML = `<div class="tools-row"><span>${esc(t('chat.toolsUsed'))}</span> ` + st.tools.map(x => `<span class="tool-chip ${x.error ? 'err' : ''}" title="${esc(x.error || '')}">${esc(x.name)}(${esc(short(x.args).slice(0, 80))})</span>`).join('') + '</div>';
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
    return f;
  }
  Bridge.mountPanel = mountPanel;
  function ensurePlotLayout() {
    if (document.getElementById('plotpanel')) return;
    if (!els.body) return;
    const p = el('div', 'plot-panel'); p.id = 'plotpanel';
    p.innerHTML = `<div class="gg-bar"><span class="logo">Geo<span>Gebra</span></span><span>|</span><span>${esc(t('plot.area'))}</span><span style="margin-left:auto">${esc(t('plot.byAi'))}</span></div><div class="gg-canvas" id="plotcanvas"></div>`;
    els.body.insertBefore(p, els.side);
    els.main.style.maxWidth = '46%'; els.main.style.flex = '1';
    els.side.style.width = '260px';
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
  let ready = false; const buf = [];
  window.aib.on('chat:event', (ev) => { if (ev.sid !== sid) return; if (!ready) buf.push(ev); else onEvent(ev); });
  const snap = await window.aib.invoke('chat:attach', sid);
  if (!snap) { root.innerHTML = `<div class="empty">${esc(t('chat.expired'))}</div>`; return; }
  st.input = snap.input;
  document.title = snap.input.slice(0, 60);
  for (const ev of snap.events) onEvent(ev);
  ready = true; buf.splice(0).forEach(onEvent);
  if (!st.kind) { buildQuestion(); setStatus(t('chat.thinking')); st.kind = null; }
})();
