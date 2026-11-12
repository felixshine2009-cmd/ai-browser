'use strict';
// Codex-style VM tools on the desktop VM (the same arm64 Alpine image as on a Mac, here on QEMU so it runs on Linux CI).
// Needs AIB_VM_IMAGE_DIR (vmlinux, initramfs.gz, rootfs.img) and qemu-system-aarch64; skipped otherwise.
// The same tools on the iPad VM (v86) are exercised in 36-ipad-sim.js.
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const checks = require('../lib/vm-tools-check');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async (h) => {
  const { test, group, assert, eq, skip } = h;
  group('Linux 虚拟机：Codex 风格工具（查看 / 编辑 / 补丁 / 搜索 / 列表 / 后台 / 软件包 / 服务 / git）');
  const T = require(path.join(ROOT, 'src/main/vm/codex-tools.js'));
  await test('工具定义：9 个工具，web 副本一致，补丁解析器', () => {
    eq(T.NAMES, ['vm_view', 'vm_edit', 'vm_apply_patch', 'vm_search', 'vm_list', 'vm_bg', 'vm_pkg', 'vm_service', 'vm_git']);
    eq(fs.readFileSync(path.join(ROOT, 'web/js/vm-codex-tools.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'src/main/vm/codex-tools.js'), 'utf8'), 'web/js/vm-codex-tools.js must be a copy');
    const ops = T.parsePatch('*** Begin Patch\n*** Update File: a.py\n@@ def f():\n-    return 1\n+    return 2\n*** End of File\n*** End Patch\n');
    eq(ops[0].hunks[0].header, 'def f():'); assert(ops[0].hunks[0].eof);
    eq(T.applyHunks('x\ndef f():\n    return 1\n', ops[0].hunks, 'a.py'), 'x\ndef f():\n    return 2\n');
    eq(T.applyHunks('a\r\nb\r\n', [{ header: '', old: ['a'], new: ['A'], eof: false }], 'c'), 'A\r\nb\r\n');
    const names = require(path.join(ROOT, 'src/main/ai/compute-tools.js')).TOOLS.map(t => t.name);
    for (const n of T.NAMES) assert(names.includes(n), 'registered: ' + n);
  });
  const dir = process.env.AIB_VM_IMAGE_DIR;
  let qemu = false; try { execFileSync('qemu-system-aarch64', ['--version'], { stdio: 'ignore' }); qemu = true; } catch {}
  if (!dir || !fs.existsSync(path.join(dir, 'rootfs.img')) || !qemu) { skip('VM 工具实机测试', '需要 AIB_VM_IMAGE_DIR 与 qemu-system-aarch64'); return; }
  process.env.AIB_VM_BACKEND = 'qemu';
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-vmt-'));
  const vm = require(path.join(ROOT, 'src/main/vm'));
  vm._setUserData(ud);
  const tools = require(path.join(ROOT, 'src/main/ai/compute-tools.js')).TOOLS;
  const call = async (name, a) => tools.find(t => t.name === name).run(a, { emit: () => {} });
  try {
    await test('启动虚拟机（QEMU，arm64 Alpine）', async () => { const s = await vm.start(); eq(s.phase, 'running'); }, { timeout: 420000 });
    await checks(h, call, { network: !process.env.AIB_VM_NO_NET, timeout: 300000 });
    await test('enable 的服务在虚拟机重启后自动启动', async () => {
      await call('vm_service', { action: 'create', name: 'boot-svc', command: 'echo up; sleep 3600' });
      await call('vm_service', { action: 'enable', name: 'boot-svc' });
      await vm.stop(); await vm.start();
      let st = '';
      for (let i = 0; i < 20 && !/running/.test(st); i++) { await new Promise(r => setTimeout(r, 1000)); st = (await call('vm_service', { action: 'status', name: 'boot-svc' })).output; }
      assert(/boot-svc running/.test(st), st);
      await call('vm_service', { action: 'remove', name: 'boot-svc' });
    }, { timeout: 600000 });
  } finally { await vm.stop().catch(() => {}); }
};
