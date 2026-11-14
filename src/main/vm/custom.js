'use strict';
// User system images (F6): import ISO / raw IMG / QCOW2 images and boot them.
//   iPad: v86 (x86 emulator compiled to WebAssembly, BSD-2-Clause) in a visible page. v86 reads raw images only, so
//         QCOW2 is converted to a raw image on import (v2/v3, zlib-compressed clusters; no backing files or encryption).
//         Disks are read through HTTP Range requests (aibres://data/vm-images/custom/...), never loaded whole.
//   Desktop: QEMU (GPL-2.0, not bundled; uses qemu-system-x86_64 / qemu-system-i386 from the system or AIB_QEMU_X86),
//         which reads every format directly and shows its own window.
// The images live in userData/vm-images/custom: <id>.<iso|img> plus index.json.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

let electronApp = null; try { electronApp = require('electron').app; } catch {}
let userDataOverride = null;
const userData = () => userDataOverride || process.env.AIB_USER_DATA || process.env.AIB_USERDATA || (electronApp ? electronApp.getPath('userData') : require('os').tmpdir());
const dir = () => { const d = path.join(userData(), 'vm-images', 'custom'); fs.mkdirSync(d, { recursive: true }); return d; };
const indexFile = () => path.join(dir(), 'index.json');
function list() { try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')).filter(e => fs.existsSync(path.join(dir(), e.file))); } catch { return []; } }
function saveIndex(l) { fs.writeFileSync(indexFile(), JSON.stringify(l, null, 1)); }
const isIpad = () => !!global.__aibIpad;

function readAt(fd, pos, len) { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.subarray(0, n); }
/** 'qcow2' | 'iso' | 'raw' (+ details) */
function detect(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = readAt(fd, 0, 512);
    if (head.length >= 4 && head.readUInt32BE(0) === 0x514649fb) return { format: 'qcow2', version: head.readUInt32BE(4) };
    if (head.length >= 4 && head.toString('latin1', 0, 4) === 'KDMV') return { format: 'vmdk' };
    if (head.length >= 8 && head.toString('latin1', 0, 8) === 'conectix') return { format: 'vhd' };
    const iso = readAt(fd, 0x8001, 5).toString('latin1');
    if (iso === 'CD001') return { format: 'iso' };
    return { format: 'raw', mbr: head.length === 512 && head[510] === 0x55 && head[511] === 0xaa };
  } finally { fs.closeSync(fd); }
}

