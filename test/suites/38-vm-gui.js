'use strict';
// Graphical Linux VM image + computer-use tools (vm_desktop / vm_screenshot / vm_click / vm_type / vm_key / vm_scroll / vm_drag)
// and screenshots reaching vision models. The live part boots the Debian 13 + XFCE image on QEMU (arm64, same image as on a
// Mac) and needs AIB_VM_IMAGE_DIR containing rootfs-debian-xfce.img(.gz); the iPad image is exercised in 36-ipad-sim.js.
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawn } = require('child_process');
const guiChecks = require('../lib/vm-gui-check');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async (h) => {
  const { test, group, assert, eq, skip } = h;
  group('Linux 虚拟机：图形桌面镜像 + 电脑操作工具（截图 / 点击 / 输入 / 按键 / 滚动 / 拖动）');
  const G = require(path.join(ROOT, 'src/main/vm/gui-tools.js'));
  await test('工具定义与注册：7 个电脑操作工具', () => {
    eq(G.NAMES, ['vm_desktop', 'vm_screenshot', 'vm_click', 'vm_type', 'vm_key', 'vm_scroll', 'vm_drag']);
    const names = require(path.join(ROOT, 'src/main/ai/compute-tools.js')).TOOLS.map(t => t.name);
    for (const n of G.NAMES) assert(names.includes(n), 'registered: ' + n);
    const rp = fs.readFileSync(path.join(ROOT, 'src/renderer/static/runpanel.js'), 'utf8');
    for (const n of G.NAMES) assert(rp.includes(n + ':'), 'run panel kind: ' + n);
    eq(fs.readFileSync(path.join(ROOT, 'web/js/runpanel.js'), 'utf8'), rp, 'web/js/runpanel.js must be a copy');
  });
  let xvfb = false; try { execFileSync('Xvfb', ['-help'], { stdio: 'ignore' }); xvfb = true; } catch { try { execFileSync('which', ['Xvfb'], { stdio: 'ignore' }); xvfb = true; } catch {} }
  if (xvfb) await test('截图脚本：解析 Xvfb 帧缓冲（XWD）为 PNG，像素颜色正确', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-fb-')); const disp = ':' + (90 + Math.floor(Math.random() * 9));
    const x = spawn('Xvfb', [disp, '-screen', '0', '320x200x24', '-fbdir', dir, '-noreset', '-nolisten', 'tcp'], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 50 && !fs.existsSync(path.join(dir, 'Xvfb_screen0')); i++) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 300));
      // paint the root window a known colour through a tiny X client (python-xlib is not needed: xdotool + xsetroot if present)
      let painted = false; try { execFileSync('xsetroot', ['-solid', '#336699'], { env: { ...process.env, DISPLAY: disp }, stdio: 'ignore' }); painted = true; } catch {}
      const py = path.join(dir, 'shot.py'); fs.writeFileSync(py, G.SHOT_SCRIPT);
      const out = execFileSync('python3', [py, path.join(dir, 'Xvfb_screen0'), path.join(dir, 's.png'), '160']).toString().trim();
      eq(out, '320 200 160 100');
      if (painted) { const px = execFileSync('python3', ['-c', `from PIL import Image; print(Image.open('${path.join(dir, 's.png')}').convert('RGB').getpixel((5,5)))`]).toString().trim(); eq(px, '(51, 102, 153)'); }
    } finally { x.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await test('截图送给视觉模型：OpenAI 格式追加图片消息，Anthropic 放进 tool_result；旧截图与不支持视觉的模型只给文字', () => {
    const llm = require(path.join(ROOT, 'src/main/ai/llm.js')); const agent = require(path.join(ROOT, 'src/main/ai/agent.js'));
    const img = 'data:image/png;base64,' + 'A'.repeat(400);
    const tm = agent.toolMsg('a', { screen: { width: 10, height: 10 }, images: [{ dataUrl: img }], modelImages: [img] });
    assert(!tm.content.includes('AAAA'), 'no base64 in the text'); eq(tm.images, [img]);
    const msgs = [{ role: 'user', content: 'q' }];
    for (const id of ['a', 'b', 'c']) { msgs.push({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'vm_screenshot', arguments: '{}' } }] }); msgs.push(agent.toolMsg(id, { images: [{ dataUrl: img }], modelImages: [img] })); }
    const o = llm.prepImages(msgs, { vision: true, format: 'openai' });
    eq(o.filter(m => m.role === 'user' && Array.isArray(m.content)).length, 2, 'only the newest 2 screenshots');
    assert(o.every(m => !m.images), 'internal field stripped');
    assert(/omitted/.test(o.find(m => m.role === 'tool').content));
    const an = llm.toAnthropic(llm.prepImages(msgs, { vision: true, format: 'anthropic' })).messages;
    const blocks = an.filter(m => Array.isArray(m.content) && m.content[0].type === 'tool_result' && Array.isArray(m.content[0].content));
    eq(blocks.length, 2); eq(blocks[1].content[0].content[1].type, 'image'); eq(blocks[1].content[0].content[1].source.media_type, 'image/png');
    const nv = llm.prepImages(msgs, { vision: false, format: 'openai' });
    assert(nv.every(m => typeof m.content === 'string' || m.content === null), 'text only'); assert(/cannot see images/.test(nv[2].content));
    const ui = agent.slimForUi({ images: [{ dataUrl: img }], modelImages: [img] }); assert(!ui.modelImages, 'UI copy has no modelImages');
  });
  const dir = process.env.AIB_VM_IMAGE_DIR;
  let qemu = false; try { execFileSync('qemu-system-aarch64', ['--version'], { stdio: 'ignore' }); qemu = true; } catch {}
  const hasImg = dir && (fs.existsSync(path.join(dir, 'rootfs-debian-xfce.img')) || fs.existsSync(path.join(dir, 'rootfs-debian-xfce.img.gz')));
  if (!hasImg || !qemu) { skip('图形镜像实机测试', '需要 AIB_VM_IMAGE_DIR（含 rootfs-debian-xfce.img）与 qemu-system-aarch64'); return; }
  process.env.AIB_VM_BACKEND = 'qemu';
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-vmg-'));
  const vm = require(path.join(ROOT, 'src/main/vm'));
  vm._setUserData(ud);
  const tools = require(path.join(ROOT, 'src/main/ai/compute-tools.js')).TOOLS;
  const call = async (name, a) => tools.find(t => t.name === name).run(a, { emit: () => {} });
  const shots = process.env.AIB_SHOTS_DIR || path.join(ROOT, 'test', 'shots-vm');
  let times = {};
  try {
    let bootMs = 0;
    await test('切换到图形镜像（Debian 13 + XFCE）并启动（QEMU）', async () => {
      await vm.setImage('debian-xfce'); eq(vm.status().image, 'debian-xfce'); assert(vm.status().gui);
      const t0 = Date.now(); const s = await vm.start(); bootMs = Date.now() - t0; eq(s.phase, 'running'); eq(s.runningImage, 'debian-xfce');
      const r = await call('vm_shell', { command: 'cat /etc/debian_version; systemctl is-system-running || true; systemctl is-active aib-desktop' });
      assert(/^1[3-9]/.test(r.stdout), r.stdout); assert(/active/.test(r.stdout), r.stdout);
    }, { timeout: 900000 });
    times = await guiChecks(h, call, { tag: '桌面 Debian · ', terminal: 'xfce4-terminal --disable-server --geometry 90x24+120+80', termClass: 'xfce4-terminal', shots, prefix: 'debian-', timeout: 600000, settleMs: 6000 });
    await test('Codex 工具在 Debian 镜像中同样可用（apt / git / 服务）', async () => {
      const g = await call('vm_git', { args: ['--version'] }); assert(/git version/.test(g.output || g.stdout || ''), JSON.stringify(g));
      const p = await call('vm_pkg', { action: 'list' }); assert(/apt|dpkg/.test(JSON.stringify(p)) || (p.packages || []).length > 50, JSON.stringify(p).slice(0, 300));
    }, { timeout: 300000 });
    await test('切回命令行镜像，两个镜像的磁盘互相独立', async () => {
      await call('vm_shell', { command: 'echo debian > /root/which.txt' });
      await vm.setImage('alpine'); await vm.start();
      const r = await call('vm_shell', { command: 'cat /etc/alpine-release; cat /root/which.txt 2>/dev/null || echo none' });
      assert(/^3\./.test(r.stdout) && /none/.test(r.stdout), r.stdout);
    }, { timeout: 600000 });
    console.log(`      Debian GUI: boot ${bootMs} ms; ` + Object.entries(times).map(([k, v]) => `${k} ${v} ms`).join(', '));
  } finally { await vm.stop().catch(() => {}); }
};
