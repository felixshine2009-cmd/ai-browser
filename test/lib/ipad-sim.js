'use strict';
// Launches the iPad payload in the iPad host simulator (ipad/sim: the Swift host protocol re-implemented on Electron),
// with the payload's Node side on Node 18 (= nodejs-mobile). Same app API as lib/app.js plus simulator controls.
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { chromium } = require('playwright-core');
const { sleep } = require('./app');

const ROOT = path.join(__dirname, '..', '..');
const electronPath = require(path.join(ROOT, 'node_modules', 'electron'));

function bundleDir() {
  const d = process.env.AIB_IPAD_BUNDLE || path.join(ROOT, 'dist', 'ipad-bundle');
  if (!fs.existsSync(path.join(d, 'nodejs-project', 'main-ipad.js')) || process.env.AIB_IPAD_REBUILD) execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ipad-bundle.js'), d], { stdio: 'inherit' });
  return d;
}
function node18() {
  if (process.env.AIB_NODE) return process.env.AIB_NODE;
  try { const v = execFileSync('node18', ['-v']).toString(); if (v.startsWith('v18')) return 'node18'; } catch {}
  return process.execPath; // CI sets AIB_NODE to a Node 18 binary
}
const get = (port, p, body) => new Promise((resolve, reject) => {
  const b = Buffer.from(JSON.stringify(body == null ? null : body));
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Length': b.length } }, (res) => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString())); } catch (e) { reject(e); } }); });
  r.on('error', reject); r.end(b);
});

async function launchIpad(opts = {}) {
  const port = 9600 + Math.floor(Math.random() * 300), ctl = port + 1000, toolsPort = port + 2000;
  const userData = opts.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipad-ud-'));
  const sp = path.join(userData, 'settings.json');
  if (!fs.existsSync(sp)) { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(sp, JSON.stringify({ onboarding: { completed: true, skipped: false, completedAt: 1 } })); }
  const [w, h] = opts.size || [1180, 820];
  const logs = [];
  const proc = spawn(electronPath, [path.join(ROOT, 'ipad', 'sim'), '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`], {
    cwd: ROOT, env: Object.assign({ ...process.env, AIB_BUNDLE: bundleDir(), AIB_NODE: node18(), AIB_SIM_UD: userData, AIB_SIM_SIZE: `${w}x${h}`, AIB_SIM_CTL: String(ctl), AIB_SIM_DARK: opts.systemDark === false ? '0' : '1', AIB_SIM_TOOLS_PORT: String(toolsPort) }, opts.env || {})
  });
  proc.stdout.on('data', d => logs.push(String(d))); proc.stderr.on('data', d => logs.push(String(d)));
  let exited = false; proc.on('exit', () => { exited = true; });
  const t0 = Date.now();
  for (;;) { try { await new Promise((res, rej) => http.get(`http://127.0.0.1:${port}/json/version`, r => { r.resume(); r.statusCode === 200 ? res() : rej(); }).on('error', rej)); break; } catch { if (Date.now() - t0 > 30000) throw new Error('simulator did not start: ' + logs.join('').slice(-2000)); await sleep(200); } }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  const app = {
    proc, userData, documents: path.join(path.dirname(userData), path.basename(userData) + '-docs'), logs, ctx, browser, size: [w, h],
    get exited() { return exited; },
    async waitPage(match, ms = 20000) {
      const test = typeof match === 'function' ? match : (u => u.includes(match));
      const t1 = Date.now();
      while (Date.now() - t1 < ms) { const p = ctx.pages().find(p => { try { return test(p.url()); } catch { return false; } }); if (p) return p; await sleep(150); }
      throw new Error('page not found: ' + match + ' have: ' + ctx.pages().map(p => p.url()).join(' | '));
    },
    chrome() { return app.waitPage(u => u.startsWith('aibrowser://chrome')); },
    // run an agent tool in the iPad main process (simulator-only hook, AIB_SIM_TOOLS_PORT)
    async tool(name, args) { const r = await fetch(`http://127.0.0.1:${toolsPort}/`, { method: 'POST', body: JSON.stringify({ name, args }) }); const j = await r.json(); if (!j.ok) throw new Error(j.error); return j.result; },
    async invoke(ch, ...a) { const c = await app.chrome(); return c.evaluate(([ch, a]) => window.aib.invoke(ch, ...a), [ch, a]); },
    cmds: () => get(ctl, '/cmds'), state: () => get(ctl, '/state'), event: (m) => get(ctl, '/event', m), menu: (id) => get(ctl, '/menu', { id }), dialog: (response) => get(ctl, '/dialog', { response }),
    native: (m) => get(ctl, '/native', m), stream: () => get(ctl, '/stream'), dropStream: () => get(ctl, '/drop-stream'), ping: () => get(ctl, '/ping'), wake: () => get(ctl, '/wake'), openPaths: (paths) => get(ctl, '/open-paths', { paths }),
    resize: (w2, h2) => { app.size = [w2, h2]; return get(ctl, '/resize', { w: w2, h: h2 }); },
    async submit(text) { const c = await app.chrome(); await c.focus('#addr'); await sleep(80); await c.fill('#addr', text); await c.press('#addr', 'Enter'); },
    /** Full-window screenshot (all native views composited) from the X display the simulator runs on. */
    async screenshot(file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.full.png';
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'x11grab', '-video_size', `${app.size[0]}x${app.size[1]}`, '-i', (process.env.DISPLAY || ':99') + '+0,0', '-frames:v', '1', tmp]);
      fs.renameSync(tmp, file); return file;
    },
    async close() { try { await browser.close(); } catch {} try { proc.kill(); } catch {} await sleep(500); }
  };
  if (opts.waitHome !== false) await app.waitPage(u => u.startsWith('aibrowser://home'), 30000);
  return app;
}
module.exports = { launchIpad };
