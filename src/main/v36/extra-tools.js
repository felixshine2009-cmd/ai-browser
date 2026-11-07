'use strict';
const fs = require('fs');
const path = require('path');
const v36 = require('./v36');

function wikiDir() {
  try { return path.join(require('electron').app.getPath('userData'), 'wiki'); } catch { return path.join(process.cwd(), 'wiki-data'); }
}
function extraPages() {
  const dir = wikiDir();
  const pages = [];
  try {
    if (!fs.existsSync(dir)) return pages;
    for (const name of fs.readdirSync(dir)) {
      if (!/\.jsonl?$/i.test(name)) continue;
      pages.push(...v36.parseWikiJsonl(fs.readFileSync(path.join(dir, name), 'utf8')));
    }
  } catch {}
  return pages;
}
function wikiSearch(q) { return v36.wikiSearch(v36.WIKI_SEED.concat(extraPages()), q).slice(0, 5); }

const tools = [
  { name: 'hs_calc', group: 'calc', description: 'High-school calculation. op: quad, kinematics, newton, ohm, kinetic, potential, wave, lens, ph, gas, arith, geo, trig, log, deriv. Pass numeric args (a,b,c / v0,a,t / m,a / V,I,R / f,lambda / coef array, etc.).',
    parameters: { type: 'object', properties: { op: { type: 'string' }, args: { type: 'object' } }, required: ['op'] },
    run: async (a) => v36.hscalc(String(a.op || ''), a.args || a) },
  { name: 'wiki_search', group: 'wiki', description: 'Search the offline wiki (bundled articles plus any JSONL the user imported). Use together with web_search when both could help.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: async (a) => ({ hits: wikiSearch(a.query) }) },
  { name: 'wiki_translate', group: 'wiki', description: 'Translate an offline wiki article title into the user language using the translation engine. Does not replace the stored page.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, target: { type: 'string' } }, required: ['title'] },
    run: async (a) => {
      const hit = wikiSearch(a.title)[0];
      if (!hit) return { error: 'not found' };
      const tr = await require('../ai/translate').translate(hit.text, { target: a.target || 'en' });
      return { title: hit.title, translation: tr.text || tr, target: a.target || 'en' };
    } },
  { name: 'collab_note', group: 'collab', description: 'Add a note to the shared human–AI workspace of a tool (geogebra, physics, dict, solve, wiki). who is human or ai.',
    parameters: { type: 'object', properties: { tool: { type: 'string' }, who: { type: 'string' }, text: { type: 'string' } }, required: ['tool', 'text'] },
    run: async (a) => {
      const store = require('../store');
      const s = store.getSettings();
      const bag = Object.assign({}, s.collab || {});
      const cur = bag[a.tool] || v36.collabOpen(a.tool);
      bag[a.tool] = v36.collabNote(cur, a.who || 'ai', a.text);
      store.patchSettings({ collab: bag });
      return { tool: a.tool, notes: bag[a.tool].notes.length };
    } },
  { name: 'browser_click', group: 'browser', description: 'Click an element in the active tab by CSS selector or visible text.',
    parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } } },
    run: async (a) => {
      const t = require('../tabs').activeTab(); if (!t) throw new Error('no tab');
      const sel = JSON.stringify(String(a.selector || ''));
      const text = JSON.stringify(String(a.text || ''));
      return t.wc.executeJavaScript(`(() => { const q=${sel}; let el=q&&document.querySelector(q); if(!el){ const want=${text}; el=[...document.querySelectorAll('a,button,input,[role=button]')].find(e=>(e.innerText||e.value||'').includes(want)); } if(!el) return {ok:false}; el.click(); return {ok:true, tag:el.tagName}; })()`);
    } },
  { name: 'browser_type', group: 'browser', description: 'Type text into an input in the active tab (CSS selector).',
    parameters: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
    run: async (a) => {
      const t = require('../tabs').activeTab(); if (!t) throw new Error('no tab');
      const sel = JSON.stringify(String(a.selector || 'input,textarea'));
      const text = JSON.stringify(String(a.text || ''));
      return t.wc.executeJavaScript(`(() => { const el=document.querySelector(${sel}); if(!el) return {ok:false}; el.focus(); el.value=${text}; el.dispatchEvent(new Event('input',{bubbles:true})); return {ok:true}; })()`);
    } },
  { name: 'kernel_check', group: 'browser', description: 'Check whether a newer Chromium/Electron kernel is published. Does not install by itself.',
    parameters: { type: 'object', properties: {} },
    run: async () => require('./kernel').check() }
];

module.exports = tools;
module.exports.wikiSearch = wikiSearch;
module.exports.wikiDir = wikiDir;
