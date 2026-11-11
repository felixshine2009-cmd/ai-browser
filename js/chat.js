import { chatComplete, chatTurn } from './api.js';
import * as Compute from './compute-tools.js';
import { chat as localChat, isReady as localReady } from './local-model.js';
import { t } from './i18n.js';
import { call as panelCall, show as showPanel } from './panels.js';
import { search as kbSearch } from './kb.js';

function looksMath(q){ return /画|绘|函数|图像|图形|几何|作图|graph|plot|f\(x\)|sin|cos|导数/i.test(q); }
function looksPhys(q){ return /物理|抛体|单摆|弹簧|受力|电路|折射|磁场|平抛|physics|projectile|pendulum/i.test(q); }
function looksWord(q){ return /^[a-zA-Z][a-zA-Z\-']{1,24}$/.test(q.trim()); }

async function complete(settings, messages, signal, extra){
  extra = extra || {};
  if (settings.engine === 'local') {
    if (!localReady()) throw new Error(t('localNotLoaded'));
    return localChat({ messages, signal });
  }
  return chatComplete({ ...settings.api, messages, signal, thinkingLevel: settings.thinkingLevel, onThinking: extra.onThinking, onDelta: extra.onDelta });
}

const COMPUTE_GUIDE = `
Tools: python_run executes Python 3 (numpy, scipy, sympy, mpmath, pandas, matplotlib available; variables persist in this conversation). For any non-trivial calculation (arithmetic beyond a few digits, algebra, calculus, statistics, simulations, data processing, unit-sensitive physics) call python_run instead of computing mentally, then verify the result (e.g. substitute back, check with a second method). Print the values you need. matplotlib figures are shown to the user automatically; do not embed images or repeat long output in the answer — summarize the result. Use python_install only when an import fails because a library is missing. Do not mention tool names in the final answer.`;
const VM_GUIDE = `
You also have your own Linux virtual machine on this device (vm_shell, vm_read_file, vm_write_file, vm_upload, vm_download). For multi-step work, plan the steps, run them, read the output, fix errors and iterate until the task is done. The VM has no internet access.`;

function ensureBox(els, key, cls, where){
  if (els[key]) return els[key];
  const ref = els.answer; if (!ref || !ref.parentNode) return null;
  const d = document.createElement('div'); d.className = cls;
  if (where === 'before') ref.parentNode.insertBefore(d, ref); else ref.parentNode.insertBefore(d, ref.nextSibling);
  els[key] = d; return d;
}

async function agentAnswer(settings, messages, els, signal, hooks, session){
  const A = window.AIB36;
  const tools = await Compute.defs();
  const hasVm = tools.some(t => t.name === 'vm_shell');
  messages[0].content += COMPUTE_GUIDE + (hasVm ? VM_GUIDE : '');
  const runs = ensureBox(els, 'runs', 'runs', 'before'); const figs = ensureBox(els, 'figs', 'run-figs', 'after');
  if (runs) runs.innerHTML = ''; if (figs) figs.innerHTML = '';
  const steps = new Map();
  const lang = () => (document.documentElement.lang || '').startsWith('en') ? 'en' : 'zh';
  const RP = window.RunPanels && runs ? window.RunPanels.create(runs, figs, { lang, onStop: (id) => { const s = steps.get(id); if (s) s.abort(); } }) : null;
  const status = (txt) => { if (els.status) els.status.textContent = txt; };
  let streamed = '';
  for (let round = 0; round < 40; round++) {
    if (signal && signal.aborted) throw new Error('已停止');
    streamed = '';
    const onDelta = (d) => { streamed += d; els.answer.textContent = A ? A.redactToolTalk(streamed) : streamed; };
    let r;
    try { r = await chatTurn({ ...settings.api, messages, tools, signal, thinkingLevel: settings.thinkingLevel, onThinking: hooks.onThinking, onDelta }); }
    catch (e) {
      // Some models / gateways reject tool definitions: answer without tools instead of failing.
      if (round === 0 && (e.status === 400 || e.status === 422)) { messages[0].content = messages[0].content.replace(COMPUTE_GUIDE, '').replace(VM_GUIDE, ''); return complete(settings, messages, signal, Object.assign({}, hooks, { onDelta })); }
      throw e;
    }
    if (!r.toolCalls.length) return r.content;
    const am = { role: 'assistant', content: r.content || '', tool_calls: r.toolCalls };
    if (r.reasoning && /deepseek/i.test(settings.api.baseUrl || '') ) am.reasoning_content = r.reasoning;
    messages.push(am);
    els.answer.textContent = '';
    for (const c of r.toolCalls) {
      let args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch {}
      const name = c.function.name; const id = c.id; const t0 = Date.now();
      const ac = new AbortController(); steps.set(id, ac);
      const onOuter = () => ac.abort(); if (signal) signal.addEventListener('abort', onOuter, { once: true });
      if (els.tools) { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = name; els.tools.appendChild(chip); els.tools.appendChild(document.createTextNode(' ')); }
      if (RP) RP.step({ id, name, args, status: 'run' });
      let result, error = null;
      try {
        if (!Compute.isCompute(name)) throw new Error('unknown tool: ' + name);
        result = await Compute.call(name, args, { signal: ac.signal, session, status, stream: (st, data) => RP && RP.stream({ id, stream: st, data }) });
      } catch (e) { error = (e && e.message) || String(e); }
      if (signal) signal.removeEventListener('abort', onOuter); steps.delete(id);
      const ms = Date.now() - t0;
      const failed = !!error || (result && (result.ok === false || (result.exitCode != null && result.exitCode !== 0)));
      if (RP) { RP.step({ id, name, args, status: failed ? 'error' : 'ok', ms, error }); RP.tool({ id, name, result, error }); }
      const forModel = error ? { error } : JSON.parse(JSON.stringify(result || {}, (k, v) => (typeof v === 'string' && v.startsWith('data:image/')) ? '[image shown to the user]' : v));
      let txt = JSON.stringify(forModel); if (txt.length > 16000) txt = txt.slice(0, 16000) + '…';
      messages.push({ role: 'tool', tool_call_id: id, content: txt });
      status(A ? A.statusLabel('thinking') : '');
    }
  }
  return streamed;
}

export async function handleAsk({q, settings, els, signal, prior, asDict}){
  const text = (q||'').trim(); if (!text) return;
  const A = window.AIB36;
  const intent = asDict ? { kind: 'dict' } : (A ? A.route(text) : { kind: looksMath(text) ? 'draw' : looksPhys(text) ? 'physics' : 'search' });
  els.status.textContent = A ? A.statusLabel('thinking', { solve: intent.kind === 'solve' }) : t('thinking');
  els.answer.textContent = '';
  if (els.tools) els.tools.innerHTML = '';
  if (els.thinking) { els.thinking.hidden = false; els.thinking.textContent = ''; }
  const thinkHooks = {
    onThinking(bit) {
      if (!els.thinking) return;
      els.thinking.hidden = false;
      els.thinking.textContent = (els.thinking.textContent || '') + bit;
    }
  };
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
      ], signal, thinkHooks);
      els.answer.textContent = entry; els.status.textContent = t('dict'); return;
    }
    const msgs = [ {role:'system', content:sys}, {role:'user', content:text} ];
    const out = settings.engine === 'local'
      ? await complete(settings, msgs, signal, thinkHooks)
      : await agentAnswer(settings, msgs, els, signal, thinkHooks, 'web');
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
