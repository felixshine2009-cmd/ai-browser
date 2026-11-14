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

const INTERNAL_PAGES = ['home', 'settings', 'extensions', 'history', 'bookmarks', 'downloads', 'onboarding', 'selfmod'];
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
  { name: 'code_propose_patch', group: 'browser', description: 'Propose a sandboxed code patch (renderer / builtin extensions / web / docs only). Never overwrites the app bundle; never touches passwords or secrets. Returns a diff for the user to approve in the Self-mod page.',
    parameters: obj({ title: str('short title'), description: str('why'), files: { type: 'array', items: { type: 'object', properties: { path: str('relative path e.g. src/renderer/static/home.js'), content: str('full new file content'), action: { type: 'string', enum: ['modify','create','delete'] } }, required: ['path'] } } }, ['files']),
    run: async (a) => { const selfmod = require('../selfmod'); const r = selfmod.propose(a || {}); tabs().openInternal('selfmod'); return r; } },
  { name: 'code_pending_patch', group: 'browser', description: 'Show the pending patch waiting for user approval (diff preview).',
    parameters: obj({}), run: async () => { const selfmod = require('../selfmod'); return selfmod.pending() || { empty: true }; } },
  { name: 'code_list_patches', group: 'browser', description: 'List patch history (applied / rejected / rolled back).',
    parameters: obj({}), run: async () => require('../selfmod').history() },
  { name: 'code_rollback', group: 'browser', description: 'One-click rollback of an applied patch by id (restores previous overlay content). Requires the user to have applied it before.',
    parameters: obj({ id: str('patch id') }, ['id']),
    run: async (a) => { const r = require('../selfmod').rollback(a.id); tabs().openInternal('selfmod'); return r; } },
  { name: 'code_safe_mode', group: 'browser', description: 'Enable or disable safe mode (disables all overlays after launch failures).',
    parameters: obj({ enabled: { type: 'boolean' } }, ['enabled']),
    run: async (a) => require('../selfmod').setSafeMode(!!a.enabled) },
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
    run: async (a) => { const llm = require('./llm'), P = require('./prompts'); const local = llm.activeSource() === 'local';
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
  { name: 'history_clear', group: 'browser', description: 'Clear browsing history (range: hour | day | all). The USER is always shown a confirmation dialog with the item count; if they decline nothing is deleted. Never claim history was cleared unless the result says cleared>0.', parameters: obj({ range: { type: 'string', enum: ['hour', 'day', 'all'], description: 'default all' } }),
    run: async (a) => {
      const range = ['hour', 'day', 'all'].includes(a.range) ? a.range : 'all';
      const n = store.countHistory(range);
      if (!n) return { cleared: 0, note: 'nothing to clear' };
      const lbl = { hour: ['最近一小时', 'last hour'], day: ['最近 24 小时', 'last 24 hours'], all: ['全部', 'all time'] }[range];
      const ok = await require('../confirm').ask({ host: 'history', danger: true,
        title: { zh: '清除历史记录？（AI 请求）', en: 'Clear history? (requested by AI)' },
        message: { zh: `AI 助手请求删除【${lbl[0]}】的 ${n} 条历史记录。`, en: `The AI assistant asks to delete ${n} history entries (${lbl[1]}).` },
        detail: { zh: '此操作无法撤销。', en: 'This cannot be undone.' }, confirmText: { zh: '确认清除', en: 'Confirm clear' } });
      if (!ok) return { cleared: 0, declined: true, note: 'user declined' };
      const removed = store.clearHistory(range); try { for (const wc of require('electron').webContents.getAllWebContents()) if (!wc.isDestroyed() && (wc.getURL() || '').startsWith('aibrowser://')) wc.send('history:changed'); } catch {}
      return { cleared: removed, range };
    } },
  // ---- local model downloads + disk (v3.3.0). Delete / clear tools ALWAYS show the user's confirmation dialog first.
  { name: 'local_models_download', group: 'models', description: 'Start (or resume) downloading a local model by catalog id (see models_list). Resumes from the .part file; retries automatically.', parameters: obj({ id: str('model id') }, ['id']),
    run: async (a) => ({ id: String(a.id), ...require('./local').startDownload(String(a.id)) }) },
  { name: 'local_models_pause', group: 'models', description: 'Pause a running model download (the partial file is kept; resume later).', parameters: obj({ id: str('model id') }, ['id']),
    run: async (a) => ({ id: String(a.id), paused: require('./local').pauseDownload(String(a.id)) }) },
  { name: 'local_models_resume', group: 'models', description: 'Resume a paused / interrupted model download from where it stopped.', parameters: obj({ id: str('model id') }, ['id']),
    run: async (a) => ({ id: String(a.id), ...require('./local').startDownload(String(a.id)) }) },
  { name: 'local_models_status', group: 'models', description: 'Download status of local models: downloading, partial bytes (paused / interrupted), downloaded.', parameters: obj({}),
    run: async () => { const hub = require('./hub'); return { models: require('./local').listModels(store.getSettings().ai.local).filter(m => m.downloaded || m.partial || hub.isActive(m.id)).map(m => ({ id: m.id, name: m.name, downloaded: !!m.downloaded, downloading: hub.isActive(m.id), partialBytes: m.partial || 0, totalBytes: m.bytes || 0 })) }; } },
  { name: 'local_models_disk_usage', group: 'models', description: 'Disk usage of local models split into model files vs cache (unfinished .part downloads, temp files, runtime caches, embedding index), plus totals and read-only locations of external frameworks.', parameters: obj({}),
    run: async () => { const u = require('./disk').usage(); return { totals: u.totals, modelsDir: u.modelsDir, external: u.external, models: u.models.map(r => ({ id: r.id, name: r.name, filesBytes: r.files, cacheBytes: r.cache, downloaded: r.downloaded, roles: r.roles })) }; } },
  { name: 'local_models_clear_cache', group: 'models', description: 'Clear the CACHE of one model (id) or of all models (omit id). Keeps the model usable. Always asks the user to confirm in a dialog.', parameters: obj({ id: str('model id; omit for all models') }),
    run: async (a) => {
      const disk = require('./disk'); const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(1) + ' MB');
      const u = disk.usage(); const rows = a.id ? u.models.filter(r => r.id === String(a.id)) : u.models; if (a.id && !rows.length) throw new Error('unknown or empty model: ' + a.id);
      const bytes = a.id ? rows[0].cache : u.totals.cache; if (!bytes) return { freed: 0, note: 'no cache to clear' };
      const who = a.id ? rows[0].name : null;
      const ok = await require('../confirm').ask({ host: 'settings', title: { zh: '清理模型缓存？（AI 请求）', en: 'Clear model cache? (requested by AI)' },
        message: { zh: `将清理${who ? '「' + who + '」' : '所有模型'}的缓存，释放约 ${fmt(bytes)}。模型文件会保留。`, en: `Clear the cache of ${who ? '"' + who + '"' : 'all models'}, freeing about ${fmt(bytes)}. Model files are kept.` },
        detail: { zh: '包括未完成的下载（.part）、临时文件和运行时缓存。', en: 'Includes unfinished downloads (.part), temp files and runtime caches.' }, confirmText: { zh: '确认清理', en: 'Confirm clear' } });
      if (!ok) return { freed: 0, declined: true, note: 'user declined' };
      const r = a.id ? await disk.clearCache(String(a.id)) : await disk.clearAllCache(); return { freed: r.freed, freedText: fmt(r.freed) };
    } },
  { name: 'local_models_delete', group: 'models', description: 'Delete the downloaded FILES of a local model (frees the most space; needs re-download). Unloads the model, clears its role assignment. ALWAYS asks the user to confirm in a dialog; never deletes external frameworks\' files.', parameters: obj({ id: str('model id') }, ['id']),
    run: async (a) => {
      const disk = require('./disk'); const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(1) + ' MB');
      const m = require('./local').findEntry(String(a.id)); if (!m) throw new Error('unknown model: ' + a.id);
      const r0 = disk.entryUsage(m); if (!r0.files && !r0.cache) return { freed: 0, note: 'nothing downloaded' };
      const roles = r0.roles.length ? { zh: `\n该模型当前担任：${r0.roles.join('、')}，删除后这些角色将被清空。`, en: `\nIt is currently assigned to: ${r0.roles.join(', ')}; those roles will be cleared.` } : { zh: '', en: '' };
      const ok = await require('../confirm').ask({ host: 'settings', title: { zh: '删除模型文件？（AI 请求）', en: 'Delete model files? (requested by AI)' },
        message: { zh: `将删除「${m.name}」的模型文件，释放约 ${fmt(r0.files + r0.cache)}，需要重新下载才能再次使用。` + roles.zh, en: `Delete the files of "${m.name}", freeing about ${fmt(r0.files + r0.cache)}. You must download it again to use it.` + roles.en },
        detail: { zh: '此操作无法撤销。', en: 'This cannot be undone.' }, confirmText: { zh: '确认删除', en: 'Confirm delete' } });
      if (!ok) return { freed: 0, declined: true, note: 'user declined' };
      const r = await disk.deleteFiles(String(a.id)); return { deleted: m.id, freed: r.freed, freedText: fmt(r.freed), rolesCleared: r.rolesCleared, needsKnowledgeBase: r.needsKb };
    } },
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
    } },
  { name: 'chat_models_list', group: 'models', description: 'List the chat models enabled in the model switcher, grouped by provider, and the current model.', parameters: obj({}),
    run: async () => { const p = require('./models').picker({}); return { current: p.current, groups: p.groups.map(g => ({ provider: g.id, name: g.name, models: g.models.map(m => m.id) })) }; } },
  { name: 'chat_models_refresh', group: 'models', description: "Fetch a provider's model list from its official list endpoint (falls back to the built-in list when unavailable).", parameters: obj({ provider: str('provider id, e.g. openai, deepseek, anthropic, gemini, ollama') }, ['provider']),
    run: async (a) => require('./models').refresh(String(a.provider)) },
  { name: 'chat_model_use', group: 'models', description: 'Make an enabled model the current chat model for new conversations.', parameters: obj({ provider: str('provider id, or "local"'), model: str('model id') }, ['provider', 'model']),
    run: async (a) => { require('./models').select({ provider: String(a.provider), model: String(a.model) }); return { current: require('./models').picker({}).current }; } }

];
try { for (const t of require('../v36/extra-tools')) BUILTIN.push(t); } catch (e) { console.error('v36 tools', e.message); }
// v3.0.0 unified registry: every browser capability the user has in the UI is also a tool for task mode
const ipc = (ch, ...a) => { if (typeof global.__aibIpc !== 'function') throw new Error('browser actions are not available'); return global.__aibIpc(ch, ...a); };
const TOOL_VIEWS = ['solve', 'geogebra', 'physics', 'wiki', 'dict', 'code', 'readlater'];
BUILTIN.push(
  { name: 'tool_open', group: 'workspace', description: 'Open one of the browser\'s tool views next to the tabs: solve (step-by-step problem solver), geogebra, physics (simulations), wiki (offline encyclopedia), dict (dictionary), code (editor + files), readlater (saved pages). Optional url opens a specific page inside the tool.',
    parameters: obj({ tool: { type: 'string', enum: TOOL_VIEWS }, url: str('optional aibrowser://tool?… URL') }, ['tool']),
    run: async (a) => { const id = String(a.tool || ''); if (!TOOL_VIEWS.includes(id)) throw new Error('unknown tool view: ' + id); await ipc('tool:open', id, a.url || null); return { ok: true, opened: id }; } },
  { name: 'tool_close', group: 'workspace', description: 'Close a tool view (or hide the visible one when tool is omitted) and return to the web page.',
    parameters: obj({ tool: { type: 'string', enum: TOOL_VIEWS } }),
    run: async (a) => { if (a.tool) await ipc('tool:close', a.tool); else await ipc('tool:hide'); return { ok: true }; } },
  { name: 'split_view', group: 'workspace', description: 'Split view: show two tabs side by side. action toggle (optionally with other_tab_id), swap the two sides, ratio (0.2–0.8 width of the left side) or state.',
    parameters: obj({ action: { type: 'string', enum: ['toggle', 'swap', 'ratio', 'state'] }, other_tab_id: { type: 'number' }, ratio: { type: 'number' } }, ['action']),
    run: async (a) => {
      if (a.action === 'toggle') await ipc('split:toggle', a.other_tab_id != null ? Number(a.other_tab_id) : undefined);
      else if (a.action === 'swap') await ipc('split:swap');
      else if (a.action === 'ratio') await ipc('split:ratio', Math.min(0.8, Math.max(0.2, Number(a.ratio) || 0.5)));
      return { split: tabs().state().split };
    } },
  { name: 'spaces', group: 'workspace', description: 'Spaces group tabs by subject. action list | switch (id) | add (name) | remove (id) | move (tab_id to space id).',
    parameters: obj({ action: { type: 'string', enum: ['list', 'switch', 'add', 'remove', 'move'] }, id: str('space id ("main" is the default space)'), name: str('new space name'), tab_id: { type: 'number' } }, ['action']),
    run: async (a) => {
      if (a.action === 'switch') await ipc('space:switch', a.id || 'main');
      else if (a.action === 'add') await ipc('space:add', String(a.name || '').slice(0, 40) || '新空间');
      else if (a.action === 'remove') await ipc('space:remove', a.id);
      else if (a.action === 'move') await ipc('space:move', Number(a.tab_id), a.id);
      return { spaces: tabs().state().spaces };
    } },
  { name: 'readlater', group: 'workspace', description: 'Read later / offline copies. action save (a tab, default active: stores an offline copy), list, search (query), open (id), remove (id).',
    parameters: obj({ action: { type: 'string', enum: ['save', 'list', 'search', 'open', 'remove'] }, id: str('saved item id'), tab_id: { type: 'number' }, query: str('search text') }, ['action']),
    run: async (a) => {
      if (a.action === 'save') return ipc('readlater:save', a.tab_id != null ? Number(a.tab_id) : (tabs().activeTab() || {}).id);
      if (a.action === 'search') return clip(await ipc('readlater:search', String(a.query || '')), 8000);
      if (a.action === 'open') return { ok: await ipc('readlater:open', String(a.id || '')) };
      if (a.action === 'remove') return { ok: !!(await ipc('readlater:remove', String(a.id || ''))) };
      const l = await ipc('readlater:list'); return (Array.isArray(l) ? l : []).slice(0, 50).map(x => ({ id: x.id, title: x.title, url: x.url, read: !!x.read }));
    } },
  { name: 'page_assistant', group: 'browser', description: 'Page assistant on the active tab: kind summary (one-tap summary) or ask (question about the page). Answers cite numbered passages of the page.',
    parameters: obj({ kind: { type: 'string', enum: ['summary', 'ask'] }, question: str('question for kind=ask') }, ['kind']),
    run: async (a) => { const r = await ipc('siri:ask', a.kind === 'ask' ? 'ask' : 'summary', String(a.question || '')); return clip(r, 8000); } },
  { name: 'page_screenshot', group: 'browser', description: 'Take a screenshot of a tab (default: active) and look at it (returned as an image).',
    parameters: obj({ id: { type: 'number' } }),
    run: async (a) => {
      const t = needTab(a.id); const img = await t.wc.capturePage();
      const sz = img.getSize ? img.getSize() : {}; const scaled = sz.width > 1280 && img.resize ? img.resize({ width: 1280 }) : img;
      const url = 'data:image/png;base64,' + scaled.toPNG().toString('base64');
      return { ok: true, tab: tabRow(t), size: sz, images: [{ name: 'tab.png', dataUrl: url }], modelImages: [url] };
    } },
  { name: 'appearance_set', group: 'settings', description: 'Switch the appearance: light, dark or follow the system.',
    parameters: obj({ mode: { type: 'string', enum: ['light', 'dark', 'system'] } }, ['mode']),
    run: async (a) => { const mode = ['light', 'dark', 'system'].includes(a.mode) ? a.mode : 'system'; await ipc('settings:patch', { appearance: Object.assign({}, store.getSettings().appearance, { mode }) }); return { ok: true, mode }; } },
  { name: 'snap_solve', group: 'workspace', description: 'iPad: take a photo of a problem with the camera, recognise the text and solve it in the solve tool.',
    parameters: obj({}), run: async () => ipc('snap:solve') },
  { name: 'scan_qr', group: 'workspace', description: 'iPad: scan a QR code with the camera; web addresses are opened.',
    parameters: obj({}), run: async () => ipc('scan:qr') }
);
try { for (const t of require('./compute-tools').TOOLS) BUILTIN.push(t); } catch (e) { console.error('compute tools', e.message); }

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
  const firstLine = (c) => String(c || '').split('\n').map(x => x.trim()).filter(x => x && !x.startsWith('#') && !/^(import|from) /.test(x))[0] || String(c || '').split('\n')[0];
  const key = (a.code && firstLine(a.code)) || a.command || (Array.isArray(a.packages) && a.packages.join(' ')) || a.path || a.url || a.query || a.word || a.page || a.text || a.sentence || a.id || (a.commands && a.commands.length + ' cmd') || (a.scene && 'scene') || '';
  let tail = '';
  if (result && result.error) tail = ' ✕ ' + j(result.error).split('\n').filter(Boolean).slice(-1)[0].slice(0, 80);
  else if (result && typeof result.exitCode === 'number' && result.exitCode !== 0) tail = ' ✕ exit ' + result.exitCode;
  return (name + (key !== '' ? ' · ' + j(key).replace(/\s+/g, ' ').slice(0, 48) : '')) + tail;
}

