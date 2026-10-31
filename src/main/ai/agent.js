'use strict';
// Agentic web search for Chat mode.
//
//  * API models (OpenAI-compatible tool calling / Anthropic tool_use): the model drives a loop with the tools
//      web_search(query, engine?)  -> results from the user's SELECTED search engine (fallback chain, relevance-filtered)
//      open_page(url)              -> readable text of a page; each opened page gets a citation number [n]
//    plus any extension tools (ggb_eval, …). Limits: 4 searches, 8 page opens, 90 s overall.
//  * Local models (no tool calling) and "re-run with edited queries": fixed pipeline
//      plan queries -> search with the selected engine -> read top pages -> answer.
//  Both paths stream the same chat events to the UI (queries / status / pages / page-update / sources / answer-delta / tool).
const llm = require('./llm');
const search = require('./search');
const features = require('../ext/features');
const store = require('../store');
const P = require('./prompts');

const LIMITS = { searches: 4, opens: 8, ms: 90000, rounds: 14 };
const ENGINE_IDS = ['bing', 'google', 'baidu', 'duckduckgo'];

const isEn = () => (store.getSettings().lang === 'en');
const L = (zh, en) => (isEn() ? en : zh);
function engineName(id) { return id === 'custom' ? L('自定义搜索', 'Custom search') : ((store.ENGINES[id] || {}).name || id); }
function selectedEngine() { try { return store.getSettings().search.engine || 'bing'; } catch { return 'bing'; } }

const WEB_TOOLS = [
  { name: 'web_search', description: 'Search the web with the user\'s selected search engine. Returns titles, URLs and snippets only — call open_page to read a result. Use short keyword queries; for Chinese topics query in Chinese, for technical topics also try English.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'search keywords' }, engine: { type: 'string', enum: ENGINE_IDS, description: 'optional; defaults to the user\'s selected engine' } }, required: ['query'] } },
  { name: 'open_page', description: 'Open a URL from the search results and read its main text. Returns {n,title,text}; cite the page as [n] in the answer.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }
];

// ------------------------------------------------------------------ shared page bookkeeping
function makeBoard(s, emit, local) {
  const pages = []; const byUrl = new Map();
  const maxChars = local ? 1400 : 5000;
  return {
    pages, byUrl,
    add(r) {
      if (byUrl.has(r.url)) return byUrl.get(r.url);
      const p = { n: pages.length + 1, url: r.url, title: r.title || r.url, site: search.siteOf(r.url), snippet: r.snippet || '', status: 'loading', text: '' };
      pages.push(p); byUrl.set(r.url, p);
      return p;
    },
    publish() { emit(s, { type: 'pages', pages: pages.map(p => ({ n: p.n, url: p.url, title: p.title, site: p.site, status: p.status, snippet: p.snippet })) }); },
    async read(p) {
      if (p.status === 'ok') return p;
      try {
        emit(s, { type: 'status', text: L('阅读：', 'Reading: ') + (p.title || p.url).slice(0, 60) });
        const r = await search.readPage(p.url, { maxChars });
        if (r.text.length < 200 && !p.snippet) throw new Error('empty');
        p.text = r.text || p.snippet; p.title = r.title || p.title; p.status = 'ok';
      } catch (e) { p.status = 'fail'; p.error = String(e.message || e).slice(0, 80); }
      emit(s, { type: 'page-update', n: p.n, status: p.status, title: p.title });
      return p;
    },
    sources() { return pages.filter(p => p.status === 'ok' || (p.status === 'fail' && p.snippet && false)); }
  };
}

async function doSearch(s, emit, q, engine, queries) {
  const sel = selectedEngine();
  const use = engine && ENGINE_IDS.includes(engine) ? engine : sel;
  emit(s, { type: 'status', text: L(`用 ${engineName(use)} 搜索：`, `Searching ${engineName(use)}: `) + q });
  if (!queries.includes(q)) { queries.push(q); emit(s, { type: 'queries', queries: queries.slice(), direct: false }); }
  const r = await search.serp(q, { engine: use });
  if (process.env.AIB_DEBUG_SEARCH) console.error('[serp]', q, JSON.stringify(r.tried));
  if (r.via !== use) {
    const bad = r.tried.filter(t => t.engine === use)[0];
    emit(s, { type: 'status', text: r.via === 'none'
      ? L(`${engineName(use)} 没有找到相关结果`, `${engineName(use)} returned nothing relevant`)
      : L(`${engineName(use)} ${bad && bad.error ? '不可用' : '没有相关结果'}，已改用 ${engineName(r.via)}`, `${engineName(use)} ${bad && bad.error ? 'unavailable' : 'had nothing relevant'}; using ${engineName(r.via)}`) });
  }
  emit(s, { type: 'serp', via: r.via, selected: use, tried: r.tried, count: r.results.length });
  return r;
}

