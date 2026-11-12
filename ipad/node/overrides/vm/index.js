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

// Optional light graphical image (Settings → Linux VM): the base image plus Xvfb / JWM / xterm / xdotool / Dillo / Xfe.
// Only the files that differ from the bundled image are downloaded on first use (userData/vm-gui: fs.json + fs/ blobs);
// SchemeHandler.swift serves aibres://app/vm/fs/<blob> from there when the blob is not in the app bundle.
const GUI_IMAGE = { id: 'alpine-gui', version: 'alpine-3.22-x86-gui-1', asset: 'linux-vm-x86-gui.tar', base: 'https://github.com/felixshine2009-cmd/ai-browser/releases/download/v5.7.0/', mirrors: ['', 'https://ghfast.top/'], downloadMB: 28, memoryMB: 1024 };
const guiDir = () => path.join(userData(), 'vm-gui');
const guiReady = () => { try { return fs.readFileSync(path.join(guiDir(), '.ok'), 'utf8').trim() === GUI_IMAGE.version; } catch { return false; } };
let imageOverride = null;
function imageId() { if (imageOverride) return imageOverride; try { return (require('../store').getSettings().vm || {}).image === 'alpine-gui' ? 'alpine-gui' : 'alpine'; } catch { return 'alpine'; } }
// stream a plain tar (fs.json + fs/<blob>) to disk without holding it in memory
async function extractTarFile(file, dest) {
  const fd = fs.openSync(file, 'r'); const hdr = Buffer.alloc(512); let o = 0, n = 0;
  try {
    const size = fs.fstatSync(fd).size;
    while (o + 512 <= size) {
      fs.readSync(fd, hdr, 0, 512, o);
      const name = hdr.toString('utf8', 0, 100).replace(/\0.*$/, ''); if (!name) break;
      const prefix = hdr.toString('utf8', 345, 500).replace(/\0.*$/, '');
      const len = parseInt(hdr.toString('utf8', 124, 136).replace(/\0.*$/, '').trim() || '0', 8); const type = String.fromCharCode(hdr[156] || 48);
      const rel = (prefix ? prefix + '/' : '') + name; const out = path.join(dest, rel);
      if (!out.startsWith(dest + path.sep)) throw new Error('bad path in image: ' + rel);
      if (type === '5') fs.mkdirSync(out, { recursive: true });
      else if (type === '0' || type === '\0') {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const buf = Buffer.alloc(len); if (len) fs.readSync(fd, buf, 0, len, o + 512); fs.writeFileSync(out, buf); n++;
      }
      o += 512 + Math.ceil(len / 512) * 512;
    }
  } finally { fs.closeSync(fd); }
  return n;
}
async function downloadGui(signal) {
  if (guiReady()) return;
  const dir = guiDir(); fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, 'download.tar.part');
  const local = process.env.AIB_VM_GUI_TAR; // tests: a local copy of the release asset
  if (local) { setPhase('preparing', '正在准备图形镜像…'); fs.copyFileSync(local, tmp); }
  else {
    let lastErr = null;
    for (const m of GUI_IMAGE.mirrors) {
      try {
        const r = await fetch(m + GUI_IMAGE.base + GUI_IMAGE.asset, { signal }); if (!r.ok) throw new Error('HTTP ' + r.status);
        const total = Number(r.headers.get('content-length')) || 0; let got = 0;
        const out = fs.openSync(tmp, 'w');
        try { const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; fs.writeSync(out, value); got += value.length; setPhase('downloading', `正在下载图形镜像…`, { progress: { file: GUI_IMAGE.asset, got, total } }); } }
        finally { fs.closeSync(out); }
        if (total && got !== total) throw new Error('下载不完整');
        lastErr = null; break;
      } catch (e) { lastErr = e; if (signal && signal.aborted) throw new Error('已取消下载'); }
    }
    if (lastErr) throw new Error('下载图形镜像失败：' + (lastErr.message || lastErr));
  }
  setPhase('preparing', '正在解压图形镜像…', { progress: null });
  await extractTarFile(tmp, dir); fs.unlinkSync(tmp);
  if (!fs.existsSync(path.join(dir, 'fs.json'))) throw new Error('图形镜像不完整（缺少 fs.json）');
  fs.writeFileSync(path.join(dir, '.ok'), GUI_IMAGE.version);
}
async function setImage(id) {
  if (id !== 'alpine' && id !== 'alpine-gui') throw new Error('unknown image: ' + id);
  imageOverride = null; try { require('../store').patchSettings({ vm: { image: id } }); } catch { imageOverride = id; }
  if (imageId() !== id) imageOverride = id;
  const was = !!st.win; if (st.win && st.image !== id) await stop();
  if (was) await start();
  return status();
}
async function removeImage(id) {
  if (id !== 'alpine-gui') throw new Error('cannot remove this image');
  if (st.win && st.image === 'alpine-gui') await stop();
  fs.rmSync(guiDir(), { recursive: true, force: true });
  return status();
}
const guiMaxWidth = 0;

