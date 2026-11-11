// python_run / python_install (+ Linux VM tools on iPad) for the web / iPad agent loop.
import * as PY from './python.js';
import * as VM from './linux-vm.js';

const obj = (properties, required = []) => ({ type: 'object', properties, required });
const str = (d) => ({ type: 'string', description: d });
const clipTail = (s, n) => { s = String(s || ''); return s.length > n ? '…\n' + s.slice(-n) : s; };
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?(\s*(==|>=|<=|~=|!=|<|>)\s*[A-Za-z0-9.*+!_-]+)?$/;
export function pyEngine() { return localStorage.getItem('aib.py.engine') || 'auto'; }
async function useVm(a) {
  const want = (a && a.engine) || pyEngine();
  if (want === 'pyodide' || want === 'local') return false;
  if (!(await VM.available())) return false;
  return true; // iPad: the bundled Linux VM is the default Python engine
}
const DEFS = [
  { name: 'python_run', description: 'Run Python 3 code for calculations, data analysis, symbolic math, simulations, or programming. Variables persist within the session. Preinstalled/auto-loaded: numpy, scipy, sympy, mpmath, pandas, matplotlib. Print what you need; the last expression value is returned as "result". matplotlib figures are captured and shown to the user automatically. Use python_install for other libraries.',
    parameters: obj({ code: str('Python source code'), timeoutSec: { type: 'number' }, engine: { type: 'string', enum: ['auto', 'pyodide'], description: 'optional; auto by default' } }, ['code']) },
  { name: 'python_install', description: 'Install Python packages from PyPI so python_run can import them. Installed packages persist on this device.',
    parameters: obj({ packages: { type: 'array', items: { type: 'string' } } }, ['packages']) }
];
const VM_DEFS = [
  { name: 'vm_shell', description: 'Run a shell command (/bin/sh, root) inside your own Linux virtual machine on this device (Alpine Linux i686, python3 with numpy/scipy/sympy/pandas/matplotlib; no internet inside the VM). Working dir /root/work. Returns stdout, stderr, exitCode.',
    parameters: obj({ command: str('shell command'), cwd: str('working directory'), timeoutSec: { type: 'number' }, stdin: str('optional stdin text') }, ['command']) },
  { name: 'vm_read_file', description: 'Read a text file from the Linux VM.', parameters: obj({ path: str('absolute path') }, ['path']) },
  { name: 'vm_write_file', description: 'Create or overwrite a file in the Linux VM.', parameters: obj({ path: str('absolute path'), content: str('file content') }, ['path', 'content']) },
  { name: 'vm_upload', description: 'Ask the user to pick a file on this device and copy it into the VM at /root/uploads/.', parameters: obj({ prompt: str('what file you need') }) },
  { name: 'vm_download', description: 'Give the user a file from the VM (it is offered as a download / share).', parameters: obj({ path: str('absolute path in the VM'), name: str('optional file name') }, ['path']) },
  { name: 'vm_status', description: 'Status of the Linux VM.', parameters: obj({}) }
];
export async function defs() { return (await VM.available()) ? DEFS.concat(VM_DEFS) : DEFS; }
export const isCompute = (n) => /^(python_|vm_)/.test(n);

