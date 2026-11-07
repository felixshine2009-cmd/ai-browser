(async function () {
  await I18N.init();
  const id = new URLSearchParams(location.search).get('id') || 'solve';
  const root = document.getElementById('root');
  const titles = { geogebra: 'GeoGebra', physics: '物理', solve: '解题', wiki: '离线百科', dict: '词典' };
  const ext = id === 'geogebra' ? 'aib.geogebra' : id === 'physics' ? 'aib.physics' : '';
  root.innerHTML = `<div class="tool-main" id="main"></div><aside class="tool-ai"><h3>一起改</h3><div id="notes"></div><textarea id="note" rows="3" placeholder="写给对方的备注"></textarea><button type="button" id="send">记下</button><div id="extra"></div></aside>`;
  const main = document.getElementById('main');
  if (ext) main.innerHTML = `<div class="tool-bar">${titles[id] || id}</div><iframe class="tool-frame" src="aibext://${ext}/panel.html"></iframe>`;
  else if (id === 'wiki') main.innerHTML = `<div class="tool-bar">${titles.wiki}</div><p class="hint">内置条目可离线检索。完整维基请把 JSONL（每行 {"title","text"}）放到用户目录的 wiki 文件夹，或粘贴在下面。不要把大型数据包放进仓库。</p><input id="q" placeholder="搜索"><div id="hits"></div><textarea id="dump" rows="4" placeholder='{"title":"…","text":"…"}'></textarea><button type="button" id="imp">导入</button>`;
  else if (id === 'dict') main.innerHTML = `<div class="tool-bar">${titles.dict}</div><input id="w" placeholder="单词"><button type="button" id="go">查询</button><div id="out"></div>`;
  else {
    main.innerHTML = `<div class="tool-bar">解题</div><textarea id="prob" rows="5" placeholder="输入或粘贴题目"></textarea>
      <div class="row"><button type="button" id="img">上传图片</button><button type="button" id="phone">用手机拍照</button><button type="button" id="ask">求解</button></div>
      <input id="file" type="file" accept="image/*" hidden>
      <div id="qr"></div><div id="refs"></div>
      <input id="rt" placeholder="参考资料标题"><textarea id="rb" rows="2" placeholder="参考资料正文"></textarea><button type="button" id="addref">添加参考资料</button>`;
  }
  async function notes() {
    const bag = await window.aib.invoke('collab:get', id);
    document.getElementById('notes').innerHTML = (bag.notes || []).map(n => `<p><b>${n.who === 'ai' ? 'AI' : '我'}</b> ${String(n.text).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</p>`).join('');
  }
  document.getElementById('send').onclick = async () => {
    const v = document.getElementById('note').value.trim(); if (!v) return;
    await window.aib.invoke('collab:note', id, 'human', v);
    document.getElementById('note').value = ''; notes();
  };
  notes();
  if (id === 'wiki') {
    const run = async () => { const r = await window.aib.invoke('wiki:search', document.getElementById('q').value); document.getElementById('hits').innerHTML = (r.hits || []).map(h => `<article><h4>${h.title}</h4><p>${h.text}</p><button type="button" data-tr="${h.title}">翻译</button></article>`).join(''); };
    document.getElementById('q').addEventListener('input', run); run();
    document.getElementById('imp').onclick = async () => { const n = await window.aib.invoke('wiki:import', document.getElementById('dump').value); alert('导入 ' + n.imported); run(); };
    document.getElementById('hits').onclick = async (e) => {
      const b = e.target.closest('[data-tr]'); if (!b) return;
      const sid = await window.aib.invoke('nav:submit', '翻译离线百科：' + b.dataset.tr);
    };
  }
  if (id === 'dict') document.getElementById('go').onclick = () => window.aib.invoke('nav:submit', document.getElementById('w').value.trim());
  if (id === 'solve' || !ext && id !== 'wiki' && id !== 'dict') {
    const refs = [];
    document.getElementById('addref').onclick = () => { refs.push({ title: document.getElementById('rt').value, text: document.getElementById('rb').value }); document.getElementById('refs').textContent = '参考资料 ' + refs.length + ' 条'; };
    document.getElementById('img').onclick = () => document.getElementById('file').click();
    let image = '';
    document.getElementById('file').onchange = () => {
      const f = document.getElementById('file').files[0]; if (!f) return;
      const rd = new FileReader(); rd.onload = () => { image = rd.result; };
      rd.readAsDataURL(f);
    };
    window.aib.on('solve:photo', (p) => { image = p.dataUrl || image; document.getElementById('qr').textContent = '已收到手机照片'; });
    document.getElementById('phone').onclick = async () => {
      const r = await window.aib.invoke('solve:phone');
      document.getElementById('qr').innerHTML = r.qr + `<p>${r.url}</p>`;
    };
    document.getElementById('ask').onclick = async () => {
      const text = document.getElementById('prob').value.trim(); if (!text && !image) return;
      const sid = await window.aib.invoke('chat:follow', '', text || '请根据图片解题', { kind: 'solve', refs, images: image ? [{ dataUrl: image }] : [] });
      if (sid) location.href = 'aibrowser://chat?sid=' + sid;
    };
  }
})();
