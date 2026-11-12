// Viewer for the graphical Linux VM desktop: polls screenshots, forwards mouse / wheel / keyboard to the guest (xdotool).
(async function () {
  await I18N.init();
  const T = (zh, en) => (I18N.lang === 'en' ? en : zh);
  document.title = T('Linux 桌面', 'Linux desktop');
  const root = document.getElementById('root');
  root.innerHTML = `<div class="vmd-bar"><h1 class="page-title">${T('Linux 桌面', 'Linux desktop')}</h1><span class="vmd-st" id="st"></span><span style="flex:1"></span>
    <label class="vmd-kb"><input type="checkbox" id="live" checked/> ${T('实时刷新', 'Live')}</label>
<button class="btn-secondary" id="refresh">${T('刷新', 'Refresh')}</button></div>
    <div class="vmd-wrap" id="wrap" tabindex="0"><img id="scr" alt="" draggable="false"/><div class="vmd-empty" id="empty"></div></div>
    <div class="vmd-hint">${T('点击画面后可直接用键盘输入；AI 也可以通过 vm_screenshot / vm_click / vm_type 等工具操作这个桌面。', 'Click the screen, then type; the AI can operate this desktop too, through vm_screenshot / vm_click / vm_type.')}</div>`;
  const css = document.createElement('style');
  css.textContent = `.vmd-bar{display:flex;align-items:center;gap:10px;margin-bottom:10px}.vmd-bar .page-title{margin:0}.vmd-st{color:var(--muted,#888);font-size:13px}
  .vmd-wrap{position:relative;outline:none;border:1px solid var(--line,#8884);border-radius:10px;overflow:hidden;background:#000;min-height:240px;display:flex;align-items:center;justify-content:center}
  .vmd-wrap:focus{box-shadow:0 0 0 2px var(--accent,#4a8cff)}.vmd-wrap img{display:block;max-width:100%;height:auto;cursor:default;user-select:none}
  .vmd-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#ccc;text-align:center;padding:20px;font-size:14px}.vmd-empty:empty{display:none}
  .vmd-hint{margin-top:8px;color:var(--muted,#888);font-size:12px}.vmd-kb{font-size:13px;display:flex;gap:4px;align-items:center}
  body.vmdesk .page-root{max-width:1400px}`;
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
  const send = async (ev) => { await window.aib.invoke('vm:guiInput', ev); setTimeout(() => refresh(true), 250); };
  img.addEventListener('mousedown', (e) => { e.preventDefault(); wrap.focus(); });
  img.addEventListener('click', (e) => { if (!screen) return; send(Object.assign({ type: 'click', button: 'left', double: false }, pos(e))); });
  img.addEventListener('dblclick', (e) => { if (!screen) return; send(Object.assign({ type: 'click', button: 'left', double: true }, pos(e))); });
  img.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!screen) return; send(Object.assign({ type: 'click', button: 'right' }, pos(e))); });
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
