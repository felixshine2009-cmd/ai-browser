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
  const ctx = { wcId: s.wcId, sid: s.sid };
  let cl = s.kindOverride ? { kind: s.kindOverride, word: s.input } : classify(s.input);
  if (cl.kind === 'word' && cl.phrase) {
    // multi-word candidate: only treat as dictionary phrase if a handler finds it
    const r = await features.runInputHandlers('word', { kind: 'word', word: cl.word, phrase: true }, ctx).catch(() => null);
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
const ENTRY_SYS = `You are a bilingual (English-Chinese) learner's dictionary. Reply with ONLY a JSON object:
{"word":"","ipa_uk":"","ipa_us":"","pos":[{"pos":"n.|v.|adj.|adv.|...","defs":[{"zh":"中文释义","en":"short English gloss","ex_en":"example sentence","ex_zh":"例句翻译"}]}],"phrases":[{"en":"","zh":""}]}
Give 1-3 parts of speech, 1-3 senses each, up to 4 phrases. No markdown.`;

async function aiEntry(word, signal) {
  const j = await llm.completeJson([{ role: 'system', content: ENTRY_SYS }, { role: 'user', content: word }], { signal });
  return j;
}

async function runWord(s, word, ctx) {
  const r = await features.runInputHandlers('word', { kind: 'word', word }, ctx);
  if (r) { emit(s, { type: 'handler-result', extId: r.extId, result: r.result, word }); return; }
  emit(s, { type: 'ai-entry-pending', word });
  const entry = await aiEntry(word, s.ac.signal);
  emit(s, { type: 'ai-entry', word, entry });
}

// ---------- sentence
const SENT_SYS = `You are an English grammar teacher for Chinese-speaking learners. Analyze the given English sentence.
Reply with ONLY a JSON object:
{"translation":"自然流畅的中文翻译",
 "tokens":[{"text":"...","role":"subj|pred|obj|attr|adv|comp|other"}],
 "breakdown":[{"role":"subj|pred|obj|attr|adv|comp","text":"成分原文","note":"中文简要说明"}]}
Rules: "tokens" must be consecutive chunks of the original sentence which, concatenated, reproduce it exactly (keep spaces/punctuation; punctuation uses role "other"). Roles: subj=主语, pred=谓语, obj=宾语, attr=定语, adv=状语, comp=补语/表语. Keep "breakdown" in reading order. No markdown.`;

async function runSentence(s) {
  const j = await llm.completeJson([{ role: 'system', content: SENT_SYS }, { role: 'user', content: s.input }], { signal: s.ac.signal });
  emit(s, { type: 'sentence', data: j });
}

// ---------- article
async function runArticle(s, target) {
  const paras = s.input.split(/\n\s*\n|\n/).map(x => x.trim()).filter(Boolean);
  emit(s, { type: 'article-src', paragraphs: paras, target });
  const sys = target === 'en'
    ? 'Translate the user text into fluent English. Output ONLY the translation. Keep the same paragraph structure: one translated paragraph per original paragraph, separated by a blank line. No commentary.'
    : '将用户给出的英文文章翻译成流畅自然的简体中文。只输出译文，不要任何解释；保持段落结构：每个原文段落对应一个译文段落，段落之间空一行。';
  await llm.chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: paras.join('\n\n') }], temperature: 0.2, signal: s.ac.signal,
    onDelta: t => emit(s, { type: 'translation-delta', text: t }) });
}

// ---------- question: agentic search
const PLAN_SYS = () => `You are a search-query planner. Today is ${today()}. Reply with ONLY JSON: {"direct":boolean,"queries":["..."]}.
direct=true when no web search is needed (maths, plotting/drawing functions or geometry, pure reasoning, translation, small talk) — then queries=[].
Otherwise give 1-3 concise, diverse search queries (any language) that together cover the question.`;

const ANSWER_SYS = () => `You are a careful research assistant inside a browser. Today is ${today()}.
- When numbered web sources are provided, base the answer on them and cite with [n] right after the claim (e.g. "... [1][3]"). Never invent sources or numbers; say so if the sources are insufficient.
- Answer in the same language as the user's question. Use concise Markdown (short paragraphs, **bold**, lists).
- When the user wants a function/graph/geometry drawn, call the ggb_eval tool with GeoGebra commands (e.g. "f(x)=sin(x)") instead of describing it, then explain the result briefly.`;

