'use strict';
// Simple JSON persistence in userData (settings, history, bookmarks, downloads).
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const DEFAULTS = {
  lang: 'zh',
  mode: 'chat', // 'chat' | 'search'
  search: { engine: 'bing', custom: '' },
  ai: {
    source: 'api', // 'api' | 'local'
    api: { preset: 'openai', format: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', temperature: 0.3 },
    // per provider: { baseUrl, format, apiKey, models:[{id,enabled,manual?,ctx?,vision?,reasoning?}], fetchedAt, listSource, listError }
    providers: {},
    local: { modelPath: '', modelId: '', translateModelId: '', hfMirror: false, contextSize: 4096, engine: 'auto', hub: { endpoint: 'mirror', custom: '' }, custom: [], roles: {}, frameworks: { overrides: {}, custom: [] } }
  },
  dicts: [], // {id,name,mdx,mdd:[],enabled}
  extensions: {}, // id -> {enabled, settings}
  chromeExtensions: [], // {id?, path, enabled}
  selectionLookup: true,
  displayName: 'Felix', // home greeting: {name}
  greeting: '', // '' = localized default
  translate: { engine: 'hunyuan' }, // 'hunyuan' (bundled HY-MT, loaded only while translating) | 'chat' (current chat model)
  kb: { source: 'builtin', api: { baseUrl: '', apiKey: '', model: '' } }, // knowledge base embeddings
  agent: { maxSteps: 12 },
  python: { engine: 'auto', timeoutSec: 600, index: '' }, // engine: auto (VM when running, else embedded) | local | vm
  vm: { memoryMB: 2048, cpus: 2, diskGB: 16, image: 'alpine' },
  answerStyle: 'detailed',
  thinkingLevel: 'medium',
  workMode: 'chat',
  appearance: { theme: 'aurora' }, // + mode ('system' | 'light' | 'dark') and light (light palette): see renderer/static/theme.js
  home: { layout: 'center', background: '' },
  toolsCollapsed: false,
  collab: {},
  passwords: { save: true, autofill: true },
  onboarding: { completed: false, skipped: false, completedAt: 0 }
};

const ENGINES = {
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' }
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && over[k] && typeof over[k] === 'object')
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

class JsonFile {
  constructor(name, def) {
    this.file = path.join(app.getPath('userData'), name);
    this.def = def;
    this.data = def;
    this._t = null;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = JSON.parse(JSON.stringify(def)); }
  }
  save(now) {
    const w = () => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1), { mode: 0o600 });
        fs.renameSync(this.file + '.tmp', this.file);
      } catch (e) { console.error('save failed', this.file, e.message); }
    };
    if (now) { clearTimeout(this._t); w(); return; }
    clearTimeout(this._t);
    this._t = setTimeout(w, 300);
  }
  flush() { if (this._t) { clearTimeout(this._t); this._t = null; this.save(true); } }
}

let settingsFile, historyFile, bookmarksFile, downloadsFile, chatFile, chatBag;

function init() {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { raw = null; }
  settingsFile = new JsonFile('settings.json', {});
  settingsFile.data = deepMerge(DEFAULTS, raw || {});
  // v5.5: appearance gains a light / dark / follow-system mode; a legacy light palette ({ theme: 'sand' }) becomes mode 'light'
  try { settingsFile.data.appearance = Object.assign({}, settingsFile.data.appearance, require('../renderer/static/theme.js').normAppearance(settingsFile.data.appearance)); } catch (e) { console.error('appearance', e); }
  // Brand-new install → show the wizard. Pre-3.0.0 upgrades (settings existed without onboarding) skip it.
  const fresh = raw === null || (typeof raw === 'object' && !Object.keys(raw).length);
  if (fresh) settingsFile.data.onboarding = { completed: false, skipped: false, completedAt: 0 };
  else if (!Object.prototype.hasOwnProperty.call(raw, 'onboarding')) settingsFile.data.onboarding = { completed: true, skipped: false, completedAt: 0 };
  // v5.4.0: per-provider model lists. Existing single-provider config becomes one provider entry, its model enabled.
  {
    const a = settingsFile.data.ai;
    const before = JSON.stringify(a.providers || {});
    a.providers = require('./ai/model-catalog').migrate(a, Object.keys(require('./v36/v36').API_PROVIDERS));
    if (raw && JSON.stringify(a.providers) !== before) settingsFile.save();
  }
  historyFile = new JsonFile('history.json', []);
  bookmarksFile = new JsonFile('bookmarks.json', []);
  downloadsFile = new JsonFile('downloads.json', []);
  chatFile = new JsonFile('chats.json', []);
  if (!Array.isArray(chatFile.data)) chatFile.data = [];
  chatBag = require('./v36/v36').createChats(chatFile.data);
}

