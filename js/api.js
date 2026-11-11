// OpenAI-compatible chat client. All user-entered values are normalised on use.
export function cleanKey(k){ return String(k||'').replace(/[\s\u200b-\u200f\u202a-\u202e\u2060\ufeff]+/g,''); }
export function cleanText(s){ return String(s||'').replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g,'').trim(); }
export function cleanBase(b){
  let u = cleanText(b).replace(/\s+/g,'');
  u = u.replace(/\/+$/,'');
  u = u.replace(/\/chat\/completions$/i,'').replace(/\/+$/,'');
  return u;
}
export function endpoint(baseUrl){ return cleanBase(baseUrl) + '/chat/completions'; }

function reasonFor(status, body){
  const detail = (body||'').slice(0,160).replace(/\s+/g,' ');
  if (status === 401) return `API Key 无效或已失效 / Invalid API key (HTTP 401)${detail?': '+detail:''}`;
  if (status === 403) return `没有权限或区域受限 / Forbidden (HTTP 403)${detail?': '+detail:''}`;
  if (status === 404) return `接口地址或模型名不对 / Wrong base URL or model (HTTP 404)${detail?': '+detail:''}`;
  if (status === 402) return `余额不足 / Insufficient balance (HTTP 402)${detail?': '+detail:''}`;
  if (status === 429) return `请求过多或额度用尽 / Rate limited (HTTP 429)${detail?': '+detail:''}`;
  if (status >= 500) return `服务端错误 / Server error (HTTP ${status})${detail?': '+detail:''}`;
  return `HTTP ${status}${detail?': '+detail:''}`;
}

function thinkingParams(thinkingLevel, ctx){
  if (!thinkingLevel || typeof window === 'undefined' || !window.AIB36) return {};
  const think = window.AIB36.reasoningFields(thinkingLevel, ctx) || {};
  delete think.interrupt;
  return think;
}

function extractThink(piece){
  if (typeof window !== 'undefined' && window.AIB36 && window.AIB36.extractThinkingDelta) {
    return window.AIB36.extractThinkingDelta(piece) || '';
  }
  if (!piece) return '';
  const d = piece.choices ? (piece.choices[0] && (piece.choices[0].delta || piece.choices[0].message)) : piece;
  return (d && (d.reasoning_content || (typeof d.reasoning === 'string' ? d.reasoning : ''))) || '';
}

function toAnthropic(messages){
  let system = '';
  const out = [];
  const push = (role, block) => {
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) { last.content.push(block); return; }
    out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === 'system') { system += (system ? '\n' : '') + (typeof m.content === 'string' ? m.content : ''); continue; }
    if (m.role === 'tool') { push('user', { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content || '') }); continue; }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const c of m.tool_calls) { let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch {} push('assistant', { type: 'tool_use', id: c.id, name: c.function.name, input }); }
      continue;
    }
    if (typeof m.content === 'string') push(m.role === 'assistant' ? 'assistant' : 'user', { type: 'text', text: m.content || ' ' });
    else out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return { system, messages: out };
}

async function readSse(res, { onDelta, onThinking, calls }){
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '';
  const blocks = {};
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(buf[i] === '\r' ? i + 2 : i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data); } catch { continue; }
      const thinkBit = extractThink(j);
      if (thinkBit) onThinking && onThinking(thinkBit);
      const d = j.choices?.[0]?.delta;
      if (d && d.content) { content += d.content; onDelta && onDelta(d.content); }
      if (calls && thinkBit) calls.reasoning = (calls.reasoning || '') + thinkBit;
      if (calls && d && Array.isArray(d.tool_calls)) {
        for (const t of d.tool_calls) {
          const k = t.index != null ? t.index : calls.list.length;
          const c = calls.list[k] || (calls.list[k] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (t.id) c.id = t.id;
          if (t.function && t.function.name) c.function.name += t.function.name;
          if (t.function && t.function.arguments) c.function.arguments += t.function.arguments;
        }
      }
      if (calls && j.type === 'content_block_start' && j.content_block && j.content_block.type === 'tool_use') {
        blocks[j.index] = { id: j.content_block.id, type: 'function', function: { name: j.content_block.name, arguments: '' } };
        calls.list.push(blocks[j.index]);
      }
      if (calls && j.type === 'content_block_delta' && j.delta && j.delta.type === 'input_json_delta' && blocks[j.index]) blocks[j.index].function.arguments += j.delta.partial_json || '';
      if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta' && j.delta.text) {
        content += j.delta.text; onDelta && onDelta(j.delta.text);
      }
    }
  }
  return content;
}

