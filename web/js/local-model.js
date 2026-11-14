// WebGPU local models via @mlc-ai/web-llm (CDN). Feature-detects WebGPU; mocks for tests.
// Set window.__AIB_MOCK_WEBGPU__ = { ok:true|false, reason?, chat? } before load to skip real inference.
import { ShardDownloader, mirrorsOf, storageReport, removeEntries } from './shard-cache.js';
import { confirmDialog, doneBanner, L } from './confirm.js';
const CDN = 'https://esm.run/@mlc-ai/web-llm@0.2.79';
let engine = null, loading = null, lastProgress = { text: '', progress: 0 }, webgpuOk = null, loadedId = null;

export function getProgress(){ return lastProgress; }
export function isReady(){ return !!engine; }
export function currentModelId(){ return loadedId; }

export const CATALOG = [
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B (Q4)', vramMB: 900, family: 'Qwen2.5' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B (Q4)', vramMB: 1600, family: 'Qwen2.5' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 3B (Q4)', vramMB: 2800, family: 'Qwen2.5' },
  { id: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 2B (Q4)', vramMB: 1800, family: 'Gemma 2' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (Q4)', vramMB: 1200, family: 'Llama 3.2' },
];

export function isPhone(){
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 600);
}

export function memoryWarning(modelId){
  const m = CATALOG.find(x => x.id === modelId) || CATALOG[0];
  if (!isPhone()) return null;
  if (m.vramMB >= 2000) return { level: 'high', zh: `手机内存紧张：${m.label} 约需 ${Math.round(m.vramMB/1024*10)/10} GB 显存/内存，可能崩溃或极慢。建议用 0.5B / 1.5B。`, en: `Phone memory warning: ${m.label} needs ~${Math.round(m.vramMB/1024*10)/10} GB and may crash or run very slowly. Prefer 0.5B / 1.5B.` };
  if (m.vramMB >= 1200) return { level: 'mid', zh: `手机提示：${m.label} 约需 ${Math.round(m.vramMB/1024*10)/10} GB，请保持页面在前台并关闭其他标签。`, en: `Phone tip: ${m.label} needs ~${Math.round(m.vramMB/1024*10)/10} GB. Keep this tab in the foreground and close others.` };
  return null;
}

function mock(){ return (typeof window !== 'undefined' && window.__AIB_MOCK_WEBGPU__) || null; }

export async function detectWebGPU(){
  if (webgpuOk !== null) return webgpuOk;
  const m = mock();
  if (m) { webgpuOk = { ok: !!m.ok, reason: m.ok ? null : (m.reason || 'no-adapter'), mock: true }; return webgpuOk; }
  try {
    if (!navigator.gpu) { webgpuOk = { ok:false, reason:'no-navigator-gpu' }; return webgpuOk; }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { webgpuOk = { ok:false, reason:'no-adapter' }; return webgpuOk; }
    webgpuOk = { ok:true };
  } catch (e) { webgpuOk = { ok:false, reason: String(e.message||e) }; }
  return webgpuOk;
}

/** Reset cached detection (tests). */
export function _resetDetect(){ webgpuOk = null; }

export function reasonText(r){
  const map = {
    'no-navigator-gpu': 'This browser has no WebGPU. Try Chrome / Edge 113+ or Safari 18+ on a supported device. 当前浏览器没有 WebGPU，请换 Chrome / Edge 113+ 或支持的 Safari 18+。',
    'no-adapter': 'WebGPU adapter unavailable (GPU blocked or software-only). WebGPU 适配器不可用（GPU 被禁用或仅软件渲染）。',
  };
  return map[r] || ('WebGPU unavailable: ' + r);
}

export async function listCachedModels(){
  // WebLLM stores weights in Cache Storage; we expose known catalog ids that appear as cache keys.
  const out = [];
  try {
    if (!('caches' in globalThis)) return out;
    const names = await caches.keys();
    for (const n of names) {
      for (const m of CATALOG) if (n.includes(m.id) || n.toLowerCase().includes(m.family.toLowerCase().replace(/\s/g,''))) {
        if (!out.find(x => x.id === m.id)) out.push({ id: m.id, label: m.label, cache: n });
      }
    }
  } catch {}
  return out;
}

export async function unload(){
  if (engine && engine.unload) try { await engine.unload(); } catch {}
  engine = null; loading = null; loadedId = null;
}

