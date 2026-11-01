'use strict';
// Resumable download engine (v3.3.0). Pure Node (fs + fetch) so it is unit-testable without Electron.
//  * HTTP Range resume from <dest>.part (+ <dest>.part.json meta) — survives app restart, crash and network drop
//  * server ignores Range (200 instead of 206) or mismatching Content-Range / 416 -> clean restart of that file
//  * automatic retry with exponential backoff + jitter; after a failure the NEXT mirror is tried and keeps resuming the SAME .part
//  * pause (abort, keeps the .part) / cancel (abort, deletes the .part) through an AbortSignal reason
//  * size + sha256 verification at the end; mismatch -> delete, redownload (bounded) and report the reason
//  * progress with speed (EMA) and ETA, state machine: downloading | retrying | paused | verifying | verify-failed | restart | done
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
  try { fs.writeFileSync(metaF, JSON.stringify({ id, expectBytes: expectBytes || 0, sha256: sha256 || '', at: Date.now() })); } catch {}

  const sp = speedTracker(); let total = expectBytes || 0, lastEmit = 0, via = urls[0];
  const emit = (state, extra = {}, force = true) => {
    const now = Date.now(); if (!force && now - lastEmit < 400) return; lastEmit = now;
    const got = sizeOf(part) + (extra._live || 0);
    const speed = state === 'downloading' ? sp.speed : 0;
    const eta = speed > 0 && total > got ? Math.round((total - got) / speed) : 0;
    const ev = { id, state, got: extra._got != null ? extra._got : got, total, speed: Math.round(speed), eta, via, ...extra }; delete ev._live; delete ev._got;
    try { onStatus && onStatus(ev); } catch {}
  };
  let epIdx = 0, failures = 0, redl = 0, restarts = 0, retries = 0; const tried = []; const badEp = new Set();

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

module.exports = { fetchResumable, sha256File, backoffMs, sizeOf, abortErr };
