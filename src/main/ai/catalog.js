'use strict';
// Built-in model catalog (all repos verified to exist on Hugging Face on 2026-10-31).
// engine 'llama' = GGUF via node-llama-cpp (llama.cpp); engine 'mlx' = mlx-community safetensors snapshot (Apple Silicon).
// family groups models in the settings UI; chat template comes from the GGUF/tokenizer metadata (Gemma, Qwen, Hunyuan…).
const GB = 1e9;
const g = (id, family, name, repo, file, bytes, o = {}) => ({ id, family, name, engine: 'llama', repo, file, bytes, ...o });
const m = (id, family, name, repo, bytes, o = {}) => ({ id, family, name, engine: 'mlx', repo, bytes: Math.round(bytes * GB), mlx: true, ...o });

const CATALOG = [
  // ---- Qwen3
  g('qwen3-0.6b-q4_k_m', 'Qwen3', '0.6B · Q4_K_M', 'bartowski/Qwen_Qwen3-0.6B-GGUF', 'Qwen_Qwen3-0.6B-Q4_K_M.gguf', 484220320, { note: '极速试用 · 仅适合短任务', tags: ['light'], license: 'Apache-2.0', arch: 'qwen3', legacyId: true }),
  g('qwen3-1.7b-q4_k_m', 'Qwen3', '1.7B · Q4_K_M', 'bartowski/Qwen_Qwen3-1.7B-GGUF', 'Qwen_Qwen3-1.7B-Q4_K_M.gguf', 1282439584, { note: '轻量通用 · 词条/句子尚可', tags: ['general', 'light'], license: 'Apache-2.0', arch: 'qwen3' }),
  g('qwen3-4b-q4_k_m', 'Qwen3', '4B · Q4_K_M', 'bartowski/Qwen_Qwen3-4B-GGUF', 'Qwen_Qwen3-4B-Q4_K_M.gguf', 2497280960, { note: '通用推荐 · 比 2.5-3B 更强', tags: ['general'], license: 'Apache-2.0', arch: 'qwen3' }),
  m('mlx-qwen3-0.6b-4bit', 'Qwen3', '0.6B · MLX 4bit', 'mlx-community/Qwen3-0.6B-4bit', 0.34, { note: 'MLX · 极速', tags: ['light'], license: 'Apache-2.0' }),
  m('mlx-qwen3-1.7b-4bit', 'Qwen3', '1.7B · MLX 4bit', 'mlx-community/Qwen3-1.7B-4bit', 0.97, { note: 'MLX · 轻量', tags: ['general', 'light'], license: 'Apache-2.0' }),
  m('mlx-qwen3-4b-4bit', 'Qwen3', '4B · MLX 4bit', 'mlx-community/Qwen3-4B-4bit', 2.26, { note: 'MLX · 通用推荐', tags: ['general'], license: 'Apache-2.0' }),
  m('mlx-qwen3-8b-4bit', 'Qwen3', '8B · MLX 4bit', 'mlx-community/Qwen3-8B-4bit', 4.61, { note: 'MLX · 更强', tags: ['general'], license: 'Apache-2.0' }),
  // ---- Qwen2.5
  g('qwen2.5-0.5b-instruct-q4_k_m', 'Qwen2.5', '0.5B · Q4_K_M', 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', 'qwen2.5-0.5b-instruct-q4_k_m.gguf', 491400032, { note: '极速试用 · 测试用', tags: ['light'], license: 'Apache-2.0', arch: 'qwen2' }),
  g('qwen2.5-1.5b-instruct-q4_k_m', 'Qwen2.5', '1.5B · Q4_K_M', 'Qwen/Qwen2.5-1.5B-Instruct-GGUF', 'qwen2.5-1.5b-instruct-q4_k_m.gguf', 1117320736, { note: '轻量 · 能力有限', tags: ['light'], license: 'Apache-2.0', arch: 'qwen2' }),
  g('qwen2.5-3b-instruct-q4_k_m', 'Qwen2.5', '3B · Q4_K_M', 'Qwen/Qwen2.5-3B-Instruct-GGUF', 'qwen2.5-3b-instruct-q4_k_m.gguf', 2104932768, { note: '轻量通用 · 8 GB 内存可用', tags: ['general', 'light'], license: 'Apache-2.0', arch: 'qwen2' }),
  g('qwen2.5-7b-instruct-q4_k_m', 'Qwen2.5', '7B · Q4_K_M', 'Qwen/Qwen2.5-7B-Instruct-GGUF', 'qwen2.5-7b-instruct-q4_k_m.gguf', 4683073856, { note: '通用推荐 · 中英双语', tags: ['general'], license: 'Apache-2.0', arch: 'qwen2' }),
  m('mlx-qwen2.5-1.5b-4bit', 'Qwen2.5', '1.5B · MLX 4bit', 'mlx-community/Qwen2.5-1.5B-Instruct-4bit', 0.87, { note: 'MLX · 轻量', tags: ['light'], license: 'Apache-2.0' }),
  m('mlx-qwen2.5-3b-4bit', 'Qwen2.5', '3B · MLX 4bit', 'mlx-community/Qwen2.5-3B-Instruct-4bit', 1.74, { note: 'MLX · 轻量通用', tags: ['general', 'light'], license: 'Apache-2.0' }),
  m('mlx-qwen2.5-7b-4bit', 'Qwen2.5', '7B · MLX 4bit', 'mlx-community/Qwen2.5-7B-Instruct-4bit', 4.28, { note: 'MLX · 通用', tags: ['general'], license: 'Apache-2.0' }),
  // ---- Gemma 4 (Apache-2.0)
  g('gemma-4-e2b-q4_k_m', 'Gemma 4', 'E2B · Q4_K_M', 'unsloth/gemma-4-E2B-it-GGUF', 'gemma-4-E2B-it-Q4_K_M.gguf', 3106738272, { note: 'Gemma 4 · 轻量 · 多语言', tags: ['general', 'light'], license: 'Apache-2.0', arch: 'gemma4' }),
  g('gemma-4-e4b-q4_k_m', 'Gemma 4', 'E4B · Q4_K_M', 'unsloth/gemma-4-E4B-it-GGUF', 'gemma-4-E4B-it-Q4_K_M.gguf', 4977171584, { note: 'Gemma 4 · 通用推荐', tags: ['general'], license: 'Apache-2.0', arch: 'gemma4' }),
  g('gemma-4-12b-q4_k_m', 'Gemma 4', '12B · Q4_K_M', 'unsloth/gemma-4-12b-it-GGUF', 'gemma-4-12b-it-Q4_K_M.gguf', 7121861440, { note: 'Gemma 4 · 高质量', tags: ['general'], license: 'Apache-2.0', arch: 'gemma4' }),
  g('gemma-4-26b-a4b-q4_k_m', 'Gemma 4', '26B-A4B (MoE) · UD-Q4_K_M', 'unsloth/gemma-4-26B-A4B-it-GGUF', 'gemma-4-26B-A4B-it-UD-Q4_K_M.gguf', 16947541728, { note: 'Gemma 4 · MoE 激活 4B · 需大内存', tags: ['general'], license: 'Apache-2.0', arch: 'gemma4' }),
  g('gemma-4-31b-q4_k_m', 'Gemma 4', '31B · Q4_K_M', 'unsloth/gemma-4-31B-it-GGUF', 'gemma-4-31B-it-Q4_K_M.gguf', 18323733440, { note: 'Gemma 4 · 最强 · 需大内存', tags: ['general'], license: 'Apache-2.0', arch: 'gemma4' }),
  m('mlx-gemma-4-e2b-4bit', 'Gemma 4', 'E2B · MLX 4bit', 'mlx-community/gemma-4-e2b-it-4bit', 3.55, { note: 'MLX · 轻量', tags: ['general', 'light'], license: 'Apache-2.0' }),
  m('mlx-gemma-4-e4b-4bit', 'Gemma 4', 'E4B · MLX 4bit', 'mlx-community/gemma-4-e4b-it-4bit', 5.15, { note: 'MLX · 通用推荐', tags: ['general'], license: 'Apache-2.0' }),
  m('mlx-gemma-4-12b-4bit', 'Gemma 4', '12B · MLX 4bit', 'mlx-community/gemma-4-12b-it-4bit', 6.74, { note: 'MLX · 高质量', tags: ['general'], license: 'Apache-2.0' }),
  m('mlx-gemma-4-26b-a4b-4bit', 'Gemma 4', '26B-A4B · MLX 4bit', 'mlx-community/gemma-4-26b-a4b-it-4bit', 15.34, { note: 'MLX · MoE', tags: ['general'], license: 'Apache-2.0' }),
  m('mlx-gemma-4-31b-4bit', 'Gemma 4', '31B · MLX 4bit', 'mlx-community/gemma-4-31b-it-4bit', 18.41, { note: 'MLX · 最强', tags: ['general'], license: 'Apache-2.0' }),
  // ---- Gemma 3n
  g('gemma-3n-e2b-q4_k_m', 'Gemma 3n', 'E2B · Q4_K_M', 'unsloth/gemma-3n-E2B-it-GGUF', 'gemma-3n-E2B-it-Q4_K_M.gguf', 3026881888, { note: 'Gemma 3n · 端侧', tags: ['light'], license: 'Gemma Terms of Use', arch: 'gemma3n' }),
  g('gemma-3n-e4b-q4_k_m', 'Gemma 3n', 'E4B · Q4_K_M', 'unsloth/gemma-3n-E4B-it-GGUF', 'gemma-3n-E4B-it-Q4_K_M.gguf', 4539054208, { note: 'Gemma 3n · 端侧', tags: ['general'], license: 'Gemma Terms of Use', arch: 'gemma3n' }),
  m('mlx-gemma-3n-e2b-4bit', 'Gemma 3n', 'E2B · MLX 4bit', 'mlx-community/gemma-3n-E2B-it-4bit', 4.46, { note: 'MLX', tags: ['light'], license: 'Gemma Terms of Use' }),
  m('mlx-gemma-3n-e4b-4bit', 'Gemma 3n', 'E4B · MLX 4bit', 'mlx-community/gemma-3n-E4B-it-4bit', 5.82, { note: 'MLX', tags: ['general'], license: 'Gemma Terms of Use' }),
  // ---- Gemma 3
  g('gemma-3-1b-q4_k_m', 'Gemma 3', '1B · Q4_K_M', 'ggml-org/gemma-3-1b-it-GGUF', 'gemma-3-1b-it-Q4_K_M.gguf', 806058240, { note: 'Gemma 3 · 极轻', tags: ['light'], license: 'Gemma Terms of Use', arch: 'gemma3' }),
  g('gemma-3-4b-q4_k_m', 'Gemma 3', '4B · Q4_K_M', 'unsloth/gemma-3-4b-it-GGUF', 'gemma-3-4b-it-Q4_K_M.gguf', 2489894016, { note: 'Gemma 3 · 通用', tags: ['general'], license: 'Gemma Terms of Use', arch: 'gemma3' }),
  g('gemma-3-12b-q4_k_m', 'Gemma 3', '12B · Q4_K_M', 'unsloth/gemma-3-12b-it-GGUF', 'gemma-3-12b-it-Q4_K_M.gguf', 7300778336, { note: 'Gemma 3 · 高质量', tags: ['general'], license: 'Gemma Terms of Use', arch: 'gemma3' }),
  g('gemma-3-27b-q4_k_m', 'Gemma 3', '27B · Q4_K_M', 'unsloth/gemma-3-27b-it-GGUF', 'gemma-3-27b-it-Q4_K_M.gguf', 16546688736, { note: 'Gemma 3 · 需大内存', tags: ['general'], license: 'Gemma Terms of Use', arch: 'gemma3' }),
  m('mlx-gemma-3-1b-qat-4bit', 'Gemma 3', '1B · MLX QAT 4bit', 'mlx-community/gemma-3-1b-it-qat-4bit', 0.73, { note: 'MLX · 极轻', tags: ['light'], license: 'Gemma Terms of Use' }),
  m('mlx-gemma-3-4b-qat-4bit', 'Gemma 3', '4B · MLX QAT 4bit', 'mlx-community/gemma-3-4b-it-qat-4bit', 3.0, { note: 'MLX · 通用', tags: ['general'], license: 'Gemma Terms of Use' }),
  m('mlx-gemma-3-12b-qat-4bit', 'Gemma 3', '12B · MLX QAT 4bit', 'mlx-community/gemma-3-12b-it-qat-4bit', 8.03, { note: 'MLX · 高质量', tags: ['general'], license: 'Gemma Terms of Use' }),
  m('mlx-gemma-3-27b-qat-4bit', 'Gemma 3', '27B · MLX QAT 4bit', 'mlx-community/gemma-3-27b-it-qat-4bit', 16.83, { note: 'MLX · 需大内存', tags: ['general'], license: 'Gemma Terms of Use' }),
  // ---- Hunyuan-MT (translation specialists; used ONLY for translation)
  g('hy-mt1.5-1.8b-q4_k_m', 'Hunyuan-MT', 'HY-MT1.5 1.8B · Q4_K_M', 'tencent/HY-MT1.5-1.8B-GGUF', 'HY-MT1.5-1.8B-Q4_K_M.gguf', 1133080512, { note: '翻译专用 · 内置默认', tags: ['translate'], license: 'Tencent HY Community License', arch: 'hunyuanDense', promptHint: 'translate-only', builtin: true }),
  g('hunyuan-mt-7b-q4_k_m', 'Hunyuan-MT', 'Hunyuan-MT 7B · Q4_K_M', 'mradermacher/Hunyuan-MT-7B-GGUF', 'Hunyuan-MT-7B.Q4_K_M.gguf', 4624950272, { note: '翻译专用 · 腾讯混元 33 语种', tags: ['translate'], license: 'Tencent license', arch: 'hunyuanDense', promptHint: 'translate-only' }),
  m('mlx-hy-mt1.5-1.8b-4bit', 'Hunyuan-MT', 'HY-MT1.5 1.8B · MLX 4bit', 'mlx-community/HY-MT1.5-1.8B-4bit', 1.01, { note: 'MLX · 翻译专用', tags: ['translate'], license: 'Tencent HY Community License', promptHint: 'translate-only' }),
  m('mlx-hy-mt1.5-7b-4bit', 'Hunyuan-MT', 'HY-MT1.5 7B · MLX 4bit', 'mlx-community/HY-MT1.5-7B-4bit', 4.22, { note: 'MLX · 翻译专用', tags: ['translate'], license: 'Tencent HY Community License', promptHint: 'translate-only' }),
  // ---- Seed-X
  g('seed-x-ppo-7b-q4_k_m', 'Seed-X', 'Seed-X-PPO 7B · Q4_K_M', 'mradermacher/Seed-X-PPO-7B-GGUF', 'Seed-X-PPO-7B.Q4_K_M.gguf', 4557582848, { note: '翻译专用 · 字节 Seed-X（需语言标签）', tags: ['translate'], license: 'Apache-2.0', arch: 'llama', promptHint: 'seed-x' }),
  // ---- Embedding
  g('embeddinggemma-300m-q8_0', 'EmbeddingGemma', '300M · Q8_0', 'ggml-org/embeddinggemma-300M-GGUF', 'embeddinggemma-300M-Q8_0.gguf', 333590944, { note: '知识库嵌入 · 内置默认', tags: ['embedding'], license: 'Gemma Terms of Use', arch: 'gemma-embedding', builtin: true })
];

// ~ unified-memory / RAM needed to run comfortably: weights + KV/runtime overhead
function ramFor(bytes) { const need = bytes * 1.2 + 1.5 * GB; for (const t of [6, 8, 12, 16, 24, 32, 48, 64, 96, 128]) if (need <= t * GB * 0.85) return t + ' GB' + (t >= 8 ? '+' : ''); return '128 GB+'; }
const fmtSize = (b) => (b >= GB ? (b / GB).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
for (const x of CATALOG) { x.ram = ramFor(x.bytes); x.size = fmtSize(x.bytes); x.display = x.family + ' ' + x.name; }

// "Qwen3-4B-Q4_K_M.gguf" / "mlx-community/gemma-3-12b-it-4bit" -> family label (used for HF search results / custom models)
function familyOf(repoOrName) {
  const s = String(repoOrName || '').split('/').pop().replace(/[_]/g, '-').toLowerCase();
  const rules = [[/gemma-?4/, 'Gemma 4'], [/gemma-?3n/, 'Gemma 3n'], [/gemma-?3/, 'Gemma 3'], [/gemma-?2/, 'Gemma 2'], [/embeddinggemma/, 'EmbeddingGemma'], [/qwen-?3/, 'Qwen3'], [/qwen-?2\.?5/, 'Qwen2.5'], [/qwen-?2/, 'Qwen2'], [/qwq|qwen/, 'Qwen'],
    [/hy-?mt|hunyuan/, 'Hunyuan-MT'], [/seed-?x/, 'Seed-X'], [/llama-?3/, 'Llama 3'], [/llama/, 'Llama'], [/mistral|ministral/, 'Mistral'], [/phi-?4/, 'Phi-4'], [/phi/, 'Phi'], [/deepseek/, 'DeepSeek'], [/glm/, 'GLM'], [/smollm/, 'SmolLM'], [/granite/, 'Granite'], [/yi-/, 'Yi'], [/minicpm/, 'MiniCPM'], [/internlm/, 'InternLM']];
  for (const [re, name] of rules) if (re.test(s)) return name;
  const w = s.replace(/-(gguf|mlx|\d+b.*|instruct.*|it$|chat.*|\d+bit)$/g, '').split('-')[0];
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Other';
}
module.exports = { CATALOG, ramFor, fmtSize, familyOf };
