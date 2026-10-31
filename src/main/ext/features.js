'use strict';
// Feature Extension Standard v1 (aib-feature/1) runtime. See docs/EXTENSION_STANDARD.md
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { app, net } = require('electron');
const store = require('../store');

const STANDARD = 'aib-feature/1';
const PERMS = new Set(['storage', 'net', 'ai', 'tabs', 'panels', 'host.dictionary', 'host.geogebra']);
const HOST_PERMS = new Set(['host.dictionary', 'host.geogebra']); // builtin only
const INPUT_TYPES = new Set(['word', 'sentence', 'article', 'question', 'any']);

const hostServices = {}; // name -> object (registered by main.js)
let hooks = { openTab: () => {}, ai: null, callPanel: null };
const exts = new Map(); // id -> record

function builtinDir() {
  const p = path.join(app.getAppPath(), 'extensions', 'builtin');
  return p;
}
function userDir() { return path.join(app.getPath('userData'), 'feature-extensions'); }

function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

function safeRel(p) { return typeof p === 'string' && p && !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..'); }

function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['manifest 不是对象'];
  if (m.standard !== STANDARD) errs.push(`standard 必须为 "${STANDARD}"`);
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(m.id)) errs.push('id 必须匹配 /^[a-z0-9][a-z0-9._-]{2,63}$/');
  if (typeof m.name !== 'string' || !m.name) errs.push('name 缺失');
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) errs.push('version 必须是 x.y.z');
  if (m.update_url != null && typeof m.update_url !== 'string') errs.push('update_url 必须是字符串');
  if (!Array.isArray(m.permissions || [])) errs.push('permissions 必须是数组');
  else for (const p of m.permissions || []) if (!PERMS.has(p)) errs.push('未知权限: ' + p);
  if (!safeRel(m.entry)) errs.push('entry 必须是相对路径');
  const c = m.contributes || {};
  for (const h of c.inputHandlers || []) {
    if (!h.id || !Array.isArray(h.types) || !h.types.every(t => INPUT_TYPES.has(t))) errs.push('inputHandlers 项无效: ' + JSON.stringify(h));
  }
  for (const t of c.tools || []) {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(t.name || '') || !t.description || typeof t.parameters !== 'object') errs.push('tools 项无效: ' + (t.name || '?'));
  }
  for (const p of c.panels || []) if (!p.id || !safeRel(p.page)) errs.push('panels 项无效');
  if (c.settingsPage && !safeRel(c.settingsPage)) errs.push('settingsPage 无效');
  return errs;
}

function readManifest(dir) {
  const f = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(f, 'utf8'));
  const errs = validateManifest(m);
  if (errs.length) throw new Error(errs.join('; '));
  if (!fs.existsSync(path.join(dir, m.entry))) throw new Error('entry 文件不存在: ' + m.entry);
  return m;
}

function scan() {
  const found = new Map();
  const consider = (root, builtin) => {
    let names = [];
    try { names = fs.readdirSync(root); } catch { return; }
    for (const n of names) {
      const dir = path.join(root, n);
      try {
        if (!fs.statSync(dir).isDirectory()) continue;
        const manifest = readManifest(dir);
        const prev = found.get(manifest.id);
        if (!prev || cmpVer(manifest.version, prev.manifest.version) > 0) found.set(manifest.id, { dir, manifest, builtin: builtin && true, source: builtin ? 'builtin' : 'user' });
      } catch (e) { console.error('feature ext skipped', dir, e.message); found.set('!err:' + dir, { dir, error: e.message }); }
    }
  };
  consider(builtinDir(), true);
  consider(userDir(), false);
  return found;
}

function isEnabled(id, builtin) {
  const s = store.getSettings().extensions[id];
  return s ? s.enabled !== false : true;
}

function storageFile(id) { return path.join(app.getPath('userData'), 'feature-ext-data', id + '.json'); }
function readStorage(id) { try { return JSON.parse(fs.readFileSync(storageFile(id), 'utf8')); } catch { return {}; } }
function writeStorage(id, d) { fs.mkdirSync(path.dirname(storageFile(id)), { recursive: true }); fs.writeFileSync(storageFile(id), JSON.stringify(d)); }

