'use strict';
// Python + Linux VM agent tools (desktop). Python runs in the embedded CPython (per-conversation kernel) or, when the
// Linux VM is running (or the user picked it), inside the VM. VM tools give the AI its own Linux computer.
const fs = require('fs');
const path = require('path');
const os = require('os');
const py = require('../python');
const vm = require('../vm');

const str = (d) => ({ type: 'string', description: d });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const store = () => require('../store');
const cfg = () => { try { return Object.assign({ engine: 'auto', timeoutSec: 600 }, store().getSettings().python || {}); } catch { return { engine: 'auto', timeoutSec: 600 }; } };
const session = (ctx) => String((ctx && (ctx.threadId || ctx.sid)) || 'default');
function engineFor(a) {
  const want = a && ['local', 'vm'].includes(a.engine) ? a.engine : cfg().engine;
  if (want === 'vm') return vm.supported() ? 'vm' : 'local';
  if (want === 'local') return 'local';
  return vm.running() ? 'vm' : 'local';
}
const status = (ctx, text) => { if (ctx && ctx.emit) try { ctx.emit({ type: 'status', text }); } catch {} };
const stream = (ctx, s, data) => { if (ctx && ctx.emit) try { ctx.emit({ type: 'tool-stream', id: ctx.stepId, stream: s, data }); } catch {} };
const clipTail = (s, n) => { s = String(s || ''); return s.length > n ? '…（前面省略 ' + (s.length - n) + ' 个字符）\n' + s.slice(-n) : s; };
async function vmUp(ctx) {
  if (vm.running()) return;
  status(ctx, 'Linux 虚拟机正在启动…');
  const off = (s) => status(ctx, s.progress && s.progress.total ? `${s.detail} ${Math.round(100 * s.progress.got / s.progress.total)}%` : (s.detail || 'Linux 虚拟机正在启动…'));
  vm.events.on('state', off);
  try { await vm.start({ signal: ctx && ctx.signal }); } finally { vm.events.off('state', off); }
}
function safeName(n) { return String(n || 'file').replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 120) || 'file'; }
function uniquePath(dir, name) { let p = path.join(dir, name); const ext = path.extname(name), base = path.basename(name, ext); for (let i = 1; fs.existsSync(p) && i < 1000; i++) p = path.join(dir, `${base} (${i})${ext}`); return p; }
function downloadsDir() { try { return require('electron').app.getPath('downloads'); } catch { return path.join(os.homedir(), 'Downloads'); } }
const IMG_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const TOOLS = [
  { name: 'python_run', group: 'compute', description: 'Run Python 3 code for calculations, data analysis, symbolic math, simulations, or programming. Persistent session per conversation (variables and imports survive between calls). Preinstalled: numpy, scipy, sympy, mpmath, pandas, matplotlib. Print what you need; the value of the last expression is returned as "result". matplotlib figures are captured as PNG images and shown to the user automatically (do not call plt.show or save files for that). Use python_install for other libraries.',
    parameters: obj({ code: str('Python source code'), timeoutSec: { type: 'number', description: 'optional; default from settings (600 s)' }, engine: { type: 'string', enum: ['auto', 'local', 'vm'], description: 'optional: auto (default), local embedded Python, or the Linux VM' } }, ['code']),
    run: async (a, ctx) => {
      const engine = engineFor(a); const timeoutSec = Math.max(5, Math.min(86400, Number(a.timeoutSec) || Number(cfg().timeoutSec) || 600));
      if (engine === 'vm') { await vmUp(ctx); status(ctx, '正在 Linux 虚拟机中运行 Python…'); return vm.python(a.code, { session: session(ctx), signal: ctx && ctx.signal, timeoutSec }); }
      status(ctx, '正在运行 Python…');
      return py.run({ code: a.code, session: session(ctx), timeoutMs: timeoutSec * 1000, signal: ctx && ctx.signal });
    } },
  { name: 'python_install', group: 'compute', description: 'Install Python packages from PyPI (pip) so python_run can import them. Installed packages persist. Give pip names, e.g. ["seaborn", "networkx==3.3"].',
    parameters: obj({ packages: { type: 'array', items: { type: 'string' }, description: 'pip package names (optionally with version specifiers)' }, engine: { type: 'string', enum: ['auto', 'local', 'vm'] } }, ['packages']),
    run: async (a, ctx) => {
      const names = py.cleanNames(a.packages); const engine = engineFor(a);
      if (engine === 'vm') {
        await vmUp(ctx); status(ctx, '正在 Linux 虚拟机中安装 Python 库…');
        const r = await vm.shell('pip install --no-input --progress-bar off ' + names.map(n => `'${n.replace(/'/g, '')}'`).join(' '), { timeoutSec: 1800, signal: ctx && ctx.signal, onOutput: (s, d) => stream(ctx, s, d) });
        await vm.python('import importlib; importlib.invalidate_caches()', { session: session(ctx) }).catch(() => {});
        return { ok: r.exitCode === 0, engine: 'vm', packages: names, output: clipTail(r.stdout + r.stderr, 3000), error: r.exitCode === 0 ? null : '安装失败（退出码 ' + r.exitCode + '），详见输出。' };
      }
      status(ctx, '正在安装 Python 库…');
      const r = await py.install(names, { signal: ctx && ctx.signal, onOutput: (d) => stream(ctx, 'stdout', d) });
      return Object.assign({ engine: 'local' }, r);
    } },
  { name: 'vm_shell', group: 'vm', description: 'Run a shell command (/bin/sh) as root inside your own Linux virtual machine (Alpine Linux arm64 with internet; python3, pip, numpy/scipy/sympy/pandas/matplotlib, git, curl, gcc/make). Use it like your own computer: install software (apk add / pip install), clone repos, build and test code, run long jobs. Working dir /root/work; /mnt/share is shared with the user\'s computer. Output streams to the user; returns stdout, stderr, exitCode. The VM starts automatically on first use.',
    parameters: obj({ command: str('shell command'), cwd: str('working directory (default /root/work)'), timeoutSec: { type: 'number', description: 'default 600, max 86400' }, stdin: str('optional text piped to stdin') }, ['command']),
    run: async (a, ctx) => {
      await vmUp(ctx); status(ctx, '正在 Linux 虚拟机中执行命令…');
      const r = await vm.shell(a.command, { cwd: a.cwd, timeoutSec: a.timeoutSec, stdin: a.stdin, signal: ctx && ctx.signal, onOutput: (s, d) => stream(ctx, s, d) });
      return { exitCode: r.exitCode, stdout: clipTail(r.stdout, 12000), stderr: clipTail(r.stderr, 6000), ms: r.ms, timedOut: r.timedOut, stopped: r.stopped, truncated: r.truncated };
    } },
  { name: 'vm_read_file', group: 'vm', description: 'Read a file from the Linux VM. Text is returned as UTF-8; images are shown to the user; other binary files return base64 (first 64 KB).',
    parameters: obj({ path: str('absolute path in the VM'), maxBytes: { type: 'number' } }, ['path']),
    run: async (a, ctx) => {
      await vmUp(ctx); const r = await vm.readFile(a.path, Math.min(Number(a.maxBytes) || 2e6, 16e6));
      const ext = path.extname(a.path).toLowerCase();
      if (IMG_EXT[ext]) return { path: a.path, size: r.size, images: [{ name: path.basename(a.path), dataUrl: `data:${IMG_EXT[ext]};base64,` + r.data.toString('base64') }] };
      const text = r.data.toString('utf8'); const binary = /\u0000/.test(text.slice(0, 4000)) || (text.match(/\uFFFD/g) || []).length > 20;
      if (binary) return { path: a.path, size: r.size, binary: true, base64: r.data.subarray(0, 65536).toString('base64') };
      return { path: a.path, size: r.size, truncated: r.truncated, text: text.length > 60000 ? text.slice(0, 60000) + '\n…' : text };
    } },
  { name: 'vm_write_file', group: 'vm', description: 'Create or overwrite a file in the Linux VM (parent directories are created).',
    parameters: obj({ path: str('absolute path in the VM'), content: str('file content'), encoding: { type: 'string', enum: ['utf8', 'base64'] }, append: { type: 'boolean' }, mode: str('optional octal mode, e.g. 755') }, ['path', 'content']),
    run: async (a, ctx) => { await vmUp(ctx); const data = a.encoding === 'base64' ? Buffer.from(String(a.content), 'base64') : Buffer.from(String(a.content), 'utf8'); const r = await vm.writeFile(a.path, data, { append: a.append, mode: a.mode }); return { path: a.path, bytes: r.size }; } },
  { name: 'vm_upload', group: 'vm', description: 'Give the VM a file from the user\'s computer. The user picks the file in a dialog (or pass a downloadId from downloads_list). The file is copied to /mnt/share/uploads/ in the VM.',
    parameters: obj({ downloadId: str('optional id from downloads_list'), prompt: str('optional dialog title, e.g. what file you need') }),
    run: async (a, ctx) => {
      let src = null;
      if (a.downloadId) { const d = store().downloads().find(x => x.id === a.downloadId); if (!d || !fs.existsSync(d.path)) throw new Error('找不到该下载项'); src = d.path; }
      else {
        const { dialog, BrowserWindow } = require('electron');
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        const r = await dialog.showOpenDialog(win, { title: a.prompt ? String(a.prompt).slice(0, 80) : '选择要放入 Linux 虚拟机的文件', properties: ['openFile'] });
        if (r.canceled || !r.filePaths.length) return { uploaded: false, note: 'user cancelled' };
        src = r.filePaths[0];
      }
      const dir = path.join(vm.dirs().share, 'uploads'); fs.mkdirSync(dir, { recursive: true });
      const dst = uniquePath(dir, safeName(path.basename(src))); fs.copyFileSync(src, dst);
      return { uploaded: true, vmPath: '/mnt/share/uploads/' + path.basename(dst), bytes: fs.statSync(dst).size };
    } },
  { name: 'vm_download', group: 'vm', description: 'Save a file from the Linux VM to the user\'s Downloads folder (e.g. a result, report, or build artifact).',
    parameters: obj({ path: str('absolute path in the VM'), name: str('optional file name to save as') }, ['path']),
    run: async (a, ctx) => {
      await vmUp(ctx); const r = await vm.readFile(a.path, 64 * 1024 * 1024);
      if (r.truncated) throw new Error('文件超过 64 MB，请先在虚拟机中压缩或拆分，或放到 /mnt/share 后由用户自行取用');
      const dst = uniquePath(downloadsDir(), safeName(a.name || path.posix.basename(a.path))); fs.writeFileSync(dst, r.data);
      return { saved: true, hostPath: dst, bytes: r.data.length };
    } },
  { name: 'vm_status', group: 'vm', description: 'Status of the Linux VM (phase, memory/CPU, disk usage, IP, Python version).',
    parameters: obj({}), run: async () => { const s = vm.status(); return { supported: s.supported, phase: s.phase, error: s.error, memoryMB: s.memoryMB, cpus: s.cpus, diskBytes: s.diskBytes, diskGB: s.diskGB, info: s.info }; } },
  { name: 'vm_control', group: 'vm', description: 'Start, stop, or restart the Linux VM. (Resetting the disk is only possible from Settings.)',
    parameters: obj({ action: { type: 'string', enum: ['start', 'stop', 'restart'] } }, ['action']),
    run: async (a, ctx) => { if (a.action === 'stop' || a.action === 'restart') await vm.stop(); if (a.action !== 'stop') await vmUp(ctx); const s = vm.status(); return { phase: s.phase, info: s.info }; } }
];

module.exports = { TOOLS, engineFor };
