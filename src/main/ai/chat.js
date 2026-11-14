'use strict';
// Chat-mode orchestrator: classifies input and runs word / sentence / article / question pipelines.
// Emits events to the owning page (aibrowser://chat) which renders them; sessions are replayable.
const crypto = require('crypto');
const { webContents } = require('electron');
const llm = require('./llm');
const search = require('./search');
const { classify } = require('../classify');
const features = require('../ext/features');
const store = require('../store');
const P = require('./prompts');
const ipa = require('./ipa');
const agent = require('./agent');
const translator = require('./translate');
const T = require('./thread');

const sessions = new Map();

function today() { return new Date().toISOString().slice(0, 10); }

function create(input, kindOverride, extra) {
  extra = extra || {};
  const sid = crypto.randomBytes(6).toString('hex');
  const s = { sid, input, kindOverride: kindOverride || null, events: [], wcId: null, started: false, ac: new AbortController(), done: false, prior: extra.prior || [], priorTurns: extra.priorTurns || null, refs: extra.refs || [], images: extra.images || [], threadId: extra.threadId || null,
    answer: '', thinking: '', sources: [], tools: [], model: '', kind: null, startedAt: 0, firstAt: 0, endedAt: 0, stopped: false, error: '' };
  s.threadId = s.threadId || sid;
  sessions.set(sid, s);
  if (sessions.size > 60) sessions.delete(sessions.keys().next().value);
  return sid;
}

function track(s, ev) {
  switch (ev.type) {
    case 'answer-delta': case 'translation-delta': if (!s.firstAt) s.firstAt = Date.now(); s.answer += ev.text || ''; break;
    case 'answer-reset': s.answer = ''; break;
    case 'thinking': if (!s.thinkStart) s.thinkStart = Date.now(); s.thinking += ev.text || ''; s.thinkEnd = Date.now(); break;
    case 'sources': s.sources = ev.sources || []; break;
    case 'tool': s.tools.push({ name: ev.name, error: ev.error ? String(ev.error).slice(0, 200) : '' }); break;
    case 'model': s.model = ev.label || ''; break;
    case 'kind': s.kind = ev.kind; break;
    case 'error': s.error = String(ev.message || ''); break;
  }
}
function emit(s, ev) {
  // after Stop, late output of the aborted model / tools is dropped (the partial answer stays as it was)
  if (s.stopped && ev.type !== 'stopped' && ev.type !== 'done') return;
  track(s, ev);
  // coalesce consecutive deltas of the same stream to keep replay small
  const last = s.events[s.events.length - 1];
  if ((ev.type === 'answer-delta' || ev.type === 'translation-delta') && last && last.type === ev.type) last.text += ev.text;
  else s.events.push({ ...ev });
  if (s.wcId != null) {
    const wc = webContents.fromId(s.wcId);
    if (wc && !wc.isDestroyed()) wc.send('chat:event', { sid: s.sid, ...ev });
  }
}

function attach(sid, wcId) {
  const s = sessions.get(sid);
  if (!s) return null;
  s.wcId = wcId;
  const snapshot = { sid, input: s.input, events: s.events.slice(), done: s.done };
  if (!s.started) { s.started = true; run(s).catch(e => fail(s, e)); }
  return snapshot;
}

function fail(s, e) {
  if (s.ac.signal.aborted) return;
  console.error('chat error:', e && e.message);
  emit(s, { type: 'error', message: String(e && e.message || e), code: e && e.code });
  s.done = true; s.endedAt = Date.now(); emit(s, { type: 'done', stats: statsOf(s) }); saveTurn(s);
}
/** Stop button / Esc: aborts the model stream, running tools and the agent loop; the partial answer is kept. */
function cancel(sid) {
  const s = sessions.get(sid);
  if (!s || s.done) return false;
  s.stopped = true; s.ac.abort();
  s.done = true; s.endedAt = Date.now();
  emit(s, { type: 'stopped' });
  emit(s, { type: 'done', stopped: true, stats: statsOf(s) });
  saveTurn(s);
  return true;
}
function cancelForWebContents(wcId) { for (const s of sessions.values()) if (s.wcId === wcId && !s.done) s.ac.abort(); }