async function planQueries(question, signal) {
  try {
    const j = await llm.completeJson([{ role: 'system', content: PLAN_SYS() }, { role: 'user', content: question }], { signal, maxTokens: 300 });
    const qs = (Array.isArray(j.queries) ? j.queries : []).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
    return { direct: !!j.direct, queries: qs };
  } catch (e) {
    if (e.code === 'NO_CONFIG' || e.code === 'NO_LOCAL_MODEL' || signal.aborted) throw e;
    console.error('planner failed, using raw question:', e.message);
    return { direct: false, queries: [question.slice(0, 120)] };
  }
}

async function gatherSources(s, queries) {
  emit(s, { type: 'search-start', queries });
  const serps = await Promise.all(queries.map(q => search.serp(q).catch(() => ({ query: q, results: [], via: 'error' }))));
  const seen = new Set(); const merged = [];
  const maxLen = Math.max(...serps.map(x => x.results.length), 0);
  for (let i = 0; i < maxLen; i++) for (const sr of serps) { const r = sr.results[i]; if (r && !seen.has(r.url)) { seen.add(r.url); merged.push(r); } }
  const top = merged.slice(0, 6);
  emit(s, { type: 'serp', via: serps.map(x => x.via), count: merged.length });
  const pages = top.map((r, i) => ({ n: i + 1, url: r.url, title: r.title, site: search.siteOf(r.url), snippet: r.snippet, status: 'loading' }));
  emit(s, { type: 'pages', pages: pages.map(p => ({ ...p })) });
  await Promise.all(pages.map(async p => {
    try {
      const r = await search.readPage(p.url);
      if (r.text.length < 200 && !p.snippet) throw new Error('empty');
      p.text = r.text; p.title = r.title || p.title; p.status = 'ok';
    } catch (e) { p.status = 'fail'; p.text = ''; }
    emit(s, { type: 'page-update', n: p.n, status: p.status, title: p.title });
  }));
  // keep numbering stable for display but only feed readable pages (or snippets) to the model
  const usable = pages.filter(p => p.status === 'ok' || p.snippet);
  return usable;
}

async function runQuestion(s, ctx) {
  const q = s.input;
  let queries = s.queriesOverride;
  let direct = false;
  if (!queries) {
    const plan = await planQueries(q, s.ac.signal);
    direct = plan.direct; queries = plan.queries;
    if (!direct && !queries.length) queries = [q.slice(0, 120)];
  }
  emit(s, { type: 'queries', queries, direct });
  let sources = [];
  if (!direct && queries.length) sources = await gatherSources(s, queries);
  emit(s, { type: 'sources', sources: sources.map(p => ({ n: p.n, url: p.url, title: p.title, site: p.site })) });

  let userContent = q;
  if (sources.length) {
    userContent = 'Web sources:\n' + sources.map(p => `[${p.n}] ${p.title} (${p.url})\n${(p.text || p.snippet || '').slice(0, 3800)}`).join('\n\n') + `\n\nQuestion: ${q}`;
  }
  const messages = [{ role: 'system', content: ANSWER_SYS() }, { role: 'user', content: userContent }];
  const tools = store.getSettings().ai.source === 'local' ? [] : features.listTools().map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));

  for (let round = 0; round < 5; round++) {
    const r = await llm.chat({ messages, tools, signal: s.ac.signal, onDelta: t => emit(s, { type: 'answer-delta', text: t }) });
    if (!r.toolCalls.length) return;
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) });
    for (const tc of r.toolCalls) {
      let args = {}; try { args = JSON.parse(tc.arguments || '{}'); } catch {}
      let result;
      try { result = await features.callTool(tc.name, args, ctx); emit(s, { type: 'tool', name: tc.name, args, result }); }
      catch (e) { result = { error: String(e.message || e) }; emit(s, { type: 'tool', name: tc.name, args, error: result.error }); }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 4000) });
    }
  }
}

// Re-run a question with user-edited queries
function rerun(sid, queries) {
  const old = sessions.get(sid);
  if (!old) return null;
  const nsid = create(old.input);
  const ns = sessions.get(nsid);
  ns.queriesOverride = queries.map(x => String(x).trim()).filter(Boolean).slice(0, 3);
  ns.kindOverride = 'question';
  return nsid;
}

module.exports = { create, attach, cancel, cancelForWebContents, rerun, get, aiEntry, classify };
