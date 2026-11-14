'use strict';
// v3.0.1: VM desktop viewer works like a trackpad under touch (iPad), mouse unchanged (desktop parity).
const { launch } = require('../lib/app');
const { checkVmTouch, checkVmMouse } = require('../lib/vm-touch-check');
const os = require('os'), fs = require('fs'), path = require('path');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('Linux 桌面查看器：触控板式触控操作（单指移动、轻点、长按右键、双指滚动、轻点拖动）与鼠标');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-vmtouch-'));
  const app = await launch({ userData: ud, env: { AIB_VM_GUI_FAKE: '1' } });
  const ch = await app.chrome();
  const invoke = (c, ...a) => ch.evaluate(([c, a]) => window.aib.invoke(c, ...a), [c, a]);
  try {
    await test('触控：单指移动指针（页面不滚动）、轻点左键、长按右键、双指滚动、轻点后拖动、轻点两下双击', async () => {
      await invoke('vm:openDesktop');
      const p = await app.waitPage(u => u.startsWith('aibrowser://vmdesktop'));
      await checkVmTouch({ page: p, invoke, until, assert, eq });
    });
    await test('鼠标：左键、右键、滚轮仍按鼠标位置发送', async () => {
      const p = await app.waitPage(u => u.startsWith('aibrowser://vmdesktop'));
      await checkVmMouse({ page: p, invoke, eq });
    });
  } finally { await app.close(); }
};
