'use strict';
// v3.0.0 layout engine (排版引擎). A document is a list of pages with absolutely positioned elements (millimetres).
// Pure JavaScript: no Electron here, so the same model runs on desktop, iPad and in tests.
//
//   doc = { id, title, page: { size, orientation, margin:{t,r,b,l}, background, header, footer, pageNumbers }, theme,
//           pages: n, elements: [ { id, type, page, x, y, w, h, rotation, anchor, z, flow, style, ... } ], cursor }
//
// * Positions: x / y / w / h in mm on page `page` (1-based); `anchor` names which point of the element (x, y) refers to
//   (top-left … center … bottom-right); `rotation` in degrees around that anchor.
// * Flow: an element added without y is placed under the previous flowed element, moving to a new page when it does
//   not fit. Elements with an explicit y are absolute and act as obstacles for the flow.
// * Styling only through named values (enums) so a model cannot produce broken CSS; unknown values fall back and are
//   reported in `warnings`.
// * Heights: estimated from text metrics; `applyMeasurements` replaces them with sizes measured in a real web view.

const PAGE_SIZES = { A4: [210, 297], A5: [148, 210], A3: [297, 420], B5: [176, 250], Letter: [215.9, 279.4], slide16x9: [254, 142.875], slide4x3: [254, 190.5], card: [90, 54], square: [200, 200] };
const MARGINS = { none: 0, narrow: 12, normal: 20, wide: 28 };
const FONTS = {
  sans: "'PingFang SC','Hiragino Sans GB','Noto Sans CJK SC','Source Han Sans SC','Microsoft YaHei',system-ui,sans-serif",
  serif: "'Songti SC','Noto Serif CJK SC','AIB Serif SC','Source Han Serif SC','SimSun','Times New Roman',serif",
  kai: "'Kaiti SC','STKaiti','KaiTi','AIB Kai SC','Noto Serif CJK SC',serif",
  hei: "'Heiti SC','PingFang SC','Noto Sans CJK SC','SimHei',sans-serif",
  mono: "ui-monospace,'SF Mono',Menlo,Consolas,'Noto Sans Mono CJK SC',monospace",
  rounded: "'PingFang SC','Hiragino Maru Gothic ProN','Noto Sans CJK SC',system-ui,sans-serif"
};
const SIZES = { xs: 8, s: 9.5, m: 11, l: 13.5, xl: 17, xxl: 22, h1: 28, display: 40 }; // pt
const COLORS = {
  text: '#1d1d1f', muted: '#6e6e73', primary: '#1f6feb', accent: '#0a8f6a', red: '#d93025', orange: '#e8710a', yellow: '#f9ab00',
  green: '#188038', blue: '#1a73e8', teal: '#00897b', purple: '#8e44ad', pink: '#d81b60', gray: '#8a8a8e', lightgray: '#d9dce1',
  light: '#f2f4f7', paleblue: '#eaf2fe', palegreen: '#e8f5ee', paleyellow: '#fff7e0', palered: '#fdecea', paper: '#fffdf7',
  white: '#ffffff', black: '#000000', dark: '#1f2329', navy: '#14213d', none: 'transparent'
};
const WEIGHTS = { normal: 400, medium: 500, bold: 700 };
const ALIGNS = ['left', 'center', 'right', 'justify'];
const VALIGNS = ['top', 'middle', 'bottom'];
const LINE_HEIGHTS = { tight: 1.25, normal: 1.6, loose: 1.95 };
const PADDINGS = { none: 0, s: 1.5, m: 3, l: 5, xl: 8 };
const BORDERS = { none: null, thin: '0.25mm solid', medium: '0.5mm solid', thick: '0.9mm solid', dashed: '0.35mm dashed', dotted: '0.4mm dotted' };
const RADII = { none: 0, s: 1, m: 2.5, l: 5, pill: 50 };
const SPACING = { none: 0, s: 2, m: 4, l: 7, xl: 12 };
const ANCHORS = { 'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0], left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5], 'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1] };
const SHAPES = ['rect', 'line', 'circle', 'arrow', 'hline'];
const THEMES = {
  classic: { font: 'serif', heading: 'hei', text: 'text', accent: 'primary', background: 'white', muted: 'muted', soft: 'paleblue' },
  modern: { font: 'sans', heading: 'sans', text: 'text', accent: 'blue', background: 'white', muted: 'muted', soft: 'light' },
  warm: { font: 'serif', heading: 'kai', text: 'text', accent: 'orange', background: 'paper', muted: 'muted', soft: 'paleyellow' },
  fresh: { font: 'sans', heading: 'rounded', text: 'text', accent: 'accent', background: 'white', muted: 'muted', soft: 'palegreen' },
  dark: { font: 'sans', heading: 'sans', text: 'white', accent: 'yellow', background: 'dark', muted: 'lightgray', soft: 'navy' }
};
// text roles → default style (merged under the element's own style)
const ROLES = {
  title: { size: 'h1', weight: 'bold', heading: true, align: 'center', spacing: 'l' },
  subtitle: { size: 'l', color: 'muted', align: 'center', spacing: 'l' },
  heading: { size: 'xl', weight: 'bold', heading: true, color: 'accent', spacing: 'm' },
  subheading: { size: 'l', weight: 'bold', heading: true, spacing: 's' },
  body: { size: 'm', spacing: 'm', align: 'justify' },
  list: { size: 'm', spacing: 'm' },
  caption: { size: 's', color: 'muted', align: 'center', spacing: 's' },
  note: { size: 's', background: 'soft', padding: 'm', radius: 'm', spacing: 'm' },
  quote: { size: 'm', italic: true, color: 'muted', padding: 'm', borderLeft: true, spacing: 'm' },
  label: { size: 's', weight: 'bold', spacing: 's' }
};
const STYLE_KEYS = ['font', 'size', 'weight', 'italic', 'color', 'background', 'align', 'valign', 'lineHeight', 'padding', 'border', 'borderColor', 'radius', 'spacing', 'opacity', 'shadow', 'columns'];
const ENUMS = { font: Object.keys(FONTS), size: Object.keys(SIZES), weight: Object.keys(WEIGHTS), color: Object.keys(COLORS).concat(['accent', 'muted', 'soft', 'theme']), background: Object.keys(COLORS).concat(['accent', 'soft']), align: ALIGNS, valign: VALIGNS, lineHeight: Object.keys(LINE_HEIGHTS), padding: Object.keys(PADDINGS), border: Object.keys(BORDERS), borderColor: Object.keys(COLORS).concat(['accent']), radius: Object.keys(RADII), spacing: Object.keys(SPACING), shadow: ['none', 'soft'] };

