'use strict';
// iPad host transport. The native shell (Swift) and this Node.js runtime run in the same app process; they talk over a
// loopback HTTP server that only accepts requests carrying the per-launch token.
//   Swift -> Node : POST /ipc/invoke, /ipc/send (renderer IPC), POST /host/event (view / window / download events),
//                   POST /scheme (aibrowser:, aibdict:, aibext:, aibzim: requests), POST /host/reply (command results)
//   Node -> Swift : GET /host/events  (one long-lived Server-Sent-Events stream of commands)
const http = require('http');
const { EventEmitter } = require('events');

const bus = new EventEmitter(); bus.setMaxListeners(0);
let token = '';
let stream = null; const queue = [];
let seq = 0; const waiting = new Map();
const handlers = { invoke: null, send: null, scheme: null };

function push(obj) {
  const line = 'data: ' + JSON.stringify(obj) + '\n\n';
  if (stream) { try { stream.write(line); return; } catch {} }
  queue.push(line);
}
// fire-and-forget command
function cmd(name, args) { push(Object.assign({ cmd: name }, args || {})); }
// command with a result (rejects after timeoutMs; 0 = no timeout)
function call(name, args, timeoutMs = 60000, onPartial) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const w = { resolve, reject, onPartial, timer: null };
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

function start({ port, tok }) {
  token = tok;
  const server = http.createServer(async (req, res) => {
    if (req.headers['x-aib-token'] !== token) { res.writeHead(403); res.end(); return; }
    const u = new URL(req.url, 'http://127.0.0.1');
    try {
      if (u.pathname === '/host/events') {
        // nosniff + a 2 KB comment up front: URLSession may hold back the first bytes of a response for content sniffing
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.socket.setNoDelay(true); res.socket.setTimeout(0);
        if (stream) { try { stream.end(); } catch {} }
        stream = res; res.write(': hello ' + ' '.repeat(2048) + '\n\n');
        while (queue.length) res.write(queue.shift());
        const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 15000);
        req.on('close', () => { clearInterval(ka); if (stream === res) stream = null; });
        bus.emit('connected');
        return;
      }
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
  server.listen(port, '127.0.0.1', () => console.log('[aib-host] listening on', port));
  return server;
}

module.exports = { start, cmd, call, bus, handlers, clone };