// ------------------------------------------------------------------ fixed pipeline (local models / edited queries)
async function planQueries(D, question, signal) {
  try {
    const j = await llm.completeJson([{ role: 'system', content: P.planner({ date: D.today(), local: D.isLocal() }) }, { role: 'user', content: question }], { signal, maxTokens: 300 });
    let qs = (Array.isArray(j.queries) ? j.queries : []).map(x => String(x).trim()).filter(Boolean).slice(0, 4);
    if (!j.direct) { // original query always first (names!), model rewrites after
      const orig = question.trim().slice(0, 120);
      qs = [orig, ...qs.filter(x => x !== orig)].slice(0, 4);
    }
    return { direct: !!j.direct, queries: qs };
  } catch (e) {
    if (e.code === 'NO_CONFIG' || e.code === 'NO_LOCAL_MODEL' || signal.aborted) throw e;
    console.error('planner failed, using raw question:', e.message);
    return { direct: false, queries: [question.slice(0, 120)] };
  }
}

async function runPipeline(s, ctx, D, queries, direct) {
  const { emit, isLocal, today } = D;
  const q = s.input;
  const board = makeBoard(s, emit, isLocal());
  if (!queries) {
    emit(s, { type: 'status', text: L('正在规划搜索…', 'Planning the search…') });
    const plan = await planQueries(D, q, s.ac.signal);
    direct = plan.direct; queries = plan.queries;
    if (!direct && !queries.length) queries = [q.slice(0, 120)];
  }
  emit(s, { type: 'queries', queries, direct: !!direct });
  if (!direct && queries.length) {
    emit(s, { type: 'search-start', queries });
    const serps = await Promise.all(queries.map(x => doSearch(s, emit, x, null, queries.slice()).catch(() => ({ query: x, results: [], via: 'error' }))));
    const seen = new Set(); const merged = [];
    const maxLen = Math.max(...serps.map(x => x.results.length), 0);
    for (let i = 0; i < maxLen; i++) for (const sr of serps) { const r = sr.results[i]; if (r && !seen.has(r.url)) { seen.add(r.url); merged.push(r); } }
    merged.slice(0, isLocal() ? 4 : 6).forEach(r => board.add(r));
    board.publish();
    await Promise.all(board.pages.map(p => board.read(p)));
  }
  const sources = board.pages.filter(p => p.status === 'ok' || p.snippet);
  emit(s, { type: 'sources', sources: sources.map(p => ({ n: p.n, url: p.url, title: p.title, site: p.site })) });
  emit(s, { type: 'status', text: L('正在生成回答…', 'Writing the answer…') });
  let userContent = q;
  if (sources.length) userContent = 'Web sources:\n' + sources.map(p => `[${p.n}] ${p.title} (${p.url})\n${(p.text || p.snippet || '').slice(0, isLocal() ? 1400 : 3800)}`).join('\n\n') + `\n\nQuestion: ${q}`;
  else if (!direct && queries.length) userContent = q + '\n\n(Note: web search found no relevant pages; say so briefly, then answer from general knowledge and mark it as such.)';
  const messages = [{ role: 'system', content: P.answer({ date: today(), local: isLocal() }) }, { role: 'user', content: userContent }];
  const tools = store.getSettings().ai.source === 'local' ? [] : features.listTools().map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
  await answerLoop(s, ctx, D, messages, tools, () => null);
}

// chat <-> extension-tool loop shared by both paths. `extra(name,args)` may handle additional tools; returns undefined if not its tool.
async function answerLoop(s, ctx, D, messages, tools, extra, maxRounds = 5) {
  const { emit } = D;
  for (let round = 0; round < maxRounds; round++) {
    const r = await llm.chat({ messages, tools, signal: s.ac.signal, onDelta: t => emit(s, { type: 'answer-delta', text: t }) });
    if (!r.toolCalls.length) return;
    if (r.content) emit(s, { type: 'answer-reset' });
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) });
    for (const tc of r.toolCalls) {
      let args = {}; try { args = JSON.parse(tc.arguments || '{}'); } catch {}
      let result;
      try {
        const x = await extra(tc.name, args);
        if (x !== undefined && x !== null) result = x;
        else { result = await features.callTool(tc.name, args, ctx); emit(s, { type: 'tool', name: tc.name, args, result }); }
      } catch (e) { result = { error: String(e.message || e) }; emit(s, { type: 'tool', name: tc.name, args, error: result.error }); }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 7000) });
    }
  }
}

