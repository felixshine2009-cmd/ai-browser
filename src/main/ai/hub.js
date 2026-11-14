'use strict';
// Model hub client: Hugging Face (hf-mirror.com / huggingface.co / custom) for search and file lists, and for downloads
// also ModelScope (魔搭, modelscope.cn) — fast inside mainland China. Download sources are tried in order with automatic
// fallback; in 自动 (auto) mode they are ranked by a short speed test first. Downloads are resumable and use several
// connections at once (dl.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('../store');
const { familyOf, ramFor, fmtSize } = require('./catalog');

const BASES = { mirror: 'https://hf-mirror.com', official: 'https://huggingface.co', modelscope: 'https://modelscope.cn' };
const ENDPOINTS = ['auto', 'modelscope', 'mirror', 'official', 'custom'];
// Hugging Face repo -> ModelScope repo when the names differ (most GGUF repos use the same id on both)
const MS_REPOS = { 'tencent/HY-MT1.5-1.8B-GGUF': 'Tencent-Hunyuan/HY-MT1.5-1.8B-GGUF' };
const msRepo = (repo) => MS_REPOS[repo] || repo;
const isEn = () => { try { return store.getSettings().lang === 'en'; } catch { return false; } };
const L = (zh, en) => (isEn() ? en : zh);