// ---------- threads (v3.0.0): every finished turn is stored with its thread, so the page shows the whole conversation
function statsOf(s) { return { startedAt: s.startedAt, firstAt: s.firstAt, endedAt: s.endedAt || Date.now(), answer: s.answer, line: T.statsLine({ startedAt: s.startedAt, firstAt: s.firstAt, endedAt: s.endedAt || Date.now(), answer: s.answer }) }; }
function record(s) {
  const r = T.turnRecord({ sid: s.sid, input: s.input, kind: s.kind, answer: s.answer, sources: s.sources, tools: s.tools, model: s.model, error: s.error, startedAt: s.startedAt, firstAt: s.firstAt, endedAt: s.endedAt });
  r.thinking = String(s.thinking || '').slice(0, 20000);
  r.thinkMs = s.thinkStart ? Math.max(0, (s.thinkEnd || s.endedAt) - s.thinkStart) : 0;
  r.stopped = !!s.stopped;
  // word / sentence / article results are replayed from their events (they are not plain answers)
  if (s.kind && s.kind !== 'question') r.events = s.events.filter(e => e.type !== 'thinking').slice(0, 400);
  return r;
}
function saveTurn(s) {
  if (s.saved && !s.stopped) return; s.saved = true;
  if (!s.input || s.ephemeral) return;
  try {
    const id = s.threadId || s.sid;
    const row = store.getChat(id) || { id, title: T.title(s.input), kind: 'thread', turns: [] };
    T.addTurn(row, record(s));
    if (!row.title) row.title = T.title(row.turns[0].input);
    store.upsertChat(row);
  } catch (e) { console.error('chat save', e && e.message); }
}
function findThread(sid) {
  const s = sessions.get(sid);
  if (s) return store.getChat(s.threadId || s.sid);
  return store.listChats().find(r => r.id === sid || (r.turns || []).some(t => t.sid === sid)) || null;
}
/** The whole stored thread of `sid`, plus the turn still being answered (not stored yet), if any. */
function thread(sid) {
  const s = sessions.get(sid);
  const row = findThread(sid);
  const threadId = s ? (s.threadId || s.sid) : (row ? row.id : null);
  if (!threadId) return null;
  const turns = (row && Array.isArray(row.turns) ? row.turns : []).map(t => Object.assign({}, t, { line: T.statsLine(t) }));
  let liveSid = null;
  for (const x of sessions.values()) if ((x.threadId || x.sid) === threadId && !x.done && !turns.some(t => t.sid === x.sid)) liveSid = x.sid;
  // a turn that just started (or finished without being stored, e.g. an empty input) is attached live
  if (!liveSid && s && !turns.some(t => t.sid === sid)) liveSid = sid;
  return { threadId, title: row ? row.title : T.title(s && s.input), turns, liveSid };
}
function contextOpts() {
  try {
    if (isLocal()) return { local: true, contextTokens: Number(store.getSettings().ai.local.contextSize) || 4096 };
    const m = llm.activeModel(); const caps = llm.modelCaps(m.provider, m.model);
    return { local: false, contextTokens: (caps && (caps.ctx || caps.context)) || 32000 };
  } catch { return { local: false, contextTokens: 32000 }; }
}
function get(sid) { return sessions.get(sid); }

async function run(s) {
  const onNotice = (text) => emit(s, { type: 'notice', text });
  llm.events.on('notice', onNotice);
  // per-conversation model (chosen in this thread's switcher); otherwise the global current model
  const models = require('./models');
  const ref = models.threadModel(s.threadId || s.sid);
  s.startedAt = s.startedAt || Date.now();
  try {
    await llm.withModel(ref, async () => {
      // earlier turns of the thread, trimmed to the context budget of the model that answers this turn
      if (s.priorTurns) s.prior = T.priorMessages(s.priorTurns, contextOpts());
      const m = llm.activeModel();
      emit(s, { type: 'model', provider: m.provider, model: m.model, label: ref ? models.labelOf(ref) : m.label, override: !!ref });
      await run0(s);
    });
  } finally { llm.events.off('notice', onNotice); }
}
async function run0(s) {
  const ctx = { wcId: s.wcId, sid: s.sid, threadId: s.threadId || s.sid };
  let cl = s.kindOverride ? { kind: s.kindOverride, word: s.input } : classify(s.input);
  if (cl.kind === 'word' && cl.phrase) {
    // multi-word candidate: only treat as dictionary phrase if a handler finds it
    const r = await features.runInputHandlers('word', { kind: 'word', word: cl.word, phrase: true }, ctx).catch(e => translateFail(s, e));
    if (r) { emit(s, { type: 'kind', kind: 'word' }); emit(s, { type: 'handler-result', extId: r.extId, result: r.result, word: cl.word }); return finish(s); }
    cl = /\?|^(what|why|how|when|where|who|which)\b/i.test(cl.word) ? { kind: 'question' } : { kind: 'sentence' };
  }
  // solve answers use exactly the chat question renderer (U7); the solver prompt still follows kindOverride
  emit(s, { type: 'kind', kind: (cl.kind === 'task' || cl.kind === 'solve') ? 'question' : cl.kind });
  if (cl.kind === 'task') { await runTask(s); return finish(s); }
  switch (cl.kind) {
    case 'word': await runWord(s, cl.word, ctx); break;
    case 'sentence': await runSentence(s, ctx); break;
    case 'article': await runArticle(s, cl.target || 'zh'); break;
    default: await runQuestion(s, ctx);
  }
  finish(s);
}
function finish(s) { if (s.done) return; s.done = true; s.endedAt = Date.now(); emit(s, { type: 'done', stats: statsOf(s) }); saveTurn(s); }

