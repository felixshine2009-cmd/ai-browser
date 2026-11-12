'use strict';
// Embedded Linux VM on iPad. iPadOS has no Virtualization.framework for apps and no way to start helper processes, so
// the VM is v86 (x86 emulator compiled to WebAssembly) running the bundled Alpine Linux (i686, Python 3 with numpy /
// scipy / sympy / pandas / matplotlib) in a hidden WKWebView. Same module API as the desktop VM (status / start / stop /
// reset / shell / readFile / writeFile / python / ping), so the vm_* agent tools and Settings work unchanged.
// Persistence: /persist (extra Python packages) and /root are saved to userData/vm/persist.tar and restored at boot.
// Shared folder: Documents/Linux 共享 (visible in the Files app) is mirrored to /mnt/share before and after commands.
// The guest has no network; `pip install` is served by the app (pure-Python wheels from PyPI, see pipInstall).
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { BrowserWindow } = require('electron');

const HOST_URL = 'aibres://app/vmhost/index.html';
const IMAGE = { version: 'alpine-3.22-i686-v86', base: '', mirrors: [], files: [] };
const events = new EventEmitter();
let userDataOverride = null;
function userData() { return userDataOverride || process.env.AIB_USER_DATA || require('electron').app.getPath('userData'); }
function documents() { return (global.__aibIpad && global.__aibIpad.documents) || userData(); }
const D = () => { const b = path.join(userData(), 'vm'); return { base: b, img: path.join(b, 'image'), share: path.join(documents(), 'Linux 共享'), bin: path.join(b, 'bin'), log: path.join(b, 'console.log'), state: path.join(b, 'state.json'), persist: path.join(b, 'persist.tar') }; };
function settings() { try { return Object.assign({ memoryMB: 512, cpus: 1, diskGB: 2 }, require('../store').getSettings().vm || {}); } catch { return { memoryMB: 512, cpus: 1, diskGB: 2 }; } }
function backend() { return 'v86'; }
function supported() { return true; }

const st = { phase: 'stopped', detail: '', progress: null, info: null, error: null, startedAt: 0, starting: null, win: null };
function setPhase(phase, detail, extra) { st.phase = phase; st.detail = detail || ''; Object.assign(st, extra || {}); events.emit('state', status()); }
function status() {
  const d = D(); let diskBytes = 0; try { diskBytes = fs.statSync(d.persist).size; } catch {}
  const cfg = settings();
  return { supported: true, backend: 'v86', phase: st.phase, detail: st.detail, progress: st.progress, error: st.error, imageReady: true, imageVersion: IMAGE.version, diskBytes, diskGB: cfg.diskGB, memoryMB: Math.min(1536, Number(cfg.memoryMB) || 512), cpus: 1, info: st.info, share: d.share, startedAt: st.startedAt, network: false };
}
const js = (code) => st.win.webContents.executeJavaScript(code);
function running() { return st.phase === 'running' && st.win && !st.win.isDestroyed(); }

async function start() {
  if (running()) return status();
  if (st.starting) return st.starting;
  st.starting = (async () => {
    try {
      st.error = null; const d = D(); fs.mkdirSync(d.base, { recursive: true }); fs.mkdirSync(d.share, { recursive: true });
      setPhase('booting', 'Linux 虚拟机正在启动…');
      st.win = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences: { sandbox: true } });
      await st.win.loadURL(HOST_URL);
      if (fs.existsSync(d.persist)) {
        const buf = fs.readFileSync(d.persist); const n = 4 * 1024 * 1024;
        for (let i = 0; i < buf.length; i += n) await js(`window.vmhost.putRestoreChunk(${JSON.stringify(buf.subarray(i, i + n).toString('base64'))})`);
      }
      const r = await js(`window.vmhost.start(${JSON.stringify({ memoryMB: settings().memoryMB })})`);
      if (!r || !r.ok) throw new Error((r && r.error) || 'Linux 虚拟机启动失败');
      st.info = Object.assign({}, r.info || {}, { network: false }); st.startedAt = Date.now();
      setPhase('running', 'Linux 虚拟机已就绪');
      return status();
    } catch (e) {
      try { st.win && st.win.destroy(); } catch {} st.win = null;
      setPhase('error', '', { error: String(e.message || e) });
      throw e;
    } finally { st.starting = null; }
  })();
  return st.starting;
}
async function save() {
  if (!running()) return false;
  const r = await js('window.vmhost.save()');
  if (!r || !r.ok) return false;
  const parts = []; for (let i = 0; i < r.chunks; i++) parts.push(Buffer.from(await js(`window.vmhost.saveChunk(${i})`), 'base64'));
  const d = D(); fs.mkdirSync(d.base, { recursive: true }); fs.writeFileSync(d.persist + '.part', Buffer.concat(parts)); fs.renameSync(d.persist + '.part', d.persist);
  return true;
}
async function stop() {
  if (!st.win) { setPhase('stopped', ''); return status(); }
  setPhase('stopping', '正在保存并关闭 Linux 虚拟机…');
  try { await save(); } catch (e) { console.error('vm save', e.message); }
  try { await js('window.vmhost.stop()'); } catch {}
  try { st.win.destroy(); } catch {} st.win = null; st.info = null;
  setPhase('stopped', '');
  return status();
}
async function reset() {
  await stop();
  try { fs.unlinkSync(D().persist); } catch {}
  setPhase('stopped', '虚拟机磁盘已重置，下次启动时会重新准备');
  return status();
}
async function ensure() { if (!running()) await start(); return true; }

