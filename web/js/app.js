import { t, setLang, getLang, applyI18n } from './i18n.js';
import { load as loadSettings, save as saveSettings, engines } from './settings.js';
import { testConnection, cleanKey, cleanText, cleanBase } from './api.js';
import { toast, wireDesktopOnly } from './desktop-disabled.js';
import { mount as mountPanels, show as showPanel, closeOverlay } from './panels.js';
import { handleAsk } from './chat.js';
import { addText as kbAdd, list as kbList, search as kbSearch, clear as kbClear, enableVector, disableVector } from './kb.js';
import { CATALOG, detectWebGPU, loadModel, unload as unloadModel, getProgress, isReady, memoryWarning, listCachedModels, reasonText, isPhone, pauseLoad, getDownloadStatus, statusText, diskReport, clearModelCache, deleteModelFiles, fmtMB } from './local-model.js';
import { confirmDialog, doneBanner } from './confirm.js';
import { callTool, listTools } from './agent-tools.js';

let settings = loadSettings();
let abort = null;

function greetText(){
  const name = settings.displayName || 'Felix';
  const g = settings.greeting || t('greetingDefault');
  return g.replaceAll('{name}', name);
}

function renderChrome(){
  applyI18n();
  document.getElementById('greet').textContent = greetText();
  document.title = t('appName');
  wireDesktopOnly();
}

function fillLocalSelect(){
  const sel = document.getElementById('localModel');
  sel.innerHTML = CATALOG.map(m => `<option value="${m.id}">${m.label} · ~${(m.vramMB/1024).toFixed(1)} GB</option>`).join('');
  sel.value = settings.local.modelId || CATALOG[0].id;
  updateLocalWarn();
}

function updateLocalWarn(){
  const el = document.getElementById('localWarn'); if (!el) return;
  const w = memoryWarning(document.getElementById('localModel').value);
  if (!w) { el.style.display = 'none'; el.textContent = ''; return; }
  el.style.display = '';
  el.textContent = (getLang() === 'zh' ? w.zh : w.en);
}

async function refreshCacheHint(){
  const el = document.getElementById('localCache'); if (!el) return;
  const cached = await listCachedModels();
  el.textContent = cached.length ? (t('localCached') + ': ' + cached.map(c => c.label).join(', ')) : '';
  refreshDisk();
}

// storage: per-model "model files" vs "cache" (unfinished shards), storage estimate, clear cache / delete with confirmation
async function refreshDisk(){
  const box = document.getElementById('localDisk'); if (!box) return;
  let r; try { r = await diskReport(); } catch { return; }
  const est = r.estimate ? `${t('diskEstimate')}: ${fmtMB(r.estimate.usage)} / ${fmtMB(r.estimate.quota)}` : '';
  const esc = (x) => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  box.innerHTML = `<div class="hint"><b>${t('diskTitle')}</b> · <span id="diskEst">${esc(est)}</span></div>` + (r.models.length ? r.models.map(m => `<div class="mrow" data-disk="${esc(m.id)}"><span class="nm">${esc(m.label)}<br><span class="hint">${t('diskFiles')} ${fmtMB(m.filesBytes)} · ${t('diskCache')} ${fmtMB(m.cacheBytes)}</span></span>
      <button type="button" data-dact="cc" ${m.cacheBytes ? '' : 'disabled'}>${t('diskClearCache')}</button><button type="button" data-dact="del">${t('diskDelete')}</button></div>`).join('') : `<div class="hint">${t('diskEmpty')}</div>`);
  box.querySelectorAll('.mrow').forEach(row => {
    const id = row.dataset.disk; const m = r.models.find(x => x.id === id);
    row.querySelector('[data-dact="cc"]').onclick = async () => {
      const ok = await confirmDialog({ title: getLang()==='zh'?'清理缓存？':'Clear cache?', message: getLang()==='zh' ? `将清理「${m.label}」未完成下载的分片，释放约 ${fmtMB(m.cacheBytes)}。` : `Clear the unfinished shards of "${m.label}", freeing about ${fmtMB(m.cacheBytes)}.`, confirmText: getLang()==='zh'?'确认清理':'Confirm clear' });
      if (!ok) return; const d = await clearModelCache(id); doneBanner((getLang()==='zh'?'已释放 ':'Freed ') + fmtMB(d.freed)); refreshDisk();
    };
    row.querySelector('[data-dact="del"]').onclick = async () => {
      const ok = await confirmDialog({ title: getLang()==='zh'?'删除模型？':'Delete model?', message: getLang()==='zh' ? `将从浏览器存储中删除「${m.label}」，释放约 ${fmtMB(m.filesBytes + m.cacheBytes)}，之后需要重新下载。` : `Delete "${m.label}" from browser storage, freeing about ${fmtMB(m.filesBytes + m.cacheBytes)}. You must download it again.`, detail: getLang()==='zh'?'此操作无法撤销。':'This cannot be undone.', confirmText: getLang()==='zh'?'确认删除':'Confirm delete' });
      if (!ok) return; const d = await deleteModelFiles(id); doneBanner((getLang()==='zh'?'已释放 ':'Freed ') + fmtMB(d.freed));
      if (d.needsKb) toast(getLang()==='zh' ? '知识库向量搜索需要 EmbeddingGemma，可在设置里重新启用。' : 'Vector KB search needs EmbeddingGemma; re-enable it in Settings.');
      refreshDisk(); refreshCacheHint();
    };
  });
}