const st = { phase: 'stopped', detail: '', progress: null, info: null, error: null, startedAt: 0, starting: null, win: null };
function setPhase(phase, detail, extra) { st.phase = phase; st.detail = detail || ''; Object.assign(st, extra || {}); events.emit('state', status()); }
function status() {
  const d = D(); let diskBytes = 0; try { diskBytes = fs.statSync(d.persist).size; } catch {}
  const cfg = settings();
  const img = imageId(), gui = img === 'alpine-gui';
  const images = [{ id: 'alpine', gui: false, ready: true, version: IMAGE.version }, { id: 'alpine-gui', gui: true, ready: guiReady(), version: GUI_IMAGE.version, downloadMB: GUI_IMAGE.downloadMB }];
  return { supported: true, backend: 'v86', phase: st.phase, detail: st.detail, progress: st.progress, error: st.error, imageReady: gui ? guiReady() : true, imageVersion: gui ? GUI_IMAGE.version : IMAGE.version, image: img, gui, images, runningImage: st.image || null, diskBytes, diskGB: cfg.diskGB, memoryMB: Math.min(1536, Number(cfg.memoryMB) || 512), cpus: 1, info: st.info, share: d.share, startedAt: st.startedAt, network: false };
}
const js = (code) => st.win.webContents.executeJavaScript(code);
function running() { return st.phase === 'running' && st.win && !st.win.isDestroyed(); }

