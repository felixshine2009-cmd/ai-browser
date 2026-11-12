'use strict';
// Unified LLM interface: OpenAI-compatible (SSE + tool calling), Anthropic, local (node-llama-cpp).
// All network calls happen in the main process. API keys are never logged.
const store = require('../store');

const PRESETS = require('../v36/v36').API_PROVIDERS;

let local = null; // lazy: ./local
function getLocal() { if (!local) local = require('./local'); return local; }

function joinUrl(base, p) { return base.replace(/\/+$/, '') + p; }

// ---------- readable, localized error reasons (used by 测试连接 and by chat-time failures)
const API_TIMEOUT = () => Number(process.env.AIB_API_TIMEOUT_MS) || 15000; // test hook
const lang = () => (store.getSettings().lang === 'en' ? 'en' : 'zh');
const L = (zh, en) => (lang() === 'en' ? en : zh);
function maskSecrets(text, key) {
  let t = String(text == null ? '' : text);
  if (key && key.length > 4) t = t.split(key).join('***');
  return t.replace(/\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|[A-Za-z0-9_-]{32,})\b/g, m => (/^[a-z]+$/i.test(m) ? m : '***'));
}
function serverMessage(body) {
  if (!body) return '';
  let m = String(body).trim();
  try { const j = JSON.parse(m); m = (j.error && (j.error.message || j.error.msg || (typeof j.error === 'string' ? j.error : ''))) || j.message || j.msg || j.detail || m; if (typeof m !== 'string') m = JSON.stringify(m); } catch {}
  return m.replace(/\s+/g, ' ').slice(0, 200);
}
function validateBase(baseUrl) {
  let u; try { u = new URL(String(baseUrl || '').trim()); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol) || !u.hostname) {
    const e = new Error(L('Base URL 格式无效：请填写以 http:// 或 https:// 开头的完整地址，例如 https://api.openai.com/v1', 'Invalid Base URL: use a full address starting with http:// or https://, e.g. https://api.openai.com/v1'));
    e.apiCode = 'invalid_url'; throw e;
  }
  return u;
}
// Turn any thrown error (network / HTTP / parse) into an Error whose message is a clear, localized reason.
function friendly(e, key, baseUrl) {
  if (e && e.friendly) return e;
  let host = ''; try { host = new URL(baseUrl).host; } catch {}
  const cause = (e && e.cause) || {};
  const code = String(cause.code || e.code || '');
  const msg = String(e && e.message || e);
  let apiCode = 'unknown', text;
  if (e && e.apiCode === 'invalid_url' && !e.status) { e.friendly = true; return e; }
  if (e && e.status) {
    const st = e.status, sm = maskSecrets(serverMessage(e.body), key);
    const tail = sm ? ` — ${sm}` : '';
    if (st === 401 || st === 403) { apiCode = 'auth'; text = L(`HTTP ${st}：API Key 无效、已过期或没有权限${tail}`, `HTTP ${st}: API key is invalid, expired or not authorized${tail}`); }
    else if (st === 404) { apiCode = 'notfound'; text = L(`HTTP 404：接口路径不存在。请检查 Base URL：多数 OpenAI 兼容服务需以 /v1 结尾（已含 /v1 时请尝试去掉）；模型名错误也会返回 404${tail}`, `HTTP 404: endpoint not found. Check the Base URL — most OpenAI-compatible services need it to end with /v1 (if it already does, try removing it); a wrong model name can also give 404${tail}`); }
    else if (st === 429) { apiCode = 'ratelimit'; text = L(`HTTP 429：请求过于频繁，或额度/配额已用尽${tail}`, `HTTP 429: rate limited or quota exhausted${tail}`); }
    else if (st >= 500) { apiCode = 'server'; text = L(`HTTP ${st}：服务器内部错误，请稍后重试${tail}`, `HTTP ${st}: server error, try again later${tail}`); }
    else { apiCode = 'http'; text = L(`HTTP ${st}：请求被服务器拒绝${tail}`, `HTTP ${st}: request rejected by the server${tail}`); }
  } else if (e && e.apiCode === 'badformat') {
    apiCode = 'badformat'; text = L(`返回内容不是预期的格式（应为 OpenAI 兼容的 JSON）：${maskSecrets(e.snippet || msg, key).slice(0, 120)}。请确认 Base URL 指向 API 而不是网页，以及接口格式（OpenAI / Anthropic）选择正确`, `Unexpected response format (expected OpenAI-compatible JSON): ${maskSecrets(e.snippet || msg, key).slice(0, 120)}. Make sure the Base URL points to the API (not a web page) and the API format (OpenAI / Anthropic) is right`);
  } else if (e && (e.name === 'TimeoutError' || /timed? ?out|UND_ERR_(HEADERS|CONNECT|BODY)_TIMEOUT|ETIMEDOUT/i.test(code + msg))) {
    apiCode = 'timeout'; const sec = e.timeoutSec || 15;
    text = L(`请求超时（${sec} 秒）：服务器无响应，请检查网络、代理或稍后重试`, `Request timed out (${sec} s): the server did not respond. Check your network/proxy or try again later`);
  } else if (/ENOTFOUND|EAI_AGAIN/.test(code)) {
    apiCode = 'dns'; text = L(`无法解析域名 ${host}（DNS 失败）：请检查网址拼写与网络连接`, `Cannot resolve host ${host} (DNS failure): check the URL spelling and your network`);
  } else if (/ECONNREFUSED/.test(code)) {
    apiCode = 'refused'; text = L(`连接被拒绝（${host}）：服务未启动或端口错误`, `Connection refused (${host}): the service is not running or the port is wrong`);
  } else if (/CERT|SSL|TLS|ALTNAME|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code + msg)) {
    apiCode = 'tls'; text = L(`TLS/证书错误（${code || 'TLS'}）：证书无效、过期或为自签名；请检查网址（http/https）与系统时间`, `TLS/certificate error (${code || 'TLS'}): invalid, expired or self-signed certificate; check the URL (http/https) and your system clock`);
  } else if (/ENETUNREACH|EHOSTUNREACH|ECONNRESET|EPIPE|EADDRNOTAVAIL|UND_ERR_SOCKET|fetch failed/.test(code + msg)) {
    apiCode = 'unreachable'; text = L(`网络不可达或连接中断（${code || 'network'}）：请检查网络、代理或防火墙（${host}）`, `Network unreachable or connection dropped (${code || 'network'}): check your network, proxy or firewall (${host})`);
  } else if (/Invalid URL|ERR_INVALID_URL/i.test(code + msg)) {
    apiCode = 'invalid_url'; text = L('Base URL 格式无效：请填写以 http:// 或 https:// 开头的完整地址', 'Invalid Base URL: use a full http:// or https:// address');
  } else text = maskSecrets(msg, key).slice(0, 300);
  const err = new Error(text);
  err.apiCode = apiCode; err.status = e && e.status; err.friendly = true;
  if (e && e.code && !e.status) err.code = e.code;
  return err;
}

