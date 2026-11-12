// iPad: embedded Linux VM. v86 (BSD-2-Clause, x86 → WebAssembly) boots a bundled Alpine Linux (i686) whose root file
// system is served lazily from ./vm/fs (9p). Python 3.12 with numpy / scipy / sympy / pandas / matplotlib is preinstalled.
// The guest agent speaks JSON lines over the serial port; files move through the 9p file system.
// /persist (extra Python packages, matplotlib cache) and /root are saved to IndexedDB and restored on the next boot.
const BASE = new URL('../vm/', import.meta.url).href;
// serial0_send takes one byte per char: send UTF-8 bytes so non-ASCII text (e.g. Chinese) survives.
const utf8bin = (s) => { const b = new TextEncoder().encode(s); let o = ''; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return o; };
let manifest = null, emu = null, booting = null, seq = 0;
const pending = new Map(); const listeners = new Set();
let state = { phase: 'stopped', detail: '', error: null, info: null };
const dec = new TextDecoder(); let lineBytes = [];
export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setState(s) { state = Object.assign({}, state, s); listeners.forEach(f => { try { f(state); } catch {} }); }
export function status() { return Object.assign({ available: !!manifest }, state); }
export async function available() {
  if (manifest !== null) return !!manifest;
  try { const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' }); manifest = r.ok ? await r.json() : false; } catch { manifest = false; }
  return !!manifest;
}
export function running() { return state.phase === 'running' && !!emu; }
function loadScript(src) { return new Promise((res, rej) => { if (window.V86) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('无法加载虚拟机组件')); document.head.appendChild(s); }); }
// ---- IndexedDB persistence of /persist + /root
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('aib-vm', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function kvGet(k) { const db = await idb(); return new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); }
async function kvSet(k, v) { const db = await idb(); return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); v == null ? tx.objectStore('kv').delete(k) : tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); }