// 2.x settings stored endpoint 'mirror' as the default; until the user picks a source themselves, v3 uses auto
function hubCfg() {
  let h = {}; try { h = (store.getSettings().ai.local || {}).hub || {}; } catch {}
  let endpoint = ENDPOINTS.includes(h.endpoint) ? h.endpoint : 'auto';
  if (endpoint === 'mirror' && !h.chosen) endpoint = 'auto';
  const conns = Math.max(1, Math.min(16, Number(h.connections) || 8));
  return { endpoint, custom: String(h.custom || '').replace(/\/+$/, ''), connections: conns };
}
// Hugging Face API endpoints (search / file lists): the chosen one first, then the others (auto-fallback)
function endpoints() {
  if (process.env.AIB_HF_BASE) return process.env.AIB_HF_BASE.split(',').map((b, i) => ({ id: 'env' + i, base: b.trim().replace(/\/+$/, ''), kind: 'hf' }));
  const c = hubCfg(); const all = [];
  const add = (id, base) => { if (base && !all.some(x => x.base === base)) all.push({ id, base, kind: 'hf' }); };
  if (c.endpoint === 'custom') add('custom', c.custom);
  add(c.endpoint === 'official' ? 'official' : 'mirror', c.endpoint === 'official' ? BASES.official : BASES.mirror);
  add(c.endpoint === 'official' ? 'mirror' : 'official', c.endpoint === 'official' ? BASES.mirror : BASES.official);
  if (c.endpoint !== 'custom' && c.custom) add('custom', c.custom);
  return all;
}
// download sources: ModelScope + the Hugging Face endpoints, in the order of the chosen source
function sources() {
  if (process.env.AIB_HF_BASE) return endpoints();
  const c = hubCfg(); const hf = endpoints(); const ms = { id: 'modelscope', base: process.env.AIB_MS_BASE || BASES.modelscope, kind: 'ms' };
  if (c.endpoint === 'modelscope' || c.endpoint === 'auto') return [ms].concat(hf);
  return hf.concat([ms]);
}
function sourceUrl(src, repo, file) {
  const f = file.split('/').map(encodeURIComponent).join('/');
  return src.kind === 'ms' ? `${src.base}/models/${msRepo(repo)}/resolve/master/${f}` : `${src.base}/${repo}/resolve/main/${f}`;
}
// auto mode: a short ranged read (512 KB) from every source at once; the fastest goes first, unreachable ones last.
// Rankings are kept for 10 minutes per host.
const rankCache = new Map();
async function speedTest(url, bytes = 512 * 1024, ms = 6000) {
  const t0 = Date.now(); const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` }, redirect: 'follow', signal: ac.signal });
    if (res.status !== 206 && res.status !== 200) { try { res.body && res.body.cancel(); } catch {} return { ok: false, error: 'HTTP ' + res.status, status: res.status }; }
    const reader = res.body.getReader(); let got = 0;
    for (;;) { const { value, done } = await reader.read(); if (done) break; got += value.length; if (got >= bytes) { try { reader.cancel().catch(() => {}); } catch {} break; } }
    const sec = Math.max(0.05, (Date.now() - t0) / 1000);
    return { ok: got > 0, bps: got / sec, ms: Date.now() - t0, bytes: got };
  } catch (e) { return { ok: false, error: reason(e) }; } finally { clearTimeout(timer); }
}
async function orderedUrls(repo, file) {
  const srcs = sources(); const urls = srcs.map(x => sourceUrl(x, repo, file));
  if (process.env.AIB_HF_BASE || hubCfg().endpoint !== 'auto' || srcs.length < 2) return urls;
  const key = repo + '|' + file; const hit = rankCache.get(key);
  if (hit && Date.now() - hit.at < 600000) return hit.urls;
  const r = await rankUrls(urls);
  rankCache.set(key, { at: Date.now(), urls: r.urls, detail: r.detail });
  return r.urls;
}
/** fastest first; sources answering 4xx (file not on that hub) are left out unless nothing else works */
async function rankUrls(urls, opts = {}) {
  const res = await Promise.all(urls.map(u => speedTest(u, opts.bytes, opts.ms)));
  const order = urls.map((u, i) => ({ u, r: res[i], i })).sort((a, b) => (b.r.ok - a.r.ok) || ((b.r.bps || 0) - (a.r.bps || 0)) || (a.i - b.i));
  const out = order.filter(x => x.r.ok || !(x.r.status >= 400 && x.r.status < 500)).map(x => x.u);
  return { urls: out.length ? out : urls, detail: order.map(x => ({ url: x.u, ...x.r })) };
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
const urlsFor = (repo, file) => sources().map(src => sourceUrl(src, repo, file));

async function fetchToFile(repo, file, dest, { expectBytes, sha256, signal, onStatus, id }) {
  try {
    const urls = await orderedUrls(repo, file);
    return await dl.fetchResumable({ id, urls, dest, expectBytes: process.env.AIB_HF_BASE ? 0 : expectBytes, sha256, signal, onStatus, segments: hubCfg().connections });
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

// connectivity + speed probe for the settings UI: which sources answer, how fast a model file arrives, and why not
const PROBE_FILE = { repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf' };
async function probe() {
  return Promise.all(sources().map(async (ep) => {
    const t0 = Date.now();
    try {
      const api = ep.kind === 'ms' ? `${ep.base}/api/v1/models/${PROBE_FILE.repo}` : ep.base + '/api/models?limit=1';
      const r = await fetch(api, { redirect: 'follow', signal: AbortSignal.timeout(8000) }); try { r.body && r.body.cancel(); } catch {}
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const ms = Date.now() - t0;
      const sp = process.env.AIB_HF_BASE ? { ok: false } : await speedTest(sourceUrl(ep, PROBE_FILE.repo, PROBE_FILE.file), 1024 * 1024, 8000);
      return { id: ep.id, base: ep.base, kind: ep.kind, ok: true, ms, speed: sp.ok ? Math.round(sp.bps) : 0 };
    } catch (e) { return { id: ep.id, base: ep.base, kind: ep.kind, ok: false, error: reason(e), ms: Date.now() - t0 }; }
  }));
}

module.exports = { endpoints, sources, sourceUrl, orderedUrls, rankUrls, speedTest, hubCfg, msRepo, ENDPOINTS, search, repoFiles, repoFromInput, download, setSink, pause, cancel, fetchToFile, sha256File, isActive, probe, reason, quantOf, brief, BASES };