// chatTurn: one model turn with tool calling. Messages use the OpenAI shape (assistant.tool_calls / role "tool");
// they are converted for Anthropic. Returns { content, toolCalls, reasoning }.
export async function chatTurn(opts){
  const calls = { list: [], reasoning: '' };
  const content = await chatComplete(Object.assign({}, opts, { _calls: calls }));
  const toolCalls = calls.list.filter(c => c && c.function && c.function.name).map((c, i) => Object.assign(c, { id: c.id || ('call_' + Date.now().toString(36) + i) }));
  return { content, toolCalls, reasoning: calls.reasoning };
}

export async function chatComplete({baseUrl, apiKey, model, messages, signal, thinkingLevel, onDelta, onThinking, format, preset, tools, _calls}){
  const key = cleanKey(apiKey), mdl = cleanText(model), base = cleanBase(baseUrl);
  if (!base) throw new Error('请填写 API Base URL / API Base URL is empty');
  if (!mdl) throw new Error('请填写模型名 / Model name is empty');
  if (/[^\x20-\x7e]/.test(key)) throw new Error('API Key 含有非法字符（可能被自动填充成圆点）/ API key has invalid characters (autofill?) — retype it');
  const provider = (typeof window !== 'undefined' && window.AIB36 && window.AIB36.detectProviderId)
    ? window.AIB36.detectProviderId({ provider: preset, preset, model: mdl, baseUrl: base, format })
    : (preset || 'custom');
  const think = thinkingParams(thinkingLevel, { provider, preset, model: mdl, baseUrl: base, format: format || (provider === 'anthropic' ? 'anthropic' : 'openai') });
  const anthropic = format === 'anthropic' || provider === 'anthropic';
  const headers = { 'Content-Type':'application/json' };
  let url, body;
  if (anthropic) {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    const mapped = toAnthropic(messages);
    body = Object.assign({ model: mdl, messages: mapped.messages, stream: true, max_tokens: 4096 }, think);
    if (mapped.system) body.system = mapped.system;
    if (tools && tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    if (think && think.thinking) {
      if (think.thinking.type === 'enabled') body.temperature = 1;
    } else body.temperature = 0.3;
    url = base.replace(/\/v1$/, '') + '/v1/messages';
  } else {
    if (key) headers['Authorization'] = 'Bearer ' + key;
    body = Object.assign({ model: mdl, messages, temperature: 0.3, stream: true }, think);
    if (tools && tools.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    url = endpoint(baseUrl);
  }
  let res;
  try {
    res = await fetch(url, { method:'POST', signal, headers, body: JSON.stringify(body) });
  } catch (e) {
    const cors = /Failed to fetch|NetworkError|CORS|Load failed/i.test(String(e));
    const err = new Error(cors
      ? '跨域或网络被拦截：请换支持浏览器 CORS 的接口（如 DeepSeek），或自建反向代理 / CORS or network blocked — use a provider that allows browser CORS, or your own proxy'
      : String(e.message||e));
    err.cors = cors; throw err;
  }
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    const err = new Error(reasonFor(res.status, txt)); err.status = res.status; throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('event-stream') || ct.includes('text/plain')) {
    return readSse(res, { onDelta, onThinking, calls: _calls });
  }
  const j = await res.json();
  const thinkBit = extractThink(j) || (j.choices?.[0]?.message && extractThink(j.choices[0].message));
  if (thinkBit) onThinking && onThinking(thinkBit);
  const msg = j.choices?.[0]?.message;
  if (_calls && msg && Array.isArray(msg.tool_calls)) _calls.list.push(...msg.tool_calls);
  if (_calls && Array.isArray(j.content)) for (const b of j.content) if (b.type === 'tool_use') _calls.list.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } });
  const content = msg?.content || (Array.isArray(j.content) ? j.content.filter(b => b.type === 'text').map(b => b.text).join('') : '') || '';
  if (content) onDelta && onDelta(content);
  return content;
}
export async function testConnection(cfg){
  return chatComplete({...cfg, messages:[{role:'user', content:'ping — reply with pong only'}]});
}
