(function () {
  window.mountExtensions = async function mountExtensions(root, hooks) {
  hooks = hooks || {};
  const embedded = root !== document.getElementById('root');
  let dead = false; const offs = [];
  const esc = MD.esc;
  let feats = [], chromes = [], preview = null;

  const toggle = (on, attr) => `<div class="toggle ${on ? 'on' : ''}" ${attr}></div>`;
  function nm(e) { const i = e.i18n && e.i18n[I18N.lang]; return i ? i.name : e.name; }
  function ds(e) { const i = e.i18n && e.i18n[I18N.lang]; return i ? i.description : e.description; }

  async function load() { if (dead || !root.isConnected) return; feats = await window.aib.invoke('ext:list'); chromes = await window.aib.invoke('cx:list'); render(); showCws(); }

  let cwsNote = null; // survives re-render (installing triggers an ext:changed refresh)
  const showCws = () => { const st = document.getElementById('cwsstat'); if (st && cwsNote) { st.className = 'test-result ' + cwsNote.cls; st.textContent = cwsNote.text; } };
  function render() {
    root.innerHTML = `<div class="ext-page"><h1>${esc(t('ext.pageTitle'))}</h1><div class="sub">${esc(t('ext.pageSub'))}</div>
      <div class="std-note-plain">${esc(t('ext.std.note'))}</div>
      <div class="ext-sec-title"><span>${esc(t('ext.cat.feature'))}</span><span class="meta-quiet">${esc(t('ext.cat.feature.hint'))}</span><button class="btn-ghost-load" id="loadfeat">${esc(t('ext.load'))}</button></div>
      <div class="ext-grid tight" id="feats"></div>
      <div class="ext-sec-title"><span>${esc(t('ext.cat.normal'))}</span><span class="meta-quiet">${esc(t('ext.cat.normal.hint'))}</span></div>
      <div class="cws-row"><input type="text" id="cwsin" spellcheck="false" placeholder="${esc(t('cws.placeholder'))}"/><button class="btn-primary" id="cwsgo">${esc(t('cws.addFromStore'))}</button><button class="btn-ghost-load" id="cwsopen">${esc(t('cws.openStore'))}</button><span class="test-result" id="cwsstat"></span></div>
      <div class="ext-grid tight" id="chromes"></div>
      <details class="adv-load"><summary>${esc(t('cws.advanced'))}</summary><button class="btn-ghost-load" id="loadchrome">${esc(t('ext.loadChrome'))}</button></details>
      <div class="ai-builder compact"><h3>${esc(t('ext.ai.title'))}</h3><p>${esc(t('ext.ai.hint'))}</p>
        <textarea id="aiprompt" placeholder="${esc(t('ext.ai.placeholder'))}"></textarea>
        <div class="actions"><select id="aikind" style="background:var(--bg-input);border:.5px solid var(--separator);border-radius:6px;padding:0 8px;color:var(--text-primary)"><option value="feature">${esc(t('ext.cat.feature'))}</option><option value="chrome">${esc(t('ext.cat.normal'))}</option></select>
        <button class="btn-primary" id="aigen">${esc(t('ext.ai.gen'))}</button><button class="btn-secondary" id="loadzip">${esc(t('ext.ai.load'))}</button><span class="test-result" id="aistat"></span></div></div></div>`;
    const fg = document.getElementById('feats');
    feats.forEach(e => {
      const c = document.createElement('div'); c.className = 'ext-card'; c.dataset.ext = e.id;
      c.innerHTML = `<div class="info"><div class="name">${esc(nm(e))}${e.builtin ? `<span class="tag-bi">${esc(t('ext.badge.preinstall'))}</span>` : ''}<span class="ver">v${esc(e.version)}</span></div>
        <div class="desc">${esc(ds(e))}</div>${e.error ? `<div class="err">${esc(e.error)}</div>` : ''}
        <div class="meta-row"><button class="btn-update" data-act="update">${esc(t('ext.checkUpdate'))}</button>${e.settingsPage ? `<button class="btn-update" data-act="settings">${esc(t('ext.settings'))}</button>` : ''}${e.builtin ? '' : `<button class="btn-update" data-act="remove">${esc(t('common.delete'))}</button>`}<span class="upd-msg"></span></div></div>
        <div class="side-col">${toggle(e.enabled, 'data-act="toggle"')}</div>`;
      c.onclick = async (ev) => {
        const act = ev.target.dataset.act; if (!act) return;
        if (act === 'toggle') { feats = await window.aib.invoke('ext:setEnabled', e.id, !e.enabled); render(); }
        else if (act === 'settings') { if (hooks.openSettings) hooks.openSettings('dict'); else location.href = 'aibrowser://settings#dict'; }
        else if (act === 'remove') { await window.aib.invoke('ext:uninstall', e.id); load(); }
        else if (act === 'update') {
          const m = c.querySelector('.upd-msg'); m.textContent = t('ext.checking');
          try {
            const r = await window.aib.invoke('ext:checkUpdate', e.id, false);
            if (r.upToDate) m.textContent = t('ext.upToDate');
            else { m.innerHTML = `${esc(t('ext.newVersion', { v: r.latest }))} <button class="btn-update" data-act="doupdate">${esc(t('ext.update'))}</button>`; m.querySelector('button').onclick = async () => { m.textContent = '…'; try { await window.aib.invoke('ext:checkUpdate', e.id, true); load(); } catch (x) { m.textContent = x.message; } }; }
          } catch (x) { m.textContent = t('ext.updateFail'); }
        }
      };
      fg.appendChild(c);
    });
    const cg = document.getElementById('chromes');
    if (!chromes.length) cg.innerHTML = `<div class="engine-note" style="grid-column:1/3">${esc(t('ext.chrome.empty'))}</div>`;
    chromes.forEach(e => {
      const c = document.createElement('div'); c.className = 'ext-card'; c.dataset.cx = e.path;
      c.innerHTML = `<div class="info"><div class="name">${esc(e.name)}<span class="ver">v${esc(e.version || '')} · MV${esc(e.mv || '?')}</span></div><div class="desc">${esc(e.description || '')}</div>
        <div class="meta-row">${e.popupUrl ? `<button class="btn-update" data-act="popup">${esc(t('ext.popup'))}</button>` : ''}${e.optionsUrl ? `<button class="btn-update" data-act="options">${esc(t('ext.options'))}</button>` : ''}<button class="btn-update" data-act="remove">${esc(t('common.delete'))}</button></div></div>
        <div class="side-col">${toggle(e.enabled, 'data-act="toggle"')}</div>`;
      c.onclick = async (ev) => {
        const act = ev.target.dataset.act; if (!act) return;
        if (act === 'toggle') { await window.aib.invoke('cx:setEnabled', e.path, !e.enabled); load(); }
        else if (act === 'remove') { await window.aib.invoke('cx:remove', e.path); load(); }
        else if (act === 'popup') window.aib.invoke('cx:openUrl', e.popupUrl);
        else if (act === 'options') window.aib.invoke('cx:openUrl', e.optionsUrl);
      };
      cg.appendChild(c);
    });
    const stat = (s, bad) => { const x = document.getElementById('aistat'); x.className = 'test-result ' + (bad ? 'bad' : ''); x.textContent = s; };
    const guard = async (fn) => { try { return await fn(); } catch (e) { stat(e.message, true); } };
    document.getElementById('loadfeat').onclick = () => guard(async () => { const m = await window.aib.invoke('ext:installDir'); if (m) { stat(t('ext.installed') + ': ' + m.name); load(); } });
    document.getElementById('cwsgo').onclick = async () => {
      const inp = document.getElementById('cwsin'), st = document.getElementById('cwsstat'), go = document.getElementById('cwsgo');
      const v = inp.value.trim(); if (!v) return; go.disabled = true; cwsNote = { cls: '', text: t('cws.installing') }; showCws();
      const r = await window.aib.invoke('cx:installStore', v);
      cwsNote = r.ok ? { cls: 'ok', text: t('cws.done') + ': ' + r.ext.name } : { cls: 'bad', text: r.error };
      const go2 = document.getElementById('cwsgo'); if (go2) go2.disabled = false; const in2 = document.getElementById('cwsin'); if (r.ok && in2) in2.value = '';
      showCws(); if (r.ok) load();
    };
    document.getElementById('cwsin').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('cwsgo').click(); };
    document.getElementById('cwsopen').onclick = () => window.aib.invoke('nav:openUrl', 'https://chromewebstore.google.com/');
    document.getElementById('loadchrome').onclick = () => guard(async () => { const r = await window.aib.invoke('cx:add'); if (r) { stat(t('ext.installed') + ': ' + r.name); load(); } });
    document.getElementById('loadzip').onclick = () => guard(async () => {
      const kind = document.getElementById('aikind').value;
      if (kind === 'chrome') { const r = await window.aib.invoke('cx:add'); if (r) { stat(t('ext.installed') + ': ' + r.name); load(); } }
      else { const m = await window.aib.invoke('ext:installZip'); if (m) { stat(t('ext.installed') + ': ' + m.name); load(); } }
    });
    document.getElementById('aigen').onclick = () => guard(async () => {
      const prompt = document.getElementById('aiprompt').value.trim(); if (!prompt) return;
      stat(t('ext.ai.generating'));
      const kind = document.getElementById('aikind').value;
      preview = await window.aib.invoke('ext:aiGenerate', prompt, kind);
      stat('');
      showPreview();
    });
  }

  function showPreview() {
    const p = preview;
    const back = document.createElement('div'); back.className = 'modal-back'; back.id = 'modal';
    const files = Object.entries(p.files);
    back.innerHTML = `<div class="modal"><header>${esc(t('ext.preview.title'))}</header><div class="mbody selectable"><div>${esc(p.summary || '')}</div>
      ${p.problems.length ? `<div class="problems">${p.problems.map(esc).join('<br>')}</div>` : ''}
      <div class="engine-note" style="margin-top:8px">${esc(t('ext.preview.warn'))}</div>
      ${files.map(([n, c]) => `<div class="fname">${esc(n)}</div><pre>${esc(c)}</pre>`).join('')}</div>
      <footer><button class="btn-secondary" id="mcancel">${esc(t('common.cancel'))}</button><button class="btn-primary" id="minstall" ${p.problems.length ? 'disabled style="opacity:.4"' : ''}>${esc(t('ext.preview.install'))}</button></footer></div>`;
    document.body.appendChild(back);
    document.getElementById('mcancel').onclick = () => back.remove();
    document.getElementById('minstall').onclick = async () => {
      try { await window.aib.invoke('ext:aiInstall', p.kind, p.files); back.remove(); load(); }
      catch (e) { const pr = back.querySelector('.mbody'); pr.insertAdjacentHTML('afterbegin', `<div class="problems">${esc(e.message)}</div>`); }
    };
  }

  if (!embedded) document.title = t('ext.pageTitle');
  await load();
  I18N.onChange(() => { if (dead || !root.isConnected) return; if (!embedded) document.title = t('ext.pageTitle'); render(); });
  const off = window.aib.on('ext:changed', load); if (typeof off === 'function') offs.push(off);
  return { destroy() { dead = true; offs.forEach(f => f()); const m = document.getElementById('modal'); if (m) m.remove(); } };
  };
  if (!document.body.dataset.embed) (async function () { await I18N.init(); window.mountExtensions(document.getElementById('root')); })();
})();
