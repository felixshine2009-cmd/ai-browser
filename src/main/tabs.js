'use strict';
// Window, tabs (WebContentsView per tab) and overlay views (menu / find / lookup popup).
const path = require('path');
const { BrowserWindow, WebContentsView, Menu, clipboard, shell, app, session, webContents } = require('electron');
const store = require('./store');
const chat = require('./ai/chat');

const CHROME_H = 88;
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const SCHEME = 'aibrowser';
const INTERNAL = new Set(['home', 'chat', 'settings', 'extensions', 'history', 'bookmarks', 'downloads', 'onboarding', 'selfmod']);

let win = null;
let chromeWc = null;
let tabs = [];
let activeId = null;
let nextId = 1;
// 2.3.0 tool views: one view per tool (aibrowser://tool?id=…), shown over the content area instead of opening a tab.
const toolViews = new Map(); // tool id -> tab-like { id, tool, view, wc, ... }
let lastTabId = null;        // last real tab, shown again when a tool view is closed
// split view: two tabs side by side, shown while one of them is active
let split = null;            // { left, right, ratio }
const SPLIT_GAP = 6;
// spaces: tab groups by subject (the tab strip shows the tabs of the current space)
let spaceId = 'main';
const lastInSpace = new Map();
const TOOL_NAMES = { solve: '解题', geogebra: 'GeoGebra', physics: '物理实验', wiki: '百科', dict: '词典', code: '代码', readlater: '稍后阅读', snap: '拍题' };
const overlays = { menu: null, find: null, lookup: null };
const hooks = { onTabsChanged: () => {}, prepareIncognito: () => {}, shortcut: () => false };
const INCOG_PARTITION = 'aib-incognito'; // no 'persist:' prefix -> in-memory session, separate cookies/cache/storage
let incogReady = false;
function incognitoSession() {
  const ses = session.fromPartition(INCOG_PARTITION);
  if (!incogReady) { incogReady = true; hooks.prepareIncognito(ses); }
  return ses;
}

function wcOptions(incognito) {
  if (incognito) incognitoSession();
  return { webPreferences: { ...(incognito ? { partition: INCOG_PARTITION } : {}), preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } };
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
function createTab(url, { activate = true, incognito = false, tool = null } = {}) {
  const view = new WebContentsView(wcOptions(incognito));
  view.setBackgroundColor('#00000000');
  const wc = view.webContents;
  const tab = { id: nextId++, view, wc, title: '', favicon: '', loading: false, url: '', incognito: !!incognito, space: spaceId, tool };
  if (tool) toolViews.set(tool, tab); else tabs.push(tab);
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
  wc.on('page-title-updated', (e, title) => { tab.title = title; notify(); const u = wc.getURL(); if (!isInternal(u) && !tab.incognito) store.updateHistoryTitle(u, title, { private: !!tab.incognito }); });
  wc.on('page-favicon-updated', (e, favs) => { tab.favicon = favs[0] || ''; notify(); });
  wc.on('did-start-loading', () => { tab.loading = true; notify(); });
  wc.on('did-stop-loading', () => { tab.loading = false; notify(); });
  const nav = (e, url) => { tab.url = url; if (!isInternal(url) && !tab.incognito) store.addHistory(url, wc.getTitle(), { private: !!tab.incognito }); notify(); };
  wc.on('did-navigate', nav);
  wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) nav(e, url); });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) { tab.title = desc; tab.error = { code, desc, url }; notify(); }
  });
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (toolIdOf(url)) { openTool(toolIdOf(url), url); return { action: 'deny' }; }
    if (/^https?:|^chrome-extension:|^aibrowser:/i.test(url)) createTab(url, { activate: disposition !== 'background-tab', incognito: tab.incognito });
    return { action: 'deny' };
  });
  wc.on('context-menu', (e, params) => showContextMenu(tab, params));
  wc.on('found-in-page', (e, r) => { if (overlays.find && !overlays.find.webContents.isDestroyed()) overlays.find.webContents.send('find:result', { active: r.activeMatchOrdinal, matches: r.matches }); });
  wc.on('destroyed', () => { chat.cancelForWebContents(wc.id); });
  wc.on('before-input-event', (e, input) => {
    if (hooks.shortcut(input)) { e.preventDefault(); return; }
    if (input.type === 'keyDown' && input.key === 'Escape' && overlays.find) closeOverlay('find');
  });
}

