'use strict';
const { launch, sleep, seedSettings, apiSettings, patchSettings } = require('../lib/app');
const { createLlmServer, createWebServer } = require('../lib/mock-server');
const os = require('os'), fs = require('fs'), path = require('path');
const SH = path.join(__dirname, '..', '..', 'shots');
module.exports = async ({ test, group, assert, eq, until }) => {
  group('截图：首页 / 设置 / 菜单');
  const llm = await createLlmServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-shot-'));
  seedSettings(ud, apiSettings(llm.port, {}));
  const app = await launch({ userData: ud });
  const ch = await app.chrome();
  await test('首页（中文）：只有问候语与输入框', async () => {
    await app.setMode('chat'); await app.submit('aibrowser://home'); const h = await app.waitPage(u => u.startsWith('aibrowser://home')); await sleep(600);
    const txt = (await h.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    assert(txt.includes('Felix，请问需要什么帮助？'), txt);
    eq(await h.locator('#q').count(), 1);
    await app.screenshot(path.join(SH, '01-home.png'));
  });
  await test('首页（English）语言切换', async () => {
    await app.submit('aibrowser://settings'); const s = await app.waitPage(u => u.startsWith('aibrowser://settings')); await sleep(400);
    await s.click('[data-nav="general"]').catch(() => {});
    await s.click('[data-lang="en"]'); await sleep(500);
    await app.submit('aibrowser://home'); const h = await app.waitPage(u => u.startsWith('aibrowser://home')); await sleep(500);
    assert((await h.locator('body').innerText()).includes('what would you like to do today'), 'english greeting');
    await app.screenshot(path.join(SH, '01b-home-en.png'));
    await patchSettings(app, { lang: 'zh' }); await sleep(400);
  });
  await test('设置页：AI 后端 / 搜索 / 通用 截图', async () => {
    await app.submit('aibrowser://settings'); const s = await app.waitPage(u => u.startsWith('aibrowser://settings')); await sleep(400);
    for (const [id, file] of [['ai', '14-settings-ai.png'], ['search', '15-settings-search.png'], ['general', '16-settings-general.png']]) {
      await s.click(`[data-nav="${id}"]`); await sleep(500); await app.screenshot(path.join(SH, file));
    }
    await s.click('[data-nav="ai"]'); await sleep(300);
    await s.locator('#test').first().click().catch(() => {});
    await sleep(1200); await app.screenshot(path.join(SH, '14b-settings-ai-test.png'));
  });
  await test('右上角菜单截图', async () => {
    await ch.click('#menu'); await app.waitPage('aibrowser://menu'); await sleep(500); await app.screenshot(path.join(SH, '17-menu.png'));
  });
  await app.close(); await llm.close();
};
