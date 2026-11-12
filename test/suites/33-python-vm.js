'use strict';
// Lean checks for embedded Python, the Linux VM wiring and the web/iPad Pyodide + v86 integration.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function findPython() {
  const cands = [process.env.AIB_PYTHON, path.join(ROOT, 'python/bin/python3'), '/workspace/pycache/pbs-linux/python/bin/python3', 'python3'].filter(Boolean);
  for (const c of cands) {
    try { execFileSync(c, ['-c', 'import numpy, sympy, matplotlib'], { stdio: 'ignore', timeout: 60000 }); return c; } catch {}
  }
  return null;
}

module.exports = async ({ test, group, assert, eq }) => {
  group('Python 与 Linux 虚拟机');
  const PY = require('../../src/main/python');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-py-'));
  PY._setUserData(tmp);
  const exe = findPython();
  if (exe) process.env.AIB_PYTHON = exe;

  await test('Python 会话：输出、表达式结果、变量持久', async () => {
    if (!exe) return console.log('    (跳过：本机无含 numpy/sympy/matplotlib 的 Python)');
    const a = await PY.run({ code: 'x = 6*7\nprint("hi")\nx', session: 't1' });
    assert(a.ok, a.error); eq(a.stdout.trim(), 'hi'); eq(a.result, '42');
    const b = await PY.run({ code: 'x + 1', session: 't1' });
    eq(b.result, '43');
  });

  await test('sympy / numpy 可导入并计算正确', async () => {
    if (!exe) return;
    const r = await PY.run({ code: 'import sympy as sp, numpy as np\nx=sp.symbols("x")\nprint(sp.integrate(sp.sin(x)**2,(x,0,sp.pi)))\nprint(int(np.arange(101).sum()))', session: 't2' });
    assert(r.ok, r.error); eq(r.stdout.trim().split('\n'), ['pi/2', '5050']);
  });

  await test('matplotlib 图像被捕获为 PNG', async () => {
    if (!exe) return;
    const r = await PY.run({ code: 'import matplotlib.pyplot as plt\nplt.plot([1,2,3],[1,4,9])', session: 't3' });
    assert(r.ok, r.error); eq(r.images.length, 1);
    assert(/^data:image\/png;base64,iVBOR/.test(r.images[0].dataUrl));
  });

  await test('错误信息不含内部帧；超时会中断但保留会话', async () => {
    if (!exe) return;
    const e = await PY.run({ code: '1/0', session: 't4' });
    assert(!e.ok && /ZeroDivisionError/.test(e.error) && !/kernel\.py/.test(e.error));
    await PY.run({ code: 'keep = 5', session: 't4' });
    const t = await PY.run({ code: 'import time\nwhile True: time.sleep(0.1)', session: 't4', timeoutMs: 1500 });
    assert(!t.ok && /超时|中断/.test(t.error), t.error);
    const k = await PY.run({ code: 'keep', session: 't4' });
    eq(k.result, '5');
  });

  await test('安装接口：包名校验与中文错误原因', () => {
    eq(PY.cleanNames(['numpy', 'requests==2.32.0', 'pkg[extra]>=1']).length, 3);
    let threw = false; try { PY.cleanNames(['rm -rf /']); } catch { threw = true; } assert(threw);
    threw = false; try { PY.cleanNames(['--index-url=http://x']); } catch { threw = true; } assert(threw);
    assert(/找不到|网络|失败/.test(PY.friendlyPip('ERROR: No matching distribution found for nopkg')));
    const d = PY.dirs(); assert(d.userBase.startsWith(tmp) && d.work.startsWith(tmp));
  });

  await test('工具注册：python_run / python_install / vm_* 在工具列表与提示词中', () => {
    const T = require('../../src/main/ai/tools.js');
    const names = T.BUILTIN.map(t => t.name);
    for (const n of ['python_run', 'python_install', 'vm_shell', 'vm_read_file', 'vm_write_file', 'vm_upload', 'vm_download']) assert(names.includes(n), n);
    const P = require('../../src/main/ai/prompts.js');
    assert(/python_run/.test(P.compute()) && /verify/i.test(P.compute()));
  });

  await test('发送给模型的结果去掉图像数据，界面保留', () => {
    const A = require('../../src/main/ai/agent.js');
    const big = 'data:image/png;base64,' + 'A'.repeat(5000);
    const m = A.forModel({ ok: true, stdout: 'x', images: [{ name: 'f.png', dataUrl: big }] });
    const s = typeof m === 'string' ? m : JSON.stringify(m);
    assert(!s.includes('AAAA') && /image shown to the user/.test(s));
    const ui = A.slimForUi({ ok: true, images: [{ dataUrl: big }] });
    assert(JSON.stringify(ui).includes('AAAA'));
  });

  await test('虚拟机镜像名称与发布资产一致；客体代理语法正确', () => {
    const src = read('src/main/vm/index.js');
    for (const a of ['linux-vm-arm64-vmlinux.gz', 'linux-vm-arm64-initramfs.gz', 'linux-vm-arm64-rootfs.img.gz']) assert(src.includes(a), a);
    assert(/正在准备 Linux 虚拟机/.test(src + read('src/main/ai/compute-tools.js') + read('src/renderer/static/settings.js')));
    execFileSync('python3', ['-m', 'py_compile', path.join(ROOT, 'vm/guest/agent.py')]);
    execFileSync('python3', ['-m', 'py_compile', path.join(ROOT, 'src/main/python/kernel.py')]);
  });

  await test('渲染进程脚本语法正确', () => {
    const dir = path.join(ROOT, 'src/renderer/static');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) execFileSync(process.execPath, ['--check', path.join(dir, f)]);
  });

  await test('设置页包含“Python 与虚拟机”', () => {
    const s = JSON.parse(read('src/renderer/static/strings.json'));
    const flat = JSON.stringify(s); assert(flat.includes('Python 与虚拟机'));
    assert(/renderPython/.test(read('src/renderer/static/settings.js')));
  });

  group('网页版 / iPad：Pyodide 与虚拟机');
  await test('Service Worker 版本与缓存清单', () => {
    const sw = read('web/sw.js');
    assert(sw.includes("'aib-web-v2.6.0'"));
    for (const f of ['runpanel.js', 'python.js', 'python-worker.js', 'compute-tools.js', 'linux-vm.js', 'py-settings.js']) { assert(sw.includes('./js/' + f), f); assert(fs.existsSync(path.join(ROOT, 'web/js', f)), f); }
    assert(/cdn\.jsdelivr\.net/.test(sw) && /pyodide/.test(sw));
    const html = read('web/index.html');
    assert(html.includes('js/runpanel.js') && html.includes('id="pySettings"'));
    assert(!/data-desktop-only[^>]*python/i.test(html));
    eq(read('web/js/runpanel.js'), read('src/renderer/static/runpanel.js'));
  });

  await test('网页 API：流式 tool_calls 解析（OpenAI / Anthropic）', async () => {
    const api = await import(path.join(ROOT, 'web/js/api.js'));
    const sse = (lines) => ({ ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader() { let i = 0; const enc = new TextEncoder(); return { read: async () => i < lines.length ? { value: enc.encode('data: ' + JSON.stringify(lines[i++]) + '\n\n'), done: false } : { done: true } }; } } });
    let sent = null;
    global.fetch = async (url, init) => { sent = JSON.parse(init.body); return sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'python_run', arguments: '{"co' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'de":"1+1"}' } }] } }] }]); };
    const r = await api.chatTurn({ baseUrl: 'https://x.test/v1', apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'python_run', description: 'd', parameters: { type: 'object', properties: {} } }] });
    eq(r.toolCalls.length, 1); eq(r.toolCalls[0].function.name, 'python_run'); eq(JSON.parse(r.toolCalls[0].function.arguments).code, '1+1');
    eq(sent.tools[0].type, 'function');
    global.fetch = async (url, init) => { sent = JSON.parse(init.body); return sse([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'python_run' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"code":"2"}' } }]); };
    const r2 = await api.chatTurn({ baseUrl: 'https://api.anthropic.com/v1', format: 'anthropic', apiKey: 'k', model: 'claude-x', tools: [{ name: 'python_run', description: 'd', parameters: { type: 'object', properties: {} } }],
      messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'q' }, { role: 'assistant', content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'python_run', arguments: '{"code":"1"}' } }] }, { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' }] });
    eq(r2.toolCalls[0].id, 't1');
    eq(sent.tools[0].input_schema.type, 'object');
    eq(sent.messages[1].content[0].type, 'tool_use'); eq(sent.messages[2].content[0].type, 'tool_result');
    delete global.fetch;
  });

  await test('iPad 虚拟机脚本：串口协议、9p 启动参数与持久化', () => {
    const vm = read('web/js/linux-vm.js');
    assert(/aibroot=9p/.test(vm) && /serial0_send/.test(vm) && /indexedDB/.test(vm) && /TextDecoder/.test(vm));
    assert(/Linux 虚拟机正在启动…/.test(vm));
    const wf = read('.github/workflows/ipad-ipa.yml');
    assert(/linux-vm-x86/.test(wf), 'IPA 工作流应打包虚拟机镜像');
  });

  PY.stopAll();
};