// ---------- word
const isLocal = () => llm.activeSource() === 'local';

// Placeholders that small models often copy verbatim from poorly-written prompts / schemas
const ZH_PLACEHOLDERS = /^(中文释义|中文意思|汉语释义|释义|例句翻译|短释义|chinese meaning|definition|gloss)$/i;
const EN_PLACEHOLDERS = /^(short English gloss|english gloss|english definition|definition|gloss|example sentence)$/i;
const EX_PLACEHOLDERS = /^(example|example sentence|例句|例句翻译|an example)$/i;

function looksPlaceholder(s) { return !s || ZH_PLACEHOLDERS.test(String(s).trim()) || EN_PLACEHOLDERS.test(String(s).trim()) || EX_PLACEHOLDERS.test(String(s).trim()); }

function sanitizeEntry(word, raw) {
  const e = (raw && typeof raw === 'object') ? JSON.parse(JSON.stringify(raw)) : {};
  e.word = String(e.word || word || '').trim() || word;
  const merged = ipa.merge(e.word, e.ipa_uk, e.ipa_us);
  e.ipa_uk = merged.ipa_uk; e.ipa_us = merged.ipa_us;
  const posIn = Array.isArray(e.pos) ? e.pos : [];
  const posOut = [];
  let placeholderHits = 0, droppedPos = 0;
  for (const p of posIn) {
    const tag = String(p && p.pos || '').trim();
    if (!tag || /placeholder|词性/i.test(tag)) { droppedPos++; continue; }
    const defs = [];
    for (const d of (Array.isArray(p.defs) ? p.defs : [])) {
      const zh = String(d && d.zh || '').trim();
      const en = String(d && d.en || '').trim();
      let ex_en = String(d && d.ex_en || '').trim();
      let ex_zh = String(d && d.ex_zh || '').trim();
      if (looksPlaceholder(zh) || looksPlaceholder(en)) { placeholderHits++; continue; }
      if (looksPlaceholder(ex_en)) ex_en = '';
      if (looksPlaceholder(ex_zh)) ex_zh = '';
      // Drop senses whose example clearly doesn't use the headword (hallucinated sense)
      const hw = e.word.toLowerCase();
      if (ex_en && hw && !ex_en.toLowerCase().includes(hw.split(/\s+/)[0]) && ex_en.length < 80) {
        // allow if multi-word phrase headword; otherwise soft-drop example only
        ex_en = ''; ex_zh = '';
      }
      if (!zh && !en) continue;
      defs.push({ zh, en, ex_en, ex_zh });
    }
    if (!defs.length) { droppedPos++; continue; }
    posOut.push({ pos: tag, defs });
  }
  e.pos = posOut;
  e.phrases = (Array.isArray(e.phrases) ? e.phrases : [])
    .map(p => ({ en: String(p && p.en || '').trim(), zh: String(p && p.zh || '').trim() }))
    .filter(p => p.en && !looksPlaceholder(p.en) && !looksPlaceholder(p.zh));
  e._meta = { placeholderHits, droppedPos, ok: posOut.length > 0 && placeholderHits === 0 };
  return e;
}