function makeApi(rec) {
  const m = rec.manifest;
  const has = p => (m.permissions || []).includes(p);
  const need = p => { if (!has(p)) throw new Error(`扩展 ${m.id} 缺少权限 ${p}`); };
  const api = {
    version: 1,
    id: m.id,
    log: (...a) => console.log(`[ext:${m.id}]`, ...a.map(x => typeof x === 'string' ? x : JSON.stringify(x))),
    storage: {
      get: (k) => { need('storage'); const d = readStorage(m.id); return k == null ? d : d[k]; },
      set: (k, v) => { need('storage'); const d = readStorage(m.id); d[k] = v; writeStorage(m.id, d); }
    },
    net: {
      fetchText: async (url, opts = {}) => {
        need('net');
        if (!/^https?:\/\//i.test(url)) throw new Error('只允许 http(s)');
        const ac = new AbortController(); const t = setTimeout(() => ac.abort(), opts.timeoutMs || 10000);
        try { const r = await net.fetch(url, { signal: ac.signal }); return { status: r.status, text: (await r.text()).slice(0, 1_000_000) }; } finally { clearTimeout(t); }
      }
    },
    ai: { complete: async (prompt) => { need('ai'); if (!hooks.ai) throw new Error('AI 不可用'); return hooks.ai(typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt); } },
    tabs: { open: (url) => { need('tabs'); hooks.openTab(String(url)); } },
    panels: { call: (ctx, panelId, method, args) => { need('panels'); return hooks.callPanel(ctx, m.id, panelId, method, args); } },
    settings: { get: () => (store.getSettings().extensions[m.id] || {}).settings || {}, set: (v) => { const e = store.getSettings().extensions; store.patchSettings({ extensions: { ...e, [m.id]: { ...(e[m.id] || {}), settings: v } } }); } }
  };
  if (rec.builtin) {
    api.host = {};
    for (const p of HOST_PERMS) if (has(p) && hostServices[p.slice(5)]) api.host[p.slice(5)] = hostServices[p.slice(5)];
  }
  return Object.freeze(api);
}

function activate(rec) {
  if (rec.module) return;
  const code = fs.readFileSync(path.join(rec.dir, rec.manifest.entry), 'utf8');
  const moduleObj = { exports: {} };
  const sandbox = {
    module: moduleObj, exports: moduleObj.exports, aib: makeApi(rec),
    console: { log: (...a) => rec.api_log(...a), error: (...a) => rec.api_log(...a), warn: (...a) => rec.api_log(...a) },
    setTimeout, clearTimeout, URL, URLSearchParams, JSON, Promise, TextEncoder, TextDecoder, encodeURIComponent, decodeURIComponent,
    process: undefined, require: undefined, global: undefined
  };
  rec.api_log = (...a) => console.log(`[ext:${rec.manifest.id}]`, ...a);
  const ctx = vm.createContext(sandbox, { name: rec.manifest.id, codeGeneration: { strings: false, wasm: false } });
  new vm.Script(code, { filename: `${rec.manifest.id}/${rec.manifest.entry}` }).runInContext(ctx, { timeout: 2000 });
  rec.module = moduleObj.exports && Object.keys(moduleObj.exports).length ? moduleObj.exports : (ctx.module && ctx.module.exports) || {};
}

function reload() {
  const found = scan();
  exts.clear();
  for (const [key, v] of found) {
    if (v.error) { exts.set(key, { error: v.error, dir: v.dir, manifest: { id: key, name: path.basename(v.dir), version: '?' }, enabled: false }); continue; }
    const rec = { ...v, enabled: isEnabled(v.manifest.id) };
    exts.set(v.manifest.id, rec);
    if (rec.enabled) {
      try { activate(rec); } catch (e) { rec.error = 'activate: ' + e.message; console.error('ext activate failed', v.manifest.id, e.message); }
    }
  }
}

function list() {
  return [...exts.values()].map(r => ({
    id: r.manifest.id, name: r.manifest.name, version: r.manifest.version, description: r.manifest.description || '',
    builtin: !!r.builtin, enabled: !!r.enabled, error: r.error || null, update_url: r.manifest.update_url || '',
    permissions: r.manifest.permissions || [], contributes: r.manifest.contributes || {},
    settingsPage: r.manifest.contributes?.settingsPage ? `aibext://${r.manifest.id}/${r.manifest.contributes.settingsPage}` : null,
    panels: (r.manifest.contributes?.panels || []).map(p => ({ ...p, url: `aibext://${r.manifest.id}/${p.page}` })),
    i18n: r.manifest.i18n || null, dir: r.dir
  }));
}

function setEnabled(id, v) {
  const e = store.getSettings().extensions;
  store.patchSettings({ extensions: { ...e, [id]: { ...(e[id] || {}), enabled: !!v } } });
  reload();
}

function active() { return [...exts.values()].filter(r => r.enabled && r.module && !r.error); }

async function withTimeout(p, ms, label) {
  let t;
  try { return await Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' 超时')), ms); })]); } finally { clearTimeout(t); }
}

// Input handlers: first enabled handler (by priority) matching the kind that returns a non-null result wins.
async function runInputHandlers(kind, input, ctx) {
  const cands = [];
  for (const r of active()) {
    for (const h of r.manifest.contributes?.inputHandlers || []) {
      if (h.types.includes(kind) || h.types.includes('any')) cands.push({ r, h, prio: h.priority || 0 });
    }
  }
  cands.sort((a, b) => b.prio - a.prio);
  for (const c of cands) {
    const fn = c.r.module.inputHandlers && c.r.module.inputHandlers[c.h.id];
    if (typeof fn !== 'function') continue;
    try {
      const res = await withTimeout(Promise.resolve(fn(input, ctx)), 30000, c.r.manifest.id + ':' + c.h.id);
      if (res != null) return { extId: c.r.manifest.id, handlerId: c.h.id, result: res };
    } catch (e) { console.error('input handler failed', c.r.manifest.id, e.message); }
  }
  return null;
}

