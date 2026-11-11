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
import * as MW from './models-web.js';

let settings = loadSettings();
try { MW.migrate(settings); saveSettings(settings); } catch {}
let abort = null;

const esc = (x) => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function greetText(){
  const name = settings.displayName || 'Felix';
  const g = settings.greeting || t('greetingDefault');
  return g.replaceAll('{name}', name);
}

function renderChrome(){
  applyI18n();
  const greetEl = document.getElementById('greet');
  if (greetEl) greetEl.textContent = greetText();
  document.title = t('appName');
  wireDesktopOnly();
}

function fillLocalSelect(){
  const sel = document.getElementById('localModel');
  if (!sel) return;
  sel.innerHTML = CATALOG.map(m => `<option value="${esc(m.id)}">${esc(m.label)} · ~${(m.vramMB/1024).toFixed(1)} GB</option>`).join('');
  sel.value = settings.local.modelId || CATALOG[0].id;
  updateLocalWarn();
}

function updateLocalWarn(){
  const el = document.getElementById('localWarn'); if (!el) return;
  const sel = document.getElementById('localModel'); if (!sel) return;
  const w = memoryWarning(sel.value);
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
  box.innerHTML = `<div class="hint"><b>${esc(t('diskTitle'))}</b> · <span id="diskEst">${esc(est)}</span></div>` + (r.models.length ? r.models.map(m => `<div class="mrow" data-disk="${esc(m.id)}"><span class="nm">${esc(m.label)}<br><span class="hint">${esc(t('diskFiles'))} ${fmtMB(m.filesBytes)} · ${esc(t('diskCache'))} ${fmtMB(m.cacheBytes)}</span></span>
      <button type="button" data-dact="cc" ${m.cacheBytes ? '' : 'disabled'}>${esc(t('diskClearCache'))}</button><button type="button" data-dact="del">${esc(t('diskDelete'))}</button></div>`).join('') : `<div class="hint">${esc(t('diskEmpty'))}</div>`);
  box.querySelectorAll('.mrow').forEach(row => {
    const id = row.dataset.disk; const m = r.models.find(x => x.id === id);
    if (!m) return;
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
  if (b) {
    b.textContent = d.ok ? t('webgpuOk') : t('webgpuNo');
    b.style.color = d.ok ? 'var(--accent)' : 'var(--danger)';
  }
  const eng = document.getElementById('engKind');
  const localOpt = eng && eng.querySelector('option[value="local"]');
  const loadBtn = document.getElementById('btnLoadLocal');
  const modelSel = document.getElementById('localModel');
  const reasonEl = document.getElementById('webgpuReason');
  if (!d.ok) {
    if (localOpt) localOpt.disabled = true;
    if (eng && eng.value === 'local') eng.value = 'api';
    if (loadBtn) loadBtn.disabled = true;
    if (modelSel) modelSel.disabled = true;
    const msg = t('webgpuDisabled') + ' ' + reasonText(d.reason);
    if (reasonEl) { reasonEl.style.display = ''; reasonEl.textContent = msg; }
    const warn = document.getElementById('localWarn');
    if (warn) { warn.style.display = ''; warn.textContent = msg; }
  } else {
    if (localOpt) localOpt.disabled = false;
    if (loadBtn) loadBtn.disabled = false;
    if (modelSel) modelSel.disabled = false;
    if (reasonEl) { reasonEl.style.display = 'none'; reasonEl.textContent = ''; }
  }
  return d;
}

function syncEngineUI(){
  const eng = document.getElementById('engKind'); if (!eng) return;
  const kind = eng.value;
  const lb = document.getElementById('localBlock');
  if (lb) lb.style.display = kind === 'local' ? '' : 'none';
  ['apiBase', 'apiKey', 'apiModel'].forEach(id => {
    const el = document.getElementById(id);
    const row = el && el.closest('.form-row');
    if (row) row.style.display = kind === 'api' ? '' : 'none';
  });
  if (kind === 'local') { updateLocalWarn(); refreshCacheHint(); }
}

function applyTheme(id){
  const A = window.AIB36;
  const themeId = id || 'aurora';
  document.documentElement.dataset.theme = themeId;
  if (!A || typeof A.themeCss !== 'function') return;
  let styleEl = document.getElementById('aib-theme-vars');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'aib-theme-vars';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `:root { ${A.themeCss(themeId)} }`;
}

function openSettings(focusLocal){
  const s = document.getElementById('settings'); if (!s) return;
  document.getElementById('dname').value = settings.displayName||'';
  document.getElementById('greeting').value = settings.greeting||'';
  document.getElementById('lang').value = getLang();
  const ast = document.getElementById('astyle'); if (ast) ast.value = settings.answerStyle || 'detailed';
  const th = document.getElementById('think'); if (th) th.value = settings.thinkingLevel || 'medium';
  if (window.__paintThemes) window.__paintThemes();
  fillProviders();
  paintProvModels({ auto: true });
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
function closeSettings(){
  const s = document.getElementById('settings');
  if (s) s.classList.remove('open');
}

function collectSettings(){
  settings.displayName = document.getElementById('dname').value.trim() || 'Felix';
  settings.greeting = document.getElementById('greeting').value;
  const lang = document.getElementById('lang').value;
  setLang(lang); settings.lang = lang;
  const ast = document.getElementById('astyle'); if (ast) settings.answerStyle = ast.value;
  const thk = document.getElementById('think'); if (thk) settings.thinkingLevel = thk.value;
  applyTheme(settings.theme || 'aurora');
  settings.engine = document.getElementById('engKind').value;
  const presetEl = document.getElementById('apiPreset');
  if (presetEl) settings.api.preset = presetEl.value || 'custom';
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
  const sync = MW.syncFromApi(settings);
  saveSettings(settings);
  renderChrome();
  toast(t('saved'));
  closeSettings();
  refreshPickers();
  // provider saved / key changed: fetch its model list in the background
  if (sync.needsFetch) MW.refresh(settings, sync.pid).then(() => { saveSettings(settings); refreshPickers(); }).catch(() => {});
}
// ---- model lists (settings sheet) + model switchers next to the inputs
const pickers = [];
function refreshPickers(){ pickers.forEach(p => p.refresh()); }
function formValues(){
  return { baseUrl: cleanBase(document.getElementById('apiBase').value), apiKey: cleanKey(document.getElementById('apiKey').value) };
}
function paintProvModels(o){
  const box = document.getElementById('provModels'); const sel = document.getElementById('apiPreset');
  if (!box || !sel) return;
  MW.renderList(box, settings, sel.value || 'custom', { ...(o || {}), formValues, save: () => saveSettings(settings), onChange: refreshPickers });
}
function mountPickers(){
  if (!window.AIBModelPicker) return;
  for (const id of ['askModel', 'solveModel']) {
    const host = document.getElementById(id); if (!host) continue;
    pickers.push(window.AIBModelPicker.mount(host, {
      lang: () => getLang(),
      load: () => MW.pickerData(settings),
      select: async (ref) => { MW.select(settings, ref); saveSettings(settings); setTimeout(refreshPickers, 0); return MW.pickerData(settings); },
      onManage: () => openSettings(false)
    }));
  }
  window.__AIB_MP__ = pickers[0];
}

function setMode(mode){
  document.querySelectorAll('#modeseg .seg').forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));
  const askrow = document.getElementById('askrow');
  if (askrow) askrow.style.display = mode==='chat'?'':'none';
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
    const appEl = document.getElementById('app');
    if (appEl) appEl.style.paddingBottom = gap ? gap+'px' : '';
  };
  vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); apply();
}

