'use strict';
// Unified agent tool registry. Every capability the AI can use is declared here (builtin) or in an extension manifest
// (contributes.tools) and surfaced with ONE function-calling schema (OpenAI / Anthropic compatible; local models use the
// grammar-constrained JSON action loop in agent.js with the same definitions).
//   builtin groups: browser · extensions · settings · language (dictionary / translate / grammar) · knowledge base
//   web_search / open_page are declared here too but executed by agent.js (they need the per-chat citation board).
const features = require('../ext/features');
const store = require('../store');

const str = (d) => ({ type: 'string', description: d });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const clip = (v, n = 6000) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : v; };

let tabsRef = null;
const tabs = () => tabsRef || (tabsRef = require('../tabs'));
const chatMod = () => require('./chat');
const kbMod = () => require('./kb');
const trMod = () => require('./translate');

const INTERNAL_PAGES = ['home', 'settings', 'extensions', 'history', 'bookmarks', 'downloads'];
const tabRow = (t) => { const i = tabs().tabInfo(t); return { id: t.id, title: i.title, url: i.url, active: !!i.active, incognito: !!t.incognito, loading: !!i.loading }; };
const needTab = (id) => { const t = id == null ? tabs().activeTab() : tabs().getTab(Number(id)); if (!t) throw new Error('no such tab' + (id != null ? ': ' + id : '')); return t; };
const httpUrl = (u) => { u = String(u || '').trim(); if (!u) throw new Error('url required'); if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u; if (!/^(https?|aibrowser):/i.test(u)) throw new Error('only http(s) urls are allowed'); return u; };

