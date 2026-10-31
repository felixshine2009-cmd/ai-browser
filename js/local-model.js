// WebGPU local models via @mlc-ai/web-llm (CDN). Feature-detects WebGPU; mocks for tests.
// Set window.__AIB_MOCK_WEBGPU__ = { ok:true|false, reason?, chat? } before load to skip real inference.
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

export async function loadModel(modelId, onProgress){
  const det = await detectWebGPU();
  if (!det.ok) throw new Error(reasonText(det.reason));
  if (loading) return loading;
  const id = modelId || CATALOG[0].id;
  loading = (async () => {
    const m = mock();
    if (m) {
      for (const p of [0.15, 0.45, 0.8, 1]) {
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

export async function chat({ messages, temperature = 0.3, signal }){
  if (!engine) throw new Error('Local model not loaded. 本地模型尚未加载。');
  if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const r = await engine.chat.completions.create({ messages, temperature, stream: false });
  return r.choices?.[0]?.message?.content || '';
}

/** Agent-facing tool handlers (web). */
export const tools = {
  async local_models_list(){ return { catalog: CATALOG, cached: await listCachedModels(), ready: isReady(), current: loadedId, webgpu: await detectWebGPU() }; },
  async local_model_status(){ return { ready: isReady(), current: loadedId, progress: lastProgress, webgpu: await detectWebGPU(), phone: isPhone() }; },
  async local_model_load({ modelId }){ await loadModel(modelId); return { ok: true, modelId: loadedId }; },
  async local_model_unload(){ await unload(); return { ok: true }; },
};
