import { t, setLang, getLang, applyI18n } from './i18n.js';
import { load as loadSettings, save as saveSettings, engines } from './settings.js';
import { testConnection } from './api.js';
import { toast, wireDesktopOnly } from './desktop-disabled.js';
import { mount as mountPanels, show as showPanel, closeOverlay } from './panels.js';
import { handleAsk } from './chat.js';
import { addText as kbAdd, list as kbList, search as kbSearch, clear as kbClear } from './kb.js';

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

function openSettings(){
  const s = document.getElementById('settings');
  document.getElementById('dname').value = settings.displayName||'';
  document.getElementById('greeting').value = settings.greeting||'';
  document.getElementById('lang').value = getLang();
  document.getElementById('apiBase').value = settings.api.baseUrl||'';
  document.getElementById('apiKey').value = settings.api.apiKey||'';
  document.getElementById('apiModel').value = settings.api.model||'';
  document.getElementById('engine').value = settings.search.engine||'baidu';
  document.getElementById('customEng').value = settings.search.custom||'';
  s.classList.add('open');
}
function closeSettings(){ document.getElementById('settings').classList.remove('open'); }

async function doSaveSettings(){
  settings.displayName = document.getElementById('dname').value.trim() || 'Felix';
  settings.greeting = document.getElementById('greeting').value;
  const lang = document.getElementById('lang').value;
  setLang(lang); settings.lang = lang;
  settings.api.baseUrl = document.getElementById('apiBase').value.trim();
  settings.api.apiKey = document.getElementById('apiKey').value.trim();
  settings.api.model = document.getElementById('apiModel').value.trim();
  settings.search.engine = document.getElementById('engine').value;
  settings.search.custom = document.getElementById('customEng').value.trim();
  saveSettings(settings);
  renderChrome();
  toast(t('saved'));
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

function wire(){
  document.getElementById('btnSettings').onclick = openSettings;
  document.getElementById('btnCloseSettings').onclick = closeSettings;
  document.getElementById('btnSave').onclick = doSaveSettings;
  document.getElementById('btnTest').onclick = async ()=>{
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
  document.getElementById('btnGgb').onclick = ()=>showPanel('ggb');
  document.getElementById('btnPhys').onclick = ()=>showPanel('phys');
  document.getElementById('kbAdd').onclick = async ()=>{
    const t = document.getElementById('kbText').value.trim(); if(!t) return;
    await kbAdd(t, 'note'); document.getElementById('kbText').value=''; toast(t('saved')); refreshKb();
  };
  document.getElementById('kbClear').onclick = async ()=>{ await kbClear(); refreshKb(); };
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