// ---- API key at rest: encrypted with OS keychain (safeStorage) when available.
function encKey(plain) {
  if (!plain) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(plain).toString('base64');
  } catch {}
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
}
function decKey(stored) {
  if (!stored) return '';
  try {
    if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
  } catch {}
  return '';
}

function getSettings() { return settingsFile.data; }
function getKbApiKey() { return decKey(((settingsFile.data.kb || {}).api || {}).apiKey); }
function getApiKey() { return decKey(settingsFile.data.ai.api.apiKey); }
// Settings as exposed to renderer pages: the key is never sent out.
function publicSettings() {
  const s = JSON.parse(JSON.stringify(settingsFile.data));
  s.ai.api.hasKey = !!s.ai.api.apiKey;
  s.ai.api.apiKey = '';
  try {
    const fw = s.ai.local.frameworks || {};
    for (const o of Object.values(fw.overrides || {})) { o.hasKey = !!o.apiKey; o.apiKey = ''; }
    for (const c of fw.custom || []) { c.hasKey = !!c.apiKey; c.apiKey = ''; }
  } catch {}
  if (s.kb && s.kb.api) { s.kb.api.hasKey = !!s.kb.api.apiKey; s.kb.api.apiKey = ''; }
  for (const p of Object.values(s.ai.providers || {})) { if (p && typeof p === 'object') { p.hasKey = !!p.apiKey; p.apiKey = ''; } }
  return s;
}
function patchSettings(patch) {
  patch = JSON.parse(JSON.stringify(patch || {}));
  if (patch.ai && patch.ai.api && 'apiKey' in patch.ai.api) {
    const k = patch.ai.api.apiKey;
    if (k === '' || k === undefined || k === null) delete patch.ai.api.apiKey; // empty = keep existing
    else if (k === '__clear__') patch.ai.api.apiKey = '';
    else patch.ai.api.apiKey = encKey(k);
  }
  delete patch.ai?.api?.hasKey;
  // switching the active provider without typing a key: use the key saved for that provider, if it has one
  if (patch.ai && patch.ai.api && patch.ai.api.preset && patch.ai.api.preset !== ((settingsFile.data.ai || {}).api || {}).preset && !patch.ai.api.apiKey) {
    const savedKey = ((((settingsFile.data.ai || {}).providers || {})[patch.ai.api.preset]) || {}).apiKey;
    if (savedKey) patch.ai.api.apiKey = savedKey;
  }
  if (patch.kb && patch.kb.api) {
    if ('apiKey' in patch.kb.api) { const k = patch.kb.api.apiKey; if (k === '' || k == null) delete patch.kb.api.apiKey; else if (k === '__clear__') patch.kb.api.apiKey = ''; else patch.kb.api.apiKey = encKey(k); }
    delete patch.kb.api.hasKey;
  }
  const fwp = patch.ai && patch.ai.local && patch.ai.local.frameworks;
  if (fwp) {
    const cur = (((settingsFile.data.ai || {}).local || {}).frameworks) || {};
    const fix = (o, old) => { if (!o) return; delete o.hasKey; const k = o.apiKey; if (k === '' || k == null) { if (old && old.apiKey) o.apiKey = old.apiKey; else delete o.apiKey; } else if (k === '__clear__') o.apiKey = ''; else if (!/^(enc|b64):/.test(k)) o.apiKey = encKey(k); };
    for (const [id, o] of Object.entries(fwp.overrides || {})) fix(o, (cur.overrides || {})[id]);
    if (Array.isArray(fwp.custom)) for (const c of fwp.custom) fix(c, (cur.custom || []).find(x => x.id === c.id));
  }
  const provPatch = patch.ai && patch.ai.providers;
  if (provPatch) {
    for (const [pid, o] of Object.entries(provPatch)) {
      if (!o || typeof o !== 'object') continue;
      delete o.hasKey;
      if ('apiKey' in o) { const k = o.apiKey; if (k === '' || k == null) delete o.apiKey; else if (k === '__clear__') o.apiKey = ''; else if (!/^(enc|b64):/.test(k)) o.apiKey = encKey(k); }
    }
  }
  if (patch.dicts) settingsFile.data.dicts = patch.dicts, delete patch.dicts;
  if (patch.chromeExtensions) settingsFile.data.chromeExtensions = patch.chromeExtensions, delete patch.chromeExtensions;
  settingsFile.data = deepMerge(settingsFile.data, patch);
  if (patch.appearance) { try { settingsFile.data.appearance = Object.assign({}, settingsFile.data.appearance, require('../renderer/static/theme.js').normAppearance(settingsFile.data.appearance)); } catch {} }
  syncProviders(patch);
  settingsFile.save();
  return publicSettings();
}
// Keep the active API config (ai.api) and its provider entry (ai.providers[preset]) in step, in both directions.
function syncProviders(patch) {
  const ai = settingsFile.data.ai; if (!ai) return;
  ai.providers = ai.providers || {};
  const api = ai.api || {};
  const pid = api.preset || 'custom';
  const pp = patch.ai && patch.ai.providers && patch.ai.providers[pid];
  if (patch.ai && patch.ai.api) {
    const cur = ai.providers[pid] || { models: [], fetchedAt: 0, listSource: '' };
    const next = { ...cur, baseUrl: api.baseUrl || cur.baseUrl || '', format: api.format || cur.format || 'openai' };
    if ('apiKey' in patch.ai.api) next.apiKey = api.apiKey;
    else if (!cur.apiKey && api.apiKey) next.apiKey = api.apiKey;
    if (api.model && !(next.models || []).some(m => m.id === api.model)) next.models = (next.models || []).concat([{ id: api.model, enabled: true, manual: true }]);
    else if (api.model) next.models = next.models.map(m => (m.id === api.model ? { ...m, enabled: true } : m));
    ai.providers[pid] = next;
  } else if (pp) {
    const p = ai.providers[pid];
    if ('baseUrl' in pp) api.baseUrl = p.baseUrl;
    if ('format' in pp) api.format = p.format;
    if ('apiKey' in pp) api.apiKey = p.apiKey;
  }
}
function getProviderKey(pid) { const p = ((settingsFile.data.ai || {}).providers || {})[pid]; return p ? decKey(p.apiKey) : ''; }
// Make (provider, model) the active chat model. 'local' selects a local target ('llama:<id>' | 'mlx:<id>' | 'fw:<fw>:<model>').
function setActiveModel(pid, model) {
  const ai = settingsFile.data.ai;
  if (pid === 'local') {
    ai.source = 'local';
    ai.local.roles = { ...(ai.local.roles || {}), chat: String(model || '') };
  } else {
    const p = (ai.providers || {})[pid];
    if (!p) throw new Error('unknown provider ' + pid);
    const def = require('./v36/v36').API_PROVIDERS[pid] || {};
    ai.api = { ...ai.api, preset: pid, format: p.format || def.format || 'openai', baseUrl: p.baseUrl || def.baseUrl || '', apiKey: p.apiKey || '', model: String(model || '') };
    ai.source = 'api';
  }
  settingsFile.save();
  return publicSettings();
}

