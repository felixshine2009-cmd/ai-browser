// Resumable, per-shard model downloads for the web app (v1.1.2).
// WebLLM stores every weight shard in Cache Storage ("webllm/model") keyed by its canonical URL. We pre-download the shards ourselves,
// one at a time, and put each COMPLETED shard under that same key, so an interrupted download keeps all finished shards and a later
// run (or WebLLM itself) continues from the next missing one. Pause = abort the in-flight shard; resume = skip cached shards.
// Mirrors: huggingface.co and hf-mirror.com are tried in turn after a failure; the cache key always stays canonical.
export const MODEL_CACHE = 'webllm/model';
const sleep = (ms, sig) => new Promise((res, rej) => { const t = setTimeout(res, ms); if (sig) sig.addEventListener('abort', () => { clearTimeout(t); rej(abortErr(sig)); }, { once: true }); });
function abortErr(sig) { const e = new Error(sig && sig.reason === 'pause' ? 'paused' : 'cancelled'); if (sig && sig.reason === 'pause') e.paused = true; else e.cancelled = true; return e; }

export const baseOf = (modelUrl) => new URL('resolve/main/', modelUrl.endsWith('/') ? modelUrl : modelUrl + '/').href;
export const mirrorsOf = (canonicalBase, extra = []) => {
  const out = [canonicalBase];
  if (/^https:\/\/huggingface\.co\//.test(canonicalBase)) out.push(canonicalBase.replace('https://huggingface.co/', 'https://hf-mirror.com/'));
  for (const e of extra) if (!out.includes(e)) out.push(e);
  return out;
};

export class ShardDownloader {
  constructor({ id, modelUrl, mirrors, fetchImpl, cacheName = MODEL_CACHE, backoffMs = 800, maxRetries = 6, onStatus }) {
    Object.assign(this, { id, canonicalBase: baseOf(modelUrl), fetchImpl: fetchImpl || ((...a) => fetch(...a)), cacheName, backoffMs, maxRetries, onStatus });
    this.mirrors = mirrors || mirrorsOf(this.canonicalBase);
    this.ac = null; this.state = 'idle';
    this.s = { state: 'idle', shardsDone: 0, shardsTotal: 0, bytesDone: 0, bytesTotal: 0, speed: 0, eta: 0, retry: 0, message: '' };
  }
  status() { return { id: this.id, ...this.s }; }
  _emit(patch) { Object.assign(this.s, patch); try { this.onStatus && this.onStatus(this.status()); } catch {} }
  pause() { if (this.ac && !this.ac.signal.aborted) this.ac.abort('pause'); }
  cancel() { if (this.ac && !this.ac.signal.aborted) this.ac.abort('cancel'); }

  async _fetchOne(path, size, sig) {
    // try each mirror once per call; caller handles backoff/retry rounds
    let lastErr;
    for (let i = 0; i < this.mirrors.length; i++) {
      const mirror = this.mirrors[(this.mi || 0) % this.mirrors.length];
      try {
        const res = await this.fetchImpl(new URL(path, mirror).href, { signal: sig });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const reader = res.body && res.body.getReader ? res.body.getReader() : null;
        const chunks = []; let got = 0;
        if (reader) { for (;;) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); got += value.length; this._tick(value.length); } }
        else { const b = new Uint8Array(await res.arrayBuffer()); chunks.push(b); got = b.length; this._tick(b.length); }
        if (size && got !== size) throw new Error(`size mismatch ${got}/${size}`);
        return new Blob(chunks);
      } catch (e) {
        if (sig.aborted) throw abortErr(sig);
        lastErr = e; this.mi = ((this.mi || 0) + 1) % this.mirrors.length; this._rollback();
      }
    }
    throw lastErr;
  }
  _tick(n) { // progress bytes within the in-flight shard (rolled back if the shard fails)
    this._live = (this._live || 0) + n; const now = performance.now();
    if (!this._t0) { this._t0 = now; this._b0 = 0; }
    this._bytes = (this._bytes || 0) + n;
    if (now - this._t0 > 500) { const inst = (this._bytes - this._b0) / ((now - this._t0) / 1000); this.s.speed = this.s.speed ? this.s.speed * 0.6 + inst * 0.4 : inst; this._t0 = now; this._b0 = this._bytes; }
    const done = this.s.bytesDone + this._live; this.s.eta = this.s.speed > 0 ? Math.round(Math.max(0, this.s.bytesTotal - done) / this.s.speed) : 0;
    this._emit({ state: 'downloading', liveBytes: done });
  }
  _rollback() { this._bytes = (this._bytes || 0) - (this._live || 0); this._b0 = Math.min(this._b0 || 0, this._bytes); this._live = 0; }

  async manifest(sig) {
    const cache = await caches.open(this.cacheName); const key = new URL('ndarray-cache.json', this.canonicalBase).href;
    const hit = await cache.match(key); if (hit) return hit.json();
    let lastErr;
    for (let round = 0; round < this.mirrors.length * 2; round++) {
      const mirror = this.mirrors[round % this.mirrors.length];
      try { const r = await this.fetchImpl(new URL('ndarray-cache.json', mirror).href, { signal: sig }); if (!r.ok) throw new Error('HTTP ' + r.status); const txt = await r.text(); await cache.put(key, new Response(txt, { headers: { 'content-type': 'application/json', 'content-length': String(txt.length) } })); return JSON.parse(txt); }
      catch (e) { if (sig.aborted) throw abortErr(sig); lastErr = e; }
    }
    throw lastErr;
  }

  /** Download all missing shards. Resolves when every shard is cached. Rejects with .paused / .cancelled / Error. */
  async run() {
    this.ac = new AbortController(); const sig = this.ac.signal; this.mi = 0; this._live = 0; this._t0 = 0; this._bytes = 0; this._b0 = 0;
    try {
      this._emit({ state: 'downloading', message: 'manifest', retry: 0 });
      const man = await this.manifest(sig);
      const recs = []; const seen = new Set();
      for (const r of (man.records || [])) if (!seen.has(r.dataPath)) { seen.add(r.dataPath); recs.push({ path: r.dataPath, bytes: r.nbytes || 0 }); }
      const cache = await caches.open(this.cacheName);
      const todo = []; let doneBytes = 0, doneN = 0; const total = recs.reduce((a, r) => a + r.bytes, 0);
      for (const r of recs) { const key = new URL(r.path, this.canonicalBase).href; if (await cache.match(key)) { doneBytes += r.bytes; doneN++; } else todo.push({ ...r, key }); }
      this._emit({ shardsTotal: recs.length, shardsDone: doneN, bytesTotal: total, bytesDone: doneBytes, state: 'downloading', message: '' });
      for (const sh of todo) {
        let fails = 0;
        for (;;) {
          if (sig.aborted) throw abortErr(sig);
          this._live = 0;
          try {
            const blob = await this._fetchOne(sh.path, sh.bytes, sig);
            await cache.put(sh.key, new Response(blob, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(blob.size) } }));
            this._live = 0; doneN++; doneBytes += sh.bytes || blob.size;
            this._emit({ shardsDone: doneN, bytesDone: doneBytes, retry: 0, state: 'downloading', message: '' });
            break;
          } catch (e) {
            if (e.paused || e.cancelled || sig.aborted) throw e;
            fails++; this._live = 0;
            if (fails > this.maxRetries) { const er = new Error('shard ' + sh.path + ': ' + e.message); er.failed = true; throw er; }
            const wait = Math.min(15000, this.backoffMs * 2 ** (fails - 1));
            this._emit({ state: 'retrying', retry: fails, max: this.maxRetries, waitMs: wait, message: e.message, bytesDone: doneBytes });
            await sleep(wait, sig);
          }
        }
      }
      this._emit({ state: 'done', shardsDone: recs.length, bytesDone: total, speed: 0, eta: 0, message: '' });
      return this.status();
    } catch (e) {
      if (e.paused) this._emit({ state: 'paused', speed: 0, eta: 0 });
      else if (e.cancelled) this._emit({ state: 'idle', speed: 0, eta: 0 });
      else this._emit({ state: 'error', message: e.message, speed: 0, eta: 0 });
      throw e;
    }
  }
}

