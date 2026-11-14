// Custom system images (F6): import ISO / IMG / QCOW2 images and boot them. On iPad the image runs in this page on
// v86 (x86 emulator; the disk is read in pieces over HTTP Range requests). On desktop QEMU opens its own window.
(async function () {
  await I18N.init();
  const root = document.getElementById('root');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtSize = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const KIND = { cdrom: '光盘镜像', disk: '硬盘镜像' };
  const SRC = { iso: 'ISO', raw: 'IMG（原始格式）', qcow2: 'QCOW2（已转换为原始格式）' };
  root.innerHTML = `
    <header class="rl-head">
      <div><h1>自定义系统镜像</h1><p class="hint" id="eng"></p></div>
      <button type="button" class="primary" id="imp">导入镜像…</button>
    </header>
    <p class="hint" id="st" role="status"></p>
    <section id="list" class="rl-list"></section>
    <section id="run" class="vmc-run" hidden>
      <div class="vmc-bar"><b id="runname"></b><span class="hint" id="runst"></span><span class="sp"></span>
        <button type="button" id="cad">发送 Ctrl+Alt+Del</button><button type="button" id="kbd">键盘</button><button type="button" id="stop">关机</button></div>
      <div id="screen" class="vmc-screen" tabindex="0"><div style="white-space:pre;font:14px monospace;line-height:14px"></div><canvas style="display:none"></canvas></div>
      <textarea id="kin" class="vmc-kin" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="向虚拟机输入"></textarea>
    </section>`;
  const $ = (id) => document.getElementById(id);
  const clean = (e) => String((e && e.message) || e || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  let engines = {}; let emu = null;
  async function paint() {
    const r = await window.aib.invoke('vmimg:list');
    engines = r.engines || {};
    $('eng').textContent = engines.v86 ? '在本机以 x86 模拟器运行（无需网络）。支持 ISO、IMG 与 QCOW2；QCOW2 会在导入时转换为原始格式。适合轻量系统（如 FreeDOS、Alpine、TinyCore 等），大型桌面系统运行会较慢。'
      : engines.qemu ? '使用本机的 QEMU 启动，系统将在独立窗口中运行。支持 ISO、IMG 与 QCOW2。'
      : '未找到 QEMU。请先安装 QEMU（例如在 macOS 上执行 brew install qemu）后再启动镜像；导入不受影响。';
    const l = r.images || [];
    $('list').innerHTML = l.length ? l.map(e => `<article class="rl-item" data-id="${esc(e.id)}">
        <div class="rl-main"><h3>${esc(e.name)}</h3><p class="rl-meta">${KIND[e.kind] || ''} · ${SRC[e.source] || esc(e.source)} · ${fmtSize(e.bytes || 0)}</p>
        <p class="rl-meta">内存：<select data-mem="${esc(e.id)}">${[64, 128, 256, 512, 768, 1024].concat(engines.v86 ? [] : [2048, 4096]).map(m => `<option value="${m}" ${m === (e.memoryMB || 256) ? 'selected' : ''}>${m} MB</option>`).join('')}</select></p></div>
        <div class="rl-act"><button type="button" class="primary" data-start="${esc(e.id)}">启动</button><button type="button" data-rm="${esc(e.id)}">删除</button></div>
      </article>`).join('') : '<div class="rl-empty"><p>尚未导入任何系统镜像。</p><p class="hint">点击“导入镜像…”，从“文件”中选择 ISO、IMG 或 QCOW2 文件。</p></div>';
  }
  $('imp').onclick = async () => {
    $('st').textContent = '正在导入…';
    try {
      const r = await window.aib.invoke('vmimg:import');
      $('st').textContent = r.cancelled ? '' : r.ok ? '已导入：' + r.image.name : '导入失败：' + r.error;
    } catch (err) { $('st').textContent = '导入失败：' + clean(err); }
    paint();
  };
  window.aib.on('vmimg:progress', (p) => { if (p && p.progress != null) $('st').textContent = `正在导入… ${Math.round(p.progress * 100)}%`; });
  function loadScript(src) { return new Promise((res, rej) => { if (window.V86) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('无法加载 x86 模拟器组件')); document.head.appendChild(s); }); }
  async function bootV86(cfg) {
    await loadScript(cfg.base + 'libv86.js');
    if (emu) { try { emu.destroy(); } catch {} emu = null; }
    $('run').hidden = false; $('list').hidden = true; $('runname').textContent = cfg.name; $('runst').textContent = '正在启动…';
    const o = {
      wasm_path: cfg.base + 'v86.wasm', memory_size: cfg.memoryMB * 1024 * 1024, vga_memory_size: 8 * 1024 * 1024,
      bios: { url: cfg.base + 'seabios.bin' }, vga_bios: { url: cfg.base + 'vgabios.bin' },
      screen_container: $('screen'), autostart: true, boot_order: cfg.boot === 'cdrom' ? 0x213 : 0x312
    };
    if (cfg.cdrom) o.cdrom = cfg.cdrom; if (cfg.hda) o.hda = cfg.hda;
    emu = new window.V86(o);
    emu.add_listener('emulator-started', () => { $('runst').textContent = '运行中'; });
    $('screen').focus();
  }
  document.body.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-start]');
    if (s) {
      $('st').textContent = '正在启动…';
      try {
        const r = await window.aib.invoke('vmimg:start', s.dataset.start);
        if (r.engine === 'v86') { await bootV86(r.config); $('st').textContent = ''; }
        else if (r.engine === 'qemu') $('st').textContent = r.already ? '该镜像已在运行。' : '已在 QEMU 窗口中启动。';
        else $('st').textContent = r.error || '无法启动';
      } catch (err) { $('st').textContent = '启动失败：' + clean(err); }
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const ok = await window.AIBConfirm.ask({ title: '删除系统镜像', message: '确定删除此镜像吗？删除后无法恢复。', confirmText: '删除', cancelText: '取消', danger: true });
      if (ok) { await window.aib.invoke('vmimg:remove', rm.dataset.rm); paint(); }
    }
  });
  document.body.addEventListener('change', async (e) => { const m = e.target.closest('[data-mem]'); if (m) { await window.aib.invoke('vmimg:update', m.dataset.mem, { memoryMB: Number(m.value) }); } });
  $('stop').onclick = () => { if (emu) { try { emu.destroy(); } catch {} emu = null; } $('run').hidden = true; $('list').hidden = false; $('screen').querySelector('div').textContent = ''; };
  $('cad').onclick = () => { if (emu) emu.keyboard_send_scancodes([0x1D, 0x38, 0xE0, 0x53, 0xE0, 0xD3, 0xB8, 0x9D]); };
  // touch keyboard: text typed into a hidden field goes to the guest
  $('kbd').onclick = () => { $('kin').focus(); };
  $('kin').addEventListener('input', (e) => { const v = e.target.value; e.target.value = ''; if (emu && v) emu.keyboard_send_text(v); });
  $('kin').addEventListener('keydown', (e) => {
    if (!emu) return;
    const map = { Enter: [0x1C], Backspace: [0x0E], Tab: [0x0F], Escape: [0x01], ArrowUp: [0xE0, 0x48], ArrowDown: [0xE0, 0x50], ArrowLeft: [0xE0, 0x4B], ArrowRight: [0xE0, 0x4D] };
    const c = map[e.key]; if (!c) return; e.preventDefault();
    emu.keyboard_send_scancodes(c.concat(c.length === 2 ? [0xE0, c[1] | 0x80] : [c[0] | 0x80]));
  });
  paint();
})();