// ---- resumable per-shard download (see shard-cache.js) ------------------------------------------------
let dl = null; // current ShardDownloader
export function getDownloadStatus(){ return dl ? dl.status() : null; }
export function pauseLoad(){ if (dl) { dl.pause(); return true; } return false; }
export function cancelLoad(){ if (dl) { dl.cancel(); return true; } return false; }
async function modelUrlFor(id){
  const m = mock();
  if (m) return m.shardBase ? (typeof m.shardBase === 'function' ? m.shardBase(id) : m.shardBase) : null; // mock: only when a test provides shards
  const webllm = await import(/* @vite-ignore */ CDN);
  const rec = (webllm.prebuiltAppConfig && webllm.prebuiltAppConfig.model_list || []).find(x => x.model_id === id);
  return rec ? rec.model : null;
}
async function prefetch(id, onProgress){
  const url = await modelUrlFor(id); if (!url) return false;
  const m = mock() || {};
  dl = new ShardDownloader({ id, modelUrl: url, mirrors: m.mirrors || undefined, backoffMs: m.backoffMs || 800, maxRetries: m.maxRetries || 6, onStatus: (st) => {
    const pct = st.bytesTotal ? Math.min(1, ((st.liveBytes || st.bytesDone) / st.bytesTotal)) : 0;
    lastProgress = { text: statusText(st), progress: pct, dl: st };
    if (onProgress) onProgress(lastProgress);
  } });
  try { await dl.run(); return true; } finally { /* keep dl for status display */ }
}
export function statusText(st){
  const mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.max(0.1, b / 1e6).toFixed(1) + ' MB');
  const bytes = `${mb(st.liveBytes || st.bytesDone || 0)} / ${mb(st.bytesTotal || 0)} · ${L('分片', 'shards')} ${st.shardsDone}/${st.shardsTotal}`;
  if (st.state === 'paused') return L('已暂停（已缓存的分片会保留，点“继续”从下一分片开始）· ', 'Paused (finished shards are kept; Resume continues from the next shard) · ') + bytes;
  if (st.state === 'retrying') return L('网络中断，将自动重试', 'Network lost, will retry automatically') + ` (${st.retry}/${st.max}, ${Math.ceil((st.waitMs || 0) / 1000)}s) · ` + bytes;
  if (st.state === 'error') return L('下载失败：', 'Download failed: ') + (st.message || '') + ' · ' + bytes;
  if (st.state === 'done') return L('下载完成，正在初始化…', 'Downloaded, initialising…');
  const sp = st.speed ? ' · ' + (st.speed >= 1e6 ? (st.speed / 1e6).toFixed(1) + ' MB/s' : Math.round(st.speed / 1e3) + ' KB/s') : '';
  const eta = st.eta ? ' · ' + L('剩余 ', 'ETA ') + (st.eta >= 60 ? Math.floor(st.eta / 60) + 'm' + (st.eta % 60) + 's' : st.eta + 's') : '';
  return bytes + sp + eta;
}

export async function loadModel(modelId, onProgress){
  const det = await detectWebGPU();
  if (!det.ok) throw new Error(reasonText(det.reason));
  if (loading) return loading;
  const id = modelId || CATALOG[0].id;
  loading = (async () => {
    const m = mock();
    const prefetched = await prefetch(id, onProgress);  // pause/cancel/failure rejects here; completed shards stay cached
    if (m) {
      if (!prefetched) for (const p of [0.15, 0.45, 0.8, 1]) {
        lastProgress = { text: 'mock download ' + Math.round(p*100) + '%', progress: p };
        if (onProgress) onProgress(lastProgress);
        await new Promise(r => setTimeout(r, 30));
      }
      engine = { mock: true, chat: { completions: { create: async ({ messages }) => {
        const last = (messages||[]).filter(x=>x.role==='user').pop();
        const reply = (typeof m.chat === 'function') ? await m.chat(messages) : ('[mock local] ' + (last&&last.content||''));
        return { choices: [{ message: { content: reply } }] };
      }}}};
      loadedId = id; loading = null; return engine;
    }
    const webllm = await import(/* @vite-ignore */ CDN);
    lastProgress = { text: 'starting', progress: 0 };
    engine = await webllm.CreateMLCEngine(id, {
      initProgressCallback: (p) => {
        lastProgress = { text: p.text || '', progress: p.progress || 0 };
        if (onProgress) onProgress(lastProgress);
      }
    });
    loadedId = id; loading = null; return engine;
  })();
  try { return await loading; } catch (e) { loading = null; engine = null; loadedId = null; throw e; }
}

// ---- disk usage / cleaning -------------------------------------------------------------------------
export const EMBED_MATCH = { id: 'embeddinggemma', label: 'EmbeddingGemma (KB vectors)', needles: ['embeddinggemma'] };
const matchers = () => CATALOG.map(c => ({ id: c.id, label: c.label, needles: [c.id, c.id.replace(/-MLC$/, '')] })).concat([EMBED_MATCH]);
export async function diskReport(){
  const r = await storageReport(matchers());
  return { ...r, current: loadedId, downloading: dl && ['downloading', 'retrying'].includes(dl.s.state) ? dl.id : null };
}
export async function clearModelCache(id){
  const r = await diskReport(); const row = r.models.find(x => x.id === id);
  if (dl && dl.id === id) { dl.cancel(); }
  if (!row || row.complete) return { id, freed: 0, note: 'nothing to clear (model is complete; use delete to remove it)' };
  return { id, freed: await removeEntries(row.entries) };
}
export async function deleteModelFiles(id){
  const r = await diskReport(); const row = r.models.find(x => x.id === id); if (!row) return { id, freed: 0 };
  if (dl && dl.id === id) dl.cancel();
  if (loadedId === id) await unload();
  let freed = await removeEntries(row.entries);
  if (!mock()) { try { const webllm = await import(/* @vite-ignore */ CDN); await webllm.deleteModelAllInfoInCache(id); } catch {} }
  return { id, freed, needsKb: id === EMBED_MATCH.id };
}
const fmtMB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');
export { fmtMB };

