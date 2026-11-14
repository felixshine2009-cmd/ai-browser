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
const registry = require('./tools');
const store = require('../store');
const P = require('./prompts');
const v36 = require('../v36/v36');

const LIMITS = { searches: 4, opens: 8, ms: 90000, rounds: 14, steps: 12 }; // steps = max tool calls of any kind (settings.agent.maxSteps)
const maxSteps = () => { try { return Math.max(2, Math.min(30, Number(store.getSettings().agent.maxSteps) || LIMITS.steps)); } catch { return LIMITS.steps; } };
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
  let partition; try { const t = require('../tabs').allTabs().find(x => x.wc.id === s.wcId); if (t && t.incognito) partition = 'aib-incognito'; } catch {}
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
        const r = await search.readPage(p.url, { maxChars, partition });
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
  let partition; try { const t = require('../tabs').allTabs().find(x => x.wc.id === s.wcId); if (t && t.incognito) partition = 'aib-incognito'; } catch {}
  const r = await search.serp(q, { engine: use, partition }); // private chats search through the private session
  if (process.env.AIB_DEBUG_SEARCH) console.error('[serp]', q, JSON.stringify(r.tried));
  if (r.via !== use) {
    const bad = r.tried.filter(t => t.engine === use)[0];
    emit(s, { type: 'status', text: r.via === 'none'
      ? L(`${engineName(use)} 没有找到相关结果`, `${engineName(use)} returned nothing relevant`)
      : L(`${engineName(use)} ${bad && bad.error ? '不可用' : '没有相关结果'}，已改用 ${engineName(r.via)}`, `${engineName(use)} ${bad && bad.error ? 'unavailable' : 'had nothing relevant'}; using ${engineName(r.via)}`) });
  }
  emit(s, { type: 'serp', via: r.via, selected: use, tried: r.tried, count: r.results.length });
  try {
    const hits = (await require('../v36/extra-tools').wikiSearch(q)).slice(0, 3);
    if (hits.length) {
      r.wiki = hits.map(h => ({ title: h.title, text: String(h.text).slice(0, 500) }));
      emit(s, { type: 'wiki', query: q, hits: r.wiki });
    }
  } catch {}
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
    if (v36.route(q).kind === 'search') direct = false;
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
  const messages = [{ role: 'system', content: P.answer({ date: today(), local: isLocal() }) + '\n' + v36.answerAddendum(store.getSettings().answerStyle) }, ...(s.prior || []), { role: 'user', content: userContent }];
  const tools = llm.activeSource() === 'local' ? [] : registry.all({ web: false }).map(registry.def);
  await answerLoop(s, ctx, D, messages, tools, () => null);
}

// Run ONE registry tool with UI trace events (tool-step run/ok/error) and uniform error handling.
let stepSeq = 0;
const COMPUTE = /^(python_|vm_)/;
const stepAborts = new Map(); // step id -> AbortController (per-tool stop button)
function stopStep(id) { const ac = stepAborts.get(Number(id)); if (ac) { ac.abort(); return true; } return false; }
async function runTool(s, emit, name, args, ctx) {
  const id = ++stepSeq;
  const ac = new AbortController(); stepAborts.set(id, ac);
  const onParent = () => ac.abort(); if (s.ac) { if (s.ac.signal.aborted) ac.abort(); else s.ac.signal.addEventListener('abort', onParent); }
  ctx = Object.assign({}, ctx || {}, { emit: (ev) => emit(s, ev), signal: ac.signal, stepId: id, threadId: s.threadId || s.sid, sid: s.sid });
  s._solveStep = (s._solveStep || 0) + 1;
  const solve = v36.route(s.input).kind === 'solve' || s.kindOverride === 'solve';
  emit(s, { type: 'status', text: solve ? v36.statusLabel('thinking', { solve: true, step: s._solveStep }) : v36.statusLabel('tool') });
  emit(s, Object.assign({ type: 'tool-step', id, name, label: registry.summarize(name, args), status: 'run' }, COMPUTE.test(name) ? { args, stoppable: true } : {}));
  const t0 = Date.now();
  try {
    const result = await registry.call(name, args, ctx);
    emit(s, { type: 'tool-step', id, name, label: registry.summarize(name, args, result), status: 'ok', ms: Date.now() - t0 });
    emit(s, { type: 'tool', id, name, args, result: slimForUi(result) });
    if (ac.signal.aborted && !s.ac.signal.aborted && result && typeof result === 'object') result.stoppedByUser = true;
    return result;
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    emit(s, { type: 'tool-step', id, name, label: registry.summarize(name, args, { error: msg }), status: 'error', error: msg, ms: Date.now() - t0 });
    emit(s, { type: 'tool', id, name, args, error: msg });
    return { error: msg };
  } finally { stepAborts.delete(id); if (s.ac) s.ac.signal.removeEventListener('abort', onParent); }
}
// big base64 blobs (png exports) must not be replayed through every chat event
function slimForUi(r) {
  if (r && r.modelImages) { r = Object.assign({}, r); delete r.modelImages; }
  try {
    const j = JSON.stringify(r); if (j.length < 60000) return r;
    // figures / images are the point of python_run & vm_read_file: keep them (bounded), clip the rest
    if (r && Array.isArray(r.images) && j.length < 12e6) return Object.assign({}, r, { stdout: clipS(r.stdout, 40000), stderr: clipS(r.stderr, 20000), text: clipS(r.text, 40000) });
    return { note: 'large result omitted', size: j.length };
  } catch { return r; }
}
const clipS = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v);
// data: URLs (PNG figures) are shown to the user, never sent back to the model
function forModel(r) {
  const j = JSON.stringify(r, (k, v) => (typeof v === 'string' && v.startsWith('data:') && v.length > 200 ? '[image shown to the user]' : (k === 'base64' && typeof v === 'string' && v.length > 6000 ? v.slice(0, 6000) + '…' : v)));
  const cap = r && (r.stdout != null || r.exitCode != null) ? 16000 : 7000;
  return j && j.length > cap ? j.slice(0, cap) + '…' : j;
}

