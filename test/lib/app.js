'use strict';
// Test harness: launches the real Electron app (under xvfb), attaches Playwright over CDP.
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const electronPath = require(path.join(ROOT, 'node_modules', 'electron'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { await new Promise((res, rej) => http.get(url, r => { r.resume(); r.statusCode === 200 ? res() : rej(); }).on('error', rej)); return; } catch { await sleep(200); }
  }
  throw new Error('timeout waiting for ' + url);
}

async function launch(opts = {}) {
  const port = opts.port || (9300 + Math.floor(Math.random() * 500));
  const userData = opts.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ud-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-dl-'));
  const logs = [];
  const proc = spawn(electronPath, ['.', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${port}`], {
    cwd: ROOT, env: { ...process.env, AIB_USER_DATA: userData, AIB_DOWNLOAD_DIR: dlDir, ELECTRON_ENABLE_LOGGING: '1', ...(opts.env || {}) }
  });
  proc.stdout.on('data', d => logs.push(String(d)));
  proc.stderr.on('data', d => logs.push(String(d)));
  let exited = false; proc.on('exit', () => { exited = true; });
  await waitHttp(`http://127.0.0.1:${port}/json/version`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  // Playwright installs its own download interception over CDP (and deletes the files); restore Electron's native behaviour
  try { const s = await browser.newBrowserCDPSession(); await s.send('Browser.setDownloadBehavior', { behavior: 'default' }); } catch (e) { console.log('setDownloadBehavior failed', e.message); }
  const app = {
    proc, port, userData, dlDir, browser, ctx, logs, get exited() { return exited; },
    pages: () => ctx.pages(),
    async waitPage(match, ms = 20000) {
      const t0 = Date.now();
      const test = typeof match === 'function' ? match : (u => u.includes(match));
      while (Date.now() - t0 < ms) {
        const p = ctx.pages().find(p => { try { return test(p.url()); } catch { return false; } });
        if (p) return p;
        await sleep(150);
      }
      throw new Error('page not found: ' + match + ' have: ' + ctx.pages().map(p => p.url()).join(' | '));
    },
    chrome() { return app.waitPage(u => u.startsWith('aibrowser://chrome')); },
    // active tab page = visible page with aibrowser:// or http url that is not chrome/overlay
    async activePage() {
      const ch = await app.chrome();
      const info = await ch.evaluate(async () => (await window.aib.invoke('tabs:state')));
      const a = info.tabs.find(t => t.active);
      const p = ctx.pages().find(p => p.url() === a.url) || ctx.pages().find(p => a.url && p.url().startsWith(a.url.split('?')[0]));
      if (!p) throw new Error('active page not found ' + a.url);
      return p;
    },
    async tabsState() { const ch = await app.chrome(); return ch.evaluate(() => window.aib.invoke('tabs:state')); },
    async submit(text) { const ch = await app.chrome(); await ch.focus('#addr'); await sleep(80); await ch.fill('#addr', text); await ch.press('#addr', 'Enter'); },
    async setMode(m) { const ch = await app.chrome(); await ch.click(`#modeseg [data-mode="${m}"]`); },
    screenshot(file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const disp = process.env.DISPLAY || ':99';
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'x11grab', '-i', disp, '-frames:v', '1', file]);
    },
    async close() {
      try { await browser.close(); } catch {}
      if (!exited) { proc.kill('SIGTERM'); await sleep(500); if (!exited) proc.kill('SIGKILL'); }
    }
  };
  return app;
}

module.exports = { launch, sleep, ROOT };

// ---- helpers shared by suites
const b64 = s => 'b64:' + Buffer.from(s, 'utf8').toString('base64');
function seedSettings(userData, obj) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(obj));
}
function apiSettings(port, extra = {}) {
  return { ai: { source: 'api', api: { preset: 'custom', format: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: b64('test-key'), model: 'mock-1', temperature: 0.2 } }, ...extra };
}
async function patchSettings(app, patch) { const ch = await app.chrome(); return ch.evaluate(p => window.aib.invoke('settings:patch', p), patch); }
module.exports.seedSettings = seedSettings;
module.exports.apiSettings = apiSettings;
module.exports.patchSettings = patchSettings;
module.exports.b64 = b64;
