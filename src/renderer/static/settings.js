(async function () {
  let S = await I18N.init();
  const root = document.getElementById('root');
  const esc = MD.esc;
  const NAV = [['ai', 'settings.nav.ai'], ['search', 'settings.nav.search'], ['dict', 'settings.nav.dict'], ['ext', 'menu.extensions'], ['history', 'menu.history'], ['general', 'settings.nav.general'], ['privacy', 'settings.nav.privacy']];
  let cur = (location.hash || '#ai').slice(1);
  if (!NAV.some(n => n[0] === cur)) cur = 'ai';
  let aiTab = null; // 'api' | 'local'
  let presets = {}, engines = {}, models = [], lmStatus = null, progress = {};

  async function refresh() { S = await window.aib.invoke('settings:get'); }
  function shell() {
    root.innerHTML = `<div class="settings-page"><div class="settings-nav"><div class="nav-title">${esc(t('settings.title'))}</div><div id="nav"></div></div><div class="settings-pane"><div class="section" id="pane"></div></div></div>`;
    const nav = document.getElementById('nav');
    NAV.forEach(([id, key]) => {
      const d = document.createElement('div'); d.className = 'nav-item' + (id === cur ? ' active' : ''); d.dataset.nav = id; d.textContent = t(key);
      d.onclick = () => {
        if (id === 'ext') return window.aib.invoke('nav:open', 'extensions');
        if (id === 'history') return window.aib.invoke('nav:open', 'history');
        cur = id; location.hash = id; shell(); renderPane();
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
    document.getElementById('aibody').innerHTML =
      row(t('ai.api.preset'), `<select id="preset">${Object.entries(presets).map(([k, v]) => `<option value="${k}" ${a.preset === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>`) +
      row(t('ai.api.format'), `<select id="format"><option value="openai" ${a.format !== 'anthropic' ? 'selected' : ''}>OpenAI (/chat/completions)</option><option value="anthropic" ${a.format === 'anthropic' ? 'selected' : ''}>Anthropic (/v1/messages)</option></select>`) +
      row('Base URL', `<input id="baseUrl" value="${esc(a.baseUrl)}" spellcheck="false"/>`) +
      row('API Key', `<input id="apiKey" type="password" autocomplete="off" placeholder="${a.hasKey ? esc(t('ai.api.keySaved')) : 'sk-…'}"/>`, t('ai.api.keyHint')) +
      row(t('ai.api.model'), `<input id="model" value="${esc(a.model)}" spellcheck="false"/>`) +
      row(t('ai.api.temp'), `<input id="temp" type="number" min="0" max="2" step="0.1" value="${a.temperature}"/>`) +
      `<div class="inline"><button class="btn-primary" id="save">${esc(t('common.save'))}</button><button class="btn-secondary" id="test">${esc(t('ai.api.test'))}</button><span class="test-result" id="tres"></span></div>`;
    const $ = id => document.getElementById(id);
    $('preset').onchange = () => { const pr = presets[$('preset').value]; if (pr && $('preset').value !== 'custom') { $('baseUrl').value = pr.baseUrl; $('model').value = pr.model; $('format').value = pr.format; } };
    const gather = () => ({ preset: $('preset').value, format: $('format').value, baseUrl: $('baseUrl').value.trim(), apiKey: $('apiKey').value, model: $('model').value.trim(), temperature: parseFloat($('temp').value) || 0 });
    $('save').onclick = async () => { await window.aib.invoke('settings:patch', { ai: { source: 'api', api: gather() } }); $('apiKey').value = ''; $('tres').className = 'test-result ok'; $('tres').textContent = t('common.saved'); await refresh(); $('activeSrc').textContent = t('ai.src.api'); };
    $('test').onclick = async () => {
      $('tres').className = 'test-result'; $('tres').textContent = t('ai.api.testing');
      const r = await window.aib.invoke('ai:test', gather());
      $('tres').className = 'test-result ' + (r.ok ? 'ok' : 'bad');
      $('tres').textContent = r.ok ? `${t('ai.api.testOk')} · ${r.ms} ms` : `${t('ai.api.testFail')}: ${r.error}`;
    };
  }
  async function renderLocal() {
    models = await window.aib.invoke('lm:list');
    const L = S.ai.local;
    const body = document.getElementById('aibody');
    body.innerHTML = `<div class="engine-note">${esc(t('ai.local.note'))}</div><div class="model-list" id="mlist"></div>
      <div class="inline" style="margin-bottom:12px"><button class="btn-secondary" id="pickgguf">${esc(t('ai.local.pick'))}</button><label class="inline" style="font-size:12px;color:var(--text-secondary)"><input type="checkbox" id="mirror" ${L.hfMirror ? 'checked' : ''}/>${esc(t('ai.local.mirror'))}</label></div>
      <div class="engine-note" id="lmpath"></div><div class="engine-note" id="lmstat"></div>
      <div class="inline"><button class="btn-primary" id="uselocal">${esc(t('ai.local.use'))}</button></div><div class="hint" style="margin-top:10px">${esc(t('ai.local.hint'))}</div>`;
    const list = document.getElementById('mlist');
    list.innerHTML = '';
    for (const m of models) {
      const selected = L.modelPath && L.modelPath === m.path;
      const r = document.createElement('div'); r.className = 'model-row' + (selected ? ' selected' : ''); r.dataset.model = m.id;
      const pr = progress[m.id];
      const dl = pr && !pr.done && !pr.error ? Math.round(pr.got / (pr.total || 1) * 100) : null;
      r.innerHTML = `<div class="radio"></div><div class="m-info"><div class="m-name">${esc(m.name)}</div><div class="m-sub">${esc(m.note)} · llama.cpp (GGUF)${dl != null ? `<div class="progress"><i style="width:${dl}%"></i></div>` : ''}${pr && pr.error ? `<div style="color:var(--danger)">${esc(pr.error)}</div>` : ''}</div>
        <div class="m-size">${esc(m.size)}</div>
        ${m.downloaded ? `<div class="m-state">${selected ? esc(t('ai.local.inuse')) : ''}</div><button class="btn-dl" data-act="del">${esc(t('common.delete'))}</button>` : (dl != null ? `<button class="btn-dl" data-act="cancel">${dl}% ✕</button>` : `<button class="btn-dl" data-act="dl">${esc(m.partial ? t('ai.local.resume') : t('ai.local.download'))}</button>`)}`;
      r.onclick = async (e) => {
        const act = e.target.dataset.act;
        if (act === 'dl') { progress[m.id] = { got: m.partial, total: m.bytes }; await window.aib.invoke('settings:patch', { ai: { local: { hfMirror: document.getElementById('mirror').checked } } }); window.aib.invoke('lm:download', m.id); renderLocal(); return; }
        if (act === 'cancel') { window.aib.invoke('lm:cancel', m.id); return; }
        if (act === 'del') { await window.aib.invoke('lm:delete', m.id); renderLocal(); return; }
        if (m.downloaded) { await window.aib.invoke('settings:patch', { ai: { local: { modelPath: m.path, modelId: m.id } } }); await refresh(); renderLocal(); }
      };
      list.appendChild(r);
    }
    const mp = S.ai.local.modelPath;
    document.getElementById('lmpath').textContent = mp ? `${t('ai.local.current')}: ${mp}` : t('ai.local.none');
    document.getElementById('pickgguf').onclick = async () => { await window.aib.invoke('lm:pick'); await refresh(); renderLocal(); };
    document.getElementById('mirror').onchange = (e) => window.aib.invoke('settings:patch', { ai: { local: { hfMirror: e.target.checked } } });
    document.getElementById('uselocal').onclick = async () => { await window.aib.invoke('settings:patch', { ai: { source: 'local' } }); await refresh(); document.getElementById('activeSrc').textContent = t('ai.src.local'); };
    window.aib.invoke('lm:status').then(s => { const e = document.getElementById('lmstat'); if (!e) return; e.textContent = s.engine === 'ok' ? `${t('ai.local.engineOk')}${s.gpu ? ' · ' + s.gpu : ''}` : `${t('ai.local.engineErr')}: ${s.engineError || ''}`; });
  }
  window.aib.on('lm:progress', (p) => { progress[p.id] = { ...(progress[p.id] || {}), ...p }; if (cur === 'ai' && aiTab === 'local') renderLocal(); });

  // ---------------- search engine
  async function renderSearch() {
    await refresh();
    engines = await window.aib.invoke('engines:list');
    const cs = S.search;
    const p = pane();
    p.innerHTML = `<h2>${esc(t('se.title'))}</h2><div class="sub">${esc(t('se.sub'))}</div><div class="model-list" id="elist"></div>
      <div id="customrow" style="display:${cs.engine === 'custom' ? 'block' : 'none'}">${row(t('se.template'), `<input id="tpl" value="${esc(cs.custom || '')}" placeholder="https://example.com/search?q=%s" spellcheck="false"/>`, t('se.template.hint'))}</div>
      <div class="inline"><button class="btn-primary" id="sesave">${esc(t('common.save'))}</button><span class="test-result ok" id="seres"></span></div><div class="hint" style="margin-top:10px">${esc(t('se.chatHint'))}</div>`;
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
      if (sel === 'custom' && !tpl.includes('%s')) { const r = document.getElementById('seres'); r.className = 'test-result bad'; r.textContent = t('se.template.bad'); return; }
      await window.aib.invoke('settings:patch', { search: { engine: sel, custom: tpl } });
      const r = document.getElementById('seres'); r.className = 'test-result ok'; r.textContent = t('common.saved');
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
    document.getElementById('sellook').onchange = (e) => window.aib.invoke('settings:patch', { selectionLookup: e.target.checked });
  }

  // ---------------- general
  async function renderGeneral() {
    await refresh();
    const p = pane();
    const info = await window.aib.invoke('app:info');
    p.innerHTML = `<h2>${esc(t('general.title'))}</h2><div class="sub"></div>
      <div class="form-row"><label>${esc(t('settings.language'))}</label><div class="inline">${seg([['zh', t('lang.zh')], ['en', t('lang.en')]], S.lang, 'lang')}<span class="hint">${esc(t('settings.language.hint'))}</span></div></div>
      <div class="hint">AI浏览器 ${esc(info.version)} · Electron ${esc(info.electron)} · Chromium ${esc(info.chromium)} · ${esc(info.platform)}/${esc(info.arch)}</div>`;
    p.querySelectorAll('[data-lang]').forEach(b => b.onclick = async () => { await window.aib.invoke('settings:patch', { lang: b.dataset.lang }); });
  }
  // ---------------- privacy
  async function renderPrivacy() {
    const p = pane();
    p.innerHTML = `<h2>${esc(t('privacy.title'))}</h2><div class="sub">${esc(t('privacy.sub'))}</div>
      ${['history', 'downloads', 'cache', 'cookies'].map(k => `<div class="form-row"><label class="inline" style="font-size:13px;color:var(--text-primary)"><input type="checkbox" data-clr="${k}" ${k !== 'cookies' ? 'checked' : ''}/>${esc(t('privacy.' + k))}</label></div>`).join('')}
      <div class="inline"><button class="btn-danger" id="clr">${esc(t('privacy.clear'))}</button><span class="test-result ok" id="clrres"></span></div>`;
    document.getElementById('clr').onclick = async () => {
      const o = {}; p.querySelectorAll('[data-clr]').forEach(c => o[c.dataset.clr] = c.checked);
      await window.aib.invoke('privacy:clear', o);
      document.getElementById('clrres').textContent = t('privacy.done');
    };
  }

  function renderPane() { ({ ai: renderAI, search: renderSearch, dict: renderDict, general: renderGeneral, privacy: renderPrivacy }[cur] || renderAI)(); }
  document.title = t('settings.title');
  shell(); renderPane();
  I18N.onChange(() => { document.title = t('settings.title'); shell(); renderPane(); });
  window.aib.on('settings:changed', (s) => { S = s; });
})();
