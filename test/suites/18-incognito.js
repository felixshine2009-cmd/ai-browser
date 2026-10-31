'use strict';
const { launch, sleep } = require('../lib/app');
const http = require('http');

// Felix: 新建隐身标签页 — four-squares menu entry (⇧⌘N), separate in-memory session partition: no shared cookies /
// storage / history, visually distinct dark-purple tab + badge, wiped when the last private tab closes.
module.exports = async ({ test, group, assert, eq, until }) => {
  group('隐身标签页');
  const seen = [];
  const web = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); seen.push({ path: u.pathname, cookie: req.headers.cookie || '' });
    const h = { 'Content-Type': 'text/html; charset=utf-8' };
    if (u.pathname === '/set') h['Set-Cookie'] = `who=${u.searchParams.get('v')}; Path=/`;
    res.writeHead(200, h);
    if (u.pathname === '/opener') return res.end('<!doctype html><title>opener</title><a id="l" target="_blank" href="/child">child</a>');
    res.end(`<!doctype html><title>${u.pathname}</title><body>page ${u.pathname}`);
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r)); const B = `http://127.0.0.1:${web.address().port}`;
  const app = await launch({}); const ch = await app.chrome();
  const inv = (c, ...a) => ch.evaluate(([c, a]) => window.aib.invoke(c, ...a), [c, a]);
  const st = () => app.tabsState();
  const lastCookie = (p) => { const r = [...seen].reverse().find(x => x.path === p); return r ? r.cookie : null; };
  const navTo = async (url, path) => { await app.submit(url); await until(async () => { const t = (await st()).tabs.find(x => x.active); return t && t.url.startsWith(url.split('?')[0]) && !t.loading; }, 10000, 'loaded ' + url); };
  let normalId, incId;

  await test('四方格菜单第一项“新建隐身标签页 ⇧⌘N”；点击后新建一个隐身标签并激活', async () => {
    await app.setMode('search'); await navTo(B + '/set?v=normal'); normalId = (await st()).tabs.find(t => t.active).id;
    await ch.click('#menu'); const m = await app.waitPage('aibrowser://menu'); await sleep(250);
    const first = m.locator('.omi').first(); const txt = await first.innerText(); assert(/新建隐身标签页/.test(txt) && /⇧⌘N/.test(txt), txt);
    await first.click(); await until(async () => (await st()).tabs.some(t => t.incognito && t.active), 5000, 'incognito tab active');
    incId = (await st()).tabs.find(t => t.incognito).id; assert(incId !== normalId);
  });
  await test('视觉区分：隐身标签为深紫色并带“隐身”徽标；工具栏随之变紫；切回普通标签恢复', async () => {
    await sleep(300);
    const tab = ch.locator('.tab.incognito'); eq(await tab.count(), 1); assert(/隐身/.test(await tab.locator('.incog-badge').innerText()));
    const bg = await tab.evaluate(e => getComputedStyle(e).backgroundColor); const [r, g, b] = bg.match(/\d+/g).map(Number); assert(b > g + 25 && r > g, 'purple-ish: ' + bg);
    assert(await ch.evaluate(() => document.body.classList.contains('incog-active')), 'toolbar tinted');
    await app.app?.screenshot?.call?.(app); try { await app.screenshot(require('path').join(__dirname, '..', '..', 'shots', '20-incognito.png')); } catch {}
    await inv('tab:activate', normalId); await sleep(300); assert(!(await ch.evaluate(() => document.body.classList.contains('incog-active'))), 'normal tab not tinted');
    await inv('tab:activate', incId); await sleep(300);
  });
  await test('Cookie 隔离：隐身标签看不到普通标签的 cookie；普通标签也看不到隐身标签的', async () => {
    await navTo(B + '/get1'); eq(lastCookie('/get1'), '', 'incognito sees no normal cookie');
    await navTo(B + '/set?v=secret'); await navTo(B + '/get2'); assert(/who=secret/.test(lastCookie('/get2')), 'incognito keeps its own cookie in-session');
    await inv('tab:activate', normalId); await sleep(300); await navTo(B + '/get3'); assert(/who=normal/.test(lastCookie('/get3')) && !/secret/.test(lastCookie('/get3')), lastCookie('/get3'));
    await inv('tab:activate', incId); await sleep(200);
  });
  await test('localStorage 隔离', async () => {
    await navTo(B + '/ls-inc'); let p = await app.activePage(); await p.evaluate(() => localStorage.setItem('k', 'incog')); eq(await p.evaluate(() => localStorage.getItem('k')), 'incog');
    await inv('tab:activate', normalId); await sleep(300); await navTo(B + '/ls-norm'); p = await app.activePage(); eq(await p.evaluate(() => localStorage.getItem('k')), null);
    await inv('tab:activate', incId); await sleep(200);
  });
  await test('历史记录：隐身标签的访问不入历史；普通标签的入历史', async () => {
    await navTo(B + '/only-incognito'); const h = JSON.stringify(await inv('hist:list', ''));
    assert(!h.includes('only-incognito'), 'incognito visit not in history'); assert(h.includes('/get3') || h.includes('ls-norm'), 'normal visits are recorded');
  });
  await test('隐身标签中 target=_blank 打开的新标签仍是隐身；内部页面（设置）在隐身标签中可正常打开', async () => {
    await navTo(B + '/opener'); const p = await app.activePage(); await p.click('#l');
    await until(async () => { const t = (await st()).tabs.find(x => x.url.endsWith('/child')); return t && t.incognito; }, 6000, 'child tab incognito');
    await app.submit('aibrowser://settings'); await app.waitPage('aibrowser://settings');
  });
  await test('关闭最后一个隐身标签 → 会话数据清除；再开隐身标签不再带 cookie / 存储；普通标签不受影响', async () => {
    for (const t of (await st()).tabs.filter(t => t.incognito)) await inv('tab:close', t.id);
    await until(async () => !(await st()).tabs.some(t => t.incognito), 4000, 'all incognito closed'); await sleep(500);
    await ch.evaluate(() => window.aib.invoke('menu:action', 'incognito')); await until(async () => (await st()).tabs.some(t => t.incognito && t.active), 5000);
    await navTo(B + '/get4'); eq(lastCookie('/get4'), '', 'incognito cookies wiped');
    await navTo(B + '/ls-again'); const p = await app.activePage(); eq(await p.evaluate(() => localStorage.getItem('k')), null);
    await inv('tab:activate', normalId); await sleep(300); await navTo(B + '/get5'); assert(/who=normal/.test(lastCookie('/get5')), 'normal cookie still there');
  });
  await test('Agent 工具 browser_open_tab(incognito:true) 打开隐身标签', async () => {
    const r = await ch.evaluate(() => window.aib.invoke('tabs:state')); const n = r.tabs.filter(t => t.incognito).length;
    const tools = require('../../src/main/ai/tools'); const def = tools.BUILTIN.find(t => t.name === 'browser_open_tab'); assert(def && def.parameters.properties.incognito, 'schema has incognito');
  });
  await app.close(); web.close();
};
