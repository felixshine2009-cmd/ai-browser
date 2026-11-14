'use strict';
// iPad 3.0.1: OALDPE-style dictionaries show the whole entry on the iPad (frame sized to the entry, the result area
// scrolls), and a reload of the dictionary tool view stays on the result. Same checks as the desktop suite 48.
const { launchIpad } = require('../lib/ipad-sim');
const { seedSettings, apiSettings, sleep } = require('../lib/app');
const { createLlmServer } = require('../lib/mock-server');
const { checkOald } = require('../lib/dict-oald-check');
const { checkVmTouch, checkVmMouse } = require('../lib/vm-touch-check');
const fs = require('fs'), os = require('os'), path = require('path');
const FIX = path.join(__dirname, '..', 'fixtures', 'dict-oald');
const SHOTS = process.env.AIB_IPAD_SHOTS || path.join(__dirname, '..', '..', 'shots', 'ipad2');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('iPad 3.0.1：OALDPE 类词典完整显示、词典工具页刷新、Linux 桌面触控板式操作');
  const llm = await createLlmServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipad-oald-'));
  const dir = path.join(ud, 'dictionaries', 'OALDPE'); fs.mkdirSync(dir, { recursive: true });
  for (const f of ['oald.mdx', 'oald.mdd']) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  seedSettings(ud, Object.assign(apiSettings(llm.port), {
    onboarding: { completed: true, skipped: false, completedAt: 1 },
    dicts: [{ id: 'doald0001', name: 'OALD-style', mdx: path.join(dir, 'oald.mdx'), mdd: [path.join(dir, 'oald.mdd')], dir, origin: path.join(dir, 'oald.mdx'), enabled: true }]
  }));
  const app = await launchIpad({ userData: ud, env: { AIB_VM_GUI_FAKE: '1' } });
  const shot = (n) => app.screenshot(path.join(SHOTS, n + '.png')).catch(() => {});
  try {
    await test('iPad 词典工具查 apple：义项全部显示，框高随内容，结果区滚动到末行，白色背景不变', async () => {
      await app.invoke('nav:openUrl', 'aibrowser://tool?id=dict&q=apple');
      const p = await app.waitPage(u => /aibrowser:\/\/tool\/?\?id=dict/.test(u));
      await shot('301-dict-oald-top');
      await checkOald({ page: p, until, assert, eq, shot });
    });
    await test('iPad 刷新词典工具页：停留在结果页并重新查询', async () => {
      const p = await app.waitPage(u => /aibrowser:\/\/tool\/?\?id=dict/.test(u));
      await p.fill('#w', 'apple'); await p.press('#w', 'Enter');
      await until(async () => /[?&]q=apple(&|$)/.test(p.url()), 5000, 'query in the address');
      await app.invoke('nav:reload');
      await sleep(1000);
      const p2 = await app.waitPage(u => /aibrowser:\/\/tool\/?\?id=dict/.test(u));
      await until(async () => (await p2.locator('.dict-frame').count()) === 1, 15000, 'result after reload');
      eq(await p2.inputValue('#w'), 'apple');
    });
    await test('iPad Linux 桌面：触控板式触控（单指移动指针、轻点左键、长按右键、双指滚动、轻点拖动），鼠标照常', async () => {
      await app.invoke('vm:openDesktop');
      const p = await app.waitPage(u => u.startsWith('aibrowser://vmdesktop'));
      const invoke = (c, ...a) => app.invoke(c, ...a);
      await checkVmTouch({ page: p, invoke, until, assert, eq });
      await checkVmMouse({ page: p, invoke, eq });
      await shot('301-vmdesktop-touch');
    });
  } finally { await app.close(); }
};
