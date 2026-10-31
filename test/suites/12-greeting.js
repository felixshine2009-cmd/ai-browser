'use strict';
const { launch, sleep } = require('../lib/app');
const os = require('os'), fs = require('fs'), path = require('path');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('主页问候语：显示名称 / {name} 自定义 / 实时更新');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-greet-'));
  const app = await launch({ userData: ud });
  const ch = await app.chrome();
  const inv = (...a) => ch.evaluate((a) => window.aib.invoke(...a), a);
  let home, sp;
  await test('默认问候语：Felix，今天想做什么？（无装饰图标）', async () => {
    home = await app.waitPage(u => u.startsWith('aibrowser://home'));
    await until(async () => (await home.locator('#greet').innerText()) === 'Felix，今天想做什么？', 5000, 'default greeting');
    assert((await home.locator('.spark-inline').count()) === 0, 'spark decoration removed');
  });
  await test('设置 → 通用 有“显示名称”和“主页问候语”，主页无需刷新即时更新', async () => {
    await ch.click('#tabadd'); await sleep(400);
    await app.submit('aibrowser://settings#general'); sp = await app.waitPage(u => u.startsWith('aibrowser://settings'));
    await until(async () => (await sp.locator('#dname').count()) === 1, 5000, 'fields');
    await sp.fill('#dname', '小明'); await sp.fill('#greeting', '你好，{name}！今天忙什么？'); await sp.click('#greetsave');
    await until(async () => (await sp.locator('#greetnote .ck').count()) === 1, 3000, 'green saved note');
    eq((await inv('settings:get')).displayName, '小明');
    assert((await sp.locator('#greetprev').innerText()).includes('你好，小明！今天忙什么？'), 'preview');
    // the first tab (home, still open in the background) updates live — no reload
    await until(async () => (await home.locator('#greet').innerText()) === '你好，小明！今天忙什么？', 5000, 'old home tab live-updated (no reload)');
  });
  await test('留空问候语 → 本地化默认；只改显示名称；英文默认', async () => {
    await sp.fill('#greeting', ''); await sp.fill('#dname', 'Amy'); await sp.press('#dname', 'Enter');
    await until(async () => (await inv('settings:get')).greeting === '', 3000, 'saved');
    await until(async () => (await home.locator('#greet').innerText()) === 'Amy，今天想做什么？', 5000, 'default w/ new name');
    await inv('settings:patch', { lang: 'en' });
    await until(async () => (await home.locator('#greet').innerText()) === 'Amy, what would you like to do today?', 5000, 'english default');
    await inv('settings:patch', { lang: 'zh' });
  });
  await test('空显示名称：{name} 及其后的逗号被去掉', async () => {
    await sp.fill('#dname', ''); await sp.click('#greetsave');
    await until(async () => (await home.locator('#greet').innerText()) === '今天想做什么？', 5000, 'no name');
  });
  await test('恢复默认问候语', async () => {
    await sp.click('#greetreset');
    await until(async () => (await home.locator('#greet').innerText()) === 'Felix，今天想做什么？', 5000, 'reset');
    assert((await home.locator('.spark-inline').count()) === 0, 'no spark after reset');
  });
  await app.close();
};
