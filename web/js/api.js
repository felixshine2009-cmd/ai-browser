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

export async function chatComplete({baseUrl, apiKey, model, messages, signal, thinkingLevel}){
  const key = cleanKey(apiKey), mdl = cleanText(model), url = endpoint(baseUrl);
  if (!cleanBase(baseUrl)) throw new Error('请填写 API Base URL / API Base URL is empty');
  if (!mdl) throw new Error('请填写模型名 / Model name is empty');
  if (/[^\x20-\x7e]/.test(key)) throw new Error('API Key 含有非法字符（可能被自动填充成圆点）/ API key has invalid characters (autofill?) — retype it');
  const headers = { 'Content-Type':'application/json' };
  if (key) headers['Authorization'] = 'Bearer ' + key;
  let res;
  try {
    const think = (typeof window !== 'undefined' && window.AIB36 && thinkingLevel) ? window.AIB36.reasoningFields(thinkingLevel) : {};
    delete think.interrupt;
    res = await fetch(url, { method:'POST', signal, headers, body: JSON.stringify(Object.assign({ model: mdl, messages, temperature:0.3, stream:false }, think)) });
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
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}
export async function testConnection(cfg){
  return chatComplete({...cfg, messages:[{role:'user', content:'ping — reply with pong only'}]});
}
