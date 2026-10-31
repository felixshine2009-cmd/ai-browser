'use strict';
const { launch, sleep, seedSettings, apiSettings, patchSettings } = require('../lib/app');
const { createWebServer, createLlmServer } = require('../lib/mock-server');
const R = require('../../src/main/ext/features');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const AdmZip = require('adm-zip');
const FIX = path.join(__dirname, '..', 'fixtures');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写');
  const llm = await createLlmServer(); const web = await createWebServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ext-'));
  seedSettings(ud, apiSettings(llm.port));
  const pickFile = path.join(ud, 'pick.json');
  const app = await launch({ userData: ud, env: { AIB_TEST_PICK_FILE: pickFile } });
  const ch = await app.chrome();
  const inv = (...a) => ch.evaluate((a) => window.aib.invoke(...a), a);
  const ask = async (text) => { await app.setMode('chat'); await app.submit(text); await sleep(200); return app.waitPage(u => u.startsWith('aibrowser://chat')); };
  const extPage = async () => { await app.submit('aibrowser://extensions'); const p = await app.waitPage('aibrowser://extensions'); await until(async () => (await p.locator('.ext-card').count()) >= 2, 8000, 'cards'); return p; };

  await test('清单校验：标准 v1 必填项 / 非法权限 / 非法 entry 被拒绝（单元）', () => {
    const good = JSON.parse(fs.readFileSync(path.join(FIX, 'feature-ext-sample', 'manifest.json'), 'utf8'));
    eq(R.validateManifest(good), []);
    assert(R.validateManifest({ ...good, id: 'X' }).length, 'bad id');
    assert(R.validateManifest({ ...good, version: '1' }).length, 'bad version');
    assert(R.validateManifest({ ...good, permissions: ['root'] }).length, 'bad perm');
    assert(R.validateManifest({ ...good, entry: '../evil.js' }).length, 'bad entry');
    assert(R.validateManifest({ ...good, standard: 'x' }).length, 'bad standard');
    assert(R.validateManifest({ ...good, contributes: { tools: [{ name: 'Bad Name' }] } }).length, 'bad tool');
  });
  await test('拓展页：两个分类，预装 词典 / GeoGebra 绘图（内置，可开关，有检查更新）', async () => {
    const p = await extPage();
    const heads = await p.locator('.ext-sec-title span:first-child').allInnerTexts();
    eq(heads, ['功能拓展', '普通浏览器拓展']);
    const names = await p.locator('#feats .ext-card .name').allInnerTexts();
    assert(names.some(n => n.startsWith('词典')) && names.some(n => n.startsWith('GeoGebra')), names.join('|'));
    assert((await p.locator('#feats .ext-card .btn-update[data-act="update"]').count()) >= 2);
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '07-extensions.png'));
  });
  await test('从文件夹加载功能拓展（按标准）并生效：输入处理器 + AI 工具', async () => {
    fs.writeFileSync(pickFile, JSON.stringify([path.join(FIX, 'feature-ext-sample')]));
    const p = await extPage();
    await p.click('#loadfeat');
    await until(async () => (await p.locator('.ext-card[data-ext="user.sample-echo"]').count()) === 1, 8000, 'card for sample ext');
    const q = await ask('zzyzx');
    await until(async () => (await q.locator('.dict-body').count()) >= 1 && (await q.locator('.dict-body').innerText()).includes('sample-echo v1.0.0 handled zzyzx'), 10000, 'handler output');
    const r = await inv('ext:rpc', 'user.sample-echo', 'store', { v: 42 }); eq(r, 42);
    eq(await inv('ext:rpc', 'user.sample-echo', 'read', {}), 42);
  });
  await test('LLM 工具调用经功能拓展提供的工具（sample_echo）', async () => {
    const p = await ask('请 echo 一下 hello-tool');
    await until(async () => (await p.locator('.tool-chip').count()) === 1, 20000, 'tool chip');
    assert((await p.locator('.tool-chip').innerText()).startsWith('sample_echo('));
    const reqs = await (await fetch(`http://127.0.0.1:${llm.port}/__requests`)).json();
    const last = reqs.filter(r => (r.tools || []).includes('sample_echo')).pop();
    assert(last, 'tool offered'); 
    const toolMsg = reqs.filter(r => JSON.stringify(r.messages).includes('hello-tool')).pop();
    assert(toolMsg && toolMsg.messages.some(m => m.role === 'tool' && String(m.content).includes('"echoed":"hello-tool"')), 'tool result passed back to LLM');
  });
  await test('沙箱运行时：无 process/require、eval 被禁、未授权 net 被拒、存储隔离', async () => {
    const r = await inv('ext:rpc', 'user.sample-echo', 'probe', {});
    eq([r.process, r.require], ['undefined', 'undefined']);
    assert(/缺少权限 net/.test(r.netError || ''), JSON.stringify(r));
    eq(r.evalBlocked, 'blocked');
  });
  await test('停用 / 启用功能拓展：停用后处理器与工具消失', async () => {
    await inv('ext:setEnabled', 'user.sample-echo', false);
    const q = await ask('zzyzx');
    await until(async () => (await q.locator('.chat-error, .ai-note').count()) >= 1, 15000, 'falls back to AI after disabling');
    assert(!(await q.locator('.dict-body').allInnerTexts()).join('').includes('sample-echo'));
    await inv('ext:setEnabled', 'user.sample-echo', true);
  });
  await test('独立升级：update_url → 检查更新 → 下载 zip → sha256 校验 → 版本升级到 1.1.0', async () => {
    // build v1.1.0 package
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-v2-'));
    const m = JSON.parse(fs.readFileSync(path.join(FIX, 'feature-ext-sample', 'manifest.json'), 'utf8')); m.version = '1.1.0'; m.update_url = `http://127.0.0.1:${web.port}/update.json`;
    const z = new AdmZip(); z.addFile('manifest.json', Buffer.from(JSON.stringify(m))); z.addFile('main.js', Buffer.from(fs.readFileSync(path.join(FIX, 'feature-ext-sample', 'main.js'), 'utf8').replace('v1.0.0', 'v1.1.0')));
    const buf = z.toBuffer(); web.server.zip = buf;
    web.server.updateInfo = { version: '1.1.0', zip_url: `http://127.0.0.1:${web.port}/ext-v2.zip`, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
    // v1.0.0 has empty update_url -> cannot update; install a copy with update_url first
    const m1 = { ...m, version: '1.0.0' }; const d1 = path.join(tmp, 'v1'); fs.mkdirSync(d1);
    fs.writeFileSync(path.join(d1, 'manifest.json'), JSON.stringify(m1)); fs.copyFileSync(path.join(FIX, 'feature-ext-sample', 'main.js'), path.join(d1, 'main.js'));
    fs.writeFileSync(pickFile, JSON.stringify([d1]));
    const p = await extPage(); await p.click('#loadfeat');
    await until(async () => (await p.locator('.ext-card[data-ext="user.sample-echo"] .ver').innerText()) === 'v1.0.0', 8000, 'v1.0.0 installed');
    await p.locator('.ext-card[data-ext="user.sample-echo"] [data-act="update"]').click();
    await until(async () => (await p.locator('.ext-card[data-ext="user.sample-echo"] .upd-msg').innerText()).includes('1.1.0'), 8000, 'new version found');
    await p.locator('.ext-card[data-ext="user.sample-echo"] [data-act="doupdate"]').click();
    await until(async () => (await p.locator('.ext-card[data-ext="user.sample-echo"] .ver').innerText()) === 'v1.1.0', 10000, 'upgraded');
    const q = await ask('zzyzx');
    await until(async () => (await q.locator('.dict-body').count()) >= 1 && (await q.locator('.dict-body').innerText()).includes('v1.1.0'), 10000, 'new code runs');
    // tampered package is rejected
    web.server.updateInfo = { ...web.server.updateInfo, version: '1.2.0', sha256: 'deadbeef' };
    let err = ''; try { await inv('ext:checkUpdate', 'user.sample-echo', true); } catch (e) { err = e.message; }
    assert(/sha256/.test(err), 'bad hash rejected: ' + err);
  }, { timeout: 90000 });
  await test('从 .zip 加载功能拓展', async () => {
    const z = new AdmZip(); const m = JSON.parse(fs.readFileSync(path.join(FIX, 'feature-ext-sample', 'manifest.json'), 'utf8')); m.id = 'user.zip-sample'; m.name = 'Zip Sample'; m.contributes.tools = []; m.contributes.inputHandlers = [];
    z.addFile('pkg/manifest.json', Buffer.from(JSON.stringify(m))); z.addFile('pkg/main.js', Buffer.from('module.exports={};'));
    const zp = path.join(ud, 'zip-sample.zip'); z.writeZip(zp);
    fs.writeFileSync(pickFile, JSON.stringify([zp]));
    const p = await extPage();
    await p.selectOption('#aikind', 'feature'); await p.click('#loadzip');
    await until(async () => (await p.locator('.ext-card[data-ext="user.zip-sample"]').count()) === 1, 8000, 'zip ext card');
    await p.locator('.ext-card[data-ext="user.zip-sample"] [data-act="remove"]').click();
    await until(async () => (await p.locator('.ext-card[data-ext="user.zip-sample"]').count()) === 0, 8000, 'removed');
  });
  await test('AI 编写拓展：描述需求 → 生成 → 预览代码 → 确认安装 → 生效', async () => {
    const p = await extPage();
    await p.fill('#aiprompt', '遇到单词 ping 时回复 pong'); await p.selectOption('#aikind', 'feature');
    await p.click('#aigen');
    await until(async () => (await p.locator('.modal').count()) === 1, 20000, 'preview modal');
    const txt = await p.locator('.modal').innerText();
    assert(txt.includes('manifest.json') && txt.includes('main.js') && txt.includes('pong from AI-written extension'), 'code visible in preview');
    assert(!(await p.locator('.ext-card[data-ext="user.ai-greeter"]').count()), 'not installed before confirmation');
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '07b-ai-plugin-preview.png'));
    await p.click('#minstall');
    await until(async () => (await p.locator('.ext-card[data-ext="user.ai-greeter"]').count()) === 1, 8000, 'installed after confirm');
    const q = await ask('ping');
    await until(async () => (await q.locator('.dict-body').count()) >= 1 && (await q.locator('.dict-body').innerText()).includes('pong from AI-written extension'), 10000, 'ai-written ext works');
  });
  await test('Chrome 拓展（MV3 解压文件夹）：内容脚本 + service worker + storage', async () => {
    fs.writeFileSync(pickFile, JSON.stringify([path.join(FIX, 'chrome-ext')]));
    const p = await extPage(); await p.click('details.adv-load summary'); await p.click('#loadchrome');
    await until(async () => (await p.locator('#chromes .ext-card').count()) === 1, 10000, 'chrome ext card');
    assert((await p.locator('#chromes .ext-card .name').innerText()).includes('Test MV3 Extension'));
    await app.setMode('search');
    await app.submit(`http://127.0.0.1:${web.port}/x`);
    const wp = await app.waitPage(`127.0.0.1:${web.port}/x`);
    await until(async () => (await wp.evaluate(() => document.documentElement.getAttribute('data-aib-test-ext'))) === 'content-ran', 10000, 'content script ran');
    const bg = await until(async () => wp.evaluate(() => document.documentElement.getAttribute('data-aib-test-bg')), 10000, 'bg reply attr');
    const st = await until(async () => wp.evaluate(() => document.documentElement.getAttribute('data-aib-test-storage')), 10000, 'storage attr');
    eq(st, 'ok', 'chrome.storage works in content script');
    eq(bg, 'bg-ok', 'service worker answered runtime message (MV3 background)');
  });
  await test('Chrome 拓展：重启后仍加载；停用后不再注入', async () => {
    await app.close(); await sleep(500);
    const a2 = await launch({ userData: ud, env: { AIB_TEST_PICK_FILE: pickFile } });
    await a2.setMode('search'); await a2.submit(`http://127.0.0.1:${web.port}/y`);
    const wp = await a2.waitPage(`127.0.0.1:${web.port}/y`);
    await until(async () => (await wp.evaluate(() => document.documentElement.getAttribute('data-aib-test-ext'))) === 'content-ran', 10000, 'content script after restart');
    const c2 = await a2.chrome();
    const list = await c2.evaluate(() => window.aib.invoke('cx:list'));
    await c2.evaluate((p) => window.aib.invoke('cx:setEnabled', p, false), list[0].path);
    await a2.submit(`http://127.0.0.1:${web.port}/z`);
    const wz = await a2.waitPage(`127.0.0.1:${web.port}/z`);
    await sleep(1500);
    eq(await wz.evaluate(() => document.documentElement.getAttribute('data-aib-test-ext')), null);
    await c2.evaluate((p) => window.aib.invoke('cx:remove', p), list[0].path);
    eq((await c2.evaluate(() => window.aib.invoke('cx:list'))).length, 0);
    await a2.close();
  }, { timeout: 90000 });
  await test('Chrome 拓展：.zip 与 .crx(含头部) 打包加载', async () => {
    const a3 = await launch({ userData: fs.mkdtempSync(path.join(os.tmpdir(), 'aib-cx-')), env: { AIB_TEST_PICK_FILE: pickFile } });
    const z = new AdmZip(); z.addLocalFolder(path.join(FIX, 'chrome-ext'));
    const zip = z.toBuffer();
    const zp = path.join(ud, 'cx.zip'); fs.writeFileSync(zp, zip);
    const hdr = Buffer.alloc(12); hdr.write('Cr24', 0); hdr.writeUInt32LE(3, 4); hdr.writeUInt32LE(0, 8);
    const cp = path.join(ud, 'cx.crx'); fs.writeFileSync(cp, Buffer.concat([hdr, zip]));
    const c3 = await a3.chrome();
    for (const f of [zp, cp]) {
      fs.writeFileSync(pickFile, JSON.stringify([f]));
      const r = await c3.evaluate(() => window.aib.invoke('cx:add'));
      assert(r && r.name === 'Test MV3 Extension' && r.version === '1.2.3', f + ' ' + JSON.stringify(r));
    }
    eq((await c3.evaluate(() => window.aib.invoke('cx:list'))).length, 2);
    await a3.close();
  }, { timeout: 60000 });
  await test('AI 编写 Chrome 拓展：生成 → 预览 → 安装 → 内容脚本生效', async () => {
    const a4 = await launch({ userData: (() => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-cx2-')); seedSettings(d, apiSettings(llm.port)); return d; })() });
    await a4.submit('aibrowser://extensions'); const p = await a4.waitPage('aibrowser://extensions');
    await until(async () => (await p.locator('.ext-card').count()) >= 2, 8000);
    await p.fill('#aiprompt', '给所有本地页面加标记'); await p.selectOption('#aikind', 'chrome'); await p.click('#aigen');
    await until(async () => (await p.locator('.modal').count()) === 1, 20000, 'preview');
    assert((await p.locator('.modal').innerText()).includes('data-ai-chrome-ext'));
    await p.click('#minstall');
    await until(async () => (await p.locator('#chromes .ext-card').count()) === 1, 10000, 'installed');
    await a4.setMode('search'); await a4.submit(`http://127.0.0.1:${web.port}/q`);
    const wp = await a4.waitPage(`127.0.0.1:${web.port}/q`);
    await until(async () => (await wp.evaluate(() => document.documentElement.getAttribute('data-ai-chrome-ext'))) === 'yes', 10000, 'ai chrome ext applied');
    await a4.close();
  }, { timeout: 90000 });
  await app.close().catch(() => {}); await llm.close(); await web.close();
};
