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

const sessions = new Map();

function today() { return new Date().toISOString().slice(0, 10); }

function create(input, kindOverride) {
  const sid = crypto.randomBytes(6).toString('hex');
  const s = { sid, input, kindOverride: kindOverride || null, events: [], wcId: null, started: false, ac: new AbortController(), done: false };
  sessions.set(sid, s);
  if (sessions.size > 60) sessions.delete(sessions.keys().next().value);
  return sid;
}

function emit(s, ev) {
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
  s.done = true; emit(s, { type: 'done' });
}
function cancel(sid) { const s = sessions.get(sid); if (s) { s.ac.abort(); s.done = true; } }
function cancelForWebContents(wcId) { for (const s of sessions.values()) if (s.wcId === wcId && !s.done) s.ac.abort(); }
function get(sid) { return sessions.get(sid); }

async function run(s) {
  const onNotice = (text) => emit(s, { type: 'notice', text });
  llm.events.on('notice', onNotice);
  try { await run0(s); } finally { llm.events.off('notice', onNotice); }
}
async function run0(s) {
  const ctx = { wcId: s.wcId, sid: s.sid };
  let cl = s.kindOverride ? { kind: s.kindOverride, word: s.input } : classify(s.input);
  if (cl.kind === 'word' && cl.phrase) {
    // multi-word candidate: only treat as dictionary phrase if a handler finds it
    const r = await features.runInputHandlers('word', { kind: 'word', word: cl.word, phrase: true }, ctx).catch(e => translateFail(s, e));
    if (r) { emit(s, { type: 'kind', kind: 'word' }); emit(s, { type: 'handler-result', extId: r.extId, result: r.result, word: cl.word }); return finish(s); }
    cl = /\?|^(what|why|how|when|where|who|which)\b/i.test(cl.word) ? { kind: 'question' } : { kind: 'sentence' };
  }
  emit(s, { type: 'kind', kind: cl.kind });
  switch (cl.kind) {
    case 'word': await runWord(s, cl.word, ctx); break;
    case 'sentence': await runSentence(s, ctx); break;
    case 'article': await runArticle(s, cl.target || 'zh'); break;
    default: await runQuestion(s, ctx);
  }
  finish(s);
}
function finish(s) { if (s.done) return; s.done = true; emit(s, { type: 'done' }); }

// ---------- word
const isLocal = () => store.getSettings().ai.source === 'local';

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
function rerun(sid, queries) {
  const old = sessions.get(sid);
  if (!old) return null;
  const nsid = create(old.input);
  const ns = sessions.get(nsid);
  ns.queriesOverride = queries.map(x => String(x).trim()).filter(Boolean).slice(0, 4);
  ns.kindOverride = 'question';
  return nsid;
}

module.exports = { create, attach, cancel, cancelForWebContents, rerun, get, aiEntry, classify };