const PT = 0.3528; // mm per pt
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let seq = 0;
const newId = (p) => p + Date.now().toString(36) + (++seq).toString(36);

// ---------------------------------------------------------------- styles
function cleanStyle(style, warnings) {
  const out = {};
  if (!style || typeof style !== 'object') return out;
  for (const [k, v] of Object.entries(style)) {
    if (v == null || v === '') continue;
    if (k === 'italic' || k === 'heading' || k === 'borderLeft') { out[k] = !!v; continue; }
    if (k === 'opacity') { out[k] = Math.max(0.05, Math.min(1, num(v, 1))); continue; }
    if (k === 'columns') { out[k] = Math.max(1, Math.min(4, Math.round(num(v, 1)))); continue; }
    if (!ENUMS[k]) { if (warnings) warnings.push(`未知样式属性 ${k}（可用：${STYLE_KEYS.join(', ')}）`); continue; }
    if (!ENUMS[k].includes(String(v))) { if (warnings) warnings.push(`样式 ${k}=${v} 无效，可选：${ENUMS[k].join(' / ')}`); continue; }
    out[k] = String(v);
  }
  return out;
}
function resolvedStyle(doc, el) {
  const th = THEMES[doc.theme] || THEMES.classic;
  const s = Object.assign({ font: th.font, size: 'm', weight: 'normal', color: 'theme', align: 'left', valign: 'top', lineHeight: 'normal', padding: 'none', border: 'none', radius: 'none', spacing: 'm' }, (el.role && ROLES[el.role]) || {}, el.style || {});
  if (s.heading && !(el.style && el.style.font)) s.font = th.heading;
  return s;
}
function color(doc, name, fallback) {
  const th = THEMES[doc.theme] || THEMES.classic;
  if (!name || name === 'theme') name = fallback || th.text;
  if (name === 'accent') name = th.accent; else if (name === 'muted') name = th.muted; else if (name === 'soft') name = th.soft;
  return COLORS[name] || COLORS.text;
}

// ---------------------------------------------------------------- documents
function pageDims(page) {
  const sz = PAGE_SIZES[page.size] || PAGE_SIZES.A4;
  const land = page.orientation === 'landscape' ? sz[0] < sz[1] : page.orientation === 'portrait' ? sz[0] > sz[1] : false;
  return land ? [sz[1], sz[0]] : [sz[0], sz[1]];
}
function marginOf(m, size) {
  const slide = /^slide/.test(size || '');
  const d = slide ? 14 : 20;
  if (m == null || m === '') return { t: d, r: d, b: d, l: d };
  if (typeof m === 'string') { const v = MARGINS[m] != null ? MARGINS[m] : num(m, d); return { t: v, r: v, b: v, l: v }; }
  if (typeof m === 'number') return { t: m, r: m, b: m, l: m };
  return { t: num(m.t != null ? m.t : m.top, d), r: num(m.r != null ? m.r : m.right, d), b: num(m.b != null ? m.b : m.bottom, d), l: num(m.l != null ? m.l : m.left, d) };
}
function createDoc(opts = {}) {
  const warnings = [];
  const size = PAGE_SIZES[opts.size] ? opts.size : 'A4';
  if (opts.size && !PAGE_SIZES[opts.size]) warnings.push(`纸张 ${opts.size} 无效，可选：${Object.keys(PAGE_SIZES).join(' / ')}`);
  const theme = THEMES[opts.theme] ? opts.theme : (/^slide/.test(size) ? 'modern' : 'classic');
  const doc = {
    id: opts.id || newId('d'), title: String(opts.title || '未命名文档').slice(0, 120), kind: opts.kind || 'document', theme,
    page: { size, orientation: opts.orientation === 'landscape' ? 'landscape' : opts.orientation === 'portrait' ? 'portrait' : 'auto', margin: marginOf(opts.margin, size), background: COLORS[opts.background] ? opts.background : null, header: opts.header || '', footer: opts.footer || '', pageNumbers: !!opts.pageNumbers },
    pages: 1, elements: [], cursor: null, created: Date.now(), updated: Date.now()
  };
  doc.cursor = { page: 1, y: doc.page.margin.t };
  return { doc, warnings };
}
function setPage(doc, opts = {}) {
  const warnings = [];
  if (opts.size != null) { if (PAGE_SIZES[opts.size]) doc.page.size = opts.size; else warnings.push(`纸张 ${opts.size} 无效，可选：${Object.keys(PAGE_SIZES).join(' / ')}`); }
  if (opts.orientation) doc.page.orientation = ['portrait', 'landscape'].includes(opts.orientation) ? opts.orientation : 'auto';
  if (opts.margin != null) doc.page.margin = marginOf(opts.margin, doc.page.size);
  if (opts.background !== undefined) { if (!opts.background || COLORS[opts.background]) doc.page.background = opts.background || null; else warnings.push(`背景色 ${opts.background} 无效`); }
  if (opts.theme) { if (THEMES[opts.theme]) doc.theme = opts.theme; else warnings.push(`主题 ${opts.theme} 无效，可选：${Object.keys(THEMES).join(' / ')}`); }
  for (const k of ['header', 'footer']) if (opts[k] !== undefined) doc.page[k] = String(opts[k] || '').slice(0, 200);
  if (opts.pageNumbers !== undefined) doc.page.pageNumbers = !!opts.pageNumbers;
  if (opts.title) doc.title = String(opts.title).slice(0, 120);
  doc.updated = Date.now();
  reflow(doc);
  return { warnings };
}
function contentBox(doc) {
  const [W, H] = pageDims(doc.page); const m = doc.page.margin;
  return { W, H, left: m.l, top: m.t, right: W - m.r, bottom: H - m.b, width: W - m.l - m.r, height: H - m.t - m.b };
}

