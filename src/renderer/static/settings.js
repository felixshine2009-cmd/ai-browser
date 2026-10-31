(async function () {
  let S = await I18N.init();
  const root = document.getElementById('root');
  const esc = MD.esc;
  const NAV = [['ai', 'settings.nav.ai'], ['search', 'settings.nav.search'], ['dict', 'settings.nav.dict'], ['ext', 'menu.extensions'], ['history', 'menu.history'], ['general', 'settings.nav.general'], ['privacy', 'settings.nav.privacy']];
  // section <-> URL hash (aibrowser://settings#extensions). 'ext' is the internal id, 'extensions' the public hash.
  const hashOf = id => (id === 'ext' ? 'extensions' : id);
  const fromHash = () => { let h = (location.hash || '#ai').slice(1); if (h === 'extensions') h = 'ext'; return NAV.some(n => n[0] === h) ? h : 'ai'; };
  let cur = fromHash();
  let embed = null; // destroy handle of an embedded page (extensions / history)
  function leaveEmbed() { if (embed) { try { embed.destroy(); } catch {} embed = null; } }
  let aiTab = null; // 'api' | 'local'
  let presets = {}, engines = {}, models = [], lmStatus = null, progress = {};

  // ---- prominent save feedback (green check + text, fades after ~3s; errors stay, red)
  const CHECK = '<svg class="ck" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function notice(el, kind, text, opts) {
    if (!el) return;
    opts = opts || {};
    clearTimeout(el._t1); clearTimeout(el._t2);
    el.className = 'save-note ' + kind + (el.id === 'tres' ? ' block' : '');
    el.innerHTML = (kind === 'ok' ? CHECK : '') + '<span>' + esc(text) + '</span>';
    el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    if (kind === 'ok' && !opts.sticky) {
      el._t1 = setTimeout(() => { el.classList.add('fade'); el._t2 = setTimeout(() => { el.textContent = ''; el.className = ''; }, 260); }, opts.ms || 3000);
    }
  }
  // immediate-persist controls (checkboxes, radios, selects) use a small toast in the pane corner
  function toast(text, kind) {
    let el = document.getElementById('savetoast');
    if (!el) { el = document.createElement('div'); el.id = 'savetoast'; document.body.appendChild(el); }
    notice(el, kind || 'ok', text || t('common.saved'));
    el.classList.add('save-toast');
  }

  async function refresh() { S = await window.aib.invoke('settings:get'); }
  function shell() {
    root.innerHTML = `<div class="settings-page"><div class="settings-nav"><div class="nav-title">${esc(t('settings.title'))}</div><div id="nav"></div></div><div class="settings-pane"><div class="section" id="pane"></div></div></div>`;
    const nav = document.getElementById('nav');
    NAV.forEach(([id, key]) => {
      const d = document.createElement('div'); d.className = 'nav-item' + (id === cur ? ' active' : ''); d.dataset.nav = id; d.textContent = t(key);
      d.onclick = () => {
        // switch INSIDE the settings page; the hashchange handler re-renders (and gives back/forward for free)
        if (location.hash === '#' + hashOf(id)) return;
        location.hash = hashOf(id);
      };
      nav.appendChild(d);
    });
  }
  const pane = () => document.getElementById('pane');
  const row = (label, inner, hint) => `<div class="form-row"><label>${esc(label)}</label>${inner}${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
  const seg = (items, active, attr) => `<div class="mode-seg">${items.map(([v, l]) => `<div class="seg ${active === v ? 'active' : ''} ${v === 'api' || v === 'local' ? '' : ''}" data-${attr}="${v}">${esc(l)}</div>`).join('')}</div>`;

  // ---------------- AI
  async function renderAI() {
    await refresh();
    aiTab = aiTab || S.ai.source;
    presets = await window.aib.invoke('ai:presets');
    const p = pane();
    p.innerHTML = `<h2>${esc(t('ai.title'))}</h2><div class="sub">${esc(t('ai.sub'))}</div>
      <div class="src-row">${seg([['api', t('ai.src.api')], ['local', t('ai.src.local')]], aiTab, 'src')}<span class="hint">${esc(t('ai.active'))}: <b id="activeSrc">${esc(S.ai.source === 'api' ? t('ai.src.api') : t('ai.src.local'))}</b></span></div><div id="aibody"></div>`;
    p.querySelectorAll('[data-src]').forEach(b => b.onclick = () => { aiTab = b.dataset.src; renderAI(); });
    if (aiTab === 'api') renderApi(); else renderLocal();
  }
  function renderApi() {
    const a = S.ai.api;
    const modelField = `<div class="combo" id="combo"><input id="model" value="${esc(a.model)}" spellcheck="false" autocomplete="off" placeholder="${esc(t('ai.api.modelPh'))}"/><button type="button" class="combo-btn" id="modelbtn" title="${esc(t('ai.api.models'))}" tabindex="-1">▾</button><div class="combo-pop" id="modelpop" hidden></div></div><div class="hint" id="modelhint">${esc(t('ai.api.modelHint'))}</div>`;
    document.getElementById('aibody').innerHTML =
      row(t('ai.api.preset'), `<select id="preset">${Object.entries(presets).map(([k, v]) => `<option value="${k}" ${a.preset === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>`) +
      row(t('ai.api.format'), `<select id="format"><option value="openai" ${a.format !== 'anthropic' ? 'selected' : ''}>OpenAI (/chat/completions)</option><option value="anthropic" ${a.format === 'anthropic' ? 'selected' : ''}>Anthropic (/v1/messages)</option></select>`) +
      row('Base URL', `<input id="baseUrl" value="${esc(a.baseUrl)}" spellcheck="false"/>`) +
      row('API Key', `<input id="apiKey" type="password" autocomplete="off" placeholder="${a.hasKey ? esc(t('ai.api.keySaved')) : 'sk-…'}"/>`, t('ai.api.keyHint')) +
      `<div class="form-row"><label>${esc(t('ai.api.model'))}</label>${modelField}</div>` +
      row(t('ai.api.temp'), `<input id="temp" type="number" min="0" max="2" step="0.1" value="${a.temperature}"/>`) +
      `<div class="inline"><button class="btn-primary" id="save">${esc(t('common.save'))}</button><button class="btn-secondary" id="test">${esc(t('ai.api.test'))}</button></div><div class="test-result" id="tres"></div>`;
    const $ = id => document.getElementById(id);
    let modelList = [];
    const pop = $('modelpop');
    const drawPop = (filter) => {
      const f = (filter || '').toLowerCase();
      const items = modelList.filter(m => !f || m.toLowerCase().includes(f));
      pop.innerHTML = items.length ? items.map(m => `<div class="combo-item${m === $('model').value ? ' sel' : ''}" data-m="${esc(m)}">${esc(m)}</div>`).join('') : `<div class="combo-empty">${esc(modelList.length ? t('ai.api.noMatch') : t('ai.api.noModels'))}</div>`;
    };
    const openPop = (filter) => { drawPop(filter); pop.hidden = false; };
    const closePop = () => { pop.hidden = true; };
    $('modelbtn').onclick = () => { pop.hidden ? openPop('') : closePop(); };
    $('model').addEventListener('input', () => { if (modelList.length) openPop($('model').value); });
    $('model').addEventListener('focus', () => { if (modelList.length) openPop(''); });
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    pop.addEventListener('click', async (e) => {
      const it = e.target.closest('[data-m]'); if (!it) return;
      $('model').value = it.dataset.m; closePop();
      await window.aib.invoke('settings:patch', { ai: { api: { model: it.dataset.m } } }); toast(); // choosing from the list persists immediately
      $('modelhint').textContent = t('ai.api.modelSaved', { m: it.dataset.m });
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#combo')) closePop(); });
    $('preset').onchange = () => { const pr = presets[$('preset').value]; if (pr && $('preset').value !== 'custom') { $('baseUrl').value = pr.baseUrl; $('model').value = pr.model; $('format').value = pr.format; modelList = []; } };
    const gather = () => ({ preset: $('preset').value, format: $('format').value, baseUrl: $('baseUrl').value.trim(), apiKey: $('apiKey').value, model: $('model').value.trim(), temperature: parseFloat($('temp').value) || 0 });
    $('save').onclick = async () => { await window.aib.invoke('settings:patch', { ai: { source: 'api', api: gather() } }); $('apiKey').value = ''; notice($('tres'), 'ok', t('common.saved')); await refresh(); $('activeSrc').textContent = t('ai.src.api'); };
    $('test').onclick = async () => {
      const btn = $('test'); btn.disabled = true;
      $('tres').className = 'save-note block'; $('tres').textContent = t('ai.api.testing');
      let r;
      try { r = await window.aib.invoke('ai:test', gather()); } catch (e) { r = { ok: false, error: e.message }; }
      btn.disabled = false;
      const res = $('tres');
      if (!r.ok) { notice(res, 'bad', `${t('ai.api.testFail')}: ${r.error}`); return; }
      if (r.chatOnly) { notice(res, 'ok', `${t('ai.api.testOk')} · ${r.note || ''} · ${r.ms} ms`, { sticky: true }); return; }
      modelList = r.models || [];
      let msg = `${t('ai.api.testOk')} · ${t('ai.api.fetched', { n: r.count })} · ${r.ms} ms`;
      if (r.baseUrl && r.baseUrl !== gather().baseUrl.replace(/\/+$/, '')) { $('baseUrl').value = r.baseUrl; msg += ` · ${t('ai.api.urlFixed', { u: r.baseUrl })}`; }
      const cur = $('model').value.trim();
      if (modelList.length && cur && !modelList.includes(cur)) msg += ` · ${t('ai.api.modelMissing', { m: cur })}`;
      if (modelList.length && !cur) { $('model').value = modelList[0]; }
      notice(res, 'ok', msg, { sticky: true });
      if (modelList.length) { $('modelhint').textContent = t('ai.api.fetched', { n: r.count }) + ' — ' + t('ai.api.pickHint'); openPop(''); }
    };
  }
  // Local models. Selecting a model (radio / whole card) is independent from downloading it:
  //  - the selection is stored immediately (settings.ai.local.modelId + modelPath = expected file location);
  //  - a not-yet-downloaded model is shown as "已选择"; 「使用本地模型」 on it starts the download automatically.
  const selId = () => { const L = S.ai.local; if (L.modelId) return L.modelId; const m = models.find(x => x.path === L.modelPath); return m ? m.id : ''; };
  async function selectModel(m) {
    await window.aib.invoke('settings:patch', { ai: { local: { modelPath: m.path, modelId: m.id } } });
    await refresh(); renderLocal(); toast();
  }
  function startDownload(m) {
    progress[m.id] = { got: m.partial, total: m.bytes };
    window.aib.invoke('settings:patch', { ai: { local: { hfMirror: document.getElementById('mirror').checked } } })
      .then(() => window.aib.invoke('lm:download', m.id));
    renderLocal();
  }
  async function renderLocal() {
    models = await window.aib.invoke('lm:list');
    const L = S.ai.local;
    const body = document.getElementById('aibody');
    if (!body) return;
    body.innerHTML = `<div class="engine-note">${esc(t('ai.local.note'))}</div><div class="model-list" id="mlist"></div>
      <div class="inline" style="margin-bottom:12px"><button class="btn-secondary" id="pickgguf">${esc(t('ai.local.pick'))}</button><label class="inline" style="font-size:13px;color:var(--text-secondary)"><input type="checkbox" id="mirror" ${L.hfMirror ? 'checked' : ''}/>${esc(t('ai.local.mirror'))}</label></div>
      <div class="engine-note" id="lmpath"></div>
      <div class="form-row" id="trrow"><label>${esc(t('ai.local.translateModel'))}</label>
        <select id="trmodel"><option value="">${esc(t('ai.local.translateSame'))}</option>${models.filter(x => (x.tags||[]).includes('translate') || x.downloaded).map(x => `<option value="${esc(x.id)}" ${L.translateModelId===x.id?'selected':''}>${esc(x.name)}${x.downloaded?' ✓':''}</option>`).join('')}</select>
        <div class="hint">${esc(t('ai.local.translateHint'))}</div></div>
      <div class="engine-note" id="lmstat"></div>
      <div class="inline"><button class="btn-primary" id="uselocal">${esc(t('ai.local.use'))}</button><span id="lmmsg"></span></div><div class="hint" style="margin-top:10px">${esc(t('ai.local.hint'))}</div>`;
    const list = document.getElementById('mlist');
    list.innerHTML = '';
    const sid = selId();
    for (const m of models) {
      const selected = !!sid && sid === m.id;
      const r = document.createElement('div'); r.className = 'model-row' + (selected ? ' selected' : ''); r.dataset.model = m.id;
      r.setAttribute('role', 'radio'); r.setAttribute('aria-checked', selected ? 'true' : 'false');
      const pr = progress[m.id];
      const dl = pr && !pr.done && !pr.error ? Math.round(pr.got / (pr.total || 1) * 100) : null;
      const state = selected ? (m.downloaded ? t('ai.local.inuse') : t('ai.local.picked')) : '';
      const tags = (m.tags || []).map(tg => `<span class="mtag ${esc(tg)}">${esc(tg === 'translate' ? t('ai.local.tag.translate') : tg === 'light' ? t('ai.local.tag.light') : t('ai.local.tag.general'))}</span>`).join('');
      r.innerHTML = `<div class="radio"></div><div class="m-info"><div class="m-name">${esc(m.name)} ${tags}</div><div class="m-sub">${esc(m.note)} · RAM ${esc(m.ram || '?')} · llama.cpp${dl != null ? `<div class="progress"><i style="width:${dl}%"></i></div>` : ''}${pr && pr.error ? `<div style="color:var(--danger)">${esc(pr.error)}</div>` : ''}</div>
        <div class="m-size">${esc(m.size)}</div><div class="m-state">${esc(state)}</div>
        ${m.downloaded ? `<button class="btn-dl" data-act="del">${esc(t('common.delete'))}</button>` : (dl != null ? `<button class="btn-dl" data-act="cancel">${dl}% ✕</button>` : `<button class="btn-dl" data-act="dl">${esc(m.partial ? t('ai.local.resume') : t('ai.local.download'))}</button>`)}`;
      r.onclick = async (e) => {
        const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
        if (act === 'dl') { startDownload(m); return; }
        if (act === 'cancel') { window.aib.invoke('lm:cancel', m.id); return; }
        if (act === 'del') { await window.aib.invoke('lm:delete', m.id); renderLocal(); return; }
        await selectModel(m); // whole card is the hit target, downloaded or not
      };
      list.appendChild(r);
    }
    const cur = models.find(x => x.id === sid);
    document.getElementById('lmpath').textContent = cur
      ? `${t('ai.local.selectedName')}: ${cur.name} · ${cur.downloaded ? t('ai.local.downloaded') : t('ai.local.notDownloaded')}`
      : (L.modelPath ? `${t('ai.local.current')}: ${L.modelPath}` : t('ai.local.none'));
    const hasSel = !!(cur || L.modelPath);
    const useBtn = document.getElementById('uselocal');
    useBtn.disabled = !hasSel;
    document.getElementById('pickgguf').onclick = async () => { await window.aib.invoke('lm:pick'); await refresh(); renderLocal(); };
    document.getElementById('mirror').onchange = async (e) => { await window.aib.invoke('settings:patch', { ai: { local: { hfMirror: e.target.checked } } }); toast(); };
    const tr = document.getElementById('trmodel');
    if (tr) tr.onchange = async (e) => { await window.aib.invoke('settings:patch', { ai: { local: { translateModelId: e.target.value } } }); toast(); };
    useBtn.onclick = async () => {
      if (!hasSel) { notice(document.getElementById('lmmsg'), 'bad', t('ai.local.pickFirst')); return; }
      await window.aib.invoke('settings:patch', { ai: { source: 'local' } }); await refresh();
      document.getElementById('activeSrc').textContent = t('ai.src.local');
      const msg = document.getElementById('lmmsg');
      if (cur && !cur.downloaded) {
        if (!progress[cur.id] || progress[cur.id].done || progress[cur.id].error) startDownload(cur);
        const m2 = document.getElementById('lmmsg'); if (m2) notice(m2, 'ok', t('ai.local.autoDl'), { ms: 4500 });
      } else { notice(msg, 'ok', t('common.saved')); }
    };
    window.aib.invoke('lm:status').then(s => { const e = document.getElementById('lmstat'); if (!e) return; e.textContent = s.engine === 'ok' ? `${t('ai.local.engineOk')}${s.gpu ? ' · ' + s.gpu : ''}` : `${t('ai.local.engineErr')}: ${s.engineError || ''}`; });
  }
  window.aib.on('lm:progress', (p) => {
    progress[p.id] = { ...(progress[p.id] || {}), ...p };
    if (!(cur === 'ai' && aiTab === 'local')) return;
    const full = p.done || p.error || p.deleted || !document.querySelector(`.model-row[data-model="${p.id}"] .progress`);
    if (full) { refresh().then(renderLocal); return; }
    // in-place update so clicks are never lost to a re-render during a download
    const row = document.querySelector(`.model-row[data-model="${p.id}"]`); if (!row) return;
    const pct = Math.round(progress[p.id].got / (progress[p.id].total || 1) * 100);
    const bar = row.querySelector('.progress > i'); if (bar) bar.style.width = pct + '%';
    const b = row.querySelector('[data-act="cancel"]'); if (b) b.textContent = pct + '% ✕';
  });

  // ---------------- search engine
  async function renderSearch() {
    await refresh();
    engines = await window.aib.invoke('engines:list');
    const cs = S.search;
    const p = pane();
    p.innerHTML = `<h2>${esc(t('se.title'))}</h2><div class="sub">${esc(t('se.sub'))}</div><div class="model-list" id="elist"></div>
      <div id="customrow" style="display:${cs.engine === 'custom' ? 'block' : 'none'}">${row(t('se.template'), `<input id="tpl" value="${esc(cs.custom || '')}" placeholder="https://example.com/search?q=%s" spellcheck="false"/>`, t('se.template.hint'))}</div>
      <div class="inline"><button class="btn-primary" id="sesave">${esc(t('common.save'))}</button><span id="seres"></span></div><div class="hint" style="margin-top:10px">${esc(t('se.chatHint'))}</div>`;
    const list = document.getElementById('elist');
    let sel = cs.engine;
    const all = [...Object.entries(engines).map(([k, v]) => [k, v.name]), ['custom', t('se.custom')]];
    const draw = () => {
      list.innerHTML = '';
      all.forEach(([k, name]) => {
        const r = document.createElement('div'); r.className = 'engine-row' + (sel === k ? ' selected' : ''); r.dataset.engine = k;
        r.innerHTML = `<div class="radio"></div><div>${esc(name)}</div>${k === 'bing' ? `<div class="tag">${esc(t('se.default'))}</div>` : ''}`;
        r.onclick = () => { sel = k; document.getElementById('customrow').style.display = k === 'custom' ? 'block' : 'none'; draw(); };
        list.appendChild(r);
      });
    };
    draw();
    document.getElementById('sesave').onclick = async () => {
      const tpl = document.getElementById('tpl').value.trim();
      if (sel === 'custom' && !tpl.includes('%s')) { notice(document.getElementById('seres'), 'bad', t('se.template.bad')); return; }
      await window.aib.invoke('settings:patch', { search: { engine: sel, custom: tpl } });
      notice(document.getElementById('seres'), 'ok', t('common.saved'));
    };
  }

  // ---------------- dictionary (extension settings page in a sandboxed iframe)
  async function renderDict() {
    await refresh();
    const exts = await window.aib.invoke('ext:list');
    const d = exts.find(e => e.id === 'aib.dictionary');
    const p = pane();
    p.innerHTML = `<h2>${esc(t('dict.settings.title'))}</h2><div class="sub">${esc(t('dict.settings.sub'))}</div>`;
    if (!d || !d.enabled) { p.innerHTML += `<div class="engine-note">${esc(t('dict.settings.disabled'))}</div>`; return; }
    const f = document.createElement('iframe'); f.className = 'settings-dict-frame'; f.dataset.ext = d.id; f.dataset.settings = '1';
    f.setAttribute('sandbox', 'allow-scripts'); f.src = d.settingsPage; p.appendChild(f);
    const lab = document.createElement('div'); lab.className = 'form-row'; lab.style.marginTop = '14px';
    lab.innerHTML = `<label class="inline" style="font-size:13px;color:var(--text-primary)"><input type="checkbox" id="sellook" ${S.selectionLookup ? 'checked' : ''}/>${esc(t('dict.selLookup'))}</label>`;
    p.appendChild(lab);
    document.getElementById('sellook').onchange = async (e) => { await window.aib.invoke('settings:patch', { selectionLookup: e.target.checked }); toast(); };
  }

  // ---------------- general
  async function renderGeneral() {
    await refresh();
    const p = pane();
    const info = await window.aib.invoke('app:info');
    p.innerHTML = `<h2>${esc(t('general.title'))}</h2><div class="sub"></div>
      <div class="form-row"><label>${esc(t('settings.language'))}</label><div class="inline">${seg([['zh', t('lang.zh')], ['en', t('lang.en')]], S.lang, 'lang')}<span class="hint">${esc(t('settings.language.hint'))}</span></div></div>
      <div class="form-row"><label>${esc(t('general.name'))}</label><input type="text" id="dname" maxlength="40" value="${esc(S.displayName || '')}"/><div class="hint">${esc(t('general.nameHint'))}</div></div>
      <div class="form-row"><label>${esc(t('general.greeting'))}</label><input type="text" id="greeting" maxlength="120" placeholder="${esc(t('general.greetingPh'))}" value="${esc(S.greeting || '')}"/><div class="hint">${esc(t('general.greetingHint'))}</div>
        <div class="inline" style="margin-top:8px"><button class="btn-secondary" id="greetsave">${esc(t('common.save'))}</button><button class="btn-ghost" id="greetreset">${esc(t('general.greetReset'))}</button><span id="greetnote"></span></div>
        <div class="hint" id="greetprev" style="margin-top:6px"></div></div>
      <div class="form-row"><label class="inline" style="font-size:13px;color:var(--text-primary)"><input type="checkbox" id="hidespark" ${S.hideSpark ? 'checked' : ''}/>${esc(t('general.hideSpark'))}</label></div>
      <div class="hint">AI浏览器 ${esc(info.version)} · Electron ${esc(info.electron)} · Chromium ${esc(info.chromium)} · ${esc(info.platform)}/${esc(info.arch)}</div>`;
    p.querySelectorAll('[data-lang]').forEach(b => b.onclick = async () => { await window.aib.invoke('settings:patch', { lang: b.dataset.lang }); toast(); });
    const $ = id => document.getElementById(id);
    const preview = () => {
      const tpl = ($('greeting').value.trim()) || t('home.greeting'); const name = $('dname').value.trim();
      document.getElementById('greetprev').textContent = t('general.preview') + (name ? tpl.split('{name}').join(name) : tpl.replace(/\{name\}[，,、:：\s]*/g, '').trim());
    };
    ['dname', 'greeting'].forEach(id => $(id).addEventListener('input', preview)); preview();
    const saveGreet = async () => { await window.aib.invoke('settings:patch', { displayName: $('dname').value.trim(), greeting: $('greeting').value.trim() }); notice(document.getElementById('greetnote'), 'ok', t('common.saved')); };
    $('greetsave').onclick = saveGreet;
    ['dname', 'greeting'].forEach(id => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') saveGreet(); }));
    $('greetreset').onclick = async () => { $('greeting').value = ''; $('dname').value = 'Felix'; preview(); await saveGreet(); };
    $('hidespark').onchange = async (e) => { await window.aib.invoke('settings:patch', { hideSpark: e.target.checked }); toast(); };
  }
  // ---------------- privacy
  async function renderPrivacy() {
    const p = pane();
    p.innerHTML = `<h2>${esc(t('privacy.title'))}</h2><div class="sub">${esc(t('privacy.sub'))}</div>
      ${['history', 'downloads', 'cache', 'cookies'].map(k => `<div class="form-row"><label class="inline" style="font-size:13px;color:var(--text-primary)"><input type="checkbox" data-clr="${k}" ${k !== 'cookies' ? 'checked' : ''}/>${esc(t('privacy.' + k))}</label></div>`).join('')}
      <div class="inline"><button class="btn-danger" id="clr">${esc(t('privacy.clear'))}</button><span id="clrres"></span></div>`;
    document.getElementById('clr').onclick = async () => {
      const o = {}; p.querySelectorAll('[data-clr]').forEach(c => o[c.dataset.clr] = c.checked);
      await window.aib.invoke('privacy:clear', o);
      notice(document.getElementById('clrres'), 'ok', t('privacy.done'));
    };
  }

  async function renderExt() {
    pane().classList.add('wide');
    const h = await window.mountExtensions(pane(), { openSettings: (sec) => { location.hash = sec; } });
    if (cur === 'ext') embed = h; else h.destroy();
  }
  function renderHistory() {
    pane().classList.add('wide');
    embed = window.mountHistory(pane());
  }
  function renderPane() { leaveEmbed(); ({ ai: renderAI, search: renderSearch, dict: renderDict, ext: renderExt, history: renderHistory, general: renderGeneral, privacy: renderPrivacy }[cur] || renderAI)(); }
  window.addEventListener('hashchange', () => { const n = fromHash(); if (n === cur) return; cur = n; shell(); renderPane(); });
  document.title = t('settings.title');
  shell(); renderPane();
  I18N.onChange(() => { document.title = t('settings.title'); shell(); renderPane(); });
  window.aib.on('settings:changed', (s) => { S = s; });
})();
