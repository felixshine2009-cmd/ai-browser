'use strict';
// Local inference frameworks the user already runs: LM Studio, Ollama, oMLX, MLX-LM server, llama.cpp server, vLLM, Jan,
// LocalAI … Auto-detect by probing default ports, list models (grouped by family in the UI), test with specific failure
// reasons, and expose a resolved OpenAI-compatible endpoint for chat / tool calling / streaming and embeddings.
const store = require('../store');
const { familyOf } = require('./catalog');

const isEn = () => { try { return store.getSettings().lang === 'en'; } catch { return false; } };
const L = (zh, en) => (isEn() ? en : zh);

// default ports verified from each project's docs (oMLX 8000, mlx_lm.server 8080, llama-server 8080, vLLM 8000, Jan 1337, LocalAI 8080, LM Studio 1234, Ollama 11434)
const DEFAULTS = [
  { id: 'lmstudio', name: 'LM Studio', port: 1234, kind: 'openai' },
  { id: 'ollama', name: 'Ollama', port: 11434, kind: 'ollama' },
  { id: 'omlx', name: 'oMLX', port: 8000, kind: 'openai', alt: 'vLLM' },
  { id: 'mlxlm', name: 'MLX-LM server', port: 8080, kind: 'openai', alt: 'llama.cpp server / LocalAI' },
  { id: 'jan', name: 'Jan', port: 1337, kind: 'openai' }
];
const NAMES = { llamacpp: 'llama.cpp server', vllm: 'vLLM', localai: 'LocalAI', omlx: 'oMLX', mlxlm: 'MLX-LM server' };

const dk = (k) => (/^(enc|b64):/.test(k || '') ? store.decKey(k) : (k || ''));
function cfgOf() { let f = {}; try { f = (store.getSettings().ai.local || {}).frameworks || {}; } catch {} return { overrides: f.overrides || {}, custom: Array.isArray(f.custom) ? f.custom : [] }; }
function hostBase(h) { h = String(h || '127.0.0.1').trim(); return h; }
function targets() {
  const c = cfgOf(); const out = [];
  for (const d of DEFAULTS) { const o = c.overrides[d.id] || {}; out.push({ ...d, host: hostBase(o.host), port: Number(o.port) || d.port, apiKey: dk(o.apiKey), enabled: o.enabled !== false }); }
  for (const x of c.custom) { try { const u = new URL(x.baseUrl); out.push({ id: x.id || 'custom-' + out.length, name: x.name || u.host, kind: x.kind === 'ollama' ? 'ollama' : 'openai', host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), https: u.protocol === 'https:', pathPrefix: u.pathname.replace(/\/+$/, '').replace(/\/v1$/, ''), apiKey: dk(x.apiKey), custom: true, enabled: true }); } catch {} }
  return out;
}
const origin = (t) => `${t.https ? 'https' : 'http'}://${t.host}:${t.port}${t.pathPrefix || ''}`;
const baseUrlOf = (t) => origin(t) + (t.kind === 'ollama' ? '/v1' : (/\/v1$/.test(origin(t)) ? '' : '/v1'));

// specific, localized failure reason
function why(e, t, status) {
  const code = String((e && e.cause && e.cause.code) || (e && e.code) || ''); const msg = String((e && e.message) || e);
  if (status === 401 || status === 403) return L('需要 API Key（服务器返回 ' + status + '）', 'API key required (server returned ' + status + ')');
  if (status === 404) return L('端口有响应，但不是 OpenAI 兼容接口（/v1/models 404）— 检查端口或路径', 'something answers, but not an OpenAI-compatible API (/v1/models 404) — check port / path');
  if (status) return L('服务器返回 HTTP ' + status, 'server returned HTTP ' + status);
  if (/ECONNREFUSED/.test(code + msg)) return L(`${t.name} 未运行（${t.host}:${t.port} 拒绝连接）— 请先启动它`, `${t.name} is not running (${t.host}:${t.port} refused the connection) — start it first`);
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return L('主机名无法解析：' + t.host, 'host name cannot be resolved: ' + t.host);
  if (/Timeout|timed? ?out|ETIMEDOUT/i.test(code + msg + (e && e.name))) return L(`连接超时（${t.host}:${t.port}）— 可能被防火墙拦截`, `timed out (${t.host}:${t.port}) — a firewall may be blocking it`);
  if (/ECONNRESET|EPIPE|terminated|fetch failed/i.test(code + msg)) return L('连接被重置，服务器可能正在启动或崩溃', 'connection reset — the server may be starting or crashed');
  return msg.slice(0, 120);
}
const hdr = (t) => (t.apiKey ? { Authorization: 'Bearer ' + t.apiKey } : {});
async function getJson(url, t, ms) {
  let res;
  try { res = await fetch(url, { headers: hdr(t), signal: AbortSignal.timeout(ms) }); } catch (e) { const err = new Error(why(e, t)); err.reason = true; throw err; }
  if (!res.ok) { const err = new Error(why(null, t, res.status)); err.reason = true; err.status = res.status; throw err; }
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { const err = new Error(L('服务器返回的不是 JSON — 这不是 LLM 接口', 'response is not JSON — this is not an LLM API')); err.reason = true; throw err; }
}

