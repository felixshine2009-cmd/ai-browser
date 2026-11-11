#!/usr/bin/env node
// Boots the bundled iPad Linux VM image (v86) in Node and runs a Python smoke test through the guest agent.
// usage: node scripts/v86-smoke.cjs <vm-dir>   (vm-dir contains libv86.js, v86.wasm, BIOS files, bzImage, initramfs.gz, fs.json, fs/)
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const DIR = path.resolve(process.argv[2] || 'vm') + '/';
const tmp = path.join(os.tmpdir(), 'libv86-smoke.cjs'); fs.copyFileSync(DIR + 'libv86.js', tmp);
const M = require(tmp); const V86 = M.V86 || globalThis.V86;
const t0 = Date.now(); const ts = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const emu = new V86({ wasm_path: DIR + 'v86.wasm', memory_size: 512 << 20, vga_memory_size: 2 << 20,
  bios: { url: DIR + 'seabios.bin' }, vga_bios: { url: DIR + 'vgabios.bin' }, bzimage: { url: DIR + 'bzImage' }, initrd: { url: DIR + 'initramfs.gz' },
  cmdline: 'console=ttyS0 aibroot=9p rw quiet loglevel=3 tsc=reliable mitigations=off random.trust_cpu=on',
  filesystem: { basefs: DIR + 'fs.json', baseurl: DIR + 'fs/' }, autostart: true, disable_keyboard: true, disable_mouse: true, disable_speaker: true });
const dec = new TextDecoder(); let bytes = []; const waits = new Map(); let ready;
const readyP = new Promise(r => { ready = r; });
emu.add_listener('serial0-output-byte', (b) => {
  if (b !== 10) { bytes.push(b); return; }
  const l = dec.decode(new Uint8Array(bytes)).replace(/\r/g, ''); bytes = [];
  if (!l.startsWith('{')) { if (l.trim()) console.log(`[${ts()}] ${l.slice(0, 160)}`); return; }
  let j; try { j = JSON.parse(l); } catch { return; }
  if (j.ev === 'ready') return ready(j);
  if (j.ev === 'out') { process.stdout.write(j.data); return; }
  const w = waits.get(j.id); if (w) { waits.delete(j.id); w(j); }
});
// serial0_send takes one byte per char: send UTF-8 bytes so non-ASCII text (e.g. Chinese) survives.
const utf8bin = (s) => { const b = new TextEncoder().encode(s); let o = ''; for (let i = 0; i < b.length; i += 0x8000) o += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return o; };
let seq = 0;
const req = (op, p) => new Promise(r => { const id = ++seq; waits.set(id, r); emu.serial0_send(utf8bin(JSON.stringify(Object.assign({ id, op }, p)) + '\n')); });
const fail = (m) => { console.error('SMOKE FAIL: ' + m); process.exit(1); };
setTimeout(() => fail('timeout'), 30 * 60e3);
(async () => {
  const r = await readyP; console.log(`[${ts()}] agent ready`, JSON.stringify(r.info || {}));
  const e = await req('exec', { cmd: 'uname -m; python3 --version; echo 你好', timeout: 120 });
  if (e.code !== 0) fail('exec exit ' + e.code);
  const p1 = await req('py', { session: 's', code: 'import numpy as np, sympy as sp\na = np.random.rand(40, 40)\nerr = float(abs(a @ np.linalg.inv(a) - np.eye(40)).max())\nx = sp.symbols("x")\nprint(sp.integrate(x**2, (x, 0, 3)), err < 1e-8)', workdir: '/root/work/s', figdir: '/tmp/aibfig-s', inlineImages: false });
  console.log(`[${ts()}] py1`, JSON.stringify(p1).slice(0, 300));
  if (!p1.ok || !/^9 True/.test(p1.stdout)) fail('numpy/sympy');
  const p2 = await req('py', { session: 's', code: 'import matplotlib.pyplot as plt\nplt.plot(a[0])\nerr < 1', workdir: '/root/work/s', figdir: '/tmp/aibfig-s', inlineImages: false });
  console.log(`[${ts()}] py2`, JSON.stringify(p2).slice(0, 300));
  if (!p2.ok || p2.result !== 'True' || !(p2.images || []).length) fail('matplotlib / session');
  const png = await emu.read_file(p2.images[0]);
  if (!(png[0] === 0x89 && png[1] === 0x50)) fail('png');
  await emu.create_file('/root/work/hello.txt', new TextEncoder().encode('中文 ok'));
  const c = await req('exec', { cmd: 'cat /root/work/hello.txt', timeout: 60 });
  if (c.code !== 0) fail('9p write');
  console.log(`\nSMOKE OK in ${ts()} (png ${png.length} bytes)`);
  emu.stop(); process.exit(0);
})().catch(e => fail(e.stack || e));
