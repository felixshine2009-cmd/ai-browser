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

const INTERNAL_PAGES = ['home', 'settings', 'extensions', 'history', 'bookmarks', 'downloads', 'onboarding'];
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
  { name: 'vkeyboard_toggle', group: 'browser', description: 'Show, hide, or toggle the math/chemistry virtual keyboard on the home or chat page.',
    parameters: obj({ action: { type: 'string', enum: ['show','hide','toggle'] } }, ['action']),
    run: async (a) => { tabs().broadcastToActive('vkeyboard:cmd', { action: a.action || 'toggle' }); return { ok: true, action: a.action || 'toggle' }; } },
  { name: 'vkeyboard_insert', group: 'browser', description: 'Insert a math or chemistry symbol into the focused home/chat input via the virtual keyboard.',
    parameters: obj({ text: { type: 'string' }, tab: { type: 'string', description: 'Optional tab: math|chem|greek|ops' } }, ['text']),
    run: async (a) => { if (a.tab) tabs().broadcastToActive('vkeyboard:cmd', { action: 'tab', tab: a.tab }); tabs().broadcastToActive('vkeyboard:cmd', { action: 'show' }); tabs().broadcastToActive('vkeyboard:cmd', { action: 'insert', text: String(a.text||'') }); return { ok: true, text: a.text }; } },
  { name: 'vkeyboard_catalog', group: 'browser', description: 'List all math/chemistry virtual keyboard symbols by tab.',
    parameters: obj({}),
    run: async () => ({ tabs: ['math','chem','greek','ops'],
      math: ['π','θ','√','∫','∑','≤','≥','sin','cos','tan','log','ln','∞','∈','→'],
      chem: ['H','C','O','→','⇌','(aq)','⁺','⁻','Δ','pH','H⁺','OH⁻'],
      greek: ['α','β','γ','δ','λ','μ','σ','ω','Δ','Σ','Π'],
      ops: ['+','−','×','÷','±','≈','≠','≤','≥','→','⇒'] }) },
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
  { name: 'kb_list', group: 'knowledge', description: 'List documents stored in the knowledge base.', parameters: obj({}), run: async () => kbMod().list() },
  // ---- bookmarks / downloads / find / zoom
  { name: 'bookmarks_list', group: 'browser', description: 'List saved bookmarks (title, url, time).', parameters: obj({ query: str('optional title/URL filter'), limit: { type: 'number' } }),
    run: async (a) => ({ bookmarks: store.listBookmarks(String(a.query || '')).slice(0, Math.min(100, Number(a.limit) || 30)) }) },
  { name: 'bookmark_add', group: 'browser', description: 'Bookmark a URL (default: the active tab).', parameters: obj({ url: str('http(s) URL; default = active tab'), title: str('optional title') }),
    run: async (a) => { let url = a.url, title = a.title; if (!url) { const t = tabs().activeTab(); if (!t) throw new Error('no active tab'); url = t.wc.getURL(); title = title || t.wc.getTitle(); }
      url = httpUrl(url); if (!store.isBookmarked(url)) store.toggleBookmark(url, title || url); tabs().notify(); return { bookmarked: true, url, title: title || url }; } },
  { name: 'bookmark_remove', group: 'browser', description: 'Remove a bookmark by URL.', parameters: obj({ url: str('exact bookmark URL') }, ['url']),
    run: async (a) => { store.removeBookmark(httpUrl(a.url)); tabs().notify(); return { removed: a.url }; } },
  { name: 'downloads_list', group: 'browser', description: 'List recent downloads (id, name, path, state, received/total bytes).', parameters: obj({ limit: { type: 'number' } }),
    run: async (a) => ({ downloads: store.downloads().slice(0, Math.min(100, Number(a.limit) || 30)).map(d => ({ id: d.id, name: d.name, path: d.path, state: d.state, received: d.received, total: d.total, url: d.url })) }) },
  { name: 'download_open', group: 'browser', description: 'Open a finished download by id (in the OS file manager or default app).', parameters: obj({ id: str('download id'), showFolder: { type: 'boolean', description: 'if true, reveal in folder instead of opening' } }, ['id']),
    run: async (a) => { const { shell } = require('electron'); const r = store.downloads().find(x => x.id === a.id); if (!r) throw new Error('download not found'); if (a.showFolder) shell.showItemInFolder(r.path); else shell.openPath(r.path); return { ok: true, path: r.path }; } },
  { name: 'download_clear', group: 'browser', description: 'Clear the downloads list (does not delete files).', parameters: obj({}),
    run: async () => { const a = store.downloads(); a.splice(0, a.length); store.saveDownloads(); return { cleared: true }; } },
  { name: 'find_in_page', group: 'browser', description: 'Find text in the active tab; opens the find bar. Pass next=true to jump to the next match.', parameters: obj({ text: str('search text'), next: { type: 'boolean' }, forward: { type: 'boolean' } }, ['text']),
    run: async (a) => { const t = needTab(); tabs().showFind(); t.wc.findInPage(String(a.text), { forward: a.forward !== false, findNext: !!a.next }); return { query: a.text }; } },
  { name: 'find_stop', group: 'browser', description: 'Close the find-in-page bar.', parameters: obj({}),
    run: async () => { tabs().closeOverlay('find'); return { closed: true }; } },
  { name: 'zoom_set', group: 'browser', description: 'Change page zoom: dir = +1 zoom in, -1 zoom out, 0 reset to 100%.', parameters: obj({ dir: { type: 'number', description: '+1 / -1 / 0' } }, ['dir']),
    run: async (a) => ({ zoom: tabs().zoom(Number(a.dir)) }) },
  { name: 'zoom_get', group: 'browser', description: 'Get the current zoom factor (1 = 100%).', parameters: obj({}),
    run: async () => ({ zoom: tabs().zoom(null) }) },
  // ---- settings (safe subset — never passwords / API keys)
  { name: 'settings_set', group: 'settings', description: 'Change safe browser settings. Allowed keys: lang ("zh"|"en"), mode ("chat"|"search"), displayName, greeting, search.engine ("bing"|"google"|"baidu"|"duckduckgo"|"custom"), search.custom, agent.maxSteps, translate.engine ("auto"|"hunyuan"|"role"). API keys, passwords and vault data are rejected.',
    parameters: obj({ patch: { type: 'object', description: 'partial settings object' } }, ['patch']),
    run: async (a) => {
      const patch = a.patch || {}; const safe = {};
      if (patch.lang === 'zh' || patch.lang === 'en') safe.lang = patch.lang;
      if (patch.mode === 'chat' || patch.mode === 'search') safe.mode = patch.mode;
      if (typeof patch.displayName === 'string') safe.displayName = patch.displayName.slice(0, 40);
      if (typeof patch.greeting === 'string') safe.greeting = patch.greeting.slice(0, 120);
      if (patch.search && typeof patch.search === 'object') {
        const se = {}; if (['bing','google','baidu','duckduckgo','custom'].includes(patch.search.engine)) se.engine = patch.search.engine;
        if (typeof patch.search.custom === 'string') se.custom = patch.search.custom.slice(0, 300);
        if (Object.keys(se).length) safe.search = se;
      }
      if (patch.agent && typeof patch.agent.maxSteps === 'number') safe.agent = { maxSteps: Math.max(4, Math.min(40, patch.agent.maxSteps|0)) };
      if (patch.translate && typeof patch.translate === 'object') {
        const te = {}; if (['auto','hunyuan','role'].includes(patch.translate.engine)) te.engine = patch.translate.engine;
        if (Object.keys(te).length) safe.translate = te;
      }
      if (!Object.keys(safe).length) throw new Error('no allowed fields in patch (refusing secrets / unknown keys)');
      const s = store.patchSettings(safe); return { applied: safe, lang: s.lang, mode: s.mode, search: s.search, agent: s.agent, translate: s.translate };
    } },
  // ---- Chrome extensions
  { name: 'chrome_ext_list', group: 'extensions', description: 'List installed Chrome / Chromium extensions (id, name, enabled, version).', parameters: obj({}),
    run: async () => ({ chrome: require('../ext/chrome').list() }) },
  { name: 'chrome_ext_set_enabled', group: 'extensions', description: 'Enable or disable a Chrome extension by id.', parameters: obj({ id: str('chrome extension id'), enabled: { type: 'boolean' } }, ['id', 'enabled']),
    run: async (a) => { await require('../ext/chrome').setEnabled(a.id, !!a.enabled); return { id: a.id, enabled: !!a.enabled }; } },
  { name: 'chrome_ext_remove', group: 'extensions', description: 'Uninstall a Chrome extension by id.', parameters: obj({ id: str('chrome extension id') }, ['id']),
    run: async (a) => { await require('../ext/chrome').remove(a.id); return { removed: a.id }; } },
  { name: 'chrome_ext_install_store', group: 'extensions', description: 'Install a Chrome extension from the Chrome Web Store by extension id or store URL.', parameters: obj({ input: str('extension id or chromewebstore URL') }, ['input']),
    run: async (a) => require('../ext/chrome').installFromStore(String(a.input || '')) },
  // ---- knowledge base delete
  { name: 'kb_delete', group: 'knowledge', description: 'Delete a document from the knowledge base by id (from kb_list).', parameters: obj({ id: str('document id') }, ['id']),
    run: async (a) => kbMod().remove(String(a.id)) },
  { name: 'kb_clear', group: 'knowledge', description: 'Delete ALL documents from the knowledge base. Irreversible.', parameters: obj({ confirm: { type: 'boolean', description: 'must be true' } }, ['confirm']),
    run: async (a) => { if (!a.confirm) throw new Error('pass confirm=true'); return kbMod().clear(); } },
  // ---- model management (local catalog; never touches passwords)
  { name: 'models_list', group: 'models', description: 'List local-model catalog entries (id, family, name, engine, downloaded, size).', parameters: obj({}),
    run: async () => ({ models: require('./local').listModels(store.getSettings().ai.local).map(m => ({ id: m.id, family: m.family, name: m.name || m.display, engine: m.engine, downloaded: !!m.downloaded, size: m.size, path: m.path || '' })) }) },
  { name: 'model_download', group: 'models', description: 'Start downloading a local model by catalog id (runs in background; progress appears in Settings).', parameters: obj({ id: str('model id from models_list') }, ['id']),
    run: async (a) => { require('./local').download(a.id, () => {}).catch(() => {}); return { started: a.id }; } },
  { name: 'model_cancel', group: 'models', description: 'Cancel an in-progress model download.', parameters: obj({ id: str('model id') }, ['id']),
    run: async (a) => { require('./local').cancelDownload(a.id); return { cancelled: a.id }; } },
  { name: 'model_delete', group: 'models', description: 'Delete a downloaded local model file by id.', parameters: obj({ id: str('model id') }, ['id']),
    run: async (a) => { require('./local').deleteModel(a.id); return { deleted: a.id }; } },
  { name: 'model_select', group: 'models', description: 'Select a downloaded local model as the chat model (sets ai.source=local).', parameters: obj({ id: str('model id') }, ['id']),
    run: async (a) => {
      const local = require('./local'); const ent = local.findEntry(a.id); if (!ent) throw new Error('unknown model');
      const path = local.modelPathOf(ent); if (!path || !require('fs').existsSync(path)) throw new Error('model not downloaded yet');
      const s = store.patchSettings({ ai: { source: 'local', local: { modelId: a.id, modelPath: path } } });
      return { selected: a.id, path, source: s.ai.source };
    } }

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