// ---- shared folder mirror (Documents/Linux 共享 <-> /mnt/share)
let shareStamp = 0;
async function pushShare() {
  const root = D().share; const since = shareStamp; shareStamp = Date.now();
  const walk = async (d, rel) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { await walk(p, r); continue; }
      const s = fs.statSync(p); if (s.mtimeMs <= since || s.size > 64 * 1024 * 1024) continue;
      await js(`window.vmhost.writeFile(${JSON.stringify('/mnt/share/' + r)}, ${JSON.stringify(fs.readFileSync(p).toString('base64'))}, false)`);
    }
  };
  await walk(root, '');
}
async function pullShare(sinceSec) {
  const r = await runJob(`window.vmhost.exec(${JSON.stringify(`find /mnt/share -type f -newermt @${Math.floor(sinceSec)} 2>/dev/null | head -200`)}, '/', 60)`, {});
  for (const f of String(r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)) {
    try {
      const x = await js(`window.vmhost.readFile(${JSON.stringify(f)}, ${64 * 1024 * 1024})`);
      const dst = path.join(D().share, f.replace(/^\/mnt\/share\/?/, '')); if (!dst.startsWith(D().share)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, Buffer.from(x.b64, 'base64'));
    } catch {}
  }
  shareStamp = Date.now();
}

// ---- jobs: start in the page, then drain output every 250 ms
async function runJob(startExpr, { onOutput, signal, killExpr } = {}) {
  const id = await js(startExpr);
  let out = '', err = ''; const CAP = 400000; let truncated = false;
  const ab = () => { js(killExpr ? killExpr(id) : `window.vmhost.kill(${id})`).catch(() => {}); };
  if (signal) { if (signal.aborted) ab(); else signal.addEventListener('abort', ab); }
  try {
    for (;;) {
      const p = await js(`window.vmhost.poll(${id})`);
      for (const ev of p.events || []) {
        if (ev.stream === 'stderr') { if (err.length < CAP) err += ev.data; else truncated = true; } else { if (out.length < CAP) out += ev.data; else truncated = true; }
        if (onOutput) try { onOutput(ev.stream, ev.data); } catch {}
      }
      if (p.done) return Object.assign({ stdout: out, stderr: err, truncated }, p.result || {});
      await new Promise(r => setTimeout(r, 250));
    }
  } finally { if (signal) signal.removeEventListener('abort', ab); }
}

