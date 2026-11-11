'use strict';
// Embedded Python (desktop). A full CPython (python-build-standalone) ships inside the app at <app>/python with
// numpy / sympy / scipy / matplotlib / pandas / mpmath preinstalled. Extra libraries go to a per-user site directory
// (userData/python/user, PEP 370 "--user" scheme), so they survive app updates and never touch the app bundle.
// One long-lived kernel process per conversation keeps variables between python_run calls.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const KERNEL_PY = path.join(__dirname, 'kernel.py');
let userDataOverride = null;
function userData() {
  if (userDataOverride) return userDataOverride;
  if (process.env.AIB_USERDATA) return process.env.AIB_USERDATA;
  if (process.versions.electron) { try { return require('electron').app.getPath('userData'); } catch {} }
  return path.join(require('os').tmpdir(), 'aib-userdata');
}
function appRoot() { if (process.versions.electron) { try { return require('electron').app.getAppPath(); } catch {} } return path.join(__dirname, '..', '..', '..'); }
const dirs = () => { const b = path.join(userData(), 'python'); return { base: b, userBase: path.join(b, 'user'), work: path.join(b, 'work'), mpl: path.join(b, 'mplconfig') }; };

// interpreter resolution: AIB_PYTHON override (tests / dev) → bundled CPython → system python3 (dev fallback)
function interpreter() {
  if (process.env.AIB_PYTHON) return { exe: process.env.AIB_PYTHON, bundled: false, override: true };
  const cands = [path.join(appRoot(), 'python', 'bin', 'python3'), path.join(process.resourcesPath || '', 'python', 'bin', 'python3')];
  for (const c of cands) if (c && fs.existsSync(c)) return { exe: c, bundled: true };
  return { exe: process.platform === 'win32' ? 'python' : 'python3', bundled: false };
}
function env(extra) {
  const d = dirs();
  const e = Object.assign({}, process.env, {
    PYTHONUSERBASE: d.userBase, MPLBACKEND: 'Agg', MPLCONFIGDIR: d.mpl, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_WARN_SCRIPT_LOCATION: '1'
  }, extra || {});
  delete e.PYTHONHOME; delete e.PYTHONPATH; delete e.ELECTRON_RUN_AS_NODE;
  return e;
}
function ensureDirs() { const d = dirs(); for (const k of ['base', 'userBase', 'work', 'mpl']) fs.mkdirSync(d[k], { recursive: true }); return d; }
const safeId = (s) => String(s || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'default';

class Kernel {
  constructor(session) {
    this.session = safeId(session);
    const d = ensureDirs();
    this.work = path.join(d.work, this.session); fs.mkdirSync(this.work, { recursive: true });
    const it = interpreter(); this.interp = it;
    this.proc = spawn(it.exe, ['-u', KERNEL_PY], { cwd: this.work, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
    this.buf = ''; this.waiters = new Map(); this.stderrTail = ''; this.exited = false; this.lastUsed = Date.now();
    this.ready = new Promise((resolve, reject) => { this._ready = resolve; this._fail = reject; });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (c) => this._data(c));
    this.proc.stderr.on('data', (c) => { this.stderrTail = (this.stderrTail + c.toString()).slice(-4000); });
    this.proc.on('error', (e) => { this.exited = true; this._fail(e); this._failAll(e); });
    this.proc.on('exit', (code, sig) => { this.exited = true; const e = new Error(`Python 进程已退出（${sig || code}）` + (this.stderrTail ? '\n' + this.stderrTail.slice(-800) : '')); this._fail(e); this._failAll(e); });
  }
  _data(c) {
    this.buf += c; let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.ready) { this.info = j; this._ready(j); continue; }
      const w = this.waiters.get(j.id); if (w) { this.waiters.delete(j.id); w.resolve(j); }
    }
  }
  _failAll(e) { for (const w of this.waiters.values()) w.reject(e); this.waiters.clear(); }
  async run(code, id) {
    await this.ready; this.lastUsed = Date.now();
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, code, workdir: this.work, figdir: path.join(this.work, '.figures') }) + '\n');
    });
  }
  interrupt() { try { this.proc.kill('SIGINT'); } catch {} }
  kill() { try { this.proc.kill('SIGKILL'); } catch {} this.exited = true; }
}

const kernels = new Map();
let seq = 0;
function kernelFor(session) {
  const id = safeId(session);
  let k = kernels.get(id);
  if (!k || k.exited) { k = new Kernel(id); kernels.set(id, k); }
  return k;
}
setInterval(() => { const now = Date.now(); for (const [id, k] of kernels) if (now - k.lastUsed > 30 * 60e3 && !k.waiters.size) { k.kill(); kernels.delete(id); } }, 60e3).unref();

