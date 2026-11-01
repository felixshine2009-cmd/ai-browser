'use strict';
// Hugging Face hub client: endpoint selection with automatic fallback (hf-mirror.com default), model search,
// repo file listing (quants, sizes, sha256), resumable downloads with progress / cancel / sha verification.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../store');
const { familyOf, ramFor, fmtSize } = require('./catalog');

const BASES = { mirror: 'https://hf-mirror.com', official: 'https://huggingface.co' };
const isEn = () => { try { return store.getSettings().lang === 'en'; } catch { return false; } };
const L = (zh, en) => (isEn() ? en : zh);

function hubCfg() { let h = {}; try { h = (store.getSettings().ai.local || {}).hub || {}; } catch {} return { endpoint: ['mirror', 'official', 'custom'].includes(h.endpoint) ? h.endpoint : 'mirror', custom: String(h.custom || '').replace(/\/+$/, '') }; }
// ordered list of base URLs to try: the chosen one first, then the others (auto-fallback)
function endpoints() {
  if (process.env.AIB_HF_BASE) return process.env.AIB_HF_BASE.split(',').map((b, i) => ({ id: 'env' + i, base: b.trim().replace(/\/+$/, '') }));
  const c = hubCfg(); const all = [];
  const add = (id, base) => { if (base && !all.some(x => x.base === base)) all.push({ id, base }); };
  if (c.endpoint === 'custom') add('custom', c.custom);
  add(c.endpoint === 'official' ? 'official' : 'mirror', c.endpoint === 'official' ? BASES.official : BASES.mirror);
  add(c.endpoint === 'official' ? 'mirror' : 'official', c.endpoint === 'official' ? BASES.mirror : BASES.official);
  if (c.endpoint !== 'custom' && c.custom) add('custom', c.custom);
  return all;
}

