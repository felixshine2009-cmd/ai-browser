(async function () {
  await I18N.init();
  const id = new URLSearchParams(location.search).get('id') || 'solve';
  const root = document.getElementById('root');
  const titles = { geogebra: 'GeoGebra', physics: '物理实验', solve: '解题', wiki: '离线百科', dict: '词典' };
  document.title = titles[id] || '工具';
  const params = new URLSearchParams(location.search);
  const ext = id === 'geogebra' ? 'aib.geogebra' : id === 'physics' ? 'aib.physics' : '';
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Collaboration notes sidebar: per-tool open/closed state, persisted in settings.toolNotes.
  // Defaults: canvas tools (GeoGebra / physics) open; solver / wiki / dict closed so the page reads like the homepage.
  const NOTES_DEFAULT = { geogebra: true, physics: true, solve: false, wiki: false, dict: false };
  let notesOpen = Object.prototype.hasOwnProperty.call(NOTES_DEFAULT, id) ? NOTES_DEFAULT[id] : false;
  try {
    const S = await window.aib.invoke('settings:get');
    const saved = S && S.toolNotes;
    if (saved && typeof saved[id] === 'boolean') notesOpen = saved[id];
  } catch {}

  const ICON_PANEL = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M10 2.75v10.5"/></svg>';
  const ICON_CLOSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4.5L9.5 8 6 11.5"/><path d="M12.5 3v10"/></svg>';
  const toggleBtn = '<button type="button" class="tb-icon notes-toggle" id="notesToggle" aria-controls="notesPane">' + ICON_PANEL + '</button>';
  const bar = (title, cls = '') => `<div class="tool-bar${cls ? ' ' + cls : ''}"><span class="tool-bar-title">${esc(title)}</span><span class="tool-bar-actions">${toggleBtn}</span></div>`;
  const goBtn = '<button type="submit" class="go" title="提交" aria-label="提交"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12V4M4.5 7.5L8 4l3.5 3.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button>';

  function homePage({ title, subtitle, inputId, placeholder, formId, chips, extra, field }) {
    const control = field || `<input id="${inputId}" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">`;
    return `${bar(titles[id] || title, 'ghost')}<div class="solve-home" id="toolHome">
      <div class="home-greet solve-greet"><h1>${esc(title)}</h1></div>
      <p class="solve-sub">${esc(subtitle)}</p>
      <div class="solve-search">
        <form class="solve-composer" id="${formId}" autocomplete="off">
          <div class="solve-input-row">${control}${goBtn}</div>
        </form>
        <div class="solve-chips"><span class="solve-model" id="toolmodel"></span>${chips || ''}<button type="button" class="solve-chip ask-ai" id="askai" title="将输入内容交给 AI 处理，结果在本工具视图中显示"><span>交给 AI</span></button></div>
        ${extra || ''}
      </div>
    </div>`;
  }

  function openExtFrame() {
    main.classList.remove('solve-main');
    main.classList.add('has-frame');
    main.innerHTML = `${bar(titles[id] || id)}<iframe class="tool-frame" src="aibext://${ext}/panel.html" allow="clipboard-read; clipboard-write"></iframe>`;
    paintNotes();
    return main.querySelector('.tool-frame');
  }

  function panelCall(method, args) {
    const frame = main.querySelector('.tool-frame');
    if (!frame || !frame.contentWindow) return;
    const callId = 'tool-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    frame.contentWindow.postMessage({ aibPanelCall: callId, method, args: args || {} }, '*');
  }

  root.innerHTML = `<div class="tool-main" id="main"></div><aside class="tool-ai" id="notesPane" aria-label="协作"><header class="ta-head"><div class="ta-head-row"><h3>协作</h3><button type="button" class="tb-icon ta-close" id="notesClose" title="收起协作" aria-label="收起协作" aria-controls="notesPane" aria-expanded="true">${ICON_CLOSE}</button></div><p class="hint">用于记录修改说明与过程备注，便于对照查阅。</p></header><div id="notes" class="ta-notes"></div><div class="ta-compose"><textarea id="note" rows="3" placeholder="请输入备注"></textarea><button type="button" class="primary" id="send">添加</button></div><div id="extra"></div></aside>`;
  const main = document.getElementById('main');

  if (id === 'geogebra') {
    main.classList.add('solve-main');
    main.innerHTML = homePage({
      title: 'GeoGebra',
      subtitle: '请输入作图命令或表达式。提交后将在本页打开绘图板并执行该命令，而不会改用其他工具。',
      inputId: 'ggbCmd',
      placeholder: '请输入作图命令或表达式，例如 f(x)=x^2',
      formId: 'ggbForm',
      chips: '<button type="button" class="solve-chip" id="openBoard"><span>打开绘图板</span></button>'
    });
  } else if (id === 'physics') {
    main.classList.add('solve-main');
    main.innerHTML = homePage({
      title: '物理实验',
      subtitle: '请输入实验名称或说明。提交后将在本页打开物理实验台，而不会改用其他工具。',
      inputId: 'physQ',
      placeholder: '请输入实验名称或说明',
      formId: 'physForm',
      chips: '<button type="button" class="solve-chip" id="openBoard"><span>打开实验台</span></button>'
    });
  } else if (id === 'wiki') {
    main.classList.add('solve-main');
    main.innerHTML = homePage({
      title: '离线百科',
      subtitle: '请打开 ZIM 格式的离线百科文件（与 Kiwix 应用所使用的格式相同），然后检索并阅读词条。',
      inputId: 'q',
      placeholder: '请输入检索词',
      formId: 'wikiForm',
      chips: '<button type="button" class="solve-chip" id="openZim"><span>打开 ZIM 文件</span></button><button type="button" class="solve-chip" id="imptoggle" aria-expanded="false" aria-controls="wikiImp"><span>导入词条</span></button>',
      extra: `<p id="zimst" class="hint zim-status"></p>
        <div id="hits" class="tool-hits"></div>
        <section id="wikiReader" class="wiki-reader" hidden>
          <div class="wiki-reader-bar">
            <button type="button" class="solve-chip" id="wikiHome"><span>首页</span></button>
            <span id="wikiArtTitle" class="wiki-art-title"></span>
          </div>
          <iframe id="wikiFrame" class="wiki-frame" title="离线百科词条" sandbox="allow-same-origin allow-scripts allow-popups"></iframe>
        </section>
        <section class="solve-refs" id="wikiImp" hidden aria-label="导入词条">
          <div class="solve-refs-head"><span>导入词条</span><button type="button" class="tb-icon" id="impclose" title="收起" aria-label="收起">×</button></div>
          <p class="hint">可将 JSONL 文件（每行格式为 {"title","text"}）放入用户目录的 wiki 文件夹，亦可在下方粘贴并导入。</p>
          <textarea id="dump" rows="4" placeholder='{"title":"…","text":"…"}'></textarea>
          <div class="row"><button type="button" id="imp">导入</button><span id="impst" class="hint"></span></div>
        </section>`
    });
  } else if (id === 'dict') {
    main.classList.add('solve-main');
    main.innerHTML = homePage({
      title: '词典',
      subtitle: '请输入英文或中文词汇。查询结果在本页显示；若本地词典未收录该词，仍可查看 AI 释义。',
      inputId: 'w',
      placeholder: '请输入英文或中文词汇，例如 serendipity',
      formId: 'dictForm',
      extra: '<section id="dictResult" class="dict-result" hidden aria-label="查询结果"></section>'
    });
  } else {
    main.classList.add('solve-main');
    main.innerHTML = `${bar('解题', 'ghost')}<div class="solve-home">
      <div class="home-greet solve-greet"><h1>请提交题目</h1></div>
      <p class="solve-sub">可输入或粘贴题目文本，亦可上传图片或通过移动设备拍照。</p>
      <div class="solve-search">
        <form class="solve-composer" id="solveForm" autocomplete="off">
          <div class="solve-attach" id="attach" hidden><span class="solve-attach-chip"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2"/><circle cx="6" cy="6.6" r="1.2"/><path d="M2.5 11.5l3.4-3 2.4 2 2-1.6 3.2 2.6"/></svg><span id="imgst"></span><button type="button" class="solve-attach-x" id="imgx" title="移除图片" aria-label="移除图片">×</button></span></div>
          <div class="solve-input-row">
            <textarea id="prob" rows="1" spellcheck="false" placeholder="请输入或粘贴题目" aria-label="题目内容"></textarea>
            <button type="submit" class="go" id="ask" title="开始解答" aria-label="开始解答"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12V4M4.5 7.5L8 4l3.5 3.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button>
          </div>
        </form>
        <div class="solve-chips">
          <span class="solve-model" id="toolmodel"></span>
          <button type="button" class="solve-chip" id="img" title="上传题目图片" aria-label="上传图片"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2"/><circle cx="6" cy="6.6" r="1.2"/><path d="M2.5 11.5l3.4-3 2.4 2 2-1.6 3.2 2.6"/></svg><span>上传图片</span></button>
          <button type="button" class="solve-chip" id="phone" title="通过移动设备扫描二维码拍照上传" aria-label="拍照上传"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="1.75" width="7" height="12.5" rx="1.6"/><path d="M7.2 12h1.6"/></svg><span>拍照上传</span></button>
          <button type="button" class="solve-chip" id="reftoggle" title="添加公式、定理或教材内容作为参考" aria-label="添加参考资料" aria-expanded="false" aria-controls="refpanel"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.75h6.5L13 6.25v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1z"/><path d="M9.5 2.75v3.5H13"/><path d="M5 9.25h6M5 11.5h4"/></svg><span>添加参考资料</span><em class="solve-chip-count" id="refcount" hidden></em></button>
        </div>
        <section class="solve-refs" id="refpanel" hidden aria-label="参考资料">
          <div class="solve-refs-head"><span>参考资料<small>（可选）</small></span><button type="button" class="tb-icon" id="refclose" title="收起参考资料" aria-label="收起参考资料">×</button></div>
          <input id="rt" placeholder="请输入资料标题，例如：余弦定理">
          <textarea id="rb" rows="3" placeholder="请输入相关公式、定理或教材内容"></textarea>
          <div class="row"><button type="button" id="addref">添加</button><span id="refs" class="hint"></span></div>
          <ul class="solve-ref-list" id="reflist"></ul>
        </section>
      </div>
    </div>
    <input id="file" type="file" accept="image/*" hidden>
    <div id="qr" class="qr-modal" hidden></div>`;
  }

  const toggleEl = document.getElementById('notesToggle');
  const closeEl = document.getElementById('notesClose');
  const paneEl = document.getElementById('notesPane');
  function paintNotes() {
    const tEl = document.getElementById('notesToggle');
    root.classList.toggle('notes-closed', !notesOpen);
    paneEl.hidden = !notesOpen;
    const label = notesOpen ? '收起协作' : '打开协作';
    if (tEl) {
      tEl.title = label;
      tEl.setAttribute('aria-label', label);
      tEl.setAttribute('aria-expanded', String(notesOpen));
      tEl.classList.toggle('on', notesOpen);
      tEl.onclick = () => persistNotes(!notesOpen);
    }
    closeEl.setAttribute('aria-expanded', String(notesOpen));
  }
  async function persistNotes(next) {
    notesOpen = next;
    paintNotes();
    try {
      const S = await window.aib.invoke('settings:get') || {};
      const toolNotes = Object.assign({}, S.toolNotes || {}, { [id]: notesOpen });
      await window.aib.invoke('settings:patch', { toolNotes });
    } catch {}
  }
  closeEl.onclick = () => persistNotes(false);
  paintNotes();

  async function notes() {
    let list = [];
    try { const c = await window.aib.invoke('collab:get', id); list = (c && c.notes) || []; } catch {}
    document.getElementById('notes').innerHTML = list.map(n => `<div class="note ${esc(n.who)}"><b>${esc(n.who === 'ai' ? 'AI' : '我')}</b><p>${esc(n.text)}</p></div>`).join('');
  }
  const noteInput = document.getElementById('note');
  async function submitNote() {
    const v = noteInput.value.trim();
    if (!v) return;
    await window.aib.invoke('collab:note', id, 'human', v);
    noteInput.value = '';
    notes();
  }
  document.getElementById('send').onclick = submitNote;
  noteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey) && !e.isComposing) {
      e.preventDefault();
      submitNote();
    }
  });
  notes();

  if (id === 'wiki') {
    const qInput = document.getElementById('q');
    const hitsEl = document.getElementById('hits');
    const reader = document.getElementById('wikiReader');
    const frame = document.getElementById('wikiFrame');
    const artTitle = document.getElementById('wikiArtTitle');
    const zimst = document.getElementById('zimst');
    async function openArticle(articlePath, title) {
      const item = await window.aib.invoke('wiki:article', articlePath || '');
      if (!item || !item.url) return false;
      main.classList.add('wiki-reading');
      reader.hidden = false;
      artTitle.textContent = title || item.title || item.path || '';
      frame.src = item.url;
      return true;
    }
    async function paintZim(st) {
      st = st || await window.aib.invoke('wiki:zimStatus');
      if (!st || !st.open) {
        zimst.textContent = st && st.error
          ? ('无法打开 ZIM 文件：' + st.error)
          : '尚未打开 ZIM 文件。请选择与 Kiwix 应用相同的离线百科文件（.zim）。';
        if (!st || !st.open) {
          main.classList.remove('wiki-reading');
          reader.hidden = true;
          frame.removeAttribute('src');
          artTitle.textContent = '';
        }
        return st;
      }
      zimst.textContent = st.copied
        ? ('当前文件：' + st.name + '（已复制到应用程序目录，共 ' + Number(st.articleCount || 0).toLocaleString() + ' 条）')
        : ('当前文件：' + st.name + '（共 ' + Number(st.articleCount || 0).toLocaleString() + ' 条）');
      return st;
    }
    const run = async () => {
      const r = await window.aib.invoke('wiki:search', qInput.value);
      const list = (r && r.hits) || [], saved = (r && r.saved) || [];
      main.classList.remove('wiki-reading'); reader.hidden = true;
      hitsEl.innerHTML = (list.length
        ? list.map(h => `<article data-title="${esc(h.title)}"${h.path ? ` data-path="${esc(h.path)}"` : ''}><h4>${esc(h.title)}</h4><p>${esc(h.text || h.path || '')}</p>${h.path ? '<button type="button" data-open="1">阅读</button>' : ''}<button type="button" data-tr="${esc(h.title)}">全文翻译</button></article>`).join('')
        : (qInput.value.trim() ? '<p class="hint">离线百科中未找到匹配词条。</p>' : ''))
        + (saved.length ? '<h4 class="hits-sec">稍后阅读中保存的网页</h4>' + saved.map(h => `<article class="saved-hit"><h4>${esc(h.title)}</h4><p>${esc(h.snippet)}</p><button type="button" data-saved="${esc(h.id)}">离线阅读</button></article>`).join('') : '');
    };
    document.getElementById('wikiForm').addEventListener('submit', (e) => { e.preventDefault(); run(); });
    if (window.aib && window.aib.on) window.aib.on('wiki:progress', (p) => {
      if (!p || !zimst) return;
      if (!p.active) return;
      const pct = p.total ? Math.round(100 * p.got / p.total) : 0;
      zimst.textContent = '正在将 ZIM 文件复制到应用程序目录… ' + pct + '%';
    });
    document.getElementById('openZim').onclick = async () => {
      zimst.textContent = '正在将 ZIM 文件复制到应用程序目录…';
      const st = await window.aib.invoke('wiki:openZim');
      if (st && st.cancelled) { await paintZim(); return; }
      await paintZim(st);
      if (st && st.open) await openArticle('', st.name);
    };
    document.getElementById('wikiHome').onclick = () => openArticle('', '');
    const impPanel = document.getElementById('wikiImp');
    const impToggle = document.getElementById('imptoggle');
    const setImp = (open) => {
      impPanel.hidden = !open;
      impToggle.setAttribute('aria-expanded', String(open));
      impToggle.classList.toggle('on', open);
    };
    impToggle.onclick = () => setImp(impPanel.hidden);
    document.getElementById('impclose').onclick = () => { setImp(false); impToggle.focus(); };
    document.getElementById('imp').onclick = async () => {
      const dumpEl = document.getElementById('dump');
      const raw = dumpEl.value.trim();
      if (!raw) return;
      const n = await window.aib.invoke('wiki:import', raw);
      const count = (n && n.imported) || 0;
      const st = document.getElementById('impst');
      if (st) st.textContent = `已导入 ${count} 条`;
      if (count > 0) dumpEl.value = '';
      run();
    };
    hitsEl.onclick = async (e) => {
      const sv = e.target.closest('button[data-saved]');
      if (sv) { window.aib.invoke('readlater:open', sv.dataset.saved); return; }
      const tr = e.target.closest('button[data-tr]');
      if (tr) {
        const sid = await window.aib.invoke('nav:submit', '翻译离线百科：' + tr.dataset.tr);
        if (sid && typeof sid === 'string') location.href = 'aibrowser://chat?sid=' + sid;
        return;
      }
      const art = e.target.closest('article[data-path]');
      if (art && art.dataset.path) {
        hitsEl.innerHTML = '';
        await openArticle(art.dataset.path, art.dataset.title);
      }
    };
    paintZim().then(st => { if (params.get('q')) { qInput.value = params.get('q'); run(); } else if (st && st.open) openArticle('', st.name); });
    qInput.focus();
  }

  if (id === 'dict') {
    const wInput = document.getElementById('w');
    const out = document.getElementById('dictResult');
    const aiEntry = (target, word) => {
      target.innerHTML = '<div class="lk-msg">正在生成 AI 释义…</div>';
      window.aib.invoke('chat:aiEntry', word).then(entry => {
        target.innerHTML = '<span class="ai-note">以下释义由 AI 生成，仅供参考。</span>';
        const inner = document.createElement('div'); target.appendChild(inner); target.style.overflow = 'auto';
        DictView.renderAiEntry(inner, entry);
      }).catch(e => { target.innerHTML = `<div class="lk-msg">${esc(e.message)}</div>`; });
    };
    const lookup = async (word) => {
      const val = (word || wInput.value).trim();
      if (!val) { wInput.focus(); return; }
      wInput.value = val;
      main.classList.add('dict-reading');
      out.hidden = false;
      out.innerHTML = '<div class="lk-msg">正在查询…</div>';
      try {
        const r = await window.aib.invoke('lookup:run', val);
        if (r && r.type === 'dictionary') {
          if (!Array.isArray(r.results)) r.results = [];
          const wrap = document.createElement('div'); wrap.className = 'dict-page'; out.innerHTML = ''; out.appendChild(wrap);
          DictView.render(wrap, r, { ai: (t) => aiEntry(t, val), manage: () => window.aib.invoke('nav:openUrl', 'aibrowser://settings#dict'), onSuggest: (w) => lookup(w) });
        } else { out.innerHTML = ''; const d = document.createElement('div'); d.className = 'dict-ai-only'; out.appendChild(d); aiEntry(d, val); }
      } catch (e) { out.innerHTML = `<div class="lk-msg">${esc(e.message)}</div>`; }
    };
    document.getElementById('dictForm').addEventListener('submit', (e) => { e.preventDefault(); lookup(); });
    if (params.get('q')) lookup(params.get('q')); else wInput.focus();
  }

  if (id === 'geogebra' || id === 'physics') {
    const inputId = id === 'geogebra' ? 'ggbCmd' : 'physQ';
    const formId = id === 'geogebra' ? 'ggbForm' : 'physForm';
    const openBoard = () => openExtFrame();
    document.getElementById('openBoard').onclick = openBoard;
    document.getElementById(formId).addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById(inputId).value.trim();
      const existed = !!main.querySelector('.tool-frame');
      if (!existed) openExtFrame();
      const frame = main.querySelector('.tool-frame');
      if (id === 'geogebra' && val) {
        const send = () => setTimeout(() => panelCall('eval', { commands: [val] }), existed ? 50 : 500);
        if (existed) send();
        else frame.addEventListener('load', send, { once: true });
      }
    });
    document.getElementById(inputId).focus();
  }

  if (id === 'solve' || (!ext && id !== 'wiki' && id !== 'dict')) {
    const refs = [];
    const $ = (x) => document.getElementById(x);
    const prob = $('prob');
    if (!prob) return;
    const grow = () => { prob.style.height = 'auto'; prob.style.height = Math.min(prob.scrollHeight, 240) + 'px'; };
    prob.addEventListener('input', grow);
    prob.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $('solveForm').requestSubmit();
      }
    });

    const refPanel = $('refpanel');
    const refToggle = $('reftoggle');
    const setRefPanel = (open) => {
      refPanel.hidden = !open;
      refToggle.setAttribute('aria-expanded', String(open));
      refToggle.classList.toggle('on', open);
      if (open) $('rt').focus();
    };
    refToggle.onclick = () => setRefPanel(refPanel.hidden);
    $('refclose').onclick = () => { setRefPanel(false); refToggle.focus(); };
    const paintRefs = () => {
      $('refs').textContent = refs.length ? '已添加 ' + refs.length + ' 条参考资料' : '';
      $('reflist').innerHTML = refs.map((r, i) => `<li><span title="${esc(r.text)}">${esc(r.title)}</span><button type="button" class="solve-attach-x" data-rm="${i}" title="移除" aria-label="移除 ${esc(r.title)}">×</button></li>`).join('');
      const c = $('refcount');
      c.hidden = !refs.length;
      c.textContent = refs.length ? String(refs.length) : '';
    };
    $('reflist').onclick = (e) => {
      const b = e.target.closest('[data-rm]');
      if (!b) return;
      refs.splice(Number(b.dataset.rm), 1);
      paintRefs();
    };
    $('addref').onclick = () => {
      const rt = $('rt');
      const rb = $('rb');
      const title = rt.value.trim();
      const text = rb.value.trim();
      if (!title && !text) return;
      refs.push({ title: title || `资料 ${refs.length + 1}`, text });
      rt.value = '';
      rb.value = '';
      paintRefs();
      rt.focus();
    };

    let image = '';
    const paintImage = (label) => {
      $('attach').hidden = !image;
      $('imgst').textContent = image ? label : '';
    };
    $('imgx').onclick = () => { image = ''; $('file').value = ''; paintImage(''); prob.focus(); };
    $('img').onclick = () => $('file').click();
    $('file').onchange = () => {
      const f = $('file').files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        image = rd.result;
        paintImage('已选择图片：' + f.name);
      };
      rd.readAsDataURL(f);
    };
    window.aib.on('solve:photo', (p) => {
      image = (p && p.dataUrl) || image;
      const q = $('qr');
      if (q) q.hidden = true;
      paintImage('已接收拍摄的图片');
    });
    $('phone').onclick = async () => {
      const r = await window.aib.invoke('solve:phone');
      const q = $('qr');
      q.innerHTML = `<div class="qr-card" role="dialog" aria-modal="true" aria-label="拍照上传"><button type="button" class="qr-close" title="关闭" aria-label="关闭">×</button><h3>拍照上传</h3><p class="hint">请将移动设备与本机连接至同一无线网络，扫描下方二维码拍摄并上传题目。</p><div class="qr-img">${(r && r.qr) || ''}</div><p class="qr-url">${esc(r && r.url)}</p></div>`;
      q.hidden = false;
      q.onclick = (e) => { if (e.target === q || e.target.closest('.qr-close')) q.hidden = true; };
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const q = $('qr');
        if (q && !q.hidden) q.hidden = true;
      }
    });
    $('solveForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = prob.value.trim();
      if (!text && !image) { prob.focus(); return; }
      const sid = await window.aib.invoke('chat:follow', '', text || '请根据图片解答题目', { kind: 'solve', refs, images: image ? [{ dataUrl: image }] : [] });
      if (sid) location.href = 'aibrowser://chat?sid=' + sid + '&tool=solve';
    });
    // 拍题即解 (F1): text and photo handed over by the native camera flow
    const snapId = params.get('snap');
    if (snapId) {
      window.aib.invoke('snap:get', snapId).then((sn) => {
        if (!sn) return;
        if (sn.text) { prob.value = sn.text; grow(); }
        if (sn.dataUrl) { image = sn.dataUrl; paintImage('已附加拍摄的题目照片'); }
        if (params.get('auto') === '1' && (sn.text || sn.dataUrl)) $('solveForm').requestSubmit();
      }).catch(() => {});
    }
    // camera capture wherever images are accepted (F1)
    if (window.aib && window.aib.ipad) {
      const cam = document.createElement('button'); cam.type = 'button'; cam.className = 'solve-chip'; cam.id = 'cam'; cam.title = '用相机拍摄题目'; cam.setAttribute('aria-label', '拍照');
      cam.innerHTML = (window.AIB_ICONS ? AIB_ICONS.svg('camera') : '') + '<span>拍照</span>';
      $('img').after(cam);
      cam.onclick = async () => {
        const r = await window.aib.invoke('camera:capture', { ocr: true }).catch(() => null);
        if (!r || r.cancelled || !r.dataUrl) return;
        image = r.dataUrl; paintImage('已附加拍摄的照片');
        if (r.text && !prob.value.trim()) { prob.value = r.text; grow(); }
      };
      const ph = $('phone'); if (ph) ph.hidden = true; // the iPad has its own camera
    }
    prob.focus();
  }
  // 交给 AI (U4): every tool home can hand its input to the AI; the answer opens in this tool view with the chat renderer
  const askBtn = document.getElementById('askai');
  if (askBtn) {
    const INPUT = { geogebra: 'ggbCmd', physics: 'physQ', wiki: 'q', dict: 'w' };
    const PREFIX = { geogebra: '请使用 GeoGebra 作图并说明：', physics: '请用物理实验台演示并讲解：', wiki: '请结合离线百科回答：', dict: '请详细解释以下词语的含义、用法与例句：' };
    askBtn.onclick = async () => {
      const el = document.getElementById(INPUT[id] || '');
      const v = el ? el.value.trim() : '';
      if (!v) { if (el) el.focus(); return; }
      const sid = await window.aib.invoke('chat:follow', '', (PREFIX[id] || '') + v, {});
      if (sid) location.href = 'aibrowser://chat?sid=' + sid + '&tool=' + encodeURIComponent(id);
    };
  }
  // model switcher on tool pages that send to the AI (solve)
  const mpHost = document.getElementById('toolmodel');
  if (mpHost && window.AIBModelPicker) {
    const mp = AIBModelPicker.mount(mpHost, {
      lang: () => (window.I18N && I18N.lang === 'en' ? 'en' : 'zh'),
      load: () => window.aib.invoke('models:picker'),
      select: (ref) => window.aib.invoke('models:select', ref),
      thinking: { load: () => window.aib.invoke('models:thinking'), select: (lv) => window.aib.invoke('models:setThinking', lv) },
      onManage: () => window.aib.invoke('nav:openUrl', 'aibrowser://settings#ai')
    });
    window.__AIB_MP__ = mp;
    window.aib.on('models:changed', () => mp.refresh());
    window.aib.on('settings:changed', () => mp.refresh());
  }
})();