async function aiEntry(word, signal) {
  const sys = P.wordEntry({ local: isLocal() });
  let j = await llm.completeJson([{ role: 'system', content: sys }, { role: 'user', content: word }], { signal, role: 'dictionary' });
  let e = sanitizeEntry(word, j);
  if (!e._meta.ok) {
    // One correction retry: tell the model what went wrong, demand real glosses
    try {
      j = await llm.completeJson([
        { role: 'system', content: sys },
        { role: 'user', content: word },
        { role: 'assistant', content: JSON.stringify(j) },
        { role: 'user', content: 'Your JSON used placeholder text (e.g. 中文释义) or invented senses, or had no valid definitions. Reply again with ONLY corrected JSON for "' + word + '": real Chinese glosses, real English definitions, only attested parts of speech. Leave ipa_uk/ipa_us as "".' }
      ], { signal, maxTokens: 1200, role: 'dictionary' });
      e = sanitizeEntry(word, j);
    } catch (err) { if (signal && signal.aborted) throw err; }
  }
  if (!e.pos.length) {
    // Last resort: keep a minimal honest stub so the UI is not blank
    e.pos = [{ pos: '—', defs: [{ zh: '未能生成可靠词条，请重试或导入 MDX 词典。', en: 'Could not build a reliable entry. Retry or import an MDX dictionary.', ex_en: '', ex_zh: '' }] }];
  }
  delete e._meta;
  return e;
}

async function runWord(s, word, ctx) {
  const r = await features.runInputHandlers('word', { kind: 'word', word }, ctx);
  if (r) { emit(s, { type: 'handler-result', extId: r.extId, result: r.result, word }); return; }
  emit(s, { type: 'ai-entry-pending', word });
  const entry = await aiEntry(word, s.ac.signal);
  emit(s, { type: 'ai-entry', word, entry });
}

// ---------- sentence
const useHunyuan = () => (store.getSettings().translate || {}).engine !== 'chat';
function progressStatus(s) {
  const zh = store.getSettings().lang !== 'en';
  return (p) => emit(s, { type: 'status', text: (zh ? '下载翻译模型 ' : 'Downloading translation model ') + (p.total ? Math.round(p.got / p.total * 100) + '%' : '') });
}
function translateFail(s, e) {
  const zh = store.getSettings().lang !== 'en';
  const msg = String((e && e.message) || e || 'unknown').slice(0, 200);
  emit(s, { type: 'status', text: (zh ? '翻译模型下载/加载失败：' : 'Translation model download/load failed: ') + msg });
  emit(s, { type: 'translate-error', error: msg });
  return null;
}
async function runSentence(s) {
  // HY-MT (downloaded on first use, lazy-loaded) produces the translation; the chat model only does the grammar analysis.
  const tp = useHunyuan() ? translator.translate(s.input, { signal: s.ac.signal, onProgress: progressStatus(s) }).then(r => r.text).catch(e => translateFail(s, e)) : Promise.resolve(null);
  const j = await llm.completeJson([{ role: 'system', content: P.sentence({ local: isLocal() }) }, { role: 'user', content: s.input }], { signal: s.ac.signal });
  const tr = await tp;
  if (tr && j && typeof j === 'object') { j.translation_llm = j.translation; j.translation = tr; j.translation_model = 'HY-MT1.5'; }
  emit(s, { type: 'sentence', data: j });
}

// ---------- article
async function runArticle(s, target) {
  const paras = s.input.split(/\n\s*\n|\n/).map(x => x.trim()).filter(Boolean);
  emit(s, { type: 'article-src', paragraphs: paras, target });
  if (useHunyuan()) {
    try {
      emit(s, { type: 'status', text: store.getSettings().lang !== 'en' ? '加载混元翻译模型…' : 'Loading Hunyuan translation model…' });
      try { await translator.translate(paras.join('\n\n'), { target, signal: s.ac.signal, onProgress: progressStatus(s), onDelta: t => emit(s, { type: 'translation-delta', text: t }) }); }
      catch (e) { translateFail(s, e); throw e; }
      return;
    } catch (e) { if (s.ac.signal.aborted) throw e; console.error('hunyuan translate failed, falling back to chat model:', e && e.message); emit(s, { type: 'answer-reset' }); }
  }
  let overrideLocal = null, hint = '';
  if (isLocal()) {
    const L = store.getSettings().ai.local;
    if (L.translateModelId) {
      const localMod = require('./local');
      const m = localMod.listModels(L).find(x => x.id === L.translateModelId && x.downloaded);
      if (m) { overrideLocal = { ...L, modelPath: m.path, modelId: m.id }; hint = m.promptHint || ''; }
    }
  }
  // Specialist translation models want their own prompt shape (no long system prompt)
  let messages;
  const text = paras.join('\n\n');
  if (hint === 'seed-x') {
    const tag = target === 'en' ? '<en>' : '<zh>';
    const dir = target === 'en' ? 'Chinese sentence into English' : 'English sentence into Chinese';
    messages = [{ role: 'user', content: `Translate the following ${dir}:\n${text} ${tag}` }];
  } else if (hint === 'translate-only') {
    const lang = target === 'en' ? 'English' : 'Chinese';
    messages = [{ role: 'user', content: `Translate the following segment into ${lang}, without additional explanation.\n\n${text}` }];
  } else {
    messages = [{ role: 'system', content: P.article({ target, local: isLocal() }) }, { role: 'user', content: text }];
  }
  const opts = { messages, temperature: 0.2, signal: s.ac.signal, onDelta: t => emit(s, { type: 'translation-delta', text: t }) };
  if (overrideLocal) await llm.chat({ ...opts, _localOverride: overrideLocal });
  else await llm.chat(opts);
}

