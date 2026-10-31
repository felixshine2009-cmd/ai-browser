'use strict';
// Translation with Tencent HY-MT1.5-1.8B. The model is loaded ONLY when a translation is requested
// (sentence / article / page / translate tool) and unloaded after ~150 s idle. Never used for chat / dictionary.
const B = require('./bundled');
const LANG = {
  zh: ['中文', 'Chinese'], en: ['英语', 'English'], ja: ['日语', 'Japanese'], ko: ['韩语', 'Korean'], fr: ['法语', 'French'], de: ['德语', 'German'], es: ['西班牙语', 'Spanish'],
  ru: ['俄语', 'Russian'], pt: ['葡萄牙语', 'Portuguese'], it: ['意大利语', 'Italian'], ar: ['阿拉伯语', 'Arabic'], vi: ['越南语', 'Vietnamese'], th: ['泰语', 'Thai'], tr: ['土耳其语', 'Turkish'], id: ['印尼语', 'Indonesian']
};
const CJK = /[\u3400-\u9fff]/g;

function detectTarget(text) { const n = (text.match(CJK) || []).length; return n / Math.max(1, text.replace(/\s/g, '').length) > 0.25 ? 'en' : 'zh'; }
// Official templates: ZH<=>XX uses the Chinese one, XX<=>XX the English one.
function buildPrompt(text, target, source) {
  const t = LANG[target] || LANG.en;
  if (target === 'zh' || source === 'zh') return `将以下文本翻译为${t[0]}，注意只需要输出翻译后的结果，不要额外解释：\n\n${text}`;
  return `Translate the following segment into ${t[1]}, without additional explanation.\n\n${text}`;
}

const holder = B.lazy('translate', {
  idleMs: 150000,
  async create({ mod, llama }, file) {
    const model = await llama.loadModel({ modelPath: file });
    const context = await model.createContext({ contextSize: 4096 });
    return { mod, model, context };
  },
  async destroy(i) { try { await i.context.dispose(); } catch {} try { await i.model.dispose(); } catch {} }
});

function splitParas(text) { return text.split(/\n\s*\n|\n/).map(x => x.trim()).filter(Boolean); }

// translate(text, {target?, source?, signal, onDelta(text), onProgress}) -> { text, target, model }
async function translate(text, opts = {}) {
  const src = String(text || '').trim(); if (!src) return { text: '', target: opts.target || 'zh', model: B.CATALOG.translate.id };
  const target = opts.target || detectTarget(src);
  const source = target === 'zh' ? 'xx' : (detectTarget(src) === 'en' ? 'zh' : 'xx');
  // a custom model assigned to the 翻译/translate role (framework, MLX or other GGUF) replaces the bundled HY-MT
  let customRole = false; try { const st = require('../store').getSettings(); customRole = st.ai.source === 'local' && !!((st.ai.local.roles || {}).translate) && !(opts && opts.bundledOnly); } catch {}
  if (customRole) {
    const llm = require('./llm'); const out = []; const paras = splitParas(src);
    for (let i = 0; i < paras.length; i++) {
      if (opts.signal && opts.signal.aborted) throw new Error('aborted');
      const piece = String(await llm.complete([{ role: 'user', content: buildPrompt(paras[i], target, source) }], { role: 'translate', temperature: 0, signal: opts.signal, maxTokens: Math.min(1800, 200 + paras[i].length * 3) })).trim();
      out.push(piece); if (opts.onDelta) opts.onDelta((i ? '\n\n' : '') + piece);
    }
    return { text: out.join('\n\n'), target, model: 'role:translate' };
  }
  const inst = await holder.acquire(opts.onProgress);
  try {
    const out = [];
    const paras = splitParas(src);
    for (let i = 0; i < paras.length; i++) {
      if (opts.signal && opts.signal.aborted) throw new Error('aborted');
      const seq = inst.context.getSequence();
      const session = new inst.mod.LlamaChatSession({ contextSequence: seq });
      try {
        const prompt = buildPrompt(paras[i], target, source);
        let acc = '';
        const r = await session.prompt(prompt, { maxTokens: Math.min(1800, 200 + paras[i].length * 3), temperature: 0, signal: opts.signal, stopOnAbortSignal: true,
          onTextChunk: (t) => { acc += t; } });
        const piece = String(r || acc).trim();
        out.push(piece);
        if (opts.onDelta) opts.onDelta((i ? '\n\n' : '') + piece);
      } finally { try { session.dispose(); } catch {} try { seq.dispose(); } catch {} }
    }
    return { text: out.join('\n\n'), target, model: B.CATALOG.translate.id };
  } finally { holder.release(); }
}

module.exports = { translate, detectTarget, buildPrompt, status: () => ({ ...holder.status(), model: B.CATALOG.translate, available: !!B.locate('translate') }), unload: () => holder.unload(), LANG };
