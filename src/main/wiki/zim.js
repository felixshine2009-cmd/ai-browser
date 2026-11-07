'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ZimArchive } = require('./zim-reader');

let fzstd = null;
try { fzstd = require('fzstd'); } catch {}

let current = null;
let progressState = { active: false };

function zimRoot() {
  if (process.env.AIB_USER_DATA) return path.join(process.env.AIB_USER_DATA, 'zims');
  try { return path.join(require('electron').app.getPath('userData'), 'zims'); }
  catch { return path.join(process.cwd(), 'zims'); }
}
function insideRoot(p) {
  let r = path.resolve(zimRoot()) + path.sep, q = path.resolve(p || '');
  if (process.platform === 'win32') { r = r.toLowerCase(); q = q.toLowerCase(); }
  return q.startsWith(r);
}
const slug = (n) => String(n).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'encyclopedia';

function codecs() {
  return {
    inflate(u8) {
      try { return zlib.inflateSync(Buffer.from(u8)); }
      catch { return zlib.inflateRawSync(Buffer.from(u8)); }
    },
    zstd(u8) {
      if (!fzstd) throw new Error('缺少 zstd 解压组件');
      return fzstd.decompress(u8);
    }
  };
}

function fsReader(fd) {
  return (offset, length) => new Promise((resolve, reject) => {
    const buf = Buffer.alloc(Math.max(0, length));
    fs.read(fd, buf, 0, buf.length, offset, (err, bytes) => {
      if (err) reject(err);
      else resolve(new Uint8Array(buf.buffer, buf.byteOffset, bytes));
    });
  });
}

function planCopy(zimPath) {
  const dir = path.dirname(zimPath);
  const primary = path.basename(zimPath);
  const m = primary.match(/^(.*)\.zim([a-z]{2})?$/i);
  const stem = m ? m[1] : path.basename(primary, path.extname(primary));
  const files = [];
  const add = (full) => {
    try {
      const st = fs.statSync(full);
      if (st.isFile()) files.push({ full, rel: path.basename(full), bytes: st.size });
    } catch {}
  };
  add(zimPath);
  const re = new RegExp('^' + stem.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\.zim([a-z]{2})?$', 'i');
  try {
    for (const e of fs.readdirSync(dir)) {
      if (e === primary) continue;
      if (re.test(e)) add(path.join(dir, e));
    }
  } catch {}
  return { files, total: files.reduce((a, f) => a + f.bytes, 0), base: stem || 'encyclopedia', primary };
}

function copyWithProgress(src, dst, onBytes) {
  return new Promise((res, rej) => {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const rs = fs.createReadStream(src), ws = fs.createWriteStream(dst);
    rs.on('data', c => onBytes(c.length)); rs.on('error', rej); ws.on('error', rej); ws.on('close', res); rs.pipe(ws);
  });
}

function findExisting(srcPath, plan) {
  try {
    const s = require('../store').getSettings() || {};
    if (s.wikiZimOrigin === path.resolve(srcPath) && s.wikiZimPath && fs.existsSync(s.wikiZimPath) && insideRoot(s.wikiZimPath)) return s.wikiZimPath;
  } catch {}
  const root = zimRoot();
  try {
    for (const name of fs.readdirSync(root)) {
      const dest = path.join(root, name, plan.primary);
      if (fs.existsSync(dest) && fs.statSync(dest).size === (plan.files[0] && plan.files[0].bytes)) return dest;
    }
  } catch {}
  return '';
}

async function copyIntoApp(srcPath, opts = {}) {
  srcPath = path.resolve(String(srcPath || ''));
  if (!srcPath || !fs.existsSync(srcPath)) throw new Error('找不到该 ZIM 文件');
  if (insideRoot(srcPath)) return srcPath;
  const plan = planCopy(srcPath);
  const existing = findExisting(srcPath, plan);
  if (existing) return existing;
  let name = slug(plan.base), n = 1, target = path.join(zimRoot(), name);
  while (fs.existsSync(target)) { n++; target = path.join(zimRoot(), name + ' (' + n + ')'); }
  progressState = { active: true, name: plan.primary, got: 0, total: plan.total, files: plan.files.length, done: 0 };
  try {
    fs.mkdirSync(target, { recursive: true });
    for (const f of plan.files) {
      await copyWithProgress(f.full, path.join(target, f.rel), (b) => {
        progressState.got += b;
        opts.onProgress && opts.onProgress(progressState);
      });
      progressState.done++;
    }
  } catch (e) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
    progressState = { active: false, error: String(e.message || e) };
    throw e;
  }
  progressState = { active: false, done: plan.files.length, total: plan.total, got: plan.total, name: plan.primary, finished: true };
  opts.onProgress && opts.onProgress(progressState);
  return path.join(target, plan.primary);
}

function savePath(dest, origin) {
  try { require('../store').patchSettings({ wikiZimPath: dest, wikiZimOrigin: origin || '' }); } catch {}
}

async function close() {
  if (current && current.fd != null) {
    try { fs.closeSync(current.fd); } catch {}
  }
  current = null;
}

async function open(filePath) {
  const abs = path.resolve(String(filePath || ''));
  if (!abs || !fs.existsSync(abs)) throw new Error('找不到该 ZIM 文件');
  await close();
  const fd = fs.openSync(abs, 'r');
  try {
    const archive = new ZimArchive(fsReader(fd), codecs());
    await archive.init();
    current = { archive, path: abs, fd, name: path.basename(abs) };
    return status();
  } catch (e) {
    try { fs.closeSync(fd); } catch {}
    current = { error: e.message || String(e) };
    throw e;
  }
}

async function importFile(srcPath, opts = {}) {
  const dest = await copyIntoApp(srcPath, opts);
  const st = await open(dest);
  savePath(dest, path.resolve(String(srcPath || '')));
  return st;
}

async function openSaved() {
  try {
    const s = require('../store').getSettings() || {};
    let p = s.wikiZimPath;
    if (p && fs.existsSync(p) && !insideRoot(p)) {
      try {
        const dest = await copyIntoApp(p);
        savePath(dest, p);
        p = dest;
      } catch (e) {
        current = { error: '无法将 ZIM 文件复制到应用程序目录：' + (e.message || e) };
        return status();
      }
    }
    if (p && fs.existsSync(p)) {
      await open(p);
      return status();
    }
    if (p) current = { error: '源文件已不存在：' + p };
  } catch (e) {
    current = { error: e.message || String(e) };
  }
  return status();
}

function status() {
  if (!current || !current.archive) {
    return { open: false, path: '', name: '', articleCount: 0, copied: false, error: (current && current.error) || '' };
  }
  return {
    open: true,
    path: current.path,
    name: current.name,
    articleCount: current.archive.entryCount,
    mainPage: current.archive.mainPage,
    copied: insideRoot(current.path),
    error: ''
  };
}

function archive() { return current && current.archive; }
function getProgress() { return progressState; }

async function search(q, limit) {
  if (!current || !current.archive) return [];
  return current.archive.search(q, limit || 20);
}

async function getByPath(p) {
  if (!current || !current.archive) return null;
  return current.archive.getByPath(p);
}

async function mainEntry() {
  if (!current || !current.archive) return null;
  return current.archive.mainEntry();
}

module.exports = { open, close, openSaved, importFile, copyIntoApp, status, search, getByPath, mainEntry, archive, zimRoot, getProgress, insideRoot };
