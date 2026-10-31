'use strict';
// Unified LLM interface: OpenAI-compatible (SSE + tool calling), Anthropic, local (node-llama-cpp).
// All network calls happen in the main process. API keys are never logged.
const store = require('../store');

const PRESETS = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', format: 'openai' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', format: 'openai' },
  qwen: { name: '通义千问 (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', format: 'openai' },
  zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', format: 'openai' },
  moonshot: { name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', format: 'openai' },
  siliconflow: { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', format: 'openai' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', format: 'openai' },
  ollama: { name: 'Ollama (本机)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', format: 'openai' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', format: 'anthropic' },
  custom: { name: '自定义', baseUrl: '', model: '', format: 'openai' }
};

let local = null; // lazy: ./local
function getLocal() { if (!local) local = require('./local'); return local; }

function joinUrl(base, p) { return base.replace(/\/+$/, '') + p; }

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
  e.status = res.status;
  return e;
}

// ---------- OpenAI-compatible
async function chatOpenAI(cfg, key, { messages, tools, temperature, onDelta, signal, maxTokens }) {
  const body = { model: cfg.model, messages, stream: true, temperature: temperature ?? cfg.temperature };
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
    const j = await res.json();
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

// ---------- Anthropic
function toAnthropic(messages) {
  let system = '';
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') { system += (system ? '\n' : '') + m.content; continue; }
    if (m.role === 'tool') {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content) }] });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        let input = {}; try { input = JSON.parse(tc.function.arguments || '{}'); } catch {}
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
      }
      out.push({ role: 'assistant', content: blocks });
    } else out.push({ role: m.role, content: m.content });
  }
  return { system, messages: out };
}
async function chatAnthropic(cfg, key, { messages, tools, temperature, onDelta, signal, maxTokens }) {
  const { system, messages: ms } = toAnthropic(messages);
  const body = { model: cfg.model, max_tokens: maxTokens || 4096, stream: true, temperature: temperature ?? cfg.temperature, messages: ms };
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
      if (j.delta.type === 'text_delta') { content += j.delta.text; onDelta && onDelta(j.delta.text); }
      else if (j.delta.type === 'input_json_delta' && calls[j.index]) calls[j.index].arguments += j.delta.partial_json;
    }
  }
  return { content, toolCalls: Object.values(calls).map(c => ({ ...c, arguments: c.arguments || '{}' })) };
}

function currentConfig() {
  const s = store.getSettings().ai;
  return { source: s.source, api: s.api, local: s.local };
}

/**
 * chat({messages, tools?, temperature?, onDelta?, signal?})
 * -> {content, toolCalls:[{id,name,arguments}]}
 */
async function chat(opts) {
  const c = currentConfig();
  if (c.source === 'local') {
    return getLocal().chat(c.local, opts);
  }
  if (!c.api.baseUrl || !c.api.model) throw Object.assign(new Error('API 未配置：请在 设置 → AI 模型 中填写 Base URL 与模型'), { code: 'NO_CONFIG' });
  const key = store.getApiKey();
  const fn = c.api.format === 'anthropic' ? chatAnthropic : chatOpenAI;
  return fn(c.api, key, opts);
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

async function testConnection(override) {
  // override: full api config from the settings form (key '' => use stored)
  const cur = store.getSettings().ai.api;
  const cfg = { ...cur, ...(override || {}) };
  const key = override && override.apiKey ? override.apiKey : store.getApiKey();
  const t0 = Date.now();
  try {
    const fn = cfg.format === 'anthropic' ? chatAnthropic : chatOpenAI;
    const r = await fn(cfg, key, { messages: [{ role: 'user', content: 'Reply with the single word: pong' }], maxTokens: 16, temperature: 0 });
    return { ok: true, ms: Date.now() - t0, sample: (r.content || '').slice(0, 60) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).replace(key || '\u0000', '***').slice(0, 300) };
  }
}

module.exports = { chat, complete, completeJson, extractJson, testConnection, PRESETS };