function listTools() {
  const out = []; const seen = new Set();
  for (const r of active()) for (const t of r.manifest.contributes?.tools || []) {
    if (seen.has(t.name) || typeof r.module.tools?.[t.name] !== 'function') continue;
    seen.add(t.name);
    out.push({ name: t.name, description: t.description, parameters: t.parameters, extId: r.manifest.id });
  }
  return out;
}
async function callTool(name, args, ctx) {
  for (const r of active()) {
    const decl = (r.manifest.contributes?.tools || []).find(t => t.name === name);
    if (decl && typeof r.module.tools?.[name] === 'function') {
      return withTimeout(Promise.resolve(r.module.tools[name](args, ctx)), 30000, 'tool ' + name);
    }
  }
  throw new Error('未知工具: ' + name);
}
async function rpc(extId, name, args, ctx) {
  const r = exts.get(extId);
  if (!r || !r.enabled || !r.module) throw new Error('扩展未启用: ' + extId);
  const fn = r.module.rpc && r.module.rpc[name];
  if (typeof fn !== 'function') throw new Error('未知 RPC: ' + name);
  return withTimeout(Promise.resolve(fn(args, ctx)), 30000, 'rpc ' + name);
}

function fileFor(extId, rel) {
  const r = exts.get(extId);
  if (!r || r.error || !r.enabled) return null;
  const root = path.resolve(r.dir);
  const f = path.resolve(root, decodeURIComponent(rel).replace(/^\/+/, ''));
  if (!f.startsWith(root + path.sep)) return null;
  try { if (fs.statSync(f).isFile()) return f; } catch {}
  return null;
}

// ---- install / update
function installFromDir(srcDir) {
  const manifest = readManifest(srcDir);
  const dest = path.join(userDir(), manifest.id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(srcDir, dest, { recursive: true });
  reload();
  return manifest;
}
function installFromFiles(files) { // {relpath: content}
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'aibext-'));
  for (const [rel, content] of Object.entries(files)) {
    if (!safeRel(rel)) throw new Error('非法文件路径: ' + rel);
    const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content);
  }
  try { return installFromDir(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function installFromZip(zipPath) {
  const AdmZip = require('adm-zip');
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'aibext-'));
  const z = new AdmZip(zipPath);
  for (const e of z.getEntries()) { if (!safeRel(e.entryName.replace(/\/$/, '') || 'x')) throw new Error('zip 含非法路径'); }
  z.extractAllTo(tmp, true);
  let root = tmp;
  if (!fs.existsSync(path.join(root, 'manifest.json'))) {
    const sub = fs.readdirSync(tmp).find(n => fs.existsSync(path.join(tmp, n, 'manifest.json')));
    if (sub) root = path.join(tmp, sub);
  }
  try { return installFromDir(root); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function uninstall(id) {
  const r = exts.get(id);
  if (!r) return;
  if (r.source === 'user') fs.rmSync(r.dir, { recursive: true, force: true });
  reload();
}

// update_url returns JSON: {version, zip_url, sha256?}
async function checkUpdate(id, install) {
  const r = exts.get(id);
  if (!r) throw new Error('未知扩展');
  const url = r.manifest.update_url;
  if (!url) return { id, current: r.manifest.version, latest: r.manifest.version, upToDate: true, note: 'no update_url' };
  const res = await net.fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const upToDate = cmpVer(j.version, r.manifest.version) <= 0;
  const out = { id, current: r.manifest.version, latest: j.version, upToDate };
  if (!upToDate && install) {
    const zr = await net.fetch(new URL(j.zip_url, url).href);
    if (!zr.ok) throw new Error('下载失败 HTTP ' + zr.status);
    const buf = Buffer.from(await zr.arrayBuffer());
    if (j.sha256) {
      const h = require('crypto').createHash('sha256').update(buf).digest('hex');
      if (h !== j.sha256) throw new Error('sha256 校验失败');
    }
    const tmp = path.join(app.getPath('temp'), 'aibext-' + Date.now() + '.zip');
    fs.writeFileSync(tmp, buf);
    try {
      const m = installFromZip(tmp);
      if (m.id !== id) throw new Error('更新包 id 不匹配');
      out.installed = m.version;
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  return out;
}

function setHooks(h) { hooks = { ...hooks, ...h }; }
function registerHost(name, svc) { hostServices[name] = svc; }

module.exports = { reload, list, setEnabled, runInputHandlers, listTools, callTool, rpc, fileFor, installFromDir, installFromFiles, installFromZip, uninstall, checkUpdate, setHooks, registerHost, validateManifest, readManifest, STANDARD };
