'use strict';
// Electron main-process API, re-implemented for iPad. Every window / view is a native WKWebView owned by the Swift host;
// this module keeps the same object model (BrowserWindow, WebContentsView, webContents, session, dialog, shell, Menu …)
// so the desktop main-process code in src/main runs unchanged. Commands go to the host through ../host.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const host = require(global.__aibHostModule || '../host');

const ENV = global.__aibIpad || { userData: path.join(require('os').tmpdir(), 'aib-ipad'), documents: require('os').tmpdir(), appRoot: path.join(__dirname, '..', '..', '..'), tmp: require('os').tmpdir(), version: '0.0.0' };
const state = { size: [1024, 768], biometry: false, safeKey: null, locale: 'zh-CN', keyboard: false, systemDark: true };

// ------------------------------------------------------------------ app
const app = new EventEmitter();
let readyResolve; const readyP = new Promise(r => { readyResolve = r; });
const paths = {
  userData: ENV.userData, appData: path.dirname(ENV.userData), home: ENV.documents, documents: ENV.documents, desktop: ENV.documents,
  downloads: path.join(ENV.documents, 'Downloads'), temp: ENV.tmp, exe: ENV.appRoot, module: ENV.appRoot, logs: path.join(ENV.userData, 'logs'),
  music: ENV.documents, pictures: ENV.documents, videos: ENV.documents, sessionData: ENV.userData, crashDumps: path.join(ENV.userData, 'crash')
};
Object.assign(app, {
  name: 'AI浏览器', isPackaged: true,
  getPath: (n) => { const p = paths[n] || ENV.userData; if (n === 'downloads') { try { fs.mkdirSync(p, { recursive: true }); } catch {} } return p; },
  setPath: (n, p) => { paths[n] = p; },
  getAppPath: () => ENV.appRoot,
  getVersion: () => ENV.version,
  getName: () => 'AI浏览器',
  getLocale: () => state.locale, getSystemLocale: () => state.locale, getPreferredSystemLanguages: () => [state.locale],
  whenReady: () => readyP, isReady: () => !!app._ready,
  requestSingleInstanceLock: () => true, releaseSingleInstanceLock: () => {},
  quit: () => {}, exit: () => {}, relaunch: () => {}, focus: () => {}, hide: () => {}, show: () => {},
  setAppUserModelId: () => {}, setAsDefaultProtocolClient: () => false, setAboutPanelOptions: () => {},
  commandLine: { appendSwitch: () => {}, hasSwitch: () => false, getSwitchValue: () => '' },
  dock: undefined,
  _markReady() { app._ready = true; readyResolve(); app.emit('ready'); }
});

// ------------------------------------------------------------------ protocol
const schemeHandlers = new Map();
const protocol = {
  registerSchemesAsPrivileged: () => {},
  handle: (scheme, fn) => { schemeHandlers.set(scheme, fn); },
  unhandle: (scheme) => { schemeHandlers.delete(scheme); },
  isProtocolHandled: (scheme) => schemeHandlers.has(scheme)
};
host.handlers.scheme = async (meta, body) => {
  const scheme = String(meta.url || '').split(':')[0];
  const fn = schemeHandlers.get(scheme);
  if (!fn) return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Not found') };
  const init = { method: meta.method || 'GET', headers: meta.headers || {} };
  if (body && body.length && !/^(GET|HEAD)$/i.test(init.method)) init.body = body;
  // Node's Request only accepts http(s) URLs: hand the handler a Request-like object with the original URL.
  const req = { url: meta.url, method: init.method, headers: new Headers(init.headers), arrayBuffer: async () => body, text: async () => body.toString('utf8'), json: async () => JSON.parse(body.toString('utf8')) };
  let r = await fn(req);
  if (!r) return { status: 404, body: Buffer.alloc(0) };
  const headers = {}; try { r.headers.forEach((v, k) => { headers[k] = v; }); } catch {}
  let buf = Buffer.from(await r.arrayBuffer());
  // internal pages: device-width viewport and the touch stylesheet (inline: the pages' CSP allows inline styles only)
  if (scheme === 'aibrowser' && /text\/html/i.test(headers['content-type'] || '')) buf = Buffer.from(touchHtml(buf.toString('utf8')), 'utf8');
  return { status: r.status || 200, headers, body: buf };
};

let touchCss = null;
function touchHtml(html) {
  if (touchCss === null) { try { touchCss = fs.readFileSync(path.join(ENV.resources || ENV.appRoot, 'web', 'inject', 'ipad.css'), 'utf8'); } catch { touchCss = ''; } }
  const inject = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">' + (touchCss ? '<style id="aib-ipad-css">' + touchCss + '</style>' : '');
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject);
  return inject + html;
}

// ------------------------------------------------------------------ web contents
const allWc = new Map();
let nextWcId = 1;
const sessions = new Map();

