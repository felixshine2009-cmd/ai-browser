import { chatComplete } from './api.js';
import { t } from './i18n.js';
import { call as panelCall, show as showPanel } from './panels.js';
import { search as kbSearch } from './kb.js';

function looksMath(q){ return /画|绘|函数|图像|图形|几何|作图|graph|plot|f\(x\)|sin|cos|导数/i.test(q); }
function looksPhys(q){ return /物理|抛体|单摆|弹簧|受力|电路|折射|磁场|平抛|physics|projectile|pendulum/i.test(q); }
function looksWord(q){ return /^[a-zA-Z][a-zA-Z\-']{1,24}$/.test(q.trim()); }

export async function handleAsk({q, settings, els, signal}){
  const text = (q||'').trim(); if (!text) return;
  els.status.textContent = t('thinking');
  els.answer.textContent = '';
  els.tools.innerHTML = '';
  try {
    if (looksPhys(text)) {
      showPanel('phys');
      els.tools.innerHTML = `<span class="chip">phys_load_example</span>`;
      try { await panelCall('phys','loadExample',{id:'mechanics_projectile'}); } catch {}
    } else if (looksMath(text)) {
      showPanel('ggb');
      els.tools.innerHTML = `<span class="chip">ggb_eval</span>`;
      const cmds = text.includes('sin') ? ['f(x)=sin(x)'] : ['f(x)=x^2'];
      try { await panelCall('ggb','eval',{commands:cmds}); } catch {}
    }
    let kbHits = [];
    try { kbHits = await kbSearch(text); } catch {}
    const sys = `You are the AI assistant inside AI Browser (web). Reply in the user's language. Be concise and factual. ${kbHits.length? 'Knowledge-base snippets:\n'+kbHits.map(h=>h.text.slice(0,400)).join('\n---\n'):''}`;
    if (looksWord(text)) {
      const entry = await chatComplete({...settings.api, signal, messages:[
        {role:'system', content:'Explain the English word: IPA, POS, Chinese gloss, 2 example sentences with translation. Markdown.'},
        {role:'user', content:text}
      ]});
      els.answer.textContent = entry; els.status.textContent = t('dict'); return;
    }
    const out = await chatComplete({...settings.api, signal, messages:[
      {role:'system', content:sys},
      {role:'user', content:text}
    ]});
    els.answer.textContent = out;
    els.status.textContent = '';
  } catch (e) {
    els.status.textContent = '';
    els.answer.textContent = (e && e.message) || t('error');
  }
}
