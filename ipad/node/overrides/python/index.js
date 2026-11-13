'use strict';
// Embedded Python on iPad. iPadOS does not allow an app to start an interpreter process, so the same API as the desktop
// module (run / install / uninstall / list / info / reset) is served by CPython compiled to WebAssembly (Pyodide), shipped
// inside the app with numpy, scipy, sympy, mpmath, pandas, matplotlib and Pillow. It runs in a hidden WKWebView (its own
// process, JIT-compiled WebAssembly). Each conversation has its own namespace and working directory; files written in
// the working directory are synchronised with userData/python/work/<session>. Extra libraries are installed with
// micropip (pure-Python wheels from PyPI and every package of the Pyodide distribution) and are re-installed in new
// interpreter instances automatically.
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const HOST_URL = 'aibres://app/pyhost/index.html';
const KERNEL_PY = path.join(__dirname, 'kernel.py');
let userDataOverride = null;
function userData() { return userDataOverride || process.env.AIB_USER_DATA || require('electron').app.getPath('userData'); }
const dirs = () => { const b = path.join(userData(), 'python'); return { base: b, userBase: path.join(b, 'user'), work: path.join(b, 'work'), mpl: path.join(b, 'mplconfig') }; };
function ensureDirs() { const d = dirs(); for (const k of ['base', 'userBase', 'work']) fs.mkdirSync(d[k], { recursive: true }); return d; }
const safeId = (s) => String(s || 'default').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'default';
const userPkgsFile = () => path.join(dirs().base, 'ipad-packages.json');
function userPkgs() { try { return JSON.parse(fs.readFileSync(userPkgsFile(), 'utf8')); } catch { return []; } }
function saveUserPkgs(l) { ensureDirs(); fs.writeFileSync(userPkgsFile(), JSON.stringify(l, null, 1)); }
function bundledPkgs() { try { return JSON.parse(fs.readFileSync(path.join(global.__aibIpad.resources, 'pyodide-packages.json'), 'utf8')); } catch { return { python: '3.13', packages: [] }; } }

// ---------------------------------------------------------------- kernel host (hidden web view)
// 2.3.0: wait until the helper page has defined its API before calling it. 2.2.2 called it straight after loadURL;
// on the device the page script then ran in another JavaScript world and the call failed with "window.X is undefined".
async function waitReady(wc, name, what, ms = 30000) {
  const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < ms) {
    try {
      const r = await wc.executeJavaScript(`(function(){try{return {t: typeof window.${name}, s: document.readyState, u: location.href}}catch(e){return {t:'error', s:String(e)}}})()`);
      if (r && r.t === 'object') return;
      last = r ? `typeof window.${name} = ${r.t}，页面状态 ${r.s}${r.u ? '，' + r.u : ''}` : '';
    } catch (e) { last = String(e.message || e); }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`${what}宿主页面在 ${Math.round(ms / 1000)} 秒内未就绪（${last || '无响应'}）。请重新打开应用；若问题持续，请在“设置 › 关于”中导出日志。`);
}
let win = null, booting = null, kinfo = null;
const sessions = new Map(); // session -> { lastPush, lastUsed }
async function hostWin() {
  if (win && !win.isDestroyed()) { if (booting) await booting; return win; }
  win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true } });
  const w = win;
  booting = (async () => {
    await w.loadURL(HOST_URL);
    await waitReady(w.webContents, 'pyhost', 'Python ');
    const r = await w.webContents.executeJavaScript(`window.pyhost.boot(${JSON.stringify(userPkgs().map(p => p.spec || p.name))})`);
    kinfo = r || {};
  })();
  try { await booting; } catch (e) { try { w.destroy(); } catch {} if (win === w) win = null; throw new Error('Python 运行环境启动失败：' + (e.message || e)); } finally { booting = null; }
  return w;
}
function killHost() { const w = win; win = null; kinfo = null; sessions.clear(); if (w) { try { w.destroy(); } catch {} } }

