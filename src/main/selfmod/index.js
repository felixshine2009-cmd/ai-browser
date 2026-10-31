'use strict';
// AI self-modifying code: patches live ONLY under userData/overlays (+ history).
// The app bundle / asar is never overwritten. Blocked paths: passwords, secrets, store keys, preload.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const crypto = require('crypto');

const BLOCK = [
  /^src\/main\/passwords/i, /password/i, /secret/i, /safeStorage/i,
  /preload/i, /store\.js$/i, /\.pem$/i, /\.key$/i, /credentials/i,
  /node_modules/i, /^\.\./, /^\/|^[A-Za-z]:/
];
const ALLOW_PREFIX = [
  'src/renderer/pages/', 'src/renderer/static/',
  'extensions/builtin/', 'web/', 'docs/wiki/'
];

function root() {
  try { return path.join(app.getPath('userData'), 'selfmod'); }
  catch { return path.join(require('os').tmpdir(), 'aib-selfmod-fallback'); }
}
function overlayDir() { return path.join(root(), 'overlay'); }
function historyDir() { return path.join(root(), 'history'); }
function stateFile() { return path.join(root(), 'state.json'); }

function ensure() {
  fs.mkdirSync(overlayDir(), { recursive: true });
  fs.mkdirSync(historyDir(), { recursive: true });
  if (!fs.existsSync(stateFile())) fs.writeFileSync(stateFile(), JSON.stringify({ safeMode: false, lastCrash: 0, pending: null, applied: [], crashCount: 0 }, null, 2));
}
function readState() { ensure(); try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return { safeMode: false, applied: [], crashCount: 0 }; } }
function writeState(s) { ensure(); fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2)); }

function normalizeRel(p) {
  p = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (p.startsWith('ai-browser/')) p = p.slice('ai-browser/'.length);
  return p;
}

function assertAllowed(rel) {
  rel = normalizeRel(rel);
  if (!rel) throw new Error('empty path');
  if (BLOCK.some(r => r.test(rel))) throw new Error('blocked path (passwords/secrets/preload/store): ' + rel);
  if (!ALLOW_PREFIX.some(pre => rel.startsWith(pre))) throw new Error('path outside sandbox allow-list: ' + rel + ' (allowed: renderer, builtin extensions, web, docs/wiki)');
  if (rel.includes('..')) throw new Error('path traversal blocked');
  return rel;
}

function bundlePath(rel) {
  // Prefer app path (packaged or project root when running from source)
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', '..');
  // In packaged app, renderer lives under app.asar / resources/app
  const candidates = [
    path.join(app.getAppPath(), rel),
    path.join(base, rel),
    path.join(__dirname, '..', '..', '..', rel)
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

function overlayPath(rel) { return path.join(overlayDir(), rel); }

function readCurrent(rel) {
  rel = assertAllowed(rel);
  const o = overlayPath(rel);
  if (!readState().safeMode && fs.existsSync(o)) return fs.readFileSync(o, 'utf8');
  const b = bundlePath(rel);
  if (fs.existsSync(b)) return fs.readFileSync(b, 'utf8');
  return null;
}

function unifiedDiff(rel, before, after) {
  const a = (before == null ? '' : before).split(/\r?\n/);
  const b = (after == null ? '' : after).split(/\r?\n/);
  const lines = [`--- a/${rel}`, `+++ b/${rel}`];
  // simple line diff (Myers not needed): show all removed then all added with context markers
  const max = Math.max(a.length, b.length);
  let hunk = [];
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] != null && b[i] == null) hunk.push('-' + a[i]);
    else if (a[i] == null && b[i] != null) hunk.push('+' + b[i]);
    else { hunk.push('-' + a[i]); hunk.push('+' + b[i]); }
  }
  if (!hunk.length) return lines.concat(['@@ unchanged @@']).join('\n');
  lines.push(`@@ changes ${hunk.length} lines @@`);
  return lines.concat(hunk).join('\n');
}

function propose({ title, description, files }) {
  ensure();
  if (!Array.isArray(files) || !files.length) throw new Error('files[] required');
  const id = 'p' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const entries = files.map(f => {
    const rel = assertAllowed(f.path);
    const before = readCurrent(rel);
    const after = f.content != null ? String(f.content) : (f.new != null ? String(f.new) : null);
    if (after == null && f.action !== 'delete') throw new Error('content required for ' + rel);
    return {
      path: rel,
      action: f.action || (before == null ? 'create' : (after == null ? 'delete' : 'modify')),
      before, after,
      diff: unifiedDiff(rel, before, after == null ? '' : after)
    };
  });
  const patch = { id, title: title || id, description: description || '', files: entries, createdAt: Date.now(), status: 'pending' };
  const st = readState();
  st.pending = patch;
  writeState(st);
  fs.writeFileSync(path.join(historyDir(), id + '.json'), JSON.stringify(patch, null, 2));
  return { id, title: patch.title, description: patch.description, status: 'pending', files: entries.map(e => ({ path: e.path, action: e.action, diff: e.diff })) };
}

