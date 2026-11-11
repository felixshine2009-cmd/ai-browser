// Collapsible code / output panels for python_run, python_install and the Linux VM tools.
// Shared by the desktop chat page and the web / iPad app (web/js/runpanel.js is a copy).
(function () {
  const KINDS = {
    python_run: ['Python', 'Python'], python_install: ['安装 Python 库', 'Install packages'], vm_shell: ['Linux 终端', 'Linux shell'],
    vm_read_file: ['读取文件', 'Read file'], vm_write_file: ['写入文件', 'Write file'], vm_upload: ['上传到虚拟机', 'Upload to VM'],
    vm_download: ['从虚拟机下载', 'Download from VM'], vm_status: ['虚拟机状态', 'VM status'], vm_control: ['虚拟机控制', 'VM control']
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function create(host, figs, opts) {
    opts = opts || {};
    const en = () => (typeof opts.lang === 'function' ? opts.lang() : opts.lang) === 'en';
    const L = (zh, e) => (en() ? e : zh);
    const panels = new Map(); let figN = 0;
    const isRun = (name) => !!KINDS[name];
    function codeOf(name, a) {
      a = a || {};
      if (name === 'python_run') return { lang: 'python', text: a.code || '' };
      if (name === 'python_install') return { lang: 'shell', text: 'pip install ' + (a.packages || []).join(' ') };
      if (name === 'vm_shell') return { lang: 'shell', text: (a.cwd ? `cd ${a.cwd}\n` : '') + (a.command || '') };
      if (name === 'vm_write_file') return { lang: 'text', text: `# ${a.path || ''}\n` + String(a.encoding === 'base64' ? L('（二进制内容）', '(binary content)') : (a.content || '')).slice(0, 20000) };
      if (name === 'vm_read_file' || name === 'vm_download') return { lang: 'text', text: a.path || '' };
      if (name === 'vm_control') return { lang: 'text', text: a.action || '' };
      return null;
    }
    function ensure(ev) {
      let p = panels.get(ev.id); if (p) return p;
      const k = KINDS[ev.name] || [ev.name, ev.name];
      const d = document.createElement('details'); d.className = 'run-panel'; d.dataset.run = ev.id; d.dataset.state = 'run';
      const code = codeOf(ev.name, ev.args);
      d.innerHTML = `<summary><span class="run-kind">${esc(L(k[0], k[1]))}</span><span class="run-title"></span><span class="run-state"></span><button type="button" class="run-stop">${esc(L('停止', 'Stop'))}</button></summary>
        <div class="run-body">${code ? `<div class="run-h">${esc(ev.name === 'python_run' ? L('代码', 'Code') : L('命令', 'Command'))}</div><pre class="run-code" data-lang="${code.lang}"></pre>` : ''}<div class="run-h run-out-h">${esc(L('输出', 'Output'))}</div><pre class="run-out"></pre></div>`;
      if (code) d.querySelector('.run-code').textContent = code.text;
      d.querySelector('.run-stop').onclick = (e) => { e.preventDefault(); e.stopPropagation(); e.target.disabled = true; e.target.textContent = L('正在停止…', 'Stopping…'); if (opts.onStop) opts.onStop(ev.id); };
      host.appendChild(d);
      p = { el: d, out: d.querySelector('.run-out'), name: ev.name, text: '' };
      panels.set(ev.id, p);
      return p;
    }
    function setState(p, state, label, ms) {
      p.el.dataset.state = state;
      const s = p.el.querySelector('.run-state');
      s.textContent = state === 'run' ? L('运行中…', 'Running…') : state === 'ok' ? L('完成', 'Done') + (ms != null ? ` · ${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s` : '') : L('出错', 'Error') + (ms != null ? ` · ${(ms / 1000).toFixed(1)} s` : '');
      if (label) p.el.querySelector('.run-title').textContent = String(label).replace(/^\S+ · /, '');
      const b = p.el.querySelector('.run-stop'); if (b) b.hidden = state !== 'run';
    }
    function append(p, text, cls) {
      if (!text) return;
      p.text += text; if (p.text.length > 300000) return;
      if (cls) { const sp = document.createElement('span'); sp.className = cls; sp.textContent = text; p.out.appendChild(sp); }
      else p.out.appendChild(document.createTextNode(text));
      p.out.scrollTop = p.out.scrollHeight;
    }
    function step(ev) {
      if (!isRun(ev.name)) return false;
      const p = ensure(ev);
      setState(p, ev.status === 'run' ? 'run' : ev.status === 'ok' ? 'ok' : 'err', ev.label, ev.ms);
      if (ev.status === 'error' && ev.error && !p.text) append(p, ev.error, 'run-err');
      return true;
    }
    function stream(ev) { const p = panels.get(ev.id); if (!p) return; append(p, ev.data, ev.stream === 'stderr' ? 'run-err' : ''); }
    function addFig(img) {
      if (!figs || !img || !img.dataUrl) return;
      figN++;
      const f = document.createElement('figure'); f.className = 'run-fig';
      f.innerHTML = `<img alt="" src="${esc(img.dataUrl)}"/><figcaption>${esc(L('图 ', 'Figure ') + figN)}</figcaption>`;
      figs.appendChild(f);
    }
    function tool(ev) {
      if (!isRun(ev.name)) return false;
      const p = ensure(ev); const r = ev.result || {};
      if (ev.error) { if (!p.text) append(p, ev.error, 'run-err'); setState(p, 'err'); return true; }
      const streamed = !!p.text;
      if (ev.name === 'python_run') {
        p.out.textContent = ''; p.text = '';
        append(p, r.stdout); append(p, r.stderr, 'run-err');
        if (r.result != null && r.result !== '') append(p, (p.text && !p.text.endsWith('\n') ? '\n' : '') + '→ ' + r.result + '\n', 'run-res');
        if (r.error) append(p, (p.text && !p.text.endsWith('\n') ? '\n' : '') + r.error, 'run-err');
        if (r.engine) p.el.querySelector('.run-kind').textContent = r.engine === 'vm' ? L('Python · 虚拟机', 'Python · VM') : r.engine === 'pyodide' ? 'Python · Pyodide' : 'Python';
      } else if (ev.name === 'vm_shell') {
        if (!streamed) { append(p, r.stdout); append(p, r.stderr, 'run-err'); }
        append(p, `\n[${L('退出码', 'exit code')} ${r.exitCode}${r.timedOut ? ' · ' + L('已超时', 'timed out') : ''}${r.stopped ? ' · ' + L('已停止', 'stopped') : ''}]`, r.exitCode === 0 ? 'run-res' : 'run-err');
      } else if (ev.name === 'python_install') {
        if (!streamed) append(p, r.output || '');
        append(p, '\n' + (r.ok ? L('安装完成：', 'Installed: ') + (r.packages || []).join(', ') : (r.error || L('安装失败', 'Install failed'))), r.ok ? 'run-res' : 'run-err');
      } else if (ev.name === 'vm_read_file') {
        append(p, r.text != null ? r.text.slice(0, 20000) : r.binary ? L('（二进制文件，', '(binary file, ') + r.size + ' B)' : '');
      } else {
        const show = Object.assign({}, r); delete show.images; append(p, JSON.stringify(show, null, 2));
      }
      if (r.error && ev.name !== 'python_run' && ev.name !== 'python_install') append(p, '\n' + r.error, 'run-err');
      const bad = r.ok === false || (typeof r.exitCode === 'number' && r.exitCode !== 0) || !!(r.error && ev.name === 'python_run');
      setState(p, bad ? 'err' : 'ok', null, r.ms);
      if (!p.text) p.el.querySelector('.run-out-h').hidden = true, p.out.hidden = true;
      (r.images || []).forEach(addFig);
      return true;
    }
    return { step, stream, tool, isRun, panels };
  }
  window.RunPanels = { create, KINDS };
})();