function pickFile(prompt) {
  return new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.onchange = () => res(i.files[0] || null); i.oncancel = () => res(null); i.click(); });
}
export async function call(name, a, ctx) {
  a = a || {}; ctx = ctx || {};
  const status = (t) => ctx.status && ctx.status(t);
  const stream = (s, d) => ctx.stream && ctx.stream(s, d);
  if (name === 'python_run') {
    const timeoutSec = Math.max(5, Math.min(86400, Number(a.timeoutSec) || Number(localStorage.getItem('aib.py.timeoutSec')) || 600));
    if (await useVm(a)) {
      if (!VM.running()) status('Linux 虚拟机正在启动…');
      try { await VM.start(); status('正在 Linux 虚拟机中运行 Python…'); return await VM.python(a.code, { session: ctx.session, signal: ctx.signal, timeoutSec }); }
      catch (e) { if (ctx.signal && ctx.signal.aborted) throw e; status('虚拟机不可用，改用 Pyodide…'); }
    }
    status(PY.status().phase === 'ready' ? '正在运行 Python…' : '正在加载 Python 运行环境（首次需下载，之后可离线使用）…');
    return PY.run(a.code, { signal: ctx.signal, timeoutSec });
  }
  if (name === 'python_install') {
    const names = [].concat(a.packages || []).map(x => String(x).trim()).filter(Boolean).slice(0, 20);
    if (!names.length) throw new Error('请提供至少一个包名');
    for (const n of names) if (!NAME_RE.test(n)) throw new Error('包名格式不正确：' + n);
    if (await useVm(a)) {
      status('正在 Linux 虚拟机中安装 Python 库…');
      const r = await VM.pipInstall(names, { onOutput: stream, signal: ctx.signal });
      if (!r.needsNative.length) return { ok: true, engine: 'vm', packages: r.installed };
      status('部分库需要编译，改用 Pyodide 安装…');
      try { await PY.install(r.needsNative, { signal: ctx.signal }); return { ok: true, engine: 'vm+pyodide', packages: r.installed.concat(r.needsNative), note: `These need native code and were installed into the Pyodide engine instead: ${r.needsNative.join(', ')}. Call python_run with engine "pyodide" to use them.` }; }
      catch (e) { return { ok: false, engine: 'vm', packages: r.installed, error: `以下库没有适用于虚拟机的纯 Python 安装包，且 Pyodide 中也无法安装：${r.needsNative.join(', ')}（${e.message || e}）` }; }
    }
    status('正在安装 Python 库…');
    try { await PY.install(names, { signal: ctx.signal }); return { ok: true, engine: 'pyodide', packages: names }; }
    catch (e) { return { ok: false, engine: 'pyodide', packages: names, error: String(e.message || e).split('\n').slice(-2).join(' ') }; }
  }
  // ---- Linux VM (iPad)
  if (!(await VM.available())) throw new Error('当前版本不包含 Linux 虚拟机');
  if (!VM.running()) { status('Linux 虚拟机正在启动…'); await VM.start(); }
  if (name === 'vm_shell') {
    status('正在 Linux 虚拟机中执行命令…');
    const r = await VM.exec(a.command, { cwd: a.cwd, timeoutSec: Math.max(1, Math.min(86400, Number(a.timeoutSec) || 600)), signal: ctx.signal, onOutput: stream, stdin: a.stdin });
    VM.save().catch(() => {});
    return { exitCode: r.exitCode, stdout: clipTail(r.stdout, 12000), stderr: clipTail(r.stderr, 6000), ms: r.ms, timedOut: r.timedOut, stopped: r.stopped };
  }
  if (name === 'vm_read_file') { const d = await VM.readFile(a.path); const text = new TextDecoder().decode(d.subarray(0, 2e6)); return { path: a.path, size: d.length, text: text.length > 60000 ? text.slice(0, 60000) + '\n…' : text }; }
  if (name === 'vm_write_file') { const r = await VM.writeFile(a.path, new TextEncoder().encode(String(a.content || ''))); VM.save().catch(() => {}); return { path: a.path, bytes: r.size }; }
  if (name === 'vm_upload') { const f = await pickFile(a.prompt); if (!f) return { uploaded: false, note: 'user cancelled' }; const p = '/root/uploads/' + f.name.replace(/[\/\0]/g, '_'); await VM.writeFile(p, new Uint8Array(await f.arrayBuffer())); return { uploaded: true, vmPath: p, bytes: f.size }; }
  if (name === 'vm_download') {
    const d = await VM.readFile(a.path); const nm = a.name || a.path.split('/').pop() || 'file';
    const url = URL.createObjectURL(new Blob([d])); const el = document.createElement('a'); el.href = url; el.download = nm; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { saved: true, name: nm, bytes: d.length };
  }
  if (name === 'vm_status') return VM.status();
  throw new Error('unknown tool: ' + name);
}