function pending() { return readState().pending; }

function apply(id) {
  ensure();
  const st = readState();
  const patch = (st.pending && st.pending.id === id) ? st.pending : (() => {
    const f = path.join(historyDir(), id + '.json');
    if (!fs.existsSync(f)) throw new Error('unknown patch ' + id);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  })();
  if (st.safeMode) throw new Error('safe mode is on — disable it before applying overlays');
  for (const f of patch.files) {
    assertAllowed(f.path);
    const dest = overlayPath(f.path);
    if (f.action === 'delete') {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.after == null ? '' : f.after);
    }
  }
  patch.status = 'applied';
  patch.appliedAt = Date.now();
  st.pending = null;
  st.applied = (st.applied || []).filter(x => x.id !== id);
  st.applied.unshift({ id: patch.id, title: patch.title, appliedAt: patch.appliedAt, files: patch.files.map(f => f.path) });
  writeState(st);
  fs.writeFileSync(path.join(historyDir(), id + '.json'), JSON.stringify(patch, null, 2));
  return { ok: true, id, applied: st.applied[0] };
}

function reject(id) {
  const st = readState();
  if (st.pending && (!id || st.pending.id === id)) {
    const p = st.pending; p.status = 'rejected'; p.rejectedAt = Date.now();
    fs.writeFileSync(path.join(historyDir(), p.id + '.json'), JSON.stringify(p, null, 2));
    st.pending = null; writeState(st); return { ok: true, rejected: p.id };
  }
  throw new Error('no pending patch');
}

function rollback(id) {
  ensure();
  const st = readState();
  const f = path.join(historyDir(), id + '.json');
  if (!fs.existsSync(f)) throw new Error('unknown patch ' + id);
  const patch = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const file of patch.files) {
    assertAllowed(file.path);
    const dest = overlayPath(file.path);
    if (file.before == null) {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.before);
    }
  }
  patch.status = 'rolled_back'; patch.rolledBackAt = Date.now();
  fs.writeFileSync(f, JSON.stringify(patch, null, 2));
  st.applied = (st.applied || []).filter(x => x.id !== id);
  writeState(st);
  return { ok: true, id, status: 'rolled_back' };
}

function history() {
  ensure();
  return fs.readdirSync(historyDir()).filter(n => n.endsWith('.json')).map(n => {
    try { const p = JSON.parse(fs.readFileSync(path.join(historyDir(), n), 'utf8')); return { id: p.id, title: p.title, status: p.status, createdAt: p.createdAt, appliedAt: p.appliedAt, files: (p.files||[]).map(f => f.path) }; } catch { return null; }
  }).filter(Boolean).sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
}

function setSafeMode(on) { const st = readState(); st.safeMode = !!on; writeState(st); return { safeMode: st.safeMode }; }
function markCrash() { const st = readState(); st.lastCrash = Date.now(); st.crashCount = (st.crashCount||0)+1; if (st.crashCount >= 2) st.safeMode = true; writeState(st); }
function markCleanBoot() { const st = readState(); st.crashCount = 0; writeState(st); }

function resolveOverlay(relFromBundle) {
  // used by protocol: map renderer relative path to overlay if present
  let st;
  try { st = readState(); } catch { return null; }
  if (st.safeMode) return null;
  const candidates = [
    'src/renderer/' + relFromBundle.replace(/^\/+/, ''),
    relFromBundle.replace(/^\/+/, '')
  ];
  for (const rel of candidates) {
    try {
      const n = normalizeRel(rel);
      if (!ALLOW_PREFIX.some(pre => n.startsWith(pre)) && !n.startsWith('src/renderer/')) continue;
      const o = overlayPath(n.startsWith('src/renderer/') ? n : 'src/renderer/' + n);
      if (fs.existsSync(o)) return o;
      // also try pages/static directly under overlay/src/renderer
      const o2 = overlayPath(n);
      if (fs.existsSync(o2)) return o2;
    } catch {}
  }
  return null;
}

module.exports = {
  propose, pending, apply, reject, rollback, history, setSafeMode, markCrash, markCleanBoot,
  readCurrent, resolveOverlay, readState, assertAllowed, ALLOW_PREFIX
};