// computer-use screenshots (result.modelImages) travel with the tool message; llm.js decides what the model may see
function toolMsg(id, result) {
  const m = { role: 'tool', tool_call_id: id, content: forModel(result && result.modelImages ? Object.assign({}, result, { modelImages: undefined, images: undefined, screenshot: 'attached' }) : result) };
  if (result && Array.isArray(result.modelImages) && result.modelImages.length) m.images = result.modelImages.slice(0, 2);
  return m;
}
// chat <-> tool loop shared by both paths. `extra(name,args)` may handle additional tools; returns undefined if not its tool.
async function answerLoop(s, ctx, D, messages, tools, extra, maxRounds = 5) {
  const { emit } = D;
  for (let round = 0; round < maxRounds; round++) {
    const r = await llm.chat({ messages, tools, signal: s.ac.signal, onDelta: t => emit(s, { type: 'answer-delta', text: t }) });
    if (!r.toolCalls.length) return;
    if (r.content) emit(s, { type: 'answer-reset' });
    messages.push({ role: 'assistant', content: r.content || null, reasoning: r.reasoning || '', thinkingBlocks: r.thinkingBlocks || [], tool_calls: r.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) });
    for (const tc of r.toolCalls) {
      let args = {}; try { args = JSON.parse(tc.arguments || '{}'); } catch {}
      let result;
      const x = await extra(tc.name, args).catch(e => ({ error: String(e.message || e) }));
      if (x !== undefined && x !== null) result = x; else result = await runTool(s, emit, tc.name, args, ctx);
      messages.push(toolMsg(tc.id, result));
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
  const extTools = registry.all({ web: false }).map(registry.def); let stepsUsed = 0; const stepCap = maxSteps();
  const add = v36.answerAddendum(store.getSettings().answerStyle);
  const bias = v36.route(q).kind === 'search' ? '\nDefault: call web_search before answering, unless the user asked for a specific tool such as drawing a graph.' : '';
  const messages = [{ role: 'system', content: P.agent({ date: today(), engine: engineName(selectedEngine()), limits: LIMITS }) + '\n' + add + bias }];
  for (const m of s.prior || []) messages.push(m);
  if (s.refs && s.refs.length) messages.push({ role: 'user', content: v36.solverContext({ refs: s.refs, turns: [] }) });
  if (s.images && s.images.length && String(s.images[0].dataUrl || '').length < 400000) {
    messages.push({ role: 'user', content: [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: s.images[0].dataUrl } }] });
  } else messages.push({ role: 'user', content: q + (s.images && s.images.length ? '\n（已附上题目图片）' : '') });
  const solve = v36.route(q).kind === 'solve' || s.kindOverride === 'solve';
  emit(s, { type: 'status', text: v36.statusLabel('thinking', { solve }) });
  emit(s, { type: 'queries', queries: [], direct: false });

  const handle = async (name, args) => {
    if (name === 'web_search') {
      stepsUsed++;
      if (used.searches >= LIMITS.searches || timeUp()) return { error: `search limit reached (${LIMITS.searches}); answer now using the pages you have opened` };
      const query = String(args.query || '').trim().slice(0, 160);
      if (!query) return { error: 'query is required' };
      used.searches++;
      const r = await doSearch(s, emit, query, args.engine, queries);
      r.results.forEach(x => titles.set(x.url, x.title));
      const res = r.results.slice(0, 8).map(x => ({ title: x.title, url: x.url, snippet: x.snippet.slice(0, 200) }));
      return res.length ? { engine: r.via, results: res, wiki: r.wiki || [] }
        : { engine: r.via, results: [], note: 'No relevant results from any engine. Try a different, shorter query (other language, name + 简介/profile, etc.) or answer that nothing was found.' };
    }
    if (name === 'open_page') {
      stepsUsed++;
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

  let toolsOn = true; let nudged = false; let computeUsed = false;
  for (let round = 0; round < LIMITS.rounds + (computeUsed ? 30 : 0); round++) {
    const out = (timeUp() && (used.searches || used.opens) && !computeUsed) || !left();
    const stepsOut = stepsUsed >= stepCap + (computeUsed ? 28 : 0);
    if (out && !nudged) { nudged = true; messages.push({ role: 'user', content: '(Budget used up — write the final answer now from the pages you opened. Cite only [n] of opened pages.)' }); }
    if (stepsOut && !nudged) { nudged = true; messages.push({ role: 'user', content: '(Tool-step limit reached — write the final answer now from what you have.)' }); }
    const tools = stepsOut ? [] : (out ? [] : WEB_TOOLS).concat(extTools);
    let r;
    try { r = await llm.chat({ messages, tools, signal: s.ac.signal, onDelta: t => emit(s, { type: 'answer-delta', text: t }), onThinking: t => emit(s, { type: 'thinking', text: t }) }); }
    catch (e) {
      if (round === 0 && !s.ac.signal.aborted && /tool|function/i.test(String(e.message)) && !/401|403|429/.test(String(e.message))) { const err = new Error('TOOLS_UNSUPPORTED'); err.code = 'TOOLS_UNSUPPORTED'; throw err; }
      throw e;
    }
    if (!r.toolCalls.length) break;
    if (r.content) emit(s, { type: 'answer-reset' });
    messages.push({ role: 'assistant', content: r.content || null, reasoning: r.reasoning || '', thinkingBlocks: r.thinkingBlocks || [], tool_calls: r.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })) });
    // run web tools of one round concurrently, keep order
    const results = await Promise.all(r.toolCalls.map(async tc => {
      let args = {}; try { args = JSON.parse(tc.arguments || '{}'); } catch {}
      try {
        const x = await handle(tc.name, args);
        if (x !== undefined) return x;
        stepsUsed++; if (COMPUTE.test(tc.name)) computeUsed = true;
        return await runTool(s, emit, tc.name, args, ctx);
      } catch (e) { return { error: String(e.message || e) }; }
    }));
    r.toolCalls.forEach((tc, i) => messages.push(toolMsg(tc.id, results[i])));
    emit(s, { type: 'sources', sources: board.pages.filter(p => p.status === 'ok').map(p => ({ n: p.n, url: p.url, title: p.title, site: p.site })) });
    emit(s, { type: 'status', text: L('正在整理回答…', 'Writing the answer…') });
  }
  if (!used.searches) emit(s, { type: 'queries', queries: [], direct: true });
  emit(s, { type: 'sources', sources: board.pages.filter(p => p.status === 'ok').map(p => ({ n: p.n, url: p.url, title: p.title, site: p.site })) });
}