async function shell(command, { cwd, timeoutSec, signal, onOutput, stdin } = {}) {
  await ensure();
  const t0 = Date.now();
  const pipm = /^\s*(?:python3?\s+-m\s+)?pip3?\s+install\s+(.+)$/.exec(String(command));
  if (pipm) { // no network inside the guest: the app fetches the wheels
    const names = pipm[1].split(/\s+/).filter(x => x && !x.startsWith('-')).map(x => x.replace(/^['"]|['"]$/g, ''));
    try { const r = await pipInstall(names, { onOutput, signal }); const msg = (r.installed.length ? '已安装：' + r.installed.join(', ') + '\n' : '') + (r.needsNative.length ? '以下库需要原生编译，无法在 iPad 的虚拟机中安装（请改用 python_install 的本地引擎）：' + r.needsNative.join(', ') + '\n' : '');
      return { exitCode: r.needsNative.length && !r.installed.length ? 1 : 0, stdout: msg, stderr: '', ms: Date.now() - t0, truncated: false, timedOut: false, stopped: false }; }
    catch (e) { return { exitCode: 1, stdout: '', stderr: String(e.message || e) + '\n', ms: Date.now() - t0, truncated: false, timedOut: false, stopped: !!(signal && signal.aborted) }; }
  }
  const startSec = Date.now() / 1000 - 1;
  await pushShare().catch(() => {});
  const tsec = Math.max(1, Math.min(86400, Number(timeoutSec) || 600));
  const r = await runJob(`window.vmhost.exec(${JSON.stringify(String(command))}, ${JSON.stringify(cwd || '/root/work')}, ${tsec}, ${JSON.stringify(stdin == null ? null : String(stdin))})`, { onOutput, signal });
  await pullShare(startSec).catch(() => {});
  save().catch(() => {});
  return { exitCode: r.code, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0, truncated: !!(r.truncated), timedOut: !!r.timedOut, stopped: !!(signal && signal.aborted) };
}
async function readFile(p, max) {
  await ensure(); await pushShare().catch(() => {});
  const r = await js(`window.vmhost.readFile(${JSON.stringify(String(p))}, ${Math.min(Number(max) || 8 * 1024 * 1024, 64 * 1024 * 1024)})`);
  return { size: r.size, truncated: r.truncated, data: Buffer.from(r.b64 || '', 'base64') };
}
async function writeFile(p, data, { append, mode } = {}) {
  await ensure();
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const r = await js(`window.vmhost.writeFile(${JSON.stringify(String(p))}, ${JSON.stringify(buf.toString('base64'))}, ${!!append})`);
  if (mode) await shell(`chmod ${String(mode).replace(/[^0-7]/g, '')} '${String(p).replace(/'/g, '')}'`, { timeoutSec: 30 });
  return { size: r.size };
}
async function python(code, { session, signal, timeoutSec } = {}) {
  await ensure(); await pushShare().catch(() => {});
  const sess = String(session || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'default';
  let timer; const intr = () => js(`window.vmhost.pyint(${JSON.stringify(sess)})`).catch(() => {});
  if (timeoutSec) timer = setTimeout(intr, timeoutSec * 1000);
  const t0 = Date.now();
  try {
    const r = await runJob(`window.vmhost.py(${JSON.stringify(String(code))}, ${JSON.stringify(sess)})`, { signal, killExpr: () => `window.vmhost.pyint(${JSON.stringify(sess)})` });
    const images = [];
    for (const p of r.images || []) { try { const x = await js(`window.vmhost.readFile(${JSON.stringify(p)}, 0)`); images.push({ name: path.basename(p), path: p, dataUrl: 'data:image/png;base64,' + x.b64 }); } catch {} }
    return { ok: !!r.ok, stdout: r.stdout || '', stderr: r.stderr || '', result: r.result == null ? null : r.result, error: r.error || null, images, ms: Date.now() - t0, engine: 'vm', python: (st.info && st.info.python) || '', session: sess };
  } finally { clearTimeout(timer); }
}
// pure-Python wheels from PyPI, installed into /persist/site (on sys.path in the guest)
async function pipInstall(names, { onOutput, signal } = {}) {
  await ensure();
  const done = [], skipped = []; const seen = new Set();
  const have = async (n) => (await shell(`python3 -c "import importlib.metadata as m; m.version('${n.replace(/[^A-Za-z0-9._-]/g, '')}')"`, { timeoutSec: 60 })).exitCode === 0;
  let index = 'https://pypi.org/pypi/'; try { const i = String(require('../store').getSettings().python.index || ''); if (/^https?:\/\//.test(i) && /\/pypi\/?$/.test(i)) index = i.replace(/\/?$/, '/'); } catch {}
  async function one(spec, depth) {
    const name = String(spec).split(/[<>=!~;\[ ]/)[0].trim(); const key = name.toLowerCase().replace(/[-_.]+/g, '-');
    if (!name || seen.has(key)) return; seen.add(key);
    if (depth > 0 && await have(name)) return;
    if (signal && signal.aborted) throw new Error('已由用户停止');
    const meta = await (await fetch(index + encodeURIComponent(name) + '/json')).json().catch(() => null);
    if (!meta || !meta.urls) throw new Error('PyPI 上找不到：' + name);
    const whl = meta.urls.find(u => u.packagetype === 'bdist_wheel' && /-(py3|py2\.py3)-none-any\.whl$/.test(u.filename));
    if (!whl) { skipped.push(name); return; }
    if (onOutput) onOutput('stdout', `下载 ${whl.filename}\n`);
    const buf = Buffer.from(await (await fetch(whl.url)).arrayBuffer());
    await js(`window.vmhost.writeFile(${JSON.stringify('/tmp/' + whl.filename)}, ${JSON.stringify(buf.toString('base64'))}, false)`);
    const r = await runJob(`window.vmhost.exec(${JSON.stringify(`pip install --no-deps --no-index --target /persist/site --upgrade /tmp/${whl.filename} && rm -f /tmp/${whl.filename}`)}, '/', 600)`, { onOutput });
    if (r.code !== 0) throw new Error('安装失败：' + name);
    done.push(name);
    for (const req of (meta.info && meta.info.requires_dist) || []) { if (/extra\s*==/.test(req)) continue; if (/;/.test(req) && /python_version\s*<\s*"3\.[0-9]"|sys_platform\s*==\s*"(win32|darwin)"/.test(req)) continue; await one(req, depth + 1); }
  }
  for (const n of names) await one(n, 0);
  await save().catch(() => {});
  return { installed: done, needsNative: skipped };
}
async function ping() { await ensure(); const r = await js('window.vmhost.ping()'); st.info = Object.assign({}, st.info || {}, (r && r.info) || {}); return st.info; }
function diskUsage() { const s = status(); return { diskBytes: s.diskBytes, diskGB: s.diskGB, imageReady: true }; }
function shutdownSync() { try { st.win && st.win.destroy(); } catch {} }
function launchArgs() { throw new Error('iPad 使用 v86 虚拟机'); }
function sockPath() { return ''; }

module.exports = { IMAGE, events, status, supported, backend, start, stop, reset, ensure, running, shell, readFile, writeFile, python, ping, diskUsage, shutdownSync, pipInstall, save, dirs: D, launchArgs, sockPath, _setUserData: (p) => { userDataOverride = p; } };
