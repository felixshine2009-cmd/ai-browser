'use strict';
// Feature Extension Standard v1 (aib-feature/1) runtime. See docs/EXTENSION_STANDARD.md
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { app, net } = require('electron');
const store = require('../store');

const STANDARD = 'aib-feature/1';
const PERMS = new Set(['storage', 'net', 'ai', 'tabs', 'panels', 'browser', 'host.dictionary', 'host.geogebra', 'host.physics']);
const HOST_PERMS = new Set(['host.dictionary', 'host.geogebra', 'host.physics']); // builtin only
const INPUT_TYPES = new Set(['word', 'sentence', 'article', 'question', 'any']);
// v3.1 extension framework: the browser core keeps tabs / web views, the AI chat engine and its answer format,
// settings, storage, the tool registry and this extension host; every built-in feature is a bundled first-party
// extension that declares what it adds through the contribution points below (docs: aib.docs → aibrowser://docs).
const FRAMEWORK = 2; // contribution-point API level (1 = inputHandlers / tools / panels / settingsPage only)
const PLATFORMS = new Set(['desktop', 'ipad']);
const ACTIONS = new Set(['toolView', 'command', 'page', 'panel']);
const BUILTIN_ACTIONS = new Set(['toolView', 'command']); // reach host commands / tool views: first-party only
const COMMANDS = new Set(['scan:qr', 'snap:solve']);      // host commands a first-party tool tile may run
const SLUG = /^[a-z][a-z0-9_-]{1,31}$/;
const SVG_TAGS = /^(path|circle|ellipse|rect|line|polyline|polygon|g)$/;
const SVG_ATTRS = /^(d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|width|height|points|transform|fill|stroke-width|opacity)$/;

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
  errs.push(...validateContributions(m, c));
  if (m.engines != null) {
    const need = m.engines && /^>=\s*(\d+)$/.exec(String(m.engines.framework || ''));
    if (!need) errs.push('engines.framework 必须形如 ">=2"');
    else if (+need[1] > FRAMEWORK) errs.push(`需要拓展框架 ${need[1]} 级，当前为 ${FRAMEWORK} 级，请先更新浏览器`);
  }
  if (m.platforms != null && (!Array.isArray(m.platforms) || !m.platforms.length || !m.platforms.every(x => PLATFORMS.has(x)))) errs.push('platforms 只能包含 desktop / ipad');
  return errs;
}

