'use strict';
// iPad host transport. The native shell (Swift) and this Node.js runtime run in the same app process; they talk over a
// loopback HTTP server that only accepts requests carrying the per-launch token.
//   Swift -> Node : POST /ipc/invoke, /ipc/send (renderer IPC), POST /host/event (view / window / download events),
//                   POST /scheme (aibrowser:, aibdict:, aibext:, aibzim: requests), POST /host/reply (command results),
//                   GET /host/ping (health check)
//   Node -> Swift : GET /host/events  (one long-lived Server-Sent-Events stream of commands)
//
// Robustness (iPadOS suspends the app in the background and may reclaim its sockets, see Apple TN2277):
// - every command carries an SSE id; the last ~4000 commands are kept, and a reconnecting client sends Last-Event-ID,
//   so nothing is lost or run twice when the stream drops (the client also ignores ids it has already seen);
// - a stream whose client stops reading (more than 8 MB buffered) is dropped, so the client reconnects instead of the
//   process buffering forever;
// - after the event loop was frozen (app suspended) or when the native side asks for it (wake file), the listening
//   socket is closed and opened again on the same port, and the event stream is dropped so the client reconnects.
const http = require('http');
const fs = require('fs');
const { EventEmitter } = require('events');

const bus = new EventEmitter(); bus.setMaxListeners(0);
let token = '';
let stream = null;
let eid = 0; const ring = []; let ringBytes = 0;
const RING_MAX = 4000, RING_BYTES = 32 * 1024 * 1024, STREAM_BACKLOG = 8 * 1024 * 1024;
let seq = 0; const waiting = new Map();
const handlers = { invoke: null, send: null, scheme: null };
const stats = { pushed: 0, replayed: 0, reconnects: 0, dropped: 0, relistens: 0, requests: 0, inflight: 0, startedAt: Date.now() };

function push(obj) {
  const id = ++eid;
  const line = 'id: ' + id + '\ndata: ' + JSON.stringify(obj) + '\n\n';
  ring.push({ id, line }); ringBytes += line.length; stats.pushed++;
  while (ring.length > RING_MAX || (ringBytes > RING_BYTES && ring.length > 1)) ringBytes -= ring.shift().line.length;
  if (stream) write(stream, line);
}
function write(res, line) {
  try {
    if (res.destroyed || res.writableEnded) return false;
    res.write(line);
    // the client stopped reading (suspended / defunct socket): drop the stream; the client reconnects and replays
    if (res.writableLength > STREAM_BACKLOG) { stats.dropped++; console.warn('[aib-host] event stream backlog', res.writableLength, '- dropping stream'); try { res.destroy(); } catch {} if (stream === res) stream = null; return false; }
    return true;
  } catch { return false; }
}
// fire-and-forget command
function cmd(name, args) { push(Object.assign({ cmd: name }, args || {})); }
// command with a result (rejects after timeoutMs; 0 = no timeout)
function call(name, args, timeoutMs = 60000, onPartial) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const w = { resolve, reject, onPartial, timer: null, name, at: Date.now() };
    if (timeoutMs) w.timer = setTimeout(() => { waiting.delete(id); reject(new Error('原生层响应超时：' + name)); }, timeoutMs);
    waiting.set(id, w);
    push(Object.assign({ cmd: name, seq: id }, args || {}));
  });
}

function readBody(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const json = (res, code, obj) => { const b = Buffer.from(JSON.stringify(obj === undefined ? null : obj)); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length }); res.end(b); };
// JSON can not carry undefined / Buffer / Map; normalise IPC results like Electron's structured clone would.
function clone(v, depth = 0) {
  if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return null;
  if (v === null || typeof v !== 'object') return typeof v === 'bigint' ? Number(v) : v;
  if (depth > 60) return null;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __aibBytes: Buffer.from(v).toString('base64') };
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Error) return { message: v.message, name: v.name };
  if (v instanceof Map) return Object.fromEntries(Array.from(v.entries()).map(([k, x]) => [k, clone(x, depth + 1)]));
  if (v instanceof Set) return Array.from(v).map(x => clone(x, depth + 1));
  if (Array.isArray(v)) return v.map(x => clone(x, depth + 1));
  const o = {}; for (const k of Object.keys(v)) { const x = v[k]; if (x !== undefined && typeof x !== 'function') o[k] = clone(x, depth + 1); } return o;
}

