'use strict';
// Mock servers for the model subsystem: a Hugging Face hub (search / repo files / resumable downloads),
// and local inference frameworks (Ollama native + OpenAI-compat, LM Studio / oMLX style OpenAI-only servers).
const http = require('http');
const crypto = require('crypto');

const listen = (srv) => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const body = (req) => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

// ---------------------------------------------------------------- Hugging Face
// repos: { 'acme/Tiny-Qwen3-GGUF': { tags, downloads, likes, files: { 'tiny-Q4_K_M.gguf': Buffer } } }
async function hfServer(repos, opts = {}) {
  const state = { requests: [], ranges: [], slowMs: 0, fail: null };
  for (const r of Object.values(repos)) for (const [f, buf] of Object.entries(r.files)) { r.meta = r.meta || {}; r.meta[f] = { size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') }; if (r.badSha && r.badSha === f) r.meta[f].sha256 = 'f'.repeat(64); }
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); state.requests.push(u.pathname + u.search);
    if (state.fail) { res.writeHead(state.fail); return res.end('fail'); }
    if (u.pathname === '/api/models') {
      const q = (u.searchParams.get('search') || '').toLowerCase(); const flt = u.searchParams.get('filter');
      const list = Object.entries(repos).filter(([id, r]) => id.toLowerCase().includes(q) && (!flt || (r.tags || []).includes(flt))).map(([id, r]) => ({ id, tags: r.tags || [], downloads: r.downloads || 0, likes: r.likes || 0 }));
      return json(res, 200, list);
    }
    let m = u.pathname.match(/^\/api\/models\/(.+)$/);
    if (m) { const r = repos[m[1]]; if (!r) return json(res, 404, { error: 'not found' });
      return json(res, 200, { id: m[1], tags: r.tags || [], downloads: r.downloads || 0, likes: r.likes || 0, siblings: Object.keys(r.files).map(f => ({ rfilename: f, size: r.meta[f].size, lfs: { sha256: r.meta[f].sha256, size: r.meta[f].size } })) }); }
    m = u.pathname.match(/^\/(.+?\/[^/]+)\/resolve\/main\/(.+)$/);
    if (m) {
      const r = repos[m[1]]; const f = decodeURIComponent(m[2]); const buf = r && r.files[f]; if (!buf) { res.writeHead(404); return res.end('nf'); }
      let start = 0; const rg = req.headers.range; if (rg) { const mm = rg.match(/bytes=(\d+)-/); start = mm ? Number(mm[1]) : 0; state.ranges.push(rg); }
      const part = buf.subarray(start);
      res.writeHead(rg ? 206 : 200, { 'Content-Length': part.length, 'Content-Type': 'application/octet-stream', ...(rg ? { 'Content-Range': `bytes ${start}-${buf.length - 1}/${buf.length}` } : {}) });
      const chunk = opts.chunk || 64 * 1024; let i = 0;
      const step = () => { if (res.destroyed) return; if (i >= part.length) return res.end(); res.write(part.subarray(i, i + chunk)); i += chunk; setTimeout(step, state.slowMs); };
      return step();
    }
    res.writeHead(404); res.end();
  });
  const port = await listen(srv);
  return { port, base: `http://127.0.0.1:${port}`, state, close: () => new Promise(r => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) };
}

// ---------------------------------------------------------------- local frameworks
// kind: 'ollama' (native + /v1) | 'openai' (LM Studio / oMLX / vLLM ...) ; opts: models[], tools:boolean, apiKey, owner, reply(msgs)=>string, embedDim
async function fwServer(kind, opts = {}) {
  const log = { chats: [], embeds: [], paths: [] };
  const models = opts.models || ['qwen3:4b'];
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); log.paths.push(req.method + ' ' + u.pathname);
    if (opts.apiKey && req.headers.authorization !== 'Bearer ' + opts.apiKey) return json(res, 401, { error: { message: 'invalid api key' } });
    if (kind === 'ollama' && u.pathname === '/api/tags') return json(res, 200, { models: models.map(n => ({ name: n, model: n, size: 2.5e9, details: { family: n.split(/[:-]/)[0], parameter_size: (n.match(/(\d+(?:\.\d+)?b)/i) || [])[1] || '', quantization_level: 'Q4_K_M' } })) });
    if (kind === 'ollama' && u.pathname === '/api/version') return json(res, 200, { version: '0.12.3' });
    if (kind === 'ollama' && u.pathname === '/api/embed') { const b = await body(req); log.embeds.push(b); const arr = [].concat(b.input); return json(res, 200, { model: b.model, embeddings: arr.map((t, i) => vec(t, opts.embedDim || 8)) }); }
    if (u.pathname === '/v1/models') return json(res, 200, { object: 'list', data: models.map(id => ({ id, object: 'model', owned_by: opts.owner || (kind === 'ollama' ? 'library' : 'organization_owner') })) });
    if (u.pathname === '/v1/embeddings') { const b = await body(req); log.embeds.push(b); const arr = [].concat(b.input); return json(res, 200, { data: arr.map((t, i) => ({ index: i, embedding: vec(t, opts.embedDim || 8) })) }); }
    if (u.pathname === '/v1/chat/completions') {
      const b = await body(req); log.chats.push(b);
      if (b.tools && b.tools.length && opts.tools === false) return json(res, 400, { error: { message: `${b.model} does not support tools` } });
      if (b.response_format && opts.structured === false) return json(res, 400, { error: { message: 'response_format json_schema is not supported' } });
      const out = opts.script ? opts.script(b) : { text: opts.reply ? opts.reply(b.messages) : 'ok from ' + (opts.name || kind) };
      if (b.stream === false) return json(res, 200, { choices: [{ message: { role: 'assistant', content: out.text || '' } }] });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (d) => res.write('data: ' + JSON.stringify(d) + '\n\n');
      if (out.toolCalls) out.toolCalls.forEach((c, i) => send({ choices: [{ delta: { tool_calls: [{ index: i, id: 'call_' + i, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }] } }] }));
      else { const t = out.text || ''; for (let i = 0; i < t.length; i += 6) send({ choices: [{ delta: { content: t.slice(i, i + 6) } }] }); }
      send({ choices: [{ delta: {}, finish_reason: out.toolCalls ? 'tool_calls' : 'stop' }] }); res.write('data: [DONE]\n\n'); return res.end();
    }
    res.writeHead(404); res.end('not found');
  });
  const port = await listen(srv);
  return { port, log, close: () => new Promise(r => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) };
}
function vec(t, n) { const v = new Array(n).fill(0); for (let i = 0; i < String(t).length; i++) v[i % n] += String(t).charCodeAt(i) % 7; return v; }

module.exports = { hfServer, fwServer, listen };
