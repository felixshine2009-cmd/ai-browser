'use strict';
// node-llama-cpp API subset on iPad. Inference runs in native llama.cpp (llama.xcframework, Metal) inside the app; this
// module forwards to it through the host bridge. Used by src/main/ai/local.js, bundled.js, translate.js and kb.js.
const host = require(global.__aibHostModule || '../host');
const { jsonSchemaToGbnf } = require('./json-schema-to-grammar');

// llama.cpp grammars/json.gbnf (MIT): fallback when a schema can not be converted
const GENERIC_JSON = "root   ::= object\nvalue  ::= object | array | string | number | (\"true\" | \"false\" | \"null\") ws\n\nobject ::=\n  \"{\" ws (\n            string \":\" ws value\n    (\",\" ws string \":\" ws value)*\n  )? \"}\" ws\n\narray  ::=\n  \"[\" ws (\n            value\n    (\",\" ws value)*\n  )? \"]\" ws\n\nstring ::=\n  \"\\\"\" (\n    [^\"\\\\\\x7F\\x00-\\x1F] |\n    \"\\\\\" ([\"\\\\bfnrt] | \"u\" [0-9a-fA-F]{4}) # escapes\n  )* \"\\\"\" ws\n\nnumber ::= (\"-\"? ([0-9] | [1-9] [0-9]{0,15})) (\".\" [0-9]+)? ([eE] [-+]? [0-9] [1-9]{0,15})? ws\n\n# Optional space: by convention, applied in this grammar after literal chars when allowed\nws ::= | \" \" | \"\\n\" [ \\t]{0,20}\n";
class LlamaGrammar { constructor(gbnf) { this.gbnf = gbnf; } }
class LlamaJsonSchemaGrammar extends LlamaGrammar {
  constructor(llama, schema) { let g = ''; try { g = jsonSchemaToGbnf(schema); } catch (e) { g = GENERIC_JSON; } super(g); this.schema = schema; }
  parse(text) { return JSON.parse(text); }
}

class LlamaModel {
  constructor(handle, info, modelPath) { this.handle = handle; this.info = info || {}; this.modelPath = modelPath; this.disposed = false; }
  get trainContextSize() { return this.info.nCtxTrain || 4096; }
  async createContext({ contextSize } = {}) { const r = await host.call('llama.ctx', { model: this.handle, nCtx: Math.min(Number(contextSize) || 4096, this.trainContextSize), embedding: false }, 120000); return new LlamaContext(this, r.ctx, r.nCtx); }
  async createEmbeddingContext({ contextSize } = {}) { const r = await host.call('llama.ctx', { model: this.handle, nCtx: Math.min(Number(contextSize) || 2048, this.trainContextSize), embedding: true }, 120000); return new LlamaEmbeddingContext(this, r.ctx); }
  async dispose() { if (this.disposed) return; this.disposed = true; await host.call('llama.free', { model: this.handle }, 60000).catch(() => {}); }
}
class LlamaContextSequence { constructor(ctx) { this.context = ctx; this.disposed = false; } dispose() { this.disposed = true; } }
class LlamaContext {
  constructor(model, handle, nCtx) { this.model = model; this.handle = handle; this.contextSize = nCtx; }
  getSequence() { return new LlamaContextSequence(this); }
  async dispose() { await host.call('llama.ctxFree', { ctx: this.handle }, 60000).catch(() => {}); }
}
class LlamaEmbeddingContext {
  constructor(model, handle) { this.model = model; this.handle = handle; }
  async getEmbeddingFor(text) { const r = await host.call('llama.embed', { ctx: this.handle, text: String(text) }, 300000); return { vector: r.vector || [] }; }
  async dispose() { await host.call('llama.ctxFree', { ctx: this.handle }, 60000).catch(() => {}); }
}

class LlamaChatSession {
  constructor({ contextSequence, systemPrompt } = {}) { this.seq = contextSequence; this.history = systemPrompt ? [{ type: 'system', text: systemPrompt }] : []; }
  setChatHistory(h) { this.history = (h || []).slice(); }
  getChatHistory() { return this.history.slice(); }
  dispose() {}
  async prompt(text, opts = {}) {
    const messages = [];
    for (const h of this.history) {
      if (h.type === 'system') messages.push({ role: 'system', content: String(h.text || '') });
      else if (h.type === 'user') messages.push({ role: 'user', content: String(h.text || '') });
      else if (h.type === 'model') messages.push({ role: 'assistant', content: (h.response || []).filter(x => typeof x === 'string').join('') });
    }
    messages.push({ role: 'user', content: String(text) });
    let out = '';
    const p = host.call('llama.chat', {
      ctx: this.seq.context.handle, messages, temperature: opts.temperature == null ? 0.3 : Number(opts.temperature),
      maxTokens: Number(opts.maxTokens) || 1500, grammar: opts.grammar ? opts.grammar.gbnf : '', topP: opts.topP, topK: opts.topK
    }, 0, (part) => { if (part && part.text) { out += part.text; if (opts.onTextChunk) try { opts.onTextChunk(part.text); } catch {} } });
    const onAbort = () => host.cmd('llama.cancel', { ctx: this.seq.context.handle });
    if (opts.signal) { if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const r = await p;
      const full = (r && typeof r.text === 'string') ? r.text : out;
      this.history.push({ type: 'user', text: String(text) }, { type: 'model', response: [full] });
      if (opts.signal && opts.signal.aborted && !opts.stopOnAbortSignal) throw new Error('aborted');
      return full;
    } finally { if (opts.signal) opts.signal.removeEventListener('abort', onAbort); }
  }
}

class Llama {
  constructor(info) { this.info = info || {}; this.gpu = this.info.gpu || 'metal'; this.supportsGpuOffloading = true; }
  async loadModel({ modelPath, gpuLayers } = {}) {
    const r = await host.call('llama.load', { path: String(modelPath), gpuLayers: gpuLayers == null ? -1 : Number(gpuLayers) }, 600000);
    return new LlamaModel(r.model, r, modelPath);
  }
  async createGrammarForJsonSchema(schema) { return new LlamaJsonSchemaGrammar(this, schema); }
  async createGrammar({ grammar }) { return new LlamaGrammar(String(grammar)); }
  async getVramState() { const r = await host.call('llama.info', {}, 10000).catch(() => ({})); return { total: r.vramTotal || 0, used: 0, free: r.vramTotal || 0 }; }
  async dispose() {}
}
let llamaP = null;
async function getLlama() {
  if (!llamaP) llamaP = host.call('llama.info', {}, 30000).then(info => { if (!info || !info.ok) throw new Error((info && info.error) || 'llama.cpp 原生库不可用'); return new Llama(info); }).catch((e) => { llamaP = null; throw e; });
  return llamaP;
}

module.exports = { getLlama, Llama, LlamaModel, LlamaContext, LlamaChatSession, LlamaGrammar, LlamaJsonSchemaGrammar, LlamaEmbeddingContext, default: { getLlama } };