async function refreshWebGPUBadge(){
  const b = document.getElementById('webgpuBadge');
  const d = await detectWebGPU();
  b.textContent = d.ok ? t('webgpuOk') : t('webgpuNo');
  b.style.color = d.ok ? 'var(--accent)' : 'var(--danger)';
  const eng = document.getElementById('engKind');
  const localOpt = eng.querySelector('option[value="local"]');
  const loadBtn = document.getElementById('btnLoadLocal');
  const modelSel = document.getElementById('localModel');
  const reasonEl = document.getElementById('webgpuReason');
  if (!d.ok) {
    localOpt.disabled = true;
    if (eng.value === 'local') eng.value = 'api';
    if (loadBtn) loadBtn.disabled = true;
    if (modelSel) modelSel.disabled = true;
    const msg = t('webgpuDisabled') + ' ' + reasonText(d.reason);
    if (reasonEl) { reasonEl.style.display = ''; reasonEl.textContent = msg; }
    const warn = document.getElementById('localWarn');
    if (warn) { warn.style.display = ''; warn.textContent = msg; }
  } else {
    localOpt.disabled = false;
    if (loadBtn) loadBtn.disabled = false;
    if (modelSel) modelSel.disabled = false;
    if (reasonEl) { reasonEl.style.display = 'none'; reasonEl.textContent = ''; }
  }
  return d;
}

function syncEngineUI(){
  const kind = document.getElementById('engKind').value;
  document.getElementById('localBlock').style.display = kind === 'local' ? '' : 'none';
  document.getElementById('apiBase').closest('.form-row').style.display = kind === 'api' ? '' : 'none';
  document.getElementById('apiKey').closest('.form-row').style.display = kind === 'api' ? '' : 'none';
  document.getElementById('apiModel').closest('.form-row').style.display = kind === 'api' ? '' : 'none';
  if (kind === 'local') { updateLocalWarn(); refreshCacheHint(); }
}

function openSettings(focusLocal){
  const s = document.getElementById('settings');
  document.getElementById('dname').value = settings.displayName||'';
  document.getElementById('greeting').value = settings.greeting||'';
  document.getElementById('lang').value = getLang();
  const ast = document.getElementById('astyle'); if (ast) ast.value = settings.answerStyle || 'detailed';
  const th = document.getElementById('think'); if (th) th.value = settings.thinkingLevel || 'medium';
  if (window.__paintThemes) window.__paintThemes();
  fillProviders();
  document.getElementById('apiBase').value = settings.api.baseUrl||'';
  document.getElementById('apiKey').value = settings.api.apiKey||'';
  document.getElementById('apiModel').value = settings.api.model||'';
  document.getElementById('engine').value = settings.search.engine||'baidu';
  document.getElementById('customEng').value = settings.search.custom||'';
  document.getElementById('engKind').value = settings.engine||'api';
  document.getElementById('kbEmbed').value = settings.kb.embed||'text';
  fillLocalSelect();
  refreshWebGPUBadge().then(()=>syncEngineUI());
  syncEngineUI();
  s.classList.add('open');
  if (focusLocal) {
    document.getElementById('engKind').value = 'local';
    syncEngineUI();
  }
}
function closeSettings(){ document.getElementById('settings').classList.remove('open'); }