class NavigationHistory {
  constructor(wc) { this.wc = wc; }
  canGoBack() { return !!this.wc._st.canBack; }
  canGoForward() { return !!this.wc._st.canForward; }
  goBack() { host.cmd('wc.nav', { id: this.wc.id, op: 'back' }); }
  goForward() { host.cmd('wc.nav', { id: this.wc.id, op: 'forward' }); }
  goToOffset(o) { host.cmd('wc.nav', { id: this.wc.id, op: 'offset', offset: o }); }
  clear() {}
  getActiveIndex() { return 0; }
  length() { return 1; }
}

class WebContents extends EventEmitter {
  constructor({ kind = 'view', partition = '', transparent = false, preload = true } = {}) {
    super();
    this.id = nextWcId++;
    this.kind = kind;
    this.session = sessionFor(partition);
    this._st = { url: '', title: '', loading: false, canBack: false, canForward: false, zoom: 1, destroyed: false, focused: false, ua: '' };
    this.navigationHistory = new NavigationHistory(this);
    this._openHandler = null; this._findSeq = 0;
    this.devToolsWebContents = null;
    allWc.set(this.id, this);
    host.cmd('wc.create', { id: this.id, kind, partition: this.session.partition, persistent: this.session.persistent, transparent });
  }
  _ev(name, ...args) { const e = { preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false, sender: this }; this.emit(name, e, ...args); return e; }
  loadURL(url, opts = {}) {
    if (this._st.destroyed) return Promise.reject(new Error('Object has been destroyed'));
    this._st.url = String(url); this._st.loading = true;
    host.cmd('wc.load', { id: this.id, url: String(url), ua: opts.userAgent || '', headers: opts.extraHeaders || '' });
    return new Promise((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = (e, code, desc, u, isMain) => { if (isMain === false) return; cleanup(); if (code === -3) resolve(); else reject(Object.assign(new Error(`${desc || 'ERR_FAILED'} (${code}) loading '${url}'`), { code, errno: code })); };
      const t = setTimeout(done, 60000);
      const cleanup = () => { clearTimeout(t); this.removeListener('did-finish-load', done); this.removeListener('did-fail-load', fail); this.removeListener('destroyed', done); };
      this.once('did-finish-load', done); this.on('did-fail-load', fail); this.once('destroyed', done);
    });
  }
  loadFile(f) { return this.loadURL('file://' + f); }
  getURL() { return this._st.url || ''; }
  getTitle() { return this._st.title || ''; }
  isLoading() { return !!this._st.loading; }
  isLoadingMainFrame() { return !!this._st.loading; }
  isDestroyed() { return !!this._st.destroyed; }
  isFocused() { return !!this._st.focused; }
  isCrashed() { return false; }
  focus() { host.cmd('wc.focus', { id: this.id }); }
  reload() { host.cmd('wc.nav', { id: this.id, op: 'reload' }); }
  reloadIgnoringCache() { this.reload(); }
  stop() { host.cmd('wc.nav', { id: this.id, op: 'stop' }); }
  canGoBack() { return this.navigationHistory.canGoBack(); }
  canGoForward() { return this.navigationHistory.canGoForward(); }
  goBack() { this.navigationHistory.goBack(); }
  goForward() { this.navigationHistory.goForward(); }
  send(channel, ...args) { if (this._st.destroyed) return; host.cmd('wc.send', { id: this.id, channel: String(channel), args: host.clone(args) }); }
  // iPad extension: executeJavaScript(code, userGesture, { timeoutMs }) for long-running helper pages (the VM host)
  executeJavaScript(code, userGesture, opts) {
    if (this._st.destroyed) return Promise.reject(new Error('Object has been destroyed'));
    const ms = opts && Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120000;
    return host.call('wc.exec', { id: this.id, code: String(code) }, ms);
  }
  executeJavaScriptInIsolatedWorld(worldId, scripts) { return this.executeJavaScript((scripts || []).map(s => s.code).join(';\n')); }
  insertCSS(css) { return host.call('wc.css', { id: this.id, css: String(css) }, 30000).then(() => 'css' + Date.now()); }
  setUserAgent(ua) { this._st.ua = ua; host.cmd('wc.ua', { id: this.id, ua: String(ua || '') }); }
  getUserAgent() { return this._st.ua || 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'; }
  setZoomFactor(z) { this._st.zoom = Number(z) || 1; host.cmd('wc.zoom', { id: this.id, factor: this._st.zoom }); }
  getZoomFactor() { return this._st.zoom || 1; }
  setZoomLevel(l) { this.setZoomFactor(Math.pow(1.2, Number(l) || 0)); }
  getZoomLevel() { return Math.log(this.getZoomFactor()) / Math.log(1.2); }
  setVisualZoomLevelLimits() { return Promise.resolve(); }
  setWindowOpenHandler(fn) { this._openHandler = fn; }
  setBackgroundThrottling() {}
  setAudioMuted(m) { host.cmd('wc.mute', { id: this.id, muted: !!m }); }
  findInPage(text, opts = {}) {
    const requestId = ++this._findSeq;
    host.cmd('wc.find', { id: this.id, text: String(text || ''), forward: opts.forward !== false, findNext: !!opts.findNext, matchCase: !!opts.matchCase, requestId });
    return requestId;
  }
  stopFindInPage(action) { host.cmd('wc.stopFind', { id: this.id, action: action || 'clearSelection' }); }
  print(opts, cb) { host.call('wc.print', { id: this.id }, 0).then(r => cb && cb(!!(r && r.ok), r && r.error || ''), (e) => cb && cb(false, e.message)); }
  async printToPDF(opts) { const r = await host.call('wc.pdf', { id: this.id, opts: host.clone(opts || {}) }, 180000); return Buffer.from((r && r.b64) || '', 'base64'); }
  async capturePage() { const r = await host.call('wc.snapshot', { id: this.id }, 30000); return nativeImage.createFromBuffer(Buffer.from((r && r.b64) || '', 'base64')); }
  openDevTools() { host.cmd('wc.devtools', { id: this.id }); }
  closeDevTools() {}
  isDevToolsOpened() { return false; }
  toggleDevTools() { this.openDevTools(); }
  inspectElement() { this.openDevTools(); }
  copy() { host.cmd('wc.edit', { id: this.id, op: 'copy' }); }
  cut() { host.cmd('wc.edit', { id: this.id, op: 'cut' }); }
  paste() { host.cmd('wc.edit', { id: this.id, op: 'paste' }); }
  selectAll() { host.cmd('wc.edit', { id: this.id, op: 'selectAll' }); }
  undo() { host.cmd('wc.edit', { id: this.id, op: 'undo' }); }
  redo() { host.cmd('wc.edit', { id: this.id, op: 'redo' }); }
  getOSProcessId() { return process.pid; }
  getProcessId() { return this.id; }
  close() { this.destroy(); }
  destroy() {
    if (this._st.destroyed) return;
    this._st.destroyed = true; allWc.delete(this.id);
    host.cmd('wc.close', { id: this.id });
    try { this.emit('destroyed'); } catch (e) { console.error(e); }
  }
}

// events from the native host
function onWcEvent(m, reply) {
  const wc = allWc.get(m.id); if (!wc) return;
  const st = wc._st;
  switch (m.name) {
    case 'start': st.loading = true; wc._ev('did-start-loading'); wc._ev('did-start-navigation', m.url || st.url, false, true); break;
    case 'stop': st.loading = false; wc._ev('did-stop-loading'); break;
    case 'navigate': if (m.url) st.url = m.url; if (m.inPage) wc._ev('did-navigate-in-page', st.url, true); else wc._ev('did-navigate', st.url, 200, 'OK'); break;
    case 'title': st.title = m.title || ''; wc._ev('page-title-updated', st.title, true); break;
    case 'favicon': wc._ev('page-favicon-updated', m.url ? [m.url] : []); break;
    case 'domready': wc._ev('dom-ready'); break;
    case 'finish': st.loading = false; wc._ev('did-finish-load'); break;
    case 'fail': st.loading = false; wc._ev('did-fail-load', Number(m.code) || -2, m.desc || 'ERR_FAILED', m.url || st.url, true); break;
    case 'navstate':
      if (m.url) st.url = m.url; if (typeof m.title === 'string') st.title = m.title;
      st.canBack = !!m.canBack; st.canForward = !!m.canForward; if (typeof m.loading === 'boolean') st.loading = m.loading; break;
    case 'focus': st.focused = true; wc._ev('focus'); break;
    case 'blur': st.focused = false; wc._ev('blur'); break;
    case 'found': wc._ev('found-in-page', { requestId: m.requestId || wc._findSeq, activeMatchOrdinal: m.active || 0, matches: m.matches || 0, finalUpdate: true }); break;
    case 'context': wc._ev('context-menu', Object.assign({ x: 0, y: 0, linkURL: '', srcURL: '', mediaType: 'none', selectionText: '', isEditable: false, editFlags: {} }, m.params || {})); break;
    case 'newwin': {
      let action = 'deny';
      if (wc._openHandler) { try { const r = wc._openHandler({ url: m.url, disposition: m.disposition || 'foreground-tab', frameName: '', features: '' }); action = (r && r.action) || 'deny'; } catch (e) { console.error(e); } }
      reply({ action }); break;
    }
    case 'key': {
      const input = { type: 'keyDown', key: m.key || '', code: m.code || '', meta: !!m.meta, control: !!m.ctrl, shift: !!m.shift, alt: !!m.alt, isAutoRepeat: false };
      const e = wc._ev('before-input-event', input); reply({ handled: !!e.defaultPrevented }); break;
    }
    case 'gone': wc._ev('render-process-gone', { reason: 'crashed', exitCode: 0 }); break;
    case 'closed': if (!st.destroyed) { st.destroyed = true; allWc.delete(wc.id); wc.emit('destroyed'); } break;
  }
}

const webContents = {
  getAllWebContents: () => Array.from(allWc.values()).filter(w => !w._st.destroyed),
  fromId: (id) => allWc.get(Number(id)) || null,
  getFocusedWebContents: () => Array.from(allWc.values()).find(w => w._st.focused) || null
};

// ------------------------------------------------------------------ views & windows
class View extends EventEmitter {}
class WebContentsView extends View {
  constructor(opts = {}) {
    super();
    const wp = opts.webPreferences || {};
    this.webContents = new WebContents({ kind: 'view', partition: wp.partition || '', transparent: true });
    this._bounds = { x: 0, y: 0, width: 0, height: 0 }; this._visible = true;
    host.cmd('view.create', { id: this.webContents.id });
  }
  setBounds(b) { this._bounds = { x: Math.round(b.x || 0), y: Math.round(b.y || 0), width: Math.round(b.width || 0), height: Math.round(b.height || 0) }; host.cmd('view.bounds', Object.assign({ id: this.webContents.id }, this._bounds)); }
  getBounds() { return Object.assign({}, this._bounds); }
  setVisible(v) { this._visible = !!v; host.cmd('view.visible', { id: this.webContents.id, on: this._visible }); }
  getVisible() { return this._visible; }
  setBackgroundColor(c) { host.cmd('view.bg', { id: this.webContents.id, color: String(c || '') }); }
  setBorderRadius() {}
}
class ContentView {
  constructor(win) { this.win = win; this.children = []; }
  addChildView(v) { this.children = this.children.filter(x => x !== v).concat([v]); host.cmd('view.attach', { id: v.webContents.id, win: this.win.id }); }
  removeChildView(v) { this.children = this.children.filter(x => x !== v); host.cmd('view.detach', { id: v.webContents.id }); }
}
const windows = new Map();
let nextWinId = 1;
class BrowserWindow extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = nextWinId++;
    const wp = opts.webPreferences || {};
    const hidden = opts.show === false && !!opts.width && !wp.preload; // offscreen helper windows (e.g. search result pages)
    this._hidden = hidden;
    this.webContents = new WebContents({ kind: hidden ? 'hidden' : 'window', partition: wp.partition || '' });
    this.contentView = new ContentView(this);
    this._destroyed = false;
    windows.set(this.id, this);
    if (!hidden) host.cmd('window.attach', { win: this.id, id: this.webContents.id });
  }
  static getAllWindows() { return Array.from(windows.values()).filter(w => !w._destroyed && !w._hidden); }
  static getFocusedWindow() { return BrowserWindow.getAllWindows()[0] || null; }
  static fromWebContents(wc) { return Array.from(windows.values()).find(w => w.webContents === wc) || BrowserWindow.getFocusedWindow(); }
  static fromId(id) { return windows.get(id) || null; }
  loadURL(u, o) { return this.webContents.loadURL(u, o); }
  getContentSize() { return state.size.slice(); }
  getSize() { return state.size.slice(); }
  getBounds() { return { x: 0, y: 0, width: state.size[0], height: state.size[1] }; }
  getContentBounds() { return this.getBounds(); }
  setContentSize() {} setSize() {} setBounds() {} setMinimumSize() {} center() {} setTitle() {} setIcon() {}
  setWindowButtonVisibility() {} setTrafficLightPosition() {} setVibrancy() {} setBackgroundColor() {} setMenuBarVisibility() {} setAutoHideMenuBar() {}
  isDestroyed() { return this._destroyed; }
  isMinimized() { return false; } isMaximized() { return true; } isFullScreen() { return true; } isVisible() { return !this._hidden; } isFocused() { return true; }
  restore() {} minimize() {} maximize() {} show() {} hide() {} focus() { this.webContents.focus(); } blur() {} setFullScreen() {}
  close() { this.destroy(); }
  destroy() { if (this._destroyed) return; this._destroyed = true; windows.delete(this.id); this.webContents.destroy(); this.emit('closed'); }
}
function onWindowEvent(m) {
  if (m.w && m.h) {
    const changed = state.size[0] !== m.w || state.size[1] !== m.h;
    state.size = [Math.round(m.w), Math.round(m.h)];
    if (typeof m.keyboard === 'boolean') state.keyboard = m.keyboard;
    if (changed) for (const w of windows.values()) if (!w._hidden) { w.emit('resize'); w.emit('resized'); }
  }
}

