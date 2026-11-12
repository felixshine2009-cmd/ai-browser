'use strict';
// iPad host SIMULATOR. A JavaScript reference implementation of the native Swift host (ipad/App) on Electron, used to run
// and test the iPad payload (the desktop main process on the Electron shim, under Node 18 like nodejs-mobile) on Linux CI.
// Every command / event follows the same protocol as BrowserViewController.swift + WebHost.swift (see ipad/node/host.js).
// Differences from the device (sim only): web views are Chromium WebContentsViews, the bridge runs in the page world.
// env: AIB_BUNDLE (built payload), AIB_NODE (node 18 binary), AIB_SIM_UD (userData), AIB_SIM_SIZE (WxH points), AIB_SIM_DARK
const { app, BaseWindow, WebContentsView, protocol, ipcMain, nativeTheme, session, clipboard, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BUNDLE = path.resolve(process.env.AIB_BUNDLE || path.join(__dirname, '..', '..', 'dist', 'ipad-bundle'));
const NP = path.join(BUNDLE, 'nodejs-project');
const UD = process.env.AIB_SIM_UD || fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipad-ud-'));
const DOCS = path.join(UD, '..', path.basename(UD) + '-docs');
let [W, H] = String(process.env.AIB_SIM_SIZE || '1180x820').split('x').map(Number);
const log = (...a) => { if (process.env.AIB_SIM_VERBOSE) console.log('[sim]', ...a); };
const NODE_SCHEMES = ['aibrowser', 'aibdict', 'aibext', 'aibzim'];
protocol.registerSchemesAsPrivileged(NODE_SCHEMES.concat(['aibres']).map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } })));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
if (process.env.AIB_SIM_DARK === '0') nativeTheme.themeSource = 'light';

// ------------------------------------------------------------------ loopback bridge client (Host.swift)
let port = 0; const token = crypto.randomBytes(24).toString('hex');
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
function post(p, body, headers = {}) {
  return new Promise((resolve) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body == null ? {} : body));
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', agent, headers: Object.assign({ 'X-AIB-Token': token, 'Content-Length': buf.length, 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' }, headers) }, (res) => {
      const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch) }));
    });
    req.on('error', (e) => resolve({ status: 502, headers: {}, body: Buffer.from(String(e.message)) }));
    req.end(buf);
  });
}
const postJson = async (p, m) => { const r = await post(p, m); try { return JSON.parse(r.body.toString('utf8')); } catch { return null; } };
const event = async (m) => { const r = await postJson('/host/event', m); return r && r.answer; };
const reply = (seq, ok, result, error) => { if (seq) postJson('/host/reply', { seq, ok, result: result === undefined ? null : result, error }); };

function connectStream(onCmd) {
  const go = () => {
    const req = http.get({ host: '127.0.0.1', port, path: '/host/events', headers: { 'X-AIB-Token': token } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return setTimeout(go, 150); }
      let buf = '';
      onConnected();
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
          if (data) { try { onCmd(JSON.parse(data)); } catch (e) { console.error('[sim] bad cmd', e.message); } }
        }
      });
      res.on('end', () => setTimeout(go, 500));
    });
    req.on('error', () => setTimeout(go, 150));
  };
  go();
}
let connectedOnce = false;
function onConnected() {
  if (connectedOnce) return; connectedOnce = true;
  event({ type: 'init', w: W, h: H, dark: nativeTheme.shouldUseDarkColors, biometry: false, safeKey: crypto.createHash('sha256').update(UD).digest('base64'), locale: 'zh-CN', os: '17.5 (simulator)' });
}

