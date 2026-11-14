// Code editor with a file manager (F5): CodeMirror 6 (bundled offline), three roots (own code, Python working
// directories, Linux VM shared folder), run .py / .sh / .html.
(async function () {
  await I18N.init();
  const root = document.getElementById('root');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = (e) => String(e && e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const inv = (...a) => window.aib.invoke(...a);
  root.innerHTML = `
    <aside class="code-side" aria-label="文件">
      <div class="code-roots" id="roots" role="tablist"></div>
      <div class="code-path" id="crumb"></div>
      <div class="code-acts"><button type="button" id="newFile">新建文件</button><button type="button" id="newDir">新建文件夹</button><button type="button" id="refresh" title="刷新">刷新</button></div>
      <ul class="code-files" id="files"></ul>
    </aside>
    <section class="code-main">
      <header class="code-bar"><span class="code-name" id="fname">未打开文件</span><span class="code-dirty" id="dirty" hidden>未保存</span>
        <span class="code-bar-acts"><button type="button" id="askai" disabled title="将当前文件交给 AI 讲解或排错">交给 AI</button><button type="button" id="save" disabled>保存</button><button type="button" id="run" class="primary" disabled>运行</button></span></header>
      <div class="code-editor" id="editor"></div>
      <section class="code-out" id="out" hidden><header><span>运行结果</span><button type="button" id="outClose" aria-label="关闭运行结果">关闭</button></header><pre id="outText"></pre><div id="outImgs"></div></section>
    </section>`;
  const $ = (id) => document.getElementById(id);
  // in-page dialogs: window.prompt is unavailable in Electron and needs extra host support in WKWebView
  function modal(msg, { input = null, ok = '确定' } = {}) {
    return new Promise((res) => {
      const m = document.createElement('div'); m.className = 'code-modal';
      m.innerHTML = `<form class="code-dlg" role="dialog" aria-modal="true"><p>${esc(msg)}</p>${input != null ? `<input type="text" value="${esc(input)}" aria-label="${esc(msg)}">` : ''}<div class="code-dlg-acts"><button type="button" data-x>取消</button><button type="submit" class="primary">${esc(ok)}</button></div></form>`;
      document.body.appendChild(m);
      const f = m.querySelector('form'), inp = m.querySelector('input');
      const done = (v) => { m.remove(); res(v); };
      f.onsubmit = (e) => { e.preventDefault(); done(inp ? inp.value.trim() || null : true); };
      m.querySelector('[data-x]').onclick = () => done(inp ? null : false);
      setTimeout(() => { if (inp) { inp.focus(); inp.select(); } else f.querySelector('.primary').focus(); }, 0);
    });
  }
  const notify = (msg) => { $('fname').dataset.msg = msg; const el = $('dirty'); el.hidden = false; el.textContent = msg; setTimeout(() => { el.textContent = '未保存'; el.hidden = !dirty; }, 4000); };
  let rootsL = await inv('code:roots'); let cur = { root: rootsL[0].id, dir: '' }; let file = null; let dirty = false;
  const dark = document.documentElement.dataset.theme !== 'light' && !document.body.classList.contains('light');
  const ed = window.CM6 ? window.CM6.create($('editor'), { doc: '', dark, onChange: () => setDirty(true), onSave: () => save() }) : null;
  if (!ed) $('editor').innerHTML = '<p class="hint" style="padding:20px">编辑器组件加载失败。</p>';
  function setDirty(d) { dirty = d && !!file; $('dirty').hidden = !dirty; $('save').disabled = !file; }
  const join = (a, b) => a ? a + '/' + b : b;
  function paintRoots() { $('roots').innerHTML = rootsL.map(r => `<button type="button" role="tab" aria-selected="${r.id === cur.root}" class="${r.id === cur.root ? 'on' : ''}" data-root="${r.id}">${esc(r.name)}</button>`).join(''); }
  async function paintFiles() {
    paintRoots();
    const segs = cur.dir ? cur.dir.split('/') : [];
    $('crumb').innerHTML = `<a data-dir="">根目录</a>` + segs.map((s, i) => ` / <a data-dir="${esc(segs.slice(0, i + 1).join('/'))}">${esc(s)}</a>`).join('');
    try {
      const l = await inv('code:list', cur.root, cur.dir);
      $('files').innerHTML = (cur.dir ? `<li class="up" data-dir="${esc(segs.slice(0, -1).join('/'))}">… 上一级</li>` : '') +
        (l.items.length ? l.items.map(it => `<li class="${it.dir ? 'dir' : 'file'}${file && file.root === cur.root && file.path === join(cur.dir, it.name) ? ' on' : ''}" data-name="${esc(it.name)}" data-isdir="${it.dir ? 1 : ''}"><span class="fn">${it.dir ? '📁 ' : ''}${esc(it.name)}</span><span class="fa"><button type="button" data-ren="${esc(it.name)}" title="重命名">重命名</button><button type="button" data-del="${esc(it.name)}" title="删除">删除</button></span></li>`).join('') : '<li class="empty">此文件夹为空</li>');
    } catch (e) { $('files').innerHTML = `<li class="empty">${esc(clean(e))}</li>`; }
  }
  async function open(rel) {
    if (dirty && !(await modal('当前文件尚未保存，确定放弃修改吗？', { ok: '放弃修改' }))) return;
    try {
      const r = await inv('code:read', cur.root, rel);
      file = { root: cur.root, path: r.path };
      ed && ed.load(r.text, r.path);
      $('fname').textContent = r.path; $('run').disabled = !/\.(py|sh|html?)$/i.test(r.path); $('askai').disabled = false;
      setDirty(false); paintFiles();
    } catch (e) { notify(clean(e)); }
  }
  async function save() {
    if (!file || !ed) return;
    try { await inv('code:write', file.root, file.path, ed.value); setDirty(false); } catch (e) { notify(clean(e)); }
  }
  document.body.addEventListener('click', async (e) => {
    const rb = e.target.closest('[data-root]'); if (rb) { cur = { root: rb.dataset.root, dir: '' }; paintFiles(); return; }
    const del = e.target.closest('[data-del]');
    if (del) { const p = join(cur.dir, del.dataset.del); if (await modal(`确定删除“${del.dataset.del}”吗？此操作无法撤销。`, { ok: '删除' })) { try { await inv('code:delete', cur.root, p); if (file && file.root === cur.root && (file.path === p || file.path.startsWith(p + '/'))) { file = null; ed && ed.load('', ''); $('fname').textContent = '未打开文件'; setDirty(false); } } catch (er) { notify(clean(er)); } paintFiles(); } return; }
    const ren = e.target.closest('[data-ren]');
    if (ren) { const n = await modal('新名称', { input: ren.dataset.ren }); if (n && n !== ren.dataset.ren) { try { await inv('code:rename', cur.root, join(cur.dir, ren.dataset.ren), join(cur.dir, n)); } catch (er) { notify(clean(er)); } paintFiles(); } return; }
    const d = e.target.closest('[data-dir]'); if (d && (d.tagName === 'A' || d.classList.contains('up'))) { cur.dir = d.dataset.dir; paintFiles(); return; }
    const li = e.target.closest('#files li[data-name]');
    if (li) { const p = join(cur.dir, li.dataset.name); if (li.dataset.isdir) { cur.dir = p; paintFiles(); } else open(p); }
  });
  $('newFile').onclick = async () => { const n = await modal('文件名（例如 main.py）', { input: 'main.py', ok: '新建' }); if (!n) return; try { await inv('code:write', cur.root, join(cur.dir, n), ''); await paintFiles(); open(join(cur.dir, n)); } catch (e) { notify(clean(e)); } };
  $('newDir').onclick = async () => { const n = await modal('文件夹名', { input: '', ok: '新建' }); if (!n) return; try { await inv('code:mkdir', cur.root, join(cur.dir, n)); paintFiles(); } catch (e) { notify(clean(e)); } };
  $('refresh').onclick = paintFiles;
  $('save').onclick = save;
  $('outClose').onclick = () => { $('out').hidden = true; };
  $('askai').onclick = async () => {
    if (!file) return;
    const text = (ed ? ed.value : '').slice(0, 20000);
    const q = `请讲解以下代码文件“${file.path}”的作用，并指出可能的错误与改进建议：\n\n\`\`\`\n${text}\n\`\`\``;
    try { const sid = await inv('chat:follow', '', q, {}); if (sid) location.href = 'aibrowser://chat?sid=' + sid + '&tool=code'; } catch (e) { notify(clean(e)); }
  };
  $('run').onclick = async () => {
    if (!file) return;
    await save();
    $('out').hidden = false; $('outText').textContent = '正在运行…'; $('outImgs').innerHTML = '';
    try {
      const r = await inv('code:run', file.root, file.path, ed ? ed.value : null);
      if (r.kind === 'open') { $('outText').textContent = '已在新标签页中打开。'; return; }
      const parts = [];
      if (r.stdout) parts.push(r.stdout);
      if (r.result != null && r.result !== '') parts.push(String(r.result));
      if (r.stderr) parts.push(r.stderr);
      if (r.error) parts.push('错误：' + r.error);
      $('outText').textContent = parts.join('\n').trim() || (r.ok === false ? '运行失败。' : '运行完成，无输出。');
      $('outImgs').innerHTML = (r.images || []).map(i => `<img alt="${esc(i.name)}" src="${i.dataUrl}">`).join('');
    } catch (e) { $('outText').textContent = '错误：' + clean(e); }
  };
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  paintFiles();
  window.__codeEditor = { get value() { return ed ? ed.value : ''; }, load: (t, n) => ed && ed.load(t, n), get file() { return file; } };
})();