function collectSettings(){
  settings.displayName = document.getElementById('dname').value.trim() || 'Felix';
  settings.greeting = document.getElementById('greeting').value;
  const lang = document.getElementById('lang').value;
  setLang(lang); settings.lang = lang;
  const ast = document.getElementById('astyle'); if (ast) settings.answerStyle = ast.value;
  const thk = document.getElementById('think'); if (thk) settings.thinkingLevel = thk.value;
  if (window.AIB36) { document.documentElement.dataset.theme = settings.theme || 'aurora'; document.documentElement.style.cssText += window.AIB36.themeCss(settings.theme || 'aurora'); }
  settings.engine = document.getElementById('engKind').value;
  settings.api.preset = document.getElementById('apiPreset').value || 'custom';
  settings.api.baseUrl = cleanBase(document.getElementById('apiBase').value);
  settings.api.apiKey = cleanKey(document.getElementById('apiKey').value);
  settings.api.model = cleanText(document.getElementById('apiModel').value);
  settings.local.modelId = document.getElementById('localModel').value;
  settings.search.engine = document.getElementById('engine').value;
  settings.search.custom = document.getElementById('customEng').value.trim();
  settings.kb.embed = document.getElementById('kbEmbed').value;
  // reflect the cleaned values back so what is shown is what is used
  document.getElementById('apiBase').value = settings.api.baseUrl;
  document.getElementById('apiKey').value = settings.api.apiKey;
  document.getElementById('apiModel').value = settings.api.model;
  return settings;
}
async function doSaveSettings(){
  collectSettings();
  if (settings.kb.embed === 'vector') {
    try { await enableVector((p)=> { document.getElementById('localProg').textContent = (p||{}).status || t('localProgress'); }); }
    catch(e){ toast(String(e.message||e).slice(0,160)); settings.kb.embed = 'text'; document.getElementById('kbEmbed').value='text'; }
  } else { await disableVector(); }
  saveSettings(settings);
  renderChrome();
  toast(t('saved'));
  closeSettings();
}

function setMode(mode){
  document.querySelectorAll('#modeseg .seg').forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));
  document.getElementById('askrow').style.display = mode==='chat'?'':'none';
}

function doSearch(q){
  const eng = engines();
  const e = settings.search.engine||'baidu';
  const url = e==='custom' ? eng.custom(q, settings.search.custom) : (eng[e]||eng.baidu)(q);
  if (!url) return toast('No search URL');
  window.open(url, '_blank', 'noopener,noreferrer');
}

function wireVisualViewport(){
  const vv = window.visualViewport; if (!vv) return;
  const apply = ()=>{
    const gap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', gap+'px');
    document.getElementById('app').style.paddingBottom = gap ? gap+'px' : '';
  };
  vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); apply();
}

