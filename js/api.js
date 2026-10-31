export async function chatComplete({baseUrl, apiKey, model, messages, signal}){
  const url = (baseUrl||'').replace(/\/$/,'') + '/chat/completions';
  let res;
  try {
    res = await fetch(url, {
      method:'POST', signal,
      headers:{ 'Content-Type':'application/json', ...(apiKey?{Authorization:`Bearer ${apiKey}`}:{}) },
      body: JSON.stringify({ model, messages, temperature:0.3, stream:false })
    });
  } catch (e) {
    const cors = /Failed to fetch|NetworkError|CORS|Load failed/i.test(String(e));
    const err = new Error(cors
      ? 'CORS / network blocked. Use a provider that allows browser requests (e.g. DeepSeek, or your own proxy). 跨域或网络被拦截：请换支持浏览器 CORS 的接口，或自建反向代理。'
      : String(e.message||e));
    err.cors = cors; throw err;
  }
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status}: ${txt.slice(0,200)}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}
export async function testConnection(cfg){
  return chatComplete({...cfg, messages:[{role:'user', content:'ping — reply with pong only'}]});
}