const BUILTIN = [
  // ---- browser
  { name: 'browser_list_tabs', group: 'browser', description: 'List all open browser tabs (id, title, url, which is active, whether private).', parameters: obj({}),
    run: async () => ({ tabs: tabs().allTabs().map(tabRow) }) },
  { name: 'browser_open_tab', group: 'browser', description: 'Open a new browser tab, optionally at a URL. Set incognito=true for a private tab (separate session: no shared cookies, no history).', parameters: obj({ url: str('http(s) URL; omit for the home page'), incognito: { type: 'boolean' }, background: { type: 'boolean', description: 'do not switch to it' } }),
    run: async (a) => { const url = a.url ? httpUrl(a.url) : undefined; const t = a.incognito ? tabs().createIncognitoTab(url) : tabs().createTab(url, { activate: !a.background }); return { opened: tabRow(t) }; } },
  { name: 'browser_close_tab', group: 'browser', description: 'Close a tab by id (default: the active tab).', parameters: obj({ id: { type: 'number' } }),
    run: async (a) => { const t = needTab(a.id); const id = t.id; tabs().closeTab(id); return { closed: id, remaining: tabs().allTabs().length }; } },
  { name: 'browser_switch_tab', group: 'browser', description: 'Activate (switch to) a tab by id.', parameters: obj({ id: { type: 'number' } }, ['id']),
    run: async (a) => { const t = needTab(a.id); tabs().activateTab(t.id); return { active: tabRow(t) }; } },
  { name: 'browser_navigate', group: 'browser', description: 'Navigate a tab (default: active) to a URL, or go back / forward / reload.', parameters: obj({ url: str('http(s) URL'), action: { type: 'string', enum: ['back', 'forward', 'reload'] }, id: { type: 'number' } }),
    run: async (a) => { const t = needTab(a.id); if (a.action === 'back') t.wc.navigationHistory.goBack(); else if (a.action === 'forward') t.wc.navigationHistory.goForward(); else if (a.action === 'reload') t.wc.reload(); else tabs().load(t, httpUrl(a.url)); return { tab: tabRow(t) }; } },
  { name: 'browser_open_page', group: 'browser', description: 'Open one of the browser\'s own pages: settings, extensions, history, bookmarks, downloads, home.', parameters: obj({ page: { type: 'string', enum: INTERNAL_PAGES } }, ['page']),
    run: async (a) => { if (!INTERNAL_PAGES.includes(a.page)) throw new Error('unknown page'); const t = tabs().openInternal(a.page); return { opened: tabRow(t) }; } },
  { name: 'browser_read_page', group: 'browser', description: 'Read the visible text of a tab (default: the active tab), truncated.', parameters: obj({ id: { type: 'number' }, maxChars: { type: 'number' } }),
    run: async (a) => { const t = needTab(a.id); const n = Math.min(12000, Math.max(500, Number(a.maxChars) || 4000)); const text = await t.wc.executeJavaScript('document.body ? document.body.innerText : ""'); return { title: t.wc.getTitle(), url: t.wc.getURL(), text: String(text).replace(/\n{3,}/g, '\n\n').slice(0, n) }; } },
  { name: 'browser_history_search', group: 'browser', description: 'Search the browsing history (not private tabs) by title/URL substring.', parameters: obj({ query: str('substring; empty = most recent'), limit: { type: 'number' } }),
    run: async (a) => ({ history: store.listHistory(String(a.query || '')).slice(0, Math.min(50, Number(a.limit) || 10)).map(h => ({ title: h.title, url: h.url, time: h.time })) }) },
  { name: 'browser_print', group: 'browser', description: 'Open the system Print dialog for a tab (default: active tab). The user confirms or cancels; also offers Save as PDF.', parameters: obj({ id: { type: 'number' } }),
    run: async (a) => { const ok = global.__aibPrint && global.__aibPrint.printActive(a.id); if (!ok) throw new Error('no such tab'); return { dialog: 'opened' }; } },
  { name: 'browser_save_pdf', group: 'browser', description: 'Save a tab as a PDF; a save dialog asks the user where to put the file.', parameters: obj({ id: { type: 'number' } }),
    run: async (a) => global.__aibPrint.savePdf(a.id) },
  // ---- extensions
  { name: 'extensions_list', group: 'extensions', description: 'List installed feature extensions (功能拓展) with enabled state and the tools each provides.', parameters: obj({}),
    run: async () => { const tl = features.listTools(); return { extensions: features.list().map(e => ({ id: e.id, name: e.name, enabled: e.enabled, version: e.version, tools: tl.filter(t => t.extId === e.id).map(t => t.name) })) }; } },
  { name: 'extension_set_enabled', group: 'extensions', description: 'Enable or disable a feature extension by id.', parameters: obj({ id: str('extension id, e.g. aib.geogebra'), enabled: { type: 'boolean' } }, ['id', 'enabled']),
    run: async (a) => { features.setEnabled(a.id, !!a.enabled); return { id: a.id, enabled: !!a.enabled }; } },
  // ---- settings (read only, secrets never included)
  { name: 'settings_get', group: 'settings', description: 'Read the browser settings (language, mode, search engine, AI source/model names, translate engine, knowledge-base source). API keys are never returned.', parameters: obj({ section: { type: 'string', enum: ['all', 'general', 'search', 'ai', 'translate', 'kb'] } }),
    run: async (a) => { const s = store.publicSettings(); const ai = { source: s.ai.source, model: s.ai.source === 'local' ? (s.ai.local.modelId || s.ai.local.modelPath) : s.ai.api.model, engine: s.ai.local && s.ai.local.engine, baseUrl: s.ai.api.baseUrl, hasKey: s.ai.api.hasKey };
      const all = { general: { lang: s.lang, mode: s.mode, displayName: s.displayName }, search: s.search, ai, translate: s.translate, kb: { source: s.kb && s.kb.source } };
      return a.section && a.section !== 'all' ? { [a.section]: all[a.section] } : all; } },
  // ---- language
  { name: 'dictionary_lookup', group: 'language', description: 'Look a word up in the user\'s imported MDX dictionaries; falls back to an AI-written entry when none has it.', parameters: obj({ word: str('English word or phrase') }, ['word']),
    run: async (a, ctx) => { const w = String(a.word || '').trim(); if (!w) throw new Error('word required');
      const r = await features.runInputHandlers('word', { kind: 'word', word: w }, ctx || {}).catch(() => null);
      if (r && r.result) return { source: 'mdx', word: w, dictionaries: (r.result.results || []).map(x => x.name), suggestions: r.result.suggestions || [] };
      const e = await chatMod().aiEntry(w); return { source: 'ai', entry: e }; } },
  { name: 'translate_text', group: 'language', description: 'Translate text with the built-in Hunyuan translation model (HY-MT, loaded only for this call). Auto-detects Chinese vs other; set target to force a language (zh, en, ja, ko, fr, de, es, ru, …). Optionally translate the text of a URL.', parameters: obj({ text: str('text to translate'), url: str('translate the readable text of this page instead'), target: str('target language code') }),
    run: async (a) => { let text = String(a.text || ''); if (!text && a.url) { text = (await require('./search').readPage(httpUrl(a.url), { maxChars: 6000 })).text; } if (!text.trim()) throw new Error('text or url required');
      const r = await trMod().translate(text.slice(0, 8000), { target: a.target }); return { target: r.target, translation: r.text, model: r.model }; } },
  { name: 'analyze_sentence', group: 'language', description: 'Grammar-analyse an English sentence: translation, clause structure (subject/predicate/object…), key phrases.', parameters: obj({ sentence: str('the sentence') }, ['sentence']),
    run: async (a) => { const llm = require('./llm'), P = require('./prompts'); const local = store.getSettings().ai.source === 'local';
      const j = await llm.completeJson([{ role: 'system', content: P.sentence({ local }) }, { role: 'user', content: String(a.sentence || '') }]);
      try { const tr = await trMod().translate(String(a.sentence), {}); j.translation = tr.text; } catch {} return j; } },
  // ---- knowledge base
  { name: 'kb_search', group: 'knowledge', description: 'Semantic search in the user\'s personal knowledge base (multilingual; Chinese and English queries both work). Returns the best matching passages with scores.', parameters: obj({ query: str('what to look for'), k: { type: 'number' } }, ['query']),
    run: async (a) => ({ hits: await kbMod().search(String(a.query || ''), Number(a.k) || 5) }) },
  { name: 'kb_add_text', group: 'knowledge', description: 'Save a note / passage into the knowledge base.', parameters: obj({ title: str('short title'), text: str('content') }, ['text']),
    run: async (a) => kbMod().addText(String(a.title || '笔记'), String(a.text || ''), { source: 'agent' }) },
  { name: 'kb_list', group: 'knowledge', description: 'List documents stored in the knowledge base.', parameters: obj({}), run: async () => kbMod().list() }
];

