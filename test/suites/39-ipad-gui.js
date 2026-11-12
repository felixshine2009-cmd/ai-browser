'use strict';
// iPad light graphical VM image (Alpine + JWM on v86) in the simulated host: first-use download of the delta over the
// bundled image, computer-use tools, the in-app desktop viewer, and boot / action timings (written to ipad-gui-speed.json).
// Needs AIB_IPAD_BUNDLE (with vm/) and AIB_VM_GUI_TAR (linux-vm-x86-gui.tar); skipped otherwise.
const { launchIpad } = require('../lib/ipad-sim');
const { sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer } = require('../lib/mock-server');
const fs = require('fs'), os = require('os'), path = require('path');
const SHOTS = process.env.AIB_IPAD_SHOTS || path.join(__dirname, '..', '..', 'shots', 'ipad2');
const norm = (u) => String(u || '').replace(/\/(?=$|\?)/, '');

module.exports = async ({ test, group, assert, eq, until, skip }) => {
  group('iPad 图形镜像（Alpine + JWM，v86）：首次下载、电脑操作工具、桌面查看器、速度');
  if (!(process.env.AIB_VM_GUI_TAR && process.env.AIB_IPAD_BUNDLE && fs.existsSync(path.join(process.env.AIB_IPAD_BUNDLE, 'vm')))) { skip('iPad 图形镜像', '需要 AIB_IPAD_BUNDLE（含 vm/）与 AIB_VM_GUI_TAR'); return; }
  const llm = await createLlmServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipadgui-'));
  seedSettings(ud, Object.assign(apiSettings(llm.port), { onboarding: { completed: true, skipped: false, completedAt: 1 }, name: 'Felix' }));
  const app = await launchIpad({ userData: ud });
  await app.chrome();
  const shot = (n) => app.screenshot(path.join(SHOTS, n + '.png')).catch(e => console.log('screenshot', e.message));
  const open = async (url) => { await app.invoke('nav:openUrl', url); return until(() => app.ctx.pages().find(p => norm(p.url()) === norm(url)), 15000, 'open ' + url); };
  try {
    // light graphical image (Alpine + JWM on v86): first-use download (delta over the bundled image), computer-use tools, speed
    let bootMs = 0;
    await test('iPad 图形镜像 · 切换镜像：首次使用时下载（与内置镜像的差量）并启动', async () => {
      await app.tool('__vm', { fn: 'stop' });
      await app.tool('__vm', { fn: 'setImage', args: ['alpine-gui'] });
      const t0 = Date.now(); const s = await app.tool('__vm', { fn: 'start' }); bootMs = Date.now() - t0;
      eq(s.phase, 'running'); eq(s.image, 'alpine-gui'); assert(s.images.find(i => i.id === 'alpine-gui').ready, 'downloaded');
      const r = await app.tool('vm_shell', { command: 'for b in Xvfb xdotool jwm xterm dillo; do command -v $b; done | wc -l' }); eq(r.stdout.trim(), '5');
    }, { timeout: 900000 });
    const times = await require('../lib/vm-gui-check')({ test, assert, eq }, (n, a) => app.tool(n, a), { tag: 'iPad 图形镜像 · ', terminal: 'xterm -geometry 80x20+60+60', termClass: 'xterm', shots: SHOTS, prefix: '15-ipad-gui-', timeout: 600000, settleMs: 3000 });
    await test('iPad 图形镜像 · 应用内“Linux 桌面”页面显示画面并可点击', async () => {
      const p = await open('aibrowser://vmdesktop');
      try { await until(() => p.evaluate(() => { const i = document.getElementById('scr'); return !!(i && i.naturalWidth > 100); }), 120000, 'viewer picture', 1000); }
      catch (e) { const info = await p.evaluate(() => ({ empty: (document.getElementById('empty') || {}).textContent, hidden: document.hidden, src: String((document.getElementById('scr') || {}).src || '').slice(0, 40) })).catch(x => ({ err: x.message })); await shot('16-vm-desktop-viewer-fail'); throw new Error(e.message + ' ' + JSON.stringify(info)); }
      await sleep(500); await shot('16-vm-desktop-viewer');
    }, { timeout: 180000 });
    await test('iPad 图形镜像 · 设置页：系统镜像选择（命令行 / 图形桌面）与“打开桌面”按钮', async () => {
      const sp = await open('aibrowser://settings'); await sp.click('[data-nav="python"]');
      await until(() => sp.evaluate(() => { const s = document.getElementById('vmimg'); return !!(s && s.options.length === 2 && !document.getElementById('vmimgrow').hidden); }), 20000, 'image selector');
      eq(await sp.evaluate(() => document.getElementById('vmimg').value), 'alpine-gui');
      assert(await sp.evaluate(() => !document.getElementById('vmdesk').hidden), 'open desktop button');
      await sp.evaluate(() => document.getElementById('vmimgrow').scrollIntoView({ block: 'center' })); await sleep(400); await shot('17-settings-vm-image');
    }, { timeout: 60000 });
    console.log(`      iPad GUI (v86): boot ${bootMs} ms; ` + Object.entries(times || {}).map(([k, v]) => `${k} ${v} ms`).join(', '));
    try { fs.writeFileSync(path.join(SHOTS, 'ipad-gui-speed.json'), JSON.stringify(Object.assign({ bootMs }, times), null, 2)); } catch {}
    await test('iPad 图形镜像 · 切回命令行镜像', async () => { await app.tool('__vm', { fn: 'setImage', args: ['alpine'] }); const s = await app.tool('__vm', { fn: 'status' }); eq(s.image, 'alpine'); }, { timeout: 300000 });
    } finally { await app.close().catch(() => {}); llm.close && llm.close(); }
};
