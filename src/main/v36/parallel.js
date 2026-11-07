'use strict';
// Multithreaded download beside a normal single-stream download.
// If the server does not honor Range, the parallel attempt is cancelled and the normal download is kept.
const fs = require('fs');
const path = require('path');
const v36 = require('./v36');

async function probeRange(url, fetchImpl) {
  const res = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
  const status = res.status;
  const acceptRanges = res.headers.get('accept-ranges') || '';
  const contentRange = res.headers.get('content-range') || '';
  let total = 0;
  const m = contentRange.match(/\/(\d+)\s*$/);
  if (m) total = Number(m[1]);
  else if (status === 200) total = Number(res.headers.get('content-length') || 0);
  try { if (res.body && res.body.cancel) await res.body.cancel(); } catch {}
  return { status, acceptRanges, contentRange, total };
}

async function readAll(res) {
  if (res.arrayBuffer) return Buffer.from(await res.arrayBuffer());
  const chunks = [];
  for await (const c of res.body) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

async function downloadPart(url, start, end, fetchImpl, signal) {
  const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (res.status !== 206 && res.status !== 200) throw new Error('HTTP ' + res.status);
  return readAll(res);
}

/**
 * normalWrite() is the already-started single-stream download (Electron will-download, or a test stub).
 * Returns { mode:'multithread', bytes, file } or { mode:'normal', cancelledMultithread:true }.
 */
async function takeover({ url, dest, fetchImpl = fetch, parts = 4, normalWrite, signal }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const probe = await probeRange(url, fetchImpl);
  const plan = v36.downloadPlan({ status: probe.status, acceptRanges: probe.acceptRanges, contentRange: probe.contentRange, parts });
  if (!plan.multithread || !probe.total) {
    if (normalWrite) await normalWrite();
    return { mode: 'normal', cancelledMultithread: true, keepNormal: true, bytes: fs.existsSync(dest) ? fs.statSync(dest).size : 0 };
  }
  const mtAc = new AbortController();
  if (signal) signal.addEventListener('abort', () => mtAc.abort(), { once: true });
  const n = plan.parts;
  const size = probe.total;
  const chunk = Math.ceil(size / n);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const start = i * chunk;
    if (start >= size) break;
    const end = Math.min(size - 1, start + chunk - 1);
    jobs.push(downloadPart(url, start, end, fetchImpl, mtAc.signal).then(buf => ({ start, buf })));
  }
  const normalP = normalWrite ? normalWrite() : Promise.resolve();
  try {
    const pieces = await Promise.all(jobs);
    const out = Buffer.alloc(size);
    for (const p of pieces) p.buf.copy(out, p.start);
    const partial = dest + '.mt';
    fs.writeFileSync(partial, out);
    fs.renameSync(partial, dest);
    return { mode: 'multithread', bytes: out.length, file: dest, keepNormalStarted: true };
  } catch (e) {
    try { mtAc.abort(); } catch {}
    await normalP.catch(() => {});
    return { mode: 'normal', cancelledMultithread: true, error: String(e.message || e), bytes: fs.existsSync(dest) ? fs.statSync(dest).size : 0 };
  } finally {
    normalP.catch(() => {});
  }
}

module.exports = { probeRange, takeover };
