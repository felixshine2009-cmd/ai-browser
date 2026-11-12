'use strict';
// iPad entry point for the embedded Node.js runtime (nodejs-mobile). Starts the loopback host bridge, waits for the
// native shell's "init" event, then runs the desktop main process (src/main/main.js) unchanged on top of the Electron
// API implementation in node_modules/electron.
const path = require('path');
const fs = require('fs');

const arg = (name, def = '') => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const ROOT = __dirname;
const userData = arg('userdata');
const documents = arg('documents');
const tmp = arg('tmp', require('os').tmpdir());
fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });

// ---- logging: nodejs-mobile has no visible stdout; keep a rotating log file under userData/logs
const LOG = path.join(userData, 'logs', 'node.log');
try { if (fs.statSync(LOG).size > 4 * 1024 * 1024) fs.renameSync(LOG, LOG + '.1'); } catch {}
const util = require('util');
for (const lvl of ['log', 'info', 'warn', 'error']) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${lvl} ${util.format(...a)}\n`); } catch {} try { orig(...a); } catch {} };
}
process.on('uncaughtException', (e) => console.error('uncaught', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('unhandled rejection', e && e.stack || e));

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

const host = require('./host');
host.start({ port: Number(arg('port')), tok: arg('token') });
const electron = require('electron');

let started = false;
host.bus.on('event', (m) => {
  if (!m || m.type !== 'init' || started) return;
  started = true;
  electron.__ipad.init(m);
  if (m.os) global.__aibIpad.os = String(m.os);
  console.log('[aib] init', JSON.stringify({ w: m.w, h: m.h, biometry: !!m.biometry, os: m.os || '' }));
  try {
    require('./src/main/main.js');
    require('./ipad-extra.js');
  } catch (e) { console.error('main failed to load', e && e.stack || e); }
  // Host simulator only (never set on a device): run agent tools directly for tests.
  if (process.env.AIB_SIM_TOOLS_PORT) {
    require('http').createServer(async (req, res) => {
      let body = ''; for await (const c of req) body += c;
      let out;
      try { const { name, args } = JSON.parse(body); const t = require('./src/main/ai/compute-tools').TOOLS.find(x => x.name === name); if (!t) throw new Error('unknown tool ' + name); out = { ok: true, result: await t.run(args || {}, { emit: () => {} }) }; }
      catch (e) { out = { ok: false, error: String(e && e.message || e) }; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out));
    }).listen(Number(process.env.AIB_SIM_TOOLS_PORT), '127.0.0.1');
  }
  setImmediate(() => electron.app._markReady());
});
console.log('[aib] node', process.version, 'waiting for host');
