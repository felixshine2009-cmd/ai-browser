'use strict';
// Chrome-compatible (MV3, best effort) extensions through Electron's session.extensions.
const fs = require('fs');
const path = require('path');
const { app, session } = require('electron');
const store = require('../store');

function ses() { return session.defaultSession; }
function extApi() { return ses().extensions || ses(); }
function dirRoot() { return path.join(app.getPath('userData'), 'chrome-extensions'); }

function unpackCrx(buf) {
  // CRX3: "Cr24" + version(4) + headerLen(4) + header + zip ; CRX2: "Cr24" + ver(4)+ pubkeyLen(4)+sigLen(4)+...
  if (buf.slice(0, 4).toString() !== 'Cr24') return buf;
  const ver = buf.readUInt32LE(4);
  if (ver === 3) return buf.slice(12 + buf.readUInt32LE(8));
  if (ver === 2) return buf.slice(16 + buf.readUInt32LE(8) + buf.readUInt32LE(12));
  throw new Error('不支持的 CRX 版本 ' + ver);
}

function extractToStore(file) {
  const AdmZip = require('adm-zip');
  let buf = fs.readFileSync(file);
  buf = unpackCrx(buf);
  const name = path.basename(file).replace(/\.(crx|zip)$/i, '').replace(/[^\w.-]+/g, '_') + '-' + Date.now().toString(36);
  const dest = path.join(dirRoot(), name);
  fs.mkdirSync(dest, { recursive: true });
  new AdmZip(buf).extractAllTo(dest, true);
  if (!fs.existsSync(path.join(dest, 'manifest.json'))) {
    const sub = fs.readdirSync(dest).find(n => fs.existsSync(path.join(dest, n, 'manifest.json')));
    if (sub) return path.join(dest, sub);
    throw new Error('压缩包中没有 manifest.json');
  }
  return dest;
}

function describe(ext, entry) {
  const m = ext.manifest || {};
  const action = m.action || m.browser_action || {};
  const popup = action.default_popup;
  return {
    id: ext.id, name: m.name || ext.name, version: m.version, description: m.description || '',
    mv: m.manifest_version, path: entry.path, enabled: entry.enabled !== false,
    popupUrl: popup ? `chrome-extension://${ext.id}/${popup}` : null,
    optionsUrl: (m.options_page || m.options_ui?.page) ? `chrome-extension://${ext.id}/${m.options_page || m.options_ui.page}` : null
  };
}

const live = new Map(); // path -> electron Extension

async function loadOne(entry) {
  if (live.has(entry.path)) return live.get(entry.path);
  const ext = await extApi().loadExtension(entry.path, { allowFileAccess: true });
  live.set(entry.path, ext);
  return ext;
}

async function init() {
  for (const e of store.getSettings().chromeExtensions || []) {
    if (e.enabled === false) continue;
    try { await loadOne(e); } catch (err) { console.error('chrome ext load failed', e.path, err.message); }
  }
}

async function add(srcPath) {
  let dir = srcPath;
  const st = fs.statSync(srcPath);
  if (st.isFile()) dir = extractToStore(srcPath);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('该文件夹没有 manifest.json');
  const entry = { path: dir, enabled: true };
  const ext = await loadOne(entry);
  const list = (store.getSettings().chromeExtensions || []).filter(x => x.path !== dir);
  list.push(entry);
  store.patchSettings({ chromeExtensions: list });
  return describe(ext, entry);
}

async function list() {
  const out = [];
  for (const e of store.getSettings().chromeExtensions || []) {
    const ext = live.get(e.path);
    if (ext) out.push(describe(ext, e));
    else {
      let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(e.path, 'manifest.json'), 'utf8')); } catch {}
      out.push({ id: '', name: m.name || path.basename(e.path), version: m.version, description: m.description || '', mv: m.manifest_version, path: e.path, enabled: false });
    }
  }
  return out;
}

async function setEnabled(p, v) {
  const l = (store.getSettings().chromeExtensions || []).map(x => x.path === p ? { ...x, enabled: !!v } : x);
  store.patchSettings({ chromeExtensions: l });
  const entry = l.find(x => x.path === p);
  if (v) await loadOne(entry);
  else { const ext = live.get(p); if (ext) { try { await extApi().removeExtension(ext.id); } catch {} live.delete(p); } }
}

async function remove(p) {
  await setEnabled(p, false).catch(() => {});
  store.patchSettings({ chromeExtensions: (store.getSettings().chromeExtensions || []).filter(x => x.path !== p) });
  if (p.startsWith(dirRoot())) fs.rmSync(p, { recursive: true, force: true });
}

function installFiles(files, name) {
  const dest = path.join(dirRoot(), (name || 'ai-ext').replace(/[^\w.-]+/g, '_') + '-' + Date.now().toString(36));
  for (const [rel, content] of Object.entries(files)) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('非法文件路径');
    const f = path.join(dest, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content);
  }
  return add(dest);
}

module.exports = { init, add, list, setEnabled, remove, installFiles };
