'use strict';
// Logging that can never loop or fill the disk (desktop main process and the iPad Node.js runtime).
//  * stdout / stderr may be a pipe whose reader has gone away (terminal closed, test harness ended). Writing then fails
//    with EPIPE, emitted asynchronously as an 'error' event; without a listener that becomes an uncaught exception.
//    An uncaught-exception handler that logs with console.error writes to the same closed pipe → EPIPE again → … forever.
//    guardStdio() listens for those errors and marks the stream closed; console output to a closed stream is dropped.
//  * guardedHandler() wraps uncaught-exception / unhandled-rejection handlers: pipe errors are ignored and a handler
//    that fails (or logs while already handling) cannot re-enter itself.
//  * rotatingLog() appends to a log file capped at maxBytes, keeping `keep` files in total (node.log, node.log.1).
const fs = require('fs');

const PIPE_CODES = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END', 'EBADF', 'ECONNRESET']);
const closed = { stdout: false, stderr: false };

function isPipeError(e) { return !!(e && typeof e === 'object' && PIPE_CODES.has(e.code)); }

function guardStdio(proc = process) {
  for (const n of ['stdout', 'stderr']) {
    const s = proc[n];
    if (!s || s.__aibGuarded) continue;
    try { Object.defineProperty(s, '__aibGuarded', { value: true }); } catch {}
    s.on('error', (e) => { closed[n] = true; if (!isPipeError(e)) { /* other stream errors: drop output too */ } });
    s.on('close', () => { closed[n] = true; });
  }
}

const STREAM = { log: 'stdout', info: 'stdout', debug: 'stdout', warn: 'stderr', error: 'stderr' };
// Replace console.<level> with a version that also calls sink(level, args) (e.g. the log file) and never throws.
function wrapConsole({ sink, levels = ['log', 'info', 'warn', 'error'] } = {}) {
  guardStdio();
  for (const lvl of levels) {
    if (!console[lvl] || console[lvl].__aibOrig) continue; // already wrapped (iPad: main-ipad.js wraps first, with its log file)
    const orig = console[lvl].bind(console);
    let busy = false;
    const fn = (...a) => {
      if (busy) return; // a sink or stream that logs while logging
      busy = true;
      try {
        if (sink) { try { sink(lvl, a); } catch {} }
        const s = STREAM[lvl] || 'stdout';
        if (!closed[s]) { try { orig(...a); } catch (e) { if (isPipeError(e)) closed[s] = true; } }
      } finally { busy = false; }
    };
    fn.__aibOrig = orig;
    console[lvl] = fn;
  }
}

function guardedHandler(handler) {
  let busy = false;
  return (e, ...rest) => {
    if (isPipeError(e) || busy) return;
    busy = true;
    try { handler(e, ...rest); } catch {} finally { busy = false; }
  };
}

function rotatingLog(file, { maxBytes = 5 * 1024 * 1024, keep = 2 } = {}) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch {}
  const rotate = () => {
    for (let i = keep - 1; i >= 1; i--) {
      const from = i === 1 ? file : file + '.' + (i - 1);
      try { if (i === keep - 1) fs.rmSync(file + '.' + i, { force: true }); fs.renameSync(from, file + '.' + i); } catch {}
    }
    if (keep <= 1) { try { fs.rmSync(file, { force: true }); } catch {} }
    size = 0;
  };
  if (size > maxBytes) rotate();
  const write = (line) => {
    const s = String(line);
    const n = Buffer.byteLength(s);
    if (size + n > maxBytes) rotate();
    try { fs.appendFileSync(file, s.length > maxBytes ? s.slice(0, maxBytes) : s); size += Math.min(n, maxBytes); } catch {}
  };
  write.file = file;
  write.size = () => size;
  return write;
}

module.exports = { isPipeError, guardStdio, wrapConsole, guardedHandler, rotatingLog, _closed: closed };