function getTab(id) { return tabs.find(t => t.id === id) || Array.from(toolViews.values()).find(t => t.id === id); }
function activeTab() { return getTab(activeId); }
function allViews() { return tabs.concat(Array.from(toolViews.values())); }
function inSplit(id) { return !!(split && (split.left === id || split.right === id)); }
function splitShown() { const a = getTab(activeId); return !!(split && a && !a.tool && inSplit(activeId) && getTab(split.left) && getTab(split.right)); }

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const siriW = overlays.siri ? Math.min(380, Math.round(w * 0.34)) : 0;
  const cw = Math.max(0, w - siriW), ch = Math.max(0, h - CHROME_H);
  const full = { x: 0, y: CHROME_H, width: cw, height: ch };
  for (const t of allViews()) t.view.setBounds(full);
  if (splitShown()) {
    const lw = Math.round(Math.max(240, Math.min(cw - 240, cw * split.ratio)) - SPLIT_GAP / 2);
    getTab(split.left).view.setBounds({ x: 0, y: CHROME_H, width: lw, height: ch });
    getTab(split.right).view.setBounds({ x: lw + SPLIT_GAP, y: CHROME_H, width: Math.max(0, cw - lw - SPLIT_GAP), height: ch });
    split.x = lw;
  }
  if (overlays.siri) overlays.siri.setBounds({ x: w - siriW, y: CHROME_H, width: siriW, height: Math.max(0, h - CHROME_H) });
  if (overlays.menu) overlays.menu.setBounds(menuBounds());
  if (overlays.find) overlays.find.setBounds(findBounds());
}

function activateTab(id) {
  const t = getTab(id);
  if (!t) return;
  activeId = id;
  if (!t.tool) { lastTabId = id; if (t.space !== spaceId) spaceId = t.space; lastInSpace.set(spaceId, id); }
  const both = splitShown();
  for (const x of allViews()) x.view.setVisible(x.id === id || (both && inSplit(x.id)));
  layout();
  closeOverlay('menu'); closeOverlay('lookup');
  if (overlays.find) closeOverlay('find');
  // keep overlays above
  t.wc.focus();
  try { t.wc.send('tab:shown'); } catch {} // pages lift their theme-switch transition guard once really on screen
  notify();
}

function createIncognitoTab(url) { return createTab(url || `${SCHEME}://home`, { incognito: true }); }
// last incognito tab closed -> forget everything of that session
function wipeIncognito() {
  try { const ses = session.fromPartition(INCOG_PARTITION); ses.clearStorageData().catch(() => {}); ses.clearCache().catch(() => {}); } catch {}
}

function closeTab(id) {
  const tv = Array.from(toolViews.values()).find(t => t.id === id);
  if (tv) return closeTool(tv.tool);
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const t = tabs[i];
  tabs.splice(i, 1);
  if (inSplit(id)) split = null;
  if (lastTabId === id) lastTabId = null;
  for (const [k, v] of lastInSpace) if (v === id) lastInSpace.delete(k);
  if (t.incognito && !tabs.some(x => x.incognito)) wipeIncognito();
  try { win.contentView.removeChildView(t.view); } catch {}
  try { t.wc.close({ waitForBeforeUnload: false }); } catch {}
  if (!tabs.length) { createTab(); return; }
  if (activeId === id) {
    const same = tabs.filter(x => x.space === t.space);
    activateTab((same.length ? same[Math.min(i, same.length - 1)] : tabs[Math.min(i, tabs.length - 1)]).id);
  } else layout();
  notify();
}