// ------------------------------------------------------------------ sessions & downloads
class DownloadItem extends EventEmitter {
  constructor(m) { super(); this.dlId = m.dlId; this._url = m.url || ''; this._name = m.filename || 'download'; this._total = Number(m.total) || 0; this._got = 0; this._path = ''; this._state = 'progressing'; this._paused = false; this._mime = m.mime || ''; this._cancelled = false; }
  getURL() { return this._url; } getFilename() { return this._name; } getMimeType() { return this._mime; }
  getTotalBytes() { return this._total; } getReceivedBytes() { return this._got; }
  setSavePath(p) { this._path = p; } getSavePath() { return this._path; }
  isPaused() { return this._paused; } canResume() { return this._state === 'interrupted' || this._paused; } getState() { return this._state; }
  pause() { this._paused = true; host.cmd('dl.pause', { dlId: this.dlId }); }
  resume() { this._paused = false; host.cmd('dl.resume', { dlId: this.dlId }); }
  cancel() { this._cancelled = true; host.cmd('dl.cancel', { dlId: this.dlId }); }
  getStartTime() { return 0; } getURLChain() { return [this._url]; } getETag() { return ''; } getLastModifiedTime() { return ''; } hasUserGesture() { return true; }
}
const downloads = new Map();
function onDownloadEvent(m, reply) {
  if (m.phase === 'start') {
    const ses = sessionFor(m.partition || '');
    const item = new DownloadItem(m); downloads.set(m.dlId, item);
    const wc = allWc.get(m.wcId) || null;
    const e = { preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false };
    ses.emit('will-download', e, item, wc);
    if (!item._path) { const dir = app.getPath('downloads'); item._path = path.join(dir, item._name); }
    try { fs.mkdirSync(path.dirname(item._path), { recursive: true }); } catch {}
    reply({ path: item._path, cancel: !!(e.defaultPrevented || item._cancelled) });
    return;
  }
  const item = downloads.get(m.dlId); if (!item) return;
  if (m.phase === 'progress') { item._got = Number(m.received) || item._got; if (m.total) item._total = Number(m.total); item._state = 'progressing'; item.emit('updated', {}, 'progressing'); }
  else if (m.phase === 'done') {
    downloads.delete(m.dlId); item._got = Number(m.received) || item._got;
    item._state = m.state === 'completed' ? 'completed' : (item._cancelled || m.state === 'cancelled') ? 'cancelled' : 'interrupted';
    if (m.state === 'interrupted') item.emit('updated', {}, 'interrupted');
    item.emit('done', {}, item._state);
  }
}

