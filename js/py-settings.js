// Settings → Python & Linux VM (web / iPad).
import * as PY from './python.js';
import * as VM from './linux-vm.js';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
const PH = { idle: '未加载（首次使用时自动下载，之后可离线使用）', loading: '正在加载…', ready: '已就绪', error: '加载失败' };
const VPH = { stopped: '未运行', booting: '正在启动…', running: '运行中', error: '出错' };
let busy = false;
async function render(root) {
  if (busy) return;
  const vmOk = await VM.available();
  const st = PY.status(); const vs = VM.status();
  const engine = localStorage.getItem('aib.py.engine') || 'auto';
  const pk = PY.remembered();
  root.innerHTML = `
  <div class="py-box">
    <div class="hint">Python 运行环境（Pyodide${st.python ? ' · Python ' + esc(st.python) : ''}）：${esc(PH[st.phase] || st.phase)}${st.error ? ' · ' + esc(st.error) : ''}</div>
    <div class="hint">预装可用：numpy、scipy、sympy、mpmath、pandas、matplotlib；其他库可在下方安装。</div>
    ${vmOk ? `<label class="hint">运行位置 <select id="pyEngine"><option value="auto">自动（优先使用 Linux 虚拟机）</option><option value="pyodide">Pyodide（浏览器内）</option></select></label>` : ''}
    <label class="hint">单次运行时间上限（秒） <input id="pyTimeout" type="number" min="10" max="86400" step="10" style="width:90px" value="${esc(localStorage.getItem('aib.py.timeoutSec') || 600)}"></label>
    <div class="row-actions"><input id="pyPkg" placeholder="输入库名，多个以空格分隔，例如 networkx" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" id="pyInstall">安装</button><button type="button" id="pyWarm">预先下载</button><button type="button" id="pyRestart">重启会话</button></div>
    <div id="pyLog" class="py-log"></div>
    <table class="pkg-table"><tbody>${pk.length ? pk.map(n => `<tr><td>${esc(n)}</td><td>已安装（用户）</td><td><button type="button" class="pkg-rm" data-rm="${esc(n)}">卸载</button></td></tr>`).join('') : '<tr><td colspan="3" class="hint">尚未安装额外的库</td></tr>'}</tbody></table>
  </div>
  ${vmOk ? `<div class="py-box">
    <div class="hint">Linux 虚拟机（Alpine Linux，内置 Python 与科学计算库，在本机离线运行）：<b>${esc(VPH[vs.phase] || vs.phase)}</b>${vs.detail ? ' · ' + esc(vs.detail) : ''}${vs.error ? ' · ' + esc(vs.error) : ''}</div>
    ${vs.info ? `<div class="hint">内核 ${esc(vs.info.kernel || '')} · Python ${esc(vs.info.python || '')}</div>` : ''}
    <div class="hint" id="vmSaved"></div>
    <label class="hint">内存 <select id="vmMem">${[256, 384, 512, 768, 1024].map(m => `<option value="${m}">${m} MB</option>`).join('')}</select>（重启虚拟机后生效）</label>
    <div class="row-actions"><button type="button" id="vmStart">启动</button><button type="button" id="vmStop">关闭</button><button type="button" id="vmReset">重置</button></div>
    <p class="hint">虚拟机内部无法联网；安装库时由应用从 PyPI 下载纯 Python 安装包后放入虚拟机，含原生代码的库会改为安装到 Pyodide。</p>
  </div>` : ''}`;
  const $ = (id) => root.querySelector('#' + id);
  if ($('pyEngine')) { $('pyEngine').value = engine; $('pyEngine').onchange = (e) => localStorage.setItem('aib.py.engine', e.target.value); }
  $('pyTimeout').onchange = (e) => localStorage.setItem('aib.py.timeoutSec', String(Math.max(10, Math.min(86400, Number(e.target.value) || 600))));
  const log = (t) => { $('pyLog').textContent += t + '\n'; };
  $('pyInstall').onclick = async () => {
    const names = $('pyPkg').value.split(/[\s,，]+/).filter(Boolean); if (!names.length) return;
    busy = true; $('pyInstall').disabled = true; log('正在安装：' + names.join(' ') + ' …');
    try {
      const { call } = await import('./compute-tools.js');
      const r = await call('python_install', { packages: names }, { stream: (s, d) => log(d.trimEnd()), status: log });
      log(r.ok ? '安装完成：' + r.packages.join(', ') : '安装失败：' + (r.error || ''));
    } catch (e) { log('安装失败：' + (e.message || e)); }
    busy = false; $('pyInstall').disabled = false; setTimeout(() => render(root), 600);
  };
  $('pyWarm').onclick = async () => { log('正在下载 Python 运行环境…'); try { await PY.warm(); log('已就绪，之后可离线使用。'); } catch (e) { log('失败：' + (e.message || e)); } render(root); };
  $('pyRestart').onclick = () => { PY.restart(); log('Python 会话已重启。'); };
  root.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const n = b.dataset.rm; if (!confirm(`确定卸载 ${n}？`)) return;
    PY.forget(n);
    if (VM.running()) { try { await VM.exec(`rm -rf /persist/site/${n.replace(/[^A-Za-z0-9._-]/g, '')}* /persist/site/${n.replace(/[^A-Za-z0-9._-]/g, '').replace(/-/g, '_')}*`); await VM.save(); } catch {} }
    render(root);
  });
  if (vmOk) {
    $('vmMem').value = localStorage.getItem('aib.vm.memoryMB') || '512';
    $('vmMem').onchange = (e) => localStorage.setItem('aib.vm.memoryMB', e.target.value);
    $('vmStart').onclick = () => VM.start().catch(() => {});
    $('vmStop').onclick = () => VM.stop().catch(() => {});
    $('vmReset').onclick = async () => { if (confirm('重置将清除虚拟机中保存的文件和已安装的库，确定继续？')) { await VM.reset(); render(root); } };
    VM.savedBytes().then(b => { const el = $('vmSaved'); if (el) el.textContent = b ? `已保存的数据：${fmt(b)}` : ''; });
  }
}
const root = document.getElementById('pySettings');
if (root) {
  render(root);
  PY.onState(() => render(root)); VM.onState(() => render(root));
}