function searchUrl(q) {
  const s = settingsFile.data.search;
  let tpl = s.engine === 'custom' ? s.custom : (ENGINES[s.engine] || ENGINES.bing).url;
  if (!tpl || !tpl.includes('%s')) tpl = ENGINES.bing.url;
  return tpl.replace('%s', encodeURIComponent(q));
}
function searchEngineInfo() {
  const s = settingsFile.data.search;
  if (s.engine === 'custom') return { id: 'custom', template: s.custom };
  return { id: s.engine, template: (ENGINES[s.engine] || ENGINES.bing).url };
}

// ---- history
function addHistory(url, title, opts) {
  if (opts && opts.private) return; // incognito never writes history
  if (!/^https?:/i.test(url)) return;
  const h = historyFile.data;
  const last = h[0];
  if (last && last.url === url) { if (title) last.title = title; last.time = Date.now(); }
  else h.unshift({ url, title: title || url, time: Date.now() });
  if (h.length > 5000) h.length = 5000;
  historyFile.save();
}
function updateHistoryTitle(url, title, opts) {
  if (opts && opts.private) return; // incognito titles must not leak into the normal store
  const e = historyFile.data.find(x => x.url === url);
  if (e && title) { e.title = title; historyFile.save(); }
}
function listHistory(q) {
  q = (q || '').toLowerCase();
  const h = historyFile.data;
  return (q ? h.filter(x => (x.title + ' ' + x.url).toLowerCase().includes(q)) : h).slice(0, 500);
}
// range: 'hour' | 'day' | 'week' | 'all' (default all). Returns the number of removed entries.
const RANGE_MS = { hour: 3600e3, day: 86400e3, week: 7 * 86400e3 };
function historyCutoff(range) { return RANGE_MS[range] ? Date.now() - RANGE_MS[range] : 0; }
function countHistory(range) { const c = historyCutoff(range); return historyFile.data.filter(x => !c || (x.time || 0) >= c).length; }
function clearHistory(range) {
  const c = historyCutoff(range), before = historyFile.data.length;
  historyFile.data = c ? historyFile.data.filter(x => (x.time || 0) < c) : [];
  historyFile.save(true); return before - historyFile.data.length;
}
function deleteHistory(url) { historyFile.data = historyFile.data.filter(x => x.url !== url); historyFile.save(); }

