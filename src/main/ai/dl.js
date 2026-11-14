'use strict';
// Resumable download engine (v3.3.0). Pure Node (fs + fetch) so it is unit-testable without Electron.
//  * HTTP Range resume from <dest>.part (+ <dest>.part.json meta) — survives app restart, crash and network drop
//  * server ignores Range (200 instead of 206) or mismatching Content-Range / 416 -> clean restart of that file
//  * automatic retry with exponential backoff + jitter; after a failure the NEXT mirror is tried and keeps resuming the SAME .part
//  * pause (abort, keeps the .part) / cancel (abort, deletes the .part) through an AbortSignal reason
//  * size + sha256 verification at the end; mismatch -> delete, redownload (bounded) and report the reason
//  * progress with speed (EMA) and ETA, state machine: downloading | retrying | paused | verifying | verify-failed | restart | done
//  * v3.0.0 (iPad) / segmented: large files are fetched over several connections at once (default 8 Range segments).
//    The .part is preallocated, every segment resumes on its own (progress kept in .part.json), a stalled connection is
//    dropped and retried, idle connections split the largest remaining segment, and segments rotate across mirrors.
//    Servers without Range support fall back to the single stream above.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const backoffMs = (n) => { const base = num(process.env.AIB_DL_BACKOFF_MS, 1000), max = num(process.env.AIB_DL_BACKOFF_MAX_MS, 30000); return Math.min(max, base * 2 ** Math.max(0, n - 1)) + Math.floor(Math.random() * Math.min(250, base / 4 + 1)); };
const sizeOf = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
const rm = (p) => { try { fs.unlinkSync(p); } catch {} };

function abortErr(signal) {
  const r = signal && signal.reason;
  const e = new Error(r === 'pause' ? 'paused' : r === 'cancel' ? 'cancelled' : 'aborted');
  if (r === 'pause') e.paused = true; else e.cancelled = true;
  return e;
}
function sleep(ms, signal) {
  return new Promise((res, rej) => {
    if (signal && signal.aborted) return rej(abortErr(signal));
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', f); res(); }, ms);
    const f = () => { clearTimeout(t); rej(abortErr(signal)); };
    if (signal) signal.addEventListener('abort', f, { once: true });
  });
}
function sha256File(p) { return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); }); }

function httpErr(status, url) {
  const e = new Error('HTTP ' + status); e.status = status; e.url = url;
  e.fatal = status >= 400 && status < 500 && ![408, 425, 429].includes(status);
  return e;
}

// speed tracker: exponential moving average over >=500 ms windows
function speedTracker() {
  let t0 = Date.now(), b0 = 0, bytes = 0, ema = 0, last = t0;
  return {
    add(n) { bytes += n; const now = Date.now(); if (now - last >= 500) { const inst = (bytes - b0) / ((now - t0) / 1000); ema = ema ? ema * 0.6 + inst * 0.4 : inst; t0 = now; b0 = bytes; last = now; } },
    get speed() { return ema; },
    reset() { t0 = Date.now(); b0 = bytes; last = t0; ema = 0; }
  };
}


// ---------------------------------------------------------------- segmented (multi-connection) download
const SEG_MIN_SPLIT = 1024 * 1024; // never split a remaining range below 2 × 1 MB
function segCfg(o) {
  const n = Math.max(1, Math.min(16, Math.floor(num(o.segments != null ? o.segments : process.env.AIB_DL_SEGMENTS, 8))));
  const min = num(o.segMinBytes != null ? o.segMinBytes : process.env.AIB_DL_SEG_MIN, 16 * 1024 * 1024);
  const stall = num(o.stallMs != null ? o.stallMs : process.env.AIB_DL_STALL_MS, 20000);
  const split = Math.max(64 * 1024, num(o.minSplitBytes, SEG_MIN_SPLIT));
  return { n, min, stall, split };
}
function readMeta(metaF) { try { return JSON.parse(fs.readFileSync(metaF, 'utf8')); } catch { return null; } }
function writeMeta(metaF, m) { try { const t = metaF + '.tmp'; fs.writeFileSync(t, JSON.stringify(m)); fs.renameSync(t, metaF); } catch {} }
/** bytes really downloaded for <dest> (a segmented .part is preallocated to the full size) */
function partialBytes(dest) {
  const m = readMeta(dest + '.part.json');
  if (m && Array.isArray(m.segs)) return m.segs.reduce((a, g) => a + Math.max(0, Math.min(g.p, g.e + 1) - g.s), 0);
  return sizeOf(dest + '.part');
}
// one Range request (bytes=from-to) -> { status, total, start } ; 206 with a parsable Content-Range means ranges work
async function rangeProbe(fetchImpl, url, signal) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  const onA = () => ac.abort(); if (signal) signal.addEventListener('abort', onA, { once: true });
  try {
    const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, signal: ac.signal, redirect: 'follow' });
    try { res.body && res.body.cancel(); } catch {}
    const m = (res.headers.get('content-range') || '').match(/bytes\s+0-0\/(\d+)/);
    return { status: res.status, total: m ? Number(m[1]) : 0, url: res.url || url };
  } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onA); }
}

