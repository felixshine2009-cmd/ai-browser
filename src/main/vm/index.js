'use strict';
// Embedded Linux VM (desktop). On Apple Silicon Macs the VM runs on Apple's Virtualization.framework through the bundled
// vfkit helper (Apache-2.0): arm64 Alpine Linux, virtio-net NAT (internet), virtio-fs share (userData/vm/share ↔ /mnt/share),
// persistent ext4 disk (userData/vm/disk.img), guest agent over virtio-vsock. The guest image (~210 MB) is downloaded on
// first use. A QEMU backend (AIB_VM_BACKEND=qemu) runs the same image on Linux for automated tests.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn, execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { AgentClient } = require('./agent-client');

const IMAGE = {
  version: 'alpine-3.22-1',
  base: 'https://github.com/felixshine2009-cmd/ai-browser/releases/download/v5.3.0/',
  mirrors: ['', 'https://ghfast.top/'],
  files: [
    { asset: 'linux-vm-arm64-vmlinux.gz', out: 'vmlinux', gunzip: true },
    { asset: 'linux-vm-arm64-initramfs.gz', out: 'initramfs.gz', gunzip: false },
    { asset: 'linux-vm-arm64-rootfs.img.gz', out: 'disk.img', gunzip: true, disk: true }
  ]
};
// Optional graphical image (Settings → Linux VM): Debian 13 arm64 + XFCE on Xvfb, same kernel / initramfs, its own disk.
// Downloaded on first use; the Alpine disk is kept, so switching back and forth loses nothing.
const IMAGES = {
  alpine: IMAGE,
  'debian-xfce': {
    version: 'debian-13-xfce-1',
    base: 'https://github.com/felixshine2009-cmd/ai-browser/releases/download/v5.7.0/',
    mirrors: IMAGE.mirrors,
    gui: true,
    files: [IMAGE.files[0], IMAGE.files[1], { asset: 'linux-vm-arm64-debian-xfce.img.gz', out: 'disk-debian-xfce.img', gunzip: true, disk: true, base: 'https://github.com/felixshine2009-cmd/ai-browser/releases/download/v5.7.0/', local: 'rootfs-debian-xfce.img' }]
  }
};
let imageOverride = null; // tests / when settings cannot be saved
function imageId() { const id = imageOverride || settings().image; return IMAGES[id] ? id : 'alpine'; }
function cur() { return IMAGES[imageId()]; }
const diskOf = (im) => im.files.find(f => f.disk).out;
const okOf = (im) => (im === IMAGE ? '.ok' : '.ok-' + Object.keys(IMAGES).find(k => IMAGES[k] === im));
const events = new EventEmitter();
let userDataOverride = null;
function userData() {
  if (userDataOverride) return userDataOverride;
  if (process.env.AIB_USERDATA) return process.env.AIB_USERDATA;
  if (process.versions.electron) return require('electron').app.getPath('userData');
  return path.join(os.tmpdir(), 'aib-userdata');
}
function appRoot() { if (process.versions.electron) { try { return require('electron').app.getAppPath(); } catch {} } return path.join(__dirname, '..', '..', '..'); }
const D = () => { const b = path.join(userData(), 'vm'); return { base: b, img: path.join(b, 'image'), share: path.join(b, 'share'), bin: path.join(b, 'bin'), log: path.join(b, 'console.log'), state: path.join(b, 'state.json') }; };
function settings() { try { return Object.assign({ memoryMB: 2048, cpus: 2, diskGB: 16 }, require('../store').getSettings().vm || {}); } catch { return { memoryMB: 2048, cpus: 2, diskGB: 16 }; } }
function backend() {
  if (process.env.AIB_VM_BACKEND) return process.env.AIB_VM_BACKEND;
  return process.platform === 'darwin' && process.arch === 'arm64' ? 'vfkit' : 'none';
}
function supported() { return backend() !== 'none'; }