// ---- storage report / cleaning ------------------------------------------------------------------
async function sizeOfResponse(res) {
  const cl = Number(res.headers.get('content-length') || 0); if (cl) return cl;
  try { return (await res.clone().blob()).size; } catch { return 0; }
}
/** matchers: [{ id, label, needles: [substr] }] -> per-model { filesBytes, cacheBytes, complete, urls[] } */
export async function storageReport(matchers) {
  const out = {}; for (const m of matchers) out[m.id] = { id: m.id, label: m.label, filesBytes: 0, cacheBytes: 0, shards: 0, shardsTotal: 0, complete: false, entries: [] };
  const other = { filesBytes: 0, entries: 0 };
  let names = []; try { names = await caches.keys(); } catch {}
  for (const n of names) {
    const c = await caches.open(n); const reqs = await c.keys();
    for (const rq of reqs) {
      const m = matchers.find(x => x.needles.some(nd => rq.url.toLowerCase().includes(nd.toLowerCase())));
      const res = await c.match(rq); const b = res ? await sizeOfResponse(res) : 0;
      if (!m) { other.filesBytes += b; other.entries++; continue; }
      const row = out[m.id]; row.entries.push({ cache: n, url: rq.url, bytes: b });
      if (/params_shard_\d+\.bin/.test(rq.url)) row.shards++;
      if (/ndarray-cache\.json$/.test(rq.url) && res) { try { row.shardsTotal = new Set(((await res.clone().json()).records || []).map(r => r.dataPath)).size; } catch {} }
    }
  }
  for (const row of Object.values(out)) {
    row.complete = row.shardsTotal > 0 ? row.shards >= row.shardsTotal : (row.entries.length > 0 && row.shards > 0);
    // complete model: all bytes are "model files"; partial download: the shards / manifest are "cache" (unfinished, safe to clear)
    const total = row.entries.reduce((a, e) => a + e.bytes, 0);
    if (row.complete) row.filesBytes = total; else row.cacheBytes = total;
  }
  let est = null; try { est = await navigator.storage.estimate(); } catch {}
  let persisted = null; try { persisted = await navigator.storage.persisted(); } catch {}
  return { models: Object.values(out).filter(r => r.entries.length), other, estimate: est ? { usage: est.usage || 0, quota: est.quota || 0 } : null, persisted };
}
export async function removeEntries(entries) {
  let freed = 0;
  for (const e of entries) { try { const c = await caches.open(e.cache); if (await c.delete(e.url)) freed += e.bytes; } catch {} }
  return freed;
}