async function* sseLines(res, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    if (signal?.aborted) { try { reader.cancel(); } catch {} return; }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(buf[i] === '\r' ? i + 2 : i + 1);
      yield line;
    }
  }
  if (buf.trim()) yield buf;
}

async function httpError(res) {
  let body = '';
  try { body = (await res.text()).slice(0, 400); } catch {}
  const e = new Error(`HTTP ${res.status} ${res.statusText}${body ? ' — ' + body : ''}`);
  e.status = res.status; e.body = body;
  return e;
}

// ---------- OpenAI-compatible
async function chatOpenAI(cfg, key, { messages, tools, temperature, onDelta, signal, maxTokens, jsonSchema, onThinking, thinkingLevel }) {
  const body = { model: cfg.model, messages, stream: true, temperature: temperature ?? cfg.temperature };
  try {
    const level = thinkingLevel || require('../store').getSettings().thinkingLevel;
    const v36 = require('../v36/v36');
    if (level) Object.assign(body, v36.reasoningFields(level, { provider: cfg.preset, preset: cfg.preset, model: cfg.model, baseUrl: cfg.baseUrl, format: cfg.format, caps: cfg.caps || modelCaps(cfg.preset, cfg.model) }));
  } catch {}
  if (jsonSchema && cfg._structured !== false) body.response_format = { type: 'json_schema', json_schema: { name: 'action', schema: jsonSchema } };
  if (maxTokens) body.max_tokens = maxTokens;
  if (tools && tools.length) { body.tools = tools.map(t => ({ type: 'function', function: t })); body.tool_choice = 'auto'; }
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  const res = await fetch(joinUrl(cfg.baseUrl, '/chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw await httpError(res);
  let content = '';
  const calls = [];
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('event-stream')) { // server ignored stream:true
    const raw = await res.text();
    let j; try { j = JSON.parse(raw); } catch { const e = new Error('not json'); e.apiCode = 'badformat'; e.snippet = raw.replace(/\s+/g, ' ').slice(0, 120); throw e; }
    if (!j || !Array.isArray(j.choices)) { const e = new Error('no choices'); e.apiCode = 'badformat'; e.snippet = raw.replace(/\s+/g, ' ').slice(0, 120); throw e; }
    const m = j.choices?.[0]?.message || {};
    if (m.content) { content = m.content; onDelta && onDelta(content); }
    for (const tc of m.tool_calls || []) calls.push({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments || '{}' });
    return { content, toolCalls: calls };
  }
  for await (const line of sseLines(res, signal)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') break;
    let j; try { j = JSON.parse(data); } catch { continue; }
    const d = j.choices?.[0]?.delta;
    if (!d) continue;
    let thinkBit = '';
    try { thinkBit = require('../v36/v36').extractThinkingDelta(d) || require('../v36/v36').extractThinkingDelta(j); } catch { thinkBit = d.reasoning_content || (typeof d.reasoning === 'string' ? d.reasoning : ''); }
    if (thinkBit) onThinking && onThinking(thinkBit);
    if (d.content) { content += d.content; onDelta && onDelta(d.content); }
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? 0;
      calls[i] = calls[i] || { id: '', name: '', arguments: '' };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function?.name) calls[i].name += tc.function.name;
      if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
    }
  }
  return { content, toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || 'call_' + i, arguments: c.arguments || '{}' })) };
}