function fillProviders(){
  const sel = document.getElementById('apiPreset');
  const A = window.AIB36;
  if (!sel || !A) return;
  sel.innerHTML = Object.entries(A.API_PROVIDERS).map(([id, p]) => `<option value="${id}">${p.name}</option>`).join('');
  sel.value = (settings.api && settings.api.preset) || 'deepseek';
  if (!A.API_PROVIDERS[sel.value]) sel.value = 'custom';
}
function wire(){
  document.getElementById('btnSettings').onclick = ()=>openSettings(false);
  document.getElementById('btnLocal').onclick = ()=>openSettings(true);
  document.getElementById('btnCloseSettings').onclick = closeSettings;
  document.getElementById('btnSave').onclick = doSaveSettings;
  document.getElementById('btnShowKey').onclick = ()=>{ const k=document.getElementById('apiKey'); k.type = k.type==='password'?'text':'password'; };
  document.getElementById('engKind').onchange = syncEngineUI;
  const preset = document.getElementById('apiPreset');
  if (preset) preset.onchange = () => {
    const p = window.AIB36 && window.AIB36.providerById(preset.value);
    if (!p || preset.value === 'custom') return;
    document.getElementById('apiBase').value = p.baseUrl;
    document.getElementById('apiModel').value = p.model;
  };
  document.getElementById('localModel').onchange = updateLocalWarn;
  const setLoadUI = (st) => { // st: idle | loading | paused
    document.getElementById('btnPauseLocal').style.display = st === 'loading' ? '' : 'none';
    document.getElementById('btnResumeLocal').style.display = st === 'paused' ? '' : 'none';
    document.getElementById('btnLoadLocal').disabled = st === 'loading';
  };
  const doLoad = async ()=>{
    const id = document.getElementById('localModel').value;
    const prog = document.getElementById('localProg');
    const w = memoryWarning(id);
    if (w && w.level === 'high' && !confirm((getLang()==='zh'?w.zh:w.en) + '\n\nContinue? 继续？')) return;
    prog.textContent = t('localProgress'); setLoadUI('loading');
    try {
      await loadModel(id, (p)=>{ const pct=Math.round((p.progress||0)*100); prog.textContent = p.dl ? `${pct}% · ${p.text}` : `${pct}% ${p.text||''}`; prog.setAttribute('aria-valuenow', pct); });
      settings.engine = 'local'; settings.local.modelId = id; saveSettings(settings);
      document.getElementById('engKind').value = 'local'; syncEngineUI();
      toast('OK'); setLoadUI('idle');
      prog.textContent = id;
      refreshCacheHint();
    } catch(e){
      if (e && e.paused) { setLoadUI('paused'); const st = getDownloadStatus(); prog.textContent = st ? statusText(st) : ''; refreshCacheHint(); return; }
      setLoadUI('idle'); const st = getDownloadStatus();
      prog.textContent = st && st.state === 'error' ? statusText(st) : ''; toast(String(e.message||e).slice(0,200)); refreshCacheHint();
    }
  };
  document.getElementById('btnLoadLocal').onclick = doLoad;
  document.getElementById('btnResumeLocal').onclick = doLoad;
  document.getElementById('btnPauseLocal').onclick = () => { pauseLoad(); };
  document.getElementById('btnUnloadLocal').onclick = async ()=>{
    await unloadModel(); document.getElementById('localProg').textContent = ''; toast(t('localUnload'));
  };
  document.getElementById('btnTest').onclick = async ()=>{
    collectSettings(); saveSettings(settings); // test exactly what is in the form, and keep it
    try { const r = await testConnection(settings.api); toast('OK: '+(r||'').slice(0,40)); }
    catch(e){ toast(String(e.message||e).slice(0,160)); }
  };
  document.querySelectorAll('#modeseg .seg').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  document.getElementById('btnSend').onclick = async ()=>{
    const q = document.getElementById('q').value;
    if (document.querySelector('#modeseg .seg.active')?.dataset.mode==='search') return doSearch(q);
    if (abort) abort.abort(); abort = new AbortController();
    await handleAsk({ q, settings, signal:abort.signal, els:{
      status:document.getElementById('status'),
      answer:document.getElementById('answer'),
      tools:document.getElementById('tools'),
    }});
  };
  document.getElementById('q').addEventListener('keydown', ev=>{ if(ev.key==='Enter'&&!ev.shiftKey){ ev.preventDefault(); document.getElementById('btnSend').click(); }});
  document.getElementById('btnClosePanel').onclick = closeOverlay;
  document.getElementById('ptGgb').onclick = ()=>showPanel('ggb');
  document.getElementById('ptPhys').onclick = ()=>showPanel('phys');
  const jump = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); };
  const bSolve = document.getElementById('btnSolve'); if (bSolve) bSolve.onclick = () => jump('solvebox');
  const bWiki = document.getElementById('btnWiki'); if (bWiki) bWiki.onclick = () => jump('wikibox');
  document.getElementById('btnGgb').onclick = ()=>showPanel('ggb');
  document.getElementById('btnPhys').onclick = ()=>showPanel('phys');
  const A = window.AIB36;
  const tools = document.getElementById('hometools');
  if (tools && A) tools.innerHTML = [['geogebra','G'],['physics','物'],['solve','题'],['wiki','维'],['dict','词']].map(([id,ic])=>`<button type="button" class="ticon" data-tool="${id}">${ic}</button>`).join('');
  tools && tools.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]'); if (!b) return;
    const id = b.dataset.tool;
    if (id === 'geogebra') showPanel('ggb');
    else if (id === 'physics') showPanel('phys');
    else document.getElementById(id === 'solve' ? 'solvebox' : id === 'wiki' ? 'wikibox' : 'solvebox').scrollIntoView({behavior:'smooth'});
  });
  const refs = [];
  const refAdd = document.getElementById('refAdd');
  if (refAdd) refAdd.onclick = () => { refs.push({ title: document.getElementById('refTitle').value, text: document.getElementById('refBody').value }); document.getElementById('refList').textContent = '参考资料 ' + refs.length; };
  const solvePhone = document.getElementById('solvePhone');
  if (solvePhone) solvePhone.onclick = () => {
    const url = A.PUBLIC_SOLVER;
    document.getElementById('solveQr').innerHTML = A.qrSvg(url) + `<p>${url}</p><p>在手机上打开后可以直接拍照解题。网页版不能把照片回传到这台电脑。</p>`;
  };
  const solveGo = document.getElementById('solveGo');
  if (solveGo) solveGo.onclick = async () => {
    const q = document.getElementById('solveText').value.trim();
    const ctx = A.solverContext({ refs, turns: [] });
    if (abort) abort.abort(); abort = new AbortController();
    await handleAsk({ q: (ctx ? ctx + '\n' : '') + q, settings, signal: abort.signal, els: { status: document.getElementById('status'), answer: document.getElementById('answer'), tools: document.getElementById('tools') } });
  };
  const wikiQ = document.getElementById('wikiQ');
  if (wikiQ) wikiQ.oninput = () => {
    const hits = A.wikiSearch(A.WIKI_SEED, wikiQ.value);
    document.getElementById('wikiHits').innerHTML = hits.map(h => `<article><b>${h.title}</b><p>${h.text}</p></article>`).join('');
  };
  function paintThemes(){
    const grid = document.getElementById('themeGrid'); if (!grid || !A) return;
    grid.innerHTML = Object.values(A.THEMES).map(th => `<button type="button" class="theme-combo ${settings.theme===th.id?'on':''}" data-theme="${th.id}"><b>${th.zh}</b><span class="swatches">${Object.values(th.colors).map(c=>`<i style="background:${c}"></i>`).join('')}</span></button>`).join('');
    grid.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => { settings.theme = b.dataset.theme; applyTheme(settings.theme); saveSettings(settings); paintThemes(); });
  }
  function applyTheme(id){
    if (!A) return;
    document.documentElement.dataset.theme = id;
    document.documentElement.style.cssText += A.themeCss(id);
  }
  window.__paintThemes = paintThemes;
  applyTheme(settings.theme || 'aurora');
  document.getElementById('kbAdd').onclick = async ()=>{
    const t0 = document.getElementById('kbText').value.trim(); if(!t0) return;
    await kbAdd(t0, 'note'); document.getElementById('kbText').value=''; toast(t('saved')); refreshKb();
  };
  document.getElementById('kbClear').onclick = async ()=>{
    const n = (await kbList()).length;
    if (!n) { doneBanner(t('cleared').replace('{n}', 0)); return; }
    const ok = await confirmDialog({ title: t('kbClearTitle'), message: t('kbClearMsg').replace('{n}', n), detail: getLang()==='zh'?'此操作无法撤销。':'This cannot be undone.', confirmText: getLang()==='zh'?'确认清除':'Confirm clear' });
    if (!ok) return;
    await kbClear(); refreshKb(); doneBanner(t('cleared').replace('{n}', n));
  };
  document.getElementById('kbQuery').oninput = async (ev)=>{
    const hits = await kbSearch(ev.target.value); renderKb(hits);
  };
}

