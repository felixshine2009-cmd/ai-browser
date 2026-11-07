import { chatComplete } from './api.js';
import { chat as localChat, isReady as localReady } from './local-model.js';
import { t } from './i18n.js';
import { call as panelCall, show as showPanel } from './panels.js';
import { search as kbSearch } from './kb.js';

function looksMath(q){ return /画|绘|函数|图像|图形|几何|作图|graph|plot|f\(x\)|sin|cos|导数/i.test(q); }
function looksPhys(q){ return /物理|抛体|单摆|弹簧|受力|电路|折射|磁场|平抛|physics|projectile|pendulum/i.test(q); }
function looksWord(q){ return /^[a-zA-Z][a-zA-Z\-']{1,24}$/.test(q.trim()); }

async function complete(settings, messages, signal){
  if (settings.engine === 'local') {
    if (!localReady()) throw new Error(t('localNotLoaded'));
    return localChat({ messages, signal });
  }
  return chatComplete({ ...settings.api, messages, signal, thinkingLevel: settings.thinkingLevel });
}

export async function handleAsk({q, settings, els, signal, prior, asDict}){
  const text = (q||'').trim(); if (!text) return;
  const A = window.AIB36;
  const intent = asDict ? { kind: 'dict' } : (A ? A.route(text) : { kind: looksMath(text) ? 'draw' : looksPhys(text) ? 'physics' : 'search' });
  els.status.textContent = A ? A.statusLabel('thinking', { solve: intent.kind === 'solve' }) : t('thinking');
  els.answer.textContent = '';
  els.tools.innerHTML = '';
  const chips = [];
  try {
    if (!asDict && (intent.kind === 'physics' || looksPhys(text))) {
      showPanel('phys');
      chips.push('phys_load_example');
      els.status.textContent = A ? A.statusLabel('tool') : els.status.textContent;
      try { await panelCall('phys','loadExample',{id:'mechanics_projectile'}); } catch {}
    } else if (!asDict && (intent.kind === 'draw' || looksMath(text))) {
      showPanel('ggb');
      chips.push('ggb_eval');
      els.status.textContent = A ? A.statusLabel('tool') : els.status.textContent;
      const cmds = text.includes('sin') ? ['f(x)=sin(x)'] : ['f(x)=x^2'];
      try { await panelCall('ggb','eval',{commands:cmds}); } catch {}
    }
    if (A && /[0-9]/.test(text) && intent.kind === 'solve') {
      chips.push('hs_calc');
    }
    if (chips.length) els.tools.innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join(' ');
    let kbHits = [];
    try { kbHits = await kbSearch(text); } catch {}
    let wiki = [];
    if (A) { try { wiki = A.wikiSearch(A.WIKI_SEED, text).slice(0, 3); if (wiki.length) chips.push('wiki_search'); } catch {} }
    if (chips.length) els.tools.innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join(' ');
    const style = A ? A.answerAddendum(settings.answerStyle || 'detailed') : '';
    const hist = (prior || []).map(m => (m.role === 'assistant' ? '助手: ' : '用户: ') + m.text).join('\n');
    const sys = `You are the AI assistant inside AI Browser (web). Reply in the user's language. ${style} ${kbHits.length? 'Knowledge-base snippets:\n'+kbHits.map(h=>h.text.slice(0,400)).join('\n---\n'):''} ${wiki.length? 'Offline wiki:\n'+wiki.map(h=>h.title+': '+h.text).join('\n'):''} ${hist? 'Earlier:\n'+hist:''}`;
    if (asDict || looksWord(text)) {
      const entry = await complete(settings, [
        {role:'system', content:'Explain the English word: IPA, POS, Chinese gloss, 2 example sentences with translation. Markdown.'},
        {role:'user', content:text}
      ], signal);
      els.answer.textContent = entry; els.status.textContent = t('dict'); return;
    }
    const out = await complete(settings, [
      {role:'system', content:sys},
      {role:'user', content:text}
    ], signal);
    els.answer.textContent = A ? A.redactToolTalk(out) : out;
    els.status.textContent = '';
    if (A && settings) {
      const title = A.fallbackTitle(text);
      const chats = JSON.parse(localStorage.getItem('aib.chats') || '[]');
      chats.unshift({ id: Date.now().toString(36), title, preview: text.slice(0, 80), updated: Date.now(), messages: (prior||[]).concat([{role:'user', text}, {role:'assistant', text: els.answer.textContent}]) });
      localStorage.setItem('aib.chats', JSON.stringify(chats.slice(0, 40)));
    }
  } catch (e) {
    els.status.textContent = '';
    els.answer.textContent = (e && e.message) || t('error');
  }
}
