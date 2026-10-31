(async function () {
  let S = await I18N.init();
  const STEPS = ['lang', 'name', 'ai', 'search', 'dict', 'done'];
  let i = 0;
  let draft = {
    lang: S.lang || 'zh',
    displayName: S.displayName || 'Felix',
    aiSource: (S.ai && S.ai.source) || 'api',
    api: Object.assign({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' }, (S.ai && S.ai.api) || {}),
    searchEngine: (S.search && S.search.engine) || 'bing',
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function paintDots() {
    $('dots').innerHTML = STEPS.map((_, n) => `<span class="${n === i ? 'on' : (n < i ? 'done' : '')}"></span>`).join('');
  }

  async function finish(skipped) {
    await window.aib.invoke('settings:patch', {
      lang: draft.lang,
      displayName: draft.displayName,
      search: { engine: draft.searchEngine },
      ai: { source: draft.aiSource, api: { baseUrl: draft.api.baseUrl, model: draft.api.model, ...(draft.api.apiKey ? { apiKey: draft.api.apiKey } : {}) } },
      onboarding: { completed: true, skipped: !!skipped, completedAt: Date.now() }
    });
    I18N.setLang(draft.lang);
    // go home
    location.href = 'aibrowser://home';
  }

  function render() {
    paintDots();
    const step = STEPS[i];
    $('btnBack').style.visibility = i === 0 ? 'hidden' : 'visible';
    $('btnBack').textContent = t('onboard.back');
    $('btnSkip').textContent = t('onboard.skip');
    $('btnNext').textContent = step === 'done' ? t('onboard.finish') : t('onboard.next');

    if (step === 'lang') {
      $('title').textContent = t('onboard.lang.title');
      $('sub').textContent = t('onboard.lang.sub');
      $('body').innerHTML = `<div class="mode-seg" id="langseg">
        <div class="seg ${draft.lang==='zh'?'active':''}" data-l="zh">中文</div>
        <div class="seg ${draft.lang==='en'?'active':''}" data-l="en">English</div>
      </div>`;
      $('langseg').querySelectorAll('[data-l]').forEach(el => el.onclick = () => {
        draft.lang = el.dataset.l; I18N.setLang(draft.lang); render();
      });
    } else if (step === 'name') {
      $('title').textContent = t('onboard.name.title');
      $('sub').textContent = t('onboard.name.sub');
      $('body').innerHTML = `<div class="form-row"><label>${esc(t('general.name'))}</label>
        <input id="dname" maxlength="40" value="${esc(draft.displayName)}"/>
        <div class="hint">${esc(t('general.nameHint'))}</div></div>`;
      $('dname').oninput = (e) => { draft.displayName = e.target.value; };
    } else if (step === 'ai') {
      $('title').textContent = t('onboard.ai.title');
      $('sub').textContent = t('onboard.ai.sub');
      $('body').innerHTML = `<div class="mode-seg" id="aisrc">
          <div class="seg ${draft.aiSource==='api'?'active':''}" data-s="api">${esc(t('ai.src.api'))}</div>
          <div class="seg ${draft.aiSource==='local'?'active':''}" data-s="local">${esc(t('ai.src.local'))}</div>
        </div>
        <div id="aibody" style="margin-top:14px"></div>`;
      const paintAi = () => {
        if (draft.aiSource === 'local') {
          $('aibody').innerHTML = `<p class="hint">${esc(t('onboard.ai.localHint'))}</p>`;
        } else {
          $('aibody').innerHTML =
            `<div class="form-row"><label>Base URL</label><input id="baseUrl" value="${esc(draft.api.baseUrl||'')}"/></div>` +
            `<div class="form-row"><label>API Key</label><input id="apiKey" type="password" autocomplete="new-password" placeholder="${esc(t('onboard.ai.keyPh'))}"/></div>` +
            `<div class="form-row"><label>${esc(t('ai.api.model'))}</label><input id="model" value="${esc(draft.api.model||'')}"/></div>`;
          ['baseUrl','apiKey','model'].forEach(id => { const el=$(id); if(!el) return; el.oninput = () => { draft.api[id === 'baseUrl' ? 'baseUrl' : id === 'apiKey' ? 'apiKey' : 'model'] = el.value; }; });
        }
      };
      $('aisrc').querySelectorAll('[data-s]').forEach(el => el.onclick = () => { draft.aiSource = el.dataset.s; render(); });
      paintAi();
    } else if (step === 'search') {
      $('title').textContent = t('onboard.search.title');
      $('sub').textContent = t('onboard.search.sub');
      const engines = [['bing','Bing'],['baidu','百度 Baidu'],['google','Google'],['duckduckgo','DuckDuckGo']];
      $('body').innerHTML = `<div class="form-row"><label>${esc(t('settings.nav.search'))}</label>
        <select id="eng">${engines.map(([v,l]) => `<option value="${v}" ${draft.searchEngine===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
      $('eng').onchange = (e) => { draft.searchEngine = e.target.value; };
    } else if (step === 'dict') {
      $('title').textContent = t('onboard.dict.title');
      $('sub').textContent = t('onboard.dict.sub');
      $('body').innerHTML = `<p class="hint">${esc(t('onboard.dict.hint'))}</p>
        <div class="actions" style="margin-top:12px"><button type="button" class="btn-secondary" id="openDict">${esc(t('onboard.dict.open'))}</button></div>`;
      $('openDict').onclick = async () => {
        await window.aib.invoke('settings:patch', { onboarding: { completed: false } }); // keep incomplete until finish
        location.href = 'aibrowser://settings#dict';
      };
    } else {
      $('title').textContent = t('onboard.done.title');
      $('sub').textContent = t('onboard.done.sub', { name: draft.displayName || 'Felix' });
      $('body').innerHTML = `<div class="done-icon">✓</div><p class="hint">${esc(t('onboard.done.hint'))}</p>`;
    }
  }

  $('btnNext').onclick = async () => {
    if (STEPS[i] === 'done') return finish(false);
    i = Math.min(STEPS.length - 1, i + 1); render();
  };
  $('btnBack').onclick = () => { i = Math.max(0, i - 1); render(); };
  $('btnSkip').onclick = () => finish(true);

  render();
})();
