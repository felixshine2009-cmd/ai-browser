'use strict';
// Embedded local model via node-llama-cpp (Metal on Apple Silicon). Lazily imported:
// the app starts fine even if the module / native binary / model is missing.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let llamaMod = null, llama = null, model = null, modelKey = null, ctx = null, loading = null;

const { CATALOG: BUILTIN_CATALOG, ramFor, fmtSize, familyOf } = require('./catalog');
const hub = require('./hub');
const store = require('../store');

function modelsDir() { return path.join(app.getPath('userData'), 'models'); }
const mlxDirOf = (repo) => path.join(modelsDir(), 'mlx', repo.replace(/\//g, '__'));
function modelPathOf(entry) { return entry.engine === 'mlx' ? mlxDirOf(entry.repo) : path.join(modelsDir(), entry.file); }

// user-added models (from Hugging Face search / pasted repo) live in settings.ai.local.custom
function customEntries() {
  let c = []; try { c = store.getSettings().ai.local.custom || []; } catch {}
  return c.map(x => ({ ...x, custom: true, display: (x.family || familyOf(x.repo)) + ' ' + x.name, size: fmtSize(x.bytes || 0), ram: ramFor(x.bytes || 0), tags: x.tags || ['custom'], note: x.note || x.repo }));
}
function allEntries() { const all = BUILTIN_CATALOG.concat(customEntries()); return require('./mlx').platformOk() ? all : all.filter(m => m.engine !== 'mlx'); } // MLX is Apple-Silicon only: hidden elsewhere (Windows / Linux)
function findEntry(id) { return allEntries().find(m => m.id === id); }
function haveEntry(m) {
  const p = modelPathOf(m);
  try {
    if (m.engine === 'mlx') return fs.existsSync(path.join(p, '.aib-complete'));
    const sz = fs.statSync(p).size;
    // Tests use a tiny mock HF payload; accept any non-empty file when AIB_HF_BASE is set.
    return process.env.AIB_HF_BASE ? sz > 1024 : sz > m.bytes * 0.99;
  } catch { return false; }
}
function listModels(settingsLocal) {
  const out = allEntries().map(m => {
    const p = modelPathOf(m);
    let partial = 0; if (m.engine !== 'mlx') { partial = require('./dl').partialBytes(p); }
    return { ...m, path: p, downloaded: haveEntry(m), partial };
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

async function chat(cfg, { messages, temperature, onDelta, signal, maxTokens, jsonSchema }) {
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
    const grammar = jsonSchema ? await llama.createGrammarForJsonSchema(jsonSchema) : undefined; // grammar-constrained JSON (tool-action loop)
    await session.prompt(String(last?.content || ''), {
      grammar,
      temperature: temperature ?? 0.3, maxTokens: maxTokens || 1500, signal,
      stopOnAbortSignal: true,
      onTextChunk: (t) => { content += t; onDelta && onDelta(t); }
    });
    return { content, toolCalls: [] };
  } finally { try { await context.dispose(); } catch {} }
}

// ---- model download with progress (hf-mirror by default, auto-fallback, resume, sha256) — see hub.js
async function download(id, onProgress) {
  const entry = findEntry(id);
  if (!entry) throw new Error('unknown model');
  return hub.download({ id: entry.id, engine: entry.engine, repo: entry.repo, file: entry.file, bytes: entry.bytes, sha256: entry.sha256, dest: modelPathOf(entry) }, onProgress);
}
function cancelDownload(id) { hub.cancel(id); }
function pauseDownload(id) { return hub.pause(id); }
// Shared by Settings (IPC) and the agent tools. Progress is broadcast through hub's sink; completion / errors through hooks.
const hooks = { broadcast: () => {} };
function startDownload(id) {
  const ent = findEntry(id); if (!ent) throw new Error('unknown model: ' + id);
  if (hub.isActive(id)) return { started: false, already: true };
  download(id).then(dest => {
    const L = store.getSettings().ai.local; const tg = ent.tags || [];
    if (dest && ent.engine !== 'mlx' && !tg.includes('translate') && !tg.includes('embedding') && !L.modelPath) store.patchSettings({ ai: { local: { modelPath: dest, modelId: id } } });
    hooks.broadcast('lm:progress', { id, done: true, state: 'done' }); hooks.broadcast('settings:changed', store.publicSettings());
  }).catch(err => hooks.broadcast('lm:progress', err && err.paused ? { id, paused: true, state: 'paused' } : err && err.cancelled ? { id, cancelled: true } : { id, error: String(err.message || err), tried: err && err.tried }));
  return { started: true };
}
async function unloadFor(entry) {
  const p = modelPathOf(entry);
  if (model && modelKey === p) { try { await model.dispose(); } catch {} model = null; modelKey = null; }
  try { const B = require('./bundled'); const tg = entry.tags || [];
    if (entry.file === B.CATALOG.translate.file || tg.includes('translate')) await require('./translate').unload();
    if (entry.file === B.CATALOG.embed.file || tg.includes('embedding')) await require('./kb').unload(); } catch {}
  if (entry.engine === 'mlx') { try { await require('./mlx').stopAll(); } catch {} }
}
function deleteModel(id) {
  const e = findEntry(id); if (!e) return;
  const p = modelPathOf(e);
  if (e.engine === 'mlx') { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} return; }
  for (const f of [p, p + '.part', p + '.part.json']) { try { fs.unlinkSync(f); } catch {} }
}

module.exports = { chat, status, listModels, download, cancelDownload, pauseDownload, startDownload, unloadFor, hooks, allEntries, deleteModel, findEntry, modelPathOf, haveEntry, CATALOG: BUILTIN_CATALOG, modelsDir };
