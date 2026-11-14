'use strict';
// Touch trackpad checks for the VM desktop viewer (aibrowser://vmdesktop) with real touch events sent over CDP.
// Main process runs with AIB_VM_GUI_FAKE=1 (fixed 1024×768 picture, input recorded).
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function touchKit(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
  const box = await page.evaluate(() => { const b = document.getElementById('scr').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  return {
    box, c,
    tap: async (p = c) => { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); },
    drag: async (from, dx, dy, steps = 8, hold = 0) => { await T('touchStart', [from]); if (hold) await sleep(hold); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: from.x + dx * i / steps, y: from.y + dy * i / steps }]); await sleep(16); } await T('touchEnd', []); },
    press: async (p = c, ms = 800) => { await T('touchStart', [p]); await sleep(ms); await T('touchEnd', []); },
    two: async (dy, steps = 8, from = c) => { const a = { x: from.x - 30, y: from.y }, b = { x: from.x + 30, y: from.y }; await T('touchStart', [a, b]); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: a.x, y: a.y + dy * i / steps }, { x: b.x, y: b.y + dy * i / steps }]); await sleep(16); } await T('touchEnd', []); },
    tapDrag: async (dx, dy, p = c) => { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(90); await T('touchStart', [p]); for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: p.x + dx * i / 8, y: p.y + dy * i / 8 }]); await sleep(16); } await sleep(150); await T('touchEnd', []); }
  };
}

async function checkVmTouch({ page: p, invoke, until, assert, eq }) {
  await until(async () => p.evaluate(() => { const s = window.__vmdTest && window.__vmdTest.state(); return !!(s && s.screen); }), 15000, 'viewer has a picture');
  const log = (clear) => invoke('vm:guiFakeLog', !!clear);
  const k = await touchKit(p);
  const scrollY0 = await p.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]);
  await log(true);
  // one-finger drag moves the pointer (relative), not the page
  await k.drag({ x: k.c.x - 40, y: k.c.y - 40 }, 100, 60);
  await sleep(400);
  let L = await log(true);
  const moves = L.filter(e => e.type === 'move');
  assert(moves.length >= 1, 'pointer moves: ' + JSON.stringify(L));
  assert(!L.some(e => e.type === 'click' || e.type === 'down'), 'a drag does not click: ' + JSON.stringify(L));
  const st = await p.evaluate(() => window.__vmdTest.state());
  assert(st.cur.x > 512 + 100 && st.cur.y > 384 + 50, 'pointer moved right/down from the centre by more than the finger: ' + JSON.stringify(st.cur));
  eq(await p.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]), scrollY0, 'page did not pan');
  eq(await p.evaluate(() => getComputedStyle(document.getElementById('wrap')).touchAction), 'none');
  eq(await p.locator('#cursor').isVisible(), true, 'pointer drawn');
  // tap = left click at the pointer (after the double-tap window)
  await k.tap(); await sleep(600);
  L = await log(true);
  eq(L.map(e => e.type + ':' + (e.button || '') + (e.double ? ':double' : '')), ['click:left'], 'tap');
  eq([L[0].x, L[0].y], [st.cur.x, st.cur.y], 'click at the pointer, not at the finger');
  // touch and hold = right click
  await k.press(); await sleep(300);
  L = await log(true);
  eq(L.map(e => e.type + ':' + e.button), ['click:right'], 'long press');
  // two-finger drag = wheel (fingers up = scroll down content? moving fingers up scrolls down, like a trackpad)
  await k.two(-150); await sleep(300);
  L = await log(true);
  assert(L.length >= 3 && L.every(e => e.type === 'scroll' && e.dy > 0), 'two-finger scroll down: ' + JSON.stringify(L));
  await k.two(120); await sleep(300);
  L = await log(true);
  assert(L.length >= 2 && L.every(e => e.type === 'scroll' && e.dy < 0), 'two-finger scroll up: ' + JSON.stringify(L));
  // tap then drag = drag with the left button held
  await k.tapDrag(-80, -40); await sleep(500);
  L = await log(true);
  const seq = L.filter(e => e.type !== 'move').map(e => e.type + ':' + e.button);
  eq(seq, ['down:left', 'up:left'], 'tap-and-drag: ' + JSON.stringify(L));
  assert(L.some(e => e.type === 'move'), 'moves while held');
  const iDown = L.findIndex(e => e.type === 'down'), iUp = L.findIndex(e => e.type === 'up');
  assert(L.slice(iDown, iUp).some(e => e.type === 'move'), 'moved between down and up');
  // double tap = double click
  await k.tap(); await sleep(90); await k.tap(); await sleep(500);
  L = await log(true);
  eq(L.map(e => e.type + ':' + e.button + (e.double ? ':double' : '')), ['click:left:double'], 'double tap');
}

async function checkVmMouse({ page: p, invoke, eq }) {
  // a hardware mouse keeps working: click at the mouse position, right click, wheel
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
  await sleep(1100); // mouse-compatibility events right after a touch are ignored by design
  await invoke('vm:guiFakeLog', true);
  const b = await p.evaluate(() => { const r = document.getElementById('scr').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await p.mouse.move(b.x + b.w / 4, b.y + b.h / 4); await sleep(150);
  await p.mouse.click(b.x + b.w / 4, b.y + b.h / 4); await sleep(300);
  await p.mouse.click(b.x + b.w / 4, b.y + b.h / 4, { button: 'right' }); await sleep(300);
  await p.mouse.wheel(0, 120); await sleep(300);
  const L = await invoke('vm:guiFakeLog', true);
  const clicks = L.filter(e => e.type !== 'move');
  eq(clicks.map(e => e.type + ':' + (e.button || '')), ['click:left', 'click:right', 'scroll:'], JSON.stringify(L));
  eq([clicks[0].x, clicks[0].y], [256, 192], 'mouse click at the mouse position');
}

module.exports = { checkVmTouch, checkVmMouse };