function readImages(paths) {
  const out = [];
  for (const p of paths || []) { try { out.push({ name: path.basename(p), path: p, dataUrl: 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') }); } catch {} }
  return out;
}

// Run code in the session kernel. timeoutMs → interrupt, then kill (session state is lost only on a hard kill).
async function run({ code, session, timeoutMs, signal } = {}) {
  code = String(code || '');
  if (!code.trim()) throw new Error('code is required');
  const k = kernelFor(session);
  const id = ++seq; const t0 = Date.now();
  let timer, abortFn, killed = null;
  const stop = (why) => {
    if (killed) return; killed = why; k.interrupt();
    setTimeout(() => { if (k.waiters.has(id)) { k.kill(); kernels.delete(k.session); } }, 3000).unref();
  };
  if (timeoutMs) timer = setTimeout(() => stop('timeout'), timeoutMs);
  if (signal) { if (signal.aborted) stop('stopped'); abortFn = () => stop('stopped'); signal.addEventListener('abort', abortFn); }
  try {
    const r = await k.run(code, id);
    const res = { ok: !!r.ok, stdout: r.stdout || '', stderr: r.stderr || '', result: r.result == null ? null : r.result, error: r.error || null, images: readImages(r.images), ms: Date.now() - t0, engine: 'local', python: (k.info && k.info.python) || '', session: k.session };
    if (killed === 'timeout') res.error = (res.error ? res.error + '\n' : '') + `已超时（${Math.round(timeoutMs / 1000)} 秒），运行已中断。`;
    if (killed === 'stopped') res.error = (res.error ? res.error + '\n' : '') + '已由用户停止。';
    return res;
  } catch (e) {
    const msg = killed === 'timeout' ? `已超时（${Math.round(timeoutMs / 1000)} 秒），Python 会话已重启，之前的变量已丢失。` : killed === 'stopped' ? '已由用户停止，Python 会话已重启。' : String(e.message || e);
    return { ok: false, stdout: '', stderr: '', result: null, error: msg, images: [], ms: Date.now() - t0, engine: 'local', session: k.session };
  } finally { clearTimeout(timer); if (signal && abortFn) signal.removeEventListener('abort', abortFn); }
}
function reset(session) { const id = safeId(session); const k = kernels.get(id); if (k) { k.kill(); kernels.delete(id); } return { reset: id }; }
function stopAll() { for (const k of kernels.values()) k.kill(); kernels.clear(); }

// ---- package management (pip from the bundled interpreter, user scheme under userData)
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?(\s*(==|>=|<=|~=|!=|<|>)\s*[A-Za-z0-9.*+!_-]+)?$/;
function cleanNames(pkgs) {
  const list = (Array.isArray(pkgs) ? pkgs : String(pkgs || '').split(/[\s,]+/)).map(x => String(x).trim()).filter(Boolean);
  if (!list.length) throw new Error('请提供至少一个包名');
  for (const n of list) if (!NAME_RE.test(n)) throw new Error('包名格式不正确：' + n);
  return list.slice(0, 20);
}
function pip(args, { timeoutMs = 15 * 60e3, signal, onOutput } = {}) {
  ensureDirs();
  const it = interpreter();
  return new Promise((resolve) => {
    let out = ''; const t0 = Date.now();
    const p = spawn(it.exe, ['-m', 'pip', ...args], { env: env(), cwd: dirs().base });
    const onData = (c) => { const s = c.toString(); out = (out + s).slice(-60000); if (onOutput) try { onOutput(s); } catch {} };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    const timer = setTimeout(() => { out += '\n已超时，安装已中止。'; p.kill('SIGKILL'); }, timeoutMs);
    const ab = () => { out += '\n已由用户停止。'; p.kill('SIGKILL'); };
    if (signal) signal.addEventListener('abort', ab);
    p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, output: String(e.message || e), ms: Date.now() - t0 }); });
    p.on('close', (code) => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', ab); resolve({ ok: code === 0, code, output: out.trim(), ms: Date.now() - t0 }); });
  });
}
function indexArgs() {
  let idx = ''; try { idx = String(require('../store').getSettings().python.index || '').trim(); } catch {}
  return /^https?:\/\//.test(idx) ? ['--index-url', idx] : [];
}
async function install(pkgs, opts = {}) {
  const names = cleanNames(pkgs);
  const it = interpreter();
  const extra = it.override && process.env.AIB_PIP_BREAK ? ['--break-system-packages'] : [];
  const r = await pip(['install', '--user', '--no-input', '--progress-bar', 'off', ...extra, ...indexArgs(), ...names], opts);
  for (const k of kernels.values()) k.kill(); kernels.clear(); // fresh kernels pick up new packages
  return { ok: r.ok, packages: names, output: tail(r.output), ms: r.ms, location: dirs().userBase, error: r.ok ? null : friendlyPip(r.output) };
}
async function uninstall(name, opts = {}) {
  const [n] = cleanNames([name]);
  const row = list().find(p => norm(p.name) === norm(n.replace(/\[.*$/, '').replace(/[<>=!~].*$/, '')));
  if (!row) return { ok: false, error: '未安装：' + n };
  if (row.location === 'bundled') return { ok: false, error: `「${row.name}」是内置库，不能卸载。` };
  const r = await pip(['uninstall', '-y', row.name], opts);
  for (const k of kernels.values()) k.kill(); kernels.clear();
  return { ok: r.ok, name: row.name, output: tail(r.output), error: r.ok ? null : friendlyPip(r.output) };
}
const tail = (s) => { s = String(s || ''); return s.length > 4000 ? '…' + s.slice(-4000) : s; };
const norm = (s) => String(s || '').toLowerCase().replace(/[-_.]+/g, '-');
function friendlyPip(out) {
  const s = String(out || '');
  if (/No matching distribution|Could not find a version/i.test(s)) return '找不到可用的版本（包名可能有误，或没有适用于本机的安装包）。';
  if (/Temporary failure in name resolution|NewConnectionError|Max retries exceeded|timed out/i.test(s)) return '无法连接软件源，请检查网络，或在设置中改用镜像源。';
  if (/error: subprocess-exited-with-error|Failed building wheel|Microsoft Visual C\+\+|gcc|clang/i.test(s)) return '该库需要在本机编译，但没有可用的编译环境。可改为在 Linux 虚拟机中安装。';
  if (/externally-managed-environment/i.test(s)) return '当前 Python 不允许安装第三方库。';
  return (s.split('\n').filter(l => /error/i.test(l)).slice(-2).join(' ') || s.slice(-300)).trim();
}
function sitePackagesDirs() {
  const it = interpreter(); const out = [];
  if (it.bundled) { const lib = path.join(path.dirname(path.dirname(it.exe)), 'lib'); try { for (const d of fs.readdirSync(lib)) if (/^python3\.\d+$/.test(d)) out.push({ dir: path.join(lib, d, 'site-packages'), location: 'bundled' }); } catch {} }
  const ub = dirs().userBase;
  for (const sub of ['lib']) { try { for (const d of fs.readdirSync(path.join(ub, sub))) { const sp = path.join(ub, sub, d, 'site-packages'); if (fs.existsSync(sp)) out.push({ dir: sp, location: 'user' }); } } catch {} }
  return out;
}
function list() {
  const rows = []; const seen = new Set();
  for (const { dir, location } of sitePackagesDirs().reverse()) { // user first, so user upgrades win
    let ents = []; try { ents = fs.readdirSync(dir); } catch {}
    for (const e of ents) {
      if (!/\.dist-info$/.test(e)) continue;
      let name = '', version = '';
      try { const m = fs.readFileSync(path.join(dir, e, 'METADATA'), 'utf8').split('\n\n')[0]; name = (m.match(/^Name:\s*(.+)$/m) || [])[1] || ''; version = (m.match(/^Version:\s*(.+)$/m) || [])[1] || ''; } catch { continue; }
      if (!name || seen.has(norm(name))) continue; seen.add(norm(name));
      rows.push({ name: name.trim(), version: version.trim(), location });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
function info() {
  const it = interpreter();
  let version = ''; const m = it.bundled && it.exe.match(/python3(\.\d+)?$/);
  try { const lib = path.join(path.dirname(path.dirname(it.exe)), 'lib'); version = (fs.readdirSync(lib).find(d => /^python3\.\d+$/.test(d)) || '').replace('python', ''); } catch {}
  return { executable: it.exe, bundled: it.bundled, version: version || (m && m[0]) || '', userBase: dirs().userBase, work: dirs().work, sessions: kernels.size };
}

module.exports = { run, reset, stopAll, install, uninstall, list, info, interpreter, dirs, cleanNames, friendlyPip, _setUserData: (p) => { userDataOverride = p; } };