class Session extends EventEmitter {
  constructor(partition) {
    super();
    this.partition = partition || '';
    this.persistent = !partition || /^persist:/.test(partition);
    this.protocol = protocol;
    this._ua = '';
    const self = this;
    this.cookies = Object.assign(new EventEmitter(), {
      get: async (f) => { try { return (await host.call('session.cookies', { partition: self.partition, op: 'get', filter: f || {} }, 20000)) || []; } catch { return []; } },
      set: async (c) => { await host.call('session.cookies', { partition: self.partition, op: 'set', cookie: c }, 20000).catch(() => {}); },
      remove: async (url, name) => { await host.call('session.cookies', { partition: self.partition, op: 'remove', url, name }, 20000).catch(() => {}); },
      flushStore: async () => {}
    });
    this.webRequest = { onBeforeRequest() {}, onBeforeSendHeaders() {}, onHeadersReceived() {}, onCompleted() {}, onErrorOccurred() {}, onResponseStarted() {}, onSendHeaders() {}, onBeforeRedirect() {} };
    this.extensions = {
      loadExtension: async (p, opts) => { const r = await host.call('ext.load', { partition: this.partition, path: p }, 120000); if (!r || !r.ok) throw new Error((r && r.error) || '无法加载扩展'); return { id: r.id, name: r.name, version: r.version, path: p, manifest: r.manifest || readManifest(p), url: r.url || '' }; },
      removeExtension: (id) => { host.cmd('ext.remove', { partition: this.partition, extId: id }); },
      getExtension: () => null,
      getAllExtensions: () => []
    };
  }
  loadExtension(p, o) { return this.extensions.loadExtension(p, o); }
  removeExtension(id) { return this.extensions.removeExtension(id); }
  getAllExtensions() { return this.extensions.getAllExtensions(); }
  clearCache() { return host.call('session.clear', { partition: this.partition, what: ['cache'] }, 60000).catch(() => {}); }
  clearStorageData(o) { return host.call('session.clear', { partition: this.partition, what: (o && o.storages) || ['all'] }, 60000).catch(() => {}); }
  clearHostResolverCache() { return Promise.resolve(); }
  flushStorageData() {}
  setUserAgent(ua) { this._ua = ua; host.cmd('session.ua', { partition: this.partition, ua }); }
  getUserAgent() { return this._ua || 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'; }
  setPermissionRequestHandler() {} setPermissionCheckHandler() {} setDevicePermissionHandler() {} setDisplayMediaRequestHandler() {}
  setSpellCheckerEnabled() {} setSpellCheckerLanguages() {} setPreloads() {} getPreloads() { return []; } registerPreloadScript() {}
  setProxy() { return Promise.resolve(); } resolveProxy() { return Promise.resolve('DIRECT'); }
  getStoragePath() { return this.persistent ? ENV.userData : null; }
  isPersistent() { return this.persistent; }
  fetch(u, o) { return fetch(u, o); }
}
function readManifest(p) { try { return JSON.parse(fs.readFileSync(path.join(p, 'manifest.json'), 'utf8')); } catch { return {}; } }
function sessionFor(partition) {
  const key = partition && partition !== 'persist:default' ? partition : '';
  let s = sessions.get(key); if (!s) { s = new Session(key); sessions.set(key, s); }
  return s;
}
const session = { get defaultSession() { return sessionFor(''); }, fromPartition: (p) => sessionFor(p || ''), fromPath: () => sessionFor('') };

// ------------------------------------------------------------------ ipcMain
const ipcMain = new EventEmitter(); ipcMain.setMaxListeners(0);
const invokeHandlers = new Map();
ipcMain.handle = (ch, fn) => { if (invokeHandlers.has(ch)) throw new Error(`Attempted to register a second handler for '${ch}'`); invokeHandlers.set(ch, fn); };
ipcMain.handleOnce = (ch, fn) => { ipcMain.handle(ch, async (...a) => { invokeHandlers.delete(ch); return fn(...a); }); };
ipcMain.removeHandler = (ch) => { invokeHandlers.delete(ch); };
function ipcEvent(m) {
  const sender = allWc.get(m.wcId);
  if (!sender) throw new Error('unknown sender');
  if (m.url && !sender._st.url) sender._st.url = m.url;
  return { sender, senderFrame: { url: m.url || sender.getURL(), origin: '' }, frameId: 1, processId: sender.id, reply: (ch, ...a) => sender.send(ch, ...a), returnValue: undefined };
}
host.handlers.invoke = async (m) => {
  const fn = invokeHandlers.get(m.channel);
  if (!fn) throw new Error(`No handler registered for '${m.channel}'`);
  const args = reviveBytes(m.args || []);
  return fn(ipcEvent(m), ...args);
};
host.handlers.send = (m) => { ipcMain.emit(m.channel, ipcEvent(m), ...reviveBytes(m.args || [])); };
function reviveBytes(v) {
  if (Array.isArray(v)) return v.map(reviveBytes);
  if (v && typeof v === 'object') { if (typeof v.__aibBytes === 'string') return Buffer.from(v.__aibBytes, 'base64'); for (const k of Object.keys(v)) v[k] = reviveBytes(v[k]); }
  return v;
}

// ------------------------------------------------------------------ dialog / shell / clipboard
function exportsDir() { const d = path.join(ENV.documents, '导出'); fs.mkdirSync(d, { recursive: true }); return d; }
function uniqueIn(dir, name) { let p = path.join(dir, name); const ext = path.extname(name), base = path.basename(name, ext); for (let i = 1; fs.existsSync(p) && i < 1000; i++) p = path.join(dir, `${base} (${i})${ext}`); return p; }
const dialog = {
  async showOpenDialog(win, opts) {
    if (!(win instanceof BrowserWindow)) opts = win || opts;
    opts = opts || {};
    const r = await host.call('dialog.open', { title: opts.title || '', properties: opts.properties || ['openFile'], filters: opts.filters || [] }, 0);
    const filePaths = (r && r.paths) || [];
    return { canceled: !filePaths.length, filePaths };
  },
  showOpenDialogSync() { console.error('[ipad] showOpenDialogSync is not available on iPad; use showOpenDialog'); return undefined; },
  async showSaveDialog(win, opts) {
    if (!(win instanceof BrowserWindow)) opts = win || opts;
    opts = opts || {};
    const name = path.basename(String(opts.defaultPath || 'file')) || 'file';
    const dest = uniqueIn(exportsDir(), name);
    // After the caller writes the file, offer the system export sheet so the user can place it anywhere in Files.
    const t0 = Date.now();
    const poll = setInterval(() => {
      let ok = false; try { ok = fs.statSync(dest).size >= 0; } catch {}
      if (ok) { clearInterval(poll); setTimeout(() => host.cmd('shell.export', { path: dest }), 300); }
      else if (Date.now() - t0 > 120000) clearInterval(poll);
    }, 250);
    return { canceled: false, filePath: dest };
  },
  showSaveDialogSync(win, opts) { if (!(win instanceof BrowserWindow)) opts = win || opts; return uniqueIn(exportsDir(), path.basename(String((opts || {}).defaultPath || 'file'))); },
  async showMessageBox(win, opts) {
    if (!(win instanceof BrowserWindow)) opts = win || opts;
    opts = opts || {};
    const r = await host.call('dialog.message', { type: opts.type || 'none', title: opts.title || '', message: opts.message || '', detail: opts.detail || '', buttons: opts.buttons || ['确定'], defaultId: opts.defaultId == null ? 0 : opts.defaultId, cancelId: opts.cancelId == null ? -1 : opts.cancelId }, 0);
    return { response: r && typeof r.response === 'number' ? r.response : (opts.cancelId == null ? 0 : opts.cancelId), checkboxChecked: false };
  },
  showMessageBoxSync() { return 0; },
  showErrorBox(title, content) { host.cmd('dialog.message', { type: 'error', title: String(title || ''), message: String(title || ''), detail: String(content || ''), buttons: ['确定'], seq: 0 }); },
  showCertificateTrustDialog: async () => {}
};
const shell = {
  openPath: async (p) => { host.cmd('shell.open', { path: String(p) }); return ''; },
  showItemInFolder: (p) => { host.cmd('shell.show', { path: String(p) }); },
  openExternal: async (u) => { host.cmd('shell.external', { url: String(u) }); },
  trashItem: async (p) => { fs.rmSync(p, { recursive: true, force: true }); },
  beep: () => {},
  writeShortcutLink: () => false, readShortcutLink: () => ({})
};
let clipText = '';
const clipboard = {
  writeText: (t) => { clipText = String(t == null ? '' : t); host.cmd('clipboard.write', { text: clipText }); },
  readText: () => clipText,
  writeHTML: (h) => { host.cmd('clipboard.write', { text: String(h || '') }); },
  readHTML: () => '', clear: () => { clipText = ''; host.cmd('clipboard.write', { text: '' }); },
  writeImage: (img) => { try { host.cmd('clipboard.image', { b64: img.toPNG().toString('base64') }); } catch {} },
  availableFormats: () => ['text/plain'], has: () => !!clipText, write: (d) => { if (d && d.text != null) clipboard.writeText(d.text); }
};
host.bus.on('event', (m) => { if (m && m.type === 'clipboard') clipText = String(m.text || ''); });

// ------------------------------------------------------------------ menus
let menuSeq = 0;
class MenuItem {
  constructor(o = {}) {
    Object.assign(this, o);
    this.id = o.id || ('mi' + (++menuSeq));
    this.enabled = o.enabled !== false; this.visible = o.visible !== false;
    this.type = o.type || (o.submenu ? 'submenu' : 'normal');
    if (o.submenu && !(o.submenu instanceof Menu)) this.submenu = Menu.buildFromTemplate(o.submenu);
  }
}
class Menu extends EventEmitter {
  constructor() { super(); this.items = []; }
  static buildFromTemplate(tpl) { const m = new Menu(); for (const it of tpl || []) m.append(it instanceof MenuItem ? it : new MenuItem(it)); return m; }
  static setApplicationMenu(menu) {
    // hardware-keyboard shortcuts (UIKeyCommand) for every item with an accelerator
    const keys = []; const walk = (m) => { for (const it of (m && m.items) || []) { if (it.submenu) walk(it.submenu); else if (it.accelerator && it.visible !== false && it.label) keys.push({ id: it.id, label: String(it.label).trim(), accelerator: it.accelerator }); } };
    walk(menu); appMenu = menu;
    host.cmd('menu.app', { keys });
  }
  static getApplicationMenu() { return appMenu; }
  append(it) { this.items.push(it); }
  insert(i, it) { this.items.splice(i, 0, it); }
  getMenuItemById(id) { let f = null; const walk = (m) => { for (const it of m.items) { if (it.id === id) f = it; if (it.submenu) walk(it.submenu); } }; walk(this); return f; }
  popup(opts = {}) {
    const ser = (m) => m.items.filter(i => i.visible !== false).map(i => ({ id: i.id, label: i.label || roleLabel(i.role), type: i.type, enabled: i.enabled !== false, role: i.role || '', checked: !!i.checked, submenu: i.submenu ? ser(i.submenu) : undefined }));
    const wc = opts.window && opts.window.webContents ? opts.window.webContents : null;
    host.call('menu.popup', { items: ser(this), x: opts.x, y: opts.y, wcId: lastContextWc || (wc && wc.id) || 0 }, 0).then((r) => {
      const id = r && r.id; if (!id) { if (opts.callback) opts.callback(); return; }
      const it = this.getMenuItemById(id); if (!it) return;
      if (it.click) { try { it.click(it, opts.window || null, {}); } catch (e) { console.error('menu click', e); } }
      else if (it.role) runRole(it.role, lastContextWc);
      if (opts.callback) opts.callback();
    }).catch(() => {});
  }
  closePopup() {}
}
let appMenu = null; let lastContextWc = 0;
const ROLE_ZH = { copy: '拷贝', cut: '剪切', paste: '粘贴', selectAll: '全选', undo: '撤销', redo: '重做' };
function roleLabel(r) { return ROLE_ZH[r] || r || ''; }
function runRole(role, wcId) { if (ROLE_ZH[role] && wcId) host.cmd('wc.edit', { id: wcId, op: role }); }
host.bus.on('event', (m, reply) => {
  if (!m) return;
  if (m.type === 'wc') { if (m.name === 'context') lastContextWc = m.id; onWcEvent(m, reply); }
  else if (m.type === 'window') onWindowEvent(m);
  else if (m.type === 'dl') onDownloadEvent(m, reply);
  else if (m.type === 'menu') {
    const it = appMenu && appMenu.getMenuItemById(m.itemId);
    if (it && it.click) { try { it.click(it, BrowserWindow.getFocusedWindow(), { triggeredByAccelerator: true }); } catch (e) { console.error(e); } }
  }
});

// ------------------------------------------------------------------ misc modules
const nativeImage = {
  createFromBuffer: (buf) => ({ toPNG: () => buf, toJPEG: () => buf, toDataURL: () => 'data:image/png;base64,' + Buffer.from(buf).toString('base64'), isEmpty: () => !buf || !buf.length, getSize: () => ({ width: 0, height: 0 }), resize() { return this; } }),
  createFromPath: (p) => { let b = Buffer.alloc(0); try { b = fs.readFileSync(p); } catch {} return nativeImage.createFromBuffer(b); },
  createFromDataURL: (u) => nativeImage.createFromBuffer(Buffer.from(String(u).split(',')[1] || '', 'base64')),
  createEmpty: () => nativeImage.createFromBuffer(Buffer.alloc(0))
};
const safeStorage = {
  isEncryptionAvailable: () => !!state.safeKey,
  encryptString(plain) {
    if (!state.safeKey) throw new Error('Encryption is not available');
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', state.safeKey, iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return Buffer.concat([Buffer.from('AIB1'), iv, c.getAuthTag(), enc]);
  },
  decryptString(buf) {
    if (!state.safeKey) throw new Error('Encryption is not available');
    buf = Buffer.from(buf); if (buf.subarray(0, 4).toString() !== 'AIB1') throw new Error('bad ciphertext');
    const iv = buf.subarray(4, 16), tag = buf.subarray(16, 32), data = buf.subarray(32);
    const d = crypto.createDecipheriv('aes-256-gcm', state.safeKey, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  },
  getSelectedStorageBackend: () => 'keychain', setUsePlainTextEncryption: () => {}
};
const systemPreferences = Object.assign(new EventEmitter(), {
  canPromptTouchID: () => !!state.biometry,
  promptTouchID: async (reason) => { const r = await host.call('auth.biometric', { reason: String(reason || '') }, 0); if (!r || !r.ok) throw new Error((r && r.error) || '验证未通过'); },
  isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => 'granted', askForMediaAccess: async () => true,
  getUserDefault: () => undefined, isDarkMode: () => nativeTheme.shouldUseDarkColors, getAccentColor: () => '1f8f6aff', getColor: () => '#000000', getAnimationSettings: () => ({ shouldRenderRichAnimation: true, scrollAnimationsEnabledBySystem: true, prefersReducedMotion: false })
});
// nativeTheme: themeSource drives the iPad window's overrideUserInterfaceStyle (so prefers-color-scheme in every web view,
// the keyboard, menus and alerts follow the app's light / dark / follow-system setting); the system appearance comes
// from the host ('theme' events, also in init).
let themeSource = 'system';
const nativeTheme = Object.assign(new EventEmitter(), { shouldUseHighContrastColors: false, shouldUseInvertedColorScheme: false });
Object.defineProperty(nativeTheme, 'themeSource', {
  get: () => themeSource,
  set: (v) => { v = ['system', 'light', 'dark'].includes(v) ? v : 'system'; if (v === themeSource) return; themeSource = v; host.cmd('theme.set', { source: v }); nativeTheme.emit('updated'); }
});
Object.defineProperty(nativeTheme, 'shouldUseDarkColors', { get: () => themeSource === 'system' ? state.systemDark : themeSource === 'dark' });
host.bus.on('event', (m) => { if (m && m.type === 'theme' && typeof m.dark === 'boolean' && m.dark !== state.systemDark) { state.systemDark = m.dark; if (themeSource === 'system') nativeTheme.emit('updated'); } });
const screen = Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: state.size[0], height: state.size[1] }, workArea: { x: 0, y: 0, width: state.size[0], height: state.size[1] }, workAreaSize: { width: state.size[0], height: state.size[1] }, size: { width: state.size[0], height: state.size[1] }, scaleFactor: 2 }),
  getAllDisplays: () => [screen.getPrimaryDisplay()], getDisplayNearestPoint: () => screen.getPrimaryDisplay(), getDisplayMatching: () => screen.getPrimaryDisplay(), getCursorScreenPoint: () => ({ x: 0, y: 0 })
});
let psb = 0;
const powerSaveBlocker = { start: () => { host.cmd('idle', { off: true }); return ++psb; }, stop: () => { host.cmd('idle', { off: false }); }, isStarted: () => psb > 0 };
const net = { fetch: (u, o) => fetch(u, o), isOnline: () => true, online: true };
class Notification extends EventEmitter { constructor(o) { super(); this.o = o || {}; } show() { host.cmd('notify', { title: String(this.o.title || ''), body: String(this.o.body || '') }); } close() {} static isSupported() { return true; } }

function init(m) {
  if (m.w && m.h) state.size = [Math.round(m.w), Math.round(m.h)];
  state.biometry = !!m.biometry;
  if (m.safeKey) state.safeKey = Buffer.from(m.safeKey, 'base64');
  if (m.locale) state.locale = m.locale;
  if (typeof m.dark === 'boolean') state.systemDark = m.dark;
}

module.exports = {
  app, protocol, ipcMain, BrowserWindow, WebContentsView, View, webContents, session, dialog, shell, clipboard, Menu, MenuItem, nativeImage,
  safeStorage, systemPreferences, nativeTheme, screen, powerSaveBlocker, net, Notification,
  contextBridge: undefined, ipcRenderer: undefined, crashReporter: { start() {} }, globalShortcut: { register: () => false, unregister() {}, unregisterAll() {} },
  __ipad: { init, state, WebContents, allWc, invokeHandlers }
};
