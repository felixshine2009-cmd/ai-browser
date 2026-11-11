// Pyodide (MPL-2.0) Python runtime in a Web Worker. Loaded lazily from the CDN; the service worker caches every file
// (core, packages, wheels) so it works offline after the first download.
// (module worker: Pyodide 314+ no longer supports classic workers)
const PYODIDE_VERSION = '314.0.7';
const INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let py = null, booting = null;
const RUNNER = `
import ast, io, sys, json, base64, traceback, contextlib, time
_AIB_NS = {'__name__': '__main__'}
def _aib_figs():
    out = []
    plt = sys.modules.get('matplotlib.pyplot')
    if not plt: return out
    for num in plt.get_fignums():
        b = io.BytesIO(); plt.figure(num).savefig(b, format='png', dpi=110, bbox_inches='tight')
        out.append(base64.b64encode(b.getvalue()).decode())
    plt.close('all')
    return out
async def _aib_run(code):
    so, se = io.StringIO(), io.StringIO()
    res = {'ok': True, 'stdout': '', 'stderr': '', 'result': None, 'error': None, 'images': []}
    try:
        tree = ast.parse(code, '<cell>', 'exec')
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
        with contextlib.redirect_stdout(so), contextlib.redirect_stderr(se):
            r = eval(compile(tree, '<cell>', 'exec', flags=flags), _AIB_NS)
            if hasattr(r, '__await__'): await r
            if last is not None:
                v = eval(compile(last, '<cell>', 'eval', flags=flags), _AIB_NS)
                if hasattr(v, '__await__'): v = await v
                if v is not None:
                    _AIB_NS['_'] = v; res['result'] = repr(v)[:200000]
    except BaseException:
        res['ok'] = False
        et, ev, tb = sys.exc_info()
        while tb is not None and tb.tb_frame.f_code.co_filename != '<cell>': tb = tb.tb_next
        res['error'] = ''.join(traceback.format_exception(et, ev, tb))[-8000:]
    try: res['images'] = _aib_figs()
    except Exception as e: se.write('figure capture failed: %s\\n' % e)
    res['stdout'] = so.getvalue()[:200000]; res['stderr'] = se.getvalue()[:200000]
    return json.dumps(res)
`;
async function boot(packages) {
  if (py) return py;
  if (booting) return booting;
  booting = (async () => {
    post({ type: 'status', text: 'loading' });
    const { loadPyodide } = await import(INDEX + 'pyodide.mjs');
    py = await loadPyodide({ indexURL: INDEX, stdout: () => {}, stderr: () => {} });
    await py.loadPackage(['micropip']);
    const env = py.globals.get('__import__')('os').environ; env.set('MPLBACKEND', 'Agg');
    await py.runPythonAsync(RUNNER);
    for (const p of packages || []) { try { await installNames([p], true); } catch {} }
    post({ type: 'status', text: 'ready', python: py.runPython('import sys; sys.version.split()[0]') });
    return py;
  })();
  try { return await booting; } finally { booting = null; }
}
function post(m) { self.postMessage(m); }
async function installNames(names, quiet) {
  const micropip = py.pyimport('micropip');
  const out = [];
  for (const n of names) { await micropip.install(n); out.push(n); }
  if (!quiet) post({ type: 'log', text: 'installed ' + out.join(', ') });
  return out;
}
self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'boot') { await boot(m.packages); post({ id: m.id, ok: true }); return; }
    await boot(m.packages);
    if (m.type === 'run') {
      const t0 = Date.now();
      try { await py.loadPackagesFromImports(m.code); } catch (err) { /* unknown imports surface as ModuleNotFoundError */ }
      const fn = py.globals.get('_aib_run');
      const json = await fn(m.code); fn.destroy && fn.destroy();
      const r = JSON.parse(json); r.ms = Date.now() - t0; r.python = py.runPython('import sys; sys.version.split()[0]');
      post({ id: m.id, ok: true, result: r });
    } else if (m.type === 'install') {
      const done = await installNames(m.names);
      post({ id: m.id, ok: true, result: { installed: done } });
    } else if (m.type === 'list') {
      const j = py.runPython('import json, importlib.metadata as md\njson.dumps(sorted({(d.metadata["Name"] or "").strip(): d.version for d in md.distributions()}.items()))');
      post({ id: m.id, ok: true, result: JSON.parse(j) });
    }
  } catch (err) {
    post({ id: m.id, ok: false, error: String((err && err.message) || err).split('\n').slice(-6).join('\n') });
  }
};
