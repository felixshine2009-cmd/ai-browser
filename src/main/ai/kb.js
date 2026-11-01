'use strict';
// Knowledge base: chunking + embeddings + cosine search. Default embedder: bundled Google EmbeddingGemma-300M
// (offline). Optional: any OpenAI-compatible /embeddings API (settings.kb.source = 'api').
const fs = require('fs');
const path = require('path');
const B = require('./bundled');
let electron = null; try { electron = require('electron'); } catch {}
const store = require('../store');

const QUERY_PREFIX = 'task: search result | query: ';
const docPrefix = (title) => `title: ${title || 'none'} | text: `;

function dataFile() {
  const base = process.env.AIB_USER_DATA || (electron && electron.app ? electron.app.getPath('userData') : path.join(B.userModelsDir(), '..'));
  return path.join(base, 'kb', 'index.json');
}
let db = null;
function load() {
  if (db) return db;
  try { db = JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch { db = { version: 1, embedKey: '', docs: [] }; }
  return db;
}
function save() { const f = dataFile(); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(db)); fs.renameSync(f + '.tmp', f); }

function cfg() {
  let s = {}; try { s = store.getSettings() || {}; } catch {}
  const k = s.kb || {};
  return { source: k.source === 'api' ? 'api' : 'builtin', api: Object.assign({ baseUrl: '', apiKey: '', model: '' }, k.api || {}, { apiKey: (() => { try { return store.getKbApiKey(); } catch { return ''; } })() }) };
}
function fwRole() { try { const r = ((store.getSettings().ai.local || {}).roles || {}).embedding || ''; return require('./frameworks').parseRole(r); } catch { return null; } }
function embedKey() { const c = cfg(); const fr = fwRole(); if (c.source !== 'api' && fr) return 'fw:' + fr.fw + ':' + fr.model; return c.source === 'api' ? 'api:' + c.api.baseUrl + '|' + c.api.model : 'builtin:' + B.CATALOG.embed.id; }

// ---- embedders
const holder = B.lazy('embed', {
  idleMs: 180000,
  async create({ llama }, file) { const model = await llama.loadModel({ modelPath: file }); const ctx = await model.createEmbeddingContext({ contextSize: 2048 }); return { model, ctx }; },
  async destroy(i) { try { await i.ctx.dispose(); } catch {} try { await i.model.dispose(); } catch {} }
});

function norm(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / s; return o; }

async function embed(texts, kind, onProgress) {
  const c = cfg();
  if (c.source === 'api') {
    if (!c.api.baseUrl || !c.api.model) throw new Error('未配置自定义嵌入 API / custom embedding API not configured');
    const out = [];
    for (let i = 0; i < texts.length; i += 16) {
      const res = await fetch(c.api.baseUrl.replace(/\/+$/, '') + '/embeddings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.api.apiKey },
        body: JSON.stringify({ model: c.api.model, input: texts.slice(i, i + 16) }) });
      if (!res.ok) throw new Error('embedding API HTTP ' + res.status);
      const j = await res.json();
      for (const d of (j.data || []).sort((a, b) => a.index - b.index)) out.push(norm(d.embedding));
    }
    return out;
  }
  const fr = fwRole();
  if (fr) { // embedding role assigned to a local framework model (Ollama /api/embed or OpenAI /embeddings)
    const pre = /embeddinggemma/i.test(fr.model) && kind === 'query' ? QUERY_PREFIX : '';
    const out = []; for (let i = 0; i < texts.length; i += 16) { const vs = await require('./frameworks').embed(fr, texts.slice(i, i + 16).map(t => pre + t)); for (const v of vs) out.push(norm(v)); } return out;
  }
  const inst = await holder.acquire(onProgress);
  try {
    const out = [];
    for (const t of texts) {
      const e = await inst.ctx.getEmbeddingFor(kind === 'query' ? QUERY_PREFIX + t : t);
      out.push(norm(e.vector));
    }
    return out;
  } finally { holder.release(); }
}

