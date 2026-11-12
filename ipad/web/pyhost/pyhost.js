// Python kernel host for the iPad app (hidden WKWebView). Pyodide is loaded from the app bundle (aibres://app/pyodide/).
// Called by the Node.js side (src/main/python/index.js on iPad) through executeJavaScript.
(function () {
  const INDEX = new URL('../pyodide/', location.href).href;
  let py = null, booting = null, pyver = '';
  const RUNNER = `
import ast, io, os, sys, json, base64, traceback, contextlib, time
_AIB_NS = {}
def _aib_figs():
    out = []
    plt = sys.modules.get('matplotlib.pyplot')
    if not plt: return out
    for num in plt.get_fignums():
        b = io.BytesIO(); plt.figure(num).savefig(b, format='png', dpi=110, bbox_inches='tight')
        out.append(base64.b64encode(b.getvalue()).decode())
    plt.close('all')
    return out
def _aib_scan(root, since):
    files, total = {}, 0
    for d, _, fs in os.walk(root):
        if '/.' in d[len(root):]: continue
        for f in fs:
            if f.startswith('.'): continue
            p = os.path.join(d, f)
            try: st = os.stat(p)
            except OSError: continue
            if st.st_mtime < since or st.st_size > 32*1024*1024 or total + st.st_size > 64*1024*1024: continue
            total += st.st_size
            with open(p, 'rb') as fh: files[os.path.relpath(p, root)] = base64.b64encode(fh.read()).decode()
    return files
async def _aib_run(session, code, push_json):
    work = '/work/' + session
    os.makedirs(work, exist_ok=True)
    for rel, b64 in json.loads(push_json).items():
        p = os.path.join(work, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as fh: fh.write(base64.b64decode(b64))
    ns = _AIB_NS.setdefault(session, {'__name__': '__main__'})
    os.chdir(work)
    t0 = time.time() - 1
    so, se = io.StringIO(), io.StringIO()
    res = {'ok': True, 'stdout': '', 'stderr': '', 'result': None, 'error': None, 'images': [], 'files': {}}
    try:
        tree = ast.parse(code, '<cell>', 'exec')
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
        with contextlib.redirect_stdout(so), contextlib.redirect_stderr(se):
            r = eval(compile(tree, '<cell>', 'exec', flags=flags), ns)
            if hasattr(r, '__await__'): await r
            if last is not None:
                v = eval(compile(last, '<cell>', 'eval', flags=flags), ns)
                if hasattr(v, '__await__'): v = await v
                if v is not None:
                    ns['_'] = v; res['result'] = repr(v)[:200000]
    except BaseException:
        res['ok'] = False
        et, ev, tb = sys.exc_info()
        while tb is not None and tb.tb_frame.f_code.co_filename != '<cell>': tb = tb.tb_next
        res['error'] = ''.join(traceback.format_exception(et, ev, tb))[-8000:]
    try: res['images'] = _aib_figs()
    except Exception as e: se.write('figure capture failed: %s\\n' % e)
    try: res['files'] = _aib_scan(work, t0)
    except Exception as e: se.write('file sync failed: %s\\n' % e)
    res['stdout'] = so.getvalue()[:200000]; res['stderr'] = se.getvalue()[:200000]
    return json.dumps(res)
`;
  async function boot(extra) {
    if (py) return { python: pyver };
    if (booting) return booting;
    booting = (async () => {
      const { loadPyodide } = await import(INDEX + 'pyodide.mjs');
      py = await loadPyodide({ indexURL: INDEX, stdout: () => {}, stderr: () => {}, env: { MPLBACKEND: 'Agg', HOME: '/home/pyodide' } });
      await py.loadPackage(['micropip']);
      await py.runPythonAsync(RUNNER);
      pyver = py.runPython('import sys; sys.version.split()[0]');
      for (const p of extra || []) { try { await py.pyimport('micropip').install(p); } catch (e) { console.warn('reinstall failed', p, e); } }
      return { python: pyver };
    })();
    try { return await booting; } finally { booting = null; }
  }
  async function run(m) {
    await boot();
    try { await py.loadPackagesFromImports(m.code); } catch (e) { /* unknown imports surface as ModuleNotFoundError */ }
    const fn = py.globals.get('_aib_run');
    try { return JSON.parse(await fn(m.session, m.code, JSON.stringify(m.files || {}))); } finally { fn.destroy && fn.destroy(); }
  }
  async function install(names) {
    await boot();
    const out = [];
    try {
      const micropip = py.pyimport('micropip');
      for (const n of names) { await micropip.install(n); out.push('已安装 ' + n); }
      const versions = JSON.parse(py.runPython('import json, importlib.metadata as md\njson.dumps({(d.metadata["Name"] or "").strip().lower().replace("_","-").replace(".","-"): d.version for d in md.distributions()})'));
      return { ok: true, output: out.join('\n'), versions };
    } catch (e) { return { ok: false, output: out.concat([String(e && e.message || e).split('\n').slice(-6).join('\n')]).join('\n') }; }
  }
  function reset(session) { if (py) py.runPython(`_AIB_NS.pop(${JSON.stringify(String(session))}, None)`); return true; }
  window.pyhost = { boot, run, install, reset, ready: () => !!py };
})();
