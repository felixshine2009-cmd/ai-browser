// Web / iPad Python: Pyodide in a Web Worker (lazy). Extra packages via micropip; their names are remembered and
// re-installed (from the offline cache) when a new session starts.
const LS = 'aib.py.packages';
let worker = null, seq = 0; const pending = new Map(); let state = { phase: 'idle', python: '' };
const listeners = new Set();
export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setState(s) { state = Object.assign({}, state, s); listeners.forEach(f => { try { f(state); } catch {} }); }
export function status() { return state; }
export function remembered() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } }
function remember(list) { localStorage.setItem(LS, JSON.stringify([...new Set(list)].slice(0, 60))); }
function ensure() {
  if (worker) return worker;
  worker = new Worker(new URL('./python-worker.js', import.meta.url), { type: 'module' });
  setState({ phase: 'loading' });
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'status') { setState({ phase: m.text === 'ready' ? 'ready' : 'loading', python: m.python || state.python }); return; }
    const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || 'Python error'));
  };
  worker.onerror = (e) => { setState({ phase: 'error', error: String(e.message || e) }); for (const p of pending.values()) p.reject(new Error('Python 运行环境加载失败：' + (e.message || '网络错误'))); pending.clear(); worker = null; };
  return worker;
}
function call(type, payload, signal) {
  const w = ensure(); const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(Object.assign({ id, type, packages: remembered() }, payload || {}));
    if (signal) signal.addEventListener('abort', () => { if (pending.has(id)) { pending.delete(id); restart(); reject(Object.assign(new Error('已由用户停止，Python 会话已重启。'), { stopped: true })); } }, { once: true });
  });
}
export function restart() { if (worker) { worker.terminate(); worker = null; } for (const p of pending.values()) p.reject(new Error('Python 会话已重启')); pending.clear(); setState({ phase: 'idle' }); }
export async function run(code, { signal, timeoutSec = 600 } = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutSec * 1000);
  if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
  const t0 = Date.now();
  try {
    const r = await call('run', { code }, ac.signal);
    return Object.assign(r, { engine: 'pyodide', images: (r.images || []).map((b, i) => ({ name: `figure-${i + 1}.png`, dataUrl: 'data:image/png;base64,' + b })) });
  } catch (e) {
    const timeout = !(signal && signal.aborted) && ac.signal.aborted;
    return { ok: false, stdout: '', stderr: '', result: null, images: [], engine: 'pyodide', ms: Date.now() - t0, error: timeout ? `已超时（${timeoutSec} 秒），Python 会话已重启。` : String(e.message || e) };
  } finally { clearTimeout(t); }
}
export async function install(names, { signal } = {}) {
  const r = await call('install', { names }, signal);
  remember(remembered().concat(names));
  return r;
}
export function forget(name) { remember(remembered().filter(n => n.toLowerCase() !== String(name).toLowerCase())); restart(); }
export async function list() { return call('list', {}); }
export async function warm() { return call('boot', {}); }
