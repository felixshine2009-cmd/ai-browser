'use strict';
// iPad entry point for the embedded Node.js runtime (nodejs-mobile). Starts the loopback host bridge, waits for the
// native shell's "init" event, then runs the desktop main process (src/main/main.js) unchanged on top of the Electron
// API implementation in node_modules/electron.
// First: WebAssembly for Node's fetch / Response on iOS (no JIT there, so no native WebAssembly). See wasm-shim.js.
let wasmShimError = null;
try { require('./wasm-shim.js'); } catch (e) { wasmShimError = e; }
// Second: nodejs-mobile has no ICU, so its TextDecoder only knows utf-8 / utf-16le (js-mdict creates BIG5 / GB18030
// decoders when it loads). See encoding-shim.js.
let encodingShimError = null;
try { require('./encoding-shim.js'); } catch (e) { encodingShimError = e; }
const path = require('path');
const fs = require('fs');

const arg = (name, def = '') => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const ROOT = __dirname;
const userData = arg('userdata');
const documents = arg('documents');
const tmp = arg('tmp', require('os').tmpdir());
fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });

// ---- logging: nodejs-mobile has no visible stdout; keep a rotating log file under userData/logs, mirrored to
// Documents/日志/node.log so that it can be read in the Files app (On My iPad → AI 浏览器 → 日志)
const LOG = path.join(userData, 'logs', 'node.log');
const DOC_LOG_DIR = documents ? path.join(documents, '日志') : '';
const DOC_LOG = DOC_LOG_DIR ? path.join(DOC_LOG_DIR, 'node.log') : '';
try { if (DOC_LOG_DIR) fs.mkdirSync(DOC_LOG_DIR, { recursive: true }); } catch {}
for (const f of [LOG, DOC_LOG]) { try { if (f && fs.statSync(f).size > 2 * 1024 * 1024) fs.renameSync(f, f + '.1'); } catch {} }
const util = require('util');
for (const lvl of ['log', 'info', 'warn', 'error']) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => {
    const line = `[${new Date().toISOString()}] ${lvl} ${util.format(...a)}\n`;
    try { fs.appendFileSync(LOG, line); } catch {}
    if (DOC_LOG) { try { fs.appendFileSync(DOC_LOG, line); } catch {} }
    try { orig(...a); } catch {}
  };
}
let host = null, windowShown = false;
// startup problems go to the native shell at once, which shows them in its diagnostics panel (BrowserViewController)
function diag(stage, err, fatal) {
  const text = String(err && err.stack || err);
  try { host && host.cmd('app.diag', { stage, error: text.slice(0, 8000), fatal: !!fatal }); } catch {}
}
process.on('uncaughtException', (e) => { console.error('uncaught', e && e.stack || e); if (!windowShown) diag('uncaught', e, false); });
process.on('unhandledRejection', (e) => { console.error('unhandled rejection', e && e.stack || e); if (!windowShown) diag('unhandled', e, false); });
{ const W = globalThis.WebAssembly; console.log('[aib] start', process.version, process.platform, process.arch, 'webassembly:', W ? (W.__aibPolyfill ? 'polywasm (no JIT)' : 'native') : 'none'); }
if (wasmShimError) console.error('wasm shim failed', wasmShimError && wasmShimError.stack || wasmShimError);
console.log('[aib] intl:', typeof Intl === 'undefined' ? 'none' : 'icu', 'textdecoder:', globalThis.TextDecoder && globalThis.TextDecoder.__aibPolyfill ? 'iconv-lite fallback' : 'native');
if (encodingShimError) console.error('encoding shim failed', encodingShimError && encodingShimError.stack || encodingShimError);

let version = '0.0.0';
try { version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch {}
global.__aibIpad = { userData, documents, appRoot: ROOT, tmp, version, resources: arg('resources', ROOT) };
global.__aibHostModule = path.join(ROOT, 'host.js');
// The desktop code takes its macOS branches on iPad (Cmd shortcuts, Touch ID / Face ID prompt, Keychain storage).
Object.defineProperty(process, 'platform', { value: 'darwin' });
process.resourcesPath = ROOT;
process.env.AIB_IPAD = '1';
process.env.AIB_USER_DATA = userData;
for (const d of ['Downloads', '导出']) { try { fs.mkdirSync(path.join(documents, d), { recursive: true }); } catch {} }

host = require('./host');
host.start({ port: Number(arg('port')), tok: arg('token'), wake: path.join(tmp, 'aib-wake') });
host.bus.on('event', (m) => { if (m && m.type === 'app' && m.name === 'windowShown') { windowShown = true; console.log('[aib] window shown'); } });
const electron = require('electron');

let started = false;
host.bus.on('event', (m) => {
  if (!m || m.type !== 'init' || started) return;
  started = true;
  electron.__ipad.init(m);
  if (m.os) global.__aibIpad.os = String(m.os);
  console.log('[aib] init', JSON.stringify({ w: m.w, h: m.h, biometry: !!m.biometry, os: m.os || '' }));
  const t0 = Date.now();
  try {
    // host simulator only (never set on a device): exercise the diagnostics path
    if (process.env.AIB_SIM_FAIL_MAIN === '1') throw new Error('forced main.js failure (AIB_SIM_FAIL_MAIN)');
    require('./src/main/main.js');
    require('./ipad-extra.js');
    console.log('[aib] main loaded in', Date.now() - t0, 'ms');
  } catch (e) { console.error('main failed to load', e && e.stack || e); diag('main', e, true); }
  // Host simulator only (never set on a device): run agent tools directly for tests.
  if (process.env.AIB_SIM_TOOLS_PORT) {
    require('http').createServer(async (req, res) => {
      let body = ''; for await (const c of req) body += c;
      let out;
      try { const { name, args } = JSON.parse(body); if (name === '__vm') { const vm = require('./src/main/vm'); out = { ok: true, result: await vm[args.fn](...(args.args || [])) }; } else { const t = require('./src/main/ai/compute-tools').TOOLS.find(x => x.name === name); if (t) out = { ok: true, result: await t.run(args || {}, { emit: () => {} }) }; else { const reg = require('./src/main/ai/tools'); if (!reg.BUILTIN.some(x => x.name === name)) throw new Error('unknown tool ' + name); out = { ok: true, result: await reg.call(name, args || {}, {}) }; } } }
      catch (e) { out = { ok: false, error: String(e && e.message || e) }; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out));
    }).listen(Number(process.env.AIB_SIM_TOOLS_PORT), '127.0.0.1');
  }
  setImmediate(() => electron.app._markReady());
});
console.log('[aib] node', process.version, 'waiting for host');