// ---------- images in tool results (computer-use screenshots)
// A tool message may carry `images: [dataUrl]` (internal field). Only the newest KEEP_IMAGES are sent; older ones and
// models without vision get a short text note. OpenAI-style APIs cannot put images in tool messages, so they follow the
// block of tool results as one user message.
const KEEP_IMAGES = 2;
function anthropicImage(url) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(String(url || ''));
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}
function prepImages(messages, { vision, format }) {
  if (!messages.some(m => m && m.role === 'tool' && m.images && m.images.length)) return messages;
  let left = vision ? KEEP_IMAGES : 0;
  const keep = new Set();
  for (let i = messages.length - 1; i >= 0; i--) { const m = messages[i]; if (m && m.role === 'tool' && m.images && m.images.length && left > 0) { keep.add(i); left--; } }
  const note = vision ? '\n(an older screenshot was omitted)' : '\n(screenshot not shown: the current model cannot see images; rely on the text results)';
  const out = [];
  let pending = [];
  const flush = () => { if (pending.length) { out.push({ role: 'user', content: [{ type: 'text', text: 'Screenshot from the tool result above (pixel coordinates match the screen):' }].concat(pending.map(u => ({ type: 'image_url', image_url: { url: u } }))) }); pending = []; } };
  messages.forEach((m, i) => {
    if (!m || m.role !== 'tool' || !m.images) { if (!(m && m.role === 'tool')) flush(); out.push(m); return; }
    const { images, ...rest } = m;
    if (!images.length) { out.push(rest); return; }
    if (!keep.has(i)) { out.push({ ...rest, content: String(rest.content) + note }); return; }
    if (format === 'anthropic') out.push({ ...rest, images });
    else { out.push(rest); pending.push(...images); }
  });
  flush();
  return out;
}
const stripImages = (messages) => prepImages(messages, { vision: false });