async function fetchSegments(o, st) {
  const { id, urls, signal, fetchImpl = fetch } = o; const { part, metaF, total, cfg, emit, sp, badEp, tried } = st;
  let meta = readMeta(metaF);
  if (!meta || !Array.isArray(meta.segs) || meta.total !== total || sizeOf(part) !== total) {
    // fresh: preallocate and split into N equal ranges
    const fd0 = fs.openSync(part, 'w'); try { fs.ftruncateSync(fd0, total); } finally { fs.closeSync(fd0); }
    const n = Math.max(1, Math.min(cfg.n, Math.ceil(total / cfg.split)));
    const size = Math.ceil(total / n); const segs = [];
    for (let i = 0; i < n; i++) { const s0 = i * size, e0 = Math.min(total, (i + 1) * size) - 1; if (s0 <= e0) segs.push({ s: s0, e: e0, p: s0 }); }
    meta = { id, expectBytes: o.expectBytes || 0, sha256: o.sha256 || '', total, segs, at: Date.now() };
    writeMeta(metaF, meta);
  }
  const segs = meta.segs;
  const got = () => segs.reduce((a, g) => a + Math.max(0, Math.min(g.p, g.e + 1) - g.s), 0);
  const fd = fs.openSync(part, 'r+');
  let lastSave = 0; const save = (force) => { const now = Date.now(); if (force || now - lastSave > 500) { lastSave = now; meta.at = now; writeMeta(metaF, meta); } };
  let failures = 0, retries = 0, fatal = null, noRange = false, active = 0, ep = 0;
  const pickUrl = (k) => { for (let i = 0; i < urls.length; i++) { const j = (ep + k + i) % urls.length; if (!badEp.has(j)) return j; } return -1; };
  const stopAll = new AbortController(); const onOuter = () => stopAll.abort(); if (signal) signal.addEventListener('abort', onOuter, { once: true });
  // next range for an idle worker: an untouched segment, else half of the largest one still running
  const take = () => {
    const free = segs.find(g => !g.busy && g.p <= g.e); if (free) { free.busy = true; return free; }
    let big = null; for (const g of segs) if (g.busy && g.e - g.p + 1 > 2 * cfg.split && (!big || g.e - g.p > big.e - big.p)) big = g;
    if (!big) return null;
    const mid = big.p + Math.floor((big.e - big.p + 1) / 2);
    const n = { s: mid, e: big.e, p: mid, busy: true }; big.e = mid - 1; segs.push(n); return n;
  };
  async function runSeg(g, k) {
    let segFail = 0;
    while (g.p <= g.e && !stopAll.signal.aborted && !fatal && !noRange) {
      const ui = pickUrl(segFail); // all connections use the best source; a failing segment moves on to the next one if (ui < 0) { fatal = fatal || Object.assign(new Error('all sources failed'), { tried }); return; }
      const url = urls[ui]; st.via = url;
      const ac = new AbortController(); const link = () => ac.abort(); stopAll.signal.addEventListener('abort', link, { once: true });
      let stallT = null; const arm = () => { clearTimeout(stallT); stallT = setTimeout(() => ac.abort('stall'), cfg.stall); };
      const startP = g.p;
      try {
        arm();
        const res = await fetchImpl(url, { headers: { Range: `bytes=${g.p}-${g.e}` }, signal: ac.signal, redirect: 'follow' });
        if (res.status === 200) { try { res.body.cancel(); } catch {} noRange = true; return; }
        if (res.status !== 206) throw httpErr(res.status, url);
        const m = (res.headers.get('content-range') || '').match(/bytes\s+(\d+)-(\d+)?\/(\d+|\*)/);
        if (!m || Number(m[1]) !== g.p || (m[3] !== '*' && Number(m[3]) !== total)) { try { res.body.cancel(); } catch {} throw Object.assign(new Error('bad content-range'), { retryable: true }); }
        const reader = res.body.getReader(); const cancel = () => { try { reader.cancel().catch(() => {}); } catch {} };
        ac.signal.addEventListener('abort', cancel, { once: true });
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          arm();
          // another worker may have taken the tail of this segment: write only up to g.e
          const room = g.e - g.p + 1; if (room <= 0) { cancel(); break; }
          const buf = value.length > room ? value.subarray(0, room) : value;
          await new Promise((res2, rej) => fs.write(fd, buf, 0, buf.length, g.p, (e) => (e ? rej(e) : res2())));
          g.p += buf.length; sp.add(buf.length); save(false);
          emit('downloading', { _got: got(), conns: active }, false);
          if (g.p > g.e) { cancel(); break; }
        }
        if (ac.signal.aborted && ac.signal.reason !== 'stall' && !(g.p > g.e)) throw abortErr(signal);
        if (g.p <= g.e) throw Object.assign(new Error(ac.signal.reason === 'stall' ? 'stalled' : 'truncated response'), { retryable: true });
      } catch (e) {
        if (signal && signal.aborted) return;
        if (/ENOSPC/.test(String(e.code || e.message))) { fatal = e; stopAll.abort(); return; }
        if (ac.signal.reason === 'stall') e = Object.assign(new Error('stalled: no data for ' + Math.round(cfg.stall / 1000) + ' s'), { retryable: true });
        tried.push({ base: url, error: String(e.message || e), status: e.status || 0 });
        if (e.fatal) { badEp.add(ui); if (badEp.size >= urls.length) { fatal = Object.assign(new Error(e.status ? `HTTP ${e.status}` : String(e.message || e)), { tried }); stopAll.abort(); return; } continue; }
        if (g.p > startP) segFail = 0;
        segFail++; failures++; retries++;
        if (segFail > (o.maxFailures || 8)) { fatal = Object.assign(new Error(String(e.message || e)), { tried }); stopAll.abort(); return; }
        const wait = backoffMs(segFail);
        emit('retrying', { retry: segFail, max: o.maxFailures || 8, waitMs: wait, error: String(e.message || e).slice(0, 160), _got: got(), conns: active });
        try { await sleep(wait, stopAll.signal); } catch { return; }
      } finally { clearTimeout(stallT); stopAll.signal.removeEventListener('abort', link); }
    }
  }
  async function worker(k) {
    for (;;) {
      if (stopAll.signal.aborted || fatal || noRange) return;
      const g = take(); if (!g) return;
      active++;
      try { await runSeg(g, k); } finally { g.busy = false; active--; }
    }
  }
  sp.reset(); emit('downloading', { _got: got(), conns: Math.min(cfg.n, segs.length) });
  try { await Promise.all(Array.from({ length: cfg.n }, (_, k) => worker(k))); }
  finally {
    if (signal) signal.removeEventListener('abort', onOuter);
    segs.forEach(g => { delete g.busy; });
    meta.segs = segs; meta.done = got(); save(true);
    try { fs.closeSync(fd); } catch {}
  }
  if (signal && signal.aborted) throw abortErr(signal);
  if (fatal) throw fatal;
  if (noRange) return { noRange: true, retries };
  return { done: segs.every(g => g.p > g.e), retries };
}

