#!/usr/bin/env python3
"""AI Browser Python kernel: one long-lived process per conversation.
Protocol: JSON lines on stdin  {"id": n, "code": "...", "workdir": "...", "figdir": "..."}
          JSON lines on the ORIGINAL stdout  {"id": n, "ok": bool, "stdout": str, "stderr": str,
                                              "result": str|None, "images": [png paths], "error": str|None}
Process-level writes to fd 1 (os.system, C extensions) are redirected to stderr so they never corrupt the protocol.
SIGINT interrupts the running cell (KeyboardInterrupt) without losing the session."""
import ast, io, json, os, sys, time, traceback, contextlib

_proto = os.fdopen(os.dup(1), 'w', encoding='utf-8', buffering=1)
os.dup2(2, 1)
sys.stdout = io.TextIOWrapper(os.fdopen(1, 'wb', buffering=0), encoding='utf-8', line_buffering=True)
os.environ.setdefault('MPLBACKEND', 'Agg')
for p in [x for x in os.environ.get('AIB_EXTRA_PATH', '').split(os.pathsep) if x]:
    if p not in sys.path:
        sys.path.insert(0, p)

NS = {'__name__': '__main__', '__builtins__': __builtins__}
MAX_OUT = 200_000


def _clip(s):
    return s if len(s) <= MAX_OUT else s[:MAX_OUT] + f'\n…（输出过长，已截断 {len(s) - MAX_OUT} 个字符）'


def _figures(figdir, rid):
    out = []
    plt = sys.modules.get('matplotlib.pyplot')
    if not plt:
        return out
    try:
        os.makedirs(figdir, exist_ok=True)
        for i, num in enumerate(plt.get_fignums()):
            fig = plt.figure(num)
            p = os.path.join(figdir, f'fig-{rid}-{i + 1}.png')
            fig.savefig(p, dpi=110, bbox_inches='tight')
            out.append(p)
        plt.close('all')
    except Exception as e:  # noqa
        print('figure capture failed:', e, file=sys.stderr)
    return out


def run(req):
    rid = req.get('id')
    code = req.get('code') or ''
    wd = req.get('workdir')
    if wd:
        os.makedirs(wd, exist_ok=True)
        os.chdir(wd)
    figdir = req.get('figdir') or os.path.join(os.getcwd(), 'figures')
    so, se = io.StringIO(), io.StringIO()
    res = {'id': rid, 'ok': True, 'stdout': '', 'stderr': '', 'result': None, 'images': [], 'error': None}
    t0 = time.time()
    try:
        tree = ast.parse(code, '<cell>', 'exec')
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        with contextlib.redirect_stdout(so), contextlib.redirect_stderr(se):
            exec(compile(tree, '<cell>', 'exec'), NS)
            if last is not None:
                v = eval(compile(last, '<cell>', 'eval'), NS)
                if v is not None:
                    NS['_'] = v
                    res['result'] = _clip(repr(v))
    except KeyboardInterrupt:
        res['ok'] = False
        res['error'] = 'KeyboardInterrupt: 已中断'
    except SystemExit as e:
        res['result'] = f'SystemExit({e.code})'
    except BaseException:  # noqa
        res['ok'] = False
        et, ev, tb = sys.exc_info()
        while tb is not None and tb.tb_frame.f_code.co_filename == __file__:
            tb = tb.tb_next
        res['error'] = ''.join(traceback.format_exception(et, ev, tb))[-8000:]
    res['images'] = _figures(figdir, rid)
    res['stdout'] = _clip(so.getvalue())
    res['stderr'] = _clip(se.getvalue())
    res['ms'] = int((time.time() - t0) * 1000)
    return res


def main():
    _proto.write(json.dumps({'ready': True, 'python': sys.version.split()[0], 'executable': sys.executable}) + '\n')
    while True:
        try:
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            continue
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue
        try:
            out = run(req)
        except KeyboardInterrupt:
            out = {'id': req.get('id'), 'ok': False, 'error': 'KeyboardInterrupt: 已中断', 'stdout': '', 'stderr': '', 'images': []}
        _proto.write(json.dumps(out, ensure_ascii=False) + '\n')
        _proto.flush()


if __name__ == '__main__':
    main()