// ---------------- tool views (U1): aibrowser://tool?id=X opens or shows the single view of that tool
function toolIdOf(url) {
  try { const u = new URL(url); if (u.protocol === SCHEME + ':' && u.hostname === 'tool') return u.searchParams.get('id') || ''; } catch {}
  return '';
}
function openTool(id, url) {
  if (!id) return null;
  const PAGE_TOOLS = { code: `${SCHEME}://code`, readlater: `${SCHEME}://readlater` };
  const target = url || PAGE_TOOLS[id] || `${SCHEME}://tool?id=${encodeURIComponent(id)}`;
  let t = toolViews.get(id);
  if (t && !t.wc.isDestroyed()) {
    if (url && url !== (t.wc.getURL() || t.url)) load(t, target);
    activateTab(t.id); return t;
  }
  t = createTab(target, { tool: id });
  return t;
}
function closeTool(id) {
  const t = toolViews.get(id); if (!t) return;
  toolViews.delete(id);
  try { win.contentView.removeChildView(t.view); } catch {}
  try { t.wc.close({ waitForBeforeUnload: false }); } catch {}
  if (activeId === t.id) {
    const back = getTab(lastTabId) || tabs.find(x => x.space === spaceId) || tabs[0];
    if (back) activateTab(back.id); else createTab();
  }
  notify();
}
/** Hide the tool view and show the last tab (the tool keeps its state). */
function lastTab() { const a = activeTab(); return (a && !a.tool) ? a : (getTab(lastTabId) || tabs[0] || null); }
function hideTool() { const a = activeTab(); if (a && a.tool) { const back = getTab(lastTabId) || tabs[0]; if (back) activateTab(back.id); } }

// ---------------- split view (F2)
function toggleSplit(otherId) {
  if (split) { split = null; const a = activeTab(); for (const x of allViews()) x.view.setVisible(a && x.id === a.id); layout(); notify(); return false; }
  let a = activeTab(); if (a && a.tool) a = getTab(lastTabId);
  if (!a) return false;
  let b = otherId && getTab(otherId);
  if (!b || b.tool || b.id === a.id) {
    const same = tabs.filter(x => x.space === a.space && x.id !== a.id);
    b = same[same.indexOf(a) + 1] || same[same.length - 1];
  }
  if (!b) b = createTab(`${SCHEME}://home`, { activate: false });
  split = { left: a.id, right: b.id, ratio: 0.5 };
  activateTab(a.id);
  return true;
}
function setSplitRatio(r) { if (!split) return; split.ratio = Math.max(0.2, Math.min(0.8, Number(r) || 0.5)); layout(); notify(); }
function swapSplit() { if (!split) return; split = { left: split.right, right: split.left, ratio: 1 - split.ratio }; layout(); notify(); }

// ---------------- spaces (F2): tab groups by subject
const SUBJECTS = ['数学', '物理', '化学', '生物', '语文', '英语', '历史', '地理', '政治', '信息技术', '阅读', '其他'];
function spaces() {
  const list = (store.getSettings().spaces || []).filter(x => x && x.id && x.name);
  return [{ id: 'main', name: '默认' }].concat(list.filter(x => x.id !== 'main'));
}
function addSpace(name) {
  name = String(name || '').trim().slice(0, 20); if (!name) return null;
  const list = spaces().slice(1);
  let sp = list.find(x => x.name === name);
  if (!sp) { sp = { id: 's' + Date.now().toString(36), name }; list.push(sp); store.patchSettings({ spaces: list }); }
  switchSpace(sp.id); return sp;
}
function removeSpace(id) {
  if (id === 'main') return false;
  store.patchSettings({ spaces: spaces().slice(1).filter(x => x.id !== id) });
  for (const t of tabs) if (t.space === id) t.space = 'main';
  if (spaceId === id) switchSpace('main'); else notify();
  return true;
}
function switchSpace(id) {
  if (!spaces().some(x => x.id === id)) id = 'main';
  spaceId = id; split = null;
  const t = getTab(lastInSpace.get(id)) || tabs.find(x => x.space === id);
  if (t) activateTab(t.id); else createTab(`${SCHEME}://home`);
  notify();
}
function moveToSpace(tabId, id) {
  const t = getTab(tabId); if (!t || t.tool || !spaces().some(x => x.id === id)) return false;
  t.space = id; if (inSplit(tabId)) split = null;
  switchSpace(id); return true;
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
  if (t.tool) { display = TOOL_NAMES[t.tool] || t.title || t.tool; }
  return {
    id: t.id, title: t.title || (kind === 'home' ? '' : url), url, display, kind, icon, favicon: t.favicon, loading: t.loading, tool: t.tool || null, space: t.space,
    canBack: nh ? nh.canGoBack() : false, canForward: nh ? nh.canGoForward() : false,
    bookmarked: !isInternal(url) && !t.incognito && store.isBookmarked(url), active: t.id === activeId, incognito: !!t.incognito,
    storeExt: (() => { try { const id = require('./ext/chrome').storeIdOf(url); return id ? { id, installed: require('./ext/chrome').isInstalled(id) } : null; } catch { return null; } })()
  };
}