// ---- chunking (paragraph/sentence aware, CJK friendly)
function chunkText(text, max = 600, overlap = 80) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const units = [];
  for (const para of clean.split(/\n\s*\n+/)) {
    const p = para.trim(); if (!p) continue;
    if (p.length <= max) { units.push(p); continue; }
    const sents = p.match(/[^。！？!?；;.\n]+[。！？!?；;.]*\s*/g) || [p];
    for (const s of sents) { if (s.length > max) for (let i = 0; i < s.length; i += max) units.push(s.slice(i, i + max)); else units.push(s); }
  }
  const chunks = []; let cur = '';
  for (const u of units) {
    if (cur && (cur.length + u.length + 1) > max) { chunks.push(cur.trim()); cur = cur.slice(Math.max(0, cur.length - overlap)) + ' ' + u; } else cur = cur ? cur + (cur.endsWith('\n') ? '' : '\n') + u : u;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

const b64 = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');
const unb64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const cache = new Map();
function vecOf(ch) { let v = cache.get(ch); if (!v) { v = unb64(ch.v); cache.set(ch, v); } return v; }

async function addText(title, text, meta = {}, onProgress) {
  const d = load();
  const key = embedKey();
  if (d.docs.length && d.embedKey && d.embedKey !== key) throw new Error('嵌入模型已更换，请先点击“重建索引” / embedding model changed — rebuild the index first');
  const parts = chunkText(text);
  if (!parts.length) throw new Error('内容为空 / empty content');
  const vecs = await embed(parts.map(p => docPrefix(title) + p), 'doc', onProgress);
  const doc = { id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: title || '未命名', source: meta.source || 'text', added: Date.now(), chars: text.length, chunks: parts.map((t, i) => ({ t, v: b64(vecs[i]) })) };
  d.docs.push(doc); d.embedKey = key; save();
  return { id: doc.id, title: doc.title, chunks: doc.chunks.length };
}

async function search(query, k = 5) {
  const d = load();
  if (!d.docs.length) return [];
  if (d.embedKey !== embedKey()) throw new Error('嵌入模型已更换，请先重建索引 / rebuild the index');
  const [q] = await embed([String(query)], 'query');
  const hits = [];
  for (const doc of d.docs) for (const ch of doc.chunks) { const v = vecOf(ch); let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * q[i]; hits.push({ docId: doc.id, title: doc.title, text: ch.t, score: Math.round(s * 1000) / 1000 }); }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, Math.min(20, k)));
}

function list() { const d = load(); return { embedKey: d.embedKey, current: embedKey(), stale: !!(d.docs.length && d.embedKey !== embedKey()), docs: d.docs.map(x => ({ id: x.id, title: x.title, source: x.source, added: x.added, chars: x.chars, chunks: x.chunks.length })) }; }
function remove(id) { const d = load(); d.docs = d.docs.filter(x => x.id !== id); if (!d.docs.length) d.embedKey = ''; cache.clear(); save(); return list(); }
function clear() { db = { version: 1, embedKey: '', docs: [] }; cache.clear(); save(); return list(); }
async function reindex(onProgress) {
  const d = load(); const key = embedKey();
  for (const doc of d.docs) {
    const vecs = await embed(doc.chunks.map(c => docPrefix(doc.title) + c.t), 'doc', onProgress);
    doc.chunks.forEach((c, i) => { c.v = b64(vecs[i]); });
  }
  d.embedKey = key; cache.clear(); save(); return list();
}

// embedding-index accounting for the model cleaner: vectors can be dropped (documents stay) and rebuilt with reindex()
function vectorBytes() { const d = load(); let n = 0; for (const doc of d.docs) for (const ch of doc.chunks) if (ch.v) n += String(ch.v).length; return n; }
function embedKeyNow() { return embedKey(); }
function dropVectors() { const d = load(); let n = 0; for (const doc of d.docs) for (const ch of doc.chunks) if (ch.v) { n += String(ch.v).length; delete ch.v; } if (d.docs.length) d.embedKey = '__cleared__'; cache.clear(); save(); return n; }

module.exports = { vectorBytes, dropVectors, embedKeyNow, addText, search, list, remove, clear, reindex, chunkText, embed, status: () => ({ ...holder.status(), model: B.CATALOG.embed, available: !!B.locate('embed') }), unload: () => holder.unload(), _reset() { db = null; cache.clear(); } };