function paramsOf(id) { const m = String(id).match(/(\d+(?:\.\d+)?)\s*[bB]\b|[-_:](\d+(?:\.\d+)?)b/); return m ? (m[1] || m[2]) + 'B' : ''; }
function modelRow(id, extra = {}) { return { id, family: familyOf(id), params: paramsOf(id), embedding: /embed|bge-|e5-|minilm|nomic/i.test(id), ...extra }; }

async function probeOne(t, ms = 1500) {
  const out = { id: t.id, name: t.name, kind: t.kind, baseUrl: baseUrlOf(t), host: t.host, port: t.port, custom: !!t.custom, up: false, models: [], reason: '', version: '' };
  try {
    if (t.kind === 'ollama') {
      const j = await getJson(origin(t) + '/api/tags', t, ms);
      out.models = (j.models || []).map(m => modelRow(m.name || m.model, { size: m.size || 0, quant: (m.details || {}).quantization_level, paramSize: (m.details || {}).parameter_size, family2: (m.details || {}).family }));
      out.up = true; try { out.version = (await getJson(origin(t) + '/api/version', t, 800)).version || ''; } catch {}
    } else {
      const j = await getJson(origin(t).replace(/\/v1$/, '') + '/v1/models', t, ms);
      const arr = Array.isArray(j) ? j : (j.data || j.models || []);
      out.models = arr.map(m => typeof m === 'string' ? modelRow(m) : modelRow(m.id || m.name || m.model, { owner: m.owned_by || '' })).filter(m => m.id);
      out.up = true;
      // identify look-alikes on shared ports
      const owners = out.models.map(m => m.owner).join(' ');
      if (/vllm/i.test(owners) && t.id === 'omlx') { out.id = 'vllm'; out.name = NAMES.vllm; }
      if (t.id === 'mlxlm' && !t.custom) {
        try { await getJson(origin(t) + '/props', t, 700); out.id = 'llamacpp'; out.name = NAMES.llamacpp; }
        catch { try { const r = await fetch(origin(t) + '/readyz', { signal: AbortSignal.timeout(700) }); if (r.ok) { out.id = 'localai'; out.name = NAMES.localai; } } catch {} }
      }
    }
  } catch (e) { out.reason = e.reason ? e.message : why(e, t); }
  if (out.up && !out.models.length) out.note = L('服务已运行，但没有可用模型（请在该应用中下载 / 加载模型）', 'server is running but exposes no models (download / load one in that app)');
  return out;
}
// probe every default (and custom) endpoint concurrently
async function detect() { return Promise.all(targets().filter(t => t.enabled).map(t => probeOne(t))); }
async function test(cfg) {
  const u = new URL(cfg.baseUrl || `http://${cfg.host || '127.0.0.1'}:${cfg.port}`);
  const t = { id: cfg.id || 'test', name: cfg.name || u.host, kind: cfg.kind === 'ollama' ? 'ollama' : 'openai', host: u.hostname, port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80), https: u.protocol === 'https:', pathPrefix: u.pathname.replace(/\/+$/, '').replace(/\/v1$/, ''), apiKey: cfg.apiKey || '' };
  return probeOne(t, 4000);
}

// role target string: 'fw:<id>:<model>'  (fw = detected/custom framework)
function resolve(fwId, model) {
  const t = targets().find(x => x.id === fwId) || (fwId === 'vllm' || fwId === 'llamacpp' || fwId === 'localai' ? targets().find(x => x.id === (fwId === 'vllm' ? 'omlx' : 'mlxlm')) : null);
  if (!t) throw new Error(L('未找到本地框架：' + fwId, 'local framework not found: ' + fwId));
  return { baseUrl: baseUrlOf(t), apiKey: t.apiKey, model, kind: t.kind, name: t.name, format: 'openai', temperature: 0.3, origin: origin(t) };
}
function parseRole(s) { const m = String(s || '').match(/^fw:([^:]+):(.+)$/); return m ? { fw: m[1], model: m[2] } : null; }

// embeddings: Ollama native /api/embed, otherwise OpenAI /v1/embeddings
async function embed(target, texts) {
  const r = resolve(target.fw, target.model);
  const t = targets().find(x => x.id === target.fw) || {};
  if (r.kind === 'ollama') {
    const res = await fetch(r.origin + '/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr(t) }, body: JSON.stringify({ model: r.model, input: texts }), signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error('Ollama /api/embed HTTP ' + res.status);
    return (await res.json()).embeddings;
  }
  const res = await fetch(r.baseUrl + '/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr(t) }, body: JSON.stringify({ model: r.model, input: texts }), signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error('embeddings HTTP ' + res.status);
  return (await res.json()).data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

module.exports = { DEFAULTS, detect, test, probeOne, resolve, parseRole, embed, targets, baseUrlOf, paramsOf };
