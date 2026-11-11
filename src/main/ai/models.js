'use strict';
// Per-provider model lists (fetch, cache, enable flags) and the data behind the model switcher.
const store = require('../store');
const catalog = require('./model-catalog');
const llm = require('./llm');
const PRESETS = require('../v36/v36').API_PROVIDERS;

const lang = () => (store.getSettings().lang === 'en' ? 'en' : 'zh');
const L = (zh, en) => (lang() === 'en' ? en : zh);
const TIMEOUT = () => Number(process.env.AIB_API_TIMEOUT_MS) || 15000;
let fetchImpl = (...a) => fetch(...a); // test hook
function setFetch(fn) { fetchImpl = fn || ((...a) => fetch(...a)); }

function providers() { return store.getSettings().ai.providers || {}; }
function names() { const o = {}; for (const [k, v] of Object.entries(PRESETS)) o[k] = v.name; return o; }
function patchProvider(pid, obj) { return store.patchSettings({ ai: { providers: { [pid]: obj } } }); }

// Fetch the provider's list now. override: unsaved form values {baseUrl, format, apiKey}.
async function refresh(pid, override) {
  override = override || {};
  const s = store.getSettings().ai;
  const cur = providers()[pid] || {};
  const def = PRESETS[pid] || PRESETS.custom;
  const act = s.api.preset === pid ? s.api : {};
  const cfg = { baseUrl: override.baseUrl || cur.baseUrl || act.baseUrl || def.baseUrl || '', format: override.format || cur.format || act.format || def.format || 'openai' };
  const key = override.apiKey || store.getProviderKey(pid) || (s.api.preset === pid ? store.getApiKey() : '');
  const r = await catalog.fetchModelList(pid, cfg, key, fetchImpl, { lang: lang(), timeoutMs: TIMEOUT(), mask: (t) => llm.maskSecrets(t, key) });
  const current = s.api.preset === pid ? s.api.model : '';
  const now = Date.now();
  let patch;
  if (r.source === 'builtin' && cur.listSource === 'api' && (cur.models || []).length) {
    // keep the last good list from the provider; only record why this refresh failed
    patch = { listError: r.error, listErrorAt: now };
  } else {
    const models = catalog.mergeModels(cur.models, r.models, { pid, current, source: r.source, first: !cur.fetchedAt });
    patch = { models, fetchedAt: now, listSource: r.source, listError: r.error || '', listErrorAt: r.error ? now : 0, listUrl: r.url, filtered: r.filtered || 0 };
  }
  ensure(pid);
  store.patchSettings({ ai: { providers: { [pid]: patch } } });
  const p = providers()[pid];
  return { ok: r.source === 'api', source: p.listSource, error: r.error || '', errorCode: r.errorCode || '', url: r.url, docs: r.docs, count: (p.models || []).length, enabled: (p.models || []).filter(m => m.enabled).length, keptCache: !!patch.listErrorAt && !patch.models };
}
function ensure(pid) {
  const cur = providers()[pid];
  if (cur) return cur;
  const def = PRESETS[pid] || PRESETS.custom;
  patchProvider(pid, { baseUrl: def.baseUrl || '', format: def.format || 'openai', models: [], fetchedAt: 0, listSource: '' });
  return providers()[pid];
}
function setEnabled(pid, ids, on) { const p = ensure(pid); patchProvider(pid, { models: catalog.setEnabled(p.models, ids, on) }); return providers()[pid]; }
function addManual(pid, id) { const p = ensure(pid); patchProvider(pid, { models: catalog.addManual(p.models, id) }); return providers()[pid]; }
function remove(pid, id) {
  const p = ensure(pid);
  patchProvider(pid, { models: catalog.removeModel(p.models, id) });
  return providers()[pid];
}
// local models in the switcher: downloaded built-in models + models of running local frameworks (last detection)
let fwCache = { at: 0, list: [] };
async function detectFw(force) {
  if (!force && Date.now() - fwCache.at < 60000) return fwCache.list;
  try { fwCache = { at: Date.now(), list: await require('./frameworks').detect() }; } catch { fwCache.at = Date.now(); }
  return fwCache.list;
}
function noteFw(list) { if (Array.isArray(list)) fwCache = { at: Date.now(), list }; }
function localItems() {
  const out = [];
  try {
    const all = require('./local').listModels(store.getSettings().ai.local) || [];
    for (const m of all) {
      if (!m.downloaded) continue;
      const tags = m.tags || [];
      if (tags.includes('translate') || tags.includes('embedding')) continue;
      out.push({ id: (m.engine === 'mlx' ? 'mlx:' : 'llama:') + m.id, name: m.name || m.id });
    }
  } catch {}
  for (const f of fwCache.list || []) if (f && f.up) for (const m of f.models || []) out.push({ id: `fw:${f.id}:${m.id}`, name: `${f.name} · ${m.id}` });
  return out;
}
function localList() {
  const hidden = new Set(store.getSettings().ai.localHidden || []);
  return localItems().map(m => ({ ...m, enabled: !hidden.has(m.id) }));
}
function setLocalEnabled(ids, on) {
  const hidden = new Set(store.getSettings().ai.localHidden || []);
  for (const id of [].concat(ids)) { if (on) hidden.delete(id); else hidden.add(id); }
  store.patchSettings({ ai: { localHidden: Array.from(hidden) } });
}

