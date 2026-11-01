'use strict';
// Per-model disk usage + cleaning (v3.3.0). Two buckets per downloaded model:
//   files : the weights/config (deleting frees the most space but means re-downloading)
//   cache : unfinished .part downloads (+ .part.json), *.tmp leftovers, <userData>/model-cache/<id>/ (runtime / converted artifacts if
//           any), and — for the built-in EmbeddingGemma — the knowledge-base embedding vectors (documents stay, `reindex` rebuilds).
// We never touch files outside <userData>/models and <userData>/model-cache. LM Studio / Ollama folders are listed read-only.
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../store');

const local = () => require('./local');
const hub = () => require('./hub');
const B = () => require('./bundled');

function walk(dir, fn) { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f, fn); else fn(f, e); } }
function sz(f) { try { return fs.statSync(f).size; } catch { return 0; } }
const isCacheName = (n) => /\.part(\.json)?$|\.tmp$/i.test(n);
function dirBytes(dir, pred) { let n = 0; walk(dir, (f) => { if (!pred || pred(f)) n += sz(f); }); return n; }
const cacheDirOf = (id) => path.join(local().modelsDir(), '..', 'model-cache', String(id).replace(/[^\w.-]+/g, '_'));

function kbBytesFor(entry) {
  try {
    if (entry.id !== 'embeddinggemma-300m-q8_0') return 0;
    const kb = require('./kb'); const d = kb.embedKeyNow();
    return /^builtin:/.test(d) ? kb.vectorBytes() : 0;
  } catch { return 0; }
}
function rolesOfEntry(entry) {
  const R = (store.getSettings().ai.local.roles || {}); const key = (entry.engine === 'mlx' ? 'mlx:' : 'llama:') + entry.id;
  const out = Object.keys(R).filter(r => R[r] === key);
  const L = store.getSettings().ai.local;
  if ((L.modelId === entry.id || (L.modelPath && L.modelPath === local().modelPathOf(entry))) && !out.includes('chat')) out.push('chat');
  return out;
}

function entryUsage(m) {
  const p = local().modelPathOf(m); const parts = []; let files = 0, cache = 0;
  if (m.engine === 'mlx') {
    walk(p, (f) => { const b = sz(f); if (isCacheName(f)) { cache += b; parts.push({ path: f, bytes: b, kind: 'part' }); } else files += b; });
  } else {
    files = sz(p);
    for (const f of [p + '.part', p + '.part.json']) { const b = sz(f); if (b) { cache += b; parts.push({ path: f, bytes: b, kind: 'part' }); } }
    try { for (const n of fs.readdirSync(path.dirname(p))) if (n.startsWith(path.basename(p)) && /\.tmp$/.test(n)) { const f = path.join(path.dirname(p), n); const b = sz(f); cache += b; parts.push({ path: f, bytes: b, kind: 'tmp' }); } } catch {}
  }
  const cd = cacheDirOf(m.id); const cb = dirBytes(cd); if (cb) { cache += cb; parts.push({ path: cd, bytes: cb, kind: 'runtime' }); }
  const kbv = kbBytesFor(m); if (kbv) { cache += kbv; parts.push({ path: 'kb:embedding-index', bytes: kbv, kind: 'kb-index' }); }
  const downloaded = local().haveEntry(m);
  // an embedded/bundled copy shipped inside the app (read-only: never deleted)
  let bundledCopy = ''; try { const kind = m.file === B().CATALOG.translate.file ? 'translate' : m.file === B().CATALOG.embed.file ? 'embed' : ''; if (kind) { const f = B().candidates(B().CATALOG[kind]).find(x => x !== p && sz(x) > 1024); if (f) bundledCopy = f; } } catch {}
  return { id: m.id, name: m.name, family: m.family, engine: m.engine, custom: !!m.custom, downloaded, files, cache, total: files + cache, parts, roles: rolesOfEntry(m), downloading: hub().isActive(m.id), bundledCopy, path: p, bytes: m.bytes || 0 };
}

