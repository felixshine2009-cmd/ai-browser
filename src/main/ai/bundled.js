'use strict';
// Bundled GGUF models (shipped inside the app under <app>/models/) with lazy load + idle unload.
//   * translation:  Tencent HY-MT1.5-1.8B (Q4_K_M)  — ONLY used by translate.js
//   * embedding:    Google EmbeddingGemma-300M (Q8_0) — ONLY used by kb.js
// If a file is missing (e.g. running from the source zip) it is downloaded on first use into userData/models
// (Hugging Face, hf-mirror.com as fallback) with progress events.
const fs = require('fs');
const path = require('path');
let electron = null; try { electron = require('electron'); } catch {}

const ROOT = path.join(__dirname, '..', '..', '..');
const CATALOG = {
  translate: { id: 'hy-mt1.5-1.8b', file: 'HY-MT1.5-1.8B-Q4_K_M.gguf', repo: 'tencent/HY-MT1.5-1.8B-GGUF', bytes: 1133080512, name: 'HY-MT1.5-1.8B (Tencent Hunyuan)', license: 'Tencent HY Community License (not applicable in EU / UK / South Korea)' },
  embed: { id: 'embeddinggemma-300m', file: 'embeddinggemma-300M-Q8_0.gguf', repo: 'ggml-org/embeddinggemma-300M-GGUF', bytes: 333590944, name: 'EmbeddingGemma 300M (Google)', license: 'Gemma Terms of Use' }
};

function userModelsDir() {
  const base = process.env.AIB_USER_DATA || (electron && electron.app && electron.app.getPath ? electron.app.getPath('userData') : path.join(ROOT, '.userdata'));
  return path.join(base, 'models');
}
function candidates(entry) {
  const dirs = [process.env.AIB_BUNDLED_MODELS_DIR, path.join(ROOT, 'models'), process.resourcesPath && path.join(process.resourcesPath, 'models'), userModelsDir()].filter(Boolean);
  return dirs.map(d => path.join(d, entry.file));
}
function locate(kind) {
  const e = CATALOG[kind];
  for (const f of candidates(e)) { try { if (fs.statSync(f).size > (process.env.AIB_HF_BASE ? 1024 : e.bytes * 0.99)) return f; } catch {} }
  return null;
}

let llamaP = null;
function runtime() {
  if (!llamaP) llamaP = import('node-llama-cpp').then(async mod => ({ mod, llama: await mod.getLlama({ build: 'never', progressLogs: false }).catch(() => mod.getLlama({ build: 'never' })) }));
  return llamaP;
}

const downloads = new Map();
async function ensureFile(kind, onProgress) {
  const have = locate(kind); if (have) return have;
  if (downloads.has(kind)) return downloads.get(kind);
  const e = CATALOG[kind];
  const p = (async () => {
    const dir = userModelsDir(); fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, e.file), part = dest + '.part';
    const hosts = require('./hub').endpoints().map(e => e.base); // hf-mirror first by default, auto-fallback
    let lastErr = null;
    for (const host of hosts) {
      try {
        let got = 0; try { got = fs.statSync(part).size; } catch {}
        const res = await fetch(`${host}/${e.repo}/resolve/main/${e.file}`, { headers: got ? { Range: `bytes=${got}-` } : {}, redirect: 'follow' });
        if (!(res.status === 200 || res.status === 206)) throw new Error('HTTP ' + res.status);
        if (res.status === 200) got = 0;
        const total = got + Number(res.headers.get('content-length') || 0);
        const ws = fs.createWriteStream(part, { flags: got ? 'a' : 'w' });
        const reader = res.body.getReader(); let last = 0;
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          if (!ws.write(value)) await new Promise(r => ws.once('drain', r));
          got += value.length; const now = Date.now();
          if (now - last > 400) { last = now; onProgress && onProgress({ kind, got, total }); }
        }
        await new Promise(r => ws.end(r));
        fs.renameSync(part, dest); onProgress && onProgress({ kind, got, total: got, done: true });
        return dest;
      } catch (err) { lastErr = err; }
    }
    throw new Error('模型下载失败 / model download failed: ' + (lastErr && lastErr.message));
  })().finally(() => downloads.delete(kind));
  downloads.set(kind, p);
  return p;
}

// Lazy holder: acquire() loads on demand, schedules unload `idleMs` after the LAST release.
function lazy(kind, { idleMs, create, destroy }) {
  let inst = null, loading = null, timer = null, users = 0, loadedAt = 0, lastUsed = 0, loads = 0, unloads = 0;
  const idle = () => Number(process.env[kind === 'translate' ? 'AIB_TRANSLATE_IDLE_MS' : 'AIB_EMBED_IDLE_MS']) || idleMs;
  function arm() { clearTimeout(timer); timer = setTimeout(() => { if (!users) unload(); }, idle()); if (timer.unref) timer.unref(); }
  async function unload() {
    clearTimeout(timer); const i = inst; inst = null;
    if (i) { try { await destroy(i); } catch {} unloads++; }
  }
  return {
    async acquire(onProgress) {
      clearTimeout(timer); users++;
      try {
        if (!inst) {
          if (!loading) loading = (async () => { const file = await ensureFile(kind, onProgress); const r = await runtime(); inst = await create(r, file); loadedAt = Date.now(); loads++; })().finally(() => { loading = null; });
          await loading;
        }
        lastUsed = Date.now();
        return inst;
      } catch (e) { users--; throw e; }
    },
    release() { users = Math.max(0, users - 1); lastUsed = Date.now(); if (!users) arm(); },
    unload,
    status() { return { loaded: !!inst, loadedAt, lastUsed, loads, unloads, idleMs: idle(), busy: users } ; }
  };
}

module.exports = { CATALOG, locate, ensureFile, runtime, lazy, userModelsDir };