// readable, localized reason for any failure
function reason(e, base) {
  const m = String((e && (e.cause && e.cause.code || e.code)) || ''); const msg = String((e && e.message) || e);
  let r;
  if (/ENOTFOUND|EAI_AGAIN/.test(m + msg)) r = L('无法解析域名（检查网络或 DNS）', 'DNS lookup failed (check network / DNS)');
  else if (/ECONNREFUSED/.test(m + msg)) r = L('连接被拒绝', 'connection refused');
  else if (/ETIMEDOUT|timeout|TimeoutError|aborted due to timeout/i.test(m + msg)) r = L('连接超时', 'connection timed out');
  else if (/ECONNRESET|socket hang up|terminated|fetch failed/i.test(m + msg)) r = L('连接中断或被重置', 'connection reset / unreachable');
  else if (/HTTP 401|HTTP 403/.test(msg)) r = L('需要登录或模型受限（gated），本应用不支持', 'login required or gated model (not supported)');
  else if (/HTTP 404/.test(msg)) r = L('文件或仓库不存在', 'file or repo not found');
  else if (/HTTP 429/.test(msg)) r = L('请求过于频繁（429），稍后重试', 'rate limited (429); retry later');
  else if (/HTTP 5\d\d/.test(msg)) r = L('服务器错误 ' + msg.match(/HTTP (\d+)/)[1], 'server error ' + msg.match(/HTTP (\d+)/)[1]);
  else if (/ENOSPC/.test(m + msg)) r = L('磁盘空间不足', 'disk full');
  else if (/sha256/i.test(msg)) r = msg;
  else r = msg.slice(0, 160);
  return (base ? base.replace(/^https?:\/\//, '') + '：' : '') + r;
}

async function req(pathname, opts = {}) {
  const tried = []; const eps = endpoints();
  for (const ep of eps) {
    try {
      const res = await fetch(ep.base + pathname, { redirect: 'follow', signal: AbortSignal.timeout(opts.timeout || 15000), headers: opts.headers || {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return { res, base: ep.base, id: ep.id, tried };
    } catch (e) { tried.push({ base: ep.base, error: reason(e) }); if (/HTTP 404/.test(String(e.message))) break; }
  }
  const err = new Error(L('无法连接模型站点：', 'Cannot reach the model hub: ') + tried.map(t => `${t.base.replace(/^https?:\/\//, '')} (${t.error.replace(/^[^：:]*[：:]\s*/, '')})`).join(' · '));
  err.tried = tried; throw err;
}
async function getJson(pathname, opts) { const r = await req(pathname, opts); const j = await r.res.json(); return { json: j, via: r.base, tried: r.tried }; }

// ---------------------------------------------------------------- search
function repoFromInput(s) {
  s = String(s || '').trim();
  const m = s.match(/(?:https?:\/\/[^/]+\/)?([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)(?:\/(?:tree|blob|resolve)\/[^/]+(?:\/.*)?)?\/?$/);
  return m && !/\s/.test(s) ? m[1] : null;
}
function brief(m) {
  const tags = m.tags || []; const gguf = tags.includes('gguf') || /gguf/i.test(m.id); const mlx = tags.includes('mlx') || /^mlx-community\//i.test(m.id);
  return { repo: m.id, downloads: m.downloads || 0, likes: m.likes || 0, engine: mlx ? 'mlx' : gguf ? 'llama' : 'other', family: familyOf(m.id), license: ((tags.find(t => t.startsWith('license:')) || '').slice(8)) || '', updated: m.lastModified || m.createdAt || '', gated: !!m.gated };
}
async function search(query, kind = 'gguf', limit = 24) {
  const q = String(query || '').trim();
  const direct = repoFromInput(q);
  const filter = kind === 'mlx' ? 'mlx' : 'gguf';
  const url = `/api/models?search=${encodeURIComponent(direct && !/^https?:/.test(q) ? direct.split('/')[1] : q)}&filter=${filter}&sort=downloads&direction=-1&limit=${limit}`;
  const { json, via, tried } = await getJson(url);
  let items = (Array.isArray(json) ? json : []).map(brief).filter(x => x.engine !== 'other' || filter === 'gguf');
  if (direct && !items.some(i => i.repo.toLowerCase() === direct.toLowerCase())) {
    try { const d = await getJson('/api/models/' + direct); items.unshift(brief(d.json)); } catch {}
  }
  return { items, via, tried, kind };
}

// ---------------------------------------------------------------- repo files
function quantOf(name) { const m = name.match(/(?:^|[-_.])((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+){0,2}|F16|FP16|BF16|F32))(?=[-_.]|\.gguf$)/i); return m ? m[1].toUpperCase() : ''; }
async function repoFiles(repo) {
  const { json: j, via } = await getJson('/api/models/' + repo + '?blobs=true', { timeout: 20000 });
  const tags = j.tags || []; const mlx = tags.includes('mlx') || /^mlx-community\//i.test(repo);
  const sib = j.siblings || [];
  const out = { repo, via, engine: mlx ? 'mlx' : 'llama', family: familyOf(repo), downloads: j.downloads || 0, likes: j.likes || 0, license: ((tags.find(t => t.startsWith('license:')) || '').slice(8)), gated: !!j.gated, files: [] };
  if (mlx) {
    const files = sib.filter(s => !/\.(md|txt)$|^\.git|^LICENSE/i.test(s.rfilename) || /tokenizer|chat_template|vocab/i.test(s.rfilename));
    const bytes = files.reduce((a, s) => a + (s.size || 0), 0);
    out.files = [{ file: '*', quant: (repo.match(/(\d)bit/i) || [])[0] || 'MLX', bytes, size: fmtSize(bytes), ram: ramFor(bytes), count: files.length, snapshot: files.map(s => ({ file: s.rfilename, bytes: s.size || 0, sha256: (s.lfs || {}).sha256 || '' })) }];
  } else {
    out.files = sib.filter(s => /\.gguf$/i.test(s.rfilename) && !/mmproj/i.test(s.rfilename) && !s.rfilename.includes('/')).map(s => ({ file: s.rfilename, quant: quantOf(s.rfilename), bytes: s.size || 0, size: fmtSize(s.size || 0), ram: ramFor(s.size || 0), sha256: (s.lfs || {}).sha256 || '', split: /-\d{5}-of-\d{5}\.gguf$/i.test(s.rfilename) }))
      .sort((a, b) => a.bytes - b.bytes);
  }
  return out;
}

// ---------------------------------------------------------------- download
// v3.3.0: powered by dl.js (Range resume from .part, backoff retry, mirror fallback on the same .part, pause/resume, sha256/size verify).
const dl = require('./dl');
const sha256File = dl.sha256File;
const active = new Map(); // id -> { ac, promise, state }
const urlsFor = (repo, file) => endpoints().map(ep => `${ep.base}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`);

async function fetchToFile(repo, file, dest, { expectBytes, sha256, signal, onStatus, id }) {
  try {
    return await dl.fetchResumable({ id, urls: urlsFor(repo, file), dest, expectBytes: process.env.AIB_HF_BASE ? 0 : expectBytes, sha256, signal, onStatus });
  } catch (e) {
    if (e.paused || e.cancelled) throw e;
    const tried = (e.tried || []).map(t => ({ base: String(t.base).replace(/^(https?:\/\/[^/]+).*$/, '$1'), error: reason(new Error(t.error)) }));
    const uniq = []; for (const t of tried) if (!uniq.some(u => u.base === t.base && u.error === t.error)) uniq.push(t);
    const err = new Error(e.verify ? L('校验失败（已重新下载仍不一致）：', 'Verification failed (still mismatching after re-download): ') + e.message.replace('verification failed: ', '')
      : L('下载失败：', 'Download failed: ') + (uniq.map(t => `${t.base.replace(/^https?:\/\//, '')} (${t.error.replace(/^[^：:]*[：:]\s*/, '')})`).join(' · ') || reason(e)));
    err.tried = uniq; throw err;
  }
}

function cleanParts(dest, engine) {
  const rmp = (p) => { try { fs.unlinkSync(p); } catch {} };
  if (engine === 'mlx') { const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch {} for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.part(\.json)?$/.test(e.name)) rmp(f); } }; walk(dest); }
  else { rmp(dest + '.part'); rmp(dest + '.part.json'); }
}

// item: { id, engine, repo, file?, bytes, sha256?, dest, snapshot? [{file,bytes,sha256}] }
// A second call for an id that is already downloading returns the SAME promise (bundled.js + Settings never race on one .part).
let sink = null; const setSink = (fn) => { sink = fn; };
function download(item, cb) {
  if (active.has(item.id)) return active.get(item.id).promise;
  const onProgress = (ev) => { try { cb && cb(ev); } catch {} try { sink && sink(ev); } catch {} };
  const ac = new AbortController(); const rec = { ac, state: 'downloading', promise: null }; active.set(item.id, rec);
  rec.promise = (async () => {
    try {
      let doneBytes = 0; const total0 = item.bytes || 0;
      const fwd = (base, total) => (ev) => { rec.state = ev.state; onProgress && onProgress({ ...ev, id: item.id, got: base + (ev.state === 'done' ? ev.got : ev.got), total: total || ev.total }); };
      if (item.engine === 'mlx') {
        const snap = item.snapshot && item.snapshot.length ? item.snapshot : (await repoFiles(item.repo)).files[0].snapshot;
        const total2 = snap.reduce((a, s) => a + s.bytes, 0);
        fs.mkdirSync(item.dest, { recursive: true });
        for (const f of snap) {
          const d = path.join(item.dest, f.file); let have = 0; try { have = fs.statSync(d).size; } catch {}
          if (have && have === f.bytes) { doneBytes += f.bytes; continue; }
          const base = doneBytes;
          await fetchToFile(item.repo, f.file, d, { id: item.id, expectBytes: f.bytes, sha256: f.sha256, signal: ac.signal, onStatus: (ev) => { if (ev.state === 'done') return; fwd(base, total2)(ev); } });
          doneBytes += f.bytes;
        }
        fs.writeFileSync(path.join(item.dest, '.aib-complete'), JSON.stringify({ repo: item.repo, files: snap.length, at: Date.now() }));
        onProgress && onProgress({ id: item.id, state: 'done', got: total2, total: total2, done: true });
        return item.dest;
      }
      let sha = item.sha256 || '';
      if (!sha && !process.env.AIB_HF_BASE) { try { const rf = await repoFiles(item.repo); const f = rf.files.find(x => x.file === item.file); if (f) sha = f.sha256; } catch {} }
      const r = await fetchToFile(item.repo, item.file, item.dest, { id: item.id, expectBytes: item.bytes, sha256: sha, signal: ac.signal, onStatus: (ev) => { if (ev.state === 'done') return; fwd(0, total0)(ev); } });
      onProgress && onProgress({ id: item.id, state: 'done', got: r.bytes, total: r.bytes, done: true });
      return item.dest;
    } catch (e) {
      if (ac.signal.aborted) {
        if (ac.signal.reason === 'pause') { const err = new Error(L('已暂停', 'paused')); err.paused = true; throw err; }
        cleanParts(item.dest, item.engine); const err = new Error(L('已取消', 'cancelled')); err.cancelled = true; throw err;
      }
      throw e;
    } finally { active.delete(item.id); }
  })();
  return rec.promise;
}
function pause(id) { const a = active.get(id); if (a) { a.ac.abort('pause'); return true; } return false; }
function cancel(id) { const a = active.get(id); if (a) { a.ac.abort('cancel'); return true; } return false; }
const isActive = (id) => active.has(id);

// connectivity probe for the settings UI: which endpoints answer, and why not
async function probe() {
  const out = [];
  for (const ep of endpoints()) {
    const t0 = Date.now();
    try { const r = await fetch(ep.base + '/api/models?limit=1', { redirect: 'follow', signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('HTTP ' + r.status); out.push({ id: ep.id, base: ep.base, ok: true, ms: Date.now() - t0 }); }
    catch (e) { out.push({ id: ep.id, base: ep.base, ok: false, error: reason(e), ms: Date.now() - t0 }); }
  }
  return out;
}

module.exports = { endpoints, search, repoFiles, repoFromInput, download, setSink, pause, cancel, fetchToFile, sha256File, isActive, probe, reason, quantOf, brief, BASES };