// Declared here so every provider sees the same list; executed by agent.js with the page board.
const WEB = [
  { name: 'web_search', group: 'web', external: true, description: 'Search the web with the user\'s selected search engine. Returns titles, URLs and snippets only — call open_page to read a result. Use short keyword queries; for Chinese topics query in Chinese.',
    parameters: obj({ query: str('search keywords'), engine: { type: 'string', enum: ['bing', 'google', 'baidu', 'duckduckgo'], description: 'optional; defaults to the user\'s selected engine' } }, ['query']) },
  { name: 'open_page', group: 'web', external: true, description: 'Open a URL from the search results and read its main text. Returns {n,title,text}; cite the page as [n] in the answer.', parameters: obj({ url: str('http(s) url') }, ['url']) }
];

function def(t) { return { name: t.name, description: t.description, parameters: t.parameters }; }
// all tool definitions: web + builtin + every enabled extension's manifest tools (auto-registered)
function all({ web = true } = {}) {
  const out = []; const seen = new Set();
  const push = (t, src) => { if (!seen.has(t.name)) { seen.add(t.name); out.push({ ...def(t), group: t.group || src, source: src, extId: t.extId }); } };
  if (web) WEB.forEach(t => push(t, 'web'));
  BUILTIN.forEach(t => push(t, 'builtin'));
  for (const t of features.listTools()) push({ ...t, group: t.extId }, 'extension');
  return out;
}
const isExternal = (name) => WEB.some(t => t.name === name);

async function call(name, args, ctx) {
  const b = BUILTIN.find(t => t.name === name);
  if (b) return b.run(args || {}, ctx || {});
  return features.callTool(name, args || {}, ctx || {});
}
// brief human-readable one-liner for the UI trace
function summarize(name, args, result) {
  const j = (v) => String(typeof v === 'string' ? v : JSON.stringify(v));
  const a = args || {};
  const key = a.url || a.query || a.word || a.page || a.text || a.sentence || a.id || (a.commands && a.commands.length + ' cmd') || (a.scene && 'scene') || '';
  let tail = '';
  if (result && result.error) tail = ' ✕ ' + j(result.error).slice(0, 80);
  return (name + (key !== '' ? ' · ' + j(key).replace(/\s+/g, ' ').slice(0, 48) : '')) + tail;
}

module.exports = { all, call, isExternal, summarize, BUILTIN, WEB, def, clip };