function externalLocations() {
  const h = os.homedir();
  return [['LM Studio', path.join(h, '.lmstudio', 'models')], ['LM Studio (legacy)', path.join(h, '.cache', 'lm-studio', 'models')], ['Ollama', process.env.OLLAMA_MODELS || path.join(h, '.ollama', 'models')]]
    .map(([name, p]) => ({ name, path: p, exists: fs.existsSync(p), readOnly: true }));
}

function orphanCache() {
  // *.part / *.tmp in the models dir that belong to no catalog entry + the whole model-cache dir of unknown ids
  const known = new Set(local().allEntries().map(m => local().modelPathOf(m)));
  const out = []; const root = local().modelsDir();
  try { for (const n of fs.readdirSync(root)) { const f = path.join(root, n); if (isCacheName(n) && !known.has(f.replace(/\.part(\.json)?$|\.tmp$/, ''))) out.push({ path: f, bytes: sz(f) }); } } catch {}
  return out;
}

function usage() {
  const rows = local().allEntries().map(entryUsage).filter(r => r.total > 0 || r.downloaded);
  const orphans = orphanCache(); const orphanBytes = orphans.reduce((a, o) => a + o.bytes, 0);
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { models: rows, orphans, totals: { files: sum('files'), cache: sum('cache') + orphanBytes, all: sum('total') + orphanBytes }, external: externalLocations(), modelsDir: local().modelsDir() };
}

function rmPath(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
async function clearCache(id) {
  const m = local().findEntry(id); if (!m) throw new Error('unknown model: ' + id);
  if (hub().isActive(id)) hub().cancel(id);
  const u = entryUsage(m); let freed = 0;
  for (const part of u.parts) {
    if (part.kind === 'kb-index') { try { freed += require('./kb').dropVectors(); } catch {} continue; }
    freed += part.bytes; rmPath(part.path);
  }
  return { id, freed, model: m.name, kbRebuild: u.parts.some(x => x.kind === 'kb-index') };
}
async function clearAllCache() {
  let freed = 0; const cleared = [];
  for (const m of local().allEntries()) { const u = entryUsage(m); if (u.cache > 0) { const r = await clearCache(m.id); freed += r.freed; cleared.push(m.id); } }
  for (const o of orphanCache()) { freed += o.bytes; rmPath(o.path); }
  return { freed, cleared };
}
async function deleteFiles(id) {
  const m = local().findEntry(id); if (!m) throw new Error('unknown model: ' + id);
  const before = entryUsage(m);
  if (hub().isActive(id)) hub().cancel(id);
  await local().unloadFor(m);                       // unload a running model first
  const rolesCleared = rolesOfEntry(m);
  local().deleteModel(id);                          // userData copy only
  rmPath(cacheDirOf(id));
  const L = store.getSettings().ai.local; const roles = { ...(L.roles || {}) }; const key = (m.engine === 'mlx' ? 'mlx:' : 'llama:') + id;
  for (const r of Object.keys(roles)) if (roles[r] === key) roles[r] = '';
  const patch = { roles };
  if (L.modelId === id || (L.modelPath && L.modelPath === local().modelPathOf(m))) { patch.modelId = ''; patch.modelPath = ''; }
  store.patchSettings({ ai: { local: patch } });
  const isEmbed = (m.tags || []).includes('embedding') || m.file === B().CATALOG.embed.file;
  const isTr = (m.tags || []).includes('translate') || m.file === B().CATALOG.translate.file;
  return { id, model: m.name, freed: before.files + before.parts.filter(x => x.kind !== 'kb-index').reduce((a, x) => a + x.bytes, 0), rolesCleared, needsKb: isEmbed, needsTranslate: isTr, bundledCopy: before.bundledCopy };
}

module.exports = { usage, entryUsage, clearCache, clearAllCache, deleteFiles, externalLocations };