export async function chat({ messages, temperature = 0.3, signal, onDelta }){
  if (!engine) throw new Error('Local model not loaded. 本地模型尚未加载。');
  if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
  // Stop: interrupts the generation inside the engine; what was written so far stays
  const onAbort = () => { try { engine.interruptGenerate && engine.interruptGenerate(); } catch {} };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (!onDelta) {
      const r = await engine.chat.completions.create({ messages, temperature, stream: false });
      return r.choices?.[0]?.message?.content || '';
    }
    let out = '';
    const it = await engine.chat.completions.create({ messages, temperature, stream: true });
    for await (const ch of it) {
      const d = ch.choices?.[0]?.delta?.content || '';
      if (d) { out += d; onDelta(d); }
      if (signal && signal.aborted) break;
    }
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return out;
  } finally { if (signal) signal.removeEventListener('abort', onAbort); }
}

/** Agent-facing tool handlers (web). */
export const tools = {
  async local_models_list(){ return { catalog: CATALOG, cached: await listCachedModels(), ready: isReady(), current: loadedId, webgpu: await detectWebGPU() }; },
  async local_model_status(){ return { ready: isReady(), current: loadedId, progress: lastProgress, webgpu: await detectWebGPU(), phone: isPhone() }; },
  async local_model_load({ modelId }){ await loadModel(modelId); return { ok: true, modelId: loadedId }; },
  async local_model_unload(){ await unload(); return { ok: true }; },
  async local_models_download({ modelId }){ const id = modelId || CATALOG[0].id; if (loading) return { started: false, already: true }; loadModel(id).catch(() => {}); return { started: true, modelId: id }; },
  async local_models_resume({ modelId }){ return tools.local_models_download({ modelId }); },
  async local_models_pause(){ return { paused: pauseLoad(), status: getDownloadStatus() }; },
  async local_models_status(){ return { status: getDownloadStatus(), current: loadedId }; },
  async local_models_disk_usage(){ const r = await diskReport(); return { estimate: r.estimate, persisted: r.persisted, models: r.models.map(m => ({ id: m.id, label: m.label, filesBytes: m.filesBytes, cacheBytes: m.cacheBytes, complete: m.complete })), otherBytes: r.other.filesBytes }; },
  async local_models_clear_cache({ modelId }){
    // always through the user's confirmation dialog
    const r = await diskReport(); const rows = modelId ? r.models.filter(m => m.id === modelId) : r.models; const bytes = rows.reduce((a, m) => a + m.cacheBytes, 0);
    if (!bytes) return { freed: 0, note: 'no cache to clear' };
    const ok = await confirmDialog({ title: L('清理模型缓存？（AI 请求）', 'Clear model cache? (requested by AI)'), message: L(`将清理${modelId ? '该模型' : '所有模型'}的未完成下载分片，释放约 ${fmtMB(bytes)}。已完整下载的模型不受影响。`, `Clear unfinished download shards of ${modelId ? 'this model' : 'all models'}, freeing about ${fmtMB(bytes)}. Complete models are not affected.`), confirmText: L('确认清理', 'Confirm clear') });
    if (!ok) return { freed: 0, declined: true };
    let freed = 0; for (const m of rows) freed += (await clearModelCache(m.id)).freed; doneBanner(L('已释放 ', 'Freed ') + fmtMB(freed)); return { freed };
  },
  async local_models_delete({ modelId }){
    const r = await diskReport(); const row = r.models.find(m => m.id === modelId); if (!row) return { freed: 0, note: 'not downloaded' };
    const ok = await confirmDialog({ title: L('删除模型？（AI 请求）', 'Delete model? (requested by AI)'), message: L(`将从浏览器存储中删除「${row.label}」，释放约 ${fmtMB(row.filesBytes + row.cacheBytes)}，之后需要重新下载。`, `Delete "${row.label}" from browser storage, freeing about ${fmtMB(row.filesBytes + row.cacheBytes)}. You must download it again to use it.`), detail: L('此操作无法撤销。', 'This cannot be undone.'), confirmText: L('确认删除', 'Confirm delete') });
    if (!ok) return { freed: 0, declined: true };
    const d = await deleteModelFiles(modelId); doneBanner(L('已释放 ', 'Freed ') + fmtMB(d.freed)); return d;
  },
};