async function start() {
  if (running()) return status();
  if (st.starting) return st.starting;
  st.starting = (async () => {
    try {
      st.error = null; const d = D(); fs.mkdirSync(d.base, { recursive: true }); fs.mkdirSync(d.share, { recursive: true });
      const img = imageId(); st.image = img;
      if (img === 'alpine-gui') await downloadGui();
      setPhase('booting', 'Linux 虚拟机正在启动…');
      st.win = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences: { sandbox: true } });
      await st.win.loadURL(HOST_URL);
      if (fs.existsSync(d.persist)) {
        const buf = fs.readFileSync(d.persist); const n = 4 * 1024 * 1024;
        for (let i = 0; i < buf.length; i += n) await js(`window.vmhost.putRestoreChunk(${JSON.stringify(buf.subarray(i, i + n).toString('base64'))})`);
      }
      const gui = st.image === 'alpine-gui';
      await js(`window.vmhost.beginStart(${JSON.stringify({ memoryMB: gui ? Math.max(GUI_IMAGE.memoryMB, Number(settings().memoryMB) || 0) : settings().memoryMB, basefs: gui ? 'aibres://data/vm-gui/fs.json' : '' })})`);
      let r = null; const t0 = Date.now();
      while (!(r && r.done)) {
        if (Date.now() - t0 > 900000) throw new Error('Linux 虚拟机启动超时');
        await new Promise((res) => setTimeout(res, 1000)); r = await js('window.vmhost.startResult()');
      }
      if (!r || !r.ok) throw new Error((r && r.error) || 'Linux 虚拟机启动失败');
      st.info = Object.assign({}, r.info || {}, { network: false }); st.startedAt = Date.now();
      try { await afterBoot(); } catch (e) { console.error('vm afterBoot', e.message); }
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
async function ensure() { if (running() && st.image && st.image !== imageId()) await stop(); if (!running()) await start(); return true; }

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

async function shell(command, { cwd, timeoutSec, signal, onOutput, stdin, quick } = {}) {
  await ensure();
  const t0 = Date.now();
  if (quick) { // internal helper commands of the VM tools: no shared-folder sync, no snapshot
    const r = await runJob(`window.vmhost.exec(${JSON.stringify(String(command))}, ${JSON.stringify(cwd || '/root/work')}, ${Math.max(1, Math.min(86400, Number(timeoutSec) || 600))}, ${JSON.stringify(stdin == null ? null : String(stdin))})`, { onOutput, signal });
    return { exitCode: r.code, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0, truncated: !!r.truncated, timedOut: !!r.timedOut, stopped: !!(signal && signal.aborted) };
  }
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
// ---- software packages without network in the guest: the app resolves and downloads Alpine packages (APKINDEX),
// installs them with `apk add --no-network`, caches the .apk files and re-installs them after every boot (only /root and
// /persist survive a restart of the in-memory VM).
const ALPINE = 'https://dl-cdn.alpinelinux.org/alpine';
const apkCacheDir = () => path.join(D().base, 'apk-cache');
const apkWorldFile = () => path.join(D().base, 'apk-world.json');
function apkWorld() { try { return JSON.parse(fs.readFileSync(apkWorldFile(), 'utf8')); } catch { return { packages: [], files: [] }; } }
function untar(buf) { const out = {}; let o = 0; while (o + 512 <= buf.length) { const name = buf.toString('utf8', o, o + 100).replace(/\0.*$/, ''); if (!name) break; const size = parseInt(buf.toString('utf8', o + 124, o + 136).replace(/\0.*$/, '').trim() || '0', 8); out[name] = buf.subarray(o + 512, o + 512 + size); o += 512 + Math.ceil(size / 512) * 512; } return out; }
function parseApkIndex(text, repo) {
  const pk = []; let cur = {};
  for (const line of String(text).split('\n')) {
    if (!line.trim()) { if (cur.P) pk.push(cur); cur = {}; continue; }
    const k = line[0], v = line.slice(2);
    if (k === 'P') cur.P = v; else if (k === 'V') cur.V = v; else if (k === 'D') cur.D = v.split(' ').filter(Boolean); else if (k === 'p') cur.p = v.split(' ').filter(Boolean); else if (k === 'S') cur.S = Number(v);
    cur.repo = repo;
  }
  if (cur.P) pk.push(cur);
  return pk;
}
const depName = (d) => d.replace(/^!/, '').split(/[<>=~]/)[0];
let apkIdx = null;
async function apkIndex(onOutput) {
  if (apkIdx) return apkIdx;
  const r = await runJob(`window.vmhost.exec(${JSON.stringify('cat /etc/apk/arch; cut -d. -f1,2 /etc/alpine-release')}, '/', 30)`, {});
  const [arch, ver] = String(r.stdout || '').trim().split('\n');
  const byName = new Map(), byProv = new Map();
  for (const repo of ['main', 'community']) {
    const url = `${ALPINE}/v${ver}/${repo}/${arch}`;
    if (onOutput) onOutput('stdout', `fetch ${url}/APKINDEX.tar.gz\n`);
    const res = await fetch(url + '/APKINDEX.tar.gz'); if (!res.ok) throw new Error('无法获取软件包索引（HTTP ' + res.status + '）');
    const tar = untar(require('zlib').gunzipSync(Buffer.from(await res.arrayBuffer())));
    for (const p of parseApkIndex((tar.APKINDEX || Buffer.alloc(0)).toString('utf8'), url)) {
      if (!byName.has(p.P)) byName.set(p.P, p);
      for (const pr of p.p || []) { const n = depName(pr); if (!byProv.has(n)) byProv.set(n, p); }
    }
  }
  apkIdx = { byName, byProv, arch, ver }; return apkIdx;
}
async function apkInstalled() {
  const r = await js(`window.vmhost.readFile('/lib/apk/db/installed', 0)`).catch(() => null);
  const have = new Set(); if (!r) return have;
  for (const line of Buffer.from(r.b64, 'base64').toString('utf8').split('\n')) { if (line.startsWith('P:')) have.add(line.slice(2)); else if (line.startsWith('p:')) for (const x of line.slice(2).split(' ')) have.add(depName(x)); }
  return have;
}
async function apkPushAndAdd(files, { onOutput } = {}) {
  for (const f of files) await js(`window.vmhost.writeFile(${JSON.stringify('/tmp/aib-apk/' + f)}, ${JSON.stringify(fs.readFileSync(path.join(apkCacheDir(), f)).toString('base64'))}, false)`);
  const r = await runJob(`window.vmhost.exec(${JSON.stringify('apk add --allow-untrusted --no-network --no-progress ' + files.map(f => '/tmp/aib-apk/' + f).join(' ') + '; s=$?; rm -rf /tmp/aib-apk; exit $s')}, '/', 900)`, { onOutput });
  return r;
}
async function apkInstall(names, { onOutput, signal } = {}) {
  await ensure();
  const idx = await apkIndex(onOutput); const have = await apkInstalled();
  const need = []; const seen = new Set(); const missing = [];
  const visit = (dep) => {
    if (dep.startsWith('!')) return; const n = depName(dep); if (!n || have.has(n) || seen.has(n)) return; seen.add(n);
    const p = idx.byName.get(n) || idx.byProv.get(n); if (!p) { missing.push(n); return; }
    if (have.has(p.P) || need.includes(p)) return;
    need.push(p); for (const d of p.D || []) visit(d);
  };
  for (const n of names) { if (!idx.byName.get(n) && !idx.byProv.get(n)) throw new Error('Alpine 软件源中没有这个包：' + n); visit(n); }
  if (!need.length) return { ok: true, exitCode: 0, installed: [], output: '已安装 / already installed: ' + names.join(', ') };
  fs.mkdirSync(apkCacheDir(), { recursive: true });
  const files = [];
  for (const p of need) {
    if (signal && signal.aborted) throw new Error('已由用户停止');
    const f = `${p.P}-${p.V}.apk`; const dst = path.join(apkCacheDir(), f);
    if (!fs.existsSync(dst)) { if (onOutput) onOutput('stdout', `download ${f}\n`); const res = await fetch(`${p.repo}/${f}`); if (!res.ok) throw new Error('下载失败：' + f + '（HTTP ' + res.status + '）'); fs.writeFileSync(dst, Buffer.from(await res.arrayBuffer())); }
    files.push(f);
  }
  const r = await apkPushAndAdd(files, { onOutput });
  if (r.code === 0) { const w = apkWorld(); w.packages = Array.from(new Set(w.packages.concat(names))); w.files = Array.from(new Set(w.files.concat(files))); fs.writeFileSync(apkWorldFile(), JSON.stringify(w)); }
  return { ok: r.code === 0, exitCode: r.code, installed: need.map(p => p.P + '-' + p.V), unresolved: missing.length ? missing : undefined, output: String((r.stdout || '') + (r.stderr || '')).slice(-6000), note: '应用已代为下载（虚拟机内没有网络）；这些软件包会在每次虚拟机启动时自动重新安装' };
}
async function offlineInstall(manager, names, opts = {}) {
  if (manager === 'apk') return apkInstall(names, opts);
  if (manager === 'pip') { const r = await pipInstall(names, opts); return { ok: !r.needsNative.length, exitCode: r.needsNative.length ? 1 : 0, installed: r.installed, needsNative: r.needsNative.length ? r.needsNative : undefined }; }
  throw new Error('iPad 上的虚拟机没有网络，只支持 apk 和 pip 安装（由应用代为下载）');
}
async function afterBoot() {
  const w = apkWorld(); const files = w.files.filter(f => fs.existsSync(path.join(apkCacheDir(), f)));
  if (files.length) { setPhase('booting', '正在恢复已安装的软件包…'); await apkPushAndAdd(files); }
  await runJob(`window.vmhost.exec(${JSON.stringify(require('../vm/codex-tools').BOOT_CMD)}, '/', 60)`, {});
}
async function ping() { await ensure(); const r = await js('window.vmhost.ping()'); st.info = Object.assign({}, st.info || {}, (r && r.info) || {}); return st.info; }
function diskUsage() { const s = status(); return { diskBytes: s.diskBytes, diskGB: s.diskGB, imageReady: true }; }
function shutdownSync() { try { st.win && st.win.destroy(); } catch {} }
function launchArgs() { throw new Error('iPad 使用 v86 虚拟机'); }
function sockPath() { return ''; }

module.exports = { IMAGE, GUI_IMAGE, setImage, removeImage, imageId, guiMaxWidth, events, status, supported, backend, start, stop, reset, ensure, running, shell, readFile, writeFile, python, ping, diskUsage, shutdownSync, pipInstall, offlineInstall, apkInstall, save, dirs: D, launchArgs, sockPath, _setUserData: (p) => { userDataOverride = p; } };
