'use strict';
// Local mock servers for tests: OpenAI-compatible + Anthropic-format LLM API, a fake search engine,
// article pages, a download endpoint, and an extension update endpoint.
const http = require('http');

function sse(res) { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function chunks(text, n = 6) { const out = []; for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n)); return out; }

async function streamOpenAI(res, { text, toolCalls, delay = 25 }) {
  sse(res);
  const send = (delta, fin) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: fin || null }] }) + '\n\n');
  send({ role: 'assistant' });
  if (toolCalls) {
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      send({ tool_calls: [{ index: i, id: 'call_' + i, type: 'function', function: { name: tc.name, arguments: '' } }] });
      for (const c of chunks(JSON.stringify(tc.args), 12)) { send({ tool_calls: [{ index: i, function: { arguments: c } }] }); await sleep(5); }
    }
    send({}, 'tool_calls');
  } else {
    for (const c of chunks(text)) { send({ content: c }); await sleep(delay); }
    send({}, 'stop');
  }
  res.write('data: [DONE]\n\n'); res.end();
}

const SENT_JSON = {
  translation: '那只敏捷的棕色狐狸跳过了懒狗，就在河边附近。',
  tokens: [
    { text: 'The quick brown ', role: 'attr' }, { text: 'fox', role: 'subj' }, { text: ' ', role: 'other' }, { text: 'jumps', role: 'pred' }, { text: ' ', role: 'other' },
    { text: 'over', role: 'adv' }, { text: ' the lazy ', role: 'attr' }, { text: 'dog', role: 'obj' }, { text: ' ', role: 'other' }, { text: 'near the river', role: 'adv' }, { text: '.', role: 'other' }
  ],
  breakdown: [
    { role: 'subj', text: 'fox', note: '中心名词' }, { role: 'attr', text: 'The quick brown', note: '限定词+形容词，修饰 fox' }, { role: 'pred', text: 'jumps', note: '一般现在时' },
    { role: 'adv', text: 'over the lazy dog', note: '方向状语' }, { role: 'obj', text: 'dog', note: 'over 的宾语' }, { role: 'adv', text: 'near the river', note: '地点状语' }
  ]
};
const ENTRY_JSON = { word: 'serendipity', ipa_uk: '/ˌserənˈdɪpəti/', ipa_us: '/ˌserənˈdɪpəti/', pos: [{ pos: 'n.', defs: [{ zh: '意外发现珍奇事物的运气', en: 'a happy accident', ex_en: 'It was pure serendipity.', ex_zh: '纯属机缘巧合。' }] }], phrases: [{ en: 'by serendipity', zh: '凭机缘' }] };

