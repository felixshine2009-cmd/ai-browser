'use strict';
// iPad build (ipad-v2): the DESKTOP app ported to iPad. The payload (scripts/build-ipad-bundle.js) runs the desktop main
// process unchanged on the Electron API shim (ipad/node/electron) under Node 18 = nodejs-mobile, and every window / tab
// / overlay is a native web view of the host. Here the host is the simulator (ipad/sim, the Swift host protocol on
// Electron), so the whole iPad stack except Swift/WebKit itself is exercised on Linux CI:
//   bridge (loopback HTTP + SSE), schemes, IPC, preload runtime, views & layout, tabs, chat, tools, theme, downloads,
//   dialogs / menus, rotation / Split View sizes, llama.cpp kept (MLX only removed).
const { launchIpad } = require('../lib/ipad-sim');
const { sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer, createWebServer } = require('../lib/mock-server');
const { audit } = require('../lib/contrast');
const fs = require('fs'), os = require('os'), path = require('path');
const SHOTS = process.env.AIB_IPAD_SHOTS || path.join(__dirname, '..', '..', 'shots', 'ipad2');
const norm = (u) => String(u || '').replace(/\/(?=$|\?)/, '');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载');
  const llm = await createLlmServer();
  const web = await createWebServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipad-'));
  seedSettings(ud, Object.assign(apiSettings(llm.port), { onboarding: { completed: true, skipped: false, completedAt: 1 }, name: 'Felix' }));
  const app = await launchIpad({ userData: ud });
  const ch = await app.chrome();
  const shot = (n) => app.screenshot(path.join(SHOTS, n + '.png')).catch(e => console.log('screenshot', e.message));
  const tabs = () => app.invoke('tabs:state');
  const open = async (url) => {
    await app.invoke('nav:openUrl', url);
    return until(() => app.ctx.pages().find(p => norm(p.url()) === norm(url)), 15000, 'open ' + url);
  };

  await test('启动：Node 18 主进程 + 原生视图；chrome / 首页是桌面版页面（aib 桥、触控样式）', async () => {
    const st = await app.state();
    const win = st.views.filter(v => v.kind === 'window'); eq(win.length, 1, 'one window web view');
    assert(st.views.some(v => v.kind === 'view' && v.attached && v.visible && norm(v.url) === 'aibrowser://home'), 'home tab view attached: ' + JSON.stringify(st.views));
    const home = await app.waitPage(u => u.startsWith('aibrowser://home'));
    await home.waitForLoadState('domcontentloaded').catch(() => {});
    const info = await home.evaluate(() => ({ ipad: document.documentElement.classList.contains('aib-ipad'), aib: !!(window.aib && window.aib.ipad), css: !!document.getElementById('aib-ipad-css'), vp: (document.querySelector('meta[name=viewport]') || {}).content || '' }));
    assert(info.ipad && info.aib && info.css && /device-width/.test(info.vp), JSON.stringify(info));
    const about = await app.invoke('app:info').catch(() => null);
    if (about) assert(about.ipad || /iPad|darwin/.test(JSON.stringify(about)), JSON.stringify(about));
    assert(app.logs.join('').includes('node v18'), 'Node 18 runtime');
    await shot('01-home');
  });

  await test('首页布局与桌面版相同（同一 home.html：问候语、输入框、模型选择、Chat/Task、工具图标、数学键盘）', async () => {
    const home = await app.waitPage(u => u.startsWith('aibrowser://home'));
    const desktopHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'src/renderer/pages/home.html'), 'utf8');
    const ids = Array.from(desktopHtml.matchAll(/id="([\w-]+)"/g)).map(m => m[1]);
    const missing = await home.evaluate((ids) => ids.filter(i => !document.getElementById(i)), ids);
    eq(missing, [], 'desktop home elements present on iPad');
    eq(await home.locator('#greet').innerText(), 'Felix，请问需要什么帮助？');
    const chromeHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'src/renderer/pages/chrome.html'), 'utf8');
    const cids = Array.from(chromeHtml.matchAll(/id="([\w-]+)"/g)).map(m => m[1]);
    eq(await ch.evaluate((ids) => ids.filter(i => !document.getElementById(i)), cids), [], 'desktop chrome (tab bar / toolbar) elements present');
    // touch targets: toolbar buttons >= 40pt
    const small = await ch.evaluate(() => Array.from(document.querySelectorAll('.tb-btn')).filter(b => b.offsetParent && b.getBoundingClientRect().height < 40).length);
    eq(small, 0, 'toolbar buttons are touch-sized');
  });

  await test('标签页：网页加载、标题、后退/前进、新建/切换/关闭（原生视图按桌面布局摆放）', async () => {
    const url = `http://127.0.0.1:${web.port}/page/1`;
    await app.submit(url);
    await until(async () => (await tabs()).tabs.some(t => t.active && t.url.startsWith(url) && t.title && t.title !== url), 15000, 'web page title');
    const v = await until(async () => (await app.state()).views.find(x => x.url.startsWith(url) && x.attached && x.visible), 5000, 'web view shown');
    assert(v.bounds.y >= 80 && v.bounds.width === app.size[0], 'content below the 88pt chrome: ' + JSON.stringify(v.bounds));
    await shot('02-web-page');
    await app.submit(`http://127.0.0.1:${web.port}/page/2`);
    await until(async () => (await tabs()).tabs.find(t => t.active).url.includes('/page/2'), 10000, 'page 2');
    await ch.click('#back'); await until(async () => (await tabs()).tabs.find(t => t.active).url.includes('/page/1'), 10000, 'back');
    await ch.click('#fwd'); await until(async () => (await tabs()).tabs.find(t => t.active).url.includes('/page/2'), 10000, 'forward');
    const n0 = (await tabs()).tabs.length;
    await app.invoke('tab:new'); await until(async () => (await tabs()).tabs.length === n0 + 1, 5000, 'new tab');
    const t2 = (await tabs()).tabs; const first = t2[0];
    await app.invoke('tab:activate', first.id); await until(async () => (await tabs()).tabs.find(t => t.active).id === first.id, 5000, 'switch');
    const last = t2[t2.length - 1]; await app.invoke('tab:close', last.id); await until(async () => (await tabs()).tabs.length === n0, 5000, 'close');
  });

  await test('Chat：提问 → 流式回答（与桌面版同一 chat 页面与 AI 后端）', async () => {
    await app.invoke('nav:openUrl', 'aibrowser://home'); await sleep(500);
    await ch.click('#modeseg [data-mode="chat"]').catch(() => {});
    await app.submit('你好，请介绍一下你自己？');
    const cp = await app.waitPage(u => u.startsWith('aibrowser://chat'), 15000);
    await until(async () => (await cp.locator('body').innerText()).includes('这是一个直接回答'), 20000, 'answer');
    await sleep(400); await shot('03-chat');
  });

  await test('Python（内置 Pyodide，隐藏 web 视图内核）：AI 调用 python_run → sympy / numpy 结果', async () => {
    const bundle = process.env.AIB_IPAD_BUNDLE || '';
    if (!bundle || !fs.existsSync(path.join(bundle, 'pyodide', 'pyodide.mjs'))) return console.log('    (跳过：负载中没有 Pyodide，先运行 scripts/fetch-ipad-pyodide.js)');
    llm.state.script = ({ system, tools, toolMsgs }) => {
      if (!/web-research agent/.test(system) || !tools.includes('python_run')) return null;
      if (!toolMsgs.length) return { toolCalls: [{ name: 'python_run', args: { code: 'import sympy as sp, numpy as np\nx=sp.symbols("x")\nprint(sp.integrate(sp.sin(x)**2,(x,0,sp.pi)), int(np.arange(101).sum()))' } }] };
      return { text: 'PYRESULT ' + String(toolMsgs[0].content).slice(0, 300) };
    };
    try {
      await app.invoke('nav:openUrl', 'aibrowser://home'); await sleep(500);
      await app.submit('用 Python 算一下 sin(x)^2 在 0 到 pi 的积分，以及 0..100 的和');
      const chats = () => app.ctx.pages().filter(p => p.url().startsWith('aibrowser://chat'));
      const text = async () => { let t = ''; for (const p of chats()) t += '\n' + await p.locator('body').innerText().catch(() => ''); return t; };
      try { await until(async () => /PYRESULT[\s\S]*pi\/2 5050/.test(await text()), 180000, 'python result'); }
      catch (e) { console.log('    chat:', (await text()).slice(-1500)); console.log('    llm tool msgs:', JSON.stringify(llm.requests.slice(-3).map(r => (r.messages || []).filter(m => m.role === 'tool').map(m => String(m.content).slice(0, 300))))); throw e; }
      await sleep(400); await shot('12-python');
    } finally { llm.state.script = null; }
  }, { timeout: 200000 });

  await test('Linux 虚拟机（内置 v86 + Alpine，隐藏 web 视图）：AI 调用 vm_shell → root shell 输出', async () => {
    const bundle = process.env.AIB_IPAD_BUNDLE || '';
    if (!bundle || !fs.existsSync(path.join(bundle, 'vm'))) return console.log('    (跳过：负载中没有 VM 镜像)');
    llm.state.script = ({ system, tools, toolMsgs }) => {
      if (!/web-research agent/.test(system) || !tools.includes('vm_shell')) return null;
      if (!toolMsgs.length) return { toolCalls: [{ name: 'vm_shell', args: { command: 'echo VM-$(id -u)-$(uname -s); cat /etc/alpine-release >/dev/null && echo ALPINE' } }] };
      return { text: 'VMRESULT ' + String(toolMsgs[0].content).slice(0, 400) };
    };
    try {
      await app.invoke('nav:openUrl', 'aibrowser://home'); await sleep(500);
      await app.submit('在你的 Linux 虚拟机里运行 id 和 uname');
      const chats = () => app.ctx.pages().filter(p => p.url().startsWith('aibrowser://chat'));
      const text = async () => { let t = ''; for (const p of chats()) t += '\n' + await p.locator('body').innerText().catch(() => ''); return t; };
      try { await until(async () => /VMRESULT[\s\S]*VM-0-Linux[\s\S]*ALPINE/.test(await text()), 420000, 'vm result', 1000); }
      catch (e) { console.log('    chat:', (await text()).slice(-1500)); throw e; }
      await sleep(400); await shot('13-vm-shell');
    } finally { llm.state.script = null; }
  }, { timeout: 450000 });

  if (process.env.AIB_IPAD_BUNDLE && fs.existsSync(path.join(process.env.AIB_IPAD_BUNDLE, 'vm'))) {
    // Codex-style VM tools on the iPad VM (v86, no network: packages are fetched by the app)
    await require('../lib/vm-tools-check')({ test, assert, eq }, (n, a) => app.tool(n, a), { network: false, timeout: 400000, tag: 'iPad 虚拟机 · ' });
    if (!process.env.AIB_NO_NET) await test('iPad 虚拟机 · vm_pkg install：应用代为下载 Alpine 软件包（虚拟机内无网络）并在重启后恢复', async () => {
      const i = await app.tool('vm_pkg', { action: 'install', packages: ['jq'] });
      assert(i.ok && i.installed.some(x => /^jq-/.test(x)), JSON.stringify(i).slice(0, 600));
      const j = await app.tool('vm_shell', { command: `echo '{"a":[1,2,3]}' | jq '.a | add'` }); eq(j.stdout.trim(), '6');
      await app.tool('vm_control', { action: 'restart' });
      const k = await app.tool('vm_shell', { command: 'command -v jq' }); eq(k.exitCode, 0, 'jq restored after restart');
    }, { timeout: 600000 });
  }

  await test('工具页（解题 / 词典 / 维基 / 物理 / GeoGebra）、历史、下载、书签、拓展、设置都能打开', async () => {
    const urls = ['aibrowser://tool?id=solve', 'aibrowser://tool?id=dict', 'aibrowser://tool?id=wiki', 'aibrowser://tool?id=physics', 'aibrowser://history', 'aibrowser://downloads', 'aibrowser://bookmarks', 'aibrowser://extensions', 'aibrowser://settings'];
    let i = 4;
    for (const u of urls) {
      const p = await open(u); await sleep(700);
      const txt = await p.evaluate(() => document.body.innerText.length);
      assert(txt > 8, u + ' rendered text ' + txt);
      if (/solve|physics|settings|extensions/.test(u)) await shot(String(i++).padStart(2, '0') + '-' + u.replace(/^aibrowser:\/\/(tool\?id=)?/, ''));
    }
  });

  await test('外观：浅色 / 深色 / 跟随系统 → 原生 overrideUserInterfaceStyle（theme.set）+ 所有页面立即切换 + 对比度', async () => {
    const sp = await open('aibrowser://settings'); await sp.click('[data-nav="general"]'); await sleep(300);
    await sp.click('#thmode [data-mode="light"]');
    await until(async () => (await app.state()).themeSource === 'light', 5000, 'native theme.set light');
    for (const p of [ch, sp]) await until(() => p.evaluate(() => document.documentElement.dataset.scheme === 'light'), 5000, 'page light');
    const r = await audit(sp); eq(r.bad, [], 'settings light contrast');
    const rc = await audit(ch); eq(rc.bad, [], 'chrome light contrast');
    await sleep(500); await shot('09-settings-light');
    const home = await open('aibrowser://home'); await sleep(400); eq((await audit(home)).bad, [], 'home light contrast');
    await shot('10-home-light');
    await app.invoke('nav:openUrl', 'aibrowser://settings'); await sleep(300);
    await sp.click('#thmode [data-mode="system"]');
    await until(async () => (await app.state()).themeSource === 'system', 5000, 'native theme.set system');
    // the OS appearance reaches the web views as prefers-color-scheme (WKWebView follows the window's trait collection)
    for (const s of ['light', 'dark']) { for (const p of [ch, sp]) await p.emulateMedia({ colorScheme: s }); await until(() => sp.evaluate((s) => document.documentElement.dataset.scheme === s, s), 5000, 'follow ' + s); }
    for (const p of [ch, sp]) await p.emulateMedia({ colorScheme: null });
    // and to Node (nativeTheme.shouldUseDarkColors) through the host's 'theme' event
    await app.event({ type: 'theme', dark: false }); await sleep(200);
    const s = await app.invoke('settings:get'); assert(s.appearance.mode === 'system', JSON.stringify(s.appearance));
    await sp.click('#thmode [data-mode="dark"]'); await until(async () => (await app.state()).themeSource === 'dark', 5000, 'dark');
  });

  await test('旋转 / 分屏：窗口尺寸变化后 chrome 与标签视图重新布局', async () => {
    await app.invoke('nav:openUrl', 'aibrowser://home'); await sleep(300);
    await app.resize(820, 1180 > 900 ? 860 : 1180); await sleep(800);
    const st = await app.state(); const v = st.views.find(x => x.kind === 'view' && x.visible && x.attached);
    eq(v.bounds.width, 820, 'tab view follows the new width');
    const cw = await ch.evaluate(() => innerWidth); eq(cw, 820);
    await shot('11-portrait');
    await app.resize(1180, 820); await sleep(600);
  });

  await test('下载：网页附件保存到“文件”App 的 AI浏览器/Downloads，下载页列出', async () => {
    await app.submit(`http://127.0.0.1:${web.port}/download.bin`);
    const f = path.join(app.documents, 'Downloads', 'test-file.bin');
    await until(() => fs.existsSync(f) && fs.statSync(f).size === 2048, 15000, 'downloaded file');
    const dp = await open('aibrowser://downloads'); await until(async () => (await dp.locator('body').innerText()).includes('test-file.bin'), 8000, 'listed');
  });

  await test('本地模型：llama.cpp 保留（原生 Metal），只有 MLX 被移除', async () => {
    const sp = await open('aibrowser://settings'); await sp.click('[data-nav="ai"]'); await sleep(500);
    const txt = await sp.locator('body').innerText();
    assert(/llama|GGUF|本地/i.test(txt), 'llama.cpp / local model UI present');
    const src = fs.readFileSync(path.join(process.env.AIB_IPAD_BUNDLE || path.join(__dirname, '..', '..', 'dist', 'ipad-bundle'), 'nodejs-project/src/main/ai/mlx.js'), 'utf8');
    assert(/platformOk\(\) \{ return false; \}/.test(src), 'MLX disabled in the iPad payload');
    assert(fs.existsSync(path.join(process.env.AIB_IPAD_BUNDLE || path.join(__dirname, '..', '..', 'dist', 'ipad-bundle'), 'nodejs-project/node_modules/node-llama-cpp/index.js')), 'llama.cpp bridge present');
  });

  await test('原生对话框 / 菜单走宿主（dialog.message、menu.popup、快捷键 menu.app）', async () => {
    const st = await app.state(); assert(st.appKeys > 10, 'hardware keyboard shortcuts registered: ' + st.appKeys);
    const log = await app.cmds(); const names = new Set(log.map(c => c.cmd));
    for (const c of ['wc.create', 'window.attach', 'view.attach', 'view.bounds', 'view.visible', 'wc.load', 'wc.send', 'theme.set', 'menu.app']) assert(names.has(c), 'host received ' + c);
  });

  await test('启动诊断：Node 无 JIT 运行（与 iPad 相同），日志写入 Documents/日志，主窗口显示后通知原生层', async () => {
    const st = await app.state();
    assert(st.windowShown > 0, 'window shown reported');
    eq(st.diag.filter(d => d.fatal).length, 0, 'no fatal startup report: ' + JSON.stringify(st.diag).slice(0, 400));
    const log = fs.readFileSync(path.join(app.documents, '日志', 'node.log'), 'utf8');
    assert(/webassembly: polywasm \(no JIT\)/.test(log), 'Node runs jitless with the WebAssembly polyfill');
    assert(/main loaded in \d+ ms/.test(log) && /window shown/.test(log), log.slice(-600));
  });

  await app.close(); llm.close && llm.close(); web.close && web.close();

  await test('启动诊断：main.js 加载失败时立即报告原生层（诊断面板），日志可在“文件”App 中查看', async () => {
    const bad = await launchIpad({ waitHome: false, env: { AIB_SIM_FAIL_MAIN: '1' } });
    try {
      const d = await until(async () => { const s = await bad.state().catch(() => null); return s && s.diag.find(x => x.stage === 'main' && x.fatal); }, 30000, 'diagnostics event', 300);
      assert(/forced main\.js failure/.test(d.error), d.error.slice(0, 300));
      eq((await bad.state()).windowShown, 0, 'no window');
      const log = fs.readFileSync(path.join(bad.documents, '日志', 'node.log'), 'utf8');
      assert(/main failed to load/.test(log), log.slice(-600));
    } finally { await bad.close(); }
  }, { timeout: 60000 });
};
