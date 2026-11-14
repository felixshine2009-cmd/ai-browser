'use strict';
// v3.0.0 document service: keeps layout-engine documents, measures them in a hidden web view, renders previews and
// exports PDF / HTML. Shared by the agent tools (ai/tools.js) and the chat page (IPC doc:*).
const fs = require('fs');
const path = require('path');
const E = require('./engine');

let electron = null; try { electron = require('electron'); } catch {}
const app = () => electron && electron.app;
const baseDir = () => { const d = path.join(app() ? app().getPath('userData') : require('os').tmpdir(), 'documents'); fs.mkdirSync(d, { recursive: true }); return d; };
const docs = new Map();
let current = null;
let onExported = null;

const file = (id) => path.join(baseDir(), String(id).replace(/[^\w-]/g, '') + '.json');
function save(doc) { doc.updated = Date.now(); try { fs.writeFileSync(file(doc.id), JSON.stringify(doc)); } catch {} }
function get(id) {
  const key = id || current;
  if (!key) throw new Error('还没有文档：请先调用 doc_new（或使用排版助手 / 生成助手）');
  if (docs.has(key)) return docs.get(key);
  try { const d = JSON.parse(fs.readFileSync(file(key), 'utf8')); docs.set(d.id, d); return d; } catch {}
  throw new Error('没有该文档：' + key);
}
function create(opts) { const r = E.createDoc(opts); docs.set(r.doc.id, r.doc); current = r.doc.id; save(r.doc); return r; }
function use(id) { const d = get(id); current = d.id; return d; }
function list() {
  const out = [];
  try { for (const f of fs.readdirSync(baseDir())) if (f.endsWith('.json')) { try { const d = docs.get(f.slice(0, -5)) || JSON.parse(fs.readFileSync(path.join(baseDir(), f), 'utf8')); out.push({ id: d.id, title: d.title, kind: d.kind, pages: d.pages, updated: d.updated }); } catch {} } } catch {}
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
function mutate(id, fn) { const d = get(id); current = d.id; const r = fn(d); save(d); return r; }

// ---------------------------------------------------------------- hidden web view
// iPad: a page loaded from a file may only read its own directory, so fonts (KaTeX, CJK document fonts) are copied
// once into documents/assets and referenced relatively; elsewhere the engine uses file URLs
function assetUrl(abs) {
  if (!global.__aibIpad) return null;
  const dir = path.join(baseDir(), 'assets'); const name = path.basename(abs); const dest = path.join(dir, name);
  try { const st = fs.statSync(abs); let ok = false; try { ok = fs.statSync(dest).size === st.size; } catch {} if (!ok) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(abs, dest); } } catch { return null; }
  return 'assets/' + encodeURIComponent(name);
}
const render = (doc, o) => E.renderHtml(doc, Object.assign({ assetUrl }, o));
const PX = 96 / 25.4;
async function withView(html, size, fn) {
  if (!electron || !electron.BrowserWindow) throw new Error('当前环境无法渲染文档');
  const tmp = path.join(baseDir(), 'render-' + process.pid + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.html');
  fs.writeFileSync(tmp, html);
  const win = new electron.BrowserWindow({ show: false, width: Math.max(320, Math.round(size[0])), height: Math.max(240, Math.round(size[1])), useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, offscreen: false } });
  try {
    await Promise.race([win.loadURL(require('url').pathToFileURL(tmp).href), new Promise((_, rej) => setTimeout(() => rej(new Error('文档渲染超时')), 30000))]);
    try { await win.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => 1) : 1'); } catch {}
    return await fn(win.webContents, win);
  } finally {
    try { win.destroy(); } catch {}
    try { fs.unlinkSync(tmp); } catch {}
  }
}
// measures the real height of every auto-height element and re-flows (twice at most: page breaks can change widths)
async function measure(doc) {
  let changed = 0;
  for (let pass = 0; pass < 2; pass++) {
    const [W, H] = E.pageDims(doc.page);
    let heights = null;
    try { heights = await withView(render(doc, { bare: true }), [W * PX, H * PX], (wc) => wc.executeJavaScript(E.MEASURE_JS)); } catch { return { measured: false, changed }; }
    const c = E.applyMeasurements(doc, heights || {});
    changed += c; if (!c) break;
  }
  save(doc);
  return { measured: true, changed };
}
async function preview(id, opts = {}) {
  const doc = get(id);
  const m = opts.measure === false ? { measured: false } : await measure(doc);
  const fix = opts.fix ? E.fixOverlaps(doc, opts.fix === true ? 'all' : opts.fix) : null;
  if (fix) save(doc);
  const report = E.check(doc);
  const [W, H] = E.pageDims(doc.page);
  const pages = opts.page ? [Math.max(1, Math.min(doc.pages, Number(opts.page) || 1))] : Array.from({ length: Math.min(doc.pages, Number(opts.maxPages) || 2) }, (_, i) => i + 1);
  const images = [];
  for (const p of pages) {
    try {
      const png = await withView(render(doc, { bare: true, page: p }), [W * PX, H * PX], async (wc) => {
        let img = null;
        const rect = { x: 0, y: 0, width: Math.round(W * PX), height: Math.round(H * PX) };
        for (let i = 0; i < 3 && (!img || img.isEmpty()); i++) { try { img = await wc.capturePage(rect, { stayHidden: true }); } catch { try { img = await wc.capturePage(rect); } catch {} } if (!img || img.isEmpty()) await new Promise(r => setTimeout(r, 200)); }
        if (!img || img.isEmpty()) return null;
        const sz = img.getSize(); const target = Math.min(900, sz.width);
        return (sz.width > target ? img.resize({ width: target }) : img).toPNG();
      });
      if (png && png.length) images.push({ page: p, dataUrl: 'data:image/png;base64,' + png.toString('base64') });
    } catch {}
  }
  return { doc: E.summary(doc), measured: !!m.measured, fixed: fix, report, images };
}
function safeName(s) { return String(s || '文档').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || '文档'; }
function outDir() { const d = process.env.AIB_DOWNLOAD_DIR || (app() ? app().getPath('downloads') : baseDir()); fs.mkdirSync(d, { recursive: true }); return d; }
function uniquePath(dir, name) { let p = path.join(dir, name); const ext = path.extname(name), b = path.basename(name, ext); for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${b} (${i})${ext}`); return p; }
async function exportDoc(id, format = 'pdf') {
  const doc = get(id);
  await measure(doc);
  const fmt = format === 'html' ? 'html' : 'pdf';
  const dest = uniquePath(outDir(), safeName(doc.title) + '.' + fmt);
  if (fmt === 'html') fs.writeFileSync(dest, E.renderHtml(doc, { inlineFonts: true }));
  else {
    const [W, H] = E.pageDims(doc.page);
    const buf = await withView(render(doc, { bare: true }), [W * PX, H * PX], (wc) => wc.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' }, pageSize: { width: W / 25.4, height: H / 25.4 },
      // iPad host: one PDF page per page rectangle (CSS px), merged natively (Services/PDFPages.swift)
      aibPageRects: Array.from({ length: doc.pages }, (_, i) => ({ x: 0, y: Math.round(i * H * PX * 100) / 100, width: Math.round(W * PX * 100) / 100, height: Math.round(H * PX * 100) / 100 })) }));
    if (!buf || !buf.length) throw new Error('PDF 生成失败');
    fs.writeFileSync(dest, buf);
  }
  const r = { path: dest, file: path.basename(dest), format: fmt, bytes: fs.statSync(dest).size, pages: doc.pages };
  try { onExported && onExported(r, doc); } catch {}
  return r;
}
function html(id, opts) { return E.renderHtml(get(id), opts || { inlineFonts: true }); }
function openFile(id) { const doc = get(id); const p = path.join(baseDir(), 'view-' + doc.id + '.html'); fs.writeFileSync(p, render(doc, {})); return require('url').pathToFileURL(p).href; }
// a compact result object for tool calls: the chat page renders it as a document card
function card(doc, extra = {}) { return Object.assign({ doc: { id: doc.id, title: doc.title, kind: doc.kind, pages: doc.pages, size: doc.page.size } }, extra); }

module.exports = { E, create, get, use, list, mutate, save, measure, preview, exportDoc, html, openFile, card, setOnExported: (fn) => { onExported = fn; }, currentId: () => current, _docs: docs };
