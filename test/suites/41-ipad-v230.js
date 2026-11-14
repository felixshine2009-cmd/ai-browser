'use strict';
// iPad 2.3.0 features on the simulated host (Node side on the device-like Node when AIB_NODE is set):
// tool views instead of tabs (U1), thinking levels (U5), split view and spaces (F2), QR scanning (B6), 拍题即解 (F1),
// read later (F4), page assistant with cited passages (F3), code editor file manager (F5), custom system images (F6),
// formal Chinese labels (U9).
const { launchIpad } = require('../lib/ipad-sim');
const { seedSettings, apiSettings, sleep } = require('../lib/app');
const { createLlmServer, createWebServer } = require('../lib/mock-server');
const fs = require('fs'), os = require('os'), path = require('path');
const SHOTS = process.env.AIB_IPAD_SHOTS || path.join(__dirname, '..', '..', 'shots', 'ipad2');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像');
  const llm = await createLlmServer();
  const web = await createWebServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipad230-'));
  seedSettings(ud, Object.assign(apiSettings(llm.port), { onboarding: { completed: true, skipped: false, completedAt: 1 }, name: 'Felix' }));
  const app = await launchIpad({ userData: ud });
  const shot = (n) => app.screenshot(path.join(SHOTS, n + '.png')).catch(() => {});
  const st = () => app.invoke('tabs:state');
  const visibleViews = async () => (await app.state()).views.filter(v => v.kind === 'view' && v.attached && v.visible);
  try {
    await test('U1：打开工具直接显示工具界面，不新建标题为“tool”的网页标签', async () => {
      const before = (await st()).tabs.length;
      await app.invoke('tool:open', 'dict');
      const s = await until(async () => { const x = await st(); return x.activeTool === 'dict' ? x : null; }, 10000, 'dict tool active');
      eq(s.tabs.length, before, 'no new tab');
      assert(!s.tabs.some(t => /aibrowser:\/\/tool/.test(t.url) || t.title === 'tool'), JSON.stringify(s.tabs));
      assert(s.tools.some(t => t.id === 'dict' && t.name === '词典'), JSON.stringify(s.tools));
      const p = await app.waitPage(u => /aibrowser:\/\/tool\/?\?id=dict/.test(u));
      await p.waitForSelector('#w');
      eq(await p.title(), '词典');
      // second open of the same tool reuses the view
      await app.invoke('nav:openUrl', 'aibrowser://tool?id=dict');
      eq((await st()).tools.filter(t => t.id === 'dict').length, 1);
      // U2: the tool view fills the content area below the toolbar
      const v = (await visibleViews()).find(x => /tool\/?\?id=dict/.test(x.url));
      assert(v && v.bounds && v.bounds.width >= app.size[0] - 2, 'full width: ' + JSON.stringify(v && v.bounds));
      await shot('230-dict-tool');
      await app.invoke('tool:hide');
      assert(!(await st()).activeTool, 'hidden');
    });

    await test('U9：工具栏与首页标签均为正式中文（无 Chat / Search / Task / tool）', async () => {
      const c = await app.chrome();
      const txt = await c.evaluate(() => Array.from(document.querySelectorAll('#modeseg .seg, .ticon-label')).map(e => e.textContent.trim()));
      assert(txt.includes('对话') && txt.includes('搜索') && txt.includes('解题') && txt.includes('扫码'), JSON.stringify(txt));
      assert(!txt.some(t => /^(Chat|Search|Task|tool)$/i.test(t)), JSON.stringify(txt));
      const home = await app.waitPage(u => u.startsWith('aibrowser://home'));
      const ws = await home.evaluate(() => Array.from(document.querySelectorAll('#workswitch button')).map(b => b.textContent.trim()));
      eq(ws, ['对话', '任务']);
    });

    await test('U5：思考等级随模型提供；可设置并在各页面共用', async () => {
      const info = await app.invoke('models:thinking');
      assert(info && 'supported' in info && info.labels, JSON.stringify(info));
      const r = await app.invoke('models:setThinking', 'high');
      eq((await app.invoke('settings:get')).thinkingLevel, 'high', JSON.stringify(r));
    });

    await test('F2：分屏两个标签并排显示，可调比例与交换；空间按学科分组', async () => {
      await app.invoke('nav:openUrl', `http://127.0.0.1:${web.port}/page/a`);
      await sleep(800);
      const on = await app.invoke('split:toggle');
      eq(on, true);
      const s = await st();
      assert(s.split && !s.split.hidden, JSON.stringify(s.split));
      const vis = await until(async () => { const v = await visibleViews(); return v.length >= 2 ? v : null; }, 5000, 'two views');
      const xs = vis.map(v => v.bounds.x).sort((a, b) => a - b);
      assert(xs[0] === 0 && xs[1] > 200, JSON.stringify(vis.map(v => v.bounds)));
      await app.invoke('split:ratio', 0.3);
      eq((await st()).split.ratio, 0.3);
      await shot('230-split');
      eq(await app.invoke('split:toggle'), false);
      eq((await visibleViews()).length, 1);
      const sp = await app.invoke('space:add', '数学');
      assert(sp && sp.name === '数学', JSON.stringify(sp));
      const s2 = await st();
      assert(s2.spaces.find(x => x.name === '数学').active, JSON.stringify(s2.spaces));
      eq(s2.tabs.length, 1, 'new space starts with one tab');
      await app.invoke('space:switch', 'main');
      assert((await st()).tabs.length >= 2, 'main space keeps its tabs');
      eq(await app.invoke('space:remove', sp.id), true);
    });

    await test('B6：扫码使用原生相机扫描；网址直接打开', async () => {
      await app.native({ qrText: `http://127.0.0.1:${web.port}/page/qr` });
      const r = await app.invoke('scan:qr');
      assert(r.ok && r.opened, JSON.stringify(r));
      await until(async () => (await st()).tabs.some(t => /\/page\/qr/.test(t.url)), 10000, 'qr page opened');
      await app.native({ qrText: 'WIFI:S:test;;' });
      const r2 = await app.invoke('scan:qr');
      assert(r2.ok && !r2.opened && r2.text === 'WIFI:S:test;;', JSON.stringify(r2));
    });

    await test('F1：拍题即解：相机拍摄 → 文字识别 → 解题工具自动提交，回答以对话样式显示', async () => {
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      await app.native({ cameraImage: { b64: png, w: 1, h: 1, mime: 'image/png', text: '求 x^2 = 4 的解' } });
      const r = await app.invoke('snap:solve');
      assert(r.ok && r.chars > 0, JSON.stringify(r));
      const p = await app.waitPage(u => /aibrowser:\/\/chat\/?\?sid=.*tool=solve/.test(u), 20000);
      await p.waitForLoadState('domcontentloaded');
      eq((await st()).activeTool, 'solve');
      await shot('230-snap-solve');
    });

    await test('F4：稍后阅读：保存离线副本（网页归档），列表与检索，离线打开', async () => {
      await app.invoke('tool:hide');
      await app.invoke('nav:openUrl', `http://127.0.0.1:${web.port}/page/readme`);
      await sleep(1000);
      const e = await app.invoke('readlater:save');
      assert(e && e.id && e.title, JSON.stringify(e));
      const l = await app.invoke('readlater:list');
      assert(l.some(x => x.id === e.id), JSON.stringify(l));
      eq(await app.invoke('readlater:open', e.id), true);
      await app.invoke('tool:open', 'readlater');
      const p = await app.waitPage(u => u.startsWith('aibrowser://readlater'));
      await p.waitForSelector('.rl-item');
      eq(await p.title(), '稍后阅读');
      await shot('230-readlater');
      await app.invoke('tool:hide');
    });

    await test('F3：页面助手一键摘要，回答附原文段落编号', async () => {
      await app.invoke('nav:openUrl', `http://127.0.0.1:${web.port}/page/summary`);
      await sleep(1000);
      const r = await app.invoke('siri:ask', 'summary', '');
      assert(r && typeof r.text === 'string' && r.text.length > 0 && r.passages > 0, JSON.stringify(r).slice(0, 300));
    });

    await test('F5：代码编辑器：新建、写入、读取、重命名、删除文件，路径限制在根目录内', async () => {
      const roots = await app.invoke('code:roots');
      assert(roots.some(r => r.id === 'code'), JSON.stringify(roots));
      await app.invoke('code:write', 'code', 'hello.py', 'print(1+1)\n');
      eq((await app.invoke('code:read', 'code', 'hello.py')).text, 'print(1+1)\n');
      await app.invoke('code:rename', 'code', 'hello.py', 'main.py');
      assert((await app.invoke('code:list', 'code', '')).items.some(i => i.name === 'main.py'));
      let refused = false; try { await app.invoke('code:read', 'code', '../settings.json'); } catch { refused = true; }
      assert(refused, 'path escape refused');
      await app.invoke('tool:open', 'code');
      const p = await app.waitPage(u => u.startsWith('aibrowser://code'));
      await p.waitForSelector('.code-root');
      await shot('230-code');
      await app.invoke('code:delete', 'code', 'main.py');
      await app.invoke('tool:hide');
    });

    await test('2.3.1：每个导入入口都经过原生“文件”选择流程（词典文件与文件夹、ZIM、系统镜像、模型、资料、拓展、密码 CSV、照片），临时副本导入后清理', async () => {
      const fxd = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-uif-'));
      require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'ipad', 'UITests', 'make-fixtures.js'), fxd]);
      const F = (n) => path.join(fxd, 'files', n);
      const rpc = (name, a) => app.invoke('ext:rpc', 'aib.dictionary', name, a || {});
      const pickedRoot = path.join(os.tmpdir(), 'aib-sim-picked', 'picked');
      const opened = async (expectProps) => { const s = await app.state(); assert(s.lastOpen && expectProps.every(p => s.lastOpen.properties.includes(p)), JSON.stringify(s.lastOpen)); return s.lastOpen; };
      const before = (await rpc('list')).length;
      // dictionary: files (.mdx with its .mdd and style picked together)
      await app.openPaths([F('test.mdx'), F('test.mdd'), F('test.css'), F('logo.png')]);
      let r = await rpc('pickAndAdd');
      assert(r.added.length === 1 && !r.errors.length, JSON.stringify(r));
      const lo = await opened(['openFile', 'openDirectory']);
      assert(lo.filters[0].extensions.includes('mdx') && lo.filters[0].extensions.includes('mdd'), JSON.stringify(lo));
      // dictionary: a whole folder
      await app.openPaths([path.join(fxd, 'dictfolder', '测试词典包')]);
      r = await rpc('pickAndAdd');
      assert(r.added.length === 1 && !r.errors.length, JSON.stringify(r));
      const l = await rpc('list');
      eq(l.length, before + 2);
      const hits = await rpc('lookup', { word: 'abandon' });
      assert(hits.length >= 2, JSON.stringify(hits).slice(0, 300));
      for (const d of l.slice(before)) await rpc('remove', { id: d.id });
      // a folder without dictionaries is reported, not ignored
      await app.openPaths([path.join(fxd, 'files')].map(p => { const e = path.join(fxd, 'empty'); fs.mkdirSync(e, { recursive: true }); fs.writeFileSync(path.join(e, 'a.txt'), 'x'); return e; }));
      r = await rpc('pickAndAdd');
      assert(r.errors.length === 1 && /没有 .mdx/.test(r.errors[0]), JSON.stringify(r));
      // ZIM
      await app.openPaths([F('small.zim')]);
      r = await app.invoke('wiki:openZim');
      assert(r && !r.cancelled && r.open, JSON.stringify(r));
      await opened(['openFile']);
      // custom system image
      await app.openPaths([F('disk.img')]);
      r = await app.invoke('vmimg:import');
      assert(r.ok, JSON.stringify(r));
      await app.invoke('vmimg:remove', r.image.id);
      // local model file
      await app.openPaths([F('model.gguf')]);
      r = await app.invoke('lm:pick');
      assert(typeof r === 'string' && r.endsWith('model.gguf'), JSON.stringify(r));
      // knowledge base text file
      await app.openPaths([F('notes.txt')]);
      r = await app.invoke('kb:addFiles');
      assert(r.ok && r.results.length === 1 && /notes\.txt$/.test(r.results[0].file), JSON.stringify(r).slice(0, 300)); // embedding needs llama.cpp (device only)
      // feature extension package
      await app.openPaths([F('extension.zip')]);
      r = await app.invoke('ext:installZip');
      assert(r && r.id, JSON.stringify(r));
      await app.invoke('ext:uninstall', r.id);
      // password CSV
      await app.openPaths([F('passwords.csv')]);
      r = await app.invoke('pw:import');
      assert(r && typeof r.added === 'number', JSON.stringify(r));
      // cancelling the picker returns nothing and does not throw
      r = await app.invoke('wiki:openZim');
      assert(r && r.cancelled, JSON.stringify(r));
      // photo for 拍题 (system photo picker on the device)
      r = await app.invoke('camera:capture', { source: 'library' });
      assert(r && (r.cancelled || /^data:image/.test(r.dataUrl || '')), JSON.stringify(r).slice(0, 200));
      // dictionary copies taken from Files are removed after import
      const left = fs.existsSync(pickedRoot) ? fs.readdirSync(pickedRoot).filter(n => fs.readdirSync(path.join(pickedRoot, n)).some(x => /\.md[xd]$/.test(x) || x === '测试词典包')) : [];
      eq(left.length, 0, 'dictionary copies removed: ' + left.join(','));
      eq((await app.state()).opens >= 9, true);
    });

    await test('F6：自定义系统镜像：导入 IMG（原始格式）与 QCOW2（转换），iPad 以 v86 启动', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-img-'));
      // a boot sector that prints AIB-BOOT-OK through the BIOS (int 10h, teletype)
      const code = [0x31, 0xDB, 0xBE, 0x13, 0x7C, 0xB4, 0x0E, 0xAC, 0x84, 0xC0, 0x74, 0x04, 0xCD, 0x10, 0xEB, 0xF7, 0xF4, 0xEB, 0xFD];
      const raw = path.join(dir, 'disk.img'); const b = Buffer.alloc(1024 * 1024); Buffer.from(code).copy(b, 0); Buffer.from('AIB-BOOT-OK\0', 'latin1').copy(b, code.length); b[510] = 0x55; b[511] = 0xaa; fs.writeFileSync(raw, b);
      await app.openPaths([raw]).catch(() => {});
      const r = await app.invoke('vmimg:import');
      assert(r.ok && r.image && r.image.kind === 'disk', JSON.stringify(r));
      const l = await app.invoke('vmimg:list');
      assert(l.engines.v86 && l.images.length === 1, JSON.stringify(l));
      const s = await app.invoke('vmimg:start', r.image.id);
      eq(s.engine, 'v86'); assert(/aibres:\/\/data\/vm-images\/custom\//.test(s.config.hda.url), JSON.stringify(s));
      await app.invoke('vmimg:open');
      const p = await app.waitPage(u => u.startsWith('aibrowser://vmcustom'));
      const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
      await p.reload();
      await p.waitForSelector('.rl-item', { timeout: 15000 }).catch(async (e) => { throw new Error(e.message + ' errors: ' + errs.join(' | ') + ' html: ' + (await p.content()).slice(0, 600)); });
      eq(await p.title(), '自定义系统镜像');
      await shot('230-vmcustom');
      if (fs.existsSync(path.join(process.env.AIB_IPAD_BUNDLE || '', 'vm', 'libv86.js'))) {
        // boots for real on v86 in the page; the disk is read through HTTP Range requests
        await p.click(`[data-start="${r.image.id}"]`);
        await p.waitForFunction(() => /AIB-BOOT-OK/.test(document.getElementById('screen').innerText), null, { timeout: 60000 });
        await shot('230-vmcustom-boot');
        await p.click('#stop');
      } else console.log('    (跳过启动：负载中没有 v86)');
      eq(await app.invoke('vmimg:remove', r.image.id), true);
    });
  } finally {
    await app.close(); llm.close && llm.close(); web.close && web.close();
  }
};
