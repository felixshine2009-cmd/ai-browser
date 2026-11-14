'use strict';
// v3.1 iPad: the same extension framework and the same built-in extensions as the desktop; the native tool popover
// lists the toolPanel contributions (plus the iPad-only 扫码), the docs open in-app, Settings → About shows the
// iPad version.
const { launchIpad } = require('../lib/ipad-sim');
const { seedSettings } = require('../lib/app');
const X = require('../lib/ext-framework-check');
const fs = require('fs'), os = require('os'), path = require('path');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('拓展框架（v3.1，iPad）：与桌面版相同的拓展格式与内置拓展、原生工具面板、开发文档、关于页版本');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipad-extfw-'));
  seedSettings(ud, { onboarding: { completed: true, skipped: false, completedAt: 1 } });
  const app = await launchIpad({ userData: ud });
  const invoke = (c, ...a) => app.invoke(c, ...a);
  const ctx = { invoke, platform: 'ipad', assert, eq, until, tmp: ud, waitPage: (m) => app.waitPage(m) };
  try {
    const home = await app.waitPage(u => u.startsWith('aibrowser://home'));
    const chrome = await app.chrome();
    Object.assign(ctx, { chrome, home });
    await test('内置拓展全部加载（框架 2 级，平台 ipad）；工具面板含 iPad 专用“扫码”，主页入口与桌面版相同', async () => {
      await X.checkBuiltins(ctx);
      await until(async () => (await home.evaluate(() => [...document.querySelectorAll('#hometools .ticon')].map(b => b.dataset.tool).join(','))) === X.HOME.join(','), 8000, 'home');
    });
    await test('原生工具弹出面板列出各拓展贡献的工具（名称、说明、图标），停用拓展后移除、启用后恢复', async () => {
      const pick = async (id) => { await app.native({ popoverPick: id }); await chrome.click('#toolglass'); };
      await pick('wiki');
      await until(async () => (await invoke('tabs:state')).activeTool === 'wiki', 10000, 'wiki from popover');
      const pop = (await app.state()).lastPopover;
      eq(pop.items.map(x => x.id).join(','), X.DESKTOP_TOOLS.concat('scan').join(','), 'popover ids');
      assert(pop.items.every(x => x.tip && x.label), 'labels and tips');
      await invoke('tool:hide');
      await invoke('ext:setEnabled', 'aib.wiki', false);
      try {
        await sleepish(600);
        await pick('code');
        await until(async () => (await invoke('tabs:state')).activeTool === 'code', 10000, 'code from popover');
        const pop2 = (await app.state()).lastPopover;
        assert(!pop2.items.some(x => x.id === 'wiki') && pop2.items.length === 8, JSON.stringify(pop2.items.map(x => x.id)));
      } finally { await invoke('ext:setEnabled', 'aib.wiki', true); await invoke('tool:hide'); }
    });
    await test('功能无缺失：每个工具视图仍可打开', () => X.checkToolsOpen(ctx));
    await test('停用“百科”拓展后主页移除该工具，重新启用后原位恢复', () => X.checkToggle(ctx));
    await test('回答内容块与导入器由拓展提供（与桌面版相同）', async () => { await X.checkAnswerBlocks(ctx); await X.checkImporter(ctx); });
    await test('用户拓展：自带图标的工具出现在主页并可打开；越权清单被拒绝', () => X.checkUserExtension(ctx));
    await test('开发文档内置于应用（aibrowser://docs）', () => X.checkDocs(ctx));
    await test('设置 → 关于：显示 iPad 版本号与运行环境', async () => {
      const want = fs.readFileSync(path.join(__dirname, '..', '..', 'ipad', 'project.yml'), 'utf8').match(/MARKETING_VERSION:\s*"?([\d.]+)/)[1];
      await invoke('nav:openUrl', 'aibrowser://settings#general');
      const s = await app.waitPage(u => u.startsWith('aibrowser://settings'));
      await until(async () => (await s.evaluate(() => document.body.innerText)).includes('AI浏览器 ' + want + ' · iPadOS'), 10000, 'about line ' + want + ': ' + JSON.stringify((await s.evaluate(() => document.body.innerText)).match(/AI浏览器.*/)));
    });
  } finally { await app.close(); }
};
function sleepish(ms) { return new Promise(r => setTimeout(r, ms)); }
