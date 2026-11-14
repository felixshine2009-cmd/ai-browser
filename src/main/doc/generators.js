'use strict';
// v3.0.0 generator agents on top of the layout engine: 排版助手 (Markdown → laid-out document), 幻灯片助手, 表格与图表助手,
// 错题本 / 试卷助手, 单词卡助手, 思维导图助手. Each builds a document deterministically from structured input
// (the model supplies the content; the layout rules here place it), so the output is consistent and overlap-free.
const svc = require('./index');
const E = svc.E;
const esc = E.esc;
const str = (v) => (v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const PALETTE = ['#1a73e8', '#e8710a', '#188038', '#d93025', '#8e44ad', '#00897b', '#f9ab00', '#d81b60'];

// ---------------------------------------------------------------- Markdown → blocks
function mdBlocks(md) {
  const lines = str(md).replace(/\r/g, '').split('\n');
  const out = []; let para = [], list = [], i = 0;
  const flushP = () => { if (para.length) { out.push({ t: 'p', text: para.join('\n') }); para = []; } };
  const flushL = () => { if (list.length) { out.push({ t: 'list', text: list.join('\n') }); list = []; } };
  while (i < lines.length) {
    const ln = lines[i]; let m;
    if ((m = ln.match(/^\s*```\s*(\w*)/))) {
      flushP(); flushL(); const lang = m[1]; const body = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; out.push({ t: 'code', lang, text: body.join('\n') }); continue;
    }
    if (/^\s*\$\$/.test(ln)) {
      flushP(); flushL(); let buf = ln.replace(/^\s*\$\$/, '');
      if (/\$\$\s*$/.test(buf)) { out.push({ t: 'math', tex: buf.replace(/\$\$\s*$/, '').trim() }); i++; continue; }
      i++; while (i < lines.length && !/\$\$\s*$/.test(lines[i])) buf += '\n' + lines[i++];
      if (i < lines.length) buf += '\n' + lines[i].replace(/\$\$\s*$/, ''); i++;
      out.push({ t: 'math', tex: buf.trim() }); continue;
    }
    if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushP(); flushL();
      const cells = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const columns = cells(ln); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push({ t: 'table', columns, rows }); continue;
    }
    if ((m = ln.match(/^\s*!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/))) { flushP(); flushL(); out.push({ t: 'image', alt: m[1], src: m[2], caption: m[3] || m[1] }); i++; continue; }
    if ((m = ln.match(/^(#{1,4})\s+(.*)/))) { flushP(); flushL(); out.push({ t: 'h' + m[1].length, text: m[2].trim() }); i++; continue; }
    if (/^\s*(---|\*\*\*|===)\s*$/.test(ln)) { flushP(); flushL(); out.push({ t: 'hr' }); i++; continue; }
    if (/^\s*(\\newpage|<!--\s*pagebreak\s*-->|\[分页\])\s*$/i.test(ln)) { flushP(); flushL(); out.push({ t: 'break' }); i++; continue; }
    if ((m = ln.match(/^\s*>\s?(.*)/))) { flushP(); flushL(); const q = [m[1]]; i++; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push({ t: 'quote', text: q.join('\n') }); continue; }
    if (/^\s*([-*•]|\d+[.)、])\s+/.test(ln)) { flushP(); list.push(ln.trim()); i++; continue; }
    if (!ln.trim()) { flushP(); flushL(); i++; continue; }
    flushL(); para.push(ln); i++;
  }
  flushP(); flushL();
  return out;
}

// ---------------------------------------------------------------- 排版助手
const TEMPLATES = {
  article: { size: 'A4', theme: 'classic', pageNumbers: true },
  handout: { size: 'A4', theme: 'fresh', pageNumbers: true, margin: 'narrow' },
  notes: { size: 'A5', theme: 'warm', pageNumbers: true, margin: 'narrow' },
  report: { size: 'A4', theme: 'modern', pageNumbers: true },
  poster: { size: 'A3', theme: 'modern' },
  letter: { size: 'A4', theme: 'classic' },
  slides: { size: 'slide16x9', theme: 'modern' }
};
function layoutMarkdown(a = {}) {
  const tpl = TEMPLATES[a.template] || TEMPLATES.article;
  if (a.template === 'slides') return slides(Object.assign({ title: a.title }, slidesFromMarkdown(a.content || a.markdown || '', a.title)));
  const { doc, warnings } = svc.create({ title: a.title || firstHeading(a.content) || '文档', kind: 'layout:' + (a.template || 'article'), size: a.size || tpl.size, orientation: a.orientation, theme: a.theme || tpl.theme, margin: a.margin || tpl.margin, pageNumbers: a.pageNumbers != null ? a.pageNumbers : tpl.pageNumbers, header: a.header, footer: a.footer });
  const blocks = mdBlocks(a.content || a.markdown || '');
  let titled = false;
  if (a.title && !(blocks[0] && blocks[0].t === 'h1')) { E.addElement(doc, { type: 'text', role: 'title', text: a.title }); titled = true; }
  if (a.subtitle) E.addElement(doc, { type: 'text', role: 'subtitle', text: a.subtitle });
  const cb = E.contentBox(doc);
  for (const b of blocks) {
    if (b.t === 'h1') { E.addElement(doc, { type: 'text', role: titled ? 'heading' : 'title', text: b.text }); titled = true; }
    else if (b.t === 'h2') E.addElement(doc, { type: 'text', role: 'heading', text: b.text, keepWithNext: true });
    else if (b.t === 'h3' || b.t === 'h4') E.addElement(doc, { type: 'text', role: 'subheading', text: b.text, keepWithNext: true });
    else if (b.t === 'p') E.addElement(doc, { type: 'text', role: 'body', text: b.text, style: a.columns > 1 ? { columns: a.columns } : undefined });
    else if (b.t === 'list') E.addElement(doc, { type: 'text', role: 'list', text: b.text });
    else if (b.t === 'quote') E.addElement(doc, { type: 'text', role: 'quote', text: b.text });
    else if (b.t === 'math') E.addElement(doc, { type: 'math', tex: b.tex });
    else if (b.t === 'table') E.addElement(doc, { type: 'table', columns: b.columns, rows: b.rows, tableStyle: 'lines' });
    else if (b.t === 'image') E.addElement(doc, { type: 'image', src: b.src, caption: b.caption, w: Math.min(cb.width, 120), x: cb.left + (cb.width - Math.min(cb.width, 120)) / 2 });
    else if (b.t === 'hr') E.addElement(doc, { type: 'shape', shape: 'hline', h: 2, style: { spacing: 'm', color: 'lightgray' } });
    else if (b.t === 'break') E.pageBreak(doc);
    else if (b.t === 'code') {
      if (b.lang === 'chem') E.addElement(doc, { type: 'math', tex: b.text.split('\n').filter(Boolean).map(l => '\\ce{' + l.trim() + '}').join('\\\\') });
      else E.addElement(doc, { type: 'text', text: b.text.split('\n').map(l => '`' + l.replace(/`/g, "'") + '`').join('\n'), style: { font: 'mono', size: 's', background: 'light', padding: 'm', radius: 's', lineHeight: 'tight' } });
    }
  }
  svc.save(doc);
  return { doc, warnings, blocks: blocks.length };
}
const firstHeading = (md) => { const m = str(md).match(/^#{1,2}\s+(.+)$/m); return m ? m[1].trim() : ''; };
function slidesFromMarkdown(md, title) {
  const blocks = mdBlocks(md); const slidesOut = []; let cur = null;
  for (const b of blocks) {
    if (b.t === 'h1' && !slidesOut.length && !cur) { title = title || b.text; continue; }
    if (b.t === 'h1' || b.t === 'h2' || b.t === 'break' || b.t === 'hr') { if (cur) slidesOut.push(cur); cur = { title: b.text || '', bullets: [] }; continue; }
    if (!cur) cur = { title: '', bullets: [] };
    if (b.t === 'list') cur.bullets.push(...b.text.split('\n').map(l => l.replace(/^\s*([-*•]|\d+[.)、])\s+/, '')));
    else if (b.t === 'p' || b.t === 'h3' || b.t === 'quote') cur.bullets.push(b.text);
    else if (b.t === 'math') cur.math = b.tex;
    else if (b.t === 'image') cur.image = b.src;
    else if (b.t === 'table') cur.table = { columns: b.columns, rows: b.rows };
  }
  if (cur) slidesOut.push(cur);
  return { title, slides: slidesOut };
}

// ---------------------------------------------------------------- 幻灯片助手
function slides(a = {}) {
  const { doc, warnings } = svc.create({ title: a.title || '演示文稿', kind: 'slides', size: a.aspect === '4:3' ? 'slide4x3' : 'slide16x9', theme: a.theme || 'modern', margin: 14 });
  const cb = E.contentBox(doc);
  let page = 0;
  const next = () => { page++; doc.pages = Math.max(doc.pages, page); return page; };
  const pageNo = (p) => E.addElement(doc, { type: 'text', text: String(p), x: cb.right, y: cb.H - 6, w: 20, anchor: 'bottom-right', style: { size: 'xs', color: 'muted', align: 'right' }, page: p });
  // cover
  const p0 = next();
  E.addElement(doc, { type: 'shape', shape: 'rect', x: 0, y: 0, w: cb.W, h: cb.H, page: p0, style: { background: 'soft', border: 'none' }, z: -1 }).el.background = true;
  E.addElement(doc, { type: 'shape', shape: 'hline', x: cb.left, y: cb.H * 0.58, w: 40, h: 2, page: p0, style: { border: 'thick' } });
  E.addElement(doc, { type: 'text', text: a.title || '演示文稿', x: cb.left, y: cb.H * 0.56, w: cb.width, anchor: 'bottom-left', page: p0, style: { size: 'display', weight: 'bold', lineHeight: 'tight' } });
  if (a.subtitle || a.author) E.addElement(doc, { type: 'text', text: [a.subtitle, a.author].filter(Boolean).join('\n'), x: cb.left, y: cb.H * 0.62, w: cb.width, page: p0, style: { size: 'l', color: 'muted' } });
  for (const s of arr(a.slides)) {
    const p = next();
    const layout = s.layout || (s.image ? 'image-right' : s.quote ? 'quote' : s.section ? 'section' : 'bullets');
    if (layout === 'section') {
      E.addElement(doc, { type: 'text', text: s.title || '', x: cb.W / 2, y: cb.H / 2, w: cb.width, anchor: 'center', page: p, style: { size: 'h1', weight: 'bold', align: 'center', color: 'accent' } });
      if (s.subtitle) E.addElement(doc, { type: 'text', text: s.subtitle, x: cb.W / 2, y: cb.H / 2 + 16, w: cb.width, anchor: 'top', page: p, style: { size: 'l', color: 'muted', align: 'center' } });
      pageNo(p); continue;
    }
    if (layout === 'quote') {
      E.addElement(doc, { type: 'text', text: '“' + str(s.quote) + '”', x: cb.W / 2, y: cb.H / 2 - 6, w: cb.width * 0.8, anchor: 'center', page: p, style: { size: 'xxl', italic: true, align: 'center', font: 'serif' } });
      if (s.by || s.title) E.addElement(doc, { type: 'text', text: '—— ' + (s.by || s.title), x: cb.W / 2, y: cb.H / 2 + 22, w: cb.width * 0.8, anchor: 'top', page: p, style: { size: 'm', color: 'muted', align: 'right' } });
      pageNo(p); continue;
    }
    const top = cb.top;
    E.addElement(doc, { type: 'text', text: s.title || '', x: cb.left, y: top, w: cb.width, page: p, style: { size: 'xxl', weight: 'bold', color: 'accent', lineHeight: 'tight' } });
    E.addElement(doc, { type: 'shape', shape: 'hline', x: cb.left, y: top + 13, w: 24, h: 1.5, page: p, style: { border: 'medium' } });
    const bodyTop = top + 19, bodyH = cb.bottom - bodyTop - 4;
    const twoCol = layout === 'image-right' || layout === 'image-left' || layout === 'two-column';
    const colW = twoCol ? (cb.width - 8) / 2 : cb.width;
    const textX = layout === 'image-left' ? cb.left + colW + 8 : cb.left;
    const otherX = layout === 'image-left' ? cb.left : cb.left + colW + 8;
    let y = bodyTop;
    const bullets = arr(s.bullets).map(str).filter(Boolean);
    if (bullets.length || s.text) {
      const n = bullets.length; const size = n > 7 ? 'm' : n > 4 ? 'l' : 'xl';
      const r = E.addElement(doc, { type: 'text', text: (s.text ? s.text + (n ? '\n' : '') : '') + bullets.map(b => '- ' + b).join('\n'), x: textX, y, w: colW, page: p, style: { size, lineHeight: 'loose' } });
      y += E.heightOf(doc, r.el) + 4;
    }
    if (s.math) { const r = E.addElement(doc, { type: 'math', tex: s.math, x: twoCol ? otherX : cb.left, y: twoCol ? bodyTop : y, w: colW, page: p, style: { size: 'xl' } }); if (!twoCol) y += E.heightOf(doc, r.el) + 4; }
    if (s.table) { const t = s.table; E.addElement(doc, { type: 'table', columns: arr(t.columns), rows: arr(t.rows), x: twoCol ? otherX : cb.left, y: twoCol ? bodyTop : y, w: colW, page: p, tableStyle: 'zebra', style: { size: 's' } }); }
    if (s.image) E.addElement(doc, { type: 'image', src: s.image, x: otherX, y: bodyTop, w: colW, h: bodyH, page: p, fit: 'contain', caption: s.caption });
    if (s.chart) E.addElement(doc, { type: 'svg', svg: chartSvg(s.chart), aspect: 1.5, x: twoCol ? otherX : cb.left, y: twoCol ? bodyTop : y, w: twoCol ? colW : Math.min(cb.width, bodyH * 1.5), page: p });
    if (s.notes) doc.elements[doc.elements.length - 1].notes = str(s.notes);
    pageNo(p);
  }
  const fix = E.fixOverlaps(doc, 'all');
  svc.save(doc);
  return { doc, warnings, slides: page, fixed: fix.after };
}

// ---------------------------------------------------------------- 表格与图表助手
function chartSvg(c = {}) {
  const type = ['bar', 'line', 'pie', 'scatter', 'hbar'].includes(c.type) ? c.type : 'bar';
  const labels = arr(c.labels).map(str);
  let series = arr(c.series).map((s, i) => ({ name: str(s.name || `系列${i + 1}`), values: arr(s.values).map(Number).map(v => (Number.isFinite(v) ? v : 0)) }));
  if (!series.length && c.values) series = [{ name: str(c.name || ''), values: arr(c.values).map(Number) }];
  const W = 600, H = 400, L = 56, R = 16, T = c.title ? 40 : 18, B = 54;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif" font-size="13">`];
  if (c.title) parts.push(`<text x="${W / 2}" y="24" text-anchor="middle" font-size="17" font-weight="700" fill="#1d1d1f">${esc(c.title)}</text>`);
  if (type === 'pie') {
    const vals = (series[0] || { values: [] }).values; const sum = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = 220, cy = T + (H - T - 16) / 2, r = Math.min(150, (H - T - 30) / 2); let ang = -Math.PI / 2;
    vals.forEach((v, i) => {
      const f = Math.max(0, v) / sum; const a2 = ang + f * Math.PI * 2; const large = f > 0.5 ? 1 : 0;
      const p1 = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)], p2 = [cx + r * Math.cos(a2), cy + r * Math.sin(a2)];
      parts.push(f >= 0.9999 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[i % 8]}"/>` : `<path d="M${cx},${cy} L${p1[0].toFixed(1)},${p1[1].toFixed(1)} A${r},${r} 0 ${large} 1 ${p2[0].toFixed(1)},${p2[1].toFixed(1)} Z" fill="${PALETTE[i % 8]}" stroke="#fff" stroke-width="2"/>`);
      const mid = (ang + a2) / 2; if (f > 0.04) parts.push(`<text x="${(cx + r * 0.62 * Math.cos(mid)).toFixed(1)}" y="${(cy + r * 0.62 * Math.sin(mid) + 4).toFixed(1)}" text-anchor="middle" fill="#fff" font-weight="700">${Math.round(f * 100)}%</text>`);
      parts.push(`<rect x="410" y="${T + 10 + i * 24}" width="14" height="14" rx="3" fill="${PALETTE[i % 8]}"/><text x="430" y="${T + 22 + i * 24}" fill="#333">${esc(labels[i] || '')}（${v}）</text>`);
      ang = a2;
    });
    parts.push('</svg>'); return parts.join('');
  }
  const all = series.flatMap(s => s.values);
  let min = Math.min(0, ...all), max = Math.max(0, ...all); if (max === min) max = min + 1;
  const step = niceStep((max - min) / 5); max = Math.ceil(max / step) * step; min = Math.floor(min / step) * step;
  const pw = W - L - R, ph = H - T - B;
  const Y = (v) => T + ph - ((v - min) / (max - min)) * ph;
  for (let v = min; v <= max + 1e-9; v += step) parts.push(`<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#e3e5e8"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" fill="#666">${fmtNum(v)}</text>`);
  parts.push(`<line x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#888"/>`);
  const n = Math.max(labels.length, ...series.map(s => s.values.length), 1); const slot = pw / n;
  labels.forEach((lb, i) => parts.push(`<text x="${(L + slot * (i + 0.5)).toFixed(1)}" y="${H - B + 18}" text-anchor="middle" fill="#444">${esc(lb.slice(0, 12))}</text>`));
  series.forEach((s, si) => {
    const col = PALETTE[si % 8];
    if (type === 'bar' || type === 'hbar') {
      const bw = (slot * 0.7) / series.length;
      s.values.forEach((v, i) => { const x = L + slot * i + slot * 0.15 + bw * si; const y0 = Y(Math.max(0, v)), y1 = Y(Math.min(0, v)); parts.push(`<rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0.5, y1 - y0).toFixed(1)}" rx="2" fill="${col}"/>`); if (c.showValues !== false && n * series.length <= 16) parts.push(`<text x="${(x + bw / 2 - 1).toFixed(1)}" y="${(y0 - 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#333">${fmtNum(v)}</text>`); });
    } else {
      const pts = s.values.map((v, i) => [L + slot * (i + 0.5), Y(v)]);
      if (type === 'line') parts.push(`<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`);
      pts.forEach(p => parts.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${type === 'scatter' ? 4.5 : 3.5}" fill="${col}"/>`));
    }
  });
  if (series.length > 1 || (series[0] && series[0].name)) series.forEach((s, i) => parts.push(`<rect x="${L + i * 110}" y="${H - 22}" width="12" height="12" rx="2" fill="${PALETTE[i % 8]}"/><text x="${L + i * 110 + 17}" y="${H - 12}" fill="#333">${esc(s.name.slice(0, 10))}</text>`));
  if (c.xLabel) parts.push(`<text x="${W - R}" y="${H - B + 36}" text-anchor="end" fill="#666">${esc(c.xLabel)}</text>`);
  if (c.yLabel) parts.push(`<text x="12" y="${T + 4}" fill="#666">${esc(c.yLabel)}</text>`);
  parts.push('</svg>');
  return parts.join('');
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, x)))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
const fmtNum = (v) => (Math.abs(v) >= 1e4 ? (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万' : String(Math.round(v * 100) / 100));
function tableChart(a = {}) {
  const columns = arr(a.columns).map(str); const rows = arr(a.rows).map(r => arr(r).map(str));
  const wide = columns.length > 6;
  const { doc, warnings } = svc.create({ title: a.title || '数据表', kind: 'table-chart', size: 'A4', orientation: wide ? 'landscape' : 'portrait', theme: a.theme || 'modern', pageNumbers: true });
  E.addElement(doc, { type: 'text', role: 'title', text: a.title || '数据表', style: { align: 'left', size: 'xxl' } });
  if (a.description) E.addElement(doc, { type: 'text', role: 'body', text: a.description });
  const charts = arr(a.charts || a.chart);
  for (const c of charts) {
    const spec = Object.assign({}, c);
    if (!spec.labels && columns.length) {
      const xi = typeof c.x === 'number' ? c.x : Math.max(0, columns.indexOf(str(c.x || columns[0])));
      const ys = arr(c.y).length ? arr(c.y) : columns.map((_, i) => i).filter(i => i !== xi && rows.every(r => r[i] === '' || Number.isFinite(Number(String(r[i]).replace(/[,%]/g, '')))));
      spec.labels = rows.map(r => r[xi]);
      spec.series = ys.map(y => { const yi = typeof y === 'number' ? y : columns.indexOf(str(y)); return { name: columns[yi] || '', values: rows.map(r => Number(String(r[yi] || '0').replace(/[,%]/g, ''))) }; }).filter(s => s.name);
      if (spec.type === 'pie') spec.series = spec.series.slice(0, 1);
    }
    const cb = E.contentBox(doc); const w = Math.min(cb.width, 160);
    E.addElement(doc, { type: 'svg', svg: chartSvg(spec), aspect: 1.5, w, x: cb.left + (cb.width - w) / 2, style: { spacing: 'l' } });
  }
  if (columns.length || rows.length) E.addElement(doc, { type: 'table', columns, rows, tableStyle: a.tableStyle || 'zebra', caption: a.caption, style: { size: rows.length > 30 || wide ? 's' : 'm' } });
  if (a.notes) E.addElement(doc, { type: 'text', role: 'note', text: a.notes });
  svc.save(doc);
  return { doc, warnings, charts: charts.length, rows: rows.length };
}

// ---------------------------------------------------------------- 错题本 / 试卷助手
const LETTERS = 'ABCDEFGH';
function exam(a = {}) {
  const mistakes = a.mode === 'mistakes';
  const { doc, warnings } = svc.create({ title: a.title || (mistakes ? '错题本' : '试卷'), kind: mistakes ? 'mistakes' : 'exam', size: a.size || 'A4', theme: a.theme || (mistakes ? 'warm' : 'classic'), margin: 'normal', pageNumbers: true, footer: a.footer || '' });
  const cb = E.contentBox(doc);
  E.addElement(doc, { type: 'text', role: 'title', text: a.title || (mistakes ? '错题本' : '试卷'), style: { spacing: 's' } });
  if (a.subtitle) E.addElement(doc, { type: 'text', role: 'subtitle', text: a.subtitle, style: { spacing: 's' } });
  if (!mistakes) {
    const info = arr(a.fields).length ? arr(a.fields) : ['姓名', '班级', '学号', '得分'];
    E.addElement(doc, { type: 'text', text: info.map(f => `${f}：________`).join('　　'), style: { align: 'center', size: 'm', spacing: 'l' } });
    if (a.instructions) E.addElement(doc, { type: 'text', role: 'note', text: a.instructions });
  }
  let qn = 0; const answers = [];
  const showAns = a.showAnswers || (mistakes ? 'inline' : 'none');
  arr(a.sections).forEach((sec, si) => {
    const qs = arr(sec.questions);
    const pts = qs.reduce((s, q) => s + (Number(q.points) || 0), 0);
    if (sec.title) E.addElement(doc, { type: 'text', role: 'heading', text: `${'一二三四五六七八九十'[si] || si + 1}、${sec.title}${pts ? `（共 ${pts} 分）` : ''}${sec.note ? `　${sec.note}` : ''}`, keepWithNext: true, style: { size: 'l', color: 'theme' } });
    for (const q of qs) {
      qn++;
      const head = `${qn}. ${q.points ? `（${q.points} 分）` : ''}${str(q.stem)}`;
      if (mistakes) {
        const parts = [`**${head}**`];
        if (q.source) parts.push(`来源：${q.source}`);
        if (arr(q.options).length) parts.push(arr(q.options).map((o, i) => `${LETTERS[i]}. ${o}`).join('　'));
        if (q.wrongAnswer) parts.push(`**我的答案：** ${q.wrongAnswer}`);
        if (q.reason) parts.push(`**错因分析：** ${q.reason}`);
        if (q.answer) parts.push(`**正确答案：** ${q.answer}`);
        if (q.explanation) parts.push(`**解析：** ${q.explanation}`);
        if (q.tip) parts.push(`**易错提醒：** ${q.tip}`);
        E.addElement(doc, { type: 'text', text: parts.join('\n\n'), style: { border: 'thin', borderColor: 'lightgray', padding: 'l', radius: 'm', spacing: 'l', lineHeight: 'normal' } });
        continue;
      }
      E.addElement(doc, { type: 'text', text: head, keepWithNext: true, style: { spacing: 's' } });
      const opts = arr(q.options).map(str);
      if (opts.length) {
        const longest = Math.max(...opts.map(o => o.replace(/\$[^$]*\$/g, 'xxxx').length));
        const perRow = longest <= 8 ? Math.min(4, opts.length) : longest <= 20 ? 2 : 1;
        const rows = []; for (let i = 0; i < opts.length; i += perRow) rows.push(opts.slice(i, i + perRow).map((o, j) => `${LETTERS[i + j]}. ${o}`));
        E.addElement(doc, { type: 'table', columns: [], rows, tableStyle: 'plain', x: cb.left + 6, w: cb.width - 6, style: { spacing: 'm' } });
      }
      const space = q.space != null ? Number(q.space) : (q.type === 'choice' || opts.length ? 0 : q.type === 'fill' ? 0 : q.type === 'calc' || q.type === 'proof' ? 6 : 3);
      if (space > 0) E.addElement(doc, { type: 'lines', count: space, gap: 8, x: cb.left + 6, w: cb.width - 6, style: { spacing: 'm' } });
      if (showAns === 'inline' && (q.answer || q.explanation)) E.addElement(doc, { type: 'text', role: 'note', text: `**答案：** ${str(q.answer)}${q.explanation ? `\n**解析：** ${q.explanation}` : ''}` });
      if (q.answer || q.explanation) answers.push({ n: qn, answer: str(q.answer), explanation: str(q.explanation) });
    }
  });
  if (showAns === 'end' && answers.length) {
    E.pageBreak(doc);
    E.addElement(doc, { type: 'text', role: 'heading', text: '参考答案与解析' });
    for (const x of answers) E.addElement(doc, { type: 'text', text: `**${x.n}.** ${x.answer}${x.explanation ? `\n${x.explanation}` : ''}`, style: { spacing: 's' } });
  }
  svc.save(doc);
  return { doc, warnings, questions: qn };
}

// ---------------------------------------------------------------- 单词卡助手
async function wordCards(a = {}, lookup) {
  const items = [];
  for (const w of arr(a.words).slice(0, 120)) {
    const it = typeof w === 'string' ? { word: w } : Object.assign({}, w);
    it.word = str(it.word).trim(); if (!it.word) continue;
    if (lookup && a.lookup !== false && (!it.meaning || !it.phonetic)) { try { const d = await lookup(it.word); if (d) { it.phonetic = it.phonetic || d.phonetic || ''; it.pos = it.pos || d.pos || ''; it.meaning = it.meaning || d.meaning || ''; it.example = it.example || d.example || ''; } } catch {} }
    items.push(it);
  }
  const flash = a.layout === 'flash';
  const { doc, warnings } = svc.create({ title: a.title || '单词卡', kind: 'word-cards', size: 'A4', theme: a.theme || 'fresh', margin: 12, pageNumbers: !flash });
  const cb = E.contentBox(doc);
  const cols = flash ? 2 : Math.max(1, Math.min(3, Number(a.columns) || 2)), rowsPer = flash ? 5 : (cols === 3 ? 6 : 5);
  const gap = 5; const cw = (cb.width - gap * (cols - 1)) / cols; const ch = (cb.height - 12 - gap * (rowsPer - 1)) / rowsPer;
  E.addElement(doc, { type: 'text', text: a.title || '单词卡', x: cb.left, y: cb.top - 2, w: cb.width, page: 1, style: { size: 'l', weight: 'bold', color: 'accent' } });
  const perPage = cols * rowsPer;
  const pagesFront = Math.max(1, Math.ceil(items.length / perPage));
  items.forEach((it, i) => {
    const pageIdx = Math.floor(i / perPage); const k = i % perPage; const r = Math.floor(k / cols), c = k % cols;
    const page = flash ? pageIdx * 2 + 1 : pageIdx + 1;
    const x = cb.left + c * (cw + gap), y = cb.top + 10 + r * (ch + gap);
    E.addElement(doc, { type: 'shape', shape: 'rect', x, y, w: cw, h: ch, page, style: { border: 'dashed', borderColor: 'lightgray' } }).el.background = true;
    E.addElement(doc, { type: 'text', text: `**${it.word}**`, x: x + 4, y: y + 4, w: cw - 8, page, style: { size: flash ? 'xxl' : 'xl', font: 'serif', align: flash ? 'center' : 'left' } }).el.allowOverlap = true;
    if (it.phonetic) E.addElement(doc, { type: 'text', text: it.phonetic, x: x + 4, y: y + (flash ? 16 : 13), w: cw - 8, page, style: { size: 's', color: 'muted', align: flash ? 'center' : 'left' } }).el.allowOverlap = true;
    const back = [it.pos ? `*${it.pos}*  ${str(it.meaning)}` : str(it.meaning), it.example ? `例：${it.example}` : ''].filter(Boolean).join('\n');
    if (flash) {
      // back side: mirrored column so the cards line up when printed double-sided (long-edge flip)
      const bx = cb.left + (cols - 1 - c) * (cw + gap);
      E.addElement(doc, { type: 'shape', shape: 'rect', x: bx, y, w: cw, h: ch, page: page + 1, style: { border: 'dashed', borderColor: 'lightgray' } }).el.background = true;
      E.addElement(doc, { type: 'text', text: back || it.word, x: bx + 4, y: y + ch / 2, w: cw - 8, anchor: 'left', page: page + 1, style: { size: 'm', align: 'center' } }).el.allowOverlap = true;
      doc.pages = Math.max(doc.pages, page + 1);
    } else if (back) E.addElement(doc, { type: 'text', text: back, x: x + 4, y: y + (it.phonetic ? 20 : 14), w: cw - 8, h: ch - (it.phonetic ? 23 : 17), page, style: { size: 's', lineHeight: 'tight' } }).el.allowOverlap = true;
  });
  doc.pages = Math.max(doc.pages, flash ? pagesFront * 2 : pagesFront);
  svc.save(doc);
  return { doc, warnings, words: items.length, items };
}

// ---------------------------------------------------------------- 思维导图助手
function outlineToTree(md) {
  const root = { text: '', children: [] }; const stack = [{ level: -1, node: root }];
  for (const ln of str(md).replace(/\r/g, '').split('\n')) {
    if (!ln.trim()) continue;
    let level, text; let m;
    if ((m = ln.match(/^(#{1,6})\s+(.*)/))) { level = m[1].length - 1; text = m[2]; }
    else if ((m = ln.match(/^(\s*)([-*•]|\d+[.)、])\s+(.*)/))) { level = 6 + Math.floor(m[1].replace(/\t/g, '  ').length / 2); text = m[3]; }
    else continue;
    const node = { text: text.trim(), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].node.children.push(node); stack.push({ level, node });
  }
  if (root.children.length === 1) return root.children[0];
  root.text = '主题'; return root;
}
function normTree(n, depth = 0) { const t = typeof n === 'string' ? { text: n } : (n || {}); return { text: str(t.text || t.title || t.name).slice(0, 60), children: depth > 5 ? [] : arr(t.children).slice(0, 14).map(c => normTree(c, depth + 1)) }; }
function mindmapSvg(tree, opts = {}) {
  const both = opts.direction !== 'right';
  const fs0 = 20, fsN = (d) => (d === 1 ? 15 : 13);
  const wOf = (t, d) => Math.min(220, 18 + [...t].reduce((s, ch) => s + (/[\u2e80-\uffff]/.test(ch) ? 1 : 0.56), 0) * (d === 0 ? fs0 : fsN(d)));
  const rowH = 30;
  const leaves = (n) => (n.children.length ? n.children.reduce((s, c) => s + leaves(c), 0) : 1);
  const kids = tree.children;
  let left = [], right = kids;
  if (both && kids.length > 2) { let tot = kids.reduce((s, c) => s + leaves(c), 0), acc = 0; right = []; left = []; for (const c of kids) { (acc < tot / 2 ? right : left).push(c); acc += leaves(c); } }
  const colW = (d) => (d === 1 ? 190 : 170);
  const depthOf = (n) => (n.children.length ? 1 + Math.max(...n.children.map(depthOf)) : 0);
  const dR = right.length ? Math.max(...right.map(depthOf)) + 1 : 0, dL = left.length ? Math.max(...left.map(depthOf)) + 1 : 0;
  const rootW = wOf(tree.text, 0) + 20;
  const span = (side, d) => { let s = 0; for (let i = 1; i <= d; i++) s += colW(i); return s; };
  const W = Math.max(500, rootW + span('r', dR) + span('l', dL) + 40);
  const H = Math.max(260, Math.max(right.reduce((s, c) => s + leaves(c), 0), left.reduce((s, c) => s + leaves(c), 0)) * rowH + 40);
  const cx = 20 + span('l', dL) + rootW / 2, cy = H / 2;
  const out = [];
  const place = (nodes, dir, depth, x0, yTop, parent, colorIdx) => {
    let y = yTop;
    nodes.forEach((n, i) => {
      const h = leaves(n) * rowH; const ny = y + h / 2; const ci = depth === 1 ? i + (dir < 0 ? right.length : 0) : colorIdx;
      const col = PALETTE[ci % 8]; const w = wOf(n.text, depth);
      const nx = dir > 0 ? x0 + 24 : x0 - 24 - w;
      const px = parent.x, py = parent.y;
      const ex = dir > 0 ? nx : nx + w;
      out.push(`<path d="M${px.toFixed(1)},${py.toFixed(1)} C${((px + ex) / 2).toFixed(1)},${py.toFixed(1)} ${((px + ex) / 2).toFixed(1)},${ny.toFixed(1)} ${ex.toFixed(1)},${ny.toFixed(1)}" fill="none" stroke="${col}" stroke-width="${depth === 1 ? 2.6 : 1.6}"/>`);
      if (depth === 1) out.push(`<rect x="${nx.toFixed(1)}" y="${(ny - 13).toFixed(1)}" width="${w.toFixed(1)}" height="26" rx="13" fill="${col}"/><text x="${(nx + w / 2).toFixed(1)}" y="${(ny + 5).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="15" font-weight="700">${esc(n.text)}</text>`);
      else out.push(`<text x="${(nx + (dir > 0 ? 4 : w - 4)).toFixed(1)}" y="${(ny - 3).toFixed(1)}" text-anchor="${dir > 0 ? 'start' : 'end'}" fill="#333" font-size="13">${esc(n.text)}</text><line x1="${nx.toFixed(1)}" x2="${(nx + w).toFixed(1)}" y1="${(ny + 2).toFixed(1)}" y2="${(ny + 2).toFixed(1)}" stroke="${col}" stroke-width="1.6"/>`);
      const anchor = { x: dir > 0 ? nx + w : nx, y: depth === 1 ? ny : ny + 2 };
      if (n.children.length) place(n.children, dir, depth + 1, dir > 0 ? nx + w : nx, y, anchor, ci);
      y += h;
    });
  };
  const hR = right.reduce((s, c) => s + leaves(c), 0) * rowH, hL = left.reduce((s, c) => s + leaves(c), 0) * rowH;
  place(right, 1, 1, cx + rootW / 2, cy - hR / 2, { x: cx + rootW / 2 - 6, y: cy }, 0);
  place(left, -1, 1, cx - rootW / 2, cy - hL / 2, { x: cx - rootW / 2 + 6, y: cy }, 0);
  out.push(`<rect x="${(cx - rootW / 2).toFixed(1)}" y="${(cy - 22).toFixed(1)}" width="${rootW.toFixed(1)}" height="44" rx="12" fill="#1f2329"/><text x="${cx.toFixed(1)}" y="${(cy + 7).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="${fs0}" font-weight="700">${esc(tree.text)}</text>`);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="100%" height="100%" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif">${out.join('')}</svg>`, aspect: W / H };
}
function mindmap(a = {}) {
  const tree = normTree(a.outline ? outlineToTree(a.outline) : { text: a.root || a.title || '主题', children: a.children || a.branches || [] });
  if (a.root) tree.text = str(a.root);
  const { svg, aspect } = mindmapSvg(tree, { direction: a.direction });
  const { doc, warnings } = svc.create({ title: a.title || tree.text || '思维导图', kind: 'mindmap', size: a.size || 'A4', orientation: aspect >= 1 ? 'landscape' : 'portrait', theme: 'modern', margin: 'narrow' });
  const cb = E.contentBox(doc);
  E.addElement(doc, { type: 'text', text: a.title || tree.text, style: { size: 'xl', weight: 'bold', align: 'center', spacing: 's' } });
  const availH = cb.height - 14; let w = cb.width; if (w / aspect > availH) w = availH * aspect;
  E.addElement(doc, { type: 'svg', svg, aspect, w, x: cb.left + (cb.width - w) / 2 });
  svc.save(doc);
  const count = (n) => 1 + n.children.reduce((s, c) => s + count(c), 0);
  return { doc, warnings, nodes: count(tree) };
}

module.exports = { mdBlocks, layoutMarkdown, slides, slidesFromMarkdown, tableChart, chartSvg, exam, wordCards, mindmap, mindmapSvg, outlineToTree, TEMPLATES };
