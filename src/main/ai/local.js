'use strict';
// Embedded local model via node-llama-cpp (Metal on Apple Silicon). Lazily imported:
// the app starts fine even if the module / native binary / model is missing.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let llamaMod = null, llama = null, model = null, modelKey = null, ctx = null, loading = null;

const CATALOG = [
  { id: 'qwen2.5-7b-instruct-q4_k_m', name: 'Qwen2.5-7B-Instruct Q4_K_M', size: '4.7 GB', bytes: 4683073856,
    repo: 'Qwen/Qwen2.5-7B-Instruct-GGUF', file: 'qwen2.5-7b-instruct-q4_k_m.gguf', note: '推荐 · 中英双语' },
  { id: 'qwen2.5-3b-instruct-q4_k_m', name: 'Qwen2.5-3B-Instruct Q4_K_M', size: '2.1 GB', bytes: 2104932768,
    repo: 'Qwen/Qwen2.5-3B-Instruct-GGUF', file: 'qwen2.5-3b-instruct-q4_k_m.gguf', note: '8 GB 内存可用' },
  { id: 'qwen2.5-1.5b-instruct-q4_k_m', name: 'Qwen2.5-1.5B-Instruct Q4_K_M', size: '1.1 GB', bytes: 1117320736,
    repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF', file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf', note: '最快 · 能力较弱' }
];

function modelsDir() { return path.join(app.getPath('userData'), 'models'); }
function modelPathOf(entry) { return path.join(modelsDir(), entry.file); }

function listModels(settingsLocal) {
  const out = CATALOG.map(m => {
    const p = modelPathOf(m);
    let have = false, partial = 0;
    try { have = fs.statSync(p).size > m.bytes * 0.99; } catch {}
    try { partial = fs.statSync(p + '.part').size; } catch {}
    return { ...m, path: p, downloaded: have, partial };
  });
  return out;
}

async function loadEngine() {
  if (llama) return llama;
  llamaMod = await import('node-llama-cpp');
  llama = await llamaMod.getLlama({ build: 'never', progressLogs: false }).catch(async () => llamaMod.getLlama({ build: 'never' }));
  return llama;
}

async function status(cfg) {
  const p = cfg.modelPath;
  const st = { engine: 'unknown', modelPath: p || '', modelExists: !!(p && fs.existsSync(p)), loaded: !!model };
  try { await loadEngine(); st.engine = 'ok'; st.gpu = llama.gpu || false; } catch (e) { st.engine = 'error'; st.engineError = String(e.message || e).slice(0, 300); }
  return st;
}

async function ensureModel(cfg) {
  const p = cfg.modelPath;
  if (!p || !fs.existsSync(p)) throw Object.assign(new Error('未选择本地模型或文件不存在：请在 设置 → AI 模型 → 本地模型 中下载或选择 .gguf 文件'), { code: 'NO_LOCAL_MODEL' });
  if (model && modelKey === p) return model;
  if (loading) return loading;
  loading = (async () => {
    try {
      const l = await loadEngine();
      if (model) { try { await model.dispose(); } catch {} model = null; }
      model = await l.loadModel({ modelPath: p });
      modelKey = p;
      return model;
    } finally { loading = null; }
  })();
  return loading;
}

async function chat(cfg, { messages, temperature, onDelta, signal, maxTokens }) {
  const m = await ensureModel(cfg);
  const { LlamaChatSession } = llamaMod;
  const context = await m.createContext({ contextSize: cfg.contextSize || 4096 });
  try {
    const sys = messages.filter(x => x.role === 'system').map(x => x.content).join('\n');
    const rest = messages.filter(x => x.role !== 'system');
    const last = rest[rest.length - 1];
    const history = [];
    if (sys) history.push({ type: 'system', text: sys });
    for (const x of rest.slice(0, -1)) {
      if (x.role === 'user') history.push({ type: 'user', text: String(x.content) });
      else if (x.role === 'assistant') history.push({ type: 'model', response: [String(x.content || '')] });
    }
    const session = new LlamaChatSession({ contextSequence: context.getSequence() });
    session.setChatHistory(history);
    let content = '';
    await session.prompt(String(last?.content || ''), {
      temperature: temperature ?? 0.3, maxTokens: maxTokens || 1500, signal,
      stopOnAbortSignal: true,
      onTextChunk: (t) => { content += t; onDelta && onDelta(t); }
    });
    return { content, toolCalls: [] };
  } finally { try { await context.dispose(); } catch {} }
}

// ---- model download with progress (Hugging Face or hf-mirror.com)
const active = new Map();
async function download(id, mirror, onProgress) {
  const entry = CATALOG.find(m => m.id === id);
  if (!entry) throw new Error('unknown model');
  if (active.has(id)) return;
  fs.mkdirSync(modelsDir(), { recursive: true });
  const dest = modelPathOf(entry), part = dest + '.part';
  const host = process.env.AIB_HF_BASE || (mirror ? 'https://hf-mirror.com' : 'https://huggingface.co');
  const url = `${host}/${entry.repo}/resolve/main/${entry.file}`;
  const ac = new AbortController();
  active.set(id, ac);
  try {
    let have = 0; try { have = fs.statSync(part).size; } catch {}
    const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ac.signal, redirect: 'follow' });
    if (!(res.status === 200 || res.status === 206)) throw new Error('HTTP ' + res.status);
    if (res.status === 200) have = 0;
    const total = have + Number(res.headers.get('content-length') || 0);
    const ws = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    const reader = res.body.getReader();
    let got = have, lastT = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!ws.write(value)) await new Promise(r => ws.once('drain', r));
      got += value.length;
      const now = Date.now();
      if (now - lastT > 400) { lastT = now; onProgress && onProgress({ id, got, total }); }
    }
    await new Promise(r => ws.end(r));
    fs.renameSync(part, dest);
    onProgress && onProgress({ id, got, total: got, done: true });
    return dest;
  } finally { active.delete(id); }
}
function cancelDownload(id) { const a = active.get(id); if (a) a.abort(); }
function deleteModel(id) {
  const e = CATALOG.find(m => m.id === id); if (!e) return;
  for (const f of [modelPathOf(e), modelPathOf(e) + '.part']) { try { fs.unlinkSync(f); } catch {} }
}

module.exports = { chat, status, listModels, download, cancelDownload, deleteModel, CATALOG, modelsDir };
