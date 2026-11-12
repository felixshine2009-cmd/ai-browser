'use strict';
// Shared end-to-end checks for the computer-use tools on a graphical VM image (desktop Debian + XFCE on QEMU,
// iPad Alpine + JWM on v86 in the simulator). call(name, args) runs a compute tool. Saves screenshots to opts.shots.
const fs = require('fs'), path = require('path');
module.exports = async function guiChecks(h, call, opts) {
  const { test, assert, eq } = h;
  const tag = opts.tag || '';
  const timeout = opts.timeout || 600000;
  const times = {};
  const timed = async (k, fn) => { const t0 = Date.now(); try { return await fn(); } finally { times[k] = Date.now() - t0; } };
  const save = (r, name) => { if (!opts.shots || !r || !r.images || !r.images[0]) return; fs.mkdirSync(opts.shots, { recursive: true }); fs.writeFileSync(path.join(opts.shots, name), Buffer.from(r.images[0].dataUrl.split(',')[1], 'base64')); };
  const png = (r) => { const b = Buffer.from(r.images[0].dataUrl.split(',')[1], 'base64'); assert(b.slice(1, 4).toString() === 'PNG', 'png'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }; };
  let screen;
  await test(tag + '启动图形桌面并截图（首次启动计时）', async () => {
    const r = await timed('desktopStart', () => call('vm_desktop', { action: 'start' }));
    assert(r.screen && r.screen.width >= 640, 'screen size ' + JSON.stringify(r.screen));
    screen = r.screen; const p = png(r); eq(p.w, r.imageSize.width); eq(p.h, r.imageSize.height);
    assert(Array.isArray(r.modelImages) && r.modelImages.length === 1, 'modelImages for vision models');
    save(r, (opts.prefix || '') + 'boot-desktop.png');
  }, { timeout });
  await test(tag + 'vm_screenshot：画面不是纯色（桌面已绘制）', async () => {
    await new Promise(r => setTimeout(r, opts.settleMs || 4000));
    const r = await timed('screenshot', () => call('vm_screenshot', {}));
    const s = await call('vm_shell', { command: `python3 -c "from PIL import Image; im=Image.open('/tmp/aib-shot.png').convert('RGB'); print(len(set(im.resize((64,40)).getdata())))"` });
    assert(Number(String(s.stdout).trim()) > 4, 'distinct colours: ' + s.stdout);
    save(r, (opts.prefix || '') + 'desktop.png');
  }, { timeout });
  await test(tag + 'vm_click：鼠标移动到指定坐标并点击', async () => {
    const x = Math.round(screen.width / 2), y = Math.round(screen.height / 2);
    const r = await timed('click', () => call('vm_click', { x, y }));
    assert(r.images && r.images.length, 'screenshot after click');
    const s = await call('vm_shell', { command: 'DISPLAY=:0 xdotool getmouselocation --shell' });
    assert(new RegExp('X=' + x + '\\b').test(s.stdout) && new RegExp('Y=' + y + '\\b').test(s.stdout), s.stdout);
  }, { timeout });
  await test(tag + 'vm_type + vm_key：在终端里输入命令并回车，命令真的执行了', async () => {
    await call('vm_shell', { command: 'rm -f /tmp/gui-ok.txt' });
    await call('vm_bg', { action: 'start', name: 'term', command: `export DISPLAY=:0 HOME=/root; ${opts.terminal}` });
    // wait for the terminal window, then focus it
    let wid = '';
    for (let i = 0; i < 90 && !wid; i++) { const s = await call('vm_shell', { command: `DISPLAY=:0 xdotool search --onlyvisible --class '${opts.termClass}' 2>/dev/null | tail -1` }); wid = String(s.stdout || '').trim(); if (!wid) await new Promise(r => setTimeout(r, 1000)); }
    assert(wid, 'terminal window appeared');
    await call('vm_shell', { command: `DISPLAY=:0 xdotool windowactivate --sync ${wid} 2>/dev/null || DISPLAY=:0 xdotool windowfocus --sync ${wid}; sleep 0.5` });
    const r1 = await timed('type', () => call('vm_type', { text: 'echo AIB-GUI-OK > /tmp/gui-ok.txt' }));
    save(r1, (opts.prefix || '') + 'typed.png');
    await timed('key', () => call('vm_key', { keys: 'Return' }));
    let ok = '';
    for (let i = 0; i < 30 && !ok; i++) { const s = await call('vm_shell', { command: 'cat /tmp/gui-ok.txt 2>/dev/null' }); ok = String(s.stdout || '').trim(); if (!ok) await new Promise(r => setTimeout(r, 500)); }
    eq(ok, 'AIB-GUI-OK');
    await call('vm_type', { text: 'ls / && uname -a' }); const r2 = await call('vm_key', { keys: 'Return' });
    save(r2, (opts.prefix || '') + 'terminal.png');
  }, { timeout });
  await test(tag + 'vm_scroll / vm_drag / vm_key 组合键返回新截图', async () => {
    const a = await timed('scroll', () => call('vm_scroll', { x: 300, y: 300, direction: 'down', amount: 3 }));
    const b = await call('vm_drag', { x1: 200, y1: 200, x2: 260, y2: 240 });
    const c = await call('vm_key', { keys: 'ctrl+l' });
    for (const r of [a, b, c]) assert(r.images && r.images.length && r.screen, 'screenshot');
  }, { timeout });
  await test(tag + '无效按键被拒绝（不会拼进 shell 命令）', async () => {
    let err = ''; try { const r = await call('vm_key', { keys: 'a;touch /tmp/pwn' }); err = r.error || ''; } catch (e) { err = String(e.message); }
    assert(/无效按键/.test(err), err);
    const s = await call('vm_shell', { command: 'ls /tmp/pwn 2>/dev/null; true' }); eq(String(s.stdout).trim(), '');
  }, { timeout });
  return times;
};