// ---------- Anthropic
function toAnthropic(messages) {
  let system = '';
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') { system += (system ? '\n' : '') + m.content; continue; }
    if (m.role === 'tool') {
      const imgs = (m.images || []).map(anthropicImage).filter(Boolean);
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: imgs.length ? [{ type: 'text', text: String(m.content) }].concat(imgs) : String(m.content) }] });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        let input = {}; try { input = JSON.parse(tc.function.arguments || '{}'); } catch {}
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
      out.push({ role: 'assistant', content: blocks });
    } else if (Array.isArray(m.content)) {
      out.push({ role: m.role, content: m.content.map(p => (p && p.type === 'image_url' ? anthropicImage(p.image_url && p.image_url.url) : p)).filter(Boolean) });
    } else out.push({ role: m.role, content: m.content });
  }
  return { system, messages: out };
}
async function chatAnthropic(cfg, key, { messages, tools, temperature, onDelta, signal, maxTokens, onThinking, thinkingLevel }) {
  const { system, messages: ms } = toAnthropic(messages);
  const body = { model: cfg.model, max_tokens: maxTokens || 4096, stream: true, messages: ms };
  let think = {};
  try {
    const level = thinkingLevel || require('../store').getSettings().thinkingLevel;
    think = require('../v36/v36').reasoningFields(level, { provider: 'anthropic', model: cfg.model, baseUrl: cfg.baseUrl, format: 'anthropic', caps: cfg.caps || modelCaps(cfg.preset, cfg.model) }) || {};
  } catch {}
  if (think && Object.keys(think).length) {
    Object.assign(body, think);
    // Extended thinking rejects non-default sampling; adaptive thinking does likewise on current models.
    if (think.thinking) {
      if (think.thinking.type === 'enabled') body.temperature = 1;
    }
  } else {
    body.temperature = temperature ?? cfg.temperature;
  }
  if (system) body.system = system;
  if (tools?.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const base = cfg.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  const res = await fetch(base + '/v1/messages', {
    method: 'POST', signal, body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  });
  if (!res.ok) throw await httpError(res);
  let content = '';
  const calls = {};
  for await (const line of sseLines(res, signal)) {
    if (!line.startsWith('data:')) continue;
    let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
    if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') calls[j.index] = { id: j.content_block.id, name: j.content_block.name, arguments: '' };
    else if (j.type === 'content_block_delta') {
      if (j.delta.type === 'thinking_delta') {
        const bit = j.delta.thinking || j.delta.text || '';
        if (bit) onThinking && onThinking(bit);
      } else if (j.delta.type === 'text_delta') { content += j.delta.text; onDelta && onDelta(j.delta.text); }
      else if (j.delta.type === 'input_json_delta' && calls[j.index]) calls[j.index].arguments += j.delta.partial_json;
    }
  }
  return { content, toolCalls: Object.values(calls).map(c => ({ ...c, arguments: c.arguments || '{}' })) };
}

// Per-conversation model override: chat.js runs a session inside withModel({provider, model}, fn);
// every llm.chat() call made while that session runs (agent steps, tools, follow-ups) uses the override.
const { AsyncLocalStorage } = require('async_hooks');
const modelScope = new AsyncLocalStorage();
function withModel(ref, fn) { return ref && ref.provider && ref.model ? modelScope.run({ ref }, fn) : fn(); }
function overrideRef() { const s = modelScope.getStore(); return s ? s.ref : null; }
function modelCaps(pid, model) {
  try { return require('./model-catalog').capsOf(pid || 'custom', model, store.getSettings().ai.providers || {}); } catch { return null; }
}
function currentConfig() {
  const s = store.getSettings().ai;
  const ref = overrideRef();
  if (ref && ref.provider === 'local') return { source: 'local', api: s.api, local: { ...s.local, roles: { ...(s.local.roles || {}), chat: ref.model } }, override: ref };
  if (ref && (s.providers || {})[ref.provider]) {
    const p = s.providers[ref.provider];
    const def = PRESETS[ref.provider] || {};
    return { source: 'api', api: { ...s.api, preset: ref.provider, format: p.format || def.format || 'openai', baseUrl: p.baseUrl || def.baseUrl || '', model: ref.model }, local: s.local, key: store.getProviderKey(ref.provider), override: ref };
  }
  return { source: s.source, api: s.api, local: s.local };
}
function activeSource() { return currentConfig().source; }
// {provider, model, label} of the model that the current scope will use
function activeModel() {
  const c = currentConfig();
  if (c.source === 'local') {
    const target = roleOf(c, 'chat') || '';
    return { provider: 'local', model: target || (c.local.modelId || ''), label: localLabel(target || c.local.modelId || c.local.modelPath || '') };
  }
  const pid = c.api.preset || 'custom';
  return { provider: pid, model: c.api.model, label: ((PRESETS[pid] || {}).name || pid) + ' · ' + c.api.model };
}
function localLabel(target) {
  const t = String(target || '');
  const fw = t.match(/^fw:([^:]+):(.+)$/); if (fw) return fw[1] + ' · ' + fw[2];
  const m = t.match(/^(mlx|llama):(.+)$/);
  let name = m ? m[2] : t.split(/[\\/]/).pop();
  try { const e = m && getLocal().findEntry(m[2]); if (e && e.name) name = e.name; } catch {}
  return (lang() === 'en' ? 'Local · ' : '本地 · ') + (name || (lang() === 'en' ? 'model' : '模型'));
}

/**
 * chat({messages, tools?, temperature?, onDelta?, signal?})
 * -> {content, toolCalls:[{id,name,arguments}]}
 */
const { EventEmitter } = require('events');
const events = new EventEmitter(); // 'notice' (text) — e.g. MLX failed, falling back to llama.cpp

// role -> target. roles: chat | dictionary | translate | embedding. 'fw:<id>:<model>' | 'mlx:<modelId>' | 'llama:<modelId>' | ''
function roleOf(c, role) { const r = (c.local && c.local.roles) || {}; return (role && role !== 'chat' && r[role]) || r.chat || ''; }
function hasRole(role) { try { return !!((store.getSettings().ai.local.roles || {})[role]); } catch { return false; } }

async function chatLocalRouted(c, opts) {
  const target = roleOf(c, opts.role);
  const L = (zh, en) => (store.getSettings().lang === 'en' ? en : zh);
  const fwT = require('./frameworks').parseRole(target);
  if (fwT) {
    const api = require('./frameworks').resolve(fwT.fw, fwT.model);
    const fwKey = (require('./frameworks').targets().find(x => x.id === fwT.fw) || {}).apiKey || '';
    try { return await chatOpenAI(api, fwKey, opts); }
    catch (e) {
      // servers without native tools / structured output: retry once without them (agent falls back to its JSON action loop)
      const msg = String(e && e.message);
      if ((opts.jsonSchema) && /response_format|json_schema|grammar|schema|400/i.test(msg)) return chatOpenAI({ ...api, _structured: false }, fwKey, opts);
      if (opts.signal && opts.signal.aborted) throw e;
      if (opts.tools && opts.tools.length && /tool|function/i.test(msg)) { const err = new Error('TOOLS_UNSUPPORTED'); err.code = 'TOOLS_UNSUPPORTED'; throw err; }
      throw friendly(e, fwKey, api.baseUrl);
    }
  }
  const mm = String(target).match(/^mlx:(.+)$/);
  if (mm) {
    const loc = getLocal(); const entry = loc.findEntry(mm[1]);
    try {
      if (!entry || !loc.haveEntry(entry)) throw new Error(L('MLX 模型尚未下载', 'MLX model is not downloaded yet'));
      const mlx = require('./mlx');
      const srv = await mlx.acquire(loc.modelPathOf(entry), { key: opts.role === 'translate' ? 'translate' : 'chat', idleMs: opts.role === 'translate' ? 150000 : 600000 });
      try { return await chatOpenAI({ baseUrl: srv.baseUrl, model: loc.modelPathOf(entry), temperature: 0.3 }, '', opts); } finally { srv.release(); }
    } catch (e) {
      if (opts.signal && opts.signal.aborted) throw e;
      // graceful fallback: a downloaded GGUF of the same family (or the legacy selected GGUF)
      const all = loc.listModels(c.local);
      const fb = (entry && all.find(x => x.engine === 'llama' && x.downloaded && x.family === entry.family && !(x.tags || []).includes('translate') && !(x.tags || []).includes('embedding'))) || all.find(x => x.path === c.local.modelPath && x.downloaded);
      const fbPath = fb ? fb.path : (c.local.modelPath && require('fs').existsSync(c.local.modelPath) ? c.local.modelPath : '');
      if (!fbPath) throw Object.assign(new Error(L('MLX 引擎不可用：', 'MLX engine unavailable: ') + e.message), { code: 'NO_LOCAL_MODEL' });
      events.emit('notice', L(`MLX 无法启动（${e.message}），已改用 llama.cpp`, `MLX could not start (${e.message}); using llama.cpp instead`));
      return loc.chat({ ...c.local, modelPath: fbPath }, opts);
    }
  }
  const lm = String(target).match(/^llama:(.+)$/);
  if (lm) { const loc = getLocal(); const entry = loc.findEntry(lm[1]); if (entry) return loc.chat({ ...c.local, modelPath: loc.modelPathOf(entry), modelId: entry.id }, opts); }
  return getLocal().chat(opts._localOverride || c.local, opts);
}

async function chat(opts) {
  const c = currentConfig();
  if (c.source === 'local') return chatLocalRouted(c, opts.messages ? { ...opts, messages: stripImages(opts.messages) } : opts);
  if (opts.messages) {
    const caps = modelCaps(c.api.preset, c.api.model);
    opts = { ...opts, messages: prepImages(opts.messages, { vision: !(caps && caps.vision === false), format: c.api.format }) };
  }
  if (!c.api.baseUrl || !c.api.model) throw Object.assign(new Error('API 未配置：请在 设置 → AI 模型 中填写 Base URL 与模型'), { code: 'NO_CONFIG' });
  const key = c.override ? c.key : store.getApiKey();
  const fn = c.api.format === 'anthropic' ? chatAnthropic : chatOpenAI;
  try { validateBase(c.api.baseUrl); return await fn(c.api, key, opts); }
  catch (e) { if (opts.signal && opts.signal.aborted) throw e; throw friendly(e, key, c.api.baseUrl); }
}

async function complete(messages, opts = {}) {
  const r = await chat({ messages, ...opts });
  return r.content;
}

function extractJson(text) {
  if (!text) throw new Error('empty response');
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch {}
  const a = t.search(/[\[{]/);
  if (a >= 0) {
    const open = t[a], close = open === '{' ? '}' : ']';
    const b = t.lastIndexOf(close);
    if (b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  }
  throw new Error('模型返回的不是有效 JSON');
}
async function completeJson(messages, opts = {}) {
  const txt = await complete(messages, { temperature: 0.1, ...opts });
  return extractJson(txt);
}

// ---------- model list (OpenAI GET {base}/models, Anthropic GET /v1/models)
function parseModels(j) {
  const arr = Array.isArray(j) ? j : Array.isArray(j && j.data) ? j.data : Array.isArray(j && j.models) ? j.models : null;
  if (!arr) { const e = new Error('no model array'); e.apiCode = 'badformat'; e.snippet = JSON.stringify(j).slice(0, 120); throw e; }
  const ids = arr.map(m => (typeof m === 'string' ? m : (m && (m.id || m.name || m.model)) || '')).filter(Boolean).map(String);
  return Array.from(new Set(ids)).sort((x, y) => x.localeCompare(y)).slice(0, 1000);
}
async function getJson(url, headers, timeoutMs) {
  let res;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' }); }
  catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError' || /timed? ?out|TimeoutError|AbortError/i.test(String(e && e.message)))) {
      const err = new Error(e.message || 'timeout'); err.name = 'TimeoutError'; err.timeoutSec = Math.round(timeoutMs / 1000); err.cause = e; throw err;
    }
    throw e;
  }
  if (!res.ok) throw await httpError(res);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { const e = new Error('not json'); e.apiCode = 'badformat'; e.snippet = txt.replace(/\s+/g, ' ').slice(0, 120); throw e; }
}
async function fetchModels(cfg, key, timeoutMs = 15000) {
  let base = String(cfg.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|models|messages)$/, '');
  validateBase(base);
  if (cfg.format === 'anthropic') {
    const b = base.replace(/\/v1$/, '');
    const j = await getJson(b + '/v1/models?limit=1000', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeoutMs);
    return { models: parseModels(j), baseUrl: base };
  }
  const headers = key ? { Authorization: 'Bearer ' + key } : {};
  const tries = [base];
  if (/\/v\d+$/.test(base)) tries.push(base.replace(/\/v\d+$/, '')); else tries.push(base + '/v1');
  let firstErr = null;
  for (const b of tries) {
    try { const j = await getJson(b + '/models', headers, timeoutMs); return { models: parseModels(j), baseUrl: b }; }
    catch (e) { firstErr = firstErr || e; if (!(e.status === 404 || e.status === 405)) throw e; }
  }
  throw firstErr;
}

async function testConnection(override) {
  // override: full api config from the settings form (key '' => use stored)
  const cur = store.getSettings().ai.api;
  const cfg = { ...cur, ...(override || {}) };
  const key = override && override.apiKey ? override.apiKey : store.getApiKey();
  const t0 = Date.now();
  const out = (o) => ({ ms: Date.now() - t0, ...o });
  try { validateBase(cfg.baseUrl); } catch (e) { return out({ ok: false, code: e.apiCode, error: e.message }); }
  let modelsErr = null;
  try {
    const r = await fetchModels(cfg, key, API_TIMEOUT());
    const has = !!cfg.model && r.models.includes(cfg.model);
    return out({ ok: true, via: 'models', models: r.models, count: r.models.length, baseUrl: r.baseUrl, modelFound: has });
  } catch (e) { modelsErr = e; }
  // The /models call failed. Auth / network / rate-limit errors are final; otherwise the service may simply not offer /models,
  // so fall back to a minimal chat completion.
  const final = modelsErr.status === 401 || modelsErr.status === 403 || modelsErr.status === 429 || (modelsErr.status >= 500) ||
    (!modelsErr.status && modelsErr.apiCode !== 'badformat');
  if (final) { const f = friendly(modelsErr, key, cfg.baseUrl); return out({ ok: false, code: f.apiCode, status: f.status, error: f.message }); }
  if (!cfg.model) { const f = friendly(modelsErr, key, cfg.baseUrl); return out({ ok: false, code: f.apiCode, status: f.status, error: f.message + L('（且未填写模型名，无法用对话接口测试）', ' (and no model name is set, so the chat endpoint could not be tested)') }); }
  try {
    const fn = cfg.format === 'anthropic' ? chatAnthropic : chatOpenAI;
    const signal = AbortSignal.timeout(API_TIMEOUT() + 5000);
    const r = await fn(cfg, key, { messages: [{ role: 'user', content: 'Reply with the single word: pong' }], maxTokens: 16, temperature: 0, signal });
    return out({ ok: true, via: 'chat', models: [], count: 0, chatOnly: true, sample: (r.content || '').slice(0, 60),
      note: L('该服务不支持获取模型列表，但对话接口可用（请手动填写模型名）', 'This service does not provide a model list, but the chat endpoint works (type the model name manually)') });
  } catch (e) {
    if (e && e.name !== 'TimeoutError' && /timed? ?out|TimeoutError|AbortError/i.test(String(e && (e.name+' '+e.message)))) {
      const err = new Error(e.message || 'timeout'); err.name = 'TimeoutError'; err.timeoutSec = Math.round((API_TIMEOUT() + 5000) / 1000); e = err;
    } else if (e && e.name === 'TimeoutError' && !e.timeoutSec) e.timeoutSec = Math.round((API_TIMEOUT() + 5000) / 1000);
    const f = friendly(e, key, cfg.baseUrl);
    return out({ ok: false, code: f.apiCode, status: f.status, error: f.message });
  }
}

module.exports = { prepImages, toAnthropic, withModel, activeSource, activeModel, modelCaps, localLabel, chat, complete, completeJson, events, hasRole, roleOf, extractJson, testConnection, fetchModels, friendly, maskSecrets, PRESETS };