// ------------------------------------------------------------------ local models: grammar-constrained JSON action loop
// Small local models cannot do native function calling. When the question looks like it needs a (non-web) tool we run a
// short loop: the model emits ONE JSON action {tool,args} (llama.cpp grammar guarantees valid JSON that matches a tool
// schema), we run it, feed the result back, and finish with a normal streamed answer. Returns false when no tool applies.
const TOOL_HINT = /画|绘|函数|图像|图形|作图|几何|物理|模拟|仿真|受力|抛物|单摆|电路|折射|标签页|隐身|无痕|打开|关闭|切换|历史|设置|扩展|拓展|词典|翻译|语法|知识库|笔记|打印|plot|graph|draw|geogebra|physics|simulat|projectile|pendulum|circuit|tab\b|incognito|private|open |close |history|setting|extension|dictionar|translate|grammar|knowledge|notes?\b|print/i;
function actionSchema(defs) {
  return { anyOf: defs.map(d => ({ type: 'object', properties: { tool: { const: d.name }, args: d.parameters && d.parameters.properties && Object.keys(d.parameters.properties).length ? d.parameters : { type: 'object', properties: {} } }, required: ['tool', 'args'] })).concat([{ type: 'object', properties: { tool: { const: 'answer' } }, required: ['tool'] }]) };
}
async function runLocalTools(s, ctx, D, maxSteps = 4) {
  const { emit, today } = D;
  const defs = registry.all({ web: false }).map(registry.def);
  if (!defs.length || !TOOL_HINT.test(s.input)) return false;
  const catalog = defs.map(d => `- ${d.name}(${Object.keys((d.parameters && d.parameters.properties) || {}).join(', ')}): ${String(d.description).split(/(?<=[.。])\s/)[0].slice(0, 160)}`).join('\n');
  const sys = `You are the tool router of an AI browser. Today: ${today()}.\nTools:\n${catalog}\n\nReply with ONE JSON object: {"tool":"<name>","args":{...}} to call a tool, or {"tool":"answer"} when no (more) tool is needed. Use a tool only when the user's request needs it (draw/plot → GeoGebra, physics problem → physics tools, browser actions, translation, dictionary, notes). Otherwise {"tool":"answer"}.`;
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: s.input }];
  const schema = actionSchema(defs); const done = [];
  for (let i = 0; i < maxSteps; i++) {
    let act;
    try { act = await llm.completeJson(msgs, { signal: s.ac.signal, maxTokens: 600, temperature: 0.1, jsonSchema: schema }); } catch (e) { if (s.ac.signal.aborted) throw e; break; }
    if (!act || act.tool === 'answer' || !defs.some(d => d.name === act.tool)) break;
    const result = await runTool(s, emit, act.tool, act.args || {}, ctx);
    done.push({ tool: act.tool, args: act.args, result });
    msgs.push({ role: 'assistant', content: JSON.stringify(act) });
    msgs.push({ role: 'user', content: 'Tool result: ' + forModel(result) + '\nNext action (JSON)?' });
  }
  if (!done.length) return false;
  emit(s, { type: 'queries', queries: [], direct: true });
  emit(s, { type: 'sources', sources: [] });
  emit(s, { type: 'status', text: L('正在生成回答…', 'Writing the answer…') });
  const ans = [{ role: 'system', content: P.answer({ date: today(), local: true }) + '\n' + v36.answerAddendum(store.getSettings().answerStyle) }, { role: 'user', content: s.input + '\n\n(Tools already executed for this request, results:\n' + done.map(d => `${d.tool}(${JSON.stringify(d.args)}) -> ${forModel(d.result).slice(0, 900)}`).join('\n') + '\nBriefly tell the user what was done / the result. Do not name the tools inside the answer. Do not claim anything the results do not show.)' }];
  await llm.chat({ messages: ans, signal: s.ac.signal, onDelta: t => emit(s, { type: 'answer-delta', text: t }) });
  return true;
}

// entry used by chat.js
async function run(s, ctx, D) {
  const local = D.isLocal();
  if (s.queriesOverride) return runPipeline(s, ctx, D, s.queriesOverride, false);
  // local frameworks (LM Studio / Ollama / oMLX / vLLM …) usually support native tool calling → use the full agent first
  const fwChat = local && /^fw:/.test(String(llm.activeModel().model || ''));
  if (local && !fwChat) {
    if (await runLocalTools(s, ctx, D).catch(e => { if (s.ac.signal.aborted) throw e; console.error('local tool loop failed:', e && e.message); return false; })) return;
    return runPipeline(s, ctx, D, null, false);
  }
  try { return await runAgent(s, ctx, D); }
  catch (e) {
    if (e.code !== 'TOOLS_UNSUPPORTED') throw e;
    // no native tools: grammar/JSON action loop first (same registry), then the fixed search pipeline
    if (await runLocalTools(s, ctx, D).catch(() => false)) return;
    return runPipeline(s, ctx, D, null, false);
  }
}

module.exports = { stopStep, forModel, toolMsg, slimForUi, run, runAgent, runPipeline, runLocalTools, runTool, planQueries, WEB_TOOLS, LIMITS };
