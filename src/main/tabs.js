'use strict';
// Window, tabs (WebContentsView per tab) and overlay views (menu / find / lookup popup).
const path = require('path');
const { BrowserWindow, WebContentsView, Menu, clipboard, shell, app, session, webContents } = require('electron');
const store = require('./store');
const chat = require('./ai/chat');

const CHROME_H = 88;
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const SCHEME = 'aibrowser';
const INTERNAL = new Set(['home', 'chat', 'settings', 'extensions', 'history', 'bookmarks', 'downloads']);

let win = null;
let chromeWc = null;
let tabs = [];
let activeId = null;
let nextId = 1;
const overlays = { menu: null, find: null, lookup: null };
const hooks = { onTabsChanged: () => {} };

function wcOptions() {
  return { webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } };
}

function isInternal(url) { return typeof url === 'string' && url.startsWith(SCHEME + '://'); }

function looksLikeUrl(t) {
  if (/\s/.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true;
  if (/^(about|chrome-extension|view-source):/i.test(t)) return true;
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?([\/?#].*)?$/i.test(t)) return true;
  if (/^[^\s\/@]+\.[a-z]{2,}(:\d+)?([\/?#].*)?$/i.test(t)) return true;
  return false;
}
function normalizeUrl(t) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(about|chrome-extension|view-source):/i.test(t)) return t;
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})/i.test(t)) return 'http://' + t;
  return 'https://' + t;
}

// ---------------- tabs
function createTab(url, { activate = true } = {}) {
  const view = new WebContentsView(wcOptions());
  view.setBackgroundColor('#00000000');
  const wc = view.webContents;
  const tab = { id: nextId++, view, wc, title: '', favicon: '', loading: false, url: '' };
  tabs.push(tab);
  wire(tab);
  win.contentView.addChildView(view);
  view.setVisible(false);
  if (activate) activateTab(tab.id);
  load(tab, url || `${SCHEME}://home`);
  notify();
  return tab;
}

function load(tab, url) {
  tab.url = url;
  tab.wc.loadURL(url).catch(err => { if (!/ERR_ABORTED|ERR_FAILED/.test(String(err))) console.error('loadURL', url, err.message); });
}

function wire(tab) {
  const wc = tab.wc;
  wc.on('page-title-updated', (e, title) => { tab.title = title; notify(); const u = wc.getURL(); if (!isInternal(u)) store.updateHistoryTitle(u, title); });
  wc.on('page-favicon-updated', (e, favs) => { tab.favicon = favs[0] || ''; notify(); });
  wc.on('did-start-loading', () => { tab.loading = true; notify(); });
  wc.on('did-stop-loading', () => { tab.loading = false; notify(); });
  const nav = (e, url) => { tab.url = url; if (!isInternal(url)) store.addHistory(url, wc.getTitle()); notify(); };
  wc.on('did-navigate', nav);
  wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) nav(e, url); });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) { tab.title = desc; tab.error = { code, desc, url }; notify(); }
  });
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (/^https?:|^chrome-extension:|^aibrowser:/i.test(url)) createTab(url, { activate: disposition !== 'background-tab' });
    return { action: 'deny' };
  });
  wc.on('context-menu', (e, params) => showContextMenu(tab, params));
  wc.on('found-in-page', (e, r) => { if (overlays.find && !overlays.find.webContents.isDestroyed()) overlays.find.webContents.send('find:result', { active: r.activeMatchOrdinal, matches: r.matches }); });
  wc.on('destroyed', () => { chat.cancelForWebContents(wc.id); });
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && overlays.find) closeOverlay('find');
  });
}

function getTab(id) { return tabs.find(t => t.id === id); }
function activeTab() { return getTab(activeId); }

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  for (const t of tabs) t.view.setBounds({ x: 0, y: CHROME_H, width: w, height: Math.max(0, h - CHROME_H) });
  if (overlays.menu) overlays.menu.setBounds(menuBounds());
  if (overlays.find) overlays.find.setBounds(findBounds());
}

function activateTab(id) {
  const t = getTab(id);
  if (!t) return;
  activeId = id;
  for (const x of tabs) x.view.setVisible(x.id === id);
  layout();
  closeOverlay('menu'); closeOverlay('lookup');
  if (overlays.find) closeOverlay('find');
  // keep overlays above
  t.wc.focus();
  notify();
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const t = tabs[i];
  tabs.splice(i, 1);
  try { win.contentView.removeChildView(t.view); } catch {}
  try { t.wc.close({ waitForBeforeUnload: false }); } catch {}
  if (!tabs.length) { createTab(); return; }
  if (activeId === id) activateTab(tabs[Math.min(i, tabs.length - 1)].id);
  notify();
}

