'use strict';
// v3.1 desktop: the extension framework (every built-in feature a bundled first-party aib-feature/1 extension with
// contribution points), migrated one feature at a time without losing any; framework docs bundled in the app.
const { launch, seedSettings } = require('../lib/app');
const X = require('../lib/ext-framework-check');
const os = require('os'), fs = require('fs'), path = require('path');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('拓展框架（v3.1，桌面版）：内置功能均为第一方拓展、贡献点、停用与恢复、开发文档');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-extfw-'));
  seedSettings(ud, { onboarding: { completed: true, skipped: false, completedAt: 1 } });
  const app = await launch({ userData: ud });
  const ch = await app.chrome();
  const invoke = (c, ...a) => ch.evaluate(([c, a]) => window.aib.invoke(c, ...a), [c, a]);
  const ctx = { invoke, platform: 'desktop', assert, eq, until, tmp: ud, waitPage: (m) => app.waitPage(m) };
  try {
    const home = await app.waitPage(u => u.startsWith('aibrowser://home'));
    Object.assign(ctx, { chrome: ch, home });
    await test('内置拓展全部加载（框架 2 级）；工具面板与主页入口来自各拓展的贡献，顺序与名称不变', async () => {
      await X.checkBuiltins(ctx);
      await until(async () => (await ch.evaluate(() => [...document.querySelectorAll('#toolicons .ticon')].map(b => b.dataset.tool).join(','))) === X.DESKTOP_TOOLS.join(','), 8000, 'toolbar from toolPanel');
      await until(async () => (await home.evaluate(() => [...document.querySelectorAll('#hometools .ticon')].map(b => b.dataset.tool).join(','))) === X.HOME.join(','), 8000, 'home from homepage');
    });
    await test('功能无缺失：每个工具仍可打开（工具栏按钮点按）', async () => {
      for (const id of X.DESKTOP_TOOLS.filter(x => x !== 'snap')) {
        await ch.click(`#toolicons .ticon[data-tool="${id}"]`);
        await until(async () => (await invoke('tabs:state')).activeTool === id, 15000, 'opened ' + id);
      }
      await X.checkToolsOpen(ctx);
    });
    await test('停用“百科”拓展后工具栏与主页移除该工具，重新启用后原位恢复', () => X.checkToggle(ctx));
    await test('回答内容块：graph 由 GeoGebra 拓展处理，停用后不再提供；word 由词典拓展处理', () => X.checkAnswerBlocks(ctx));
    await test('导入器：词典拓展贡献 .mdx / .mdd 导入，ext:import 经由拓展导入并关联 .mdd', () => X.checkImporter(ctx));
    await test('用户拓展：自带图标（经过净化）的工具出现在工具面板与主页并可打开；越权清单被拒绝', () => X.checkUserExtension(ctx));
    await test('开发文档内置于应用（aibrowser://docs），可从“设置 → 拓展”打开，拓展卡片列出贡献内容', () => X.checkDocs(Object.assign({}, ctx, {
      settingsPage: async () => { await invoke('nav:openUrl', 'aibrowser://settings#extensions'); return app.waitPage(u => u.startsWith('aibrowser://settings')); }
    })));
  } finally { await app.close(); }
};