function fillProviders(){
  const sel = document.getElementById('apiPreset');
  const A = window.AIB36;
  if (!sel || !A) return;
  sel.innerHTML = Object.entries(A.API_PROVIDERS).map(([id, p]) => `<option value="${esc(id)}">${esc(p.name)}</option>`).join('');
  sel.value = (settings.api && settings.api.preset) || 'deepseek';
  if (!A.API_PROVIDERS[sel.value]) sel.value = 'custom';
}
function wire(){
  const bindClick = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bindClick('btnSettings', ()=>openSettings(false));
  bindClick('btnLocal', ()=>openSettings(true));
  bindClick('btnCloseSettings', closeSettings);
  bindClick('btnSave', doSaveSettings);
  bindClick('btnShowKey', ()=>{ const k=document.getElementById('apiKey'); if (k) k.type = k.type==='password'?'text':'password'; });
  const engKindEl = document.getElementById('engKind');
  if (engKindEl) engKindEl.onchange = syncEngineUI;
  const preset = document.getElementById('apiPreset');
  if (preset) preset.onchange = () => {
    const p = window.AIB36 && window.AIB36.providerById(preset.value);
    const saved = (settings.providers || {})[preset.value];
    if (saved) {
      // a provider configured before: restore its own address, key and first enabled model
      document.getElementById('apiBase').value = saved.baseUrl || (p && p.baseUrl) || '';
      document.getElementById('apiKey').value = saved.apiKey || '';
      const en = (saved.models || []).find(m => m.enabled);
      document.getElementById('apiModel').value = preset.value === settings.api.preset ? settings.api.model : ((en && en.id) || (p && p.model) || '');
    } else if (p && preset.value !== 'custom') {
      document.getElementById('apiBase').value = p.baseUrl;
      document.getElementById('apiModel').value = p.model;
      document.getElementById('apiKey').value = '';
    }
    paintProvModels({ auto: true });
  };
  const localModelEl = document.getElementById('localModel');
  if (localModelEl) localModelEl.onchange = updateLocalWarn;
  const setLoadUI = (st) => { // st: idle | loading | paused
    const pauseBtn = document.getElementById('btnPauseLocal');
    const resumeBtn = document.getElementById('btnResumeLocal');
    const loadBtn = document.getElementById('btnLoadLocal');
    if (pauseBtn) pauseBtn.style.display = st === 'loading' ? '' : 'none';
    if (resumeBtn) resumeBtn.style.display = st === 'paused' ? '' : 'none';
    if (loadBtn) loadBtn.disabled = st === 'loading';
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
  bindClick('btnLoadLocal', doLoad);
  bindClick('btnResumeLocal', doLoad);
  bindClick('btnPauseLocal', () => { pauseLoad(); });
  bindClick('btnUnloadLocal', async ()=>{
    await unloadModel(); document.getElementById('localProg').textContent = ''; toast(t('localUnload'));
  });
  bindClick('btnTest', async ()=>{
    collectSettings(); saveSettings(settings); // test exactly what is in the form, and keep it
    try { const r = await testConnection(settings.api); toast('OK: '+(r||'').slice(0,40)); }
    catch(e){ toast(String(e.message||e).slice(0,160)); }
  });
  document.querySelectorAll('#modeseg .seg').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  bindClick('btnSend', async ()=>{
    const q = document.getElementById('q').value;
    if (document.querySelector('#modeseg .seg.active')?.dataset.mode==='search') return doSearch(q);
    if (abort) abort.abort(); abort = new AbortController();
    await handleAsk({ q, settings, signal:abort.signal, els:{
      status:document.getElementById('status'),
      answer:document.getElementById('answer'),
      tools:document.getElementById('tools'),
      thinking:document.getElementById('thinking'),
    }});
  });
  const qEl = document.getElementById('q');
  if (qEl) qEl.addEventListener('keydown', ev=>{ if(ev.key==='Enter'&&!ev.shiftKey&&!ev.isComposing){ ev.preventDefault(); document.getElementById('btnSend')?.click(); }});
  bindClick('btnClosePanel', closeOverlay);
  bindClick('ptGgb', ()=>showPanel('ggb'));
  bindClick('ptPhys', ()=>showPanel('phys'));
  const jump = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); };
  bindClick('btnSolve', () => jump('solvebox'));
  bindClick('btnWiki', () => jump('wikibox'));
  bindClick('btnGgb', ()=>showPanel('ggb'));
  bindClick('btnPhys', ()=>showPanel('phys'));
  const A = window.AIB36;
  const tools = document.getElementById('hometools');
  const toolDefs = [
    ['geogebra', 'GeoGebra', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13.5h12M2.5 14V2"/><path d="M3 11.5c2.2-6 4.8-6 7-1.5s2.5 1.5 3.5-3"/><circle cx="6.5" cy="7" r="1.3"/><circle cx="11.5" cy="9.5" r="1.3"/></svg>'],
    ['physics', '物理', '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(-30 8 8)"/><ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(30 8 8)"/><circle cx="8" cy="8" r="1.2"/></svg>'],
    ['solve', '解题', '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2" width="11" height="12" rx="2"/><path d="M5.2 6.2l1.6 1.6 3.8-3.4"/><path d="M5.2 10.8h5.6"/></svg>'],
    ['wiki', '百科', '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.6" ry="6"/><path d="M2.3 6h11.4M2.3 10h11.4"/></svg>'],
    ['dict', '词典', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5c1.8-.6 4.2-.6 6 .5 1.8-1.1 4.2-1.1 6-.5v9.2c-1.8-.6-4.2-.6-6 .5-1.8-1.1-4.2-1.1-6-.5z"/><path d="M8 4v9.2"/></svg>']
  ];
  if (tools && A) tools.innerHTML = toolDefs.map(([id, label, svg]) => `<button type="button" class="ticon" data-tool="${id}" title="${label}" aria-label="${label}">${svg}</button>`).join('');
  tools && tools.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]'); if (!b) return;
    const id = b.dataset.tool;
    if (id === 'geogebra') showPanel('ggb');
    else if (id === 'physics') showPanel('phys');
    else if (id === 'dict') {
      const box = document.getElementById('dictbox');
      const dictEl = document.getElementById('dictQ');
      if (box) box.scrollIntoView({ behavior: 'smooth' });
      if (dictEl) dictEl.focus();
    } else {
      jump(id === 'wiki' ? 'wikibox' : 'solvebox');
    }
  });
  const refs = [];
  const refAdd = document.getElementById('refAdd');
  if (refAdd) refAdd.onclick = () => {
    const titleEl = document.getElementById('refTitle');
    const bodyEl = document.getElementById('refBody');
    const tVal = (titleEl?.value || '').trim();
    const bVal = (bodyEl?.value || '').trim();
    if (!tVal && !bVal) return;
    refs.push({ title: tVal, text: bVal });
    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    document.getElementById('refList').textContent = '参考资料 ' + refs.length + ' 条';
  };
  let solveImage = null;
  function showSolvePreview(file) {
    const preview = document.getElementById('solvePreview');
    if (!file) { solveImage = null; if (preview) preview.textContent = ''; return; }
    const reader = new FileReader();
    reader.onload = () => {
      solveImage = { name: file.name, dataUrl: reader.result };
      if (preview) preview.textContent = '已选择图片：' + file.name;
    };
    reader.readAsDataURL(file);
  }
  const solveFile = document.getElementById('solveFile');
  const solveCam = document.getElementById('solveCamera');
  const solveImg = document.getElementById('solveImg');
  if (solveImg && solveFile) solveImg.onclick = () => solveFile.click();
  if (solveFile) solveFile.onchange = () => showSolvePreview(solveFile.files && solveFile.files[0]);
  if (solveCam) solveCam.onchange = () => showSolvePreview(solveCam.files && solveCam.files[0]);
  const solvePhone = document.getElementById('solvePhone');
  if (solvePhone) solvePhone.onclick = () => {
    const native = typeof window !== 'undefined' && (!!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) || /iPad|iPhone|iPod|Android/i.test(navigator.userAgent));
    if (native && solveCam) { solveCam.click(); return; }
    const url = A.PUBLIC_SOLVER;
    document.getElementById('solveQr').innerHTML = A.qrSvg(url) + `<p>${esc(url)}</p><p>在手机上打开后可以直接拍照解题。网页版不能把照片回传到这台电脑。</p>`;
  };
  const solveGo = document.getElementById('solveGo');
  if (solveGo) solveGo.onclick = async () => {
    const q = document.getElementById('solveText').value.trim();
    if (!q && !solveImage) return;
    const ctx = A.solverContext({ refs, turns: [] });
    const imgNote = solveImage ? '\n[已附加题目图片 ' + solveImage.name + ']' : '';
    if (abort) abort.abort(); abort = new AbortController();
    await handleAsk({ q: (ctx ? ctx + '\n' : '') + q + imgNote, settings, signal: abort.signal, els: { status: document.getElementById('status'), answer: document.getElementById('answer'), tools: document.getElementById('tools'), thinking: document.getElementById('thinking') } });
  };
  const wikiForm = document.getElementById('wikiForm');
  const wikiQ = document.getElementById('wikiQ');
  const zimst = document.getElementById('zimst');
  const wikiHits = document.getElementById('wikiHits');
  const wikiReader = document.getElementById('wikiReader');
  const wikiFrame = document.getElementById('wikiFrame');
  const wikiArtTitle = document.getElementById('wikiArtTitle');
  function paintZimStatus(st) {
    if (!zimst) return;
    if (!st || !st.open) zimst.textContent = (st && st.error) ? ('无法打开 ZIM 文件：' + st.error) : '尚未打开 ZIM 文件。请选择与 Kiwix 应用相同的离线百科文件（.zim）。';
    else zimst.textContent = st.copied
      ? ('当前文件：' + st.name + '（已保存到应用程序存储，共 ' + Number(st.articleCount || 0).toLocaleString() + ' 条）')
      : ('当前文件：' + st.name + '（共 ' + Number(st.articleCount || 0).toLocaleString() + ' 条）');
  }
  paintZimStatus(window.AibZim && window.AibZim.status());
  async function openWebArticle(articlePath, title) {
    if (!window.AibZim) return;
    const item = await window.AibZim.render(articlePath || '');
    if (!item || !wikiFrame) return;
    if (wikiReader) wikiReader.hidden = false;
    if (wikiArtTitle) wikiArtTitle.textContent = title || item.title || item.path || '';
    if (item.html != null) {
      wikiFrame.removeAttribute('src');
      wikiFrame.srcdoc = item.html;
      wikiFrame.onload = () => {
        const doc = wikiFrame.contentDocument;
        if (!doc) return;
        doc.addEventListener('click', (ev) => {
          const a = ev.target && ev.target.closest && ev.target.closest('a[href], a[data-zim-path]');
          if (!a) return;
          const href = a.getAttribute('href') || '';
          if (/^(https?:|mailto:|javascript:|blob:)/i.test(href) || href.charAt(0) === '#') return;
          ev.preventDefault();
          const next = a.getAttribute('data-zim-path') || window.AibZim.resolvePath(item.path, href);
          openWebArticle(next, a.textContent || '');
        });
      };
    } else if (item.url) {
      wikiFrame.removeAttribute('srcdoc');
      wikiFrame.src = item.url;
    }
  }
  const runWiki = async () => {
    if (!wikiQ || !wikiHits) return;
    let hits = [];
    if (window.AibZim && window.AibZim.status().open) hits = await window.AibZim.search(wikiQ.value, 20);
    if ((!hits || !hits.length) && A) hits = A.wikiSearch(A.WIKI_SEED, wikiQ.value);
    wikiHits.innerHTML = hits.length
      ? hits.map(h => `<article data-title="${esc(h.title)}"${h.path ? ` data-path="${esc(h.path)}"` : ''}><b>${esc(h.title)}</b><p>${esc(h.text || h.path || '')}</p></article>`).join('')
      : (wikiQ.value.trim() ? '<p class="hint">未找到匹配词条。</p>' : '');
  };
  if (wikiForm) wikiForm.addEventListener('submit', (e) => { e.preventDefault(); runWiki(); });
  if (wikiHits) wikiHits.addEventListener('click', (e) => {
    const art = e.target.closest('article[data-path]');
    if (art && art.dataset.path) {
      wikiHits.innerHTML = '';
      openWebArticle(art.dataset.path, art.dataset.title);
    }
  });
  const zimFile = document.getElementById('zimFile');
  if (zimFile) zimFile.addEventListener('change', async () => {
    const file = zimFile.files && zimFile.files[0];
    if (!file || !window.AibZim) return;
    if (zimst) zimst.textContent = '正在将 ZIM 文件复制到应用程序存储…';
    try {
      const st = await window.AibZim.open(file);
      paintZimStatus(st);
      if (st.open) await openWebArticle('', st.name);
    } catch (err) {
      paintZimStatus({ open: false, error: err.message || String(err) });
    }
  });
  if (window.AibZim && window.AibZim.restore) {
    window.AibZim.restore().then(st => {
      paintZimStatus(st);
      if (st && st.open) openWebArticle('', st.name);
    }).catch(() => {});
  }
  const wikiHome = document.getElementById('wikiHome');
  if (wikiHome) wikiHome.onclick = () => openWebArticle('', '');

  const dictForm = document.getElementById('dictForm');
  const dictPop = document.getElementById('dictPop');
  const closeDictPop = () => { if (dictPop) dictPop.hidden = true; };
  const dictPopX = document.getElementById('dictPopX');
  if (dictPopX) dictPopX.onclick = closeDictPop;
  if (dictPop) dictPop.addEventListener('click', (e) => { if (e.target === dictPop) closeDictPop(); });
  if (dictForm) dictForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = (document.getElementById('dictQ')?.value || '').trim();
    if (!word) return;
    if (dictPop) dictPop.hidden = false;
    const wordEl = document.getElementById('dictPopWord');
    const noteEl = document.getElementById('dictPopNote');
    if (wordEl) wordEl.textContent = word;
    if (noteEl) noteEl.textContent = 'AI 生成 · 非词典释义，仅供参考';
    if (abort) abort.abort(); abort = new AbortController();
    await handleAsk({
      q: word,
      settings,
      signal: abort.signal,
      asDict: true,
      els: {
        status: document.getElementById('dictPopStatus'),
        answer: document.getElementById('dictPopBody'),
        tools: { innerHTML: '' }
      }
    });
  });
  function paintThemes(){
    const grid = document.getElementById('themeGrid'); if (!grid || !A) return;
    grid.innerHTML = Object.values(A.THEMES).map(th => `<button type="button" class="theme-combo ${settings.theme===th.id?'on':''}" data-theme="${esc(th.id)}"><b>${esc(th.zh)}</b><span class="swatches">${Object.values(th.colors).map(c=>`<i style="background:${esc(c)}"></i>`).join('')}</span></button>`).join('');
    grid.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => { settings.theme = b.dataset.theme; applyTheme(settings.theme); saveSettings(settings); paintThemes(); });
  }
  window.__paintThemes = paintThemes;
  applyTheme(settings.theme || 'aurora');
  bindClick('kbAdd', async ()=>{
    const t0 = document.getElementById('kbText').value.trim(); if(!t0) return;
    await kbAdd(t0, 'note'); document.getElementById('kbText').value=''; toast(t('saved')); refreshKb();
  });
  bindClick('kbClear', async ()=>{
    const n = (await kbList()).length;
    if (!n) { doneBanner(t('cleared').replace('{n}', 0)); return; }
    const ok = await confirmDialog({ title: t('kbClearTitle'), message: t('kbClearMsg').replace('{n}', n), detail: getLang()==='zh'?'此操作无法撤销。':'This cannot be undone.', confirmText: getLang()==='zh'?'确认清除':'Confirm clear' });
    if (!ok) return;
    await kbClear(); refreshKb(); doneBanner(t('cleared').replace('{n}', n));
  });
  const kbQ = document.getElementById('kbQuery');
  if (kbQ) kbQ.oninput = async (ev)=>{
    const hits = await kbSearch(ev.target.value); renderKb(hits);
  };
}

async function refreshKb(){ renderKb(await kbList()); }
function renderKb(items){
  const el = document.getElementById('kbList'); if (!el) return;
  if (!items.length){ el.textContent = t('kbEmpty'); return; }
  el.innerHTML = items.map(d=>`<div class="chip" title="${esc((d.text||'').slice(0,200))}">${esc(d.title||'note')} · ${esc((d.text||'').slice(0,40))}</div>`).join('');
}

setLang(settings.lang||getLang());
renderChrome();
mountPanels(document.getElementById('plotcanvas'));
wire();
mountPickers();
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