function createLlmServer({ key = 'test-key' } = {}) {
  const requests = [];
  const state = { slow: 25 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/__requests') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(requests)); }
    if (req.method === 'POST' && url.pathname === '/__reset') { requests.length = 0; res.end('ok'); return; }
    let body = ''; for await (const c of req) body += c;
    let j = {}; try { j = JSON.parse(body); } catch {}
    if (req.method === 'GET' && /\/models$/.test(url.pathname)) {
      const a = req.headers['x-api-key'] || (req.headers.authorization || '').replace('Bearer ', '');
      requests.push({ path: url.pathname, auth: a, method: 'GET', anthropicVersion: req.headers['anthropic-version'] });
      if (a !== key) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } })); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: ['mock-1', 'mock-2-mini', 'gpt-4o-mini', 'embed-small'].map(id => ({ id, object: 'model' })) }));
    }
    const isAnth = url.pathname.endsWith('/v1/messages');
    const auth = isAnth ? req.headers['x-api-key'] : (req.headers.authorization || '').replace('Bearer ', '');
    requests.push({ path: url.pathname, auth, stream: j.stream, model: j.model, temperature: j.temperature, tools: (j.tools || []).map(t => t.function ? t.function.name : t.name), messages: j.messages, system: j.system });
    if (auth !== key) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } })); }
    if (!(url.pathname.endsWith('/chat/completions') || isAnth)) { res.writeHead(404); return res.end('nf'); }

    let msgs = j.messages || [];
    let system = isAnth ? (j.system || '') : (msgs.find(m => m.role === 'system') || {}).content || '';
    const userMsgs = msgs.filter(m => m.role === 'user');
    const lastUser = userMsgs.length ? (typeof userMsgs[userMsgs.length - 1].content === 'string' ? userMsgs[userMsgs.length - 1].content : JSON.stringify(userMsgs[userMsgs.length - 1].content)) : '';
    const question = /Web sources:/.test(lastUser) ? lastUser.split('Question:').pop() : lastUser;
    const hasToolResult = msgs.some(m => m.role === 'tool' || (Array.isArray(m.content) && m.content.some(c => c.type === 'tool_result')));
    let reply = { text: 'ok' };
    const scripted = state.script ? state.script({ msgs, system, lastUser, hasToolResult, tools: (j.tools || []).map(t => t.function ? t.function.name : t.name), toolMsgs: msgs.filter(m => m.role === 'tool') }) : null;
    if (scripted) reply = scripted;
    else if (/pong/.test(lastUser) && /single word/.test(lastUser)) reply = { text: 'pong' };
    else if (/web-research agent/.test(system)) {
      // Tool-calling agent: search -> open top pages -> answer; same ggb / echo tools as before
      const tools = (j.tools || []).map(t => t.function ? t.function.name : t.name);
      const toolMsgs = msgs.filter(m => m.role === 'tool' || (Array.isArray(m.content) && m.content.some(c => c.type === 'tool_result')));
      const toolTexts = toolMsgs.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      const lastTool = toolTexts[toolTexts.length - 1] || '';
      const q0 = lastUser;
      if (/画|plot|graph/i.test(q0) && tools.includes('ggb_eval') && !toolMsgs.length) reply = { toolCalls: [{ name: 'ggb_eval', args: { commands: ['f(x)=sin(x)', 'g(x)=x^2/4', 'A=Intersect(f,g,(0.5,0.5))', 'SetColor(f,"Blue")'] } }] };
      else if (/echo/i.test(q0) && tools.includes('sample_echo') && !toolMsgs.length) reply = { toolCalls: [{ name: 'sample_echo', args: { text: 'hello-tool' } }] };
      else if (/画|plot|graph|echo/i.test(q0) && toolMsgs.length) reply = { text: '已通过工具完成：f(x)=sin(x) 与 g(x)=x²/4 已绘制在右侧面板。' };
      else if (/hello|你好|hi$/i.test(q0.trim())) reply = { text: '你好！这是一个直接回答（没有搜索）。' };
      else if (!toolMsgs.length) reply = { toolCalls: [{ name: 'web_search', args: { query: q0 } }, { name: 'web_search', args: { query: q0 + ' 对比' } }] };
      else if (state.agentMode === 'refine' && toolMsgs.length === 1 && /"results":\[\]/.test(lastTool)) reply = { toolCalls: [{ name: 'web_search', args: { query: q0 + ' 简介' } }] };
      else if (/"results":\[\{/.test(lastTool) && !toolTexts.some(t => /"n":\d/.test(t))) {
        let urls = []; try { urls = JSON.parse(lastTool).results.map(r => r.url).slice(0, 3); } catch {}
        reply = urls.length ? { toolCalls: urls.map(u => ({ name: 'open_page', args: { url: u } })) } : { text: '没有找到相关来源。' };
      }
      else if (/"n":\d/.test(toolTexts.join(' '))) reply = { text: 'Apple 的 M1 采用 5nm 工艺，M2 为增强版 [1]。M2 的内存带宽更高 [2]。\n\n**总结**：M2 在 CPU/GPU 上均小幅提升 [1][2]。' };
      else reply = { text: '没有找到相关来源，以下为一般性回答。' };
    }
    else if (/search-query planner/.test(system)) {
      if (/画|plot|graph|sin/i.test(lastUser)) reply = { text: JSON.stringify({ direct: true, queries: [] }) };
      else if (/echo/i.test(lastUser)) reply = { text: JSON.stringify({ direct: true, queries: [] }) };
      else reply = { text: JSON.stringify({ direct: false, queries: ['apple m1 vs m2 comparison', 'apple m series chip differences'] }) };
    }
    else if (/grammar teacher/.test(system)) reply = { text: JSON.stringify(SENT_JSON) };
    else if (/learner's dictionary|bilingual English-Chinese dictionary|Worked example for input/.test(system)) {
      // Produce a real apple entry when asked; otherwise the generic serendipity fixture
      const w = (lastUser || 'serendipity').trim().split(/\s+/)[0].toLowerCase();
      if (w === 'apple') reply = { text: JSON.stringify({ word:'apple', ipa_uk:'', ipa_us:'', pos:[{pos:'n.',defs:[{zh:'苹果',en:'a round fruit with red, green or yellow skin',ex_en:'She ate an apple for breakfast.',ex_zh:'她早饭吃了一个苹果。'}]}], phrases:[{en:'apple pie',zh:'苹果派'},{en:'the apple of one\'s eye',zh:'掌上明珠'}] }) };
      else if (w === 'run') reply = { text: JSON.stringify({ word:'run', ipa_uk:'', ipa_us:'', pos:[{pos:'v.',defs:[{zh:'跑；奔跑',en:'to move quickly on foot',ex_en:'He runs every morning.',ex_zh:'他每天早上跑步。'}]},{pos:'n.',defs:[{zh:'跑步；奔跑',en:'an act of running',ex_en:'She went for a run.',ex_zh:'她去跑了跑步。'}]}], phrases:[{en:'run out of',zh:'用完'}] }) };
      else reply = { text: JSON.stringify(ENTRY_JSON) };
    }
    else if (/Translate the user text|翻译成流畅/.test(system)) reply = { text: '第一段的译文。\n\n第二段的译文，内容更长一些。\n\n第三段译文。' };
    else if (/feature extensions" for the AI Browser/.test(system)) {
      const manifest = { standard: 'aib-feature/1', id: 'user.ai-greeter', name: 'AI Greeter', version: '1.0.0', description: 'says hi', update_url: '', permissions: [], entry: 'main.js', contributes: { inputHandlers: [{ id: 'hi', types: ['word'], priority: 300 }], tools: [], panels: [] } };
      const main = "module.exports={inputHandlers:{hi:async function(i){ if(i.word.toLowerCase()==='ping') return {type:'markdown',text:'**pong from AI-written extension**'}; return null; }}};";
      reply = { text: JSON.stringify({ summary: '遇到单词 ping 时回复 pong', files: { 'manifest.json': JSON.stringify(manifest, null, 2), 'main.js': main } }) };
    }
    else if (/Chrome Manifest V3/.test(system)) {
      const manifest = { manifest_version: 3, name: 'AI Chrome Ext', version: '1.0', content_scripts: [{ matches: ['http://127.0.0.1/*', 'http://localhost/*'], js: ['content.js'] }] };
      reply = { text: JSON.stringify({ summary: 'marks pages', files: { 'manifest.json': JSON.stringify(manifest), 'content.js': "document.documentElement.setAttribute('data-ai-chrome-ext','yes');" } }) };
    }
    else if (/careful research assistant/.test(system)) {
      const tools = (j.tools || []).map(t => t.function ? t.function.name : t.name);
      if (/画|plot|graph/i.test(question) && tools.includes('ggb_eval') && !hasToolResult) {
        reply = { toolCalls: [{ name: 'ggb_eval', args: { commands: ['f(x)=sin(x)', 'g(x)=x^2/4', 'A=Intersect(f,g,(0.5,0.5))', 'SetColor(f,"Blue")'] } }] };
      } else if (/echo/i.test(question) && tools.includes('sample_echo') && !hasToolResult) {
        reply = { toolCalls: [{ name: 'sample_echo', args: { text: 'hello-tool' } }] };
      } else if (hasToolResult) {
        reply = { text: '已通过工具完成：f(x)=sin(x) 与 g(x)=x²/4 已绘制在右侧面板。' };
      } else if (/Web sources:/.test(lastUser)) {
        reply = { text: 'Apple 的 M1 采用 5nm 工艺，M2 为增强版 [1]。M2 的内存带宽更高 [2]。\n\n**总结**：M2 在 CPU/GPU 上均小幅提升 [1][2]。' };
      } else reply = { text: '这是一个直接回答（没有网页来源）。' };
    }
    const delay = state.slow;
    if (!j.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply.text || null } }] }));
    }
    if (isAnth) {
      sse(res);
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'm', role: 'assistant', content: [] } });
      if (reply.toolCalls) {
        reply.toolCalls.forEach((tc, i) => { ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: 'tu' + i, name: tc.name, input: {} } }); ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tc.args) } }); ev('content_block_stop', { index: i }); });
      } else {
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        for (const c of chunks(reply.text || '')) { ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: c } }); await sleep(delay); }
        ev('content_block_stop', { index: 0 });
      }
      ev('message_stop', {}); return res.end();
    }
    return streamOpenAI(res, { ...reply, delay });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, requests, state, key, close: () => new Promise(x => server.close(x)) })));
}