function start({ port, tok, wake }) {
  token = tok; srvPort = port; wakeFile = wake || ''; wakeSeen = Date.now();
  const server = http.createServer(async (req, res) => {
    if (req.headers['x-aib-token'] !== token) { res.writeHead(403); res.end(); return; }
    stats.requests++; stats.inflight++; res.on('close', () => { stats.inflight--; });
    const u = new URL(req.url, 'http://127.0.0.1');
    try {
      if (u.pathname === '/host/events') {
        // nosniff + a 2 KB comment up front: URLSession may hold back the first bytes of a response for content sniffing
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.socket.setNoDelay(true); res.socket.setTimeout(0);
        if (stream && stream !== res) { try { stream.end(); } catch {} }
        stream = res; stats.reconnects++;
        const last = Number(req.headers['last-event-id'] || 0) || 0;
        res.write(': hello ' + ' '.repeat(2048) + '\n\n');
        // replay what the client has not seen (everything on the first connection)
        for (const r of ring) if (r.id > last) { stats.replayed += last ? 1 : 0; if (!write(res, r.line)) break; }
        const ka = setInterval(() => { write(res, ': ka ' + Date.now() + '\n\n'); }, 15000);
        const done = () => { clearInterval(ka); if (stream === res) stream = null; };
        req.on('close', done); res.on('close', done); res.on('error', done);
        bus.emit('connected', { last });
        return;
      }
      if (u.pathname === '/host/ping') { json(res, 200, health()); return; }
      const body = await readBody(req);
      if (u.pathname === '/scheme') {
        const meta = JSON.parse(req.headers['x-aib-meta'] || '{}');
        const r = await handlers.scheme(meta, body);
        const headers = Object.assign({}, r.headers || {}, { 'X-AIB-Status': String(r.status || 200) });
        res.writeHead(200, headers); res.end(r.body || Buffer.alloc(0));
        return;
      }
      const msg = body.length ? JSON.parse(body.toString('utf8')) : {};
      if (u.pathname === '/ipc/invoke') {
        try { const r = await handlers.invoke(msg); json(res, 200, { ok: true, result: clone(r) }); }
        catch (e) { json(res, 200, { ok: false, error: String(e && e.message || e) }); }
        return;
      }
      if (u.pathname === '/ipc/send') { try { handlers.send(msg); } catch (e) { console.error('ipc send', e); } json(res, 200, { ok: true }); return; }
      if (u.pathname === '/host/reply') {
        const w = waiting.get(msg.seq);
        if (w) {
          if (msg.partial) { if (w.onPartial) try { w.onPartial(msg.partial); } catch (e) { console.error(e); } }
          else { waiting.delete(msg.seq); clearTimeout(w.timer); msg.ok === false ? w.reject(new Error(msg.error || 'native error')) : w.resolve(msg.result); }
        }
        json(res, 200, { ok: true }); return;
      }
      if (u.pathname === '/host/event') {
        // events may need a synchronous answer (will-download -> save path, new-window -> allow/deny)
        const answer = await new Promise((resolve) => {
          let answered = false; const reply = (v) => { if (!answered) { answered = true; resolve(v); } };
          try { bus.emit('event', msg, reply); } catch (e) { console.error('host event', msg && msg.type, e); }
          setImmediate(() => reply(null));
        });
        json(res, 200, { ok: true, answer: clone(answer) }); return;
      }
      res.writeHead(404); res.end();
    } catch (e) {
      console.error('host request', u.pathname, e);
      try { json(res, 500, { ok: false, error: String(e && e.message || e) }); } catch {}
    }
  });
  server.keepAliveTimeout = 120000; server.headersTimeout = 0; server.requestTimeout = 0;
  listen(server);
  watchSuspend();
  return server;
}

// ---------------------------------------------------------------- listening socket lifecycle
let srv = null, srvPort = 0, wakeFile = '', wakeSeen = 0;
function listen(server) {
  srv = server;
  server.on('error', (e) => {
    console.error('[aib-host] server error', e && e.code, e && e.message);
    setTimeout(() => relisten('error ' + (e && e.code)), 300);
  });
  server.listen(srvPort, '127.0.0.1', () => console.log('[aib-host] listening on', srvPort));
}
// Close the listening socket and open it again on the same port (the old one may have been reclaimed by the OS while
// the app was suspended). Open connections are dropped so the client reconnects on fresh sockets.
let relistening = false;
function relisten(why) {
  if (relistening || !srv) return; relistening = true; stats.relistens++;
  console.log('[aib-host] reopening the listening socket:', why);
  const old = srv;
  try { old.close(); } catch {}
  try { old.closeIdleConnections && old.closeIdleConnections(); } catch {}
  if (stream) { try { stream.destroy(); } catch {} stream = null; }
  const again = (n) => {
    const s = http.createServer(old.listeners('request')[0]);
    s.keepAliveTimeout = 120000; s.headersTimeout = 0; s.requestTimeout = 0;
    s.once('error', (e) => { if (n < 40) setTimeout(() => again(n + 1), 250); else { console.error('[aib-host] could not reopen port', srvPort, e.message); relistening = false; } });
    s.listen(srvPort, '127.0.0.1', () => {
      s.removeAllListeners('error'); srv = s; relistening = false;
      s.on('error', (e) => { console.error('[aib-host] server error', e && e.code); setTimeout(() => relisten('error ' + (e && e.code)), 300); });
      console.log('[aib-host] listening again on', srvPort);
      bus.emit('relisten', why);
    });
  };
  again(0);
}
// A frozen event loop (the app was suspended) shows up as a late timer; the native side can also touch the wake file.
function watchSuspend() {
  let last = Date.now();
  const t = setInterval(() => {
    const now = Date.now(); const gap = now - last; last = now;
    if (gap > 8000) relisten('event loop was frozen for ' + Math.round(gap / 1000) + ' s');
    if (wakeFile) { try { const m = fs.statSync(wakeFile).mtimeMs; if (m > wakeSeen) { wakeSeen = m; relisten('wake file'); } } catch {} }
  }, 1000);
  if (t.unref) t.unref();
}
function health() {
  const m = process.memoryUsage();
  return { ok: true, eid, ring: ring.length, ringBytes, waiting: waiting.size, stream: !!stream, backlog: stream ? stream.writableLength : 0, stats, rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external, uptime: Math.round((Date.now() - stats.startedAt) / 1000) };
}
// waiting calls that never got an answer (e.g. a web view that went away) are kept at most 10 minutes when they have no timeout
setInterval(() => { const now = Date.now(); for (const [id, w] of waiting) if (!w.timer && now - w.at > 10 * 60 * 1000 && !/^(dialog|menu|wc\.print|llama)/.test(w.name)) { waiting.delete(id); w.reject(new Error('原生层未响应：' + w.name)); } }, 60000).unref();

module.exports = { start, cmd, call, bus, handlers, clone, health, relisten, _ring: () => ring };