// ------------------------------------------------------------------ web views (WebHost.swift)
let win = null; let winHostId = 0;
const hosts = new Map(); // wc id -> { id, kind, view, partition, lastURL, attached, visible, bounds }
const sessions = new Map();
function sessFor(partition, persistent) {
  const key = persistent ? 'persist:aib-sim' : 'aib-sim-' + (partition || 'mem');
  if (sessions.has(key)) return sessions.get(key);
  const s = session.fromPartition(key);
  for (const sc of NODE_SCHEMES) s.protocol.handle(sc, schemeHandler);
  s.protocol.handle('aibres', resHandler);
  s.on('will-download', (e, item, wc) => onDownload(e, item, wc, partition));
  sessions.set(key, s); return s;
}
async function schemeHandler(req) {
  const headers = {}; req.headers.forEach((v, k) => { headers[k] = v; });
  const body = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await req.arrayBuffer());
  const meta = JSON.stringify({ url: req.url, method: req.method, headers }).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const r = await post('/scheme', body, { 'X-AIB-Meta': meta });
  const st = Number(r.headers['x-aib-status'] || r.status || 200);
  const h = {}; for (const [k, v] of Object.entries(r.headers)) if (!/^(x-aib-status|content-length|connection|keep-alive|transfer-encoding|date)$/i.test(k)) h[k] = v;
  return new Response(st === 204 || st === 304 ? null : r.body, { status: st, headers: h });
}
async function resHandler(req) {
  // same layout as SchemeHandler.swift: aibres://data/… = userData, aibres://app/pyodide|vm/… = payload, aibres://app/… = payload/web
  const u = new URL(req.url); const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const root = u.host === 'data' ? UD : BUNDLE;
  const f = u.host === 'data' ? path.join(UD, rel) : /^(pyodide|vm)\//.test(rel) ? path.join(BUNDLE, rel) : path.join(BUNDLE, 'web', rel);
  let f2 = f, root2 = root;
  // graphical VM image: blobs that are not in the bundled base image were downloaded to userData/vm-gui/fs/ (SchemeHandler.swift)
  if (u.host !== 'data' && /^vm\/fs\//.test(rel) && !fs.existsSync(f)) { f2 = path.join(UD, 'vm-gui', 'fs', path.basename(rel)); root2 = UD; }
  return serveFile(f2, root2);
}
function serveFile(f, root) {
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response('not found', { status: 404 });
  const ext = path.extname(f).toLowerCase();
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
  return new Response(fs.readFileSync(f), { headers: { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' } });
}
const emit = (h, name, extra) => event(Object.assign({ type: 'wc', id: h.id, name }, extra || {}));
function navState(h) { const wc = h.view.webContents; if (wc.isDestroyed()) return; emit(h, 'navstate', { url: wc.getURL(), title: wc.getTitle(), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward(), loading: wc.isLoading() }); }

function createHost(m) {
  const view = new WebContentsView({ webPreferences: { session: sessFor(m.partition, m.persistent), preload: path.join(__dirname, 'preload.js'), contextIsolation: false, sandbox: false, nodeIntegration: false, backgroundThrottling: false } });
  const h = { id: m.id, kind: m.kind, view, partition: m.partition || '', attached: false, visible: true, bounds: { x: 0, y: 0, width: 0, height: 0 } };
  hosts.set(m.id, h);
  view.setBackgroundColor('#00000000');
  const wc = view.webContents;
  wc.on('did-start-loading', () => { emit(h, 'start', { url: wc.getURL() }); navState(h); });
  wc.on('did-stop-loading', () => { emit(h, 'stop', { url: wc.getURL() }); navState(h); });
  wc.on('did-navigate', (e, url) => { emit(h, 'navigate', { url, inPage: false }); navState(h); });
  wc.on('did-navigate-in-page', (e, url, main) => { if (main) { emit(h, 'navigate', { url, inPage: true }); navState(h); } });
  wc.on('page-title-updated', (e, title) => { emit(h, 'title', { title }); navState(h); });
  wc.on('page-favicon-updated', (e, f) => emit(h, 'favicon', { url: (f && f[0]) || '' }));
  wc.on('did-finish-load', () => { emit(h, 'domready'); emit(h, 'finish'); navState(h); if (h.id === winHostId && !sim.windowShown) { sim.windowShown = Date.now(); event({ type: 'app', name: 'windowShown' }); } });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain) emit(h, 'fail', { code, desc, url }); });
  wc.on('focus', () => emit(h, 'focus')); wc.on('blur', () => emit(h, 'blur'));
  wc.on('found-in-page', (e, r) => emit(h, 'found', { requestId: r.requestId, active: r.activeMatchOrdinal, matches: r.matches }));
  wc.on('context-menu', (e, p) => emit(h, 'context', { params: { x: p.x, y: p.y, linkURL: p.linkURL, srcURL: p.srcURL, mediaType: p.mediaType, selectionText: p.selectionText, isEditable: p.isEditable } }));
  wc.on('render-process-gone', () => emit(h, 'gone'));
  wc.setWindowOpenHandler(({ url, disposition }) => { emit(h, 'newwin', { url, disposition: disposition === 'background-tab' ? 'background-tab' : 'foreground-tab' }); return { action: 'deny' }; });
  wc.on('before-input-event', (e, i) => {
    // hardware-keyboard shortcuts: the native host sends Cmd/Ctrl key combos as 'key' events (UIKeyCommand)
    if (i.type !== 'keyDown' || !(i.meta || i.control)) return;
    e.preventDefault();
    emit(h, 'key', { key: i.key, code: i.code, meta: i.meta, ctrl: i.control, shift: i.shift, alt: i.alt }).then((a) => { if (!a || !a.handled) { /* not handled: let the page see it */ } });
  });
  return h;
}
function layoutHost(h) {
  if (!win || !h) return;
  if (h.id === winHostId) h.view.setBounds({ x: 0, y: 0, width: W, height: H });
  else h.view.setBounds(h.bounds);
  h.view.setVisible(!!h.visible);
}
function attach(h) {
  if (!win || !h) return;
  try { win.contentView.removeChildView(h.view); } catch {}
  win.contentView.addChildView(h.view); h.attached = true; layoutHost(h);
}

// ------------------------------------------------------------------ commands (BrowserViewController.swift)
const sim = { menuChoice: null, dialogChoice: null, openPaths: [], cmds: [], log: [], diag: [], windowShown: 0 };
global.__aibSim = sim;
async function onCmd(m) {
  sim.log.push(m.cmd === 'wc.send' ? { cmd: m.cmd, id: m.id, channel: m.channel } : m.cmd === 'wc.exec' || m.cmd === 'wc.css' ? { cmd: m.cmd, id: m.id } : m); if (sim.log.length > 4000) sim.log.splice(0, 2000);
  const h = hosts.get(m.id);
  const ok = (result) => reply(m.seq, true, result);
  const err = (e) => reply(m.seq, false, null, String(e && e.message || e));
  try {
    switch (m.cmd) {
      case 'wc.create': createHost(m); break;
      case 'app.diag': sim.diag.push({ stage: m.stage, error: m.error, fatal: !!m.fatal }); break; // native: diagnostics panel
      case 'view.create': break;
      case 'window.attach': winHostId = m.id; attach(hosts.get(m.id)); break;
      case 'view.attach': if (h) { attach(h); const wh = hosts.get(winHostId); } break;
      case 'view.detach': if (h && win) { try { win.contentView.removeChildView(h.view); } catch {} h.attached = false; } break;
      case 'view.bounds': if (h) { h.bounds = { x: m.x, y: m.y, width: m.width, height: m.height }; layoutHost(h); } break;
      case 'view.visible': if (h) { h.visible = !!m.on; layoutHost(h); } break;
      case 'view.bg': if (h) { try { h.view.setBackgroundColor(m.color || '#00000000'); } catch {} } break;
      case 'wc.load': if (h) { if (m.ua) h.view.webContents.setUserAgent(m.ua); h.view.webContents.loadURL(m.url).catch(() => {}); } break;
      case 'wc.nav': if (h) { const wc = h.view.webContents; ({ back: () => wc.navigationHistory.goBack(), forward: () => wc.navigationHistory.goForward(), reload: () => wc.reload(), stop: () => wc.stop(), offset: () => wc.navigationHistory.goToOffset(m.offset) }[m.op] || (() => {}))(); } break;
      case 'wc.send': if (h && !h.view.webContents.isDestroyed()) h.view.webContents.executeJavaScript(`window.__aibDispatch && window.__aibDispatch(${JSON.stringify(m.channel)}, ${JSON.stringify(m.args || [])})`).catch(() => {}); break;
      case 'wc.exec': if (!h) return err('no such view'); ok(await h.view.webContents.executeJavaScript(m.code, true)); break;
      case 'wc.css': if (!h) return err('no such view'); await h.view.webContents.insertCSS(m.css); ok(true); break;
      case 'wc.focus': if (h) h.view.webContents.focus(); break;
      case 'wc.close': if (h) { try { win && win.contentView.removeChildView(h.view); } catch {} try { h.view.webContents.close(); } catch {} hosts.delete(m.id); event({ type: 'wc', id: m.id, name: 'closed' }); } break;
      case 'wc.ua': if (h) h.view.webContents.setUserAgent(m.ua || ''); break;
      case 'wc.zoom': if (h) h.view.webContents.setZoomFactor(m.factor || 1); break;
      case 'wc.mute': if (h) h.view.webContents.setAudioMuted(!!m.muted); break;
      case 'wc.find': if (h && m.text) h.view.webContents.findInPage(m.text, { forward: m.forward, findNext: m.findNext, matchCase: m.matchCase }); break;
      case 'wc.stopFind': if (h) h.view.webContents.stopFindInPage(m.action || 'clearSelection'); break;
      case 'wc.edit': if (h) { const wc = h.view.webContents; (wc[m.op] || (() => {})).call(wc); } break;
      case 'wc.snapshot': if (!h) return err('no such view'); ok({ b64: (await h.view.webContents.capturePage()).toPNG().toString('base64') }); break;
      case 'wc.pdf': if (!h) return err('no such view'); ok({ b64: (await h.view.webContents.printToPDF({})).toString('base64') }); break;
      case 'wc.print': ok({ ok: true }); break;
      case 'wc.devtools': break;
      case 'theme.set': nativeTheme.themeSource = ['light', 'dark'].includes(m.source) ? m.source : (process.env.AIB_SIM_DARK === '0' ? 'light' : 'system'); break;
      case 'menu.app': sim.appKeys = m.keys || []; break;
      case 'menu.popup': sim.lastMenu = m.items; { const c = sim.menuChoice; sim.menuChoice = null; ok({ id: typeof c === 'function' ? c(m.items) : c || null }); } break;
      case 'dialog.message': sim.lastDialog = m; { const c = sim.dialogChoice; sim.dialogChoice = null; ok({ response: c == null ? (m.defaultId || 0) : c }); } break;
      case 'dialog.open': ok({ paths: sim.openPaths.splice(0) }); break;
      case 'auth.biometric': ok({ ok: true }); break;
      case 'clipboard.write': clipboard.writeText(m.text || ''); break;
      case 'clipboard.image': break;
      case 'session.cookies': {
        const s = sessFor(m.partition, !m.partition || /^persist:/.test(m.partition));
        if (m.op === 'get') ok(await s.cookies.get(m.filter || {})); else if (m.op === 'set') { await s.cookies.set(m.cookie).catch(() => {}); ok(true); } else { await s.cookies.remove(m.url, m.name).catch(() => {}); ok(true); }
        break;
      }
      case 'session.clear': ok(true); break;
      case 'session.ua': break;
      case 'dl.pause': case 'dl.resume': case 'dl.cancel': { const d = dls.get(m.dlId); if (d) { try { d[m.cmd.slice(3)](); } catch {} } break; }
      case 'shell.open': case 'shell.show': case 'shell.external': case 'shell.export': sim.lastShell = m; break;
      case 'notify': case 'idle': break;
      case 'ext.load': ok({ ok: false, error: 'Chrome 扩展需要 Safari Web Extension 格式（模拟器不支持）' }); break;
      case 'ext.remove': break;
      default:
        if (/^llama\./.test(m.cmd)) return err('模拟器没有 llama.cpp（设备上由 Metal 原生运行）');
        log('unhandled', m.cmd); if (m.seq) err('unsupported: ' + m.cmd);
    }
  } catch (e) { console.error('[sim] cmd', m.cmd, e); err(e); }
}

// ------------------------------------------------------------------ downloads
const dls = new Map(); let dlSeq = 0;
async function onDownload(e, item, wc, partition) {
  log('will-download', item.getURL());
  const h = Array.from(hosts.values()).find(x => x.view.webContents === wc);
  const dlId = 'dl' + (++dlSeq);
  dls.set(dlId, item);
  item.setSavePath(path.join(os.tmpdir(), 'aib-sim-dl-' + dlId)); // placeholder until Node answers
  // listeners first: a small file can finish before Node has answered where to save it
  let dest = null, finished = null;
  const finish = (st) => {
    if (st === 'completed' && dest) { try { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(item.getSavePath(), dest); } catch (x) { try { fs.copyFileSync(item.getSavePath(), dest); } catch {} } }
    dls.delete(dlId);
    event({ type: 'dl', phase: 'done', dlId, received: item.getReceivedBytes(), state: st });
  };
  item.on('updated', () => { if (dest) event({ type: 'dl', phase: 'progress', dlId, received: item.getReceivedBytes(), total: item.getTotalBytes() }); });
  item.once('done', (ev, st) => { if (dest) finish(st); else finished = st; });
  const a = await event({ type: 'dl', phase: 'start', dlId, wcId: h ? h.id : 0, partition, url: item.getURL(), filename: item.getFilename(), total: item.getTotalBytes(), mime: item.getMimeType() });
  if (a && a.cancel) { try { item.cancel(); } catch {} if (finished) event({ type: 'dl', phase: 'done', dlId, received: 0, state: 'cancelled' }); return; }
  dest = (a && a.path) || path.join(DOCS, 'Downloads', item.getFilename());
  if (finished) finish(finished);
}

// ------------------------------------------------------------------ renderer IPC
ipcMain.handle('aib', async (e, body) => {
  const h = Array.from(hosts.values()).find(x => x.view.webContents === e.sender);
  if (!h || !body || !body.channel) return { ok: false, error: 'bad message' };
  const url = e.senderFrame ? e.senderFrame.url : e.sender.getURL();
  const scheme = (url.split(':')[0] || '');
  if (scheme !== 'aibrowser' && !['pw:creds', 'pw:fill', 'pw:submit', 'pw:ready', 'pw:answer', 'sel:lookup'].includes(body.channel)) return { ok: false, error: 'forbidden' };
  const m = { wcId: h.id, url, channel: body.channel, args: body.args || [] };
  if (body.t === 'invoke') return (await postJson('/ipc/invoke', m)) || { ok: false, error: 'no reply' };
  postJson('/ipc/send', m); return { ok: true };
});

// ------------------------------------------------------------------ start
app.whenReady().then(async () => {
  port = await new Promise((r) => { const s = require('net').createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  fs.mkdirSync(UD, { recursive: true }); fs.mkdirSync(DOCS, { recursive: true });
  Menu.setApplicationMenu(null);
  win = new BaseWindow({ x: 0, y: 0, frame: false, width: W, height: H, useContentSize: true, title: 'AI浏览器 (iPad simulator)', backgroundColor: '#0b0f10' });
  nativeTheme.on('updated', () => event({ type: 'theme', dark: nativeTheme.shouldUseDarkColors }));
  const nodeBin = process.env.AIB_NODE || 'node';
  // like nodejs-mobile on iOS: V8 without a JIT, hence no WebAssembly (AIB_SIM_JIT=1 turns the JIT back on)
  const child = spawn(nodeBin, [...(process.env.AIB_SIM_JIT === '1' ? [] : ['--jitless']), path.join(NP, 'main-ipad.js'), '--port', String(port), '--token', token, '--userdata', UD, '--documents', DOCS, '--tmp', os.tmpdir(), '--resources', BUNDLE], { cwd: NP, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '' }) });
  child.stdout.on('data', d => process.stdout.write('[node] ' + d)); child.stderr.on('data', d => process.stderr.write('[node] ' + d));
  child.on('exit', (c) => { console.log('[sim] node exited', c); app.quit(); });
  app.on('before-quit', () => { try { child.kill(); } catch {} });
  connectStream(onCmd);
  // test control (simulator only): what the native side received, and native-originated events (rotation, OS theme)
  if (process.env.AIB_SIM_CTL) http.createServer(async (req, res) => {
    const ch = []; for await (const c of req) ch.push(c);
    const body = ch.length ? JSON.parse(Buffer.concat(ch).toString('utf8')) : null;
    let out = null;
    if (req.url === '/cmds') out = sim.log;
    else if (req.url === '/event') out = await event(body);
    else if (req.url === '/menu') { sim.menuChoice = body && body.id; out = true; }
    else if (req.url === '/dialog') { sim.dialogChoice = body && body.response; out = true; }
    else if (req.url === '/state') out = { diag: sim.diag, windowShown: sim.windowShown, lastMenu: sim.lastMenu || null, lastDialog: sim.lastDialog || null, lastShell: sim.lastShell || null, appKeys: (sim.appKeys || []).length, themeSource: nativeTheme.themeSource, views: Array.from(hosts.values()).map(h => ({ id: h.id, kind: h.kind, url: h.view.webContents.getURL(), attached: h.attached, visible: h.visible, bounds: h.id === winHostId ? { x: 0, y: 0, width: W, height: H } : h.bounds })) };
    else if (req.url === '/resize') { const b = body || {}; win.setContentSize(b.w, b.h); W = b.w; H = b.h; for (const h of hosts.values()) layoutHost(h); out = await event({ type: 'window', w: b.w, h: b.h }); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
  }).listen(Number(process.env.AIB_SIM_CTL), '127.0.0.1');
});
app.on('window-all-closed', () => app.quit());
