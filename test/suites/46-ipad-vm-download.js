'use strict';
// v3.0.0 item 6: the IPA carries no VM image — only the v86 emulator. The Alpine base image is downloaded on first use
// (here from a local copy of the release asset, AIB_VM_BASE_TGZ) into userData/vm-base and served from there.
// Needs AIB_VM_BASE_TGZ (linux-vm-x86-v86.tar.gz); skipped otherwise.
const { launchIpad } = require('../lib/ipad-sim');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async ({ test, group, assert, eq, skip }) => {
  group('iPad 安装包不含虚拟机镜像：首次使用时下载 Linux 镜像');
  const tgz = process.env.AIB_VM_BASE_TGZ;
  if (!tgz || !fs.existsSync(tgz)) { skip('iPad 虚拟机镜像按需下载', '需要 AIB_VM_BASE_TGZ'); return; }
  // a payload shaped like the IPA: emulator files only
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipa-payload-'));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ipad-bundle.js'), bundle], { stdio: 'ignore' });
  execFileSync('tar', ['-C', bundle, '-xzf', tgz, 'vm/libv86.js', 'vm/v86.wasm', 'vm/seabios.bin', 'vm/vgabios.bin', 'vm/LICENSE-v86.txt']);
  assert(!fs.existsSync(path.join(bundle, 'vm', 'fs.json')) && !fs.existsSync(path.join(bundle, 'vm', 'bzImage')), 'no image in the payload');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipadvm-'));
  const app = await launchIpad({ userData: ud, env: { AIB_IPAD_BUNDLE: bundle, AIB_BUNDLE: bundle, AIB_VM_BASE_TGZ: tgz } });
  try {
    await test('虚拟机状态：镜像尚未下载，显示下载大小', async () => {
      const s = await app.invoke('vm:status');
      const base = (s.images || []).find(i => i.id === 'alpine');
      eq(base.ready, false); eq(base.downloadMB, 121); eq(s.imageReady, false);
    });
    await test('首次使用：下载并解压镜像后启动，vm_shell 返回 root shell 输出；镜像只下载一次', async () => {
      const r = await app.tool('vm_shell', { command: 'echo VM-$(id -u)-$(uname -s)' });
      assert(/VM-0-Linux/.test(r.stdout), JSON.stringify(r).slice(0, 300));
      assert(fs.existsSync(path.join(ud, 'vm-base', '.ok')) && fs.existsSync(path.join(ud, 'vm-base', 'vm', 'fs.json')), 'image stored in userData/vm-base');
      assert(!fs.readdirSync(path.join(ud, 'vm-base')).some(f => /download/.test(f)), 'temporary files removed');
      const s = await app.invoke('vm:status');
      eq((s.images || []).find(i => i.id === 'alpine').ready, true); eq(s.imageReady, true);
    }, { timeout: 900000 });
  } finally { await app.close().catch(() => {}); fs.rmSync(bundle, { recursive: true, force: true }); }
};