function onByte(b) {
  if (b !== 10) { lineBytes.push(b); return; }
  const line = dec.decode(new Uint8Array(lineBytes)).replace(/\r/g, ''); lineBytes = [];
  if (!line.startsWith('{')) { if (state.phase === 'booting' && line.trim()) setState({ detail: 'Linux 虚拟机正在启动…' }); return; }
  let j; try { j = JSON.parse(line); } catch { return; }
  if (j.ev === 'ready') { if (booting && booting._ready) booting._ready(j); return; }
  const p = pending.get(j.id); if (!p) return;
  if (j.ev === 'out') { if (p.onEvent) try { p.onEvent(j); } catch {} return; }
  pending.delete(j.id); p.resolve(j);
}
function send(op, params, onEvent) {
  if (!emu) return Promise.reject(new Error('虚拟机未运行'));
  const id = ++seq;
  const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject, onEvent }));
  emu.serial0_send(utf8bin(JSON.stringify(Object.assign({ id, op }, params || {})) + '\n'));
  p.id = id; return p;
}
export async function start() {
  if (running()) return status();
  if (booting) return booting;
  if (!(await available())) throw new Error('当前版本不包含 Linux 虚拟机');
  booting = (async () => {
    try {
      setState({ phase: 'booting', detail: 'Linux 虚拟机正在启动…', error: null });
      await loadScript(BASE + 'libv86.js');
      const ready = new Promise((res) => { booting._ready = res; });
      const mem = Math.max(256, Math.min(1024, Number(localStorage.getItem('aib.vm.memoryMB')) || manifest.memoryMB || 512));
      emu = new window.V86({
        wasm_path: BASE + 'v86.wasm', memory_size: mem * 1024 * 1024, vga_memory_size: 2 * 1024 * 1024,
        bios: { url: BASE + 'seabios.bin' }, vga_bios: { url: BASE + 'vgabios.bin' }, bzimage: { url: BASE + 'bzImage' }, initrd: { url: BASE + 'initramfs.gz' },
        cmdline: 'console=ttyS0 aibroot=9p rw quiet loglevel=3 tsc=reliable mitigations=off random.trust_cpu=on',
        filesystem: { basefs: BASE + 'fs.json', baseurl: BASE + 'fs/' }, autostart: true, disable_keyboard: true, disable_mouse: true, disable_speaker: true
      });
      emu.add_listener('serial0-output-byte', onByte);
      const to = new Promise((_, rej) => setTimeout(() => rej(new Error('Linux 虚拟机启动超时')), 240000));
      const r = await Promise.race([ready, to]);
      setState({ phase: 'running', detail: 'Linux 虚拟机已就绪', info: r.info || null });
      const saved = await kvGet('persist');
      if (saved) { setState({ detail: '正在恢复已安装的库…' }); await emu.create_file('/tmp/persist.tar', new Uint8Array(saved)); await exec('tar -C / -xf /tmp/persist.tar && rm -f /tmp/persist.tar', { timeoutSec: 300 }); setState({ detail: 'Linux 虚拟机已就绪' }); }
      return status();
    } catch (e) {
      try { emu && emu.destroy(); } catch {} emu = null;
      setState({ phase: 'error', error: String(e.message || e) }); throw e;
    } finally { booting = null; }
  })();
  return booting;
}
export async function save() {
  if (!running()) return false;
  const r = await exec('tar -C / -cf /tmp/persist.tar persist root 2>/dev/null; ls -l /tmp/persist.tar', { timeoutSec: 300 });
  if (r.exitCode !== 0) return false;
  const data = await emu.read_file('/tmp/persist.tar');
  await kvSet('persist', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  exec('rm -f /tmp/persist.tar').catch(() => {});
  return true;
}
export async function stop() { if (!emu) return status(); try { await save(); } catch {} try { emu.stop(); emu.destroy(); } catch {} emu = null; for (const p of pending.values()) p.reject(new Error('虚拟机已关闭')); pending.clear(); setState({ phase: 'stopped', detail: '', info: null }); return status(); }
export async function reset() { await stop(); await kvSet('persist', null); setState({ detail: '已清除虚拟机中保存的文件与库' }); return status(); }
export async function savedBytes() { const v = await kvGet('persist'); return v ? v.byteLength : 0; }
export async function exec(cmd, { cwd, timeoutSec = 600, signal, onOutput, stdin } = {}) {
  if (!running()) await start();
  let out = '', err = ''; const t0 = Date.now();
  const p = send('exec', { cmd, cwd: cwd || '/root/work', timeout: timeoutSec, stdin }, (ev) => { if (ev.stream === 'stderr') err += ev.data; else out += ev.data; if (onOutput) onOutput(ev.stream, ev.data); });
  const ab = () => send('kill', { target: p.id }).catch(() => {});
  if (signal) signal.addEventListener('abort', ab, { once: true });
  const r = await p;
  return { exitCode: r.code, stdout: out, stderr: err, ms: Date.now() - t0, timedOut: !!r.timedOut, stopped: !!(signal && signal.aborted), truncated: !!r.truncated };
}
export async function python(code, { session = 'default', signal, timeoutSec = 600 } = {}) {
  if (!running()) await start();
  const sess = String(session).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'default';
  const intr = () => send('pyint', { session: sess }).catch(() => {});
  if (signal) signal.addEventListener('abort', intr, { once: true });
  const timer = setTimeout(intr, timeoutSec * 1000);
  const t0 = Date.now();
  try {
    const r = await send('py', { code, session: sess, workdir: '/root/work/' + sess, figdir: '/tmp/aibfig-' + sess, inlineImages: false });
    const images = [];
    for (const pth of r.images || []) { try { const d = await emu.read_file(pth); let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000)); images.push({ name: pth.split('/').pop(), dataUrl: 'data:image/png;base64,' + btoa(s) }); } catch {} }
    return { ok: !!r.ok, stdout: r.stdout || '', stderr: r.stderr || '', result: r.result == null ? null : r.result, error: r.error || null, images, ms: Date.now() - t0, engine: 'vm', python: (state.info && state.info.python) || '' };
  } finally { clearTimeout(timer); }
}
export async function readFile(path) { if (!running()) await start(); return emu.read_file(path); }
export async function writeFile(path, bytes) { if (!running()) await start(); const dir = path.replace(/\/[^/]*$/, '') || '/'; await exec(`mkdir -p '${dir.replace(/'/g, '')}'`); const tmp = dir.replace(/\/$/, '') + '/.aib-w-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); await emu.create_file(tmp, bytes); const r = await exec(`mv -f '${tmp}' '${path.replace(/'/g, "'\\''")}'`); if (r.exitCode) throw new Error('写入失败：' + path); return { size: bytes.length }; } // v86 create_file does not replace a file the guest already knows: rename inside the guest

// python_install on iPad: the VM has no network, so pure-Python wheels are fetched from PyPI by the app and installed
// into /persist/site (on sys.path). Packages with native code are reported so the caller can fall back to Pyodide.
export async function pipInstall(names, { onOutput, signal } = {}) {
  if (!running()) await start();
  const done = [], skipped = []; const seen = new Set();
  const have = async (n) => (await exec(`python3 -c "import importlib.metadata as m; m.version('${n.replace(/[^A-Za-z0-9._-]/g, '')}')"`, { timeoutSec: 60 })).exitCode === 0;
  async function one(spec, depth) {
    const name = String(spec).split(/[<>=!~;\[ ]/)[0].trim(); const key = name.toLowerCase().replace(/[-_.]+/g, '-');
    if (!name || seen.has(key)) return; seen.add(key);
    if (depth > 0 && await have(name)) return;
    if (signal && signal.aborted) throw new Error('已由用户停止');
    const meta = await (await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`)).json().catch(() => null);
    if (!meta || !meta.urls) throw new Error('PyPI 上找不到：' + name);
    const whl = meta.urls.find(u => u.packagetype === 'bdist_wheel' && /-(py3|py2\.py3)-none-any\.whl$/.test(u.filename));
    if (!whl) { skipped.push(name); return; }
    onOutput && onOutput('stdout', `下载 ${whl.filename}\n`);
    const buf = new Uint8Array(await (await fetch(whl.url)).arrayBuffer());
    await emu.create_file('/tmp/' + whl.filename, buf);
    const r = await exec(`pip install --no-deps --no-index --target /persist/site --upgrade /tmp/${whl.filename} && rm -f /tmp/${whl.filename}`, { timeoutSec: 600, onOutput });
    if (r.exitCode !== 0) throw new Error('安装失败：' + name);
    done.push(name);
    for (const req of meta.info.requires_dist || []) { if (/extra\s*==/.test(req)) continue; if (/;/.test(req) && /python_version\s*<\s*"3\.[0-9]"|sys_platform\s*==\s*"(win32|darwin)"/.test(req)) continue; await one(req, depth + 1); }
  }
  for (const n of names) await one(n, 0);
  await save().catch(() => {});
  return { installed: done, needsNative: skipped };
}