// ---------------------------------------------------------------- measuring (estimates)
const isWide = (ch) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch);
function plainOf(text) {
  return String(text || '').replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => ' '.repeat(Math.min(40, Math.ceil(t.length * 0.6))))
    .replace(/\$([^$\n]+)\$/g, (m, t) => ' '.repeat(Math.ceil(t.length * 0.55))).replace(/\*\*|__|`/g, '').replace(/\\[a-zA-Z]+/g, 'x');
}
function textWidthMm(s, sizeMm) { let w = 0; for (const ch of s) w += isWide(ch) ? sizeMm : (/[A-Z0-9mwMW@%]/.test(ch) ? 0.62 : /[ il.,;:'|!]/.test(ch) ? 0.3 : 0.52) * sizeMm; return w; }
function linesFor(text, widthMm, sizeMm) {
  if (widthMm <= sizeMm) return Math.max(1, String(text || '').length);
  let lines = 0;
  for (const para of plainOf(text).split('\n')) { const w = textWidthMm(para.replace(/^\s*([-*•]|\d+[.)])\s+/, '    '), sizeMm); lines += Math.max(1, Math.ceil((w * 1.04) / widthMm)); }
  return lines;
}
function estimateHeight(doc, el) {
  const s = resolvedStyle(doc, el);
  const sizeMm = (SIZES[s.size] || 11) * PT * (el.scale || 1); const lh = LINE_HEIGHTS[s.lineHeight] || 1.6; const pad = PADDINGS[s.padding] || 0;
  const w = Math.max(5, (el.w || 50) - 2 * pad - (s.borderLeft ? 3 : 0));
  switch (el.type) {
    case 'text': { const cols = s.columns || 1; const colW = (w - (cols - 1) * 5) / cols; return r2(Math.ceil(linesFor(el.text, colW, sizeMm) / cols) * sizeMm * lh + 2 * pad + 0.5); }
    case 'math': { const tex = String(el.tex || ''); const rows = 1 + (tex.match(/\\\\/g) || []).length; const tall = /\\(frac|dfrac|sum|int|prod|lim|begin\{(p|b|v)?matrix|sqrt\{[^}]*\\frac)/.test(tex) ? 1.8 : 1.2; return r2(rows * sizeMm * tall * (el.display === false ? 1.3 : 1.7) + 2 * pad + 2); }
    case 'table': {
      const cols = Math.max(1, (el.columns || []).length || ((el.rows || [])[0] || []).length || 1);
      const fr = colFractions(el, cols); let h = 0;
      const rowsAll = (el.columns && el.columns.length ? [el.columns] : []).concat(el.rows || []);
      for (const row of rowsAll) { let m = 1; row.forEach((c, i) => { m = Math.max(m, linesFor(String(c == null ? '' : c), Math.max(4, w * fr[i] - 3), sizeMm)); }); h += m * sizeMm * 1.35 + 2.4; }
      return r2(h + 2 * pad + 0.6 + (el.caption ? sizeMm * 1.6 : 0));
    }
    case 'image': { const a = num(el.aspect, 4 / 3) || 4 / 3; return r2(w / a + 2 * pad + (el.caption ? sizeMm * 1.6 : 0)); }
    case 'svg': { const a = num(el.aspect, 4 / 3) || 4 / 3; return r2(w / a + 2 * pad); }
    case 'shape': return el.shape === 'line' || el.shape === 'hline' || el.shape === 'arrow' ? 1 : (el.shape === 'circle' ? (el.w || 20) : 20);
    case 'lines': return r2((Math.max(1, num(el.count, 3))) * num(el.gap, 8));
    default: return 10;
  }
}
function colFractions(el, cols) {
  let fr = Array.isArray(el.colWidths) && el.colWidths.length === cols ? el.colWidths.map(v => Math.max(0.01, num(v, 1))) : null;
  if (!fr) {
    const rowsAll = (el.columns && el.columns.length ? [el.columns] : []).concat(el.rows || []);
    fr = Array.from({ length: cols }, (_, i) => Math.max(2, Math.min(40, Math.max(...rowsAll.map(r => textWidthMm(plainOf(String((r || [])[i] == null ? '' : r[i])), 1))))));
  }
  const sum = fr.reduce((a, b) => a + b, 0) || 1; return fr.map(v => v / sum);
}
const heightOf = (doc, el) => el.h != null ? el.h : (el.hMeasured != null ? el.hMeasured : estimateHeight(doc, el));

// ---------------------------------------------------------------- adding elements
const TYPES = ['text', 'image', 'math', 'table', 'shape', 'svg', 'lines'];
function addElement(doc, spec = {}) {
  const warnings = [];
  const type = TYPES.includes(spec.type) ? spec.type : 'text';
  const cb = contentBox(doc);
  const el = { id: spec.id || newId('e'), type };
  if (type === 'text') { el.text = String(spec.text == null ? '' : spec.text); if (spec.role) { if (ROLES[spec.role]) el.role = spec.role; else warnings.push(`角色 ${spec.role} 无效，可选：${Object.keys(ROLES).join(' / ')}`); } }
  if (type === 'math') { el.tex = String(spec.tex || spec.text || ''); el.display = spec.display !== false; if (spec.label) el.label = String(spec.label); }
  if (type === 'table') { el.columns = Array.isArray(spec.columns) ? spec.columns.map(String) : []; el.rows = Array.isArray(spec.rows) ? spec.rows.map(r => (Array.isArray(r) ? r : [r]).map(c => c == null ? '' : String(c))) : []; if (spec.colWidths) el.colWidths = spec.colWidths; el.tableStyle = ['grid', 'lines', 'plain', 'zebra'].includes(spec.tableStyle) ? spec.tableStyle : 'grid'; }
  if (type === 'image') { el.src = String(spec.src || ''); el.fit = ['contain', 'cover', 'fill'].includes(spec.fit) ? spec.fit : 'contain'; if (spec.aspect) el.aspect = num(spec.aspect, 4 / 3); if (!el.src) warnings.push('图片缺少 src'); }
  if (type === 'svg') { el.svg = String(spec.svg || ''); el.aspect = num(spec.aspect, 4 / 3); }
  if (type === 'shape') { el.shape = SHAPES.includes(spec.shape) ? spec.shape : 'rect'; }
  if (type === 'lines') { el.count = Math.max(1, Math.min(40, Math.round(num(spec.count, 3)))); el.gap = Math.max(4, Math.min(20, num(spec.gap, 8))); }
  if ((type === 'table' || type === 'image') && spec.caption) el.caption = String(spec.caption);
  el.style = cleanStyle(spec.style, warnings);
  for (const k of STYLE_KEYS) if (spec[k] != null && el.style[k] == null) Object.assign(el.style, cleanStyle({ [k]: spec[k] }, warnings));
  if (spec.anchor) { if (ANCHORS[spec.anchor]) el.anchor = spec.anchor; else warnings.push(`锚点 ${spec.anchor} 无效，可选：${Object.keys(ANCHORS).join(' / ')}`); }
  if (spec.rotation) el.rotation = Math.max(-360, Math.min(360, num(spec.rotation, 0)));
  if (spec.z != null) el.z = Math.round(num(spec.z, 0));
  if (spec.scale) el.scale = Math.max(0.3, Math.min(4, num(spec.scale, 1)));
  if (spec.keepWithNext) el.keepWithNext = true;
  el.w = spec.w != null ? Math.max(1, num(spec.w, cb.width)) : (spec.x != null && type === 'shape' ? 20 : cb.width);
  if (spec.h != null) el.h = Math.max(0.2, num(spec.h, 10));
  const absolute = spec.y != null;
  el.flow = !absolute;
  if (absolute) {
    el.page = Math.max(1, Math.round(num(spec.page, doc.cursor.page)));
    el.x = num(spec.x, cb.left); el.y = num(spec.y, cb.top);
    doc.pages = Math.max(doc.pages, el.page);
  } else {
    el.x = spec.x != null ? num(spec.x, cb.left) : cb.left;
    if (spec.page != null) { const p = Math.max(1, Math.round(num(spec.page, 1))); if (p > doc.cursor.page) { doc.cursor = { page: p, y: cb.top }; doc.pages = Math.max(doc.pages, p); } }
    if (spec.w == null && el.x > cb.left) el.w = Math.max(10, cb.right - el.x);
  }
  if (el.flow && el.x + el.w > cb.right + 0.01) { warnings.push(`元素宽度超出版心，已缩至 ${r2(cb.right - el.x)} mm`); el.w = Math.max(5, cb.right - el.x); }
  doc.elements.push(el);
  if (el.flow) placeFlow(doc, el);
  doc.updated = Date.now();
  return { el, warnings };
}
function spacingOf(doc, el) { return SPACING[resolvedStyle(doc, el).spacing] != null ? SPACING[resolvedStyle(doc, el).spacing] : 4; }
// places one flow element at the cursor (below obstacles on that page)
function placeFlow(doc, el) {
  const cb = contentBox(doc);
  const h = heightOf(doc, el);
  let page = doc.cursor.page, y = doc.cursor.y;
  for (let guard = 0; guard < 400; guard++) {
    if (y + h > cb.bottom + 0.01 && y > cb.top + 0.01) { page++; y = cb.top; continue; }
    const hit = obstacles(doc, page, el).find(o => overlaps(o, { x: el.x, y, w: el.w, h }));
    if (hit) { y = r2(hit.y + hit.h + 2); continue; }
    break;
  }
  el.page = page; el.y = r2(y);
  doc.pages = Math.max(doc.pages, page);
  doc.cursor = { page, y: r2(y + h + spacingOf(doc, el)) };
}
function obstacles(doc, page, except) { return doc.elements.filter(e => e !== except && !e.flow && e.page === page && !e.background).map(e => box(doc, e)); }
// axis-aligned bounding box (rotation and anchor applied)
function box(doc, el) {
  const w = el.w || 0, h = heightOf(doc, el);
  const a = ANCHORS[el.anchor] || [0, 0];
  const left = el.x - a[0] * w, top = el.y - a[1] * h;
  const deg = num(el.rotation, 0) % 360;
  if (!deg) return { id: el.id, x: r2(left), y: r2(top), w: r2(w), h: r2(h) };
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const ox = el.x, oy = el.y;
  const pts = [[left, top], [left + w, top], [left, top + h], [left + w, top + h]].map(([px, py]) => [ox + (px - ox) * c - (py - oy) * s, oy + (px - ox) * s + (py - oy) * c]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { id: el.id, x: r2(Math.min(...xs)), y: r2(Math.min(...ys)), w: r2(Math.max(...xs) - Math.min(...xs)), h: r2(Math.max(...ys) - Math.min(...ys)) };
}
const overlaps = (a, b) => a.x < b.x + b.w - 0.3 && b.x < a.x + a.w - 0.3 && a.y < b.y + b.h - 0.3 && b.y < a.y + a.h - 0.3;

function pageBreak(doc) {
  const cb = contentBox(doc);
  const marker = { id: newId('b'), type: 'break', flow: true, page: doc.cursor.page, x: 0, y: doc.cursor.y, w: 0, h: 0 };
  doc.elements.push(marker);
  doc.cursor = { page: doc.cursor.page + 1, y: cb.top };
  doc.pages = Math.max(doc.pages, doc.cursor.page);
  return { page: doc.cursor.page };
}
// re-places every flow element in order (after edits, page changes or new measurements)
function reflow(doc) {
  const cb = contentBox(doc);
  doc.cursor = { page: 1, y: cb.top };
  let maxAbs = 1;
  for (const e of doc.elements) if (!e.flow) maxAbs = Math.max(maxAbs, e.page);
  for (const e of doc.elements) {
    if (!e.flow) continue;
    if (e.type === 'break') { e.page = doc.cursor.page; e.y = doc.cursor.y; doc.cursor = { page: doc.cursor.page + 1, y: cb.top }; continue; }
    if (e.x + (e.w || 0) > cb.right + 0.01) e.w = Math.max(5, cb.right - e.x);
    placeFlow(doc, e);
  }
  // keep-with-next: a heading at the bottom of a page moves with the following element
  doc.pages = Math.max(maxAbs, doc.cursor.page, ...doc.elements.filter(e => e.type === 'break').map(e => e.page + 1));
}
function updateElement(doc, id, changes = {}) {
  const el = doc.elements.find(e => e.id === id); if (!el) throw new Error('没有该元素：' + id);
  const warnings = [];
  const c = Object.assign({}, changes);
  if (c.style) { Object.assign(el.style, cleanStyle(c.style, warnings)); delete c.style; }
  for (const k of STYLE_KEYS) if (c[k] != null) { Object.assign(el.style, cleanStyle({ [k]: c[k] }, warnings)); delete c[k]; }
  for (const k of ['text', 'tex', 'src', 'caption', 'svg', 'label']) if (c[k] != null) el[k] = String(c[k]);
  if (c.columns) el.columns = c.columns.map(String); if (c.rows) el.rows = c.rows.map(r => (Array.isArray(r) ? r : [r]).map(String));
  if (c.role) { if (ROLES[c.role]) el.role = c.role; else warnings.push(`角色 ${c.role} 无效`); }
  if (c.anchor) { if (ANCHORS[c.anchor]) el.anchor = c.anchor; else warnings.push(`锚点 ${c.anchor} 无效`); }
  for (const k of ['x', 'w', 'h', 'rotation', 'z']) if (c[k] != null) el[k] = num(c[k], el[k]);
  if (c.h === null) delete el.h;
  if (c.y != null) { el.y = num(c.y, el.y); el.flow = false; el.page = Math.max(1, Math.round(num(c.page, el.page))); }
  else if (c.page != null) el.page = Math.max(1, Math.round(num(c.page, el.page)));
  if (c.flow === true) el.flow = true;
  delete el.hMeasured;
  doc.updated = Date.now();
  reflow(doc);
  return { el, warnings };
}
function removeElement(doc, id) { const i = doc.elements.findIndex(e => e.id === id); if (i < 0) throw new Error('没有该元素：' + id); doc.elements.splice(i, 1); reflow(doc); return { removed: id }; }

// ---------------------------------------------------------------- checking & fixing
function check(doc) {
  const cb = contentBox(doc); const overlapsList = [], outside = [];
  for (let p = 1; p <= doc.pages; p++) {
    const els = doc.elements.filter(e => e.page === p && e.type !== 'break' && !e.background);
    const boxes = els.map(e => box(doc, e));
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.x < -0.3 || b.y < -0.3 || b.x + b.w > cb.W + 0.3 || b.y + b.h > cb.H + 0.3) outside.push({ id: b.id, page: p, box: b, where: '超出纸张' });
      else if (els[i].flow && b.y + b.h > cb.bottom + 0.5) outside.push({ id: b.id, page: p, box: b, where: '超出版心底部' });
      for (let j = i + 1; j < boxes.length; j++) if (overlaps(b, boxes[j]) && !(els[i].allowOverlap || els[j].allowOverlap)) overlapsList.push({ page: p, a: b.id, b: boxes[j].id });
    }
  }
  return { overlaps: overlapsList, outside };
}
// moves later elements so nothing overlaps: flow elements re-flow below obstacles; absolute elements are nudged down
// (or onto the next page) in insertion order when mode = 'all'.
function fixOverlaps(doc, mode = 'all') {
  const before = check(doc); const moved = [];
  const cb = contentBox(doc);
  if (mode === 'all') {
    for (let p = 1; p <= doc.pages; p++) {
      const abs = doc.elements.filter(e => !e.flow && e.page === p && !e.background && !e.allowOverlap);
      const placed = [];
      for (const e of abs) {
        let b = box(doc, e); let guard = 0;
        while (guard++ < 200) {
          const hit = placed.find(o => overlaps(o, b)); if (!hit) break;
          const dy = r2(hit.y + hit.h + 2 - b.y); e.y = r2(e.y + dy); b = box(doc, e);
        }
        if (b.y + b.h > cb.H - 1 && b.h < cb.height) { const top = cb.top + (e.y - b.y); e.page = p + 1; e.y = r2(top); doc.pages = Math.max(doc.pages, p + 1); b = null; }
        if (guard > 1 || !b) moved.push({ id: e.id, page: e.page, y: e.y });
        if (b) placed.push(b);
      }
    }
  }
  // clamp absolute elements that leave the paper
  for (const e of doc.elements) {
    if (e.flow || e.type === 'break') continue;
    const b = box(doc, e);
    let dx = 0, dy = 0;
    if (b.x < 0) dx = -b.x + cb.left / 2; else if (b.x + b.w > cb.W) dx = cb.W - (b.x + b.w) - cb.left / 2;
    if (b.y < 0) dy = -b.y + cb.top / 2;
    if (dx || dy) { e.x = r2(e.x + dx); e.y = r2(e.y + dy); moved.push({ id: e.id, page: e.page, x: e.x, y: e.y }); }
  }
  const prev = new Map(doc.elements.filter(e => e.flow).map(e => [e.id, e.page + ':' + e.y]));
  reflow(doc);
  for (const e of doc.elements) if (e.flow && e.type !== 'break' && prev.get(e.id) !== e.page + ':' + e.y) moved.push({ id: e.id, page: e.page, y: e.y });
  const after = check(doc);
  return { before: before.overlaps.length, after: after.overlaps.length, moved, remaining: after };
}
function applyMeasurements(doc, heights) {
  let changed = 0;
  for (const [id, h] of Object.entries(heights || {})) {
    const el = doc.elements.find(e => e.id === id); if (!el || el.h != null) continue;
    const v = r2(num(h, 0)); if (v > 0 && Math.abs((el.hMeasured || estimateHeight(doc, el)) - v) > 0.4) { el.hMeasured = v; changed++; }
  }
  if (changed) reflow(doc);
  return changed;
}
function summary(doc) {
  return {
    id: doc.id, title: doc.title, kind: doc.kind, theme: doc.theme, pages: doc.pages,
    page: Object.assign({}, doc.page, { mm: pageDims(doc.page) }), content: contentBox(doc),
    elements: doc.elements.filter(e => e.type !== 'break').map(e => {
      const b = box(doc, e);
      const o = { id: e.id, type: e.type, page: e.page, x: r2(e.x), y: r2(e.y), w: r2(e.w), h: r2(heightOf(doc, e)), flow: !!e.flow };
      if (e.anchor) o.anchor = e.anchor; if (e.rotation) o.rotation = e.rotation; if (e.role) o.role = e.role;
      if (e.rotation || e.anchor) o.bbox = b;
      const txt = e.text || e.tex || (e.columns || []).join(' | ') || e.caption || e.shape || '';
      if (txt) o.preview = String(txt).slice(0, 60);
      return o;
    })
  };
}

// ---------------------------------------------------------------- HTML rendering
let katexMod = null;
function katex() {
  if (katexMod !== null) return katexMod;
  try {
    const path = require('path'), fs = require('fs');
    const dir = path.join(__dirname, '..', '..', 'renderer', 'static', 'vendor', 'katex');
    katexMod = require(path.join(dir, 'katex.min.js'));
    try { const src = fs.readFileSync(path.join(dir, 'contrib', 'mhchem.min.js'), 'utf8'); const m = { exports: {} }; new Function('module', 'exports', 'require', src)(m, m.exports, (n) => n === 'katex' ? katexMod : require(n)); } catch {}
  } catch { katexMod = false; }
  return katexMod;
}
function tex(t, display) {
  const k = katex();
  if (k) { try { return k.renderToString(String(t), { displayMode: !!display, throwOnError: false, strict: 'ignore', trust: false, output: 'html' }); } catch {} }
  return `<span class="tex-raw">${esc(t)}</span>`;
}
// inline rich text: **bold**, *italic*, `code`, $math$, $$display$$, line breaks, "- " / "1. " lists
function rich(text) {
  const src = String(text == null ? '' : text);
  const math = [];
  let s = src.replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => { math.push(tex(t.trim(), true)); return '\u0001' + (math.length - 1) + '\u0002'; })
    .replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => { math.push(tex(t.trim(), false)); return '\u0001' + (math.length - 1) + '\u0002'; })
    .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]{1,400}?)\$(?![\w$])/g, (m, pre, t) => { math.push(tex(t, false)); return pre + '\u0001' + (math.length - 1) + '\u0002'; });
  const blanks = []; s = s.replace(/_{3,}/g, (m) => { blanks.push(m.length); return '\u0005' + (blanks.length - 1) + '\u0006'; });
  s = esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/__([^_]+)__/g, '<u>$1</u>');
  const lines = s.split('\n'); const out = []; let list = null;
  const flush = () => { if (list) { out.push(`<${list.t}${list.start > 1 ? ` start="${list.start}"` : ''}>${list.items.map(i => '<li>' + i + '</li>').join('')}</${list.t}>`); list = null; } };
  let para = [];
  const flushP = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } };
  for (const ln of lines) {
    let m;
    if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (!list || list.t !== 'ul') { flush(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
    else if ((m = ln.match(/^\s*(\d+)[.)、]\s+(.*)/))) { flushP(); if (!list || list.t !== 'ol') { flush(); list = { t: 'ol', items: [], start: Number(m[1]) }; } list.items.push(m[2]); }
    else if (!ln.trim()) { flush(); flushP(); }
    else { flush(); para.push(ln); }
  }
  flush(); flushP();
  return out.join('').replace(/\u0001(\d+)\u0002/g, (m, n) => math[Number(n)] || '').replace(/\u0005(\d+)\u0006/g, (m, n) => `<span class="blank" style="width:${Math.min(30, blanks[Number(n)] * 0.55).toFixed(1)}em"></span>`);
}
const hasMath = (doc) => doc.elements.some(e => e.type === 'math' || /\$|\\\(/.test(String(e.text || '') + (e.rows || []).join('') + (e.columns || []).join('')));
// Bundled CJK document fonts (iPad payload fonts/, or AIB_DOC_FONTS): iPadOS has PingFang but no Songti / Kaiti preinstalled,
// so serif and kai documents use Noto Serif SC and LXGW WenKai from the app. Not inlined into exported HTML (size).
const DOC_FONT_FILES = [['AIB Serif SC', 400, 'NotoSerifSC-Regular.otf', 'opentype'], ['AIB Serif SC', 700, 'NotoSerifSC-Bold.otf', 'opentype'], ['AIB Kai SC', 400, 'LXGWWenKai-Regular.ttf', 'truetype']];
function docFontsDir() {
  const path = require('path');
  if (process.env.AIB_DOC_FONTS) return process.env.AIB_DOC_FONTS;
  const ip = global.__aibIpad; return ip && ip.resources ? path.join(ip.resources, 'fonts') : '';
}
function docFontsCss(inlineFonts, assetUrl) {
  if (inlineFonts) return '';
  try {
    const path = require('path'), fs = require('fs'); const dir = docFontsDir(); if (!dir) return '';
    return DOC_FONT_FILES.filter(f => fs.existsSync(path.join(dir, f[2]))).map(([fam, w, file, fmt]) => `@font-face{font-family:'${fam}';font-weight:${w};src:url("${assetHref(path.join(dir, file), assetUrl)}") format("${fmt}")}`).join('\n');
  } catch { return ''; }
}
// URL of a font file for a rendered page: file URL, or assetUrl(absPath) (the iPad copies assets next to the page,
// because a WKWebView loading a file may only read the page's own directory)
function assetHref(abs, assetUrl) { if (assetUrl) { try { const u = assetUrl(abs); if (u) return u; } catch {} } return require('url').pathToFileURL(abs).href; }
function katexCss(inlineFonts, assetUrl) {
  try {
    const path = require('path'), fs = require('fs');
    const dir = path.join(__dirname, '..', '..', 'renderer', 'static', 'vendor', 'katex');
    let css = fs.readFileSync(path.join(dir, 'katex.min.css'), 'utf8');
    css = css.replace(/url\((?:'|")?fonts\/([^)'"]+)(?:'|")?\)\s*format\((?:'|")?([a-z0-9]+)(?:'|")?\)/g, (m, f, fmt) => {
      if (!/\.woff2$/.test(f)) return 'url(data:,)';
      if (inlineFonts) { try { return `url(data:font/woff2;base64,${fs.readFileSync(path.join(dir, 'fonts', f)).toString('base64')}) format("woff2")`; } catch { return 'url(data:,)'; } }
      return `url("${assetHref(path.join(dir, 'fonts', f), assetUrl)}") format("woff2")`;
    });
    return css;
  } catch { return ''; }
}
function styleCss(doc, el, s) {
  const css = [];
  const sizePt = (SIZES[s.size] || 11) * (el.scale || 1);
  css.push(`font-family:${FONTS[s.font] || FONTS.sans}`, `font-size:${r2(sizePt)}pt`, `font-weight:${WEIGHTS[s.weight] || 400}`, `line-height:${LINE_HEIGHTS[s.lineHeight] || 1.6}`, `color:${color(doc, s.color)}`, `text-align:${s.align}`);
  if (s.italic) css.push('font-style:italic');
  if (s.background && s.background !== 'none') css.push(`background:${color(doc, s.background)}`);
  if (PADDINGS[s.padding]) css.push(`padding:${PADDINGS[s.padding]}mm`);
  if (BORDERS[s.border] && el.type !== 'shape') css.push(`border:${BORDERS[s.border]} ${color(doc, s.borderColor || 'lightgray')}`);
  if (s.borderLeft) css.push(`border-left:1mm solid ${color(doc, 'accent')}`);
  if (RADII[s.radius]) css.push(`border-radius:${s.radius === 'pill' ? '999px' : RADII[s.radius] + 'mm'}`);
  if (s.opacity != null && s.opacity < 1) css.push(`opacity:${s.opacity}`);
  if (s.shadow === 'soft') css.push('box-shadow:0 0.6mm 2.4mm rgba(0,0,0,.14)');
  if (s.columns > 1) css.push(`column-count:${s.columns}`, 'column-gap:5mm');
  if (s.valign && s.valign !== 'top') css.push('display:flex', 'flex-direction:column', `justify-content:${s.valign === 'middle' ? 'center' : 'flex-end'}`);
  return css;
}
function safeSrc(src) {
  src = String(src || '');
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(src)) return src;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(src)) return src;
  if (/^file:\/\/[^\s"'<>]+$/i.test(src)) return src;
  return '';
}
function elementHtml(doc, el) {
  if (el.type === 'break') return '';
  const s = resolvedStyle(doc, el);
  const a = ANCHORS[el.anchor] || [0, 0];
  const h = heightOf(doc, el);
  const fixedH = el.h != null || ['image', 'svg', 'shape', 'lines'].includes(el.type);
  const css = [`left:${r2(el.x - a[0] * el.w)}mm`, `top:${r2(el.y - a[1] * h)}mm`, `width:${r2(el.w)}mm`];
  if (fixedH) css.push(`height:${r2(h)}mm`);
  if (el.rotation) css.push(`transform:rotate(${el.rotation}deg)`, `transform-origin:${a[0] * 100}% ${a[1] * 100}%`);
  if (el.z != null) css.push(`z-index:${el.z}`);
  let inner = '';
  const st = styleCss(doc, el, s);
  switch (el.type) {
    case 'text': inner = rich(el.text); break;
    case 'math': inner = `<div class="mathbox${el.display === false ? ' inline' : ''}">${tex(el.tex, el.display !== false)}</div>` + (el.label ? `<span class="eqlabel">(${esc(el.label)})</span>` : ''); if (!el.style.align) st.push('text-align:center'); break;
    case 'table': {
      const cols = Math.max(1, el.columns.length || (el.rows[0] || []).length);
      const fr = colFractions(el, cols);
      const ts = el.tableStyle || 'grid';
      inner = `<table class="t-${ts}"><colgroup>${fr.map(f => `<col style="width:${r2(f * 100)}%">`).join('')}</colgroup>`
        + (el.columns.length ? `<thead><tr>${el.columns.map(c => `<th style="background:${color(doc, 'soft')};color:${color(doc, 'theme')}">${rich(c)}</th>`).join('')}</tr></thead>` : '')
        + `<tbody>${el.rows.map(r => `<tr>${Array.from({ length: cols }, (_, i) => `<td>${rich(r[i] == null ? '' : r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        + (el.caption ? `<div class="cap">${rich(el.caption)}</div>` : '');
      break;
    }
    case 'image': { const src = safeSrc(el.src); inner = (src ? `<img src="${esc(src)}" style="object-fit:${el.fit}" alt="">` : '<div class="imgmissing">图片无法载入</div>') + (el.caption ? `<div class="cap">${rich(el.caption)}</div>` : ''); st.push('display:flex', 'flex-direction:column'); break; }
    case 'svg': inner = el.svg; break;
    case 'shape': {
      const c = color(doc, s.borderColor || (s.color === 'theme' ? 'accent' : s.color));
      const bw = s.border && BORDERS[s.border] ? BORDERS[s.border].split(' ')[0] : '0.4mm';
      const bs = s.border && BORDERS[s.border] ? BORDERS[s.border].split(' ')[1] : 'solid';
      const noBorder = s.border === 'none' && el.style && el.style.border === 'none';
      if (el.shape === 'rect') { if (!noBorder) st.push(`border:${bw} ${bs} ${c}`); }
      else if (el.shape === 'circle') st.push(noBorder ? '' : `border:${bw} ${bs} ${c}`, 'border-radius:50%');
      else if (el.shape === 'line' || el.shape === 'hline') { inner = `<div style="position:absolute;left:0;right:0;top:50%;border-top:${bw} ${s.border === 'dashed' ? 'dashed' : 'solid'} ${c}"></div>`; }
      else if (el.shape === 'arrow') inner = `<svg viewBox="0 0 100 10" preserveAspectRatio="none" style="width:100%;height:100%;overflow:visible"><line x1="0" y1="5" x2="96" y2="5" stroke="${c}" stroke-width="1.2" vector-effect="non-scaling-stroke"/><path d="M90,1 L100,5 L90,9" fill="${c}"/></svg>`;
      break;
    }
    case 'lines': inner = Array.from({ length: el.count }, (_, i) => `<div style="position:absolute;left:0;right:0;top:${r2((i + 1) * el.gap - 0.5)}mm;border-bottom:0.25mm solid ${color(doc, 'lightgray')}"></div>`).join(''); break;
  }
  return `<div class="el el-${el.type}" data-id="${esc(el.id)}" style="${css.concat(st).join(';').replace(/"/g, "'")}">${inner}</div>`;
}
function renderHtml(doc, opts = {}) {
  const [W, H] = pageDims(doc.page);
  const th = THEMES[doc.theme] || THEMES.classic;
  const bg = color(doc, doc.page.background || th.background);
  const pages = [];
  for (let p = 1; p <= doc.pages; p++) {
    if (opts.page && opts.page !== p) continue;
    const els = doc.elements.filter(e => e.page === p).sort((a, b) => (a.z || 0) - (b.z || 0)).map(e => elementHtml(doc, e)).join('');
    const m = doc.page.margin;
    const hf = (doc.page.header ? `<div class="hf hd" style="top:${r2(m.t / 2 - 2)}mm;left:${m.l}mm;right:${m.r}mm">${esc(doc.page.header)}</div>` : '')
      + ((doc.page.footer || doc.page.pageNumbers) ? `<div class="hf ft" style="bottom:${r2(m.b / 2 - 3)}mm;left:${m.l}mm;right:${m.r}mm"><span>${esc(doc.page.footer)}</span><span>${doc.page.pageNumbers ? `${p} / ${doc.pages}` : ''}</span></div>` : '');
    pages.push(`<section class="page" data-page="${p}" style="width:${W}mm;height:${H}mm;background:${bg}">${els}${hf}</section>`);
  }
  const math = hasMath(doc);
  const css = `@page{size:${W}mm ${H}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:${opts.bare ? 'transparent' : '#e9ebef'};-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;overflow:hidden;margin:${opts.bare ? 0 : '6mm auto'};box-shadow:${opts.bare ? 'none' : '0 1mm 4mm rgba(0,0,0,.18)'};page-break-after:always;break-after:page;color:${color(doc, 'theme')}}
.page:last-child{page-break-after:auto;break-after:auto}
.el{position:absolute;overflow:visible;word-break:break-word;overflow-wrap:anywhere}.el p{margin:0 0 .35em}.el p:last-child{margin-bottom:0}.el ul,.el ol{margin:0;padding-left:1.4em}.el li{margin:.1em 0}
.el code{font-family:${FONTS.mono};font-size:.92em;background:rgba(127,127,127,.12);padding:0 .25em;border-radius:.6mm}
.el table{width:100%;border-collapse:collapse;table-layout:fixed}.el th,.el td{padding:1.1mm 1.4mm;vertical-align:top;text-align:left}.el th{font-weight:700}
.t-grid th,.t-grid td{border:0.25mm solid ${color(doc, 'lightgray')}}.t-lines thead th{border-bottom:0.5mm solid ${color(doc, 'theme')}}.t-lines td{border-bottom:0.2mm solid ${color(doc, 'lightgray')}}.t-lines{border-top:0.5mm solid ${color(doc, 'theme')};border-bottom:0.5mm solid ${color(doc, 'theme')}}
.t-zebra tbody tr:nth-child(even) td{background:rgba(127,127,127,.08)}.t-plain th,.t-plain td{border:0}
.blank{display:inline-block;border-bottom:0.25mm solid currentColor;height:1em;vertical-align:-0.15em;margin:0 .15em}
.cap{font-size:.85em;color:${color(doc, 'muted')};text-align:center;margin-top:1mm}.el img{width:100%;flex:1;min-height:0;display:block}.imgmissing{flex:1;display:flex;align-items:center;justify-content:center;border:0.3mm dashed #aaa;color:#888}
.el-math .katex-display{margin:0}.mathbox.inline{display:inline-block}.eqlabel{position:absolute;right:0;top:50%;transform:translateY(-50%)}.el svg{display:block}
.hf{position:absolute;font:8.5pt ${FONTS[th.font]};color:${color(doc, 'muted')};display:flex;justify-content:space-between}.hd{justify-content:center}
@media print{body{background:none}.page{margin:0;box-shadow:none}}
${docFontsCss(!!opts.inlineFonts, opts.assetUrl)}
${math ? katexCss(!!opts.inlineFonts, opts.assetUrl) : ''}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(doc.title)}</title><style>${css}</style></head><body>${pages.join('\n')}</body></html>`;
}
// JavaScript run inside a rendered page: returns { id: heightMm } of every element (natural content height)
const MEASURE_JS = `(() => { const pxPerMm = 96 / 25.4; const out = {}; document.querySelectorAll('.el[data-id]').forEach(n => { if (n.style.height) return; out[n.dataset.id] = Math.round(n.scrollHeight / pxPerMm * 100) / 100; }); return out; })()`;

module.exports = { docFontsCss, DOC_FONT_FILES,
  PAGE_SIZES, MARGINS, FONTS, SIZES, COLORS, WEIGHTS, ALIGNS, VALIGNS, LINE_HEIGHTS, PADDINGS, BORDERS, RADII, SPACING, ANCHORS, SHAPES, THEMES, ROLES, ENUMS, STYLE_KEYS, TYPES,
  createDoc, setPage, addElement, updateElement, removeElement, pageBreak, reflow, check, fixOverlaps, applyMeasurements, summary, renderHtml, contentBox, pageDims, box, heightOf, estimateHeight, rich, tex, esc, MEASURE_JS, newId
};