/**
 * fetchResumable({ id, urls: string[], dest, expectBytes?, sha256?, signal?, onStatus?, maxFailures?, redownloads?, fetchImpl? })
 * resolves { via, bytes, sha, restarts, retries } ; rejects with err.paused / err.cancelled / Error (err.tried = [{url,error}])
 */
async function fetchResumable(o) {
  const { id, urls, dest, expectBytes, sha256, signal, onStatus, fetchImpl = fetch } = o;
  const maxFailures = o.maxFailures || 8, maxRedl = o.redownloads == null ? 2 : o.redownloads;
  const part = dest + '.part', metaF = dest + '.part.json';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // stale .part belonging to a different file version -> discard
  try { const m = JSON.parse(fs.readFileSync(metaF, 'utf8')); if (sizeOf(part) && ((m.expectBytes && expectBytes && m.expectBytes !== expectBytes) || (m.sha256 && sha256 && m.sha256 !== sha256))) rm(part); } catch {}
  { const m0 = readMeta(metaF); if (!(m0 && Array.isArray(m0.segs) && sizeOf(part))) { try { fs.writeFileSync(metaF, JSON.stringify({ id, expectBytes: expectBytes || 0, sha256: sha256 || '', at: Date.now() })); } catch {} } }

  const sp = speedTracker(); let total = expectBytes || 0, lastEmit = 0, via = urls[0];
  const emit = (state, extra = {}, force = true) => {
    const now = Date.now(); if (!force && now - lastEmit < 400) return; lastEmit = now;
    const got = extra._got != null ? extra._got : sizeOf(part) + (extra._live || 0);
    const speed = state === 'downloading' ? sp.speed : 0;
    const eta = speed > 0 && total > got ? Math.round((total - got) / speed) : 0;
    const ev = { id, state, got, total, speed: Math.round(speed), eta, via, ...extra }; delete ev._live; delete ev._got;
    try { onStatus && onStatus(ev); } catch {}
  };
  let epIdx = 0, failures = 0, redl = 0, restarts = 0, retries = 0; const tried = []; const badEp = new Set();

  // ---- multi-connection mode for large files on servers that accept Range requests
  const cfg = segCfg(o);
  let segmented = false;
  {
    const m = readMeta(metaF);
    if (m && Array.isArray(m.segs) && m.total && sizeOf(part) === m.total && (!expectBytes || m.total === expectBytes)) { segmented = true; total = m.total; }
    else if (cfg.n > 1 && (!sizeOf(part)) && (expectBytes ? expectBytes >= cfg.min : o.segments > 1)) {
      for (let i = 0; i < urls.length && !segmented; i++) {
        try {
          const r = await rangeProbe(fetchImpl, urls[i], signal);
          if (r.status === 206 && r.total && r.total >= cfg.min && (!expectBytes || r.total === expectBytes)) { segmented = true; total = r.total; epIdx = i; }
          else if (r.status >= 400 && r.status < 500 && ![408, 425, 429].includes(r.status)) { tried.push({ base: urls[i], error: 'HTTP ' + r.status, status: r.status }); badEp.add(i); }
          else break; // reachable but no ranges (or too small): single stream
        } catch (e) { if (signal && signal.aborted) throw abortErr(signal); tried.push({ base: urls[i], error: String(e.message || e), status: 0 }); }
      }
      if (badEp.size >= urls.length) { const er = new Error(tried.length ? tried[tried.length - 1].error : 'unreachable'); er.tried = tried; throw er; }
    }
  }
  if (segmented) {
    const ordered = urls.slice(epIdx).concat(urls.slice(0, epIdx));
    const st = { part, metaF, total, cfg, emit, sp, badEp: new Set([...badEp].map(i => (i - epIdx + urls.length) % urls.length)), tried, via };
    for (;;) {
      if (signal && signal.aborted) throw abortErr(signal);
      const r = await fetchSegments(Object.assign({}, o, { urls: ordered, fetchImpl }), st);
      retries += r.retries || 0; via = st.via;
      if (r.noRange) { rm(part); rm(metaF); try { fs.writeFileSync(metaF, JSON.stringify({ id, expectBytes: expectBytes || 0, sha256: sha256 || '', at: Date.now() })); } catch {} restarts++; emit('restart', { reason: 'no-range', _got: 0 }); break; }
      emit('verifying', { _got: total });
      let bad = '';
      if (sha256) { const h = await sha256File(part); if (h !== sha256) bad = `sha256 ${h.slice(0, 12)}… != ${sha256.slice(0, 12)}…`; }
      if (bad) {
        rm(part); rm(metaF); redl++;
        emit('verify-failed', { reason: bad, attempt: redl, _got: 0 });
        if (redl > maxRedl) { const er = new Error('verification failed: ' + bad); er.verify = true; er.tried = tried; throw er; }
        continue;
      }
      fs.renameSync(part, dest); rm(metaF);
      emit('done', { _got: total, total });
      return { via, bytes: total, sha: !!sha256, restarts, retries, redownloads: redl, segments: true };
    }
  }

  for (;;) {
    if (signal && signal.aborted) throw abortErr(signal);
    let have = sizeOf(part);
    if (expectBytes && have > expectBytes) { rm(part); have = 0; }
    let streamedOk = false;
    if (!(expectBytes && have === expectBytes)) {
      const url = urls[epIdx % urls.length]; via = url;
      try {
        emit('downloading', { retry: failures });
        const res = await fetchImpl(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal, redirect: 'follow' });
        if (res.status === 416) {
          const cr = (res.headers.get('content-range') || '').match(/\/(\d+)$/);
          try { res.body && res.body.cancel(); } catch {}
          if (cr && Number(cr[1]) === have) { streamedOk = true; total = have; }
          else { rm(part); restarts++; emit('restart', { reason: 'range-rejected' }); continue; }
        } else if (res.status === 200 || res.status === 206) {
          let startAt = have;
          if (res.status === 200 && have > 0) { startAt = 0; restarts++; emit('restart', { reason: 'no-range', _got: 0 }); }
          if (res.status === 206) {
            const m = (res.headers.get('content-range') || '').match(/bytes\s+(\d+)-(\d+)?\/(\d+|\*)/);
            if (!m || Number(m[1]) !== have) { try { res.body.cancel(); } catch {} rm(part); restarts++; emit('restart', { reason: 'bad-content-range' }); continue; }
            if (m[3] !== '*') total = Number(m[3]);
          } else { const cl = Number(res.headers.get('content-length') || 0); if (cl) total = cl; }
          if (!total && expectBytes) total = expectBytes;
          const ws = fs.createWriteStream(part, { flags: startAt ? 'a' : 'w' });
          let wsErr = null; ws.on('error', e => { wsErr = e; });
          const reader = res.body.getReader(); let live = 0; sp.reset();
          const onAbort = () => { try { reader.cancel().catch(() => {}); } catch {} };
          if (signal) signal.addEventListener('abort', onAbort, { once: true });
          try {
            for (;;) {
              const { value, done } = await reader.read(); if (done) break;
              if (wsErr) throw wsErr;
              if (!ws.write(value)) await new Promise(r => ws.once('drain', r));
              live += value.length; sp.add(value.length);
              emit('downloading', { _live: startAt === 0 && have > 0 ? live - have : live, _got: startAt + live }, false);
            }
            if (signal && signal.aborted) throw abortErr(signal);
          } finally {
            if (signal) signal.removeEventListener('abort', onAbort);
            await new Promise(r => ws.end(r));
          }
          if (wsErr) throw wsErr;
          const now = sizeOf(part);
          if (total && now < total) throw Object.assign(new Error('truncated response'), { retryable: true });
          streamedOk = true;
        } else throw httpErr(res.status, url);
      } catch (e) {
        if (signal && signal.aborted) throw abortErr(signal);
        if (e.paused || e.cancelled) throw e;
        const progressed = sizeOf(part) > have;
        if (progressed) failures = 0;
        tried.push({ base: url, error: String(e.message || e), status: e.status || 0 });
        if (e.fatal || /ENOSPC/.test(String(e.code || e.message))) { badEp.add(epIdx % urls.length); }
        if (/ENOSPC/.test(String(e.code || e.message)) || badEp.size >= urls.length) { const er = new Error((e.status ? `HTTP ${e.status}` : String(e.message || e))); er.tried = tried; er.code = e.code; throw er; }
        failures++; retries++;
        if (failures > maxFailures) { const er = new Error(String(e.message || e)); er.tried = tried; throw er; }
        const wait = backoffMs(failures);
        emit('retrying', { retry: failures, max: maxFailures, waitMs: wait, error: String(e.message || e).slice(0, 160) });
        await sleep(wait, signal);
        // mirror fallback: next endpoint (skipping known-dead ones) resumes the SAME .part
        for (let i = 1; i <= urls.length; i++) { if (!badEp.has((epIdx + i) % urls.length)) { epIdx = (epIdx + i) % urls.length; break; } }
        continue;
      }
    } else streamedOk = true;

    if (!streamedOk) continue;
    // ---- verify
    emit('verifying', { _got: sizeOf(part) });
    const size = sizeOf(part); let bad = '';
    const want = expectBytes || total;
    if (want && size !== want) bad = `size ${size} != ${want}`;
    else if (sha256) { const h = await sha256File(part); if (h !== sha256) bad = `sha256 ${h.slice(0, 12)}… != ${sha256.slice(0, 12)}…`; }
    if (bad) {
      rm(part); redl++;
      emit('verify-failed', { reason: bad, attempt: redl, _got: 0 });
      if (redl > maxRedl) { rm(metaF); const er = new Error('verification failed: ' + bad); er.verify = true; er.tried = tried; throw er; }
      continue;
    }
    fs.renameSync(part, dest); rm(metaF);
    emit('done', { _got: size, total: size });
    return { via, bytes: size, sha: !!sha256, restarts, retries, redownloads: redl };
  }
}

module.exports = { fetchResumable, sha256File, backoffMs, sizeOf, abortErr, partialBytes, rangeProbe, segCfg };