// formal Chinese names for the chat UI's tool-call cards
const LABELS = {
  web_search: '网页搜索', open_page: '阅读网页', browser_list_tabs: '列出标签页', browser_open_tab: '打开标签页', browser_close_tab: '关闭标签页', browser_switch_tab: '切换标签页',
  browser_navigate: '页面导航', browser_open_page: '打开内置页面', browser_read_page: '读取页面', browser_history_search: '搜索历史记录', browser_print: '打印', browser_save_pdf: '存储为 PDF',
  code_propose_patch: '提出代码修改', code_pending_patch: '待确认修改', code_list_patches: '修改记录', code_rollback: '回滚修改', code_safe_mode: '安全模式',
  vkeyboard_toggle: '数学 / 化学键盘', vkeyboard_insert: '输入符号', vkeyboard_catalog: '键盘符号表',
  extensions_list: '功能拓展列表', extension_set_enabled: '启用 / 停用拓展', settings_get: '读取设置', settings_set: '修改设置',
  dictionary_lookup: '查词典', translate_text: '翻译', analyze_sentence: '句子分析', kb_search: '知识库检索', kb_add_text: '存入知识库', kb_list: '知识库文档', kb_delete: '删除知识库文档', kb_clear: '清空知识库',
  bookmarks_list: '书签列表', bookmark_add: '添加书签', bookmark_remove: '删除书签', downloads_list: '下载列表', download_open: '打开下载', download_clear: '清空下载列表',
  find_in_page: '页面查找', find_stop: '关闭查找', zoom_set: '缩放页面', zoom_get: '读取缩放', history_clear: '清除历史记录',
  chrome_ext_list: 'Chrome 扩展列表', chrome_ext_set_enabled: '启用 / 停用 Chrome 扩展', chrome_ext_remove: '卸载 Chrome 扩展', chrome_ext_install_store: '安装 Chrome 扩展',
  local_models_download: '下载本地模型', local_models_pause: '暂停下载', local_models_resume: '继续下载', local_models_status: '模型下载状态', local_models_disk_usage: '模型占用空间',
  local_models_clear_cache: '清理模型缓存', local_models_delete: '删除本地模型', models_list: '本地模型列表', model_download: '下载模型', model_cancel: '取消下载', model_delete: '删除模型', model_select: '选用本地模型',
  chat_models_list: '对话模型列表', chat_models_refresh: '刷新模型列表', chat_model_use: '切换对话模型',
  tool_open: '打开工具', tool_close: '关闭工具', split_view: '分屏', spaces: '空间', readlater: '稍后阅读', page_assistant: '页面助手', page_screenshot: '页面截图',
  appearance_set: '外观', snap_solve: '拍题即解', scan_qr: '扫码',
  python_run: '运行 Python', python_install: '安装 Python 包', vm_shell: '虚拟机命令', vm_read_file: '读取虚拟机文件', vm_write_file: '写入虚拟机文件', vm_pkg: '虚拟机软件包', vm_control: '虚拟机控制', vm_upload: '上传到虚拟机', vm_download: '从虚拟机下载', vm_status: '虚拟机状态', vm_click: '虚拟机点击', vm_desktop: '虚拟机桌面', vm_drag: '虚拟机拖动', vm_key: '虚拟机按键', vm_screenshot: '虚拟机截图', vm_scroll: '虚拟机滚动', vm_type: '虚拟机输入',
  hs_calc: '计算器', wiki_search: '百科搜索', wiki_translate: '百科翻译', collab_note: '协作笔记', browser_click: '点击页面元素', browser_type: '在页面中输入', kernel_check: '运行环境检查',
  ggb_eval: 'GeoGebra 作图', ggb_clear: '清空 GeoGebra', ggb_export_png: '导出 GeoGebra 图片', ggb_set_app: '切换 GeoGebra 应用', ggb_save: '保存 GeoGebra 文件', ggb_load: '载入 GeoGebra 文件', ggb_keyboard: 'GeoGebra 键盘', ggb_state: 'GeoGebra 对象',
  phys_load: '载入物理场景', phys_play: '播放仿真', phys_pause: '暂停仿真', phys_step: '单步仿真', phys_state: '仿真状态', phys_validate: '检查物理场景', phys_reset: '重置仿真', phys_set_speed: '仿真速度', phys_list_examples: '物理示例列表', phys_load_example: '载入物理示例', phys_set_param: '设置物理参数', phys_update: '更新物理场景', phys_list_params: '物理参数列表', phys_add_element: '添加物理元件', phys_update_element: '修改物理元件', phys_remove_element: '删除物理元件', phys_list_element_types: '物理元件类型', phys_define_custom_element: '自定义物理元件', phys_new_scene: '新建物理场景', phys_get_elements: '物理场景元件'
};
const GROUP_LABELS = { web: '网页', browser: '浏览器', workspace: '工具与工作区', extensions: '拓展', settings: '设置', language: '语言', knowledge: '知识库', models: '模型', compute: '计算' };
function label(name) {
  if (LABELS[name]) return LABELS[name];
  const t = features.listTools().find(x => x.name === name);
  const zh = t && t.label; return zh || name;
}
/** what the agent can do, for the UI: [{ name, label, group, groupLabel, source }] */
function catalog() { return all({ web: true }).map(t => ({ name: t.name, label: label(t.name), group: t.group, groupLabel: GROUP_LABELS[t.group] || t.group, source: t.source })); }

module.exports = { all, call, isExternal, summarize, BUILTIN, WEB, def, clip, label, catalog, LABELS };