const isText = (v) => (typeof v === 'string' && v.trim()) || (v && typeof v === 'object' && typeof v.zh === 'string' && v.zh.trim());
const arr = (v) => (v == null ? [] : v);
// v3.1 contribution points. `builtin` is decided by where the extension lives, never by the manifest; the checks that
// need it run again in scan() (aibrowser:// routes and host actions are first-party only).
function validateContributions(m, c) {
  const errs = [];
  const bad = (k, x, why) => errs.push(`${k} 项无效${why ? '（' + why + '）' : ''}: ` + JSON.stringify(x).slice(0, 120));
  for (const k of ['toolPanel', 'homepage', 'answerBlocks', 'settingsPages', 'importers', 'urlSchemes', 'nativeViews']) {
    if (c[k] != null && !Array.isArray(c[k])) errs.push(k + ' 必须是数组');
  }
  const tiles = new Set();
  for (const t of Array.isArray(c.toolPanel) ? c.toolPanel : []) {
    const a = t && t.action || {};
    if (!t || !SLUG.test(t.id || '')) { bad('toolPanel', t, 'id'); continue; }
    if (!isText(t.label)) bad('toolPanel', t, 'label');
    if (!ACTIONS.has(a.type)) bad('toolPanel', t, 'action.type 只能是 toolView / command / page / panel');
    if (a.type === 'command' && !COMMANDS.has(a.command)) bad('toolPanel', t, '未知命令');
    if (a.type === 'page' && !safeRel(a.page)) bad('toolPanel', t, 'action.page');
    if (a.type === 'panel' && !(c.panels || []).some(p => p.id === a.panel)) bad('toolPanel', t, 'action.panel 未在 panels 中声明');
    if (t.platforms != null && (!Array.isArray(t.platforms) || !t.platforms.every(x => PLATFORMS.has(x)))) bad('toolPanel', t, 'platforms');
    if (t.icon != null && typeof t.icon !== 'string' && !(t.icon && typeof t.icon.svg === 'string')) bad('toolPanel', t, 'icon');
    tiles.add(t.id);
  }
  for (const h of Array.isArray(c.homepage) ? c.homepage : []) if (!h || !tiles.has(h.tool)) bad('homepage', h, 'tool 必须引用本拓展的 toolPanel');
  for (const b of Array.isArray(c.answerBlocks) ? c.answerBlocks : []) if (!b || !SLUG.test(b.lang || '') || !/^[A-Za-z_]\w{0,40}$/.test(b.handler || '')) bad('answerBlocks', b);
  for (const p of Array.isArray(c.settingsPages) ? c.settingsPages : []) if (!p || !SLUG.test(p.id || '') || !isText(p.title) || !safeRel(p.page)) bad('settingsPages', p);
  for (const i of Array.isArray(c.importers) ? c.importers : []) {
    if (!i || !SLUG.test(i.id || '') || !Array.isArray(i.extensions) || !i.extensions.length || !i.extensions.every(e => /^[a-z0-9]{1,10}$/.test(e))) { bad('importers', i); continue; }
    if (i.utTypes != null && (!Array.isArray(i.utTypes) || !i.utTypes.every(u => /^[A-Za-z0-9.-]{3,80}$/.test(u)))) bad('importers', i, 'utTypes');
    if (!/^[A-Za-z_]\w{0,40}$/.test(i.rpc || '')) bad('importers', i, 'rpc');
  }
  for (const u of Array.isArray(c.urlSchemes) ? c.urlSchemes : []) if (!u || u.scheme !== 'aibrowser' || !SLUG.test(u.host || '') || !safeRel(u.page)) bad('urlSchemes', u);
  for (const v of Array.isArray(c.nativeViews) ? c.nativeViews : []) if (!v || !SLUG.test(v.id || '') || !/^[A-Z][A-Za-z0-9]{1,60}$/.test(v.swift || '') || (v.fallback != null && !safeRel(v.fallback))) bad('nativeViews', v);
  return errs;
}
// first-party-only parts of a manifest; user extensions that declare them are refused at scan / install time
function firstPartyOnly(m) {
  const c = m.contributes || {}; const out = [];
  if (arr(c.urlSchemes).length) out.push('urlSchemes（aibrowser:// 地址）');
  if (arr(c.nativeViews).length) out.push('nativeViews（原生视图）');
  if (arr(c.toolPanel).some(t => BUILTIN_ACTIONS.has(t.action && t.action.type))) out.push('toolPanel 的 toolView / command 动作');
  return out;
}
// tile icons from a manifest: a built-in icon name ("builtin:dict") or a small line drawing; only plain shape
// elements and geometry attributes survive, so a manifest cannot put markup or script into the toolbar
function sanitizeSvg(src) {
  const out = []; const re = /<\s*([a-z]+)((?:\s+[a-z0-9-]+\s*=\s*"[^"<>]*")*)\s*\/?\s*>|<\s*\/\s*(g)\s*>/gi; let mm;
  const s = String(src || '').slice(0, 8000);
  while ((mm = re.exec(s))) {
    if (mm[3]) { out.push('</g>'); continue; }
    const tag = mm[1].toLowerCase(); if (!SVG_TAGS.test(tag)) continue;
    const attrs = []; const ar = /([a-z0-9-]+)\s*=\s*"([^"<>]*)"/gi; let a;
    while ((a = ar.exec(mm[2]))) { const k = a[1].toLowerCase(); if (SVG_ATTRS.test(k) && /^[-0-9.,\s a-zA-Z()#%]*$/.test(a[2]) && !/url|script|expression/i.test(a[2])) attrs.push(`${k}="${a[2]}"`); }
    out.push(`<${tag} ${attrs.join(' ')}${tag === 'g' ? '>' : '/>'}`);
  }
  return out.join('');
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
        if (!builtin) { const fp = firstPartyOnly(manifest); if (fp.length) throw new Error('仅内置拓展可以使用：' + fp.join('、')); }
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
    panels: { call: (ctx, panelId, method, args, opts) => { need('panels'); return hooks.callPanel(ctx, m.id, panelId, method, args, opts && typeof opts === 'object' ? { timeoutMs: opts.timeoutMs, timeoutMsg: opts.timeoutMsg ? String(opts.timeoutMsg) : undefined } : {}); } },
    settings: { get: () => (store.getSettings().extensions[m.id] || {}).settings || {}, set: (v) => { const e = store.getSettings().extensions; store.patchSettings({ extensions: { ...e, [m.id]: { ...(e[m.id] || {}), settings: v } } }); } },
    browser: {
      get: () => { need('browser'); return store.publicSettings(); },
      patch: (p) => { need('browser'); const s = require('../v36/v36').sanitizePluginPatch(p); if (Object.keys(s.patch).length) store.patchSettings(s.patch); return s; }
    }
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
    platforms: r.manifest.platforms || null, engines: r.manifest.engines || null, source: r.source || (r.builtin ? 'builtin' : 'user'),
    settingsPage: (() => { const c = r.manifest.contributes || {}; const pg = c.settingsPage || (Array.isArray(c.settingsPages) && c.settingsPages[0] && c.settingsPages[0].page); return pg ? `aibext://${r.manifest.id}/${pg}` : null; })(),
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
  if (!ms) return p;
  let t;
  try { return await Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' 超时（' + Math.round(ms / 1000) + ' 秒）')), ms); })]); } finally { clearTimeout(t); }
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
      // panel-backed tools (GeoGebra, physics lab) wait for a heavy offline applet to load on first use: on an iPad
      // that alone can take well over 30 s, which used to surface as a false "超时" while the drawing still appeared.
      const ms = Number(decl.timeoutMs) || ((r.manifest.permissions || []).includes('panels') ? 120000 : 30000);
      return withTimeout(Promise.resolve(r.module.tools[name](args, ctx)), ms, '工具 ' + name + ' 执行');
    }
  }
  throw new Error('未知工具: ' + name);
}
async function rpc(extId, name, args, ctx) {
  const r = exts.get(extId);
  if (!r || !r.enabled || !r.module) throw new Error('扩展未启用: ' + extId);
  const fn = r.module.rpc && r.module.rpc[name];
  if (typeof fn !== 'function') throw new Error('未知 RPC: ' + name);
  // RPCs that open a file picker wait for the user (browsing Files can take minutes); a time limit here made the
  // dictionary import silently fail when the user tapped Open after 30 seconds (2.3.1)
  return withTimeout(Promise.resolve(fn(args, ctx)), /^pick/i.test(name) ? 0 : 30000, 'rpc ' + name);
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
  { const fp = firstPartyOnly(manifest); if (fp.length) throw new Error('仅内置拓展可以使用：' + fp.join('、')); }
  if (/^aib\./.test(manifest.id)) throw new Error('“aib.” 前缀保留给内置拓展，请改用其他 id（例如 user.' + manifest.id.slice(4) + '）');
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

// ---- v3.1 contribution points
function platform() { try { return require('../native').isIpad() ? 'ipad' : 'desktop'; } catch { return 'desktop'; } }
const onPlatform = (x, pf) => !Array.isArray(x && x.platforms) || x.platforms.includes(pf);
const textOf = (v, lang) => (typeof v === 'string' ? v : (v && (v[lang] || v.zh || v.en)) || '');
// every enabled extension's entries for one contribution point, in a stable order (order, then extension id)
function contributions(point, opts = {}) {
  const pf = opts.platform || platform(); const lang = opts.lang || (store.getSettings().lang === 'en' ? 'en' : 'zh');
  const out = [];
  for (const r of exts.values()) {
    if (!r.enabled || r.error || !r.manifest || !onPlatform(r.manifest, pf)) continue;
    const c = r.manifest.contributes || {};
    const list = point === 'settingsPages' && c.settingsPage && !arr(c.settingsPages).length ? [{ id: 'main', title: r.manifest.name, page: c.settingsPage }] : arr(c[point]);
    for (const x of list) {
      if (!onPlatform(x, pf)) continue;
      const e = { ...x, extId: r.manifest.id, builtin: !!r.builtin };
      if (point === 'toolPanel') {
        e.label = textOf(x.label, lang); e.tip = textOf(x.tip, lang) || e.label;
        e.icon = typeof x.icon === 'string' ? x.icon : (x.icon && x.icon.svg ? { svg: sanitizeSvg(x.icon.svg) } : 'builtin:' + x.id);
        e.key = r.builtin && x.action && x.action.type !== 'page' && x.action.type !== 'panel' ? x.id : r.manifest.id + ':' + x.id;
        if (x.action && x.action.type === 'page') e.url = `aibext://${r.manifest.id}/${x.action.page}`;
        if (x.action && x.action.type === 'panel') { const pn = arr(c.panels).find(pp => pp.id === x.action.panel); if (pn) e.url = `aibext://${r.manifest.id}/${pn.page}`; }
      }
      if (point === 'settingsPages' || point === 'nativeViews') { const pg = x.page || x.fallback; if (pg) e.url = `aibext://${r.manifest.id}/${pg}`; e.title = textOf(x.title, lang) || r.manifest.name; }
      out.push(e);
    }
  }
  return out.sort((a, b) => (Number(a.order) || 100) - (Number(b.order) || 100) || String(a.extId).localeCompare(String(b.extId)));
}
// the tool panel as the toolbar, the iPad popover and the home page show it
function toolPanel(opts = {}) {
  const tiles = contributions('toolPanel', opts);
  const home = contributions('homepage', opts);
  const homeKeys = new Set(home.map(h => { const t = tiles.find(x => x.extId === h.extId && x.id === h.tool); return t && t.key; }).filter(Boolean));
  return tiles.map(t => ({ key: t.key, id: t.id, extId: t.extId, builtin: t.builtin, label: t.label, tip: t.tip, icon: t.icon, action: t.action, url: t.url || null, home: homeKeys.has(t.key) }));
}
// ```lang blocks in an answer: the enabled extension that contributes the language renders / handles it
async function runAnswerBlock(lang, payload, ctx) {
  const b = contributions('answerBlocks').find(x => x.lang === lang);
  if (!b) return { error: 'disabled', lang };
  const r = exts.get(b.extId); const fn = r && r.module && r.module.answerBlocks && r.module.answerBlocks[b.handler];
  if (typeof fn !== 'function') return { error: 'no handler', lang };
  return withTimeout(Promise.resolve(fn(payload || {}, ctx || {})), Number(b.timeoutMs) || 120000, '回答块 ' + lang);
}
function answerBlockLangs() { return contributions('answerBlocks').map(b => b.lang); }
// file importers by extension name (lowercase, without the dot)
function importerFor(ext) { const e = String(ext || '').toLowerCase().replace(/^\./, ''); return contributions('importers').find(i => i.extensions.includes(e)) || null; }
async function runImporter(id, paths, ctx) {
  const i = contributions('importers').find(x => x.id === id || x.extId + ':' + x.id === id);
  if (!i) throw new Error('没有可用的导入方式：' + id);
  return rpc(i.extId, i.rpc, { paths }, ctx);
}
// aibrowser://<host>/... pages owned by a first-party extension (e.g. aibrowser://docs)
function routeFor(host, pathname) {
  const u = contributions('urlSchemes').find(x => x.builtin && x.host === host);
  if (!u) return null;
  const rel = String(pathname || '').replace(/^\/+/, '');
  const r = exts.get(u.extId);
  const f = rel && fileFor(u.extId, rel);
  return f || (r ? path.join(r.dir, u.page) : null);
}

function setHooks(h) { hooks = { ...hooks, ...h }; }
function registerHost(name, svc) { hostServices[name] = svc; }

module.exports = { FRAMEWORK, contributions, toolPanel, runAnswerBlock, answerBlockLangs, importerFor, runImporter, routeFor, sanitizeSvg, platform, reload, list, setEnabled, runInputHandlers, listTools, callTool, rpc, fileFor, installFromDir, installFromFiles, installFromZip, uninstall, checkUpdate, setHooks, registerHost, validateManifest, readManifest, STANDARD };