function notify() {
  hooks.onTabsChanged();
  if (chromeWc && !chromeWc.isDestroyed()) chromeWc.send('tabs:state', state());
}
function state() {
  const s = store.getSettings();
  const a = activeTab();
  return {
    tabs: tabs.filter(t => t.space === spaceId).map(tabInfo), activeId, mode: s.mode, lang: s.lang,
    current: a ? tabInfo(a) : null,
    tools: Array.from(toolViews.values()).map(t => ({ id: t.tool, tabId: t.id, name: TOOL_NAMES[t.tool] || t.tool, active: t.id === activeId })),
    activeTool: a && a.tool ? a.tool : null,
    split: splitShown() ? { left: split.left, right: split.right, ratio: split.ratio, x: split.x || 0, top: CHROME_H } : (split ? { left: split.left, right: split.right, hidden: true } : null),
    spaces: spaces().map(x => ({ id: x.id, name: x.name, count: tabs.filter(t => t.space === x.id).length, active: x.id === spaceId })),
    space: spaceId, subjects: SUBJECTS
  };
}

// ---------------- navigation / input
function submit(text) {
  text = (text || '').trim();
  let t = activeTab();
  if (t && t.tool) { const back = getTab(lastTabId) || tabs[0]; if (back) { activateTab(back.id); t = back; } }
  if (!t || !text) return { ok: false };
  const mode = store.getSettings().mode;
  if (looksLikeUrl(text)) { load(t, normalizeUrl(text)); return { ok: true, type: 'url' }; }
  if (mode === 'search') { load(t, store.searchUrl(text)); return { ok: true, type: 'search' }; }
  if (store.getSettings().workMode === 'task') {
    const sid = chat.create(text, 'task');
    load(t, `${SCHEME}://chat?sid=${sid}`);
    return { ok: true, type: 'task', sid };
  }
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
function menuBounds() { const [w] = win.getContentSize(); return { x: w - 256, y: CHROME_H - 10, width: 248, height: 526 }; }
function findBounds() { const [w] = win.getContentSize(); return { x: w - 400, y: CHROME_H + 6, width: 392, height: 48 }; }

function openOverlay(kind, bounds, query) {
  closeOverlay(kind);
  const view = new WebContentsView(wcOptions());
  view.setBackgroundColor('#00000000');
  overlays[kind] = view;
  view.setBounds(bounds);
  win.contentView.addChildView(view);
  view.webContents.loadURL(`${SCHEME}://${kind}${query ? '?' + query : ''}`);
  if (kind !== 'find' && kind !== 'siri') {
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
function toggleSiri() {
  if (overlays.siri) { closeOverlay('siri'); layout(); return false; }
  const [w, h] = win.getContentSize();
  const siriW = Math.min(380, Math.round(w * 0.34));
  openOverlay('siri', { x: w - siriW, y: CHROME_H, width: siriW, height: Math.max(0, h - CHROME_H) });
  layout();
  return true;
}
function showFind() {
  const t = activeTab();
  if (!t || isInternal(t.wc.getURL())) return;
  if (overlays.find) { overlays.find.webContents.focus(); overlays.find.webContents.send('find:focus'); return; }
  openOverlay('find', findBounds());
}

let lastLookup = { word: '', t: 0 };
function showLookup(word, x, y, tab, kind, size) {
  const now = Date.now();
  if (!size && word === lastLookup.word && now - lastLookup.t < 700) return;
  lastLookup = { word, t: now };
  const t = tab || activeTab();
  if (!t) return;
  const vb = t.view.getBounds();
  const [w, h] = win.getContentSize();
  const W = Number(size && size.w) > 0 ? Math.round(Number(size.w)) : 400;
  const H = Number(size && size.h) > 0 ? Math.round(Number(size.h)) : 300;
  let px = Math.round(vb.x + x - 20), py = Math.round(vb.y + y + 8);
  px = Math.max(8, Math.min(px, w - W - 8));
  if (py + H > h - 8) py = Math.max(CHROME_H + 4, Math.round(vb.y + y - H - 30));
  openOverlay('lookup', { x: px, y: py, width: W, height: H }, 'q=' + encodeURIComponent(word) + (kind ? '&k=' + kind : ''));
}

// ---------------- context menu
function showContextMenu(tab, p) {
  const tpl = [];
  const wc = tab.wc;
  const lang = store.getSettings().lang;
  const L = (zh, en) => lang === 'en' ? en : zh;
  const sel = (p.selectionText || '').trim();
  if (sel) {
    const kind = require('./v36/v36').selectionKind(sel);
    if (kind === 'word') tpl.push({ label: L(`查词 “${sel}”`, `Look up “${sel}”`), click: () => { lastLookup = { word: '', t: 0 }; showLookup(sel, p.x, p.y, tab, 'word'); } });
    else if (kind === 'sentence') tpl.push({ label: L('翻译所选内容', 'Translate selection'), click: () => { showLookup(sel.slice(0, 500), p.x, p.y, tab, 'sentence'); } });
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
    backgroundColor: require('./appearance').current().base, title: 'AI浏览器', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 11 },
    show: !process.env.AIB_HIDE, webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  chromeWc = win.webContents;
  chromeWc.on('before-input-event', (e, input) => { if (hooks.shortcut(input)) e.preventDefault(); });
  win.loadURL(`${SCHEME}://chrome`);
  win.on('resize', layout);
  win.on('enter-full-screen', layout); win.on('leave-full-screen', layout);
  win.on('closed', () => { win = null; chromeWc = null; tabs = []; toolViews.clear(); split = null; activeId = null; overlays.menu = overlays.find = overlays.lookup = null; });
  chromeWc.on('did-finish-load', () => notify());
  win.webContents.on('did-finish-load', () => {
    if (!tabs.length) {
      const ob = (store.getSettings().onboarding || {});
      createTab(ob.completed ? `${SCHEME}://home` : `${SCHEME}://onboarding`);
    }
  });
  return win;
}

function getWin() { return win; }
function allTabs() { return allViews(); }

function broadcastToActive(channel, payload) {
  const t = activeTab();
  if (t && t.wc && !t.wc.isDestroyed()) try { t.wc.send(channel, payload); } catch {}
}

module.exports = {
  CHROME_H, createWindow, createTab, createIncognitoTab, closeTab, activateTab, getTab, activeTab, allTabs, submit, openInternal, load, broadcastToActive, toggleSiri,
  toggleMenu, closeOverlay, showFind, showLookup, openOverlay, overlays, zoom, state, notify, getWin, hooks, looksLikeUrl, isInternal,
  tabInfo, layout, openTool, closeTool, hideTool, toolIdOf, lastTab, toggleSplit, setSplitRatio, swapSplit, spaces, addSpace, removeSpace, switchSpace, moveToSpace, SUBJECTS, TOOL_NAMES
};
