/* Computer-use tools for the graphical Linux VM images (Debian + XFCE on the desktop, Alpine + JWM on iPad).
 * The guest runs Xvfb :0 with -fbdir /run/aib-x, so a screenshot is the X framebuffer (XWD) converted to PNG inside the
 * guest with Pillow; input goes through xdotool. Built on the same guest primitives as codex-tools.js:
 *   io.sh(cmd, opts) -> { exitCode, stdout, stderr },  io.read(path, max) -> { data },  io.write(path, bytes)
 * Tools: vm_desktop, vm_screenshot, vm_click, vm_type, vm_key, vm_scroll, vm_drag. Every input action returns a fresh
 * screenshot so the model sees the effect. Screenshots are returned as `images` (shown to the user) and `modelImages`
 * (sent to vision-capable models). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIBVmGui = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const enc = (s) => new TextEncoder().encode(String(s));
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
  const num = (d) => ({ type: 'number', description: d });
  const str = (d) => ({ type: 'string', description: d });
  const obj = (properties, required) => ({ type: 'object', properties, required: required || [] });
  const SHOT_PY = '/persist/aib/aib-shot.py';
  const SHOT_VERSION = '2';
  // XWD (X Window Dump, written by Xvfb -fbdir) -> PNG
  const SHOT_SCRIPT = `# aib-shot ${SHOT_VERSION}: Xvfb framebuffer (XWD) -> PNG
import struct, sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
maxw = int(sys.argv[3]) if len(sys.argv) > 3 else 0
with open(src, 'rb') as f:
    hdr = f.read(100)
    v = struct.unpack('>25I', hdr)
    hsize, w, h, bo, bpp, bpl, ncolors = v[0], v[4], v[5], v[7], v[11], v[12], v[19]
    f.seek(hsize + ncolors * 12)
    data = f.read(bpl * h)
if bpp == 32:
    img = Image.frombuffer('RGB', (w, h), data, 'raw', 'BGRX' if bo == 0 else 'XRGB', bpl, 1)
elif bpp == 16:
    img = Image.frombuffer('RGB', (w, h), data, 'raw', 'BGR;16' if bo == 0 else 'RGB;16', bpl, 1)
else:
    img = Image.frombuffer('RGB', (w, h), data, 'raw', 'BGR' if bo == 0 else 'RGB', bpl, 1)
if maxw and w > maxw:
    img = img.resize((maxw, round(h * maxw / w)))
img.save(out, 'PNG', optimize=False, compress_level=3)
print(w, h, img.size[0], img.size[1])
`;
  const DEFS = [
    { name: 'vm_desktop', description: 'The graphical desktop of your Linux VM (only with the graphical image, chosen in Settings → Linux VM). action=start starts it (it also starts automatically for the other computer-use tools), status reports the screen size, stop ends the session, resize sets the screen size (e.g. 1280x800).',
      parameters: obj({ action: { type: 'string', enum: ['start', 'status', 'stop', 'resize'] }, width: num('resize: width in pixels'), height: num('resize: height in pixels') }, ['action']) },
    { name: 'vm_screenshot', description: 'Take a screenshot of the Linux VM desktop. Coordinates for vm_click / vm_scroll / vm_drag are pixels in this screenshot (origin top-left).',
      parameters: obj({}) },
    { name: 'vm_click', description: 'Move the mouse to (x, y) on the VM desktop and click. Returns a new screenshot.',
      parameters: obj({ x: num('x in screenshot pixels'), y: num('y in screenshot pixels'), button: { type: 'string', enum: ['left', 'right', 'middle'] }, double: { type: 'boolean', description: 'double-click' } }, ['x', 'y']) },
    { name: 'vm_type', description: 'Type text into the focused window of the VM desktop (Unicode supported). Use vm_key for Enter, Tab or shortcuts. Returns a new screenshot.',
      parameters: obj({ text: str('text to type') }, ['text']) },
    { name: 'vm_key', description: 'Press keys on the VM desktop, xdotool syntax: "Return", "Tab", "Escape", "ctrl+l", "ctrl+shift+t", "alt+F4", "super"; several keys separated by spaces are pressed one after another. Returns a new screenshot.',
      parameters: obj({ keys: str('key or key combination') }, ['keys']) },
    { name: 'vm_scroll', description: 'Scroll at (x, y) on the VM desktop. Returns a new screenshot.',
      parameters: obj({ x: num('x'), y: num('y'), direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: num('number of wheel steps (default 5)') }, ['x', 'y', 'direction']) },
    { name: 'vm_drag', description: 'Drag with the left mouse button from (x1, y1) to (x2, y2) on the VM desktop. Returns a new screenshot.',
      parameters: obj({ x1: num('start x'), y1: num('start y'), x2: num('end x'), y2: num('end y') }, ['x1', 'y1', 'x2', 'y2']) }
  ];
  const LABELS = { vm_desktop: ['图形桌面', 'Desktop'], vm_screenshot: ['截图', 'Screenshot'], vm_click: ['点击', 'Click'], vm_type: ['输入文字', 'Type'], vm_key: ['按键', 'Keys'], vm_scroll: ['滚动', 'Scroll'], vm_drag: ['拖动', 'Drag'] };
  const X = 'export DISPLAY=:0 XAUTHORITY=/root/.Xauthority HOME=/root; ';
  const b64 = (u8) => { if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64'); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

  function create(io, opts) {
    opts = opts || {};
    const sh = async (cmd, o) => { const r = await io.sh(cmd, Object.assign({ timeoutSec: 60, quick: true }, o || {})); return { code: r.exitCode, out: r.stdout || '', err: r.stderr || '' }; };
    let ready = false;
    async function ensure(ctx) {
      if (ready) { const r = await sh('[ -e /tmp/.X11-unix/X0 ] && [ -e /run/aib-x/Xvfb_screen0 ] && echo up'); if (r.out.trim() === 'up') return; ready = false; }
      const v = await sh(`grep -q 'aib-shot ${SHOT_VERSION}:' ${SHOT_PY} 2>/dev/null && echo ok; command -v Xvfb >/dev/null && echo xvfb; command -v xdotool >/dev/null && echo xdotool; [ -e /tmp/.X11-unix/X0 ] && [ -e /run/aib-x/Xvfb_screen0 ] && echo up`);
      if (!/xvfb/.test(v.out) || !/xdotool/.test(v.out)) throw new Error('当前虚拟机镜像没有图形桌面。请在 设置 → Linux 虚拟机 中切换到图形镜像（首次使用时下载） / this VM image has no graphical desktop: switch to the graphical image in Settings → Linux VM');
      if (!/ok/.test(v.out)) await io.write(SHOT_PY, enc(SHOT_SCRIPT));
      if (!/up/.test(v.out)) {
        ctx && ctx.status && ctx.status('正在启动图形桌面…');
        await sh('if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then systemctl start aib-desktop; else pgrep -x Xvfb >/dev/null || (setsid /usr/local/sbin/aib-desktop </dev/null >/var/log/aib-desktop.log 2>&1 &); fi; i=0; while { [ ! -e /tmp/.X11-unix/X0 ] || [ ! -e /run/aib-x/Xvfb_screen0 ]; } && [ $i -lt 600 ]; do sleep 0.2; i=$((i+1)); done; [ -e /run/aib-x/Xvfb_screen0 ] && echo up', { timeoutSec: 180 });
        const c = await sh('[ -e /run/aib-x/Xvfb_screen0 ] && echo up'); if (c.out.trim() !== 'up') throw new Error('图形桌面启动失败（见 /var/log/aib-desktop.log）');
        await new Promise(r => setTimeout(r, opts.settleMs || 3000)); // let the session draw its panels
      }
      ready = true;
    }
    async function shot() {
      const r = await sh(`python3 ${SHOT_PY} /run/aib-x/Xvfb_screen0 /tmp/aib-shot.png ${opts.maxWidth || 0}`, { timeoutSec: 120 });
      if (r.code !== 0) throw new Error('截图失败：' + (r.err || r.out).slice(-500));
      const [w, h, iw, ih] = r.out.trim().split(/\s+/).map(Number);
      const f = await io.read('/tmp/aib-shot.png', 32 * 1024 * 1024);
      const url = 'data:image/png;base64,' + b64(f.data);
      return { screen: { width: w, height: h }, image: { width: iw, height: ih }, scale: iw && w ? iw / w : 1, url };
    }
    const asResult = (s, extra) => Object.assign({ screen: s.screen, imageSize: s.image, images: [{ name: 'screen.png', dataUrl: s.url }], modelImages: [s.url] }, extra || {});
    const toScreen = (s0, x, y) => { const k = s0 || 1; return [Math.round(Number(x) / k), Math.round(Number(y) / k)]; };
    let lastScale = 1;
    async function act(cmd, ctx, wait) {
      await ensure(ctx);
      const r = await sh(X + cmd, { timeoutSec: 120 });
      if (r.code !== 0) throw new Error('操作失败：' + (r.err || r.out).slice(-500));
      await new Promise(res => setTimeout(res, wait == null ? 600 : wait));
      const s = await shot(); lastScale = s.scale; return asResult(s);
    }
    const BTN = { left: 1, middle: 2, right: 3 };
    const run = {
      async vm_desktop(a, ctx) {
        if (a.action === 'stop') { await sh('if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then systemctl stop aib-desktop; else pkill -x jwm; pkill -x Xvfb; pkill -f /usr/local/sbin/aib-desktop; fi; true'); ready = false; return { stopped: true }; }
        if (a.action === 'resize') {
          const w = Math.max(640, Math.min(2560, Math.floor(Number(a.width) || 1280))), h = Math.max(480, Math.min(1600, Math.floor(Number(a.height) || 800)));
          await io.write('/persist/aib/screen', enc(`${w}x${h}`)); await run.vm_desktop({ action: 'stop' }, ctx); await ensure(ctx);
          const s = await shot(); lastScale = s.scale; return asResult(s, { resized: true });
        }
        await ensure(ctx); const s = await shot(); lastScale = s.scale;
        return a.action === 'status' ? { running: true, screen: s.screen } : asResult(s, { running: true });
      },
      async vm_screenshot(a, ctx) { await ensure(ctx); const s = await shot(); lastScale = s.scale; return asResult(s); },
      async vm_click(a, ctx) { const [x, y] = toScreen(lastScale, a.x, a.y); return act(`xdotool mousemove --sync ${x} ${y} click ${a.double ? '--repeat 2 --delay 120 ' : ''}${BTN[a.button] || 1}`, ctx); },
      async vm_type(a, ctx) { if (a.text == null || a.text === '') throw new Error('缺少 text'); return act(`xdotool type --delay 15 -- ${q(String(a.text))}`, ctx, 400); },
      async vm_key(a, ctx) { const keys = String(a.keys || '').trim().split(/\s+/).filter(Boolean); if (!keys.length) throw new Error('缺少 keys'); for (const k of keys) if (!/^[A-Za-z0-9_+\-]+$/.test(k)) throw new Error('无效按键：' + k); return act(`xdotool key --delay 60 ${keys.join(' ')}`, ctx); },
      async vm_scroll(a, ctx) { const [x, y] = toScreen(lastScale, a.x, a.y); const b = { up: 4, down: 5, left: 6, right: 7 }[a.direction] || 5; const n = Math.max(1, Math.min(30, Math.floor(Number(a.amount) || 5))); return act(`xdotool mousemove --sync ${x} ${y} click --repeat ${n} --delay 40 ${b}`, ctx); },
      async vm_drag(a, ctx) { const [x1, y1] = toScreen(lastScale, a.x1, a.y1), [x2, y2] = toScreen(lastScale, a.x2, a.y2); return act(`xdotool mousemove --sync ${x1} ${y1} mousedown 1 sleep 0.15 mousemove --sync ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)} sleep 0.1 mousemove --sync ${x2} ${y2} sleep 0.1 mouseup 1`, ctx); }
    };
    async function call(name, a, ctx) { if (!run[name]) throw new Error('unknown tool: ' + name); return run[name](a || {}, ctx || {}); }
    // for the in-app viewer: raw screenshot + input without the extra screenshot round trip
    async function viewerShot() { await ensure(); const s = await shot(); lastScale = s.scale; return { screen: s.screen, dataUrl: s.url }; }
    async function viewerInput(ev) {
      await ensure();
      const x = Math.round(Number(ev.x) || 0), y = Math.round(Number(ev.y) || 0);
      let cmd;
      if (ev.type === 'click') cmd = `xdotool mousemove --sync ${x} ${y} click ${ev.double ? '--repeat 2 --delay 120 ' : ''}${BTN[ev.button] || 1}`;
      else if (ev.type === 'scroll') cmd = `xdotool mousemove --sync ${x} ${y} click --repeat ${Math.max(1, Math.min(10, Number(ev.amount) || 3))} ${ev.dy < 0 ? 4 : 5}`;
      // touch trackpad (v3.0.1): pointer moves and a held button for dragging
      else if (ev.type === 'move') cmd = `xdotool mousemove ${x} ${y}`;
      else if (ev.type === 'down' || ev.type === 'up') cmd = `xdotool mousemove --sync ${x} ${y} ${ev.type === 'down' ? 'mousedown' : 'mouseup'} ${BTN[ev.button] || 1}`;
      else if (ev.type === 'type') cmd = `xdotool type --delay 10 -- ${q(String(ev.text || ''))}`;
      else if (ev.type === 'key') { if (!/^[A-Za-z0-9_+\-]+$/.test(String(ev.key || ''))) throw new Error('bad key'); cmd = `xdotool key ${ev.key}`; }
      else throw new Error('bad event');
      const r = await sh(X + cmd); return { ok: r.code === 0 };
    }
    return { call, has: (n) => !!run[n], viewerShot, viewerInput };
  }
  return { DEFS, LABELS, create, NAMES: DEFS.map(d => d.name), SHOT_SCRIPT };
});
