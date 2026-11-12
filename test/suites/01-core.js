'use strict';
const { launch, sleep, seedSettings, apiSettings, patchSettings } = require('../lib/app');
const { createWebServer } = require('../lib/mock-server');
const fs = require('fs');
const path = require('path');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('核心：启动 / 标签页 / 搜索 / 设置');
  const web = await createWebServer();
  let app;
  await test('应用启动无错误（chrome 窗口 + 首页）', async () => {
    app = await launch();
    const ch = await app.chrome();
    await until(async () => (await app.tabsState()).tabs.length === 1, 10000, 'one tab');
    const home = await app.waitPage('aibrowser://home');
    assert(await home.locator('#greet').innerText() === 'Felix，请问需要什么帮助？', 'greeting');
    assert(await home.locator('#q').getAttribute('placeholder') === '请输入问题', 'placeholder');
    const bad = app.logs.join('').split('\n').filter(l => /Uncaught|TypeError|ReferenceError|UnhandledPromise|Error: /.test(l) && !/dbus|bluez|vaapi|Failed to connect/.test(l));
    assert(bad.length === 0, 'errors in log: ' + bad.slice(0, 3).join(' || '));
  });
  await test('首页只有问候语 + 药丸输入框（无推荐）', async () => {
    const home = await app.waitPage('aibrowser://home');
    const n = await home.evaluate(() => ({ inputs: document.querySelectorAll('textarea#q, input#q').length, links: document.querySelectorAll('a').length, cards: document.querySelectorAll('.card,.source-card,.ext-card').length }));
    eq(n, { inputs: 1, links: 0, cards: 0 });
  });
  await test('模式分段控件：Chat/Search 切换并持久化到状态', async () => {
    await app.setMode('search');
    eq((await app.tabsState()).mode, 'search');
    const ch = await app.chrome();
    assert(await ch.locator('#modeseg [data-mode="search"].active').count() === 1);
    await app.setMode('chat');
    eq((await app.tabsState()).mode, 'chat');
  });
  await test('Search 模式：地址栏输入 URL 打开真实网页，标签标题更新', async () => {
    await app.setMode('search');
    await app.submit(`http://127.0.0.1:${web.port}/x`);
    await until(async () => (await app.tabsState()).tabs[0].title === 'Local test page', 10000, 'title');
    const p = await app.waitPage(`127.0.0.1:${web.port}/x`);
    assert((await p.locator('h1').innerText()) === 'Hello test');
  });
  await test('新建标签页 / 切换 / 关闭', async () => {
    const ch = await app.chrome();
    await ch.click('#tabadd');
    await until(async () => (await app.tabsState()).tabs.length === 2, 5000, '2 tabs');
    let st = await app.tabsState();
    eq(st.tabs[1].active, true); eq(st.tabs[1].kind, 'home');
    await ch.click(`.tab[data-id="${st.tabs[0].id}"]`);
    await until(async () => (await app.tabsState()).tabs[0].active, 5000, 'switch');
    await ch.click(`.tab[data-id="${st.tabs[1].id}"] .close-tab`);
    await until(async () => (await app.tabsState()).tabs.length === 1, 5000, 'closed');
  });
  await test('后退 / 前进 / 重新载入', async () => {
    const ch = await app.chrome();
    await app.submit(`http://127.0.0.1:${web.port}/second`);
    await until(async () => (await app.tabsState()).tabs[0].url.endsWith('/second') && !(await app.tabsState()).tabs[0].loading, 10000, 'second loaded');
    await ch.click('#back');
    await until(async () => (await app.tabsState()).tabs[0].url.endsWith('/x'), 8000, 'back');
    assert(await ch.locator('#fwd:not(.disabled)').count() === 1, 'forward enabled');
    await ch.click('#fwd');
    await until(async () => (await app.tabsState()).tabs[0].url.endsWith('/second'), 8000, 'forward');
    const before = web.hits.length;
    await ch.click('#reload');
    await until(() => web.hits.length > before, 8000, 'reload hits server');
  });
  await test('Search 模式：自定义引擎模板 %s 用于搜索词', async () => {
    await patchSettings(app, { search: { engine: 'custom', custom: `http://127.0.0.1:${web.port}/search?q=%s` } });
    await app.submit('hello world 你好');
    await until(async () => (await app.tabsState()).tabs[0].url.includes('/search?q='), 10000, 'search url');
    const u = new URL((await app.tabsState()).tabs[0].url);
    eq(u.searchParams.get('q'), 'hello world 你好');
    assert(web.hits.some(h => h.path === '/search' && h.q === 'hello world 你好'), 'server saw query');
  });
  await test('Search 模式：Bing(默认)/Google/百度/DuckDuckGo 预设使用正确的搜索 URL', async () => {
    const expect = { bing: 'https://www.bing.com/search?q=', google: 'https://www.google.com/search?q=', baidu: 'https://www.baidu.com/s?wd=', duckduckgo: 'https://duckduckgo.com/?q=' };
    const s0 = await (await app.chrome()).evaluate(() => window.aib.invoke('settings:get'));
    // default engine is bing on a fresh profile (checked via a second profile below); here iterate presets
    for (const [id, prefix] of Object.entries(expect)) {
      await patchSettings(app, { search: { engine: id } });
      await app.submit('apple pie');
      await until(async () => (await app.tabsState()).tabs[0].url.startsWith(prefix + 'apple'), 8000, id + ' url');
    }
  });
  await test('设置持久化：重启后保留 + API Key 不暴露给页面且磁盘上不是明文', async () => {
    await patchSettings(app, { ai: { api: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-SECRET-123', model: 'm-x', temperature: 0.7 } }, lang: 'zh', search: { engine: 'duckduckgo' } });
    const pub = await (await app.chrome()).evaluate(() => window.aib.invoke('settings:get'));
    eq(pub.ai.api.apiKey, ''); eq(pub.ai.api.hasKey, true);
    const ud = app.userData; await app.close(); await sleep(500);
    const raw = fs.readFileSync(path.join(ud, 'settings.json'), 'utf8');
    assert(!raw.includes('sk-SECRET-123'), 'plain key on disk');
    assert(!app.logs.join('').includes('sk-SECRET-123'), 'key in logs');
    app = await launch({ userData: ud });
    const s = await (await app.chrome()).evaluate(() => window.aib.invoke('settings:get'));
    eq([s.ai.api.model, s.ai.api.temperature, s.search.engine, s.ai.api.hasKey], ['m-x', 0.7, 'duckduckgo', true]);
  });
  await test('全新配置默认搜索引擎为 Bing，默认语言中文', async () => {
    const a2 = await launch();
    const s = await (await a2.chrome()).evaluate(() => window.aib.invoke('settings:get'));
    eq([s.search.engine, s.lang, s.mode], ['bing', 'zh', 'chat']);
    await a2.close();
  });
  await test('界面语言切换 中文→English 立即生效并持久化（所有 UI 字符串走 i18n 表）', async () => {
    await app.submit('aibrowser://settings');
    const sp = await app.waitPage('aibrowser://settings');
    await sp.click('[data-nav="general"]');
    await sp.click('[data-lang="en"]');
    const ch = await app.chrome();
    await until(async () => (await ch.locator('#addr').getAttribute('placeholder')) === 'Start page', 5000, 'chrome english');
    await until(async () => (await sp.locator('h2').innerText()) === 'General', 5000, 'settings english');
    await app.submit('aibrowser://home'); // new load in English
    const home = await app.waitPage('aibrowser://home');
    await until(async () => (await home.locator('#greet').innerText()) === 'Felix, how may I help you?', 5000, 'home english');
    const ud = app.userData; await app.close(); await sleep(400);
    app = await launch({ userData: ud });
    const h2 = await app.waitPage('aibrowser://home');
    await until(async () => (await h2.locator('#greet').innerText()).startsWith('Felix, how may I help'), 5000, 'english after restart');
    const ch2 = await app.chrome();
    await sp.close().catch(() => {});
    await patchSettings(app, { lang: 'zh' });
    await until(async () => (await h2.locator('#greet').innerText()) === 'Felix，请问需要什么帮助？', 5000, 'back to zh');
  });
  await test('右上角四方格按钮打开溢出菜单，含全部 11 项（中文）', async () => {
    const ch = await app.chrome();
    await ch.click('#menu');
    const m = await app.waitPage('aibrowser://menu');
    const labels = await m.$$eval('.omi', els => els.map(e => e.querySelector('span').innerText));
    eq(labels, ['新建隐身标签页', '历史记录', '下载内容', '拓展', '密码', '书签', '在页面上查找', '打印…', '缩放', '检查', '设置']);
    await m.keyboard.press('Escape').catch(() => {});
    await until(() => !app.pages().some(p => p.url().startsWith('aibrowser://menu')), 4000, 'menu closed');
  });
  app && await app.close();
  await web.close();
};
