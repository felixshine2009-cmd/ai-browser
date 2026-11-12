// Linux VM host for the iPad app (hidden WKWebView). v86 (BSD-2-Clause) runs the bundled Alpine Linux (i686) from
// aibres://app/vm/. The guest agent speaks JSON lines over the serial port (same protocol as the desktop VM agent).
// The Node.js side (src/main/vm/index.js on iPad) drives it with executeJavaScript and polls job output.
(function () {
  const BASE = new URL('../vm/', location.href).href;
  const utf8bin = (s) => { const b = new TextEncoder().encode(s); let o = ''; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return o; };
  const b64of = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const u8of = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  let emu = null, manifest = null, seq = 0, readyInfo = null, bootErr = null, phase = 'stopped';
  const pending = new Map(); const jobs = new Map();
  const dec = new TextDecoder(); let lineBytes = [];
  let restoreChunks = []; let saveBuf = null;
  function onByte(b) {
    if (b !== 10) { lineBytes.push(b); return; }
    const line = dec.decode(new Uint8Array(lineBytes)).replace(/\r/g, ''); lineBytes = [];
    if (!line.startsWith('{')) return;
    let j; try { j = JSON.parse(line); } catch { return; }
    if (j.ev === 'ready') { readyInfo = j.info || {}; if (bootWait) bootWait(j); return; }
    const p = pending.get(j.id); if (!p) return;
    if (j.ev === 'out') { if (p.onEvent) p.onEvent(j); return; }
    pending.delete(j.id); p.resolve(j);
  }
  let bootWait = null;
  function send(op, params, onEvent) {
    if (!emu) return Promise.reject(new Error('虚拟机未运行'));
    const id = ++seq;
    const p = new Promise((resolve, reject) => pending.set(id, { resolve, reject, onEvent }));
    emu.serial0_send(utf8bin(JSON.stringify(Object.assign({ id, op }, params || {})) + '\n'));
    p.id = id; return p;
  }
  function loadScript(src) { return new Promise((res, rej) => { if (window.V86) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('无法加载虚拟机组件')); document.head.appendChild(s); }); }
  async function start(opts) {
    if (emu && phase === 'running') return { ok: true, info: readyInfo };
    opts = opts || {};
    phase = 'booting'; bootErr = null;
    try {
      manifest = await (await fetch(BASE + 'manifest.json')).json();
      await loadScript(BASE + 'libv86.js');
      const ready = new Promise((res) => { bootWait = res; });
      const mem = Math.max(256, Math.min(2048, Number(opts.memoryMB) || manifest.memoryMB || 512));
      emu = new window.V86({
        wasm_path: BASE + 'v86.wasm', memory_size: mem * 1024 * 1024, vga_memory_size: 2 * 1024 * 1024,
        bios: { url: BASE + 'seabios.bin' }, vga_bios: { url: BASE + 'vgabios.bin' }, bzimage: { url: BASE + 'bzImage' }, initrd: { url: BASE + 'initramfs.gz' },
        cmdline: 'console=ttyS0 aibroot=9p rw quiet loglevel=3 tsc=reliable mitigations=off random.trust_cpu=on',
        filesystem: { basefs: opts.basefs || (BASE + 'fs.json'), baseurl: BASE + 'fs/' }, autostart: true, disable_keyboard: true, disable_mouse: true, disable_speaker: true
      });
      emu.add_listener('serial0-output-byte', onByte);
      const to = new Promise((_, rej) => setTimeout(() => rej(new Error('Linux 虚拟机启动超时')), 300000));
      await Promise.race([ready, to]);
      phase = 'running';
      if (restoreChunks.length) {
        const total = restoreChunks.reduce((n, c) => n + c.length, 0); const all = new Uint8Array(total); let o = 0;
        for (const c of restoreChunks) { all.set(c, o); o += c.length; } restoreChunks = [];
        await emu.create_file('/tmp/persist.tar', all);
        await execWait('tar -C / -xf /tmp/persist.tar && rm -f /tmp/persist.tar', 300);
      }
      await execWait('mkdir -p /mnt/share /root/work', 30);
      return { ok: true, info: readyInfo, python: manifest.python || '' };
    } catch (e) {
      try { emu && emu.destroy(); } catch {} emu = null; phase = 'error'; bootErr = String(e.message || e);
      return { ok: false, error: bootErr };
    }
  }
  function execWait(cmd, timeoutSec) { return send('exec', { cmd, cwd: '/', timeout: timeoutSec || 600 }); }
  // jobs: output is buffered here and drained by the Node.js side
  function job(kind, params) {
    const j = { id: 0, events: [], done: false, result: null };
    const p = send(kind, params, (ev) => { j.events.push({ stream: ev.stream || 'stdout', data: ev.data || '' }); });
    j.id = p.id; jobs.set(j.id, j);
    p.then((r) => { j.done = true; j.result = r; }, (e) => { j.done = true; j.result = { error: String(e.message || e), code: -1 }; });
    return j.id;
  }
  function poll(id) {
    const j = jobs.get(id); if (!j) return { done: true, result: { code: -1, error: 'unknown job' }, events: [] };
    const ev = j.events.splice(0, j.events.length);
    if (j.done) jobs.delete(id);
    return { done: j.done, result: j.result, events: ev };
  }
  async function readFile(p, max) {
    const d = await emu.read_file(p);
    const cut = max && d.length > max ? d.subarray(0, max) : d;
    return { size: d.length, truncated: cut.length < d.length, b64: b64of(cut) };
  }
  async function writeFile(p, b64, append) {
    const dir = p.replace(/\/[^/]*$/, '') || '/';
    await execWait(`mkdir -p '${dir.replace(/'/g, '')}'`, 30);
    let data = u8of(b64);
    if (append) { try { const old = await emu.read_file(p); const all = new Uint8Array(old.length + data.length); all.set(old); all.set(data, old.length); data = all; } catch {} }
    // v86's 9p create_file does not replace an existing file the guest has already looked up: write a new file, then
    // let the guest rename it over the target so the guest and the host always see the same content
    const tmp = dir.replace(/\/$/, '') + '/.aib-w-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await emu.create_file(tmp, data);
    const r = await execWait(`mv -f '${tmp.replace(/'/g, '')}' '${p.replace(/'/g, "'\\''")}'`, 30);
    if (r && r.code) throw new Error('写入失败：' + p);
    return { size: data.length };
  }
  async function save() {
    if (!emu || phase !== 'running') return { ok: false };
    const r = await execWait('tar -C / -cf /tmp/persist.tar persist root 2>/dev/null; true', 300);
    try { saveBuf = await emu.read_file('/tmp/persist.tar'); } catch { saveBuf = null; return { ok: false }; }
    execWait('rm -f /tmp/persist.tar', 30).catch(() => {});
    return { ok: true, size: saveBuf.length, chunks: Math.ceil(saveBuf.length / (4 * 1024 * 1024)) };
  }
  function saveChunk(i) { const n = 4 * 1024 * 1024; return saveBuf ? b64of(saveBuf.subarray(i * n, (i + 1) * n)) : ''; }
  function putRestoreChunk(b64) { restoreChunks.push(u8of(b64)); return restoreChunks.length; }
  function stop() { try { emu && emu.stop(); emu && emu.destroy(); } catch {} emu = null; phase = 'stopped'; for (const p of pending.values()) p.reject(new Error('虚拟机已关闭')); pending.clear(); return true; }
  window.vmhost = {
    start, stop, poll, readFile, writeFile, save, saveChunk, putRestoreChunk,
    exec: (cmd, cwd, timeoutSec, stdin) => job('exec', { cmd, cwd: cwd || '/root/work', timeout: timeoutSec || 600, stdin }),
    py: (code, session) => job('py', { code, session, workdir: '/root/work/' + session, figdir: '/tmp/aibfig-' + session, inlineImages: false }),
    kill: (id) => { send('kill', { target: id }).catch(() => {}); return true; },
    pyint: (session) => { send('pyint', { session }).catch(() => {}); return true; },
    ping: async () => (await send('ping', {})),
    state: () => ({ phase, info: readyInfo, error: bootErr })
  };
})();