/** QCOW2 -> raw. Unallocated clusters stay sparse (holes) where the filesystem supports it. */
async function qcow2ToRaw(src, dest, onProgress) {
  const fd = fs.openSync(src, 'r');
  let out = null;
  try {
    const h = readAt(fd, 0, 112);
    const version = h.readUInt32BE(4);
    if (version !== 2 && version !== 3) throw new Error('不支持的 QCOW2 版本：' + version);
    const backingLen = h.readUInt32BE(16);
    if (backingLen) throw new Error('此 QCOW2 镜像依赖其他基础镜像（backing file），请先合并为独立镜像');
    const clusterBits = h.readUInt32BE(20);
    const size = Number(h.readBigUInt64BE(24));
    const crypt = h.readUInt32BE(32);
    if (crypt) throw new Error('不支持加密的 QCOW2 镜像');
    const l1Size = h.readUInt32BE(36);
    const l1Off = Number(h.readBigUInt64BE(40));
    let compressionType = 0;
    if (version === 3) {
      const hdrLen = h.readUInt32BE(100);
      const incompat = Number(h.readBigUInt64BE(72));
      if (incompat & ~0x9) throw new Error('此 QCOW2 镜像使用了不支持的特性');
      if (hdrLen > 104) compressionType = readAt(fd, 104, 1)[0] || 0;
      if (incompat & 0x8 && compressionType !== 0) throw new Error('不支持 zstd 压缩的 QCOW2 镜像');
      if (incompat & 0x1) { /* dirty bit: data is still consistent for reading */ }
    }
    const cs = 1 << clusterBits;
    const l2Entries = cs / 8;
    const l1 = readAt(fd, l1Off, l1Size * 8);
    out = fs.openSync(dest, 'w');
    fs.ftruncateSync(out, size);
    const OFF_MASK = 0x00fffffffffffe00n;
    const total = Math.ceil(size / cs); let done = 0; let lastTick = 0;
    for (let i = 0; i < l1Size; i++) {
      const l2Off = Number(l1.readBigUInt64BE(i * 8) & 0x00fffffffffffe00n);
      if (!l2Off) { done += l2Entries; continue; }
      const l2 = readAt(fd, l2Off, cs);
      for (let j = 0; j < l2Entries; j++) {
        const guest = (i * l2Entries + j) * cs;
        if (guest >= size) break;
        done++;
        const e = l2.readBigUInt64BE(j * 8);
        if (e === 0n) continue;
        const len = Math.min(cs, size - guest);
        if (e & (1n << 62n)) { // compressed cluster
          const xBits = 62 - (clusterBits - 8);
          const off = Number(e & ((1n << BigInt(xBits)) - 1n));
          const sectors = Number((e >> BigInt(xBits)) & ((1n << BigInt(62 - xBits)) - 1n)) + 1;
          const comp = readAt(fd, off, sectors * 512 - (off % 512));
          let data;
          try { data = zlib.inflateRawSync(comp, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch (err) { throw new Error('QCOW2 压缩数据损坏：' + err.message); }
          fs.writeSync(out, data, 0, Math.min(len, data.length), guest);
        } else {
          if (version === 3 && (e & 1n)) continue; // "all zeroes" flag
          const off = Number(e & OFF_MASK);
          if (!off) continue;
          const data = readAt(fd, off, len);
          if (data.some(b => b !== 0)) fs.writeSync(out, data, 0, data.length, guest);
        }
        if (onProgress && done - lastTick > 256) { lastTick = done; onProgress(done / total); await new Promise(r => setImmediate(r)); }
      }
    }
    if (onProgress) onProgress(1);
  } finally { fs.closeSync(fd); if (out != null) fs.closeSync(out); }
}

async function copyFile(src, dest, onProgress) {
  const size = fs.statSync(src).size; let n = 0;
  await new Promise((res, rej) => {
    const r = fs.createReadStream(src, { highWaterMark: 4 * 1024 * 1024 }); const w = fs.createWriteStream(dest);
    r.on('data', (c) => { n += c.length; onProgress && onProgress(n / size); });
    r.on('error', rej); w.on('error', rej); w.on('finish', res); r.pipe(w);
  });
}

/** import a picked file -> index entry */
async function importImage(file, { name, onProgress, move } = {}) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('请选择镜像文件');
  if (st.size < 512) throw new Error('文件过小，不是有效的系统镜像');
  const d = detect(file);
  if (d.format === 'vmdk' || d.format === 'vhd') throw new Error(`暂不支持 ${d.format.toUpperCase()} 格式，请转换为 QCOW2、IMG 或 ISO 后再导入`);
  const id = 'c' + crypto.randomBytes(5).toString('hex');
  const kind = d.format === 'iso' ? 'cdrom' : 'disk';
  const outFile = id + (d.format === 'iso' ? '.iso' : '.img');
  const dest = path.join(dir(), outFile);
  const free = (() => { try { const s = fs.statfsSync ? fs.statfsSync(dir()) : null; return s ? s.bavail * s.bsize : Infinity; } catch { return Infinity; } })();
  const need = d.format === 'qcow2' ? (() => { const fd = fs.openSync(file, 'r'); try { return Number(readAt(fd, 24, 8).readBigUInt64BE(0)); } finally { fs.closeSync(fd); } })() : st.size;
  if (need > free) throw new Error(`存储空间不足：需要约 ${(need / 1073741824).toFixed(1)} GB`);
  try {
    if (d.format === 'qcow2') await qcow2ToRaw(file, dest, onProgress);
    else if (move) { try { fs.renameSync(file, dest); } catch { await copyFile(file, dest, onProgress); } }
    else await copyFile(file, dest, onProgress);
  } catch (e) { try { fs.unlinkSync(dest); } catch {} throw e; }
  const entry = { id, name: String(name || path.basename(file)).slice(0, 120), file: outFile, kind, source: d.format, bytes: fs.statSync(dest).size, importedAt: Date.now(), memoryMB: 256 };
  const l = list(); l.unshift(entry); saveIndex(l);
  return entry;
}
function remove(id) { const l = list(); const e = l.find(x => x.id === id); if (!e) return false; try { fs.unlinkSync(path.join(dir(), e.file)); } catch {} saveIndex(l.filter(x => x.id !== id)); return true; }
function update(id, patch) { const l = list(); const e = l.find(x => x.id === id); if (!e) throw new Error('镜像不存在'); if (patch.name) e.name = String(patch.name).slice(0, 120); if (patch.memoryMB) e.memoryMB = Math.max(32, Math.min(isIpad() ? 1024 : 8192, Number(patch.memoryMB) || 256)); saveIndex(l); return e; }
function get(id) { return list().find(x => x.id === id) || null; }

function findQemu() {
  if (isIpad()) return null;
  const cands = [process.env.AIB_QEMU_X86, 'qemu-system-x86_64', 'qemu-system-i386'].filter(Boolean);
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']);
  for (const c of cands) {
    if (path.isAbsolute(c)) { if (fs.existsSync(c)) return c; continue; }
    for (const d of dirs) { const p = path.join(d, c + (process.platform === 'win32' ? '.exe' : '')); if (fs.existsSync(p)) return p; }
  }
  return null;
}
/** which engines can boot a user image here */
function engines() {
  const qemu = findQemu();
  return { qemu: !!qemu, qemuPath: qemu || null, v86: isIpad(), platform: isIpad() ? 'ipad' : process.platform };
}
/** v86 boot description for the page (iPad) */
function v86Config(id) {
  const e = get(id); if (!e) throw new Error('镜像不存在');
  const url = 'aibres://data/vm-images/custom/' + encodeURIComponent(e.file);
  const media = e.kind === 'cdrom' ? { cdrom: { url, async: true, size: e.bytes } } : { hda: { url, async: true, size: e.bytes } };
  return Object.assign({ id: e.id, name: e.name, memoryMB: e.memoryMB || 256, boot: e.kind === 'cdrom' ? 'cdrom' : 'hda', base: 'aibres://app/vm/' }, media);
}
const running = new Map();
/** desktop: start QEMU with its own window */
function launchQemu(id) {
  const e = get(id); if (!e) throw new Error('镜像不存在');
  const qemu = findQemu(); if (!qemu) throw new Error('未找到 QEMU。请先安装 QEMU（例如在 macOS 上执行 brew install qemu），再重试。');
  if (running.has(id)) return { ok: true, already: true };
  const f = path.join(dir(), e.file);
  const args = ['-m', String(Math.max(128, e.memoryMB || 512)), '-name', e.name, '-netdev', 'user,id=n0', '-device', 'e1000,netdev=n0'];
  if (e.kind === 'cdrom') args.push('-cdrom', f, '-boot', 'd'); else args.push('-drive', `file=${f},format=raw,if=ide`);
  if (process.platform === 'darwin') args.push('-accel', 'hvf', '-accel', 'tcg');
  const p = require('child_process').spawn(qemu, args, { stdio: 'ignore', detached: false });
  running.set(id, p); p.on('exit', () => running.delete(id));
  return { ok: true, pid: p.pid };
}
module.exports = { dir, list, get, detect, qcow2ToRaw, importImage, remove, update, engines, v86Config, launchQemu, findQemu, _setUserData: (p) => { userDataOverride = p; } };