function tabInfo(t) {
  const url = t.wc.isDestroyed() ? t.url : ((t.loading && t.url) ? t.url : (t.wc.getURL() || t.url));
  let display = url, kind = 'web', icon = '';
  if (isInternal(url)) {
    const u = new URL(url);
    kind = u.hostname;
    if (u.hostname === 'chat') { const s = chat.get(u.searchParams.get('sid') || ''); display = s ? s.input.replace(/\s+/g, ' ').slice(0, 300) : ''; icon = 'spark'; }
    else if (u.hostname === 'home') { display = ''; icon = 'spark'; }
    else display = `aibrowser://${u.hostname}`;
  }
  const nh = t.wc.isDestroyed() ? null : t.wc.navigationHistory;
  return {
    id: t.id, title: t.title || (kind === 'home' ? '' : url), url, display, kind, icon, favicon: t.favicon, loading: t.loading,
    canBack: nh ? nh.canGoBack() : false, canForward: nh ? nh.canGoForward() : false,
    bookmarked: !isInternal(url) && store.isBookmarked(url), active: t.id === activeId
  };
}

function notify() {
  hooks.onTabsChanged();
  if (chromeWc && !chromeWc.isDestroyed()) chromeWc.send('tabs:state', state());
}
function state() {
  const s = store.getSettings();
  return { tabs: tabs.map(tabInfo), activeId, mode: s.mode, lang: s.lang };
}

// ---------------- navigation / input
function submit(text) {
  text = (text || '').trim();
  const t = activeTab();
  if (!t || !text) return { ok: false };
  const mode = store.getSettings().mode;
  if (looksLikeUrl(text)) { load(t, normalizeUrl(text)); return { ok: true, type: 'url' }; }
  if (mode === 'search') { load(t, store.searchUrl(text)); return { ok: true, type: 'search' }; }
  const sid = chat.create(text);
  load(t, `${SCHEME}://chat?sid=${sid}`);
  return { ok: true, type: 'chat', sid };
}

function openInternal(name, { reuse = true } = {}) {
  const url = `${SCHEME}://${name}`;
  if (reuse) { const ex = tabs.find(t => (t.wc.getURL() || '').startsWith(url)); if (ex) { activateTab(ex.id); return ex; } }
  const a = activeTab();
  if (a && (a.wc.getURL() || '').startsWith(`${SCHEME}://home`)) { load(a, url); return a; }
  return createTab(url);
}

// ---------------- overlays
function menuBounds() { const [w] = win.getContentSize(); return { x: w - 256, y: CHROME_H - 10, width: 248, height: 392 }; }
function findBounds() { const [w] = win.getContentSize(); return { x: w - 400, y: CHROME_H + 6, width: 392, height: 48 }; }

function openOverlay(kind, bounds, query) {
  closeOverlay(kind);
  const view = new WebContentsView(wcOptions());
  view.setBackgroundColor('#00000000');
  overlays[kind] = view;
  view.setBounds(bounds);
  win.contentView.addChildView(view);
  view.webContents.loadURL(`${SCHEME}://${kind}${query ? '?' + query : ''}`);
  if (kind !== 'find') {
    let focused = false;
    view.webContents.on('focus', () => { focused = true; });
    view.webContents.on('blur', () => { if (focused) setTimeout(() => { if (overlays[kind] === view) closeOverlay(kind); }, 80); });
  }
  view.webContents.once('did-finish-load', () => { if (!view.webContents.isDestroyed()) view.webContents.focus(); });
  return view;
}
function closeOverlay(kind) {
  const v = overlays[kind];
  if (!v) return;
  overlays[kind] = null;
  const remove = () => {
    try { win.contentView.removeChildView(v); } catch {}
    try { if (!v.webContents.isDestroyed()) v.webContents.close(); } catch {}
  };
  // menu: let the page play its short leave animation (view stays only ~140ms, state is already cleared)
  if (kind === 'menu' && !v.webContents.isDestroyed() && !(win && win.isDestroyed())) { try { v.webContents.send('overlay:leave'); } catch {} setTimeout(remove, 150); }
  else remove();
  if (kind === 'find') { const t = activeTab(); if (t) { try { t.wc.stopFindInPage('clearSelection'); } catch {} } }
}
function toggleMenu() { if (overlays.menu) closeOverlay('menu'); else openOverlay('menu', menuBounds()); }
function showFind() {
  const t = activeTab();
  if (!t || isInternal(t.wc.getURL())) return;
  if (overlays.find) { overlays.find.webContents.focus(); overlays.find.webContents.send('find:focus'); return; }
  openOverlay('find', findBounds());
}