// ---- bookmarks
function listBookmarks(q) {
  q = (q || '').toLowerCase();
  const b = bookmarksFile.data;
  return q ? b.filter(x => (x.title + ' ' + x.url).toLowerCase().includes(q)) : b;
}
function isBookmarked(url) { return bookmarksFile.data.some(b => b.url === url); }
function toggleBookmark(url, title) {
  const i = bookmarksFile.data.findIndex(b => b.url === url);
  if (i >= 0) bookmarksFile.data.splice(i, 1);
  else bookmarksFile.data.unshift({ url, title: title || url, time: Date.now() });
  bookmarksFile.save(true);
  return i < 0;
}
function removeBookmark(url) { bookmarksFile.data = bookmarksFile.data.filter(b => b.url !== url); bookmarksFile.save(true); }

// ---- downloads
function downloads() { return downloadsFile.data; }
function saveDownloads() { downloadsFile.save(); }

function listChats() { return chatBag ? chatBag.list() : []; }
function getChat(id) { return chatBag ? chatBag.get(id) : null; }
function upsertChat(rec) {
  const row = chatBag.upsert(rec);
  // keep the newest threads only (v3.0.0 threads store every turn)
  const all = chatBag.all(); if (all.length > 300) { all.sort((a, b) => (b.updated || 0) - (a.updated || 0)); all.length = 300; }
  chatFile.save(); return row;
}
function deleteChat(id) { const all = chatBag ? chatBag.all() : []; const i = all.findIndex(x => x.id === id); if (i < 0) return false; all.splice(i, 1); chatFile.save(true); return true; }

function flushAll() { [settingsFile, historyFile, bookmarksFile, downloadsFile, chatFile].forEach(f => f && f.flush()); }

module.exports = {
  init, getSettings, getApiKey, getKbApiKey, getProviderKey, setActiveModel, decKey, publicSettings, patchSettings, searchUrl, searchEngineInfo, ENGINES,
  addHistory, updateHistoryTitle, listHistory, clearHistory, countHistory, deleteHistory,
  listBookmarks, isBookmarked, toggleBookmark, removeBookmark,
  downloads, saveDownloads, listChats, getChat, upsertChat, deleteChat, flushAll, DEFAULTS
};
