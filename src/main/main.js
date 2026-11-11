'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, protocol, ipcMain, session, dialog, Menu, shell, webContents, net, systemPreferences } = require('electron');

if (process.env.AIB_USER_DATA) app.setPath('userData', process.env.AIB_USER_DATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'aibrowser', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'aibdict', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'aibext', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'aibzim', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const store = require('./store');
const tabsMod = require('./tabs');
const chat = require('./ai/chat');
const llm = require('./ai/llm');
const features = require('./ext/features');
const chromeExt = require('./ext/chrome');
const dict = require('./dict/mdict');
const selfmod = require('./selfmod');

const RENDERER = path.join(__dirname, '..', 'renderer');
const PAGES = new Set(['chrome', 'home', 'chat', 'settings', 'extensions', 'history', 'bookmarks', 'downloads', 'menu', 'find', 'lookup', 'onboarding', 'selfmod', 'tool', 'siri']);
const MIME = { html: 'text/html; charset=utf-8', js: 'application/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', wasm: 'application/wasm', mjs: 'application/javascript', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon', ttf: 'font/ttf', woff: 'font/woff', txt: 'text/plain', map: 'application/json', xml: 'text/xml', mp3: 'audio/mpeg', ogg: 'audio/ogg' };
const mimeOf = f => MIME[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream';
const fileResponse = (f) => new Response(fs.readFileSync(f), { headers: { 'Content-Type': mimeOf(f), 'Access-Control-Allow-Origin': '*' } });

// ------------------------------------------------------------ protocols
function registerProtocols(proto = protocol) {
  proto.handle('aibrowser', (req) => {
    const u = new URL(req.url);
    let f = null;
    if (u.hostname === 'static') {
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      const ov = selfmod.resolveOverlay('static/' + rel) || selfmod.resolveOverlay('src/renderer/static/' + rel);
      if (ov) f = ov;
      else {
        const full = path.resolve(RENDERER, 'static', rel);
        if (full.startsWith(path.join(RENDERER, 'static') + path.sep) && fs.existsSync(full)) f = full;
      }
    } else if (PAGES.has(u.hostname)) {
      const ov = selfmod.resolveOverlay('pages/' + u.hostname + '.html') || selfmod.resolveOverlay('src/renderer/pages/' + u.hostname + '.html');
      f = ov || path.join(RENDERER, 'pages', u.hostname + '.html');
    }
    if (!f) return new Response('Not found', { status: 404 });
    return fileResponse(f);
  });
  proto.handle('aibdict', (req) => dict.handleProtocol(req));
  proto.handle('aibext', (req) => {
    const u = new URL(req.url);
    const id = u.hostname;
    if (u.pathname === '/__sdk.js') return new Response(SDK_JS(id), { headers: { 'Content-Type': 'application/javascript' } });
    const f = features.fileFor(id, u.pathname);
    if (!f) return new Response('Not found', { status: 404 });
    return fileResponse(f);
  });
  proto.handle('aibzim', async (req) => {
    try {
      const u = new URL(req.url);
      let zp = decodeURIComponent((u.pathname || '').replace(/^\/+/, ''));
      if (u.hostname && u.hostname !== 'zim') zp = u.hostname + (zp ? '/' + zp : '');
      const zim = require('./wiki/zim');
      const item = await zim.getByPath(zp);
      if (!item || !item.data) return new Response('Not found', { status: 404 });
      return new Response(Buffer.from(item.data), { headers: { 'Content-Type': item.mime || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' } });
    } catch (err) {
      return new Response(String(err && err.message || err), { status: 500 });
    }
  });
}
const SDK_JS = (id) => `(function(){var EXT=${JSON.stringify(id)},n=0,pend={},rr;
try{var st=document.createElement('style');st.textContent='html{color-scheme:dark}';(document.head||document.documentElement).appendChild(st)}catch(e){}
window.aibExt={ext:EXT,ready:new Promise(function(r){rr=r}),call:function(name,args){return new Promise(function(res,rej){var i=++n;pend[i]={res:res,rej:rej};parent.postMessage({aibExtCall:i,ext:EXT,name:name,args:args||{}},'*')})}};
window.addEventListener('message',function(e){var m=e.data;if(e.source!==parent||!m)return;
 if(m.aibExtReply&&pend[m.aibExtReply]){var p=pend[m.aibExtReply];delete pend[m.aibExtReply];m.error?p.rej(new Error(m.error)):p.res(m.result)}
 if(m.aibExtInit)rr(m.info)});
parent.postMessage({aibExtHello:true,ext:EXT},'*');})();`;

// ------------------------------------------------------------ helpers
function pick(opts) {
  // test hook: a JSON file listing the paths to "pick"
  const tf = process.env.AIB_TEST_PICK_FILE;
  if (tf && fs.existsSync(tf)) { try { return JSON.parse(fs.readFileSync(tf, 'utf8')); } catch {} }
  const r = dialog.showOpenDialogSync(tabsMod.getWin() || undefined, opts);
  return r || [];
}

function broadcast(channel, payload) {
  for (const wc of webContents.getAllWebContents()) {
    try { if (!wc.isDestroyed() && (wc.getURL() || '').startsWith('aibrowser://')) wc.send(channel, payload); } catch {}
  }
}

// ------------------------------------------------------------ downloads
const dlItems = new Map();
function setupDownloads(ses = session.defaultSession) {
  ses.on('will-download', (e, item) => {
    const dir = process.env.AIB_DOWNLOAD_DIR || app.getPath('downloads');
    fs.mkdirSync(dir, { recursive: true });
    let name = item.getFilename() || 'download';
    let dest = path.join(dir, name);
    for (let i = 1; fs.existsSync(dest); i++) { const ext = path.extname(name); dest = path.join(dir, path.basename(name, ext) + ` (${i})` + ext); }
    item.setSavePath(dest);
    const rec = { id: 'dl' + Date.now() + Math.random().toString(36).slice(2, 6), url: item.getURL(), filename: path.basename(dest), path: dest, received: 0, total: item.getTotalBytes(), state: 'progressing', time: Date.now() };
    dlItems.set(rec.id, item);
    store.downloads().unshift(rec);
    const push = () => { broadcast('downloads:changed'); };
    item.on('updated', (ev, st) => { rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes(); rec.state = st === 'interrupted' ? 'interrupted' : (item.isPaused() ? 'paused' : 'progressing'); push(); });
    item.once('done', (ev, st) => { if (process.env.AIB_DEBUG_DL) console.log('DLDONE', st, dest, fs.existsSync(dest), item.getSavePath()); rec.state = st; rec.received = item.getReceivedBytes(); dlItems.delete(rec.id); store.saveDownloads(); push(); });
    push();
    const par = require('./v36/parallel');
    par.takeover({ url: item.getURL(), dest: dest + '.mtfile', normalWrite: async () => {} }).then(r => {
      if (r.mode !== 'multithread') return;
      try { item.cancel(); } catch {}
      try { if (fs.existsSync(dest + '.mtfile')) fs.renameSync(dest + '.mtfile', dest); } catch {}
      rec.path = dest; rec.state = 'completed'; rec.received = r.bytes; rec.total = r.bytes; rec.multithread = true;
      store.saveDownloads(); push();
    }).catch(() => {});
  });
}

// ------------------------------------------------------------ panel calls (feature-ext tools -> page iframes)
const panelPending = new Map();
let panelSeq = 0;
function callPanel(ctx, extId, panelId, method, args) {
  return new Promise((resolve, reject) => {
    const wc = ctx && ctx.wcId != null ? webContents.fromId(ctx.wcId) : null;
    if (!wc || wc.isDestroyed()) return reject(new Error('没有可用的页面来显示面板'));
    const reqId = 'p' + (++panelSeq);
    const t = setTimeout(() => { panelPending.delete(reqId); reject(new Error('面板调用超时')); }, 70000);
    panelPending.set(reqId, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    wc.send('panel:call', { reqId, extId, panelId, method, args });
  });
}

// ------------------------------------------------------------ IPC
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    const url = (e.senderFrame && e.senderFrame.url) || '';
    if (!url.startsWith('aibrowser://')) throw new Error('forbidden');
    try { return await fn(e, ...args); } catch (err) { throw new Error(String(err && err.message || err)); }
  });
}

function registerIpc() {
  // settings & AI
  handle('settings:get', () => store.publicSettings());
  handle('settings:patch', (e, patch) => { const s = store.patchSettings(patch); broadcast('settings:changed', s); tabsMod.notify(); return s; });
  handle('selfmod:pending', () => selfmod.pending());
  handle('selfmod:history', () => selfmod.history());
  handle('selfmod:propose', (e, patch) => selfmod.propose(patch || {}));
  handle('selfmod:apply', (e, id) => { const r = selfmod.apply(id); broadcast('selfmod:changed', selfmod.readState()); return r; });
  handle('selfmod:reject', (e, id) => { const r = selfmod.reject(id); broadcast('selfmod:changed', selfmod.readState()); return r; });
  handle('selfmod:rollback', (e, id) => { const r = selfmod.rollback(id); broadcast('selfmod:changed', selfmod.readState()); return r; });
  handle('selfmod:state', () => selfmod.readState());
  handle('selfmod:setSafeMode', (e, on) => { const r = selfmod.setSafeMode(on); broadcast('selfmod:changed', selfmod.readState()); return r; });
  handle('selfmod:read', (e, rel) => ({ path: rel, content: selfmod.readCurrent(rel) }));
  handle('ai:presets', () => llm.PRESETS);
  handle('ai:test', async (e, cfg) => {
    const r = await llm.testConnection(cfg);
    // a successful test also refreshes that provider's cached model list
    if (r && r.ok && r.via === 'models' && cfg && cfg.preset) { try { await modelsM().refresh(cfg.preset, cfg); broadcast('settings:changed', store.publicSettings()); } catch {} }
    return r;
  });
  // model lists per provider + the model switcher
  const modelsM = () => require('./ai/models');
  const modelsChanged = () => { const s = store.publicSettings(); broadcast('settings:changed', s); broadcast('models:changed', {}); tabsMod.notify(); return s; };
  handle('models:refresh', async (e, pid, override) => { const r = await modelsM().refresh(String(pid || 'custom'), override || {}); modelsChanged(); return r; });
  handle('models:setEnabled', (e, pid, ids, on) => { if (pid === 'local') modelsM().setLocalEnabled(ids, !!on); else modelsM().setEnabled(String(pid), ids, !!on); modelsChanged(); return true; });
  handle('models:add', (e, pid, id) => { modelsM().addManual(String(pid), String(id || '')); modelsChanged(); return true; });
  handle('models:remove', (e, pid, id) => { modelsM().remove(String(pid), String(id || '')); modelsChanged(); return true; });
  // which thinking fields each model gets (same mapping as chat requests), for the settings list
  handle('models:hints', (e, pid) => {
    const v36m = require('./v36/v36'); const p = (store.getSettings().ai.providers || {})[pid] || {}; const out = {};
    for (const m of p.models || []) { try { out[m.id] = Object.keys(v36m.reasoningFields('medium', { provider: pid, preset: pid, model: m.id, baseUrl: p.baseUrl, format: p.format, caps: llm.modelCaps(pid, m.id) }) || {}).filter(k => k !== 'max_tokens'); } catch { out[m.id] = []; } }
    return out;
  });
  handle('models:local', async (e, force) => { if (force) await modelsM().detectFw(true); return modelsM().localList(); });
  handle('models:picker', async (e, sid) => {
    modelsM().detectFw(false).then((l) => { if (l && l.some(f => f.up)) broadcast('models:changed', {}); }).catch(() => {});
    const s = sid ? chat.get(sid) : null;
    return modelsM().picker({ threadId: s ? (s.threadId || s.sid) : '' });
  });
  handle('models:select', (e, ref, sid) => {
    if (sid) { const s = chat.get(sid); if (s) { modelsM().setThreadModel(s.threadId || s.sid, ref); broadcast('models:changed', {}); return modelsM().picker({ threadId: s.threadId || s.sid }); } }
    modelsM().select(ref); modelsChanged(); return modelsM().picker({});
  });
  handle('engines:list', () => store.ENGINES);

  // tabs / navigation
  handle('tab:new', () => { tabsMod.createTab(); return true; });
  handle('tab:close', (e, id) => { tabsMod.closeTab(id); return true; });
  handle('tab:activate', (e, id) => { tabsMod.activateTab(id); return true; });
  handle('nav:back', () => { tabsMod.activeTab()?.wc.navigationHistory.goBack(); });
  handle('nav:forward', () => { tabsMod.activeTab()?.wc.navigationHistory.goForward(); });
  handle('nav:reload', () => { const t = tabsMod.activeTab(); if (t) { t.loading ? t.wc.stop() : t.wc.reload(); } });
  handle('nav:submit', (e, text) => tabsMod.submit(text));
  handle('nav:open', (e, name) => { tabsMod.openInternal(name); });
  handle('nav:openUrl', (e, url, background) => { tabsMod.createTab(url, { activate: !background }); });
  let lastHomeQuery = '';
  handle('home:query', (e, q) => { if (typeof q === 'string') { lastHomeQuery = q; return true; } return lastHomeQuery; });
  handle('mode:set', (e, mode, query) => {
    const next = mode === 'search' ? 'search' : 'chat';
    const prev = store.getSettings().mode;
    store.patchSettings({ mode: next });
    tabsMod.notify();
    // Chat → Search with a non-empty query: search immediately (do not wait for Enter)
    if (next === 'search' && prev !== 'search') {
      let q = (typeof query === 'string' ? query : '').trim();
      if (!q) {
        const t = tabsMod.activeTab();
        if (t && !t.wc.isDestroyed()) {
          const u = t.wc.getURL() || '';
          if (u.startsWith('aibrowser://chat')) {
            try { const sid = new URL(u).searchParams.get('sid'); const sess = chat.get(sid); if (sess && sess.input) q = String(sess.input).trim(); } catch {}
          } else if (u.startsWith('aibrowser://home')) {
            // home query is passed from the renderer; nothing else to read here
          }
        }
      }
      if (q && !tabsMod.looksLikeUrl(q)) tabsMod.submit(q);
    }
    return next;
  });
  handle('menu:toggle', () => tabsMod.toggleMenu());
  handle('tabs:state', () => tabsMod.state());

  // bookmarks / history / downloads
  handle('bm:toggle', () => { const t = tabsMod.activeTab(); if (!t) return false; const u = t.wc.getURL(); if (tabsMod.isInternal(u)) return false; const r = store.toggleBookmark(u, t.wc.getTitle()); tabsMod.notify(); broadcast('bookmarks:changed'); return r; });
  handle('bm:list', (e, q) => store.listBookmarks(q));
  handle('bm:remove', (e, url) => { store.removeBookmark(url); tabsMod.notify(); broadcast('bookmarks:changed'); });
  handle('hist:list', (e, q) => store.listHistory(q));
  handle('hist:count', (e, range) => store.countHistory(range));
  handle('hist:clear', (e, range) => { const n = store.clearHistory(range); broadcast('history:changed'); return n; });
  handle('confirm:answer', (e, id, ok) => require('./confirm').answer(id, ok));
  if (process.env.AIB_TEST_HOOKS) handle('test:seedHistory', (e, n) => { for (let i = 0; i < n; i++) store.addHistory('https://seed.test/' + i, 'seed ' + i); return store.countHistory('all'); });
  if (process.env.AIB_TEST_HOOKS) handle('test:tool', (e, name, args) => require('./ai/tools').call(name, args || {}, {}));
  handle('confirm:pending', () => require('./confirm').list());
  handle('hist:delete', (e, url) => { store.deleteHistory(url); broadcast('history:changed'); });
  handle('dl:list', () => store.downloads().slice(0, 200));
  handle('dl:cancel', (e, id) => { const it = dlItems.get(id); if (it) it.cancel(); });
  handle('dl:open', (e, id) => { const r = store.downloads().find(x => x.id === id); if (r) shell.openPath(r.path); });
  handle('dl:show', (e, id) => { const r = store.downloads().find(x => x.id === id); if (r) shell.showItemInFolder(r.path); });
  handle('dl:remove', (e, id) => { const a = store.downloads(); const i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); store.saveDownloads(); broadcast('downloads:changed'); });
  handle('dl:clear', () => { const a = store.downloads(); a.splice(0, a.length); store.saveDownloads(); broadcast('downloads:changed'); });

  // menu actions / find / zoom
  handle('menu:action', (e, name) => {
    const t = tabsMod.activeTab();
    switch (name) {
      case 'history': case 'downloads': case 'bookmarks': case 'extensions': case 'settings': tabsMod.closeOverlay('menu'); tabsMod.openInternal(name); break;
      case 'incognito': tabsMod.closeOverlay('menu'); tabsMod.createIncognitoTab(); break;
      case 'find': tabsMod.closeOverlay('menu'); setTimeout(() => tabsMod.showFind(), 50); break;
      case 'print': tabsMod.closeOverlay('menu'); setTimeout(() => global.__aibPrint.printActive(), 50); break;
      case 'passwords': tabsMod.closeOverlay('menu'); { const st = tabsMod.openInternal('settings'); if (st) st.wc.loadURL('aibrowser://settings#passwords'); } break;
      case 'devtools': tabsMod.closeOverlay('menu'); if (t) t.wc.openDevTools({ mode: 'detach' }); break;
    }
    return true;
  });
  handle('menu:close', () => tabsMod.closeOverlay('menu'));
  handle('zoom:get', () => tabsMod.zoom(null));
  handle('zoom:step', (e, dir) => tabsMod.zoom(dir));
  handle('find:query', (e, text, forward, next) => {
    const t = tabsMod.activeTab(); if (!t) return;
    if (!text) { t.wc.stopFindInPage('clearSelection'); return; }
    t.wc.findInPage(text, { forward: forward !== false, findNext: !!next });
  });
  handle('find:close', () => tabsMod.closeOverlay('find'));
  handle('lookup:run', async (e, word) => {
    const r = await features.runInputHandlers('word', { kind: 'word', word }, { wcId: e.sender.id });
    return r ? r.result : null;
  });
  handle('lookup:close', () => tabsMod.closeOverlay('lookup'));
  handle('lookup:show', (e, word, pos) => {
    const text = String(word || '').trim();
    if (!text) return { ok: false };
    const tab = tabsMod.allTabs().find(t => t.wc && t.wc.id === e.sender.id) || tabsMod.activeTab();
    const x = Number(pos && pos.x);
    const y = Number(pos && pos.y);
    tabsMod.showLookup(text, Number.isFinite(x) ? x : 80, Number.isFinite(y) ? y : 80, tab, 'word', { w: 480, h: 440 });
    return { ok: true };
  });

  // chat
  handle('chat:attach', (e, sid) => chat.attach(sid, e.sender.id));
  handle('chat:cancel', (e, sid) => chat.cancel(sid));
  handle('chat:stopTool', (e, stepId) => require('./ai/agent').stopStep(stepId));
  // ---- embedded Python + Linux VM (settings page)
  const pyMod = () => require('./python');
  const vmMod = () => require('./vm');
  handle('py:info', () => Object.assign(pyMod().info(), { packages: pyMod().list() }));
  handle('py:install', async (e, names) => { try { return await pyMod().install(names); } catch (err) { return { ok: false, error: String(err.message || err) }; } });
  handle('py:uninstall', async (e, name) => { try { return await pyMod().uninstall(name); } catch (err) { return { ok: false, error: String(err.message || err) }; } });
  handle('py:resetSessions', () => { pyMod().stopAll(); return { ok: true }; });
  handle('vm:status', () => vmMod().status());
  handle('vm:start', async () => { try { return { ok: true, status: await vmMod().start() }; } catch (err) { return { ok: false, error: String(err.message || err), status: vmMod().status() }; } });
  handle('vm:stop', async () => ({ ok: true, status: await vmMod().stop() }));
  handle('vm:reset', async () => {
    const ok = await require('./confirm').ask({ host: 'settings', danger: true, title: { zh: '重置 Linux 虚拟机？', en: 'Reset the Linux VM?' },
      message: { zh: '虚拟机磁盘中的所有文件和已安装的软件都会被删除，下次启动时将重新准备系统镜像。共享文件夹中的文件会保留。', en: 'All files and installed software on the VM disk will be deleted; the system image is prepared again on next start. Files in the shared folder are kept.' },
      detail: { zh: '此操作无法撤销。', en: 'This cannot be undone.' }, confirmText: { zh: '确认重置', en: 'Reset' } });
    if (!ok) return { ok: false, declined: true, status: vmMod().status() };
    return { ok: true, status: await vmMod().reset() };
  });
  handle('vm:openShare', () => { const d = vmMod().dirs().share; require('fs').mkdirSync(d, { recursive: true }); require('electron').shell.openPath(d); return { ok: true, path: d }; });
  handle('vm:ping', async () => { try { return { ok: true, info: await vmMod().ping() }; } catch (err) { return { ok: false, error: String(err.message || err) }; } });
  try { vmMod().events.on('state', (s) => broadcast('vm:state', s)); } catch (err) { console.error('vm events', err.message); }
  handle('chat:rerun', (e, sid, queries) => chat.rerun(sid, queries));
  handle('chat:aiEntry', async (e, word) => chat.aiEntry(word));
  handle('panel:reply', (e, reqId, result, error) => { const p = panelPending.get(reqId); if (!p) return; panelPending.delete(reqId); error ? p.reject(new Error(error)) : p.resolve(result); });

  // feature extensions
  handle('ext:list', () => features.list());
  handle('ext:setEnabled', (e, id, v) => { features.setEnabled(id, v); broadcast('ext:changed'); return features.list(); });
  handle('ext:rpc', (e, id, name, args) => features.rpc(id, name, args, { wcId: e.sender.id }));
  handle('ext:checkUpdate', (e, id, install) => features.checkUpdate(id, install).then(r => { if (install) broadcast('ext:changed'); return r; }));
  handle('ext:installDir', () => { const p = pick({ properties: ['openDirectory'], title: '选择功能拓展文件夹' }); if (!p[0]) return null; const m = features.installFromDir(p[0]); broadcast('ext:changed'); return m; });
  handle('ext:installZip', () => { const p = pick({ properties: ['openFile'], filters: [{ name: 'zip', extensions: ['zip'] }] }); if (!p[0]) return null; const m = features.installFromZip(p[0]); broadcast('ext:changed'); return m; });
  handle('ext:uninstall', (e, id) => { features.uninstall(id); broadcast('ext:changed'); });
  handle('ext:aiGenerate', async (e, prompt, kind) => {
    kind = kind === 'chrome' ? 'chrome' : 'feature';
    const j = await llm.completeJson([{ role: 'system', content: require('./ai/prompts').extensionWriter(kind) }, { role: 'user', content: String(prompt) }], { maxTokens: 4000, temperature: 0.2 });
    const files = j.files || {};
    const out = { kind, summary: j.summary || '', files, problems: [] };
    try {
      const m = JSON.parse(files['manifest.json'] || '{}');
      if (kind === 'feature') out.problems = features.validateManifest(m);
      else if (m.manifest_version !== 3) out.problems.push('manifest_version 必须为 3');
      out.manifest = m;
    } catch (err) { out.problems.push('manifest.json 不是有效 JSON'); }
    return out;
  });
  handle('ext:aiInstall', async (e, kind, files) => {
    for (const k of Object.keys(files)) if (typeof files[k] !== 'string') throw new Error('文件内容无效');
    if (kind === 'chrome') { const r = await chromeExt.installFiles(files, 'ai'); broadcast('ext:changed'); return r; }
    const m = features.installFromFiles(files); broadcast('ext:changed'); return m;
  });
  // chrome extensions
  handle('cx:list', () => chromeExt.list());
  handle('cx:installStore', async (e, input) => { try { const r = await chromeExt.installFromStore(input); broadcast('ext:changed'); tabsMod.notify(); return { ok: true, ext: r }; } catch (err) { return { ok: false, error: String(err.message || err) }; } });
  handle('cx:add', async () => {
    const p = pick({ properties: ['openFile', 'openDirectory'], filters: [{ name: 'Chrome extension', extensions: ['crx', 'zip'] }, { name: 'All', extensions: ['*'] }], title: '选择扩展文件夹 / .crx / .zip' });
    if (!p[0]) return null;
    const r = await chromeExt.add(p[0]); broadcast('ext:changed'); return r;
  });
  handle('cx:setEnabled', async (e, p, v) => { await chromeExt.setEnabled(p, v); broadcast('ext:changed'); });
  handle('cx:remove', async (e, p) => { await chromeExt.remove(p); broadcast('ext:changed'); });
  handle('cx:openUrl', (e, url) => { tabsMod.createTab(url); });

  // local model
  const local = () => require('./ai/local');
  handle('lm:list', () => local().listModels(store.getSettings().ai.local));
  handle('lm:status', () => local().status(store.getSettings().ai.local));
  local().hooks.broadcast = broadcast; require('./ai/hub').setSink((p) => broadcast('lm:progress', p));
  handle('lm:download', (e, id) => local().startDownload(id));
  handle('lm:resume', (e, id) => local().startDownload(id));
  handle('lm:pause', (e, id) => local().pauseDownload(id));
  const disk = () => require('./ai/disk');
  handle('lm:disk', () => disk().usage());
  handle('lm:clearCache', async (e, id) => { const r = await disk().clearCache(id); broadcast('lm:progress', { id, deleted: true }); return r; });
  handle('lm:clearAllCache', async () => { const r = await disk().clearAllCache(); broadcast('lm:progress', { id: '*', deleted: true }); return r; });
  handle('lm:deleteFiles', async (e, id) => { const r = await disk().deleteFiles(id); broadcast('lm:progress', { id, deleted: true }); broadcast('settings:changed', store.publicSettings()); return r; });

  // ---- knowledge base (EmbeddingGemma by default) + translate status
  const kbM = () => require('./ai/kb');
  const htmlToText = (h) => String(h).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|h\d|tr|br)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  const kbProg = (p) => broadcast('kb:progress', p);
  const kbErr = (err) => ({ ok: false, error: String(err && err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
  handle('kb:list', () => kbM().list());
  handle('kb:status', () => ({ ...kbM().status(), ...kbM().list() }));
  handle('kb:addText', async (e, title, text) => { try { const d = await kbM().addText(String(title || '').slice(0, 200), String(text || ''), { source: 'text' }, kbProg); return { ok: true, doc: d, ...kbM().list() }; } catch (err) { return kbErr(err); } });
  handle('kb:addFiles', async () => {
    const files = pick({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Text / Markdown / HTML / CSV / JSON', extensions: ['txt', 'md', 'markdown', 'html', 'htm', 'csv', 'json', 'log', 'js', 'py', 'java', 'c', 'cpp', 'ts', 'yml', 'yaml', 'xml', 'tex'] }] });
    const res = [];
    for (const f of files) {
      try { let txt = fs.readFileSync(f, 'utf8'); if (/\.html?$/i.test(f)) txt = htmlToText(txt); const d = await kbM().addText(path.basename(f), txt, { source: 'file', path: f }, kbProg); res.push({ file: f, ok: true, chunks: d && d.chunks }); }
      catch (err) { res.push({ file: f, ...kbErr(err) }); }
    }
    return { ok: true, results: res, ...kbM().list() };
  });
  handle('kb:addUrl', async (e, url) => {
    try {
      const r = await fetch(String(url), { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 AI-Browser' } }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text(); const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const d = await kbM().addText((m ? htmlToText(m[1]) : '') || String(url), htmlToText(html), { source: 'url', url: String(url) }, kbProg); return { ok: true, doc: d, ...kbM().list() };
    } catch (err) { return kbErr(err); }
  });
  handle('kb:search', async (e, q, k) => { try { return { ok: true, hits: await kbM().search(String(q || ''), Number(k) || 5) }; } catch (err) { return kbErr(err); } });
  handle('kb:remove', (e, id) => kbM().remove(String(id)));
  handle('kb:clear', () => kbM().clear());
  handle('kb:reindex', async () => { try { await kbM().reindex(kbProg); return { ok: true, ...kbM().list() }; } catch (err) { return kbErr(err); } });
  handle('translate:status', () => require('./ai/translate').status());
  handle('translate:run', async (e, text, opts) => { try { const r = await require('./ai/translate').translate(String(text || ''), opts || {}); return { ok: true, text: typeof r === 'string' ? r : (r && r.text) || '' }; } catch (err) { return kbErr(err); } });
  // ---- model hub (Hugging Face via hf-mirror / official / custom, auto-fallback), local frameworks, MLX, roles
  const hubM = () => require('./ai/hub'), fwM = () => require('./ai/frameworks'), mlxM = () => require('./ai/mlx');
  handle('hub:search', async (e, q, kind) => { try { return { ok: true, ...(await hubM().search(q, kind === 'mlx' ? 'mlx' : 'gguf')) }; } catch (err) { return { ok: false, error: String(err.message || err), tried: err.tried }; } });
  handle('hub:files', async (e, repo) => { try { return { ok: true, ...(await hubM().repoFiles(String(repo))) }; } catch (err) { return { ok: false, error: String(err.message || err), tried: err.tried }; } });
  handle('hub:probe', () => hubM().probe());
  handle('hub:addCustom', (e, m) => {
    const L = store.getSettings().ai.local; const fam = require('./ai/catalog').familyOf(m.repo);
    const id = m.engine === 'mlx' ? 'hf:' + m.repo : 'hf:' + m.repo + '/' + m.file;
    const name = m.engine === 'mlx' ? m.repo.split('/').pop() + (m.quant ? ' · ' + m.quant : '') : m.file.replace(/\.gguf$/i, '');
    const entry = { id, repo: m.repo, file: m.file, engine: m.engine === 'mlx' ? 'mlx' : 'llama', bytes: Number(m.bytes) || 0, sha256: m.sha256 || '', family: fam, name, license: m.license || '', snapshot: m.engine === 'mlx' ? undefined : undefined };
    const custom = (L.custom || []).filter(x => x.id !== id).concat([entry]);
    store.patchSettings({ ai: { local: { custom } } }); broadcast('settings:changed', store.publicSettings()); return id;
  });
  handle('hub:removeCustom', (e, id) => { local().deleteModel(id); const L = store.getSettings().ai.local; const roles = { ...(L.roles || {}) }; for (const k of Object.keys(roles)) if (roles[k].endsWith(id)) roles[k] = ''; store.patchSettings({ ai: { local: { custom: (L.custom || []).filter(x => x.id !== id), roles } } }); broadcast('settings:changed', store.publicSettings()); broadcast('lm:progress', { id, deleted: true }); });
  handle('fw:detect', async () => { const l = await fwM().detect(); require('./ai/models').noteFw(l); return l; });
  handle('fw:test', (e, cfg) => { cfg = cfg || {}; if (!cfg.apiKey && cfg.id) { const t = fwM().targets().find(x => x.id === cfg.id); if (t) cfg.apiKey = t.apiKey; } return fwM().test(cfg); });
  handle('mlx:status', () => mlxM().status());
  handle('mlx:recheck', () => { mlxM().detectRuntime(true); return mlxM().status(); });
  handle('lm:cancel', (e, id) => local().cancelDownload(id));
  handle('lm:delete', (e, id) => { local().deleteModel(id); broadcast('lm:progress', { id, deleted: true }); });
  handle('lm:pick', () => { const p = pick({ properties: ['openFile'], filters: [{ name: 'GGUF', extensions: ['gguf'] }] }); if (!p[0]) return null; store.patchSettings({ ai: { local: { modelPath: p[0], modelId: '' } } }); broadcast('settings:changed', store.publicSettings()); return p[0]; });

  // privacy
  handle('privacy:count', (e, range) => ({ history: store.countHistory(range), downloads: store.downloads().length }));
  handle('privacy:clear', async (e, opts) => {
    const res = { history: 0, downloads: 0 };
    if (opts.history) res.history = store.clearHistory(opts.range);
    if (opts.downloads) { const a = store.downloads(); res.downloads = a.length; a.splice(0, a.length); store.saveDownloads(); }
    if (opts.cache) await session.defaultSession.clearCache();
    if (opts.cookies) await session.defaultSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    broadcast('history:changed'); broadcast('downloads:changed');
    return { ok: true, ...res };
  });
  handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform, arch: process.arch, userData: app.getPath('userData') }));


  // ---- passwords (renderer pages: aibrowser:// only; web pages only reach pw:creds/fill/submit/answer/ready, all checked by sender URL)
  const pw = () => require('./passwords');
  const pwPending = new Map(); // wcId -> {username,password,url,at,kind}
  const tabOf = (wcId) => tabsMod.allTabs().find(t => t.wc.id === wcId);
  const isWeb = (e) => /^https?:/i.test(e.sender.getURL());
  ipcMain.handle('pw:creds', (e) => isWeb(e) ? pw().credentialsFor(e.sender.getURL()) : []);
  ipcMain.handle('pw:fill', (e, id) => isWeb(e) ? pw().fillCredential(e.sender.getURL(), String(id)) : null);
  const sendPrompt = (wc, p) => { try { wc.send('pw:prompt', { kind: p.kind, username: p.username, host: new URL(p.url).host, lang: store.getSettings().lang }); } catch {} };
  ipcMain.on('pw:submit', (e, p) => {
    try {
      const t = tabOf(e.sender.id); if (!t || t.incognito || !isWeb(e) || !p || typeof p.password !== 'string') return; // never saved in private tabs
      // the unloading document's own URL (pagehide fires after the sender already points at the next page)
      const docUrl = /^https?:\/\//i.test(String(p.url || '')) ? String(p.url) : e.sender.getURL();
      const d = pw().decide(docUrl, String(p.username || ''), p.password);
      if (d.action === 'none') return;
      const rec = { username: String(p.username || ''), password: p.password, url: docUrl, at: Date.now(), kind: d.action, shown: 0 };
      pwPending.set(e.sender.id, rec); sendPrompt(e.sender, rec);
      if (process.env.AIB_TEST_PW_LOG) fs.appendFileSync(process.env.AIB_TEST_PW_LOG, JSON.stringify({ kind: rec.kind, username: rec.username, url: rec.url }) + '\n');
    } catch (err) { console.error('pw:submit', err.message); }
  });
  ipcMain.on('pw:ready', (e) => { const r = pwPending.get(e.sender.id); if (r && Date.now() - r.at < 30000 && isWeb(e)) sendPrompt(e.sender, r); else if (r) pwPending.delete(e.sender.id); });
  ipcMain.on('pw:answer', (e, a) => {
    const r = pwPending.get(e.sender.id); if (!r) return; pwPending.delete(e.sender.id);
    try {
      if (a && a.action === 'save') { pw().upsert({ url: r.url, username: r.username, password: r.password }); broadcast('pw:changed'); }
      else if (a && a.action === 'never') pw().neverFor(pw().originOf(r.url));
    } catch (err) { console.error('pw:answer', err.message); }
  });
  handle('pw:testAnswer', (e, action) => { if (!process.env.AIB_TEST_PW_LOG) return false; const t = tabsMod.activeTab(); const wc = t && t.wc.id; const r = pwPending.get(wc); if (!r) return false; pwPending.delete(wc); if (action === 'save') { pw().upsert({ url: r.url, username: r.username, password: r.password }); } else if (action === 'never') pw().neverFor(pw().originOf(r.url)); return true; });
  handle('pw:list', (e, q) => pw().list(q));
  handle('pw:reveal', (e, id) => pw().reveal(String(id)));
  handle('pw:update', (e, id, patch) => { const r = pw().update(String(id), patch || {}); broadcast('pw:changed'); return r; });
  handle('pw:add', (e, it) => { const r = pw().upsert(it || {}); broadcast('pw:changed'); return r; });
  handle('pw:remove', (e, id) => { pw().remove(String(id)); broadcast('pw:changed'); return true; });
  handle('pw:clear', () => { pw().clearAll(); broadcast('pw:changed'); return true; });
  handle('pw:never', (e, op, origin) => { if (op === 'remove') pw().removeNever(origin); return pw().neverList(); });
  handle('pw:import', () => { const p = pick({ properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }], title: 'CSV' }); if (!p[0]) return null; const r = pw().importCsv(fs.readFileSync(p[0], 'utf8')); broadcast('pw:changed'); return r; });
  handle('pw:export', async () => {
    const csv = await pw().exportCsv();
    const tf = process.env.AIB_TEST_SAVE_PATH; let dest = tf;
    if (!dest) { const r = await dialog.showSaveDialog(tabsMod.getWin() || undefined, { defaultPath: 'passwords.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] }); if (r.canceled) return null; dest = r.filePath; }
    fs.writeFileSync(dest, csv, { mode: 0o600 }); return { path: dest };
  });
  handle('pw:lock', () => { pw().lock(); return true; });
  handle('pw:info', () => ({ hello: process.platform === 'win32', touchId: process.platform === 'darwin' && systemPreferences.canPromptTouchID && systemPreferences.canPromptTouchID(), cfg: pw().cfg() }));

  // ---- print / save as PDF (the AI may open the print dialog; it can never read passwords)
  const printActive = (id) => {
    const t = id ? tabsMod.getTab(id) : tabsMod.activeTab(); if (!t) return false;
    if (process.env.AIB_TEST_PRINT_LOG) { fs.appendFileSync(process.env.AIB_TEST_PRINT_LOG, 'print ' + t.wc.getURL() + '\n'); return true; }
    t.wc.print({ silent: false, printBackground: true }); return true;
  };
  const savePdf = async (id) => {
    const t = id ? tabsMod.getTab(id) : tabsMod.activeTab(); if (!t) throw new Error('no tab');
    const data = await t.wc.printToPDF({ printBackground: true, preferCSSPageSize: true });
    let dest = process.env.AIB_TEST_SAVE_PATH;
    if (!dest) { const r = await dialog.showSaveDialog(tabsMod.getWin() || undefined, { defaultPath: (t.title || 'page').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] }); if (r.canceled) return { cancelled: true }; dest = r.filePath; }
    fs.writeFileSync(dest, data); return { path: dest, bytes: data.length };
  };
  global.__aibPrint = { printActive, savePdf };
  handle('page:print', (e, id) => printActive(id));
  handle('page:savePdf', (e, id) => savePdf(id));

  const v36 = require('./v36/v36');
  handle('chat:follow', (e, sid, text, extra) => chat.follow(sid, String(text || ''), extra || {}));
  handle('chat:list', () => store.listChats());
  handle('chat:title', async (e, sid) => {
    const s = chat.get(sid); if (!s) return '';
    let title = v36.fallbackTitle(s.input);
    try {
      const t = await llm.complete([{ role: 'system', content: v36.titlePrompt() }, { role: 'user', content: String(s.input || '').slice(0, 500) }], { maxTokens: 40, temperature: 0.2 });
      title = v36.cleanTitle(t) || title;
    } catch {}
    const row = store.upsertChat({ id: s.threadId || s.sid, title, preview: String(s.input || '').slice(0, 80), updated: Date.now(), kind: s.kindOverride || 'chat' });
    return row.title;
  });
  handle('solve:phone', async () => {
    const phone = require('./v36/phone');
    if (!global.__aibPhone) global.__aibPhone = phone.createPhoneServer({ onImage: (buf) => broadcast('solve:photo', { bytes: buf.length, dataUrl: 'data:image/jpeg;base64,' + buf.toString('base64') }) });
    if (!global.__aibPhone.started) { global.__aibPhone.info = await global.__aibPhone.start(); global.__aibPhone.started = true; }
    const url = global.__aibPhone.info.url;
    return { url, qr: v36.qrSvg(url), desktop: true };
  });
  handle('solve:link', () => ({ url: v36.phoneLink({ desktop: true, lanUrl: global.__aibPhone && global.__aibPhone.info && global.__aibPhone.info.url }), publicUrl: v36.PUBLIC_SOLVER }));
  handle('wiki:search', async (e, q) => ({ hits: await require('./v36/extra-tools').wikiSearch(q) }));
  handle('wiki:openZim', async () => {
    const zim = require('./wiki/zim');
    const files = pick({ properties: ['openFile'], filters: [{ name: 'ZIM', extensions: ['zim', 'zimaa'] }], title: '选择 ZIM 格式的离线百科文件' });
    if (!files[0]) return Object.assign({ cancelled: true }, zim.status());
    const st = await zim.importFile(files[0], { onProgress: (prog) => broadcast('wiki:progress', prog) });
    broadcast('wiki:progress', { active: false, finished: true });
    return st;
  });
  handle('wiki:zimStatus', () => require('./wiki/zim').status());
  handle('wiki:article', async (e, articlePath) => {
    const zim = require('./wiki/zim');
    const item = await zim.getByPath(articlePath);
    if (!item) return null;
    return { title: item.title, path: item.path, mime: item.mime, url: 'aibzim://zim/' + encodeURI(item.path || '') };
  });
  handle('wiki:import', (e, text) => {
    const pages = v36.parseWikiJsonl(text);
    const dir = require('./v36/extra-tools').wikiDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'user.jsonl'), pages.map(p => JSON.stringify(p)).join('\n'));
    return { imported: pages.length };
  });
  handle('collab:get', (e, tool) => ((store.getSettings().collab || {})[tool]) || { toolId: tool, notes: [] });
  handle('collab:note', (e, tool, who, text) => {
    const bag = Object.assign({}, store.getSettings().collab || {});
    bag[tool] = v36.collabNote(bag[tool] || v36.collabOpen(tool), who || 'human', text);
    store.patchSettings({ collab: bag });
    return bag[tool];
  });
  handle('kernel:check', () => require('./v36/kernel').check());
  handle('siri:toggle', () => tabsMod.toggleSiri());
  handle('siri:read', async () => {
    const t = tabsMod.activeTab(); if (!t) return { text: '', title: '', url: '' };
    let text = '';
    try { text = String(await t.wc.executeJavaScript('document.body ? document.body.innerText : ""')).slice(0, 8000); } catch {}
    return { text, title: t.wc.getTitle(), url: t.wc.getURL() };
  });
  handle('siri:ask', async (e, kind, question) => {
    const page = await (async () => { const t = tabsMod.activeTab(); if (!t) return { text: '', title: '' }; let text = ''; try { text = String(await t.wc.executeJavaScript('document.body ? document.body.innerText : ""')).slice(0, 6000); } catch {} return { text, title: t.wc.getTitle() }; })();
    if (kind === 'translate') {
      const tr = await require('./ai/translate').translate(page.text.slice(0, 4000), {});
      return { text: tr.text || tr };
    }
    const sys = kind === 'summary' ? 'Summarize the page in Simplified Chinese. Be structured and detailed.' : 'Answer the user about the page. Do not name tools.';
    const user = (kind === 'ask' ? String(question || '') + '\n\n' : '') + 'Page:\n' + page.text.slice(0, 5000);
    const out = await llm.complete([{ role: 'system', content: sys + '\n' + v36.answerAddendum(store.getSettings().answerStyle) }, { role: 'user', content: user }], { maxTokens: 1200 });
    return { text: v36.redactToolTalk(out) };
  });

  // selection lookup from web pages (preload content script)
  ipcMain.on('sel:lookup', (e, p) => {
    try {
      const s = store.getSettings();
      if (!s.selectionLookup || !p || typeof p.text !== 'string') return;
      const kind = p.kind || v36.selectionKind(p.text);
      if (!kind) return;
      const tab = tabsMod.allTabs().find(t => t.wc.id === e.sender.id);
      if (!tab || tab.id !== tabsMod.activeTab()?.id) return;
      if (kind === 'word') {
        if (!/^[A-Za-z][A-Za-z'’-]{1,40}$/.test(p.text)) return;
        if (!features.list().find(x => x.id === 'aib.dictionary' && x.enabled) || !dict.enabled().length) return;
      }
      tabsMod.showLookup(p.text, Number(p.x) || 0, Number(p.y) || 0, tab, kind);
    } catch (err) { console.error('sel:lookup', err.message); }
  });
}

// ------------------------------------------------------------ host services for built-in feature extensions
function registerHostServices() {
  features.registerHost('dictionary', {
    lookup: (w) => dict.lookup(String(w)),
    suggest: (p, n) => dict.suggest(String(p), n || 12),
    list: () => dict.listWithInfo(),
    remove: (id) => { dict.remove(id); return true; },
    setEnabled: (id, v) => { dict.setEnabled(id, v); return true; },
    move: (id, d) => { dict.move(id, d); return true; },
    pickAndAdd: async () => {
      const files = pick({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'MDict', extensions: ['mdx'] }], title: '选择 .mdx 词典' });
      const added = [], errors = [];
      for (const f of files) { try { const r = await dict.importDict(f, { onProgress: (p) => broadcast('dict:progress', p) }); if (!r.dup) added.push(r.name); } catch (e) { errors.push(path.basename(f) + ': ' + e.message); } }
      broadcast('dict:progress', { active: false }); return { added, errors };
    },
    progress: () => dict.getProgress(),
    listInfo: () => dict.listWithInfo()
  });
  features.setHooks({
    openTab: (u) => tabsMod.createTab(u),
    ai: (messages) => llm.complete(messages),
    callPanel
  });
}

// Every accelerator goes through ACTIONS. Menu items and the in-app key handler (before-input-event) call fire(); a short
// de-dupe window stops a key press from running twice when both paths see it (macOS menu key-equivalents vs. injected keys).
const ACTIONS = {
  newtab: () => tabsMod.createTab(),
  incognito: () => tabsMod.createIncognitoTab(),
  closetab: () => { const t = tabsMod.activeTab(); if (t) tabsMod.closeTab(t.id); },
  addr: () => { const w = tabsMod.getWin(); if (w) w.webContents.send('addr:focus'); },
  print: () => global.__aibPrint.printActive(),
  pdf: () => global.__aibPrint.savePdf().catch(() => {}),
  reload: () => { const t = tabsMod.activeTab(); if (t) t.wc.reload(); },
  back: () => { const t = tabsMod.activeTab(); if (t) t.wc.navigationHistory.goBack(); },
  forward: () => { const t = tabsMod.activeTab(); if (t) t.wc.navigationHistory.goForward(); },
  zoomin: () => tabsMod.zoom('in'), zoomout: () => tabsMod.zoom('out'), zoomreset: () => tabsMod.zoom('reset'),
  devtools: () => { const t = tabsMod.activeTab(); if (t) t.wc.openDevTools({ mode: 'detach' }); },
  history: () => tabsMod.openInternal('history'), downloads: () => tabsMod.openInternal('downloads'), bookmarks: () => tabsMod.openInternal('bookmarks'),
  settings: () => tabsMod.openInternal('settings'), find: () => tabsMod.showFind()
};
const lastFire = {};
function fire(name, src = 'menu') { const n = Date.now(); const l = lastFire[name]; if (l && l.src !== src && n - l.t < 200) return; lastFire[name] = { t: n, src }; try { ACTIONS[name](); } catch (e) { console.error('shortcut', name, e.message); } }
// key table: [code, shift, alt] -> action (primary modifier = Cmd on macOS, Ctrl elsewhere)
const KEYS = { KeyT: ['newtab'], KeyN: ['', 'incognito'], KeyW: ['closetab'], KeyL: ['addr'], KeyP: ['print', 'pdf'], KeyR: ['reload'], BracketLeft: ['back'], BracketRight: ['forward'],
  Equal: ['zoomin'], NumpadAdd: ['zoomin'], Minus: ['zoomout'], NumpadSubtract: ['zoomout'], Digit0: ['zoomreset'], KeyY: ['history'], KeyJ: ['', 'downloads'], KeyO: ['', 'bookmarks'], Comma: ['settings'], KeyF: ['find'], KeyI: ['', '', 'devtools'] };
function handleKey(input) {
  if (input.type !== 'keyDown') return false;
  const primary = process.platform === 'darwin' ? input.meta : input.control; if (!primary) return false;
  const e = KEYS[input.code]; if (!e) return false;
  const name = input.alt ? e[2] : input.shift ? e[1] : e[0];
  if (input.alt && input.code !== 'KeyI') return false;
  if (!name) return false;
  fire(name, 'key'); return true;
}
tabsMod.hooks.shortcut = handleKey;
// Synthetic (CDP/test) key events skip before-input-event; the chrome page forwards its own keydowns here.
handle('kbd:key', (e, k) => handleKey({ type: 'keyDown', code: String(k.code || ''), control: !!k.ctrl, meta: !!k.meta, shift: !!k.shift, alt: !!k.alt }));

function buildMenu() {
  const f = (n) => () => fire(n);
  const tpl = [
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { label: '设置…', accelerator: 'CmdOrCtrl+,', click: f('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '文件', submenu: [
      { label: '新建标签页', accelerator: 'CmdOrCtrl+T', click: f('newtab') },
      { label: '新建隐身标签页', accelerator: 'CmdOrCtrl+Shift+N', click: f('incognito') },
      { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: f('closetab') },
      { label: '打开地址栏', accelerator: 'CmdOrCtrl+L', click: f('addr') },
      { label: '打印…', accelerator: 'CmdOrCtrl+P', click: f('print') },
      { label: '另存为 PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: f('pdf') }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, { label: '在页面上查找', accelerator: 'CmdOrCtrl+F', click: f('find') }] },
    { label: '显示', submenu: [
      { label: '重新载入', accelerator: 'CmdOrCtrl+R', click: f('reload') },
      { label: '后退', accelerator: 'CmdOrCtrl+[', click: f('back') },
      { label: '前进', accelerator: 'CmdOrCtrl+]', click: f('forward') },
      { type: 'separator' },
      { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: f('zoomin') },
      { label: '放大 ', accelerator: 'CmdOrCtrl+=', visible: false, click: f('zoomin') },
      { label: '缩小', accelerator: 'CmdOrCtrl+-', click: f('zoomout') },
      { label: '实际大小', accelerator: 'CmdOrCtrl+0', click: f('zoomreset') },
      { type: 'separator' },
      { label: '开发者工具', accelerator: 'CmdOrCtrl+Alt+I', click: f('devtools') },
      { role: 'togglefullscreen' }] },
    { label: '历史', submenu: [{ label: '历史记录', accelerator: 'CmdOrCtrl+Y', click: f('history') }, { label: '下载内容', accelerator: 'CmdOrCtrl+Shift+J', click: f('downloads') }, { label: '书签', accelerator: 'CmdOrCtrl+Shift+O', click: f('bookmarks') }] },
    // NOT role:'windowMenu' — its built-in Close item also owns Cmd/Ctrl+W and would close the whole window instead of the tab
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ------------------------------------------------------------ lifecycle
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); } else {
  app.on('second-instance', () => { const w = tabsMod.getWin(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(async () => {
    try {
      const st = selfmod.readState();
      if (st.crashCount >= 2) selfmod.setSafeMode(true);
      // treat this boot as clean after a short settle; a crash before that increments crashCount via uncaught handlers
      setTimeout(() => selfmod.markCleanBoot(), 8000);
      process.on('uncaughtException', (e) => { console.error(e); selfmod.markCrash(); });
      process.on('unhandledRejection', (e) => { console.error(e); });
    } catch (e) { console.error('selfmod boot', e); }

    try { if (process.platform === 'darwin' && app.dock) app.dock.setIcon(require('path').join(__dirname, '..', 'assets', 'icon.png')); } catch {}
    store.init();
    registerProtocols();
    tabsMod.hooks.prepareIncognito = (ses) => { registerProtocols(ses.protocol); setupDownloads(ses); };
    registerIpc();
    registerHostServices();
    require('./wiki/zim').openSaved().catch(e => console.error('wiki zim', e && e.message));
  dict.migrate().then(r => { if (r.copied.length || r.missing.length) { console.log('dictionary migration:', JSON.stringify(r)); broadcast('ext:changed'); } }).catch(e => console.error('dictionary migration failed', e));
    setupDownloads();
    features.reload();
    buildMenu();
    tabsMod.createWindow();
    chromeExt.init().catch(e => console.error('chrome ext init', e.message));
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) tabsMod.createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { store.flushAll(); try { require('./python').stopAll(); } catch {} try { require('./vm').shutdownSync(); } catch {} });
}