async function refreshKb(){ renderKb(await kbList()); }
function renderKb(items){
  const el = document.getElementById('kbList');
  if (!items.length){ el.textContent = t('kbEmpty'); return; }
  el.innerHTML = items.map(d=>`<div class="chip" title="${(d.text||'').slice(0,200)}">${(d.title||'note')} · ${(d.text||'').slice(0,40)}</div>`).join('');
}

setLang(settings.lang||getLang());
renderChrome();
mountPanels(document.getElementById('plotcanvas'));
wire();
wireVisualViewport();
wireDesktopOnly();
refreshKb();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
window.__AIB_TOOLS__ = { listTools, callTool };
if (window.VKeyboard) {
  const vk = VKeyboard.mount(document.getElementById('vkhost'), { getTarget: () => document.getElementById('q'), collapsed: true });
  window.__AIB_VK__ = vk;
  window.__AIB_TOOLS__.vkeyboard_toggle = (a) => { const act=(a&&a.action)||'toggle'; if(act==='show') vk.setCollapsed(false); else if(act==='hide') vk.setCollapsed(true); else vk.setCollapsed(!vk.isCollapsed()); return {ok:true}; };
  window.__AIB_TOOLS__.vkeyboard_insert = (a) => { vk.setCollapsed(false); if(a&&a.tab) vk.setTab(a.tab); vk.insert(String(a&&a.text||'')); return {ok:true}; };
  window.__AIB_TOOLS__.vkeyboard_catalog = () => VKeyboard.catalog();
}