function articleHtml(i) {
  const body = Array.from({ length: 8 }, (_, k) => `<p>Paragraph ${k + 1} of article ${i}. The Apple M${i} chip uses an ARM based architecture with unified memory, performance cores and efficiency cores, and a Neural Engine for machine learning. Benchmarks show steady generational improvements in CPU, GPU and memory bandwidth.</p>`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Apple M${i} chip overview</title></head><body><nav>menu home about</nav><article><h1>Apple M${i} chip overview</h1>${body}</article><footer>footer</footer></body></html>`;
}

function createWebServer({ llm } = {}) {
  const hits = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push({ path: url.pathname, q: url.searchParams.get('q'), host: req.headers.host });
    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') || '';
      const port = server.address().port;
      const items = [1, 2, 3].map(i => `<div class="r"><h3><a href="http://127.0.0.1:${port}/page/${i}">Apple M${i} chip overview and comparison for ${q}</a></h3><p>snippet ${i}</p></div>`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><title>${q} - fake search</title><body><h1>Fake engine</h1>${items}</body>`);
    }
    if (url.pathname.startsWith('/page/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(articleHtml(url.pathname.split('/')[2])); }
    if (url.pathname === '/download.bin') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="test-file.bin"', 'Content-Length': 2048 }); return res.end(Buffer.alloc(2048, 7)); }
    if (url.pathname === '/slow.bin') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="slow-file.bin"', 'Content-Length': 6 * 1024 * 1024 });
      for (let i = 0; i < 24 && !res.destroyed; i++) { res.write(Buffer.alloc(256 * 1024, 3)); await new Promise(r => setTimeout(r, 400)); }
      return res.end();
    }
    if (url.pathname === '/words') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><title>Words page</title><body style="font-size:28px"><p>Please <span id="w">abandon</span> all hope. Find the needle here. Needle needle.</p><p id="plain">second paragraph needle</p></body>');
    }
    if (url.pathname === '/update.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(server.updateInfo || {})); }
    if (url.pathname === '/ext-v2.zip') { res.writeHead(200, { 'Content-Type': 'application/zip' }); return res.end(server.zip || Buffer.alloc(0)); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Local test page</title><body><h1>Hello test</h1><p>path ${url.pathname}</p></body>`);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, hits, close: () => new Promise(x => server.close(x)) })));
}

module.exports = { createLlmServer, createWebServer };
