// Viewer for the graphical Linux VM desktop: polls screenshots, forwards mouse / wheel / keyboard to the guest (xdotool).
(async function () {
  await I18N.init();
  const T = (zh, en) => (I18N.lang === 'en' ? en : zh);
  document.title = T('Linux 桌面', 'Linux desktop');
  const root = document.getElementById('root');
  root.innerHTML = `<div class="vmd-bar"><h1 class="page-title">${T('Linux 桌面', 'Linux desktop')}</h1><span class="vmd-st" id="st"></span><span style="flex:1"></span>
    <label class="vmd-kb"><input type="checkbox" id="live" checked/> ${T('实时刷新', 'Live')}</label>
<button class="btn-secondary" id="refresh">${T('刷新', 'Refresh')}</button></div>
    <div class="vmd-wrap" id="wrap" tabindex="0"><img id="scr" alt="" draggable="false"/><div class="vmd-cursor" id="cursor" hidden></div><div class="vmd-empty" id="empty"></div></div>
    <div class="vmd-hint">${T('点击画面后可直接用键盘输入；AI 也可以通过 vm_screenshot / vm_click / vm_type 等工具操作这个桌面。', 'Click the screen, then type; the AI can operate this desktop too, through vm_screenshot / vm_click / vm_type.')}<span class="vmd-touchhint">${T('触控操作与触控板相同：单指移动指针，轻点为左键，长按为右键，双指拖动为滚动，轻点两下并拖动可按住左键拖动。', 'Touch works like a trackpad: drag one finger to move the pointer, tap to click, touch and hold for a right click, drag two fingers to scroll, and tap then drag to drag with the button held.')}</span></div>`;
  const css = document.createElement('style');
  css.textContent = `.vmd-bar{display:flex;align-items:center;gap:10px;margin-bottom:10px}.vmd-bar .page-title{margin:0}.vmd-st{color:var(--muted,#888);font-size:13px}
  .vmd-wrap{position:relative;outline:none;border:1px solid var(--line,#8884);border-radius:10px;overflow:hidden;background:#000;min-height:240px;display:flex;align-items:center;justify-content:center}
  .vmd-wrap:focus{box-shadow:0 0 0 2px var(--accent,#4a8cff)}.vmd-wrap img{display:block;max-width:100%;height:auto;cursor:default;user-select:none}
  .vmd-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ccc;text-align:center;padding:20px;font-size:14px}.vmd-empty:empty{display:none}
  .vmd-hint{margin-top:8px;color:var(--muted,#888);font-size:12px}.vmd-kb{font-size:13px;display:flex;gap:4px;align-items:center}
  body.vmdesk .page-root{max-width:1400px}
  .vmd-wrap{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;overscroll-behavior:none}
  .vmd-wrap img{touch-action:none;-webkit-touch-callout:none}
  html.vmd-touch,html.vmd-touch body{overscroll-behavior:none}
  .vmd-cursor{position:absolute;left:0;top:0;width:14px;height:20px;pointer-events:none;z-index:2;
    background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 20'%3E%3Cpath d='M1 1v16l4-4 3 6 2-1-3-6h6z' fill='%23fff' stroke='%23000' stroke-width='1.2'/%3E%3C/svg%3E") no-repeat;}
  .vmd-cursor[hidden]{display:none}.vmd-cursor.down{filter:drop-shadow(0 0 3px #4a8cff)}
  .vmd-touchhint{display:none}html.vmd-touch .vmd-touchhint{display:block;margin-top:4px}`;
  document.head.appendChild(css);
  const $ = (id) => document.getElementById(id);
  const img = $('scr'), wrap = $('wrap'), empty = $('empty'), stEl = $('st');
  let screen = null, busy = false, last = 0;
  async function refresh(force) {
    if (busy || (!force && !$('live').checked) || document.hidden) return;
    busy = true;
    try {
      const r = await window.aib.invoke('vm:guiShot');
      if (r.ok) { img.src = r.dataUrl; screen = r.screen; empty.textContent = ''; stEl.textContent = `${r.screen.width}×${r.screen.height}`; last = Date.now(); }
      else if (r.needGui) { empty.innerHTML = T('当前使用的是命令行镜像。请在 设置 → Python 与 Linux → Linux 虚拟机 中选择“图形桌面（Debian + XFCE）”。', 'The VM uses the command-line image. Choose “Graphical desktop (Debian + XFCE)” in Settings → Python & Linux → Linux VM.'); stEl.textContent = ''; }
      else { empty.textContent = r.error || T('无法获取画面', 'No picture'); }
    } catch (e) { empty.textContent = String(e.message || e); }
    finally { busy = false; }
  }
  const pos = (e) => { const b = img.getBoundingClientRect(); return { x: Math.round((e.clientX - b.left) * screen.width / b.width), y: Math.round((e.clientY - b.top) * screen.height / b.height) }; };
  // mouse-compatibility events a touch can still produce (contextmenu after a long press, click after a tap) are ignored
  let lastTouch = 0; const fromTouch = () => Date.now() - lastTouch < 1000;
  ['touchstart', 'touchmove', 'touchend'].forEach(n => document.addEventListener(n, () => { lastTouch = Date.now(); }, { capture: true, passive: true }));
  const send = async (ev) => { await window.aib.invoke('vm:guiInput', ev); setTimeout(() => refresh(true), 250); };
  // pointer moves are coalesced: at most one in flight, only the newest position is sent next (the guest runs one
  // xdotool command per event, which is slow in the iPad's v86 VM)
  let moveBusy = false, moveNext = null;
  const sendMove = (p) => {
    moveNext = p; if (moveBusy) return;
    const go = async () => { const q = moveNext; moveNext = null; if (!q) { moveBusy = false; return; } moveBusy = true;
      try { await window.aib.invoke('vm:guiInput', { type: 'move', x: q.x, y: q.y }); } catch {} go(); };
    go();
  };
  // ---- touch trackpad (v3.0.1): one finger moves the pointer relatively, tap = left click, touch and hold = right
  // click, two fingers = scroll wheel, tap then drag = drag with the left button held. Apple Pencil points directly.
  const cursorEl = $('cursor');
  let cur = null; // pointer position in guest screen pixels
  const imgBox = () => img.getBoundingClientRect();
  const paintCursor = () => {
    if (!screen || !cur) { cursorEl.hidden = true; return; }
    const b = imgBox(), w = wrap.getBoundingClientRect();
    cursorEl.hidden = false;
    cursorEl.style.transform = `translate(${b.left - w.left - wrap.clientLeft + cur.x * b.width / screen.width}px,${b.top - w.top - wrap.clientTop + cur.y * b.height / screen.height}px)`;
  };
  const clampCur = () => { cur.x = Math.max(0, Math.min(screen.width - 1, Math.round(cur.x))); cur.y = Math.max(0, Math.min(screen.height - 1, Math.round(cur.y))); };
  const at = (extra) => Object.assign({ x: cur.x, y: cur.y }, extra);
  const TAP_MS = 280, HOLD_MS = 550, SLOP = 8, SPEED = 1.6, WHEEL_STEP = 36;
  let g = null;           // current gesture
  let lastTap = 0, tapTimer = null, lastTapPt = null;
  const touchPt = (t) => ({ x: t.clientX, y: t.clientY });
  const isPencil = (t) => t && t.touchType === 'stylus';
  wrap.addEventListener('touchstart', (e) => {
    e.preventDefault(); if (!screen) return;
    document.documentElement.classList.add('vmd-touch');
    wrap.focus({ preventScroll: true });
    if (!cur) cur = { x: Math.round(screen.width / 2), y: Math.round(screen.height / 2) };
    const ts = e.touches;
    if (ts.length === 1 && isPencil(ts[0])) { // Apple Pencil: points where it touches (absolute)
      const p = pos(ts[0]); cur = { x: p.x, y: p.y }; clampCur(); paintCursor();
      g = { kind: 'pencil', start: touchPt(ts[0]), t0: Date.now(), moved: false, down: false }; return;
    }
    if (ts.length >= 2) {
      if (g && g.holdT) clearTimeout(g.holdT);
      if (g && g.kind === 'drag' && g.down) send(at({ type: 'up', button: 'left' }));
      const y = (ts[0].clientY + ts[1].clientY) / 2, x = (ts[0].clientX + ts[1].clientX) / 2;
      g = { kind: 'two', y0: y, x0: x, acc: 0, t0: Date.now(), moved: false }; return;
    }
    const p = touchPt(ts[0]);
    // second touch shortly after a tap: tap-and-drag holds the left button
    const near = lastTapPt && Math.hypot(p.x - lastTapPt.x, p.y - lastTapPt.y) < 60;
    const afterTap = Date.now() - lastTap < TAP_MS + 60 && near;
    if (afterTap && tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
    g = { kind: afterTap ? 'second' : 'one', start: p, last: p, t0: Date.now(), moved: false, down: false };
    g.holdT = afterTap ? null : setTimeout(() => { if (g && g.kind === 'one' && !g.moved) { g.kind = 'held'; send(at({ type: 'click', button: 'right' })); flash(); } }, HOLD_MS);
  }, { passive: false });
  wrap.addEventListener('touchmove', (e) => {
    e.preventDefault(); if (!screen || !g) return;
    const ts = e.touches;
    if (g.kind === 'pencil') {
      const p = pos(ts[0]);
      if (!g.moved && Math.hypot(ts[0].clientX - g.start.x, ts[0].clientY - g.start.y) > SLOP) { g.moved = true; g.down = true; send(at({ type: 'down', button: 'left' })); cursorEl.classList.add('down'); }
      cur = { x: p.x, y: p.y }; clampCur(); paintCursor(); if (g.moved) sendMove(cur); return;
    }
    if (g.kind === 'two') {
      if (ts.length < 2) return;
      const y = (ts[0].clientY + ts[1].clientY) / 2;
      g.acc += g.y0 - y; g.y0 = y; if (Math.abs(g.acc) > 3) g.moved = true;
      while (Math.abs(g.acc) >= WHEEL_STEP) { const dir = g.acc > 0 ? 1 : -1; g.acc -= dir * WHEEL_STEP; send(at({ type: 'scroll', dy: dir, amount: 1 })); }
      return;
    }
    if (g.kind === 'held') return;
    const p = touchPt(ts[0]);
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) <= SLOP) return;
    if (!g.moved) { g.moved = true; if (g.holdT) clearTimeout(g.holdT); if (g.kind === 'second') { g.kind = 'drag'; g.down = true; send(at({ type: 'down', button: 'left' })); cursorEl.classList.add('down'); } }
    const b = imgBox(), k = SPEED * screen.width / b.width;
    cur.x += (p.x - g.last.x) * k; cur.y += (p.y - g.last.y) * k; g.last = p;
    clampCur(); paintCursor(); sendMove(cur);
  }, { passive: false });
  const endTouch = (e) => {
    e.preventDefault(); if (!screen || !g) return;
    if (e.touches && e.touches.length) { if (g.kind === 'two' && e.touches.length === 1) g.ended = true; return; }
    const G = g; g = null; if (G.holdT) clearTimeout(G.holdT);
    const quick = Date.now() - G.t0 < TAP_MS;
    if (G.kind === 'pencil') { if (G.down) { send(at({ type: 'up', button: 'left' })); cursorEl.classList.remove('down'); } else send(at({ type: 'click', button: 'left', double: false })); return; }
    if (G.kind === 'two') { if (!G.moved && quick) send(at({ type: 'click', button: 'right' })); return; } // two-finger tap = right click
    if (G.kind === 'drag') { send(at({ type: 'up', button: 'left' })); cursorEl.classList.remove('down'); return; }
    if (G.kind === 'second') { if (!G.moved) { lastTap = 0; send(at({ type: 'click', button: 'left', double: true })); } return; } // double tap
    if (G.kind === 'one' && !G.moved && quick) {
      lastTap = Date.now(); lastTapPt = G.start;
      tapTimer = setTimeout(() => { tapTimer = null; send(at({ type: 'click', button: 'left', double: false })); }, TAP_MS);
    }
  };
  wrap.addEventListener('touchend', endTouch, { passive: false });
  wrap.addEventListener('touchcancel', endTouch, { passive: false });
  const flash = () => { cursorEl.classList.add('down'); setTimeout(() => cursorEl.classList.remove('down'), 250); };
  window.addEventListener('resize', paintCursor);
  img.addEventListener('load', paintCursor);
  // hardware mouse / trackpad hover moves the guest pointer too
  let hoverT = 0;
  img.addEventListener('mousemove', (e) => { if (!screen || fromTouch() || e.buttons || Date.now() - hoverT < 80) return; hoverT = Date.now(); const p = pos(e); cur = { x: p.x, y: p.y }; cursorEl.hidden = true; sendMove(p); });
  window.__vmdTest = { state: () => ({ cur, screen, gesture: g && g.kind }) };
  img.addEventListener('mousedown', (e) => { e.preventDefault(); wrap.focus(); });
  img.addEventListener('click', (e) => { if (!screen || fromTouch()) return; send(Object.assign({ type: 'click', button: 'left', double: false }, pos(e))); });
  img.addEventListener('dblclick', (e) => { if (!screen || fromTouch()) return; send(Object.assign({ type: 'click', button: 'left', double: true }, pos(e))); });
  img.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!screen || fromTouch()) return; send(Object.assign({ type: 'click', button: 'right' }, pos(e))); });
  img.addEventListener('wheel', (e) => { e.preventDefault(); if (!screen) return; send(Object.assign({ type: 'scroll', dy: e.deltaY, amount: Math.min(5, Math.ceil(Math.abs(e.deltaY) / 60)) }, pos(e))); }, { passive: false });
  const KEYMAP = { Enter: 'Return', Backspace: 'BackSpace', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next', ' ': 'space' };
  let typed = '', flushT = null;
  const flush = () => { if (typed) { const t = typed; typed = ''; send({ type: 'type', text: t }); } };
  wrap.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const mods = (e.ctrlKey ? 'ctrl+' : '') + (e.altKey ? 'alt+' : '') + (e.metaKey ? 'super+' : '');
    if (!mods && e.key.length === 1) { e.preventDefault(); typed += e.key; clearTimeout(flushT); flushT = setTimeout(flush, 120); return; }
    let k = KEYMAP[e.key] || (/^F\d{1,2}$/.test(e.key) ? e.key : (e.key.length === 1 ? e.key.toLowerCase() : ''));
    if (!k) return;
    e.preventDefault(); flush();
    send({ type: 'key', key: mods + (e.shiftKey && mods ? 'shift+' : '') + k });
  });
  wrap.addEventListener('compositionend', (e) => { if (e.data) send({ type: 'type', text: e.data }); });
  $('refresh').onclick = () => refresh(true);
  setInterval(() => { if (Date.now() - last > 1200) refresh(false); }, 400);
  document.addEventListener('visibilitychange', () => refresh(true));
  refresh(true);
})();