// Per-conversation choice (chat page switcher). Keyed by thread id; follow-ups in the thread inherit it.
const threadModels = new Map();
function setThreadModel(threadId, ref) { if (!threadId) return; if (ref && ref.provider && ref.model) threadModels.set(threadId, { provider: ref.provider, model: ref.model }); else threadModels.delete(threadId); }
function threadModel(threadId) { return threadModels.get(threadId) || null; }

function currentRef() {
  const ai = store.getSettings().ai;
  if (ai.source === 'local') return { provider: 'local', model: (ai.local.roles || {}).chat || (ai.local.modelId ? 'llama:' + ai.local.modelId : '') };
  return { provider: ai.api.preset || 'custom', model: ai.api.model };
}
function labelOf(ref) {
  if (!ref) return '';
  if (ref.provider === 'local') return llm.localLabel(ref.model);
  return ((PRESETS[ref.provider] || {}).name || ref.provider) + ' · ' + ref.model;
}
// {current, groups:[{id,name,models:[{id,name,ctx,vision,reasoning}]}]} — only enabled models of configured providers
function picker(opts) {
  opts = opts || {};
  const pub = store.publicSettings().ai;
  const cur = (opts.threadId && threadModel(opts.threadId)) || currentRef();
  const groups = catalog.pickerGroups(pub.providers || {}, names(), { activeProvider: pub.source === 'api' ? pub.api.preset : '' });
  const loc = localList().filter(m => m.enabled);
  if (loc.length) groups.push({ id: 'local', name: L('本地模型', 'Local models'), models: loc.map(m => ({ id: m.id, name: m.name })) });
  // the active model is always listed, even if it was disabled
  const g = groups.find(x => x.id === cur.provider);
  if (cur.model && (!g || !g.models.some(m => m.id === cur.model))) {
    const item = { id: cur.model, name: cur.provider === 'local' ? labelOf(cur).replace(/^[^·]+·\s*/, '') : '' };
    if (g) g.models.unshift(item); else groups.unshift({ id: cur.provider, name: cur.provider === 'local' ? L('本地模型', 'Local models') : ((PRESETS[cur.provider] || {}).name || cur.provider), models: [item] });
  }
  return { current: { ...cur, label: labelOf(cur) }, groups, override: !!(opts.threadId && threadModel(opts.threadId)) };
}
function select(ref) {
  if (!ref || !ref.provider || !ref.model) throw new Error('invalid model');
  return store.setActiveModel(ref.provider, ref.model);
}
module.exports = { refresh, setEnabled, addManual, remove, picker, select, setThreadModel, threadModel, currentRef, labelOf, localList, setLocalEnabled, detectFw, noteFw, setFetch, names };