// ------------------------------------------------------------------ the agent
async function runAgent(s, ctx, D) {
  const { emit, today } = D;
  const q = s.input;
  const board = makeBoard(s, emit, false);
  const queries = []; const used = { searches: 0, opens: 0 }; const t0 = Date.now(); const titles = new Map();
  const left = () => used.searches < LIMITS.searches || used.opens < LIMITS.opens;
  const timeUp = () => Date.now() - t0 > LIMITS.ms;
  const extTools = features.listTools().map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const messages = [{ role: 'system', content: P.agent({ date: today(), engine: engineName(selectedEngine()), limits: LIMITS }) }, { role: 'user', content: q }];
  emit(s, { type: 'status', text: L('思考中…', 'Thinking…') });
  emit(s, { type: 'queries', queries: [], direct: false });

  const handle = async (name, args) => {
    if (name === 'web_search') {
      if (used.searches >= LIMITS.searches || timeUp()) return { error: `search limit reached (${LIMITS.searches}); answer now using the pages you have opened` };
      const query = String(args.query || '').trim().slice(0, 160);
      if (!query) return { error: 'query is required' };
      used.searches++;
      const r = await doSearch(s, emit, query, args.engine, queries);
      r.results.forEach(x => titles.set(x.url, x.title));
      const res = r.results.slice(0, 8).map(x => ({ title: x.title, url: x.url, snippet: x.snippet.slice(0, 200) }));
      return res.length ? { engine: r.via, results: res }
        : { engine: r.via, results: [], note: 'No relevant results from any engine. Try a different, shorter query (other language, name + 简介/profile, etc.) or answer that nothing was found.' };
    }
    if (name === 'open_page') {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return { error: 'url must start with http(s)://' };
      if (board.byUrl.has(url) && board.byUrl.get(url).status === 'ok') { const p = board.byUrl.get(url); return { n: p.n, title: p.title, url, text: p.text.slice(0, 5000) }; }
      if (used.opens >= LIMITS.opens || timeUp()) return { error: `page limit reached (${LIMITS.opens}); answer now` };
      used.opens++;
      const p = board.add({ url, title: titles.get(url) || url });
      board.publish();
      await board.read(p);
      if (p.status !== 'ok') return { error: 'could not read this page (' + (p.error || 'failed') + '); try another result' };
      return { n: p.n, title: p.title, url, text: p.text };
    }
    return undefined;
  };

  let toolsOn = true; let nudged = false;
  for (let round = 0; round < LIMITS.rounds; round++) {
    const out = timeUp() || !left();
    if (out && !nudged) { nudged = true; messages.push({ role: 'user', content: '(Budget used up — write the final answer now from the pages you opened. Cite only [n] of opened pages.)' }); }
    const tools = (out ? [] : WEB_TOOLS).concat(extTools);
    let r;
    try { r = await llm.chat({ messages, tools, signal: s.ac.signal, onDelta: t => emit(s, { type: 'answer-delta', text: t }) }); }
    catch (e) {
      if (round === 0 && !s.ac.signal.aborted && /tool|function/i.test(String(e.message)) && !/401|403|429/.test(String(e.message))) { const err = new Error('TOOLS_UNSUPPORTED'); err.code = 'TOOLS_UNSUPPORTED'; throw err; }
      throw e;
    }
    if (!r.toolCalls.length) break;
    if (r.content) emit(s, { type: 'answer-reset' });
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) });
    // run web tools of one round concurrently, keep order
    const results = await Promise.all(r.toolCalls.map(async tc => {
      let args = {}; try { args = JSON.parse(tc.arguments || '{}'); } catch {}
      try {
        const x = await handle(tc.name, args);
        if (x !== undefined) return x;
        const res = await features.callTool(tc.name, args, ctx); emit(s, { type: 'tool', name: tc.name, args, result: res }); return res;
      } catch (e) { emit(s, { type: 'tool', name: tc.name, args, error: String(e.message || e) }); return { error: String(e.message || e) }; }
    }));
    r.toolCalls.forEach((tc, i) => messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(results[i]).slice(0, 7000) }));
    emit(s, { type: 'sources', sources: board.pages.filter(p => p.status === 'ok').map(p => ({ n: p.n, url: p.url, title: p.title, site: p.site })) });
    emit(s, { type: 'status', text: L('正在整理回答…', 'Writing the answer…') });
  }
  if (!used.searches) emit(s, { type: 'queries', queries: [], direct: true });
  emit(s, { type: 'sources', sources: board.pages.filter(p => p.status === 'ok').map(p => ({ n: p.n, url: p.url, title: p.title, site: p.site })) });
}

// entry used by chat.js
async function run(s, ctx, D) {
  const local = D.isLocal();
  if (s.queriesOverride) return runPipeline(s, ctx, D, s.queriesOverride, false);
  if (local) return runPipeline(s, ctx, D, null, false);
  try { return await runAgent(s, ctx, D); }
  catch (e) {
    if (e.code !== 'TOOLS_UNSUPPORTED') throw e;
    return runPipeline(s, ctx, D, null, false); // API without tool calling → fixed pipeline with the same engine
  }
}

module.exports = { run, runAgent, runPipeline, planQueries, WEB_TOOLS, LIMITS };