let lastLookup = { word: '', t: 0 };
function showLookup(word, x, y, tab) {
  const now = Date.now();
  if (word === lastLookup.word && now - lastLookup.t < 700) return;
  lastLookup = { word, t: now };
  const t = tab || activeTab();
  if (!t) return;
  const vb = t.view.getBounds();
  const [w, h] = win.getContentSize();
  const W = 400, H = 300;
  let px = Math.round(vb.x + x - 20), py = Math.round(vb.y + y + 8);
  px = Math.max(8, Math.min(px, w - W - 8));
  if (py + H > h - 8) py = Math.max(CHROME_H + 4, Math.round(vb.y + y - H - 30));
  openOverlay('lookup', { x: px, y: py, width: W, height: H }, 'q=' + encodeURIComponent(word));
}

// ---------------- context menu
function showContextMenu(tab, p) {
  const tpl = [];
  const wc = tab.wc;
  const lang = store.getSettings().lang;
  const L = (zh, en) => lang === 'en' ? en : zh;
  const sel = (p.selectionText || '').trim();
  if (sel) {
    if (/^[A-Za-z][A-Za-z'’-]{0,40}$/.test(sel)) tpl.push({ label: L(`查词 “${sel}”`, `Look up “${sel}”`), click: () => { lastLookup = { word: '', t: 0 }; showLookup(sel, p.x, p.y, tab); } });
    tpl.push({ label: L('用 Chat 提问', 'Ask in Chat'), click: () => { const sid = chat.create(sel); createTab(`${SCHEME}://chat?sid=${sid}`); } });
    tpl.push({ label: L('拷贝', 'Copy'), role: 'copy' });
    tpl.push({ type: 'separator' });
  }
  if (p.linkURL) {
    tpl.push({ label: L('在新标签页打开链接', 'Open link in new tab'), click: () => createTab(p.linkURL) });
    tpl.push({ label: L('拷贝链接地址', 'Copy link address'), click: () => clipboard.writeText(p.linkURL) });
    tpl.push({ type: 'separator' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    tpl.push({ label: L('在新标签页打开图片', 'Open image in new tab'), click: () => createTab(p.srcURL) });
    tpl.push({ label: L('拷贝图片地址', 'Copy image address'), click: () => clipboard.writeText(p.srcURL) });
    tpl.push({ type: 'separator' });
  }
  if (p.isEditable) {
    tpl.push({ label: L('剪切', 'Cut'), role: 'cut' }, { label: L('拷贝', 'Copy'), role: 'copy' }, { label: L('粘贴', 'Paste'), role: 'paste' }, { type: 'separator' });
  }
  const nh = wc.navigationHistory;
  tpl.push({ label: L('后退', 'Back'), enabled: nh.canGoBack(), click: () => nh.goBack() });
  tpl.push({ label: L('前进', 'Forward'), enabled: nh.canGoForward(), click: () => nh.goForward() });
  tpl.push({ label: L('重新载入', 'Reload'), click: () => wc.reload() });
  tpl.push({ type: 'separator' });
  tpl.push({ label: L('检查元素', 'Inspect element'), click: () => { wc.inspectElement(p.x, p.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus(); } });
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

// ---------------- zoom
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
function zoom(dir) {
  const t = activeTab(); if (!t) return 1;
  const cur = t.wc.getZoomFactor();
  let i = ZOOMS.findIndex(z => Math.abs(z - cur) < 0.01); if (i < 0) i = ZOOMS.indexOf(1);
  if (dir === 'in') i = Math.min(ZOOMS.length - 1, i + 1);
  else if (dir === 'out') i = Math.max(0, i - 1);
  else if (dir === 'reset') i = ZOOMS.indexOf(1);
  if (dir) t.wc.setZoomFactor(ZOOMS[i]);
  return t.wc.getZoomFactor();
}

// ---------------- window
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 760, minHeight: 480,
    backgroundColor: '#07100f', title: 'AI浏览器',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 },
    show: !process.env.AIB_HIDE, webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  chromeWc = win.webContents;
  win.loadURL(`${SCHEME}://chrome`);
  win.on('resize', layout);
  win.on('enter-full-screen', layout); win.on('leave-full-screen', layout);
  win.on('closed', () => { win = null; chromeWc = null; tabs = []; activeId = null; overlays.menu = overlays.find = overlays.lookup = null; });
  chromeWc.on('did-finish-load', () => notify());
  win.webContents.on('did-finish-load', () => { if (!tabs.length) createTab(); });
  return win;
}

function getWin() { return win; }
function allTabs() { return tabs; }

module.exports = {
  CHROME_H, createWindow, createTab, closeTab, activateTab, getTab, activeTab, allTabs, submit, openInternal, load,
  toggleMenu, closeOverlay, showFind, showLookup, openOverlay, overlays, zoom, state, notify, getWin, hooks, looksLikeUrl, isInternal,
  tabInfo, layout
};