// ---------- question: agentic search (see agent.js)
function runQuestion(s, ctx) { return agent.run(s, ctx, { emit, isLocal, today }); }

// Re-run a question with user-edited queries
function answerText(s) {
  const ev = (s.events || []).filter(e => e.type === 'answer-delta');
  return ev.map(e => e.text).join('');
}
function follow(sid, text, extra) {
  extra = extra || {};
  const old = sessions.get(sid);
  // the stored thread (survives restarts); the current turn is stored as soon as it finishes or is stopped
  if (old && !old.done) cancel(sid);
  if (old) saveTurn(old);
  const row = findThread(sid);
  const priorTurns = row && Array.isArray(row.turns) ? row.turns.slice() : (old ? [record(old)] : []);
  if (old && !priorTurns.some(t => t.sid === old.sid)) priorTurns.push(record(old));
  const threadId = old ? (old.threadId || old.sid) : (row ? row.id : null);
  const kind = extra.kind || (old && old.kindOverride === 'solve' ? 'solve' : null);
  return create(text, kind, Object.assign({ priorTurns, refs: (extra.refs || (old && old.refs) || []), images: (extra.images || []), threadId }, extra));
}
async function runTask(s) {
  // v3.0.0: the unified tool registry (every browser capability; each call is shown as a card in the chat)
  const ctx = { wcId: s.wcId, sid: s.sid, threadId: s.threadId || s.sid };
  if (await agent.runTask(s, ctx, { emit, isLocal, today })) return;
  // last resort for models that can not produce tool calls or JSON actions: the 2.x navigate / click / type / read loop
  const v36 = require('../v36/v36');
  const tabs = require('../tabs');
  const registry = require('./tools');
  emit(s, { type: 'status', text: v36.statusLabel('thinking') });
  const result = await v36.runTask({
    goal: s.input,
    onStatus: (st) => emit(s, { type: 'status', text: st.label }),
    ask: ({ goal, context }) => llm.completeJson([
      { role: 'system', content: 'You control the browser to finish the user goal. Reply with JSON only: {"action":"navigate"|"click"|"type"|"read"|"done","args":{},"summary":""}. Use done when the goal is complete. ' + v36.answerAddendum(store.getSettings().answerStyle) },
      ...(s.prior || []),
      { role: 'user', content: String(goal || '') + (context ? '\n' + context : '') }
    ], { signal: s.ac.signal, maxTokens: 500, temperature: 0.1 }),
    act: async (step) => {
      const args = step.args || {};
      emit(s, { type: 'tool', name: 'browser_' + (step.action || 'act'), args });
      if (step.action === 'navigate') { const t = tabs.activeTab(); if (!t) return { error: 'no tab' }; tabs.load(t, args.url); return { ok: true, url: args.url }; }
      if (step.action === 'click') return registry.call('browser_click', args, { wcId: s.wcId });
      if (step.action === 'type') return registry.call('browser_type', args, { wcId: s.wcId });
      if (step.action === 'read') { const t = tabs.activeTab(); if (!t) return { error: 'no tab' }; const text = await t.wc.executeJavaScript('document.body ? document.body.innerText : ""'); return { text: String(text).slice(0, 2000) }; }
      return { error: 'unknown action' };
    }
  });
  emit(s, { type: 'answer-delta', text: v36.redactToolTalk(result.summary || '') });
}
function rerun(sid, queries) {
  const old = sessions.get(sid);
  if (!old) return null;
  const nsid = create(old.input);
  const ns = sessions.get(nsid);
  ns.queriesOverride = queries.map(x => String(x).trim()).filter(Boolean).slice(0, 4);
  ns.kindOverride = 'question';
  return nsid;
}

module.exports = { create, attach, cancel, cancelForWebContents, rerun, follow, get, aiEntry, classify, thread };
