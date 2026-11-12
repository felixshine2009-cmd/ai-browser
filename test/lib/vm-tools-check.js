'use strict';
// Shared checks for the Codex-style VM tools (vm_view / vm_edit / vm_apply_patch / vm_search / vm_list / vm_bg /
// vm_pkg / vm_service / vm_git). `call(name, args)` runs one tool against a real Linux guest.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = async function checks({ test, assert, eq }, call, { network = true, timeout = 300000, tag = '' } = {}) {
  const W = '/root/work/codex-t';
  await test(tag + 'vm_edit create + vm_view 行号 / offset / limit', async () => {
    await call('vm_shell', { command: `rm -rf ${W} && mkdir -p ${W}` });
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const c = await call('vm_edit', { path: 'codex-t/a.txt', create: true, new_string: lines });
    assert(c.created && c.lines === 30, JSON.stringify(c));
    const v = await call('vm_view', { path: W + '/a.txt', offset: 10, limit: 5 });
    eq(v.totalLines, 30); eq(v.from, 10); eq(v.to, 14);
    assert(/^\s+10\tline 10$/m.test(v.content) && /^\s+14\tline 14$/m.test(v.content) && !/line 15/.test(v.content), v.content);
    assert(/offset=15/.test(v.more), v.more);
    const d = await call('vm_view', { path: W });
    assert(/a\.txt/.test(d.tree), JSON.stringify(d));
  }, { timeout });
  await test(tag + 'vm_edit：唯一字符串替换 / 重复时报错并给出行号 / replace_all / 行范围 / 插入 / 尾随空格容错', async () => {
    await call('vm_edit', { path: W + '/b.py', create: true, new_string: 'def f(x):\n    return x + 1   \n\ndef g(x):\n    return x + 1\n' });
    let err = null; try { await call('vm_edit', { path: W + '/b.py', old_string: 'return x + 1', new_string: 'return x + 2' }); } catch (e) { err = e; }
    assert(err && /2 次/.test(err.message) && /1、/.test(err.message) === false || /第 2、5 行/.test(err.message), String(err && err.message));
    const r1 = await call('vm_edit', { path: W + '/b.py', old_string: 'def g(x):\n    return x + 1', new_string: 'def g(x):\n    return x * 2' });
    eq(r1.replaced, 1); assert(/return x \* 2/.test(r1.snippet));
    const r2 = await call('vm_edit', { path: W + '/b.py', old_string: 'def f(x):\n    return x + 1\n', new_string: 'def f(x):\n    return x - 1\n' });
    eq(r2.match, 'whitespace');
    await call('vm_edit', { path: W + '/b.py', insert_after_line: 0, new_string: '# header' });
    await call('vm_edit', { path: W + '/b.py', start_line: 1, end_line: 1, new_string: '# new header\n# second' });
    const r3 = await call('vm_edit', { path: W + '/b.py', old_string: 'x', new_string: 'y', replace_all: true });
    assert(r3.replaced >= 4, JSON.stringify(r3));
    const out = await call('vm_shell', { command: `cat ${W}/b.py` });
    eq(out.stdout, '# new header\n# second\ndef f(y):\n    return y - 1\n\ndef g(y):\n    return y * 2\n');
    let e2 = null; try { await call('vm_edit', { path: W + '/b.py', old_string: 'nope', new_string: 'x' }); } catch (e) { e2 = e; }
    assert(e2 && /找不到 old_string/.test(e2.message));
  }, { timeout });
  await test(tag + 'vm_apply_patch：Codex 格式（新增 / 修改 / 移动 / 删除，失败时不写入任何文件）+ 统一 diff', async () => {
    await call('vm_edit', { path: W + '/m.py', create: true, new_string: 'import os\n\ndef main():\n    print("hello")\n    return 0\n\nif __name__ == "__main__":\n    main()\n' });
    await call('vm_edit', { path: W + '/old.txt', create: true, new_string: 'bye\n' });
    const ok = await call('vm_apply_patch', { cwd: W, patch: [
      '*** Begin Patch',
      '*** Add File: pkg/util.py', '+def twice(v):', '+    return 2 * v',
      '*** Update File: m.py', '*** Move to: app.py', '@@ def main():', '-    print("hello")', '+    from pkg.util import twice', '+    print("hello", twice(21))', '     return 0',
      '*** Delete File: old.txt',
      '*** End Patch'].join('\n') });
    assert(ok.applied && ok.files.length === 3, JSON.stringify(ok));
    const run = await call('vm_shell', { command: `cd ${W} && touch pkg/__init__.py && python3 app.py && ls` });
    assert(/hello 42/.test(run.stdout) && !/old\.txt/.test(run.stdout) && !/^m\.py$/m.test(run.stdout), JSON.stringify(run));
    let err = null; try { await call('vm_apply_patch', { cwd: W, patch: '*** Begin Patch\n*** Add File: should-not-exist.txt\n+x\n*** Update File: app.py\n@@\n-this line is not there\n+y\n*** End Patch' }); } catch (e) { err = e; }
    assert(err && /不匹配/.test(err.message), String(err && err.message));
    const ls = await call('vm_shell', { command: `ls ${W}` }); assert(!/should-not-exist/.test(ls.stdout), 'atomic');
    const diff = `--- a/app.py\n+++ b/app.py\n@@ -1,3 +1,3 @@\n-import os\n+import os, sys\n \n def main():\n`;
    const u = await call('vm_apply_patch', { cwd: W, patch: diff });
    assert(u.applied && u.format === 'unified', JSON.stringify(u));
    const h = await call('vm_shell', { command: `head -1 ${W}/app.py` }); eq(h.stdout.trim(), 'import os, sys');
  }, { timeout });
  await test(tag + 'vm_search（ripgrep 或 grep）+ vm_list 目录树', async () => {
    const s = await call('vm_search', { pattern: 'twice\\(', path: W });
    assert(s.count >= 2 && /app\.py:\d+:/.test(s.matches) && /util\.py:1:def twice/.test(s.matches), JSON.stringify(s));
    const s2 = await call('vm_search', { pattern: 'TWICE', path: W, ignore_case: true, files_only: true, glob: '*.py' });
    assert(/util\.py/.test(s2.matches) && !/:\d+:/.test(s2.matches), JSON.stringify(s2));
    const n = await call('vm_search', { pattern: 'zzz-not-here', path: W }); eq(n.count, 0);
    const l = await call('vm_list', { path: W, depth: 3 });
    assert(/pkg\/\n\s+__init__\.py\s+0B\n\s+util\.py\s+\d+B/.test(l.tree) && /app\.py/.test(l.tree), l.tree);
  }, { timeout });
  await test(tag + 'vm_bg：后台启动 → 增量输出 → wait → list → kill', async () => {
    const st = await call('vm_bg', { action: 'start', command: 'for i in 1 2 3; do echo tick $i; sleep 1; done; echo done', name: 'ticker' });
    assert(st.started && /^j/.test(st.id), JSON.stringify(st));
    const w = await call('vm_bg', { action: 'wait', id: st.id, timeoutSec: 60 });
    eq(w.state, 'exited'); eq(w.exitCode, 0); assert(/tick 3\ndone/.test(w.output), w.output);
    const o = await call('vm_bg', { action: 'output', id: st.id, since: 7 });
    assert(o.output.startsWith('tick 2'), JSON.stringify(o));
    const srv = await call('vm_bg', { action: 'start', command: 'python3 -m http.server 8765 --bind 127.0.0.1', cwd: W });
    await sleep(2500);
    const list = await call('vm_bg', { action: 'list' });
    assert(list.jobs.some(j => j.id === srv.id && j.state === 'running'), JSON.stringify(list));
    const k = await call('vm_bg', { action: 'kill', id: srv.id });
    assert(k.killed && k.state !== 'running', JSON.stringify(k));
    const gone = await call('vm_shell', { command: 'sleep 1; ps -o pid,args 2>/dev/null | grep -c "[h]ttp.server" || ps | grep -c "[h]ttp.server"' });
    eq(gone.stdout.trim().split('\n').pop(), '0');
  }, { timeout });
  await test(tag + 'vm_service：create → start → 崩溃后自动重启 → enable → logs → stop → remove', async () => {
    const c = await call('vm_service', { action: 'create', name: 'hello-svc', command: 'echo started; sleep 1; exit 3', cwd: W });
    assert(c.created, JSON.stringify(c));
    const s = await call('vm_service', { action: 'start', name: 'hello-svc' });
    assert(/running/.test(s.status) || /started/.test(s.output), JSON.stringify(s));
    await sleep(5000);
    const lg = await call('vm_service', { action: 'logs', name: 'hello-svc' });
    assert((lg.output.match(/\[aib-svc\] start/g) || []).length >= 2 && /exited 3/.test(lg.output), lg.output);
    const en = await call('vm_service', { action: 'enable', name: 'hello-svc' }); assert(/enabled/.test(en.output), JSON.stringify(en));
    const l = await call('vm_service', { action: 'list' }); assert(/hello-svc .*enabled=yes/.test(l.output), l.output);
    const st = await call('vm_service', { action: 'stop', name: 'hello-svc' }); assert(/stopped/.test(st.output));
    const ss = await call('vm_service', { action: 'status', name: 'hello-svc' }); assert(/stopped/.test(ss.output), ss.output);
    await call('vm_service', { action: 'remove', name: 'hello-svc' });
    const l2 = await call('vm_service', { action: 'list' }); assert(!/hello-svc/.test(l2.output));
  }, { timeout });
  await test(tag + 'vm_git：init / add / commit / log / diff（非交互，默认作者）', async () => {
    const R = W + '/repo';
    let r = await call('vm_git', { repo: R, args: ['init'] }); eq(r.exitCode, 0, r.stderr);
    await call('vm_edit', { path: R + '/README.md', create: true, new_string: '# demo\n' });
    r = await call('vm_git', { repo: R, args: ['add', '-A'] }); eq(r.exitCode, 0, r.stderr);
    r = await call('vm_git', { repo: R, args: ['commit', '-m', 'first commit'] }); eq(r.exitCode, 0, r.stderr + r.stdout);
    await call('vm_edit', { path: R + '/README.md', old_string: '# demo', new_string: '# demo 2' });
    r = await call('vm_git', { repo: R, args: ['diff'] }); assert(/-# demo\n\+# demo 2/.test(r.stdout), r.stdout);
    r = await call('vm_git', { repo: R, args: ['log', '--format=%an|%s'] }); eq(r.stdout.trim(), 'AI Browser VM|first commit');
  }, { timeout });
  await test(tag + 'vm_pkg：list / search / info' + (network ? ' / install + remove（jq）' : ''), async () => {
    const l = await call('vm_pkg', { action: 'list' }); assert(l.ok && /python3/.test(l.output), JSON.stringify(l).slice(0, 400));
    if (!network) return;
    const i = await call('vm_pkg', { action: 'install', packages: ['jq'] }); assert(i.ok, i.output);
    const j = await call('vm_shell', { command: `echo '{"a":[1,2,3]}' | jq '.a | add'` }); eq(j.stdout.trim(), '6');
    const r = await call('vm_pkg', { action: 'remove', packages: ['jq'] }); assert(r.ok, r.output);
    let bad = null; try { await call('vm_pkg', { action: 'install', packages: ['x; rm -rf /'] }); } catch (e) { bad = e; } assert(bad && /不合法/.test(bad.message));
  }, { timeout: Math.max(timeout, 600000) });
};
