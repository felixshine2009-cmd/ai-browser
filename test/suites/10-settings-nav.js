'use strict';
const { launch, sleep } = require('../lib/app');
const os = require('os'), fs = require('fs'), path = require('path');

// Felix bug: settings sidebar items (拓展 / 历史记录) used to navigate away. Every item must switch INSIDE settings,
// keep the sidebar, reflect the section in the URL hash, and support back / forward / reload.
module.exports = async ({ test, group, assert, eq, until }) => {
  group('设置页侧边栏：全部在设置页内切换 / hash / 前进后退 / 刷新');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-snav-'));
  const app = await launch({ userData: ud });
  const ch = await app.chrome();
  const act = async () => (await app.tabsState()).tabs.find(t => t.active);
  const SECTIONS = [['ai', 'ai'], ['search', 'search'], ['dict', 'dict'], ['ext', 'extensions'], ['history', 'history'], ['general', 'general'], ['privacy', 'privacy']];
  const active = (p) => p.locator('.nav-item.active').getAttribute('data-nav');
  const urlHash = async () => (await act()).url.split('#')[1] || '';
  let sp;
  await test('点击每个侧边栏项：仍在设置页、侧边栏可见、内容与 hash 正确', async () => {
    await app.submit('aibrowser://settings'); sp = await app.waitPage(u => u.startsWith('aibrowser://settings')); await sleep(400);
    for (const [id, hash] of SECTIONS) {
      await sp.click(`[data-nav="${id}"]`);
      await until(async () => (await active(sp)) === id, 3000, 'active ' + id);
      await until(async () => (await urlHash()) === hash, 3000, 'hash ' + hash);
      assert((await act()).url.startsWith('aibrowser://settings'), 'still on settings after ' + id + ': ' + (await act()).url);
      eq(await sp.locator('.settings-nav .nav-item').count(), 7, 'sidebar visible');
      assert(await sp.locator('.settings-nav').isVisible(), 'sidebar visible');
      if (id === 'ext') await until(async () => (await sp.locator('#pane .ext-card').count()) >= 2, 8000, 'extension cards embedded');
      else if (id === 'history') await until(async () => (await sp.locator('#pane #lq').count()) === 1, 4000, 'history list embedded');
      else assert((await sp.locator('#pane h2').innerText()).length > 0, 'pane heading for ' + id);
    }
    eq((await app.tabsState()).tabs.length, 1, 'no extra tabs opened');
  });
  await test('嵌入的 拓展 / 历史 功能可用（不跳转）', async () => {
    await sp.click('[data-nav="ext"]'); await until(async () => (await sp.locator('#pane .ext-card').count()) >= 2, 8000, 'cards');
    const card = sp.locator('#pane .ext-card').first(); const before = await card.getAttribute('class');
    await card.locator('[data-act="toggle"], input[type=checkbox], .switch').first().click().catch(() => {});
    await sleep(500);
    assert((await act()).url.startsWith('aibrowser://settings'), 'toggling stays on settings');
    // history: seed via IPC-free path — visit nothing, just verify empty/list UI + search box works
    await sp.click('[data-nav="history"]'); await until(async () => (await sp.locator('#pane #lq').count()) === 1, 4000, 'history');
    await sp.fill('#lq', 'zzz'); await sleep(300);
    assert((await act()).url.startsWith('aibrowser://settings'));
    // switching away destroys listeners: no duplicate renders / errors
    await sp.click('[data-nav="ai"]'); await sleep(200);
    await ch.evaluate(() => window.aib.invoke('hist:clear')); await sleep(300);
    eq(await sp.locator('#pane #lq').count(), 0, 'history UI gone after leaving section');
  });
  await test('后退 / 前进 在各分区间切换，刷新保持当前分区', async () => {
    // history stack so far: ... ai(1st) ... we build a fresh known sequence
    for (const id of ['general', 'ext', 'privacy']) { await sp.click(`[data-nav="${id}"]`); await until(async () => (await active(sp)) === id, 3000, id); }
    await ch.click('#back'); await until(async () => (await active(sp)) === 'ext', 4000, 'back -> ext');
    assert((await act()).url.includes('#extensions'), (await act()).url);
    await until(async () => (await sp.locator('#pane .ext-card').count()) >= 2, 8000, 'ext cards after back');
    await ch.click('#back'); await until(async () => (await active(sp)) === 'general', 4000, 'back -> general');
    await ch.click('#fwd'); await until(async () => (await active(sp)) === 'ext', 4000, 'fwd -> ext');
    await ch.click('#fwd'); await until(async () => (await active(sp)) === 'privacy', 4000, 'fwd -> privacy');
    // reload keeps section
    await sp.click('[data-nav="history"]'); await until(async () => (await urlHash()) === 'history', 3000, 'hash history');
    await ch.click('#reload'); await sleep(900);
    const sp2 = await app.waitPage(u => u.startsWith('aibrowser://settings'));
    await until(async () => (await active(sp2)) === 'history', 5000, 'history after reload');
    await until(async () => (await sp2.locator('#pane #lq').count()) === 1, 5000, 'history pane after reload');
  });
  await test('直接打开 aibrowser://settings#extensions 显示拓展分区', async () => {
    await app.submit('aibrowser://settings#extensions');
    await sleep(800);
    const p = await app.waitPage(u => u.startsWith('aibrowser://settings'));
    await until(async () => (await active(p)) === 'ext', 5000, 'ext active');
    await until(async () => (await p.locator('#pane .ext-card').count()) >= 2, 8000, 'cards');
    // old links (#ext, #dict) keep working
    await p.click('[data-nav="dict"]'); await until(async () => (await active(p)) === 'dict', 3000, 'dict');
  });
  await app.close();
};