const st = { phase: 'stopped', detail: '', progress: null, proc: null, client: null, info: null, error: null, startedAt: 0, starting: null };
function setPhase(phase, detail, extra) {
  st.phase = phase; st.detail = detail || ''; Object.assign(st, extra || {});
  events.emit('state', status());
}
function status() {
  const d = D(); let diskBytes = 0, imageReady = false; const im = cur();
  try { const s = fs.statSync(path.join(d.img, diskOf(im))); diskBytes = s.blocks ? s.blocks * 512 : s.size; imageReady = im.files.every(f => fs.existsSync(path.join(d.img, f.out))) && fs.existsSync(path.join(d.img, okOf(im))); } catch {}
  const cfg = settings();
  const images = Object.keys(IMAGES).map(id => ({ id, gui: !!IMAGES[id].gui, version: IMAGES[id].version, ready: fs.existsSync(path.join(d.img, okOf(IMAGES[id]))) }));
  return { supported: supported(), backend: backend(), phase: st.phase, detail: st.detail, progress: st.progress, error: st.error, imageReady, imageVersion: im.version, image: imageId(), gui: !!im.gui, images, runningImage: st.image || null, diskBytes, diskGB: cfg.diskGB, memoryMB: cfg.memoryMB, cpus: cfg.cpus, info: st.info, share: d.share, startedAt: st.startedAt };
}

