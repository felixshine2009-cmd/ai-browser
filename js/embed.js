// Semantic KB embeddings. Prefer EmbeddingGemma-300M (onnx-community) via @huggingface/transformers;
// fall back to Xenova MiniLM if EmbeddingGemma cannot load. Mockable via window.__AIB_MOCK_EMBED__.
const CDN_V3 = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0';
const CDN_V2 = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
const EMBEDDINGGEMMA = 'onnx-community/embeddinggemma-300m-ONNX';
const FALLBACK = 'Xenova/all-MiniLM-L6-v2';
let pipe = null, mode = 'text', modelId = null;

export function getMode(){ return mode; }
export function setMode(m){ mode = m === 'vector' ? 'vector' : 'text'; }
export function currentEmbedModel(){ return modelId; }

function mock(){ return (typeof window !== 'undefined' && window.__AIB_MOCK_EMBED__) || null; }

export async function ensureEmbedder(onProgress){
  if (pipe) return pipe;
  const m = mock();
  if (m) {
    pipe = async (text) => {
      // deterministic tiny vector from string hash for tests
      const v = new Float32Array(8); let h = 0;
      for (let i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) | 0; v[i % 8] += ((h % 1000) / 1000); }
      let n = 0; for (const x of v) n += x*x; n = Math.sqrt(n) || 1; for (let i=0;i<v.length;i++) v[i]/=n;
      return { data: v };
    };
    modelId = 'mock-embeddinggemma'; mode = 'vector';
    if (onProgress) onProgress({ status: 'ready', mock: true });
    return pipe;
  }
  try {
    const { pipeline, env } = await import(/* @vite-ignore */ CDN_V3);
    env.allowLocalModels = false; env.useBrowserCache = true;
    pipe = await pipeline('feature-extraction', EMBEDDINGGEMMA, {
      dtype: 'q8',
      progress_callback: (p) => onProgress && onProgress(p)
    });
    modelId = EMBEDDINGGEMMA;
  } catch (e) {
    const { pipeline, env } = await import(/* @vite-ignore */ CDN_V2);
    env.allowLocalModels = false; env.useBrowserCache = true;
    pipe = await pipeline('feature-extraction', FALLBACK, {
      progress_callback: (p) => onProgress && onProgress(p)
    });
    modelId = FALLBACK;
  }
  mode = 'vector';
  return pipe;
}

export async function embed(text){
  const p = await ensureEmbedder();
  const out = await p(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

export function cosine(a, b){
  let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export async function unloadEmbedder(){ pipe = null; modelId = null; }