function collectPush(dir, since) {
  const out = {}; let total = 0;
  const walk = (d, rel) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(p, r); continue; }
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.mtimeMs <= since || st.size > 32 * 1024 * 1024 || total + st.size > 128 * 1024 * 1024) continue;
      total += st.size; out[r] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(dir, ''); return out;
}
function applyPull(dir, files) {
  for (const [rel, b64] of Object.entries(files || {})) {
    const p = path.resolve(dir, rel); if (!p.startsWith(path.resolve(dir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  }
}

async function run({ code, session, timeoutMs, signal } = {}) {
  code = String(code || '');
  if (!code.trim()) throw new Error('code is required');
  const sid = safeId(session); const t0 = Date.now();
  const d = ensureDirs(); const work = path.join(d.work, sid); fs.mkdirSync(work, { recursive: true });
  let killed = null, timer, abortFn;
  const stop = (why) => { if (killed) return; killed = why; killHost(); };
  if (timeoutMs) timer = setTimeout(() => stop('timeout'), timeoutMs);
  if (signal) { if (signal.aborted) stop('stopped'); abortFn = () => stop('stopped'); signal.addEventListener('abort', abortFn); }
  try {
    const w = await hostWin();
    const s = sessions.get(sid) || { lastPush: 0 }; sessions.set(sid, s);
    const push = collectPush(work, s.lastPush); s.lastPush = Date.now(); s.lastUsed = Date.now();
    const r = await w.webContents.executeJavaScript(`window.pyhost.run(${JSON.stringify({ session: sid, code, files: push })})`);
    applyPull(work, r.files); s.lastPush = Date.now();
    return { ok: !!r.ok, stdout: r.stdout || '', stderr: r.stderr || '', result: r.result == null ? null : r.result, error: r.error || null,
      images: (r.images || []).map((b, i) => ({ name: `figure-${i + 1}.png`, path: path.join(work, '.figures', `figure-${i + 1}.png`), dataUrl: 'data:image/png;base64,' + b })),
      ms: Date.now() - t0, engine: 'local', python: (kinfo && kinfo.python) || '', session: sid };
  } catch (e) {
    const msg = killed === 'timeout' ? `已超时（${Math.round(timeoutMs / 1000)} 秒），Python 会话已重启，之前的变量已丢失。` : killed === 'stopped' ? '已由用户停止，Python 会话已重启。' : String(e.message || e);
    return { ok: false, stdout: '', stderr: '', result: null, error: msg, images: [], ms: Date.now() - t0, engine: 'local', session: sid };
  } finally { clearTimeout(timer); if (signal && abortFn) signal.removeEventListener('abort', abortFn); }
}
function reset(session) {
  const sid = safeId(session); sessions.delete(sid);
  if (win && !win.isDestroyed()) win.webContents.executeJavaScript(`window.pyhost.reset(${JSON.stringify(sid)})`).catch(() => {});
  return { reset: sid };
}
function stopAll() { killHost(); }

// ---------------------------------------------------------------- packages (micropip)
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?(\s*(==|>=|<=|~=|!=|<|>)\s*[A-Za-z0-9.*+!_-]+)?$/;
function cleanNames(pkgs) {
  const list = (Array.isArray(pkgs) ? pkgs : String(pkgs || '').split(/[\s,]+/)).map(x => String(x).trim()).filter(Boolean);
  if (!list.length) throw new Error('请提供至少一个包名');
  for (const n of list) if (!NAME_RE.test(n)) throw new Error('包名格式不正确：' + n);
  return list.slice(0, 20);
}
const norm = (s) => String(s || '').toLowerCase().replace(/[-_.]+/g, '-');
const baseName = (spec) => String(spec).replace(/\[.*$/, '').replace(/\s*[<>=!~].*$/, '').trim();
async function install(pkgs, opts = {}) {
  const names = cleanNames(pkgs); const t0 = Date.now();
  try {
    const w = await hostWin();
    if (opts.onOutput) opts.onOutput('正在通过 micropip 安装：' + names.join(', ') + '\n');
    const r = await w.webContents.executeJavaScript(`window.pyhost.install(${JSON.stringify(names)})`);
    if (!r.ok) return { ok: false, packages: names, output: r.output || '', ms: Date.now() - t0, location: dirs().userBase, error: friendlyPip(r.output || r.error) };
    const list = userPkgs().filter(p => !names.some(n => norm(baseName(n)) === norm(p.name)));
    for (const n of names) { const v = (r.versions || {})[norm(baseName(n))] || ''; list.push({ name: baseName(n), spec: n, version: v }); }
    saveUserPkgs(list);
    if (opts.onOutput) opts.onOutput((r.output || '') + '\n');
    return { ok: true, packages: names, output: r.output || '', ms: Date.now() - t0, location: dirs().userBase, error: null };
  } catch (e) { return { ok: false, packages: names, output: String(e.message || e), ms: Date.now() - t0, error: friendlyPip(String(e.message || e)) }; }
}
async function uninstall(name) {
  const [n] = cleanNames([name]);
  if (bundledPkgs().packages.some(p => norm(p.name) === norm(baseName(n)))) return { ok: false, error: `「${baseName(n)}」是内置库，不能卸载。` };
  const list = userPkgs(); const row = list.find(p => norm(p.name) === norm(baseName(n)));
  if (!row) return { ok: false, error: '未安装：' + n };
  saveUserPkgs(list.filter(p => p !== row)); killHost(); // a fresh interpreter no longer loads it
  return { ok: true, name: row.name, output: '已卸载 ' + row.name, error: null };
}
function friendlyPip(out) {
  const s = String(out || '');
  if (/Can't find a pure Python 3 wheel|No known package with name|Can't find a pure Python/i.test(s)) return '找不到可在 iPad 上运行的版本：该库需要原生编译。可改为在 Linux 虚拟机中使用，或选择纯 Python 的替代库。';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(s)) return '无法连接软件源，请检查网络。';
  return (s.split('\n').filter(l => /error/i.test(l)).slice(-2).join(' ') || s.slice(-300)).trim();
}
function list() {
  const rows = []; const seen = new Set();
  for (const p of userPkgs()) { if (seen.has(norm(p.name))) continue; seen.add(norm(p.name)); rows.push({ name: p.name, version: p.version || '', location: 'user' }); }
  for (const p of bundledPkgs().packages) { if (seen.has(norm(p.name))) continue; seen.add(norm(p.name)); rows.push({ name: p.name, version: p.version || '', location: 'bundled' }); }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
function interpreter() { return { exe: 'Pyodide (WebAssembly)', bundled: true }; }
function info() {
  const b = bundledPkgs();
  return { executable: 'Pyodide · WebAssembly', bundled: true, version: (kinfo && kinfo.python) || b.python || '', userBase: dirs().userBase, work: dirs().work, sessions: sessions.size, engine: 'pyodide' };
}

module.exports = { run, reset, stopAll, install, uninstall, list, info, interpreter, dirs, cleanNames, friendlyPip, KERNEL_PY, _setUserData: (p) => { userDataOverride = p; } };
