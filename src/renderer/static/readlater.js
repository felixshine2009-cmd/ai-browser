// Read later / offline copies (F4): saved pages with full offline copies, searchable together with the offline
// encyclopedia (ZIM).
(async function () {
  await I18N.init();
  const root = document.getElementById('root');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const fmtDate = (t) => { const d = new Date(t); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  root.innerHTML = `
    <header class="rl-head">
      <div><h1>稍后阅读</h1><p class="hint">保存的网页附带完整离线副本，无网络时亦可阅读；可与离线百科一并检索。</p></div>
      <button type="button" class="primary" id="save">保存当前页面</button>
    </header>
    <form class="rl-search" id="sf"><input id="q" type="search" placeholder="检索已保存的网页与离线百科" aria-label="检索"><button type="submit">检索</button></form>
    <p class="hint" id="st" role="status"></p>
    <section id="results" class="rl-results" hidden></section>
    <section id="list" class="rl-list"></section>`;
  const $ = (id) => document.getElementById(id);
  async function paint() {
    const l = await window.aib.invoke('readlater:list');
    $('list').innerHTML = l.length ? l.map(e => `<article class="rl-item${e.read ? ' read' : ''}" data-id="${esc(e.id)}">
        <div class="rl-main"><h3>${esc(e.title)}</h3><p class="rl-url">${esc(e.url)}</p><p class="rl-ex">${esc(e.excerpt)}</p>
        <p class="rl-meta">${fmtDate(e.savedAt)} · 离线副本 ${fmtSize(e.bytes || 0)}${e.read ? ' · 已读' : ''}</p></div>
        <div class="rl-act"><button type="button" data-open="${esc(e.id)}" class="primary">离线阅读</button><button type="button" data-live="${esc(e.url)}">打开原网页</button><button type="button" data-rm="${esc(e.id)}">删除</button></div>
      </article>`).join('') : '<div class="rl-empty"><p>尚未保存任何网页。</p><p class="hint">在网页中点击“保存当前页面”，即可保存离线副本。</p></div>';
  }
  $('save').onclick = async () => {
    $('st').textContent = '正在保存离线副本…';
    try { const e = await window.aib.invoke('readlater:save'); $('st').textContent = '已保存：' + e.title; paint(); }
    catch (err) { $('st').textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  };
  document.body.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]'); if (o) { await window.aib.invoke('readlater:open', o.dataset.open); return; }
    const lv = e.target.closest('[data-live]'); if (lv) { await window.aib.invoke('nav:openUrl', lv.dataset.live); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { await window.aib.invoke('readlater:remove', rm.dataset.rm); paint(); return; }
    const w = e.target.closest('[data-wiki]'); if (w) { window.aib.invoke('tool:open', 'wiki', 'aibrowser://tool?id=wiki&q=' + encodeURIComponent(w.dataset.wiki)); }
  });
  $('sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('q').value.trim(); const box = $('results');
    if (!q) { box.hidden = true; return; }
    const r = await window.aib.invoke('readlater:search', q);
    const saved = (r && r.saved) || [], wiki = (r && r.wiki) || [];
    box.hidden = false;
    box.innerHTML = `<h2>检索结果</h2>` +
      (saved.length ? `<h4>已保存的网页（${saved.length}）</h4>` + saved.map(h => `<article class="rl-hit"><h3>${esc(h.title)}</h3><p>${esc(h.snippet)}</p><button type="button" class="primary" data-open="${esc(h.id)}">离线阅读</button></article>`).join('') : '<p class="hint">已保存的网页中没有匹配内容。</p>') +
      (wiki.length ? `<h4>离线百科（${wiki.length}）</h4>` + wiki.map(h => `<article class="rl-hit"><h3>${esc(h.title)}</h3><p>${esc(h.text || h.path || '')}</p><button type="button" data-wiki="${esc(h.title)}">在百科中阅读</button></article>`).join('') : '<p class="hint">离线百科中没有匹配词条（或尚未打开 ZIM 文件）。</p>');
  });
  window.aib.on('readlater:changed', paint);
  paint();
})();
