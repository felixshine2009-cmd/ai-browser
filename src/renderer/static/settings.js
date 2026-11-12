(async function () {
  let S = await I18N.init();
  const root = document.getElementById('root');
  const esc = MD.esc;
  const NAV = [['ai', 'settings.nav.ai'], ['search', 'settings.nav.search'], ['dict', 'settings.nav.dict'], ['kb', 'settings.nav.kb'], ['python', 'settings.nav.python'], ['ext', 'menu.extensions'], ['history', 'menu.history'], ['passwords', 'settings.nav.passwords'], ['general', 'settings.nav.general'], ['privacy', 'settings.nav.privacy']];
  // section <-> URL hash (aibrowser://settings#extensions). 'ext' is the internal id, 'extensions' the public hash.
  const hashOf = id => (id === 'ext' ? 'extensions' : id);
  const fromHash = () => { let h = (location.hash || '#ai').slice(1); if (h === 'extensions') h = 'ext'; return NAV.some(n => n[0] === h) ? h : 'ai'; };
  let cur = fromHash();
  let embed = null; // destroy handle of an embedded page (extensions / history)
  function leaveEmbed() { if (embed) { try { embed.destroy(); } catch {} embed = null; } }
  let aiTab = null; // 'api' | 'local'
  let apiPid = null; // provider shown in the API tab (models list)
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
      <div class="src-row">${seg([['api', t('ai.src.api')], ['local', t('ai.src.local')], ['fw', T('本地框架', 'Local frameworks')]], aiTab, 'src')}<span class="hint">${esc(t('ai.active'))}: <b id="activeSrc">${esc(S.ai.source === 'api' ? t('ai.src.api') : t('ai.src.local'))}</b></span></div><div id="aibody"></div>
      <div class="ai-extra"><h3 class="sec-h">${esc(T('翻译与 Agent', 'Translation & agent'))}</h3>
        <div class="form-row"><label>${esc(T('翻译引擎', 'Translation engine'))}</label><select id="treng"><option value="hunyuan" ${(S.translate || {}).engine !== 'chat' ? 'selected' : ''}>${esc(T('混元翻译 HY-MT1.5（内置，仅翻译时加载）', 'Hunyuan HY-MT1.5 (bundled, loaded only while translating)'))}</option><option value="chat" ${(S.translate || {}).engine === 'chat' ? 'selected' : ''}>${esc(T('使用聊天模型', 'Use the chat model'))}</option></select></div>
        <div class="form-row"><label>${esc(T('Agent 最大步数', 'Agent step limit'))}</label><input type="number" id="agsteps" min="1" max="40" value="${esc((S.agent || {}).maxSteps || 12)}" style="width:100px"/></div></div>`;
    p.querySelectorAll('[data-src]').forEach(b => b.onclick = () => { aiTab = b.dataset.src; renderAI(); });
    document.getElementById('treng').onchange = async (e) => { await window.aib.invoke('settings:patch', { translate: { engine: e.target.value } }); toast(); };
    document.getElementById('agsteps').onchange = async (e) => { const v = Math.max(1, Math.min(40, Number(e.target.value) || 12)); e.target.value = v; await window.aib.invoke('settings:patch', { agent: { maxSteps: v } }); toast(); };
    if (aiTab === 'api') renderApi(); else if (aiTab === 'fw') renderFw(); else renderLocal();
  }
  function renderApi() {
    const a = S.ai.api;
    const provs = S.ai.providers || {};
    const pidNow = apiPid && (presets[apiPid] || apiPid === 'local') ? apiPid : (a.preset || 'custom');
    apiPid = pidNow;
    const saved = provs[pidNow] || null;
    const isActive = pidNow === (a.preset || 'custom');
    const pv = presets[pidNow] || presets.custom || {};
    const f = isActive ? a : { baseUrl: (saved && saved.baseUrl) || pv.baseUrl || '', format: (saved && saved.format) || pv.format || 'openai', model: ((saved && (saved.models || []).find(m => m.enabled)) || {}).id || pv.model || '', temperature: a.temperature, hasKey: !!(saved && saved.hasKey) };
    const modelField = `<div class="combo" id="combo"><input id="model" value="${esc(f.model)}" spellcheck="false" autocomplete="off" placeholder="${esc(t('ai.api.modelPh'))}"/><button type="button" class="combo-btn" id="modelbtn" title="${esc(t('ai.api.models'))}" tabindex="-1">▾</button><div class="combo-pop" id="modelpop" hidden></div></div><div class="hint" id="modelhint">${esc(t('ai.api.modelHint'))}</div>`;
    const configured = Object.keys(provs).filter(k => presets[k] && (provs[k].hasKey || k === (a.preset || 'custom')));
    const chips = configured.length ? `<div class="prov-chips" id="provchips" role="list" aria-label="${esc(T('已配置的服务商', 'Configured providers'))}"><span class="prov-chips-l">${esc(T('已配置', 'Configured'))}</span>${configured.map(k => { const ms = provs[k].models || []; return `<button type="button" role="listitem" class="prov-chip${k === pidNow ? ' on' : ''}" data-prov="${esc(k)}">${k === (a.preset || 'custom') && S.ai.source === 'api' ? '<i class="dot" aria-hidden="true"></i>' : ''}${esc(presets[k].name)}<small>${ms.filter(m => m.enabled).length}/${ms.length}</small></button>`; }).join('')}<button type="button" class="prov-chip" data-prov="local">${esc(T('本地模型', 'Local models'))}</button></div>` : '';
    const opts = Object.entries(presets).map(([k, v]) => `<option value="${k}" ${pidNow === k ? 'selected' : ''}>${esc(v.name)}</option>`).join('') + `<optgroup label="${esc(T('本地', 'Local'))}"><option value="local" ${pidNow === 'local' ? 'selected' : ''}>${esc(T('本地模型（已下载 / 本地框架）', 'Local models (downloaded / frameworks)'))}</option></optgroup>`;
    document.getElementById('aibody').innerHTML = chips +
      row(t('ai.api.preset'), `<select id="preset">${opts}</select>`) +
      `<div id="apiform"${pidNow === 'local' ? ' hidden' : ''}>` +
      row(t('ai.api.format'), `<select id="format"><option value="openai" ${f.format !== 'anthropic' ? 'selected' : ''}>OpenAI (/chat/completions)</option><option value="anthropic" ${f.format === 'anthropic' ? 'selected' : ''}>Anthropic (/v1/messages)</option></select>`) +
      row('Base URL', `<input id="baseUrl" value="${esc(f.baseUrl)}" spellcheck="false"/>`) +
      row('API Key', `<input id="apiKey" type="password" autocomplete="off" placeholder="${(isActive ? a.hasKey : f.hasKey) ? esc(t('ai.api.keySaved')) : 'sk-…'}"/>`, t('ai.api.keyHint')) +
      `<div class="form-row"><label>${esc(t('ai.api.model'))}</label>${modelField}</div>` +
      row(t('ai.api.temp'), `<input id="temp" type="number" min="0" max="2" step="0.1" value="${a.temperature}"/>`) +
      `<div class="inline"><button class="btn-primary" id="save">${esc(t('common.save'))}</button><button class="btn-secondary" id="test">${esc(t('ai.api.test'))}</button></div><div class="test-result" id="tres"></div></div>` +
      `<section class="prov-models" id="provmodels" aria-label="${esc(T('模型列表', 'Model list'))}"></section>`;
    const $ = id => document.getElementById(id);
    let modelList = (saved && (saved.models || []).map(m => m.id)) || [];
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
      if ($('preset').value === (S.ai.api.preset || 'custom')) { await window.aib.invoke('settings:patch', { ai: { api: { model: it.dataset.m } } }); toast(); } // choosing from the list persists immediately
      $('modelhint').textContent = t('ai.api.modelSaved', { m: it.dataset.m });
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#combo')) closePop(); });
    $('aibody').querySelectorAll('[data-prov]').forEach(b => b.onclick = () => { apiPid = b.dataset.prov; renderApi(); });
    $('preset').onchange = () => {
      const v = $('preset').value;
      if (v === 'local') { apiPid = 'local'; renderApi(); return; }
      const pr = presets[v]; const sp = (S.ai.providers || {})[v];
      apiPid = v;
      if (pr && v !== 'custom') {
        $('baseUrl').value = (sp && sp.baseUrl) || pr.baseUrl; $('format').value = (sp && sp.format) || pr.format;
        const en = sp && (sp.models || []).find(m => m.enabled);
        $('model').value = v === (S.ai.api.preset || 'custom') ? S.ai.api.model : ((en && en.id) || pr.model);
        modelList = sp && sp.models && sp.models.length ? sp.models.map(m => m.id) : (pr.models || []);
      } else if (sp) { $('baseUrl').value = sp.baseUrl || ''; $('format').value = sp.format || 'openai'; modelList = (sp.models || []).map(m => m.id); }
      $('apiKey').placeholder = sp && sp.hasKey ? t('ai.api.keySaved') : 'sk-…';
      renderProvModels(v, { auto: true });
    };
    const gather = () => ({ preset: $('preset').value, format: $('format').value, baseUrl: $('baseUrl').value.trim(), apiKey: $('apiKey').value, model: $('model').value.trim(), temperature: parseFloat($('temp').value) || 0 });
    $('save').onclick = async () => {
      const g = gather(); const pid = g.preset || 'custom';
      const prevP = (S.ai.providers || {})[pid] || {};
      const keyChanged = !!g.apiKey; const baseChanged = (prevP.baseUrl || '') !== g.baseUrl;
      await window.aib.invoke('settings:patch', { ai: { source: 'api', api: g } }); $('apiKey').value = ''; notice($('tres'), 'ok', t('common.saved')); await refresh(); $('activeSrc').textContent = t('ai.src.api');
      // provider saved / key changed: fetch its model list automatically
      if (keyChanged || baseChanged || !prevP.fetchedAt) renderProvModels(pid, { fetch: true }); else renderProvModels(pid);
    };
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
      await refresh(); renderProvModels(gather().preset || 'custom');
    };
    renderProvModels(pidNow, { auto: true });
  }

  // ---- per-provider model list: auto fetch (official list endpoint) / built-in fallback, enable checkboxes, search, manual IDs
  let provFilter = '';
  const ago = (ts) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return T('刚刚', 'just now');
    if (s < 3600) return T(`${Math.round(s / 60)} 分钟前`, `${Math.round(s / 60)} min ago`);
    if (s < 86400) return T(`${Math.round(s / 3600)} 小时前`, `${Math.round(s / 3600)} h ago`);
    return new Date(ts).toLocaleString(I18N.lang === 'en' ? 'en-US' : 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const fmtCtx = (v) => (window.AIBModelPicker ? AIBModelPicker.fmtCtx(v) : String(v || ''));
  async function renderProvModels(pid, o) {
    o = o || {};
    const box = document.getElementById('provmodels'); if (!box) return;
    const isLocal = pid === 'local';
    const name = isLocal ? T('本地模型', 'Local models') : ((presets[pid] || {}).name || pid);
    let list, p = {}, hints = {};
    if (isLocal) {
      list = await window.aib.invoke('models:local', !!o.fetch).catch(() => []);
    } else {
      p = (S.ai.providers || {})[pid] || {};
      const stale = !p.fetchedAt || (Date.now() - p.fetchedAt > 24 * 3600e3);
      const canFetch = p.hasKey || ['ollama', 'openrouter', 'custom'].includes(pid) || (pid === (S.ai.api.preset || 'custom') && S.ai.api.hasKey);
      if (o.fetch || (o.auto && !o._fetched && ((stale && canFetch) || !(p.models || []).length))) {
        box.innerHTML = `<div class="pm-head"><h3>${esc(T('模型列表', 'Models'))} · ${esc(name)}</h3></div><div class="pm-status">${esc(T('正在从服务商获取模型列表…', 'Fetching the model list from the provider…'))}</div>`;
        let r; try { r = await window.aib.invoke('models:refresh', pid); } catch (e) { r = { ok: false, error: e.message }; }
        await refresh();
        if (apiPid !== pid) return;
        return renderProvModels(pid, { _fetched: true, result: r });
      }
      list = p.models || [];
      hints = await window.aib.invoke('models:hints', pid).catch(() => ({})) || {};
    }
    const total = list.length, on = list.filter(m => m.enabled).length;
    let status = '';
    if (isLocal) status = T('已下载的内置模型与正在运行的本地框架中的模型。', 'Downloaded built-in models and models from running local frameworks.');
    else if (p.listSource === 'api') status = T(`已从服务商接口获取 · ${ago(p.fetchedAt)}`, `Fetched from the provider · ${ago(p.fetchedAt)}`) + (p.filtered ? T(` · 已隐藏 ${p.filtered} 个非对话模型`, ` · ${p.filtered} non-chat models hidden`) : '') + (p.listError ? T(`。最近一次更新未成功：${p.listError}`, `. The last refresh failed: ${p.listError}`) : '');
    else if (p.listSource === 'builtin') status = T('内置推荐列表', 'Built-in list') + (p.listError ? T(`（${p.listError}）`, ` (${p.listError})`) : '') + T('。您仍可手动添加模型 ID。', '. You can still add model IDs manually.');
    else status = T('尚未获取模型列表。保存 API Key 后将自动获取，也可点击“自动获取模型”。', 'The model list has not been fetched yet. It is fetched after you save an API key, or click “Fetch models”.');
    const f = provFilter.trim().toLowerCase();
    const shown = list.filter(m => !f || (m.id + ' ' + (m.name || '')).toLowerCase().includes(f));
    const chip = (txt, cls, title) => `<span class="pm-chip${cls ? ' ' + cls : ''}"${title ? ` title="${esc(title)}"` : ''}>${esc(txt)}</span>`;
    const rows = shown.map(m => {
      const tk = hints[m.id] || [];
      const chips = [
        m.vision ? chip(T('视觉', 'Vision')) : '',
        m.reasoning ? chip(T('思考', 'Thinking')) : '',
        m.ctx ? chip(fmtCtx(m.ctx), '', T('上下文长度', 'Context length')) : '',
        tk.length ? chip(T('思考参数', 'Thinking params'), 'pm-think', tk.join(', ')) : '',
        m.manual ? chip(T('手动添加', 'Manual'), 'pm-manual') : '',
        m.builtin ? chip(T('内置', 'Built-in'), 'pm-manual') : '',
        m.stale ? chip(T('服务商列表中已不存在', 'No longer listed'), 'pm-warn') : ''
      ].join('');
      const rm = (m.manual || m.stale) && !isLocal ? `<button type="button" class="pm-rm" data-rm="${esc(m.id)}" title="${esc(T('移除', 'Remove'))}" aria-label="${esc(T('移除', 'Remove'))} ${esc(m.id)}">×</button>` : '';
      return `<label class="pm-row"><input type="checkbox" data-mid="${esc(m.id)}" ${m.enabled ? 'checked' : ''}/><span class="pm-id">${esc(m.name || m.id)}${m.name && m.name !== m.id ? `<small>${esc(m.id)}</small>` : ''}</span><span class="pm-chips">${chips}</span>${rm}</label>`;
    }).join('');
    box.innerHTML = `<div class="pm-head"><h3>${esc(T('模型列表', 'Models'))} · ${esc(name)}</h3><button type="button" class="btn-secondary" id="pmfetch">${esc(isLocal ? T('重新检测', 'Detect again') : T('自动获取模型', 'Fetch models'))}</button></div>
      <div class="pm-status${p.listError && p.listSource !== 'api' ? ' warn' : ''}" id="pmstatus">${esc(status)}${!isLocal && p.listUrl ? ` <code>${esc(p.listUrl)}</code>` : ''}</div>
      <div class="pm-tools"><input id="pmq" type="search" placeholder="${esc(T('搜索模型', 'Search models'))}" value="${esc(provFilter)}" autocomplete="off" spellcheck="false"/><button type="button" class="btn-secondary" id="pmall">${esc(T('全选', 'Select all'))}</button><button type="button" class="btn-secondary" id="pmnone">${esc(T('全不选', 'Select none'))}</button><span class="pm-count" id="pmcount">${esc(T(`已启用 ${on} / 共 ${total}`, `${on} of ${total} enabled`))}</span></div>
      <div class="pm-list" id="pmlist">${rows || `<div class="pm-empty">${esc(total ? T('未找到匹配的模型', 'No matching models') : (isLocal ? T('暂无可用的本地模型。', 'No local models available.') : T('暂无模型。', 'No models yet.')))}</div>`}</div>
      ${isLocal ? '' : `<div class="pm-add"><input id="pmadd" placeholder="${esc(T('手动添加模型 ID，例如 gpt-4o-mini', 'Add a model ID manually, e.g. gpt-4o-mini'))}" autocomplete="off" spellcheck="false"/><button type="button" class="btn-secondary" id="pmaddbtn">${esc(T('添加', 'Add'))}</button></div>`}
      <div class="hint">${esc(T('仅勾选的模型会出现在首页与对话页的模型切换器中。', 'Only checked models appear in the model switcher on the home and chat pages.'))}</div>`;
    const $ = id => document.getElementById(id);
    $('pmfetch').onclick = () => renderProvModels(pid, { fetch: true });
    $('pmq').oninput = (e) => { provFilter = e.target.value; const pos = e.target.selectionStart; renderProvModels(pid).then(() => { const q = $('pmq'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch {} } }); };
    const setEn = async (ids, v) => { if (!ids.length) return; await window.aib.invoke('models:setEnabled', pid, ids, v); await refresh(); toast(); renderProvModels(pid); };
    $('pmall').onclick = () => setEn(shown.filter(m => !m.enabled).map(m => m.id), true);
    $('pmnone').onclick = () => setEn(shown.filter(m => m.enabled).map(m => m.id), false);
    box.querySelectorAll('[data-mid]').forEach(cb => cb.onchange = () => setEn([cb.dataset.mid], cb.checked));
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = async (e) => { e.preventDefault(); await window.aib.invoke('models:remove', pid, b.dataset.rm); await refresh(); toast(); renderProvModels(pid); });
    const add = async () => { const v = $('pmadd').value.trim(); if (!v) return; await window.aib.invoke('models:add', pid, v); await refresh(); toast(); renderProvModels(pid); };
    if ($('pmaddbtn')) { $('pmaddbtn').onclick = add; $('pmadd').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }; }
    if (o.result && !o.result.ok && o.result.error) notice($('pmstatus'), 'bad', T('获取失败：', 'Fetch failed: ') + o.result.error + (o.result.keptCache ? T('。已保留上次获取的列表。', '. The previous list is kept.') : T('。已改用内置推荐列表。', '. Showing the built-in list.')), { sticky: true });
  }
  // Local models. Selecting a model (radio / whole card) is independent from downloading it:
  //  - the selection is stored immediately (settings.ai.local.modelId + modelPath = expected file location);
  //  - a not-yet-downloaded model is shown as "已选择"; 「使用本地模型」 on it starts the download automatically.
  // ================= local models: engine, hub, family-grouped list, HF search, roles, frameworks
  const T = (zh, en) => (I18N.lang === 'en' ? en : zh);
  const errMsg = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const fmtB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b ? Math.max(1, Math.round(b / 1e6)) + ' MB' : '');
  const openFam = new Set();
  let fwCache = [], mlxSt = null, hf = { q: '', kind: 'gguf', items: [], files: {}, busy: false, msg: null };
  const patchLocal = (p) => window.aib.invoke('settings:patch', { ai: { local: p } });
  const rolesOf = () => (S.ai.local.roles || {});
  const showMlx = () => !mlxSt || mlxSt.platformOk !== false;
  const roleKey = (m) => (m.engine === 'mlx' ? 'mlx:' : 'llama:') + m.id;
  const selId = () => { const L = S.ai.local; if (L.modelId) return L.modelId; const m = models.find(x => x.path === L.modelPath); return m ? m.id : ''; };
  const roleOfModel = (m) => (m.tags || []).includes('embedding') ? 'embedding' : (m.tags || []).includes('translate') ? 'translate' : 'chat';
  const isSelected = (m) => { const R = rolesOf(); const r = roleOfModel(m); if (r !== 'chat') return R[r] === roleKey(m); return R.chat ? R.chat === roleKey(m) : selId() === m.id; };

  // collapsible family group (header = family, size range, count, badges; body animates with grid-template-rows)
  function famGroup(fam, items, { sel, dl, range, render, key, busy }) {
    const k = key || fam; const open = openFam.has(k) || !!sel || !!busy;
    if (sel || busy) openFam.add(k);
    const g = document.createElement('div'); g.className = 'fam-group' + (open ? ' open' : ''); g.dataset.family = fam;
    g.innerHTML = `<div class="fam-head" role="button" tabindex="0" aria-expanded="${open}"><svg class="chev" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="fam-name">${esc(fam)}</span><span class="fam-meta">${esc([range, items.length + T(' 个', ' models')].filter(Boolean).join(' · '))}</span><span class="fam-badges">${sel ? `<span class="fbadge sel">${esc(T('已选中', 'Selected'))}</span>` : ''}${dl ? `<span class="fbadge dl">${esc(T('已下载 ', 'Downloaded ') + dl)}</span>` : ''}</span></div>
      <div class="fam-body"><div class="fam-inner"></div></div>`;
    const inner = g.querySelector('.fam-inner'); items.forEach(it => inner.appendChild(render(it)));
    const head = g.querySelector('.fam-head');
    const toggle = () => { const o = g.classList.toggle('open'); head.setAttribute('aria-expanded', o); if (o) openFam.add(k); else openFam.delete(k); };
    head.onclick = toggle; head.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
    return g;
  }
  const groupBy = (arr, f) => { const m = new Map(); arr.forEach(x => { const k = f(x) || T('其他', 'Other'); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };

  async function selectModel(m) {
    const r = roleOfModel(m); const key = roleKey(m);
    const patch = { roles: { ...rolesOf(), [r]: key } };
    if (r === 'chat') { patch.modelPath = m.engine === 'mlx' ? (S.ai.local.modelPath || '') : m.path; patch.modelId = m.id; }
    await patchLocal(patch); await refresh(); renderLocal(); toast();
  }
  const fmtSpeed = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB/s' : b >= 1e3 ? Math.round(b / 1e3) + ' KB/s' : Math.round(b) + ' B/s');
  const fmtEta = (sec) => (sec >= 3600 ? Math.floor(sec / 3600) + 'h' + Math.floor(sec % 3600 / 60) + 'm' : sec >= 60 ? Math.floor(sec / 60) + 'm' + (sec % 60) + 's' : sec + 's');
  let diskMap = {}, diskInfo = null;
  // one line of download status: bytes done/total · speed · ETA, or paused / network-lost-will-retry / verifying / verify-failed
  function dlStatus(m, pr) {
    if (!pr) return m.partial && !m.downloaded ? T('已暂停', 'Paused') + ' · ' + fmtB(m.partial) + ' / ' + fmtB(m.bytes) : '';
    const bytes = fmtB(pr.got || 0) + ' / ' + fmtB(pr.total || m.bytes);
    if (pr.paused || pr.state === 'paused') return T('已暂停', 'Paused') + ' · ' + bytes;
    if (pr.state === 'retrying') return T('网络中断，将自动重试', 'Network lost, will retry automatically') + ` (${pr.retry}/${pr.max}${pr.waitMs ? ', ' + Math.ceil(pr.waitMs / 1000) + 's' : ''}) · ` + bytes;
    if (pr.state === 'verifying') return T('校验中…', 'Verifying…') + ' · ' + bytes;
    if (pr.state === 'verify-failed') return T('校验失败（', 'Verification failed (') + (pr.reason || '') + T('），已删除并重新下载', '), deleted and re-downloading');
    if (pr.state === 'restart') return T('服务器不支持断点续传 / 范围无效，重新开始', 'Server cannot resume — restarting this file');
    if (pr.error || pr.cancelled || pr.done) return '';
    return bytes + (pr.speed ? ' · ' + fmtSpeed(pr.speed) : '') + (pr.eta ? ' · ' + T('剩余 ', 'ETA ') + fmtEta(pr.eta) : '');
  }
  function startDownload(m) {
    progress[m.id] = { got: m.partial || 0, total: m.bytes };
    window.aib.invoke('lm:download', m.id); renderLocal();
  }
  function modelRow(m) {
    const selected = isSelected(m);
    const r = document.createElement('div'); r.className = 'model-row' + (selected ? ' selected' : ''); r.dataset.model = m.id;
    r.setAttribute('role', 'radio'); r.setAttribute('aria-checked', selected ? 'true' : 'false');
    const pr = progress[m.id]; const dl = pr && !pr.done && !pr.error && !pr.cancelled && !pr.paused && pr.state !== 'paused' ? Math.round(pr.got / (pr.total || 1) * 100) : null;
    const isPaused = !!(pr && (pr.paused || pr.state === 'paused')) || (!pr && m.partial > 0 && !m.downloaded);
    const dk = diskMap[m.id];
    const rr = roleOfModel(m);
    const state = selected ? (rr === 'translate' ? T('翻译模型', 'Translation') : rr === 'embedding' ? T('嵌入模型', 'Embedding') : (m.downloaded ? t('ai.local.inuse') : t('ai.local.picked'))) : '';
    const tags = (m.tags || []).map(tg => `<span class="mtag ${esc(tg)}">${esc(tg === 'translate' ? t('ai.local.tag.translate') : tg === 'light' ? t('ai.local.tag.light') : tg === 'embedding' ? T('嵌入', 'embedding') : t('ai.local.tag.general'))}</span>`).join('');
    const eng = m.engine === 'mlx' ? 'MLX' : 'llama.cpp';
    const noMlx = m.engine === 'mlx' && mlxSt && !mlxSt.available ? `<span class="m-warn">${esc(T('需要 Apple 芯片 + mlx-lm', 'needs Apple Silicon + mlx-lm'))}</span>` : '';
    const custom = String(m.id).startsWith('hf:');
    r.innerHTML = `<div class="radio"></div><div class="m-info"><div class="m-name">${esc(m.name)} ${tags}</div><div class="m-sub">${esc(m.note || '')}${m.note ? ' · ' : ''}RAM ${esc(m.ram || '?')} · ${eng} ${noMlx}${dl != null || isPaused ? `<div class="progress"><i style="width:${dl != null ? dl : Math.round(((pr && pr.got) || m.partial || 0) / (m.bytes || 1) * 100)}%"></i></div>` : ''}<div class="dlstat" data-dlstat="${esc(m.id)}">${esc(dlStatus(m, pr))}</div>${dk && (dk.files || dk.cache) ? `<div class="m-disk">${esc(T('模型文件 ', 'Model files ') + fmtB(dk.files) + ' · ' + T('缓存 ', 'Cache ') + fmtB(dk.cache))}</div>` : ''}${pr && pr.error ? `<div class="m-err">${esc(pr.error)}</div>` : ''}</div></div>
      <div class="m-size">${esc(m.size || '')}</div><div class="m-state">${esc(state)}</div>
      ${m.downloaded ? `${dk && dk.cache ? `<button class="btn-dl" data-act="cc">${esc(T('清理缓存', 'Clear cache'))}</button>` : ''}<button class="btn-dl" data-act="delf">${esc(T('删除模型文件', 'Delete model files'))}</button>` : (dl != null ? `<button class="btn-dl" data-act="pause">${esc(T('暂停', 'Pause'))}</button><button class="btn-dl" data-act="cancel">✕</button>` : `<button class="btn-dl" data-act="dl">${esc(isPaused || m.partial ? t('ai.local.resume') : t('ai.local.download'))}</button>${isPaused || m.partial ? `<button class="btn-dl" data-act="cc">${esc(T('清理缓存', 'Clear cache'))}</button>` : ''}`)}
      ${custom && !m.downloaded && dl == null ? `<button class="btn-dl" data-act="rmc">${esc(t('common.delete'))}</button>` : ''}`;
    r.onclick = async (e) => {
      const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
      if (act === 'dl') return startDownload(m);
      if (act === 'pause') return void window.aib.invoke('lm:pause', m.id);
      if (act === 'cancel') return void window.aib.invoke('lm:cancel', m.id);
      if (act === 'cc') return void clearModelCache(m);
      if (act === 'delf') return void deleteModelFiles(m);
      if (act === 'rmc') { await window.aib.invoke('hub:removeCustom', m.id); await refresh(); return renderLocal(); }
      await selectModel(m);
    };
    return r;
  }
  function releaseNote(text) { window.AIBConfirm.done(text); }
  async function clearModelCache(m) {
    const dk = diskMap[m.id] || { cache: m.partial || 0 };
    const ok = await window.AIBConfirm.ask({ title: T('清理缓存？', 'Clear cache?'), message: T(`将清理「${m.name}」的缓存（未完成下载、临时文件、运行时缓存），释放约 ${fmtB(dk.cache)}。模型本身仍可使用。`, `Clear the cache of "${m.name}" (unfinished downloads, temp files, runtime caches), freeing about ${fmtB(dk.cache)}. The model stays usable.`), detail: T('此操作无法撤销。', 'This cannot be undone.'), confirmText: T('确认清理', 'Confirm clear') });
    if (!ok) return;
    const r = await window.aib.invoke('lm:clearCache', m.id); delete progress[m.id];
    releaseNote(T('已释放 ', 'Freed ') + fmtB(r.freed || 0)); await refresh(); renderLocal();
  }
  async function deleteModelFiles(m) {
    const dk = diskMap[m.id] || { files: 0, cache: 0, roles: [] }; const roles = dk.roles || [];
    const rl = { chat: T('聊天', 'chat'), dictionary: T('词典', 'dictionary'), translate: T('翻译', 'translate'), embedding: T('嵌入', 'embedding') };
    const ok = await window.AIBConfirm.ask({ title: T('删除模型文件？', 'Delete model files?'), message: T(`将删除「${m.name}」的模型文件，释放约 ${fmtB(dk.files + dk.cache)}。之后需要重新下载才能使用。`, `Delete the files of "${m.name}", freeing about ${fmtB(dk.files + dk.cache)}. You will have to download it again to use it.`) + (roles.length ? '\n' + T('它当前担任：', 'Currently assigned to: ') + roles.map(r => rl[r] || r).join(T('、', ', ')) + T('，删除后这些角色将被清空。', '; those roles will be cleared.') : '') + (dk.bundledCopy ? '\n' + T('应用包内另有只读的内置副本，不会被删除。', 'A read-only copy inside the app bundle is not touched.') : ''), detail: T('此操作无法撤销。', 'This cannot be undone.'), confirmText: T('确认删除', 'Confirm delete') });
    if (!ok) return;
    const r = await window.aib.invoke('lm:deleteFiles', m.id); delete progress[m.id];
    releaseNote(T('已释放 ', 'Freed ') + fmtB(r.freed || 0));
    await refresh(); renderLocal();
    setTimeout(() => {
      const box = document.getElementById('diskmsg'); if (!box) return;
      let msg = '';
      if (r.rolesCleared && r.rolesCleared.length) msg += T('已清除角色分配：', 'Role assignment cleared: ') + r.rolesCleared.map(x => rl[x] || x).join(T('、', ', ')) + '。 ';
      if (r.needsKb) msg += T('知识库语义搜索需要 EmbeddingGemma。', 'Knowledge-base semantic search needs EmbeddingGemma.') + ' ';
      if (r.needsTranslate) msg += T('翻译默认使用 HY-MT，使用时会自动重新下载。', 'Translation uses HY-MT by default and re-downloads it on first use.') + ' ';
      if (!msg) return;
      box.innerHTML = `<div class="notice-bad">${esc(msg)} ${r.needsKb || r.needsTranslate ? `<button class="btn-secondary" id="restoreModel">${esc(T('重新下载 / 恢复', 'Re-download / restore'))}</button>` : ''}</div>`;
      const b = document.getElementById('restoreModel'); if (b) b.onclick = () => { progress[m.id] = { got: 0, total: m.bytes }; window.aib.invoke('lm:download', m.id); renderLocal(); };
    }, 80);
  }
  function renderDisk() {
    const box = document.getElementById('diskbox'); if (!box || !diskInfo) return;
    const d = diskInfo; const ext = (d.external || []).filter(x => x.exists);
    box.innerHTML = `<div class="engine-note"><b>${esc(T('磁盘占用', 'Disk usage'))}</b>: ${esc(fmtB(d.totals.all) || '0 MB')} · ${esc(T('模型文件 ', 'model files '))}${esc(fmtB(d.totals.files) || '0 MB')} · ${esc(T('缓存 ', 'cache '))}${esc(fmtB(d.totals.cache) || '0 MB')}</div>
      <div class="inline" style="margin:6px 0"><button class="btn-secondary" id="clrAllCache" ${d.totals.cache ? '' : 'disabled'}>${esc(T('清理所有模型缓存', 'Clear all model caches'))}</button></div><div id="diskmsg"></div>
      <div class="hint">${esc(T('只统计并清理本应用 models 目录；外部框架的文件不会被触碰（只读）：', 'Only the app models folder is counted/cleaned; external frameworks are never touched (read-only): '))}${ext.length ? ext.map(x => esc(x.name + ' → ' + x.path)).join(' · ') : esc(T('未发现 LM Studio / Ollama 目录', 'no LM Studio / Ollama folders found'))}</div>`;
    const b = document.getElementById('clrAllCache');
    if (b) b.onclick = async () => {
      const ok = await window.AIBConfirm.ask({ title: T('清理所有模型缓存？', 'Clear all model caches?'), message: T(`将清理所有模型的缓存（未完成下载、临时文件、运行时缓存、知识库嵌入索引向量），释放约 ${fmtB(d.totals.cache)}。模型文件会保留。`, `Clear the caches of all models (unfinished downloads, temp files, runtime caches, knowledge-base embedding vectors), freeing about ${fmtB(d.totals.cache)}. Model files are kept.`), detail: T('知识库文档会保留，之后需要“重建索引”。', 'Knowledge-base documents stay; rebuild the index afterwards.'), confirmText: T('确认清理', 'Confirm clear') });
      if (!ok) return;
      const r = await window.aib.invoke('lm:clearAllCache'); progress = {}; releaseNote(T('已释放 ', 'Freed ') + (fmtB(r.freed || 0) || '0 MB')); await refresh(); renderLocal();
    };
  }
  function modelGroups(list) {
    const box = document.createElement('div'); box.className = 'fam-list';
    for (const [fam, items] of groupBy(list, x => x.family)) {
      const bytes = items.map(x => x.bytes).filter(Boolean);
      const range = bytes.length ? (Math.min(...bytes) === Math.max(...bytes) ? fmtB(bytes[0]) : fmtB(Math.min(...bytes)) + ' – ' + fmtB(Math.max(...bytes))) : '';
      box.appendChild(famGroup(fam, items, { sel: items.some(isSelected), busy: items.some(x => progress[x.id] && ((!progress[x.id].done && !progress[x.id].cancelled) || progress[x.id].error)), dl: items.filter(x => x.downloaded).length, range, render: modelRow }));
    }
    return box;
  }

  async function renderLocal() {
    models = await window.aib.invoke('lm:list');
    try { diskInfo = await window.aib.invoke('lm:disk'); diskMap = {}; diskInfo.models.forEach(r => { diskMap[r.id] = r; }); } catch { diskInfo = null; }
    const L = S.ai.local; const body = document.getElementById('aibody'); if (!body) return;
    const hub = L.hub || { endpoint: 'mirror', custom: '' };
    body.innerHTML = `<div class="engine-note">${esc(t('ai.local.note'))}</div>
      <div class="form-row"><label>${esc(T('推理引擎', 'Inference engine'))}</label><div class="mode-seg" id="engseg">${[['auto', T('自动', 'Auto')], ['llama', 'llama.cpp (GGUF)'], ['mlx', 'MLX (Apple)']].filter(x => x[0] !== 'mlx' || showMlx()).map(([v, l]) => `<div class="seg ${(L.engine || 'auto') === v ? 'active' : ''}" data-eng="${v}">${esc(l)}</div>`).join('')}</div>
        <div class="hint" id="engnote"></div></div>
      <div class="form-row"><label>${esc(T('Hugging Face 下载源', 'Hugging Face endpoint'))}</label>
        <div class="inline"><select id="hubep"><option value="mirror" ${hub.endpoint === 'mirror' ? 'selected' : ''}>hf-mirror.com (${esc(T('默认', 'default'))})</option><option value="official" ${hub.endpoint === 'official' ? 'selected' : ''}>huggingface.co</option><option value="custom" ${hub.endpoint === 'custom' ? 'selected' : ''}>${esc(T('自定义地址', 'Custom URL'))}</option></select>
        <input type="text" id="hubcustom" placeholder="https://" value="${esc(hub.custom || '')}" ${hub.endpoint === 'custom' ? '' : 'hidden'} spellcheck="false"/><button class="btn-secondary" id="hubprobe">${esc(T('测试连接', 'Test'))}</button></div>
        <div class="hint">${esc(T('某个源失败时会自动切换到其他源。', 'If one endpoint fails the others are tried automatically.'))}</div><div id="huberes"></div></div>
      <h3 class="sec-h">${esc(T('模型', 'Models'))}</h3><div class="model-list" id="mlist"></div><div id="diskbox"></div>
      <div class="inline" style="margin:8px 0 12px"><button class="btn-secondary" id="pickgguf">${esc(t('ai.local.pick'))}</button></div>
      <div class="engine-note" id="lmpath"></div>
      <h3 class="sec-h">${esc(T('从 Hugging Face 搜索', 'Search Hugging Face'))}</h3>
      <div class="hf-bar"><input type="text" id="hfq" placeholder="${esc(T('搜索模型，或粘贴 repo id / 链接', 'Search models, or paste a repo id / URL'))}" value="${esc(hf.q)}" spellcheck="false"/>
        <div class="mode-seg" id="hfkind"><div class="seg ${hf.kind === 'gguf' ? 'active' : ''}" data-kind="gguf">GGUF</div>${showMlx() ? `<div class="seg ${hf.kind === 'mlx' ? 'active' : ''}" data-kind="mlx">MLX</div>` : ''}</div><button class="btn-primary" id="hfgo">${esc(T('搜索', 'Search'))}</button></div>
      <div id="hfmsg"></div><div id="hfres"></div>
      <h3 class="sec-h">${esc(T('模型角色', 'Model roles'))}</h3><div class="hint">${esc(T('为不同任务指定不同模型；留空 = 聊天模型（翻译 / 嵌入留空 = 内置 HY-MT / EmbeddingGemma）。', 'Assign models per task; empty = the chat model (translate / embedding empty = bundled HY-MT / EmbeddingGemma).'))}</div><div id="roles" class="roles-grid"></div>
      <div class="engine-note" id="lmstat"></div>
      <div class="inline"><button class="btn-primary" id="uselocal">${esc(t('ai.local.use'))}</button><span id="lmmsg"></span></div><div class="hint" style="margin-top:10px">${esc(t('ai.local.hint'))}</div>`;
    document.getElementById('mlist').appendChild(modelGroups(models)); renderDisk();
    const cur = models.find(x => selId() === x.id);
    document.getElementById('lmpath').textContent = cur ? `${t('ai.local.selectedName')}: ${cur.name} · ${cur.downloaded ? t('ai.local.downloaded') : t('ai.local.notDownloaded')}` : (L.modelPath ? `${t('ai.local.current')}: ${L.modelPath}` : t('ai.local.none'));
    const hasSel = !!(cur || L.modelPath || rolesOf().chat); const useBtn = document.getElementById('uselocal'); useBtn.disabled = !hasSel;
    document.getElementById('pickgguf').onclick = async () => { await window.aib.invoke('lm:pick'); await refresh(); renderLocal(); };
    // engine
    window.aib.invoke('mlx:status').then(s => { const before = showMlx(); mlxSt = s; if (before !== showMlx()) { if (!showMlx() && hf.kind === 'mlx') hf.kind = 'gguf'; return renderLocal(); } const e = document.getElementById('engnote'); if (!e) return;
      const rt = s.runtime || {};
      e.innerHTML = esc(s.available ? T('MLX 可用：', 'MLX available: ') + (rt.cmd || '') : T('MLX 不可用：', 'MLX unavailable: ') + (rt.reason || T('仅支持 Apple 芯片 Mac，并需 pip3 install mlx-lm', 'Apple Silicon only; run pip3 install mlx-lm'))) + ` <a href="#" id="mlxre">${esc(T('重新检测', 'Re-check'))}</a>`;
      const a = document.getElementById('mlxre'); if (a) a.onclick = async (ev) => { ev.preventDefault(); mlxSt = await window.aib.invoke('mlx:recheck'); renderLocal(); };
    });
    document.querySelectorAll('[data-eng]').forEach(b => b.onclick = async () => { await patchLocal({ engine: b.dataset.eng }); await refresh(); renderLocal(); toast(); });
    // hub endpoint
    const ep = document.getElementById('hubep'), cu = document.getElementById('hubcustom');
    ep.onchange = async () => { cu.hidden = ep.value !== 'custom'; await patchLocal({ hub: { endpoint: ep.value, custom: cu.value } }); toast(); };
    cu.onchange = async () => { await patchLocal({ hub: { endpoint: ep.value, custom: cu.value.trim() } }); toast(); };
    document.getElementById('hubprobe').onclick = async () => {
      const box = document.getElementById('huberes'); box.innerHTML = `<div class="hint">…</div>`;
      await patchLocal({ hub: { endpoint: ep.value, custom: cu.value.trim() } });
      const res = await window.aib.invoke('hub:probe');
      box.innerHTML = res.map(r => `<div class="probe-row ${r.ok ? 'ok' : 'bad'}"><b>${esc(r.base)}</b> — ${r.ok ? esc(T('可连接', 'reachable') + ' · ' + r.ms + ' ms') : esc(r.error || '')}</div>`).join('');
    };
    // HF search
    const go = async () => {
      hf.q = document.getElementById('hfq').value.trim(); if (!hf.q) return;
      hf.busy = true; notice(document.getElementById('hfmsg'), 'ok', T('搜索中…', 'Searching…'), { sticky: true });
      const r = await window.aib.invoke('hub:search', hf.q, hf.kind); hf.busy = false;
      if (!r.ok) { hf.items = []; notice(document.getElementById('hfmsg'), 'bad', r.error + (r.tried && r.tried.length ? ' — ' + r.tried.map(x => (x.base || x.id || '') + ': ' + (x.error || '')).join('; ') : '')); renderHf(); return; }
      hf.items = r.items; document.getElementById('hfmsg').textContent = ''; document.getElementById('hfmsg').className = ''; if (!r.items.length) notice(document.getElementById('hfmsg'), 'bad', T('没有找到模型', 'No models found'));
      renderHf();
    };
    document.getElementById('hfgo').onclick = go; document.getElementById('hfq').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    document.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { hf.kind = b.dataset.kind; document.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('active', x === b)); if (hf.q) go(); });
    renderHf(); renderRoles();
    useBtn.onclick = async () => {
      if (!hasSel) { notice(document.getElementById('lmmsg'), 'bad', t('ai.local.pickFirst')); return; }
      await window.aib.invoke('settings:patch', { ai: { source: 'local' } }); await refresh();
      const a = document.getElementById('activeSrc'); if (a) a.textContent = t('ai.src.local');
      if (cur && !cur.downloaded) { if (!progress[cur.id] || progress[cur.id].done || progress[cur.id].error) startDownload(cur); const m2 = document.getElementById('lmmsg'); if (m2) notice(m2, 'ok', t('ai.local.autoDl'), { ms: 4500 }); }
      else notice(document.getElementById('lmmsg'), 'ok', t('common.saved'));
    };
    window.aib.invoke('lm:status').then(s => { const e = document.getElementById('lmstat'); if (!e) return; e.textContent = s.engine === 'ok' ? `${t('ai.local.engineOk')}${s.gpu ? ' · ' + s.gpu : ''}` : `${t('ai.local.engineErr')}: ${s.engineError || ''}`; });
  }

  function renderHf() {
    const box = document.getElementById('hfres'); if (!box) return; box.innerHTML = '';
    if (!hf.items.length) return;
    const g = document.createElement('div'); g.className = 'fam-list';
    for (const [fam, items] of groupBy(hf.items, x => x.family)) {
      g.appendChild(famGroup(fam, items, { key: 'hf:' + fam, sel: false, dl: 0, range: '', render: (it) => {
        const w = document.createElement('div'); w.className = 'hf-repo'; w.dataset.repo = it.repo;
        w.innerHTML = `<div class="hf-head"><div class="m-info"><div class="m-name">${esc(it.repo)}</div><div class="m-sub"><span class="mtag ${it.engine === 'mlx' ? 'mlx' : 'gguf'}">${it.engine === 'mlx' ? 'MLX' : 'llama.cpp'}</span> ↓ ${esc(String(it.downloads))} · ♥ ${esc(String(it.likes))}${it.license ? ' · ' + esc(it.license) : ''}</div></div><button class="btn-dl" data-act="files">${esc(T('文件', 'Files'))}</button></div><div class="hf-files" hidden></div>`;
        w.querySelector('[data-act="files"]').onclick = () => openFiles(w, it);
        return w;
      } }));
    }
    box.appendChild(g);
  }
  async function openFiles(w, it) {
    const fb = w.querySelector('.hf-files'); if (!fb.hidden) { fb.hidden = true; return; }
    fb.hidden = false; fb.innerHTML = `<div class="hint">…</div>`;
    let r = hf.files[it.repo]; if (!r) { r = await window.aib.invoke('hub:files', it.repo); if (r.ok) hf.files[it.repo] = r; }
    if (!r.ok) { fb.innerHTML = `<div class="m-err">${esc(r.error)}</div>`; return; }
    if (!r.files.length) { fb.innerHTML = `<div class="m-err">${esc(T('此仓库没有可用文件', 'No usable files in this repo'))}</div>`; return; }
    fb.innerHTML = '';
    r.files.forEach(f => {
      const have = (S.ai.local.custom || []).some(c => c.id === (r.engine === 'mlx' ? 'hf:' + r.repo : 'hf:' + r.repo + '/' + f.file));
      const row = document.createElement('div'); row.className = 'hf-file';
      row.innerHTML = `<span class="mtag">${esc(f.quant || (r.engine === 'mlx' ? 'MLX' : '?'))}</span><span class="hf-fname" title="${esc(f.file)}">${esc(f.file === '*' ? T('完整快照', 'full snapshot') + ` (${f.count})` : f.file)}</span><span class="m-size">${esc(f.size)}</span><span class="m-sub">RAM ${esc(f.ram)}</span><button class="btn-dl" data-act="add">${esc(have ? T('已添加', 'Added') : T('下载', 'Download'))}</button>`;
      row.querySelector('button').onclick = async () => {
        const id = await window.aib.invoke('hub:addCustom', { repo: r.repo, file: f.file, engine: r.engine, bytes: f.bytes, sha256: f.sha256, quant: f.quant, license: r.license });
        await refresh(); models = await window.aib.invoke('lm:list'); const ent = models.find(x => x.id === id);
        openFam.add(ent ? ent.family : ''); if (ent && !ent.downloaded) startDownload(ent); else renderLocal();
      };
      fb.appendChild(row);
    });
  }

  // roles: chat / dictionary / translate / embedding -> downloaded local models + running-framework models
  async function renderRoles() {
    const box = document.getElementById('roles'); if (!box) return;
    if (!fwCache.length) { try { fwCache = await window.aib.invoke('fw:detect'); } catch {} }
    const R = rolesOf();
    const built = models.filter(m => m.downloaded); const fwm = [];
    fwCache.filter(f => f.up).forEach(f => f.models.forEach(m => fwm.push({ v: `fw:${f.id}:${m.id}`, l: `${f.name} · ${m.id}` })));
    const roles = [['chat', T('聊天 / Agent', 'Chat / Agent'), false], ['dictionary', T('词典', 'Dictionary'), false], ['translate', T('翻译', 'Translate'), true], ['embedding', T('嵌入 (知识库)', 'Embedding (KB)'), true]];
    box.innerHTML = roles.map(([r, l, bundled]) => `<div class="role-row"><label>${esc(l)}</label><select data-role="${r}"><option value="">${esc(r === 'translate' ? T('内置 HY-MT1.5', 'Bundled HY-MT1.5') : r === 'embedding' ? T('内置 EmbeddingGemma', 'Bundled EmbeddingGemma') : r === 'chat' ? T('（当前选择）', '(current selection)') : T('同聊天模型', 'Same as chat'))}</option>
      ${built.length ? `<optgroup label="${esc(T('内嵌 / 已下载', 'Built-in / downloaded'))}">${built.map(m => `<option value="${esc(roleKey(m))}" ${R[r] === roleKey(m) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</optgroup>` : ''}
      ${fwm.length ? `<optgroup label="${esc(T('本地框架', 'Local frameworks'))}">${fwm.map(m => `<option value="${esc(m.v)}" ${R[r] === m.v ? 'selected' : ''}>${esc(m.l)}</option>`).join('')}</optgroup>` : ''}</select></div>`).join('');
    box.querySelectorAll('[data-role]').forEach(sel => sel.onchange = async () => { await patchLocal({ roles: { ...rolesOf(), [sel.dataset.role]: sel.value } }); await refresh(); renderLocal(); toast(); });
  }

  window.aib.on('lm:progress', (p) => {
    if (p.id === '*') { progress = {}; if (cur === 'ai' && aiTab === 'local') refresh().then(renderLocal); return; }
    progress[p.id] = { ...(progress[p.id] || {}), paused: false, error: undefined, cancelled: false, ...p };
    if (!(cur === 'ai' && aiTab === 'local')) return;
    const full = p.done || p.error || p.deleted || p.cancelled || p.paused || p.state === 'paused' || !document.querySelector(`.model-row[data-model="${p.id}"] .progress`);
    if (full) { refresh().then(renderLocal); return; }
    const row = document.querySelector(`.model-row[data-model="${p.id}"]`); if (!row) return; // in-place update: clicks are never lost mid-download
    const pr = progress[p.id]; const pct = Math.round(pr.got / (pr.total || 1) * 100);
    const bar = row.querySelector('.progress > i'); if (bar) bar.style.width = pct + '%';
    const st = row.querySelector('.dlstat'); const mm = models.find(x => x.id === p.id); if (st && mm) st.textContent = dlStatus(mm, pr);
  });

  // ---------------- local frameworks (LM Studio, Ollama, oMLX, llama.cpp server, vLLM, Jan, LocalAI, custom)
  async function renderFw() {
    await refresh(); const body = document.getElementById('aibody'); if (!body) return;
    body.innerHTML = `<div class="engine-note">${esc(T('自动探测本机正在运行的本地推理服务（LM Studio :1234、Ollama :11434、oMLX :8000、MLX-LM / llama.cpp server :8080、Jan :1337 …），并用它们的模型担任聊天 / 词典 / 翻译 / 嵌入。支持流式输出与 Agent 工具调用（不支持原生工具时自动改用 JSON 模式）。', 'Detects local inference servers running on this machine (LM Studio :1234, Ollama :11434, oMLX :8000, MLX-LM / llama.cpp server :8080, Jan :1337 …) and lets their models act as chat / dictionary / translate / embedding. Streaming and agent tool calling are supported (JSON mode is used when native tools are not).'))}</div>
      <div class="inline" style="margin-bottom:10px"><button class="btn-primary" id="fwdet">${esc(T('重新探测', 'Detect again'))}</button><button class="btn-secondary" id="fwadd">${esc(T('添加自定义服务', 'Add custom server'))}</button><span id="fwmsg"></span></div>
      <div id="fwform"></div><div id="fwlist"></div>`;
    const draw = (list) => {
      fwCache = list; const box = document.getElementById('fwlist'); if (!box) return; box.innerHTML = '';
      const R = rolesOf();
      list.forEach(f => {
        const c = document.createElement('div'); c.className = 'fw-card ' + (f.up ? 'up' : 'down'); c.dataset.fw = f.id;
        c.innerHTML = `<div class="fw-head"><span class="dot"></span><b class="fw-name">${esc(f.name)}</b><span class="fw-url">${esc(f.baseUrl)}</span>${f.version ? `<span class="mtag">v${esc(f.version)}</span>` : ''}<span class="fw-st">${f.up ? esc(T('运行中', 'running') + ` · ${f.models.length} ` + T('个模型', 'models')) : esc(T('未运行', 'not running'))}</span></div>
          ${f.up ? '' : `<div class="fw-reason">${esc(f.reason)}</div>`}${f.note ? `<div class="fw-reason">${esc(f.note)}</div>` : ''}<div class="fw-models"></div>
          <details class="fw-edit"><summary>${esc(T('地址 / 端口 / API Key', 'Host / port / API key'))}</summary><div class="inline"><input type="text" data-k="host" value="${esc(f.host)}" placeholder="127.0.0.1"/><input type="number" data-k="port" value="${esc(f.port)}" style="width:90px"/><input type="password" data-k="key" placeholder="API key" /><button class="btn-secondary" data-a="save">${esc(t('common.save'))}</button><button class="btn-secondary" data-a="test">${esc(T('测试连接', 'Test connection'))}</button>${f.custom ? `<button class="btn-secondary" data-a="rm">${esc(t('common.delete'))}</button>` : ''}</div><div class="fw-test"></div></details>`;
        const mb = c.querySelector('.fw-models');
        if (f.up && f.models.length) {
          const fams = groupBy(f.models, m => m.family);
          for (const [fam, items] of fams) mb.appendChild(famGroup(fam, items, { key: 'fw:' + f.id + ':' + fam, sel: items.some(m => Object.values(R).includes(`fw:${f.id}:${m.id}`)), dl: 0, range: items.map(m => m.params).filter(Boolean).join(' / '), render: (m) => {
            const row = document.createElement('div'); row.className = 'model-row fw-model'; row.dataset.model = m.id;
            const assigned = ['chat', 'dictionary', 'translate', 'embedding'].filter(r => R[r] === `fw:${f.id}:${m.id}`);
            row.innerHTML = `<div class="m-info"><div class="m-name">${esc(m.id)}${m.embedding ? ` <span class="mtag embedding">${esc(T('嵌入', 'embedding'))}</span>` : ''}</div><div class="m-sub">${esc([m.paramSize || m.params, m.quant, m.size ? fmtB(m.size) : ''].filter(Boolean).join(' · '))}</div></div>
              <div class="m-state">${esc(assigned.map(r => ({ chat: T('聊天', 'chat'), dictionary: T('词典', 'dict'), translate: T('翻译', 'translate'), embedding: T('嵌入', 'embed') }[r])).join(' · '))}</div>
              <select class="fw-role" data-m="${esc(m.id)}"><option value="">${esc(T('指定角色…', 'Assign role…'))}</option><option value="chat">${esc(T('聊天 / Agent', 'Chat / Agent'))}</option><option value="dictionary">${esc(T('词典', 'Dictionary'))}</option><option value="translate">${esc(T('翻译', 'Translate'))}</option><option value="embedding">${esc(T('嵌入', 'Embedding'))}</option>${assigned.length ? `<option value="__none">${esc(T('取消角色', 'Unassign'))}</option>` : ''}</select>`;
            row.querySelector('select').onchange = async (e) => {
              const v = e.target.value; if (!v) return; const nr = { ...rolesOf() };
              if (v === '__none') assigned.forEach(r => { nr[r] = ''; }); else nr[v] = `fw:${f.id}:${m.id}`;
              const patch = { roles: nr }; await patchLocal(patch);
              if (v === 'chat') await window.aib.invoke('settings:patch', { ai: { source: 'local' } });
              await refresh(); draw(fwCache); toast();
            };
            return row;
          } }));
        }
        c.querySelector('[data-a="save"]').onclick = async () => {
          const q = (k) => c.querySelector(`[data-k="${k}"]`).value; const key = q('key');
          if (f.custom) { const arr = (S.ai.local.frameworks.custom || []).map(x => x.id === f.id ? { ...x, baseUrl: `http://${q('host')}:${q('port')}${new URL(x.baseUrl).pathname.replace(/\/$/, '')}`, ...(key ? { apiKey: key } : {}) } : x); await patchLocal({ frameworks: { custom: arr } }); }
          else await patchLocal({ frameworks: { overrides: { [f.id.replace(/^(vllm)$/, 'omlx').replace(/^(llamacpp|localai)$/, 'mlxlm')]: { host: q('host'), port: Number(q('port')), ...(key ? { apiKey: key } : {}) } } } });
          await refresh(); notice(document.getElementById('fwmsg'), 'ok', t('common.saved')); detect();
        };
        c.querySelector('[data-a="test"]').onclick = async () => {
          const q = (k) => c.querySelector(`[data-k="${k}"]`).value; const out = c.querySelector('.fw-test'); out.textContent = '…';
          const r = await window.aib.invoke('fw:test', { id: f.id, name: f.name, kind: f.kind, baseUrl: `http://${q('host')}:${q('port')}`, apiKey: q('key') });
          out.className = 'fw-test ' + (r.up ? 'ok' : 'bad'); out.textContent = r.up ? T('连接成功：', 'Connected: ') + r.models.length + T(' 个模型', ' models') : r.reason;
        };
        const rm = c.querySelector('[data-a="rm"]'); if (rm) rm.onclick = async () => { await patchLocal({ frameworks: { custom: (S.ai.local.frameworks.custom || []).filter(x => x.id !== f.id) } }); await refresh(); detect(); };
        box.appendChild(c);
      });
    };
    const detect = async () => { const b = document.getElementById('fwdet'); if (b) b.disabled = true; const list = await window.aib.invoke('fw:detect'); if (b) b.disabled = false; draw(list); };
    document.getElementById('fwdet').onclick = detect;
    document.getElementById('fwadd').onclick = () => {
      const f = document.getElementById('fwform');
      f.innerHTML = `<div class="fw-card"><div class="inline"><input type="text" id="cfn" placeholder="${esc(T('名称', 'Name'))}"/><input type="text" id="cfu" placeholder="http://host:port/v1" style="flex:1"/><select id="cfk"><option value="openai">OpenAI-compatible</option><option value="ollama">Ollama</option></select><input type="password" id="cfa" placeholder="API key"/><button class="btn-primary" id="cfok">${esc(t('common.save'))}</button><button class="btn-secondary" id="cfno">${esc(T('取消', 'Cancel'))}</button></div><div id="cfm"></div></div>`;
      document.getElementById('cfno').onclick = () => { f.innerHTML = ''; };
      document.getElementById('cfok').onclick = async () => {
        const url = document.getElementById('cfu').value.trim(); try { new URL(url); } catch { return notice(document.getElementById('cfm'), 'bad', T('地址无效', 'Invalid URL')); }
        const item = { id: 'c' + Date.now().toString(36), name: document.getElementById('cfn').value.trim() || new URL(url).host, baseUrl: url, kind: document.getElementById('cfk').value, apiKey: document.getElementById('cfa').value };
        await patchLocal({ frameworks: { custom: (S.ai.local.frameworks.custom || []).concat([item]) } }); await refresh(); f.innerHTML = ''; detect();
      };
    };
    detect();
  }

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


  // ---------------- passwords
  let pwTimer = null;
  async function renderPasswords() {
    await refresh();
    const info = await window.aib.invoke('pw:info'); const cfg = info.cfg || {};
    const p = pane();
    p.innerHTML = `<h2>${esc(t('pw.title'))}</h2><div class="sub">${esc(t('pw.sub'))}</div>
      <div class="form-row"><label class="inline pw-check"><input type="checkbox" id="pwsave" ${cfg.save !== false ? 'checked' : ''}/>${esc(t('pw.save'))}</label>
        <label class="inline pw-check"><input type="checkbox" id="pwauto" ${cfg.autofill !== false ? 'checked' : ''}/>${esc(t('pw.autofill'))}</label>
        <div class="hint">${esc(info.touchId ? t('pw.touch') : info.hello ? t('pw.hello') : t('pw.syspw'))}</div></div>
      <div class="pw-bar"><input type="text" id="pwq" placeholder="${esc(t('pw.search'))}" spellcheck="false"/><button class="btn-secondary" id="pwadd">${esc(t('pw.add'))}</button><button class="btn-secondary" id="pwimp">${esc(t('pw.import'))}</button><button class="btn-secondary" id="pwexp">${esc(t('pw.export'))}</button><span id="pwnote"></span></div>
      <div class="engine-note">${esc(t('pw.exportWarn'))}</div>
      <div class="card-list pw-list" id="pwlist"></div>
      <h3 class="pw-h3">${esc(t('pw.never'))}</h3><div class="card-list" id="pwnever"></div><div id="pwform"></div>`;
    const save = (patch) => window.aib.invoke('settings:patch', { passwords: patch }).then(() => toast());
    document.getElementById('pwsave').onchange = (e) => save({ save: e.target.checked });
    document.getElementById('pwauto').onchange = (e) => save({ autofill: e.target.checked });
    const note = (k, text) => notice(document.getElementById('pwnote'), k, text);
    const reload = async () => {
      const items = await window.aib.invoke('pw:list', document.getElementById('pwq').value);
      const box = document.getElementById('pwlist'); if (!box) return; box.innerHTML = '';
      if (!items.length) box.innerHTML = `<div class="row pw-empty">${esc(t('pw.empty'))}</div>`;
      for (const it of items) {
        const r = document.createElement('div'); r.className = 'row pw-row'; r.dataset.id = it.id;
        r.innerHTML = `<div class="nm"><b title="${esc(it.url)}">${esc(it.origin.replace(/^https?:\/\//, ''))}</b><small>${esc(it.username || '—')}</small></div><div class="pw-val" data-v></div>
          <button class="s" data-a="reveal">${esc(t('pw.reveal'))}</button><button class="s" data-a="copy" hidden>${esc(t('pw.copy'))}</button><button class="s" data-a="edit">${esc(t('pw.edit'))}</button><button class="s rm" data-a="del">${esc(t('pw.delete'))}</button>`;
        let shown = null, tm = null;
        const hide = () => { shown = null; clearTimeout(tm); r.querySelector('[data-v]').textContent = ''; r.querySelector('[data-a="reveal"]').textContent = t('pw.reveal'); r.querySelector('[data-a="copy"]').hidden = true; };
        r.onclick = async (e) => {
          const a = e.target.dataset && e.target.dataset.a; if (!a) return;
          if (a === 'reveal') {
            if (shown) return hide();
            try { const x = await window.aib.invoke('pw:reveal', it.id); shown = x.password; r.querySelector('[data-v]').textContent = x.password; e.target.textContent = t('pw.hide'); r.querySelector('[data-a="copy"]').hidden = false; tm = setTimeout(hide, 15000); }
            catch (err) { note('bad', t('pw.authFail')); }
          } else if (a === 'copy') { if (shown) navigator.clipboard.writeText(shown).catch(() => {}); }
          else if (a === 'del') {
            if (!r.dataset.confirm) { r.dataset.confirm = '1'; e.target.textContent = t('pw.deleteConfirm'); e.target.classList.add('danger'); setTimeout(() => { if (r.isConnected) { delete r.dataset.confirm; e.target.textContent = t('pw.delete'); e.target.classList.remove('danger'); } }, 4000); return; }
            await window.aib.invoke('pw:remove', it.id); reload();
          } else if (a === 'edit') form(it);
        };
        box.appendChild(r);
      }
      const never = await window.aib.invoke('pw:never'); const nb = document.getElementById('pwnever'); nb.innerHTML = '';
      if (!never.length) nb.innerHTML = `<div class="row pw-empty">${esc(t('pw.neverEmpty'))}</div>`;
      never.forEach(o => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<div class="nm"><b>${esc(o.replace(/^https?:\/\//, ''))}</b></div><button class="s">${esc(t('pw.removeNever'))}</button>`; r.querySelector('button').onclick = async () => { await window.aib.invoke('pw:never', 'remove', o); reload(); }; nb.appendChild(r); });
    };
    const form = (it) => {
      const f = document.getElementById('pwform');
      f.innerHTML = `<div class="pw-modal"><div class="card"><h3>${esc(it ? t('pw.edit') : t('pw.add'))}</h3>
        <label>${esc(t('pw.url'))}</label><input id="fu" value="${esc(it ? it.url : '')}" ${it ? '' : 'placeholder="https://"'}/>
        <label>${esc(t('pw.user'))}</label><input id="fn" value="${esc(it ? it.username : '')}"/>
        <label>${esc(t('pw.pass'))}</label><input id="fp" type="password" placeholder="${it ? '••••••••' : ''}"/>
        <div class="inline" style="margin-top:12px"><button class="btn-primary" id="fok">${esc(t('common.save'))}</button><button class="btn-secondary" id="fno">${esc(t('pw.cancel'))}</button><span id="fmsg"></span></div></div></div>`;
      document.getElementById('fno').onclick = () => { f.innerHTML = ''; };
      document.getElementById('fok').onclick = async () => {
        const v = { url: document.getElementById('fu').value.trim(), username: document.getElementById('fn').value, password: document.getElementById('fp').value };
        try { if (it) await window.aib.invoke('pw:update', it.id, { url: v.url, username: v.username, ...(v.password ? { password: v.password } : {}) }); else await window.aib.invoke('pw:add', v); f.innerHTML = ''; note('ok', t('pw.saved')); reload(); }
        catch (e) { notice(document.getElementById('fmsg'), 'bad', String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
      };
    };
    document.getElementById('pwq').oninput = () => { clearTimeout(pwTimer); pwTimer = setTimeout(reload, 150); };
    document.getElementById('pwadd').onclick = () => form(null);
    document.getElementById('pwimp').onclick = async () => { try { const r = await window.aib.invoke('pw:import'); if (r) { note('ok', `${t('pw.imported')}: ${r.added}`); reload(); } } catch (e) { note('bad', String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } };
    document.getElementById('pwexp').onclick = async () => { try { const r = await window.aib.invoke('pw:export'); if (r) note('ok', `${t('pw.exported')} ${r.path}`); } catch (e) { note('bad', t('pw.authFail')); } };
    reload();
  }


  // ---------------- knowledge base (EmbeddingGemma, offline)
  async function renderKb() {
    await refresh(); const K = S.kb || { source: 'builtin', api: {} }; const p = pane();
    p.innerHTML = `<h2>${esc(T('知识库', 'Knowledge base'))}</h2><div class="sub">${esc(T('把文档放进本地知识库，AI 聊天和 Agent 会用语义检索找到相关内容（kb_search）。默认使用内置的 EmbeddingGemma-300M，完全离线，中英文均可检索。', 'Put documents into a local knowledge base; chat and the agent find relevant passages with semantic search (kb_search). Uses the bundled EmbeddingGemma-300M by default — fully offline, works for Chinese and English.'))}</div>
      <div class="form-row"><label>${esc(T('嵌入模型', 'Embedding model'))}</label><select id="kbsrc"><option value="builtin" ${K.source !== 'api' ? 'selected' : ''}>${esc(T('内置 EmbeddingGemma-300M（离线，默认）', 'Bundled EmbeddingGemma-300M (offline, default)'))}</option><option value="api" ${K.source === 'api' ? 'selected' : ''}>${esc(T('自定义 API（OpenAI 兼容 /embeddings）', 'Custom API (OpenAI-compatible /embeddings)'))}</option></select></div>
      <div id="kbapi" ${K.source === 'api' ? '' : 'hidden'}><div class="form-row"><label>Base URL</label><input type="text" id="kbbase" value="${esc((K.api || {}).baseUrl || '')}" placeholder="https://api.openai.com/v1"/></div>
        <div class="form-row"><label>${esc(T('模型', 'Model'))}</label><input type="text" id="kbmodel" value="${esc((K.api || {}).model || '')}" placeholder="text-embedding-3-small"/></div>
        <div class="form-row"><label>API Key</label><input type="password" id="kbkey" placeholder="${(K.api || {}).hasKey ? '••••••••' : ''}"/></div>
        <div class="inline"><button class="btn-primary" id="kbsave">${esc(t('common.save'))}</button><span id="kbsavemsg"></span></div></div>
      <div class="engine-note" id="kbstale" hidden></div>
      <h3 class="sec-h">${esc(T('添加内容', 'Add content'))}</h3>
      <div class="kb-add"><div class="inline"><button class="btn-secondary" id="kbfile">${esc(T('添加文件…', 'Add files…'))}</button><input type="text" id="kburl" placeholder="https://" style="flex:1"/><button class="btn-secondary" id="kburlgo">${esc(T('添加网页', 'Add web page'))}</button></div>
        <input type="text" id="kbtitle" placeholder="${esc(T('标题（可选）', 'Title (optional)'))}"/><textarea id="kbtext" placeholder="${esc(T('或直接粘贴文本…', 'Or paste text…'))}"></textarea><div class="inline"><button class="btn-secondary" id="kbtextgo">${esc(T('添加文本', 'Add text'))}</button><span id="kbmsg"></span></div></div>
      <div class="progress" id="kbprog" hidden><i style="width:0"></i></div>
      <h3 class="sec-h">${esc(T('文档', 'Documents'))}</h3><div class="card-list" id="kblist"></div>
      <div class="inline" style="margin-top:8px"><button class="btn-secondary" id="kbre">${esc(T('重建索引', 'Rebuild index'))}</button><button class="btn-secondary" id="kbclear">${esc(T('清空', 'Clear all'))}</button></div>
      <h3 class="sec-h">${esc(T('检索测试', 'Search test'))}</h3><div class="hf-bar"><input type="text" id="kbq" placeholder="${esc(T('输入问题…', 'Ask something…'))}"/><button class="btn-primary" id="kbgo">${esc(T('搜索', 'Search'))}</button></div><div class="card-list" id="kbhits"></div>`;
    const msg = (k, x) => notice(document.getElementById('kbmsg'), k, x);
    const saveKb = async () => { await window.aib.invoke('settings:patch', { kb: { source: document.getElementById('kbsrc').value, api: { baseUrl: document.getElementById('kbbase').value.trim(), model: document.getElementById('kbmodel').value.trim(), apiKey: document.getElementById('kbkey').value } } }); await refresh(); drawList(); };
    document.getElementById('kbsrc').onchange = async () => { document.getElementById('kbapi').hidden = document.getElementById('kbsrc').value !== 'api'; await saveKb(); toast(); };
    document.getElementById('kbsave').onclick = async () => { await saveKb(); notice(document.getElementById('kbsavemsg'), 'ok', t('common.saved')); };
    const drawList = async () => {
      const l = await window.aib.invoke('kb:list'); const box = document.getElementById('kblist'); if (!box) return;
      const st = document.getElementById('kbstale'); st.hidden = !l.stale; st.textContent = l.stale ? T('嵌入模型已更换：需要“重建索引”后才能检索。', 'The embedding model changed — rebuild the index before searching.') : '';
      box.innerHTML = l.docs.length ? '' : `<div class="row pw-empty">${esc(T('知识库还是空的', 'The knowledge base is empty'))}</div>`;
      l.docs.forEach(d => { const r = document.createElement('div'); r.className = 'row kb-doc'; r.dataset.id = d.id; r.innerHTML = `<div class="nm"><b title="${esc(d.title)}">${esc(d.title)}</b><small>${esc(d.chunks + T(' 段', ' chunks'))} · ${esc(String(d.chars || ''))}${T(' 字', ' chars')}</small></div><button class="s rm">${esc(t('common.delete'))}</button>`; r.querySelector('button').onclick = async () => { await window.aib.invoke('kb:remove', d.id); drawList(); }; box.appendChild(r); });
    };
    const busy = (on) => { ['kbfile', 'kburlgo', 'kbtextgo', 'kbre'].forEach(i => { const e = document.getElementById(i); if (e) e.disabled = on; }); };
    const done = (r, okText) => { busy(false); const pg = document.getElementById('kbprog'); if (pg) pg.hidden = true; if (r && r.ok === false) msg('bad', r.error); else msg('ok', okText); drawList(); };
    document.getElementById('kbfile').onclick = async () => { busy(true); msg('ok', T('正在建立索引…', 'Indexing…'), { sticky: true }); const r = await window.aib.invoke('kb:addFiles'); const bad = (r.results || []).find(x => x.ok === false); done(bad || r, T('已添加 ', 'Added ') + (r.results || []).filter(x => x.ok).length + T(' 个文件', ' file(s)')); };
    document.getElementById('kburlgo').onclick = async () => { const u = document.getElementById('kburl').value.trim(); if (!u) return; busy(true); msg('ok', T('正在抓取并建立索引…', 'Fetching and indexing…'), { sticky: true }); done(await window.aib.invoke('kb:addUrl', u), T('已添加网页', 'Page added')); };
    document.getElementById('kbtextgo').onclick = async () => { const x = document.getElementById('kbtext').value; if (!x.trim()) return; busy(true); const r = await window.aib.invoke('kb:addText', document.getElementById('kbtitle').value, x); if (r.ok) { document.getElementById('kbtext').value = ''; document.getElementById('kbtitle').value = ''; } done(r, T('已添加', 'Added')); };
    document.getElementById('kbre').onclick = async () => { busy(true); msg('ok', T('正在重建…', 'Rebuilding…'), { sticky: true }); done(await window.aib.invoke('kb:reindex'), T('索引已重建', 'Index rebuilt')); };
    document.getElementById('kbclear').onclick = async () => { await window.aib.invoke('kb:clear'); drawList(); };
    const search = async () => { const q = document.getElementById('kbq').value.trim(); if (!q) return; const box = document.getElementById('kbhits'); box.innerHTML = `<div class="row pw-empty">…</div>`; const r = await window.aib.invoke('kb:search', q, 5); if (!r.ok) { box.innerHTML = ''; return notice(document.getElementById('kbmsg'), 'bad', r.error); } box.innerHTML = r.hits.length ? '' : `<div class="row pw-empty">${esc(T('没有相关内容', 'No relevant passages'))}</div>`; r.hits.forEach(h => { const d = document.createElement('div'); d.className = 'kb-hit'; d.innerHTML = `<b>${esc(h.title)}</b> <small>${esc((h.score || 0).toFixed(3))}</small><p>${esc(h.text)}</p>`; box.appendChild(d); }); };
    document.getElementById('kbgo').onclick = search; document.getElementById('kbq').onkeydown = (e) => { if (e.key === 'Enter') search(); };
    drawList();
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
    const look = document.createElement('div'); look.className = 'form-row';
    const TH = window.AIBTheme; const en = I18N.lang === 'en';
    const A = TH.normAppearance(S.appearance);
    const modeNames = { system: en ? 'Follow system' : '跟随系统', light: en ? 'Light' : '浅色', dark: en ? 'Dark' : '深色' };
    const combo = (id, attr, on) => { const th = TH.THEMES[id]; return `<button type="button" class="theme-combo ${on ? 'on' : ''}" ${attr}="${id}" aria-pressed="${on}"><b>${esc(en ? th.en : th.zh)}</b><span class="swatches">${th.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</span></button>`; };
    look.innerHTML = `<label>${en ? 'Appearance' : '外观'}</label><div class="mode-seg theme-mode" role="radiogroup" id="thmode">${TH.MODES.map(m => `<button type="button" class="seg ${A.mode === m ? 'active' : ''}" role="radio" aria-checked="${A.mode === m}" data-mode="${m}">${modeNames[m]}</button>`).join('')}</div>
      <div class="hint">${en ? 'Follow system switches between the light and dark theme with the system appearance.' : '「跟随系统」时随系统的浅色 / 深色外观自动切换下面两套主题。'}</div>
      <label>${en ? 'Dark theme' : '深色主题'}</label><div class="theme-grid" id="thdark">${TH.DARK.map(id => combo(id, 'data-theme', A.theme === id)).join('')}</div>
      <label>${en ? 'Light theme' : '浅色主题'}</label><div class="theme-grid" id="thlight">${TH.LIGHT.map(id => combo(id, 'data-light', A.light === id)).join('')}</div>
      <label>回答风格</label><select id="astyle"><option value="concise">简洁</option><option value="detailed">详细</option><option value="steps">步骤</option></select>
      <label>思考等级</label><select id="think"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="max">max</option></select>
      <label>主页布局</label><select id="hlay"><option value="center">居中</option><option value="top">靠上</option></select>
      <label>主页背景</label><input id="hbg" placeholder="#112233 或留空">
      <div class="inline" style="margin-top:8px"><button class="btn-secondary" id="kcheck">检查内核更新</button><span id="kout"></span></div>`;
    p.appendChild(look);
    look.querySelector('#astyle').value = S.answerStyle || 'detailed';
    look.querySelector('#think').value = S.thinkingLevel || 'medium';
    look.querySelector('#hlay').value = (S.home && S.home.layout) || 'center';
    look.querySelector('#hbg').value = (S.home && S.home.background) || '';
    const setLook = async (patch) => { S = await window.aib.invoke('settings:patch', { appearance: patch }); toast(); renderGeneral(); };
    look.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setLook({ mode: b.dataset.mode }));
    // picking a palette of the other scheme also switches to it (unless following the system)
    look.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => setLook(Object.assign({ theme: b.dataset.theme }, A.mode === 'light' ? { mode: 'dark' } : {})));
    look.querySelectorAll('[data-light]').forEach(b => b.onclick = () => setLook(Object.assign({ light: b.dataset.light }, A.mode === 'dark' ? { mode: 'light' } : {})));
    const saveLook = async () => { await window.aib.invoke('settings:patch', { answerStyle: look.querySelector('#astyle').value, thinkingLevel: look.querySelector('#think').value, home: { layout: look.querySelector('#hlay').value, background: look.querySelector('#hbg').value.trim() } }); toast(); };
    ['astyle','think','hlay','hbg'].forEach(i => look.querySelector('#'+i).addEventListener('change', saveLook));
    look.querySelector('#hbg').addEventListener('change', saveLook);
    look.querySelector('#kcheck').onclick = async () => { const r = await window.aib.invoke('kernel:check'); look.querySelector('#kout').textContent = r.updateAvailable ? '有新内核，可在下载后替换应用' : '已是当前记录的内核'; };
    const obRow = document.createElement('div'); obRow.className='form-row'; obRow.style.marginTop='18px';
    obRow.innerHTML = `<label>${esc(t('onboard.reopenLabel'))}</label><div class="hint">${esc(t('onboard.reopenHint'))}</div><div class="inline" style="margin-top:8px"><button class="btn-secondary" id="obreopen">${esc(t('onboard.reopen'))}</button></div>`;
    p.appendChild(obRow);
    $('obreopen').onclick = async () => { await window.aib.invoke('settings:patch', { onboarding: { completed: false, skipped: false } }); location.href = 'aibrowser://onboarding'; };
    const sm=document.createElement('div'); sm.className='form-row'; sm.style.marginTop='12px'; sm.innerHTML=`<label>${esc(t('selfmod.title'))}</label><div class="hint">${esc(t('selfmod.sub'))}</div><div class="inline" style="margin-top:8px"><button class="btn-secondary" id="opensm">${esc(t('selfmod.title'))}</button></div>`; p.appendChild(sm); $('opensm').onclick=()=>{ location.href='aibrowser://selfmod'; };

  }
  // ---------------- privacy
  async function renderPrivacy() {
    const p = pane();
    p.innerHTML = `<h2>${esc(t('privacy.title'))}</h2><div class="sub">${esc(t('privacy.sub'))}</div>
      ${['history', 'downloads', 'cache', 'cookies'].map(k => `<div class="form-row"><label class="inline" style="font-size:13px;color:var(--text-primary)"><input type="checkbox" data-clr="${k}" ${k !== 'cookies' ? 'checked' : ''}/>${esc(t('privacy.' + k))}</label></div>`).join('')}
      <div class="form-row"><label style="font-size:13px;color:var(--text-primary)">${esc(t('privacy.range'))}</label> <select id="clrRange">${['hour', 'day', 'all'].map(r => `<option value="${r}" ${r === 'all' ? 'selected' : ''}>${esc(t('range.' + r))}</option>`).join('')}</select></div>
      <div class="inline"><button class="btn-danger" id="clr">${esc(t('privacy.clear'))}</button><span id="clrres"></span></div>`;
    document.getElementById('clr').onclick = async () => {
      const o = {}; p.querySelectorAll('[data-clr]').forEach(c => o[c.dataset.clr] = c.checked);
      o.range = document.getElementById('clrRange').value;
      if (!o.history && !o.downloads && !o.cache && !o.cookies) return;
      const cnt = await window.aib.invoke('privacy:count', o.range);
      const parts = [];
      if (o.history) parts.push(t('confirm.part.history', { n: cnt.history, range: t('range.' + o.range) }));
      if (o.downloads) parts.push(t('confirm.part.downloads', { n: cnt.downloads }));
      if (o.cache) parts.push(t('confirm.part.cache'));
      if (o.cookies) parts.push(t('confirm.part.cookies'));
      const ok = await window.AIBConfirm.ask({ title: t('confirm.priv.title'), message: t('confirm.priv.msg') + '\n• ' + parts.join('\n• '), detail: t('confirm.irreversible'), confirmText: t('confirm.ok') });
      if (!ok) return;
      const r = await window.aib.invoke('privacy:clear', o);
      const total = (r.history || 0) + (r.downloads || 0);
      window.AIBConfirm.done(t('confirm.cleared', { n: total }));
      notice(document.getElementById('clrres'), 'ok', t('confirm.cleared', { n: total }));
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
  // ---------------- Python & Linux VM
  let vmOff = null;
  const fmtVmB = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(0) + ' MB');
  async function renderPython() {
    await refresh();
    const pyS = Object.assign({ engine: 'auto', timeoutSec: 600, index: '' }, S.python || {});
    const vmS = Object.assign({ memoryMB: 2048, cpus: 2, diskGB: 16 }, S.vm || {});
    const p = pane();
    p.innerHTML = `<h2>${esc(T('Python 与 Linux 虚拟机', 'Python & Linux VM'))}</h2>
      <div class="sub">${esc(T('AI 可以运行 Python 代码完成计算与编程，也可以在内置的 Linux 虚拟机中像使用自己的电脑一样执行命令。', 'The AI can run Python for computation and programming, and use the built-in Linux VM like its own computer.'))}</div>
      <h3 class="sec-h">${esc(T('Python', 'Python'))}</h3>
      <div class="form-row"><label>${esc(T('运行环境', 'Runtime'))}</label><div class="hint" id="pyinfo">…</div></div>
      <div class="form-row"><label>${esc(T('运行位置', 'Run Python in'))}</label><select id="pyeng">
        <option value="auto" ${pyS.engine === 'auto' ? 'selected' : ''}>${esc(T('自动（虚拟机运行时使用虚拟机，否则使用内置 Python）', 'Auto (the VM when it is running, otherwise built-in Python)'))}</option>
        <option value="local" ${pyS.engine === 'local' ? 'selected' : ''}>${esc(T('内置 Python', 'Built-in Python'))}</option>
        <option value="vm" ${pyS.engine === 'vm' ? 'selected' : ''}>${esc(T('Linux 虚拟机', 'Linux VM'))}</option></select></div>
      <div class="form-row"><label>${esc(T('单次运行时限（秒）', 'Time limit per run (seconds)'))}</label><input type="number" id="pytime" min="5" max="86400" value="${esc(pyS.timeoutSec)}" style="width:120px"/></div>
      <div class="form-row"><label>${esc(T('软件源', 'Package index'))}</label><select id="pyidx">
        <option value="" ${!pyS.index ? 'selected' : ''}>PyPI（pypi.org）</option>
        <option value="https://pypi.tuna.tsinghua.edu.cn/simple" ${/tuna/.test(pyS.index) ? 'selected' : ''}>${esc(T('清华大学镜像', 'Tsinghua mirror'))}</option>
        <option value="https://mirrors.aliyun.com/pypi/simple/" ${/aliyun/.test(pyS.index) ? 'selected' : ''}>${esc(T('阿里云镜像', 'Aliyun mirror'))}</option></select></div>
      <div class="form-row"><label>${esc(T('安装库', 'Install a package'))}</label><div class="inline"><input id="pyname" placeholder="${esc(T('例如 seaborn networkx', 'e.g. seaborn networkx'))}" spellcheck="false" style="flex:1"/><button class="btn-primary" id="pyinst">${esc(T('安装', 'Install'))}</button></div><div id="pyres"></div><pre class="run-out" id="pylog" hidden></pre></div>
      <div class="form-row"><label>${esc(T('已安装的库', 'Installed packages'))}</label><div id="pylist" class="hint">…</div></div>
      <h3 class="sec-h">${esc(T('Linux 虚拟机', 'Linux VM'))}</h3>
      <div class="form-row"><label>${esc(T('状态', 'Status'))}</label><div id="vmstat" class="hint">…</div></div>
      <div class="inline" id="vmbtns"><button class="btn-primary" id="vmstart">${esc(T('启动', 'Start'))}</button><button class="btn-secondary" id="vmstop">${esc(T('关闭', 'Stop'))}</button><button class="btn-secondary" id="vmshare">${esc(T('打开共享文件夹', 'Open shared folder'))}</button><button class="btn-danger" id="vmreset">${esc(T('重置虚拟机', 'Reset VM'))}</button></div><div id="vmres"></div>
      <div class="form-row"><label>${esc(T('内存', 'Memory'))}：<b id="vmmemv">${vmS.memoryMB} MB</b></label><input type="range" id="vmmem" min="1024" max="8192" step="256" value="${vmS.memoryMB}"/></div>
      <div class="form-row"><label>${esc(T('处理器核心', 'CPU cores'))}：<b id="vmcpuv">${vmS.cpus}</b></label><input type="range" id="vmcpu" min="1" max="8" step="1" value="${vmS.cpus}"/></div>
      <div class="form-row"><label>${esc(T('磁盘上限（GB）', 'Disk limit (GB)'))}：<b id="vmdiskv">${vmS.diskGB}</b></label><input type="range" id="vmdisk" min="8" max="128" step="4" value="${vmS.diskGB}"/><div class="hint">${esc(T('内存、核心与磁盘设置在下次启动虚拟机时生效；磁盘只会按需占用实际空间。', 'Memory, cores and disk take effect at the next VM start; the disk only uses space as needed.'))}</div></div>`;
    const $ = (id) => document.getElementById(id);
    $('pyeng').onchange = async (e) => { await window.aib.invoke('settings:patch', { python: { engine: e.target.value } }); toast(); };
    $('pytime').onchange = async (e) => { const v = Math.max(5, Math.min(86400, Number(e.target.value) || 600)); e.target.value = v; await window.aib.invoke('settings:patch', { python: { timeoutSec: v } }); toast(); };
    $('pyidx').onchange = async (e) => { await window.aib.invoke('settings:patch', { python: { index: e.target.value } }); toast(); };
    const loadPy = async () => {
      const i = await window.aib.invoke('py:info');
      $('pyinfo').textContent = (i.bundled ? T('内置 Python ', 'Built-in Python ') : T('系统 Python ', 'System Python ')) + (i.version || '') + ' · ' + i.executable;
      const rows = i.packages || [];
      $('pylist').innerHTML = rows.length ? `<table class="pkg-table"><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.version)}</td><td>${r.location === 'bundled' ? esc(T('内置', 'Built-in')) : `<button class="btn-secondary pkg-rm" data-rm="${esc(r.name)}">${esc(T('卸载', 'Uninstall'))}</button>`}</td></tr>`).join('')}</tbody></table>` : esc(T('暂无', 'None'));
      p.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
        const name = b.dataset.rm;
        const ok = await window.AIBConfirm.ask({ title: T('卸载 Python 库？', 'Uninstall package?'), message: T(`将卸载「${name}」。`, `Uninstall "${name}".`), confirmText: T('确认卸载', 'Uninstall') });
        if (!ok) return; b.disabled = true;
        const r = await window.aib.invoke('py:uninstall', name);
        notice($('pyres'), r.ok ? 'ok' : 'bad', r.ok ? T(`已卸载「${name}」`, `Uninstalled ${name}`) : (r.error || T('卸载失败', 'Uninstall failed')));
        loadPy();
      });
    };
    $('pyinst').onclick = async () => {
      const v = $('pyname').value.trim(); if (!v) return;
      $('pyinst').disabled = true; notice($('pyres'), 'ok', T('正在安装，请稍候…', 'Installing…'), { sticky: true });
      const r = await window.aib.invoke('py:install', v.split(/[\s,]+/));
      $('pyinst').disabled = false;
      $('pylog').hidden = !r.output; $('pylog').textContent = r.output || '';
      notice($('pyres'), r.ok ? 'ok' : 'bad', r.ok ? T('安装完成：', 'Installed: ') + (r.packages || []).join(', ') : (r.error || T('安装失败', 'Install failed')));
      if (r.ok) $('pyname').value = '';
      loadPy();
    };
    const PH = { stopped: T('未运行', 'Stopped'), preparing: T('正在准备…', 'Preparing…'), downloading: T('正在下载镜像…', 'Downloading image…'), booting: T('正在启动…', 'Starting…'), running: T('运行中', 'Running'), stopping: T('正在关闭…', 'Stopping…'), error: T('出错', 'Error') };
    const showVm = (s) => {
      if (!$('vmstat')) return;
      if (!s.supported) { $('vmstat').textContent = T('此设备不支持内置 Linux 虚拟机（需要 Apple Silicon Mac，macOS 12 或更高版本）。', 'The built-in Linux VM needs an Apple Silicon Mac with macOS 12 or later.'); $('vmbtns').querySelectorAll('button').forEach(b => { if (b.id !== 'vmshare') b.disabled = true; }); return; }
      let txt = PH[s.phase] || s.phase;
      if (s.phase === 'downloading' && s.progress && s.progress.total) txt += ` ${Math.round(100 * s.progress.got / s.progress.total)}%（${fmtVmB(s.progress.got)} / ${fmtVmB(s.progress.total)}）`;
      if (s.phase === 'running' && s.info) txt += ` · Linux ${s.info.kernel} · Python ${s.info.python}` + (s.info.ip ? ` · IP ${s.info.ip}` : '');
      txt += ' · ' + T('磁盘占用 ', 'Disk used ') + (s.diskBytes ? fmtVmB(s.diskBytes) : T('尚未下载镜像（首次启动约需下载 228 MB）', 'image not downloaded yet (about 228 MB on first start)'));
      if (s.error) txt += '\n' + T('原因：', 'Reason: ') + s.error;
      $('vmstat').textContent = txt; $('vmstat').style.whiteSpace = 'pre-wrap';
      const busy = ['preparing', 'downloading', 'booting', 'stopping'].includes(s.phase);
      $('vmstart').disabled = busy || s.phase === 'running'; $('vmstop').disabled = busy || s.phase !== 'running'; $('vmreset').disabled = busy;
    };
    showVm(await window.aib.invoke('vm:status'));
    if (vmOff) vmOff(); vmOff = window.aib.on('vm:state', (s) => { if (cur === 'python') showVm(s); });
    $('vmstart').onclick = async () => { $('vmstart').disabled = true; const r = await window.aib.invoke('vm:start'); showVm(r.status); notice($('vmres'), r.ok ? 'ok' : 'bad', r.ok ? T('Linux 虚拟机已就绪', 'The Linux VM is ready') : (r.error || T('启动失败', 'Failed to start'))); };
    $('vmstop').onclick = async () => { const r = await window.aib.invoke('vm:stop'); showVm(r.status); notice($('vmres'), 'ok', T('Linux 虚拟机已关闭', 'The Linux VM has stopped')); };
    $('vmreset').onclick = async () => { const r = await window.aib.invoke('vm:reset'); if (r.declined) return; showVm(r.status); notice($('vmres'), 'ok', T('虚拟机已重置', 'The VM has been reset')); };
    $('vmshare').onclick = () => window.aib.invoke('vm:openShare');
    const slider = (id, lab, key, unit) => { const el = $(id); el.oninput = () => { $(lab).textContent = el.value + (unit || ''); }; el.onchange = async () => { await window.aib.invoke('settings:patch', { vm: { [key]: Number(el.value) } }); toast(); }; };
    slider('vmmem', 'vmmemv', 'memoryMB', ' MB'); slider('vmcpu', 'vmcpuv', 'cpus'); slider('vmdisk', 'vmdiskv', 'diskGB');
    loadPy();
  }

  function renderPane() { leaveEmbed(); ({ python: renderPython, ai: renderAI, search: renderSearch, dict: renderDict, kb: renderKb, ext: renderExt, history: renderHistory, passwords: renderPasswords, general: renderGeneral, privacy: renderPrivacy }[cur] || renderAI)(); }
  window.addEventListener('hashchange', () => { const n = fromHash(); if (n === cur) return; cur = n; shell(); renderPane(); });
  document.title = t('settings.title');
  shell(); renderPane();
  I18N.onChange(() => { document.title = t('settings.title'); shell(); renderPane(); });
  window.aib.on('settings:changed', (s) => { S = s; });
})();
