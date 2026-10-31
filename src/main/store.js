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
    local: { modelPath: '', modelId: '', translateModelId: '', hfMirror: false, contextSize: 4096 }
  },
  dicts: [], // {id,name,mdx,mdd:[],enabled}
  extensions: {}, // id -> {enabled, settings}
  chromeExtensions: [], // {id?, path, enabled}
  selectionLookup: true,
  displayName: 'Felix', // home greeting: {name}
  greeting: '', // '' = localized default
  hideSpark: false
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

let settingsFile, historyFile, bookmarksFile, downloadsFile;

function init() {
  settingsFile = new JsonFile('settings.json', {});
  settingsFile.data = deepMerge(DEFAULTS, settingsFile.data);
  historyFile = new JsonFile('history.json', []);
  bookmarksFile = new JsonFile('bookmarks.json', []);
  downloadsFile = new JsonFile('downloads.json', []);
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
function getApiKey() { return decKey(settingsFile.data.ai.api.apiKey); }
// Settings as exposed to renderer pages: the key is never sent out.
function publicSettings() {
  const s = JSON.parse(JSON.stringify(settingsFile.data));
  s.ai.api.hasKey = !!s.ai.api.apiKey;
  s.ai.api.apiKey = '';
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
  if (patch.dicts) settingsFile.data.dicts = patch.dicts, delete patch.dicts;
  if (patch.chromeExtensions) settingsFile.data.chromeExtensions = patch.chromeExtensions, delete patch.chromeExtensions;
  settingsFile.data = deepMerge(settingsFile.data, patch);
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
function addHistory(url, title) {
  if (!/^https?:/i.test(url)) return;
  const h = historyFile.data;
  const last = h[0];
  if (last && last.url === url) { if (title) last.title = title; last.time = Date.now(); }
  else h.unshift({ url, title: title || url, time: Date.now() });
  if (h.length > 5000) h.length = 5000;
  historyFile.save();
}
function updateHistoryTitle(url, title) {
  const e = historyFile.data.find(x => x.url === url);
  if (e && title) { e.title = title; historyFile.save(); }
}
function listHistory(q) {
  q = (q || '').toLowerCase();
  const h = historyFile.data;
  return (q ? h.filter(x => (x.title + ' ' + x.url).toLowerCase().includes(q)) : h).slice(0, 500);
}
function clearHistory() { historyFile.data = []; historyFile.save(true); }
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

function flushAll() { [settingsFile, historyFile, bookmarksFile, downloadsFile].forEach(f => f && f.flush()); }

module.exports = {
  init, getSettings, getApiKey, publicSettings, patchSettings, searchUrl, searchEngineInfo, ENGINES,
  addHistory, updateHistoryTitle, listHistory, clearHistory, deleteHistory,
  listBookmarks, isBookmarked, toggleBookmark, removeBookmark,
  downloads, saveDownloads, flushAll, DEFAULTS
};