// ---------------------------------------------------------------- image download (first use)
async function fetchStream(url) {
  const f = process.versions.electron ? require('electron').net.fetch : fetch;
  const r = await f(url, { redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r;
}
async function downloadImage(signal) {
  const d = D(); fs.mkdirSync(d.img, { recursive: true });
  const im = cur();
  if (fs.existsSync(path.join(d.img, okOf(im)))) return;
  const local = process.env.AIB_VM_IMAGE_DIR; // tests / offline: a directory with the built files
  for (const f of im.files) {
    const out = path.join(d.img, f.out);
    if (fs.existsSync(out) && !f.disk) continue;
    if (local) {
      const plain = path.join(local, f.local || (f.out === 'disk.img' ? 'rootfs.img' : f.out));
      if (fs.existsSync(plain)) {
        setPhase('preparing', '正在准备 Linux 虚拟机…', { progress: null });
        await fs.promises.copyFile(plain, out + '.part'); fs.renameSync(out + '.part', out); continue;
      }
      if (!fs.existsSync(plain + '.gz')) throw new Error('缺少镜像文件：' + plain);
      await downloadOne('file://' + plain + '.gz', out, f, signal); continue;
    }
    let lastErr;
    for (const m of im.mirrors) {
      try { await downloadOne(m + (f.base || im.base) + f.asset, out, f, signal); lastErr = null; break; }
      catch (e) { lastErr = e; if (signal && signal.aborted) throw new Error('已取消下载'); }
    }
    if (lastErr) throw new Error('下载虚拟机镜像失败：' + (lastErr.message || lastErr));
  }
  fs.writeFileSync(path.join(d.img, okOf(im)), im.version);
}
async function downloadOne(url, out, f, signal) {
  const { Readable } = require('stream'); const { pipeline } = require('stream/promises');
  let total = 0, got = 0, src;
  if (url.startsWith('file://')) { const p = url.slice(7); total = fs.statSync(p).size; src = fs.createReadStream(p); }
  else { const r = await fetchStream(url); total = Number(r.headers.get('content-length')) || 0; src = Readable.fromWeb(r.body); }
  src.on('data', (c) => { got += c.length; setPhase('downloading', `正在下载 Linux 虚拟机镜像（${f.out}）…`, { progress: { file: f.out, got, total } }); });
  if (signal) signal.addEventListener('abort', () => src.destroy(new Error('aborted')));
  const tmp = out + '.part';
  await pipeline(src, ...(f.gunzip ? [zlib.createGunzip()] : []), fs.createWriteStream(tmp));
  fs.renameSync(tmp, out);
}
function growDisk() {
  const p = path.join(D().img, diskOf(cur())); const want = Math.max(4, Number(settings().diskGB) || 16) * 1024 ** 3;
  try { const s = fs.statSync(p); if (s.size < want) fs.truncateSync(p, want); } catch {}
}

// ---------------------------------------------------------------- vfkit helper (signed with the virtualization entitlement)
const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.virtualization</key><true/><key>com.apple.security.network.server</key><true/><key>com.apple.security.network.client</key><true/></dict></plist>`;
function vfkitPath() {
  const bundled = [path.join(appRoot(), 'vm', 'vfkit'), path.join(process.resourcesPath || '', 'vm', 'vfkit')].find(p => p && fs.existsSync(p));
  if (!bundled) throw new Error('应用中缺少虚拟机组件 vfkit');
  const d = D(); fs.mkdirSync(d.bin, { recursive: true });
  const dst = path.join(d.bin, 'vfkit');
  const same = fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(bundled).size;
  if (!same) { fs.copyFileSync(bundled, dst); fs.chmodSync(dst, 0o755); }
  let ok = false;
  try { ok = /com\.apple\.security\.virtualization/.test(execFileSync('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', dst], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()); } catch {}
  if (!ok) {
    const ent = path.join(d.bin, 'vm.entitlements'); fs.writeFileSync(ent, ENTITLEMENTS);
    try { execFileSync('/usr/bin/xattr', ['-c', dst]); } catch {}
    execFileSync('/usr/bin/codesign', ['-f', '-s', '-', '--entitlements', ent, dst], { stdio: 'ignore' });
  }
  return dst;
}
function sockPath() {
  const dir = process.platform === 'darwin' ? os.tmpdir() : '/tmp';
  return path.join(dir, `aib-vm-${process.getuid ? process.getuid() : 0}.sock`);
}
function launchArgs(kind) {
  const d = D(); const cfg = settings(); const img = (f) => path.join(d.img, f);
  const mem = Math.max(512, Math.min(16384, Number(cfg.memoryMB) || 2048)); const cpus = Math.max(1, Math.min(os.cpus().length || 4, Number(cfg.cpus) || 2));
  if (kind === 'vfkit') return { cmd: vfkitPath(), args: [
    '--cpus', String(cpus), '--memory', String(mem),
    '--kernel', img('vmlinux'), '--initrd', img('initramfs.gz'), '--kernel-cmdline', 'console=hvc0 aibroot=/dev/vda rw quiet',
    '--device', `virtio-blk,path=${img(diskOf(cur()))}`,
    '--device', 'virtio-net,nat',
    '--device', 'virtio-rng',
    '--device', `virtio-serial,logFilePath=${d.log}`,
    '--device', `virtio-vsock,port=1024,socketURL=${sockPath()},connect`,
    '--device', `virtio-fs,sharedDir=${d.share},mountTag=share`
  ] };
  if (kind === 'qemu') return { cmd: process.env.AIB_QEMU || 'qemu-system-aarch64', args: [
    '-M', 'virt', '-cpu', process.env.AIB_QEMU_CPU || 'cortex-a72', '-m', String(Math.min(mem, cur().gui ? 3072 : 2048)), '-smp', String(cpus), '-nographic', '-monitor', 'none',
    '-kernel', img('vmlinux'), '-initrd', img('initramfs.gz'), '-append', 'console=ttyAMA0 aibroot=/dev/vda rw quiet',
    '-drive', `file=${img(diskOf(cur()))},if=none,format=raw,id=hd`, '-device', 'virtio-blk-pci,drive=hd',
    '-netdev', 'user,id=n', '-device', 'virtio-net-pci,netdev=n',
    '-device', 'virtio-serial-pci', '-chardev', `socket,path=${sockPath()},server=on,wait=off,id=ag`, '-device', 'virtserialport,chardev=ag,name=aib.agent'
  ] };
  throw new Error('此设备不支持内置 Linux 虚拟机（需要 Apple Silicon Mac）');
}

// ---------------------------------------------------------------- lifecycle
function running() { return st.phase === 'running' && st.client && st.client.connected; }
async function start({ signal } = {}) {
  if (running()) return status();
  if (st.starting) return st.starting;
  st.starting = (async () => {
    try {
      if (!supported()) throw new Error('此设备不支持内置 Linux 虚拟机（需要 Apple Silicon Mac，macOS 12 或更高版本）');
      st.error = null;
      const d = D(); fs.mkdirSync(d.share, { recursive: true });
      setPhase('preparing', '正在准备 Linux 虚拟机…');
      await downloadImage(signal);
      growDisk();
      const { cmd, args } = launchArgs(backend());
      try { fs.unlinkSync(sockPath()); } catch {}
      try { fs.writeFileSync(d.log, ''); } catch {}
      setPhase('booting', 'Linux 虚拟机正在启动…', { progress: null });
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      st.proc = proc; let errTail = '';
      proc.stderr.on('data', (c) => { errTail = (errTail + c).slice(-3000); });
      proc.stdout.on('data', (c) => { if (backend() === 'qemu') try { fs.appendFileSync(d.log, c); } catch {} });
      proc.on('exit', (code, sig) => {
        if (st.proc !== proc) return;
        st.proc = null; if (st.client) st.client.close(); st.client = null;
        const wasStopping = st.phase === 'stopping';
        setPhase('stopped', wasStopping ? '' : `虚拟机已退出（${sig || code}）`, { error: wasStopping ? null : (errTail.trim().split('\n').slice(-3).join(' ') || null), info: null });
      });
      proc.on('error', (e) => { errTail += String(e.message || e); });
      st.image = imageId();
      const client = new AgentClient(sockPath());
      const ready = await client.connect({ timeoutMs: backend() === 'qemu' ? (cur().gui ? 600000 : 240000) : (cur().gui ? 180000 : 90000), isAlive: () => st.proc === proc });
      st.client = client; st.info = ready.info || null; st.startedAt = Date.now();
      // DHCP runs in the background during boot; wait briefly so the first command already has internet.
      setPhase('booting', '正在连接网络…');
      try { await Promise.race([client.request('exec', { cmd: 'for i in $(seq 1 40); do ip route 2>/dev/null | grep -q "^default" && break; sleep 0.25; done', timeout: 15 }), new Promise(r => setTimeout(r, 12000))]); } catch {}
      client.on('close', () => { if (st.client === client && st.phase === 'running') setPhase('stopped', '与虚拟机的连接已断开'); });
      setPhase('running', 'Linux 虚拟机已就绪');
      client.request('exec', { cmd: require('./codex-tools').BOOT_CMD, timeout: 60 }).catch(() => {}); // enabled vm_service services
      return status();
    } catch (e) {
      if (st.proc) { try { st.proc.kill('SIGKILL'); } catch {} st.proc = null; }
      setPhase('error', '', { error: String(e.message || e) });
      throw e;
    } finally { st.starting = null; }
  })();
  return st.starting;
}
async function stop() {
  if (!st.proc) { setPhase('stopped', ''); return status(); }
  setPhase('stopping', '正在关闭 Linux 虚拟机…');
  const proc = st.proc;
  try { if (st.client) await Promise.race([st.client.request('exec', { cmd: 'sync; poweroff', timeout: 10 }), new Promise(r => setTimeout(r, 4000))]); } catch {}
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(); }, 4000); }, 8000);
    proc.once('exit', () => { clearTimeout(t); resolve(); });
  });
  st.proc = null; st.client = null; setPhase('stopped', '');
  return status();
}
async function reset() {
  await stop();
  const d = D(); for (const f of [diskOf(cur()), okOf(cur())]) try { fs.unlinkSync(path.join(d.img, f)); } catch {}
  setPhase('stopped', '虚拟机磁盘已重置，下次启动时会重新准备');
  return status();
}
async function ensure(opts) { if (running() && st.image && st.image !== imageId()) await stop(); if (!running()) await start(opts); return st.client; }
// switch between the command-line image and the graphical image (restarts a running VM)
async function setImage(id) {
  if (!IMAGES[id]) throw new Error('unknown image: ' + id);
  const was = running();
  imageOverride = null; try { require('../store').patchSettings({ vm: { image: id } }); } catch { imageOverride = id; }
  if (imageId() !== id) imageOverride = id;
  if (st.proc && st.image !== id) await stop();
  if (was) await start();
  return status();
}
// remove a downloaded image that is not in use (frees disk space)
async function removeImage(id) {
  const im = IMAGES[id]; if (!im || im === IMAGE) throw new Error('cannot remove this image');
  if (st.proc && st.image === id) await stop();
  const d = D(); for (const f of [diskOf(im), okOf(im), diskOf(im) + '.part']) try { fs.unlinkSync(path.join(d.img, f)); } catch {}
  return status();
}

// ---------------------------------------------------------------- operations used by agent tools / IPC
async function shell(command, { cwd, timeoutSec, signal, onOutput, stdin } = {}) {
  const c = await ensure({ signal });
  const t0 = Date.now(); let out = '', err = '', truncated = false; const CAP = 400000;
  const { id, done } = c.exec(String(command), { cwd: cwd || '/root/work', timeout: Math.max(1, Math.min(86400, Number(timeoutSec) || 600)), stdin }, (ev) => {
    if (ev.stream === 'stderr') { if (err.length < CAP) err += ev.data; else truncated = true; } else { if (out.length < CAP) out += ev.data; else truncated = true; }
    if (onOutput) try { onOutput(ev.stream, ev.data); } catch {}
  });
  const ab = () => { c.request('kill', { target: id }).catch(() => {}); };
  if (signal) { if (signal.aborted) ab(); else signal.addEventListener('abort', ab); }
  try {
    const r = await done;
    return { exitCode: r.code, stdout: out, stderr: err, ms: Date.now() - t0, truncated: truncated || !!r.truncated, timedOut: !!r.timedOut, stopped: !!(signal && signal.aborted) };
  } finally { if (signal) signal.removeEventListener('abort', ab); }
}
async function readFile(p, max) { const c = await ensure(); const r = await c.request('read', { path: String(p), max: Math.min(Number(max) || 8 * 1024 * 1024, 64 * 1024 * 1024) }); if (!r.ok) throw new Error(r.error || '读取失败'); return { size: r.size, truncated: r.truncated, data: Buffer.from(r.b64 || '', 'base64') }; }
async function writeFile(p, data, { append, mode } = {}) { const c = await ensure(); const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data)); const r = await c.request('write', { path: String(p), b64: buf.toString('base64'), append: !!append, mode }); if (!r.ok) throw new Error(r.error || '写入失败'); return { size: r.size }; }
async function python(code, { session, signal, timeoutSec } = {}) {
  const c = await ensure({ signal });
  const sess = String(session || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'default';
  let timer; const intr = () => c.request('pyint', { session: sess }).catch(() => {});
  if (signal) signal.addEventListener('abort', intr);
  if (timeoutSec) timer = setTimeout(intr, timeoutSec * 1000);
  const t0 = Date.now();
  try {
    const r = await c.request('py', { code: String(code), session: sess, workdir: '/root/work/' + sess, figdir: '/root/work/' + sess + '/.figures' });
    if (r.ok === false && r.error && !('stdout' in r)) throw new Error(r.error);
    return { ok: !!r.ok, stdout: r.stdout || '', stderr: r.stderr || '', result: r.result == null ? null : r.result, error: r.error || null, images: (r.imageData || []).map(x => ({ name: path.basename(x.path), path: x.path, dataUrl: 'data:image/png;base64,' + x.b64 })), ms: Date.now() - t0, engine: 'vm', python: (st.info && st.info.python) || '', session: sess };
  } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', intr); }
}
async function ping() { const c = await ensure(); const r = await c.request('ping'); st.info = r.info; return r.info; }
function diskUsage() { const s = status(); return { diskBytes: s.diskBytes, diskGB: s.diskGB, imageReady: s.imageReady }; }
function shutdownSync() { if (st.proc) { try { st.proc.kill('SIGTERM'); } catch {} } }

module.exports = { IMAGE, IMAGES, setImage, removeImage, imageId, events, status, supported, backend, start, stop, reset, ensure, running, shell, readFile, writeFile, python, ping, diskUsage, shutdownSync, dirs: D, launchArgs, sockPath, _setUserData: (p) => { userDataOverride = p; } };
