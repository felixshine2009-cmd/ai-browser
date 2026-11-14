'use strict';
// v3.0.0 document tools: the layout engine (排版引擎) and the generator agents, registered in the unified tool registry.
// Every result that carries `doc` is rendered by the chat page as a document card (preview, PDF / HTML export).
const svc = require('../doc');
const G = require('../doc/generators');
const E = svc.E;

const str = (d) => ({ type: 'string', description: d });
const n = (d) => ({ type: 'number', description: d });
const en = (vals, d) => ({ type: 'string', enum: vals, description: d });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const arrOf = (items, d) => ({ type: 'array', items, description: d });

const STYLE = obj({
  font: en(Object.keys(E.FONTS)), size: en(Object.keys(E.SIZES), 'xs 8pt · s 9.5 · m 11 · l 13.5 · xl 17 · xxl 22 · h1 28 · display 40'), weight: en(Object.keys(E.WEIGHTS)), italic: { type: 'boolean' },
  color: en(E.ENUMS.color), background: en(E.ENUMS.background), align: en(E.ALIGNS), valign: en(E.VALIGNS), lineHeight: en(Object.keys(E.LINE_HEIGHTS)),
  padding: en(Object.keys(E.PADDINGS)), border: en(Object.keys(E.BORDERS)), borderColor: en(E.ENUMS.borderColor), radius: en(Object.keys(E.RADII)),
  spacing: en(Object.keys(E.SPACING), 'gap below a flowed element'), shadow: en(['none', 'soft']), columns: n('text columns 1-4'), opacity: n('0.05-1')
});
const POS = {
  doc: str('document id (default: the current document)'),
  page: n('page number (1-based)'), x: n('mm from the left edge of the paper'), y: n('mm from the top edge; omit to flow under the previous element'),
  w: n('width in mm (default: the full text width)'), h: n('height in mm (default: measured from the content)'),
  rotation: n('degrees, clockwise, around the anchor'), anchor: en(Object.keys(E.ANCHORS), 'which point of the element x / y refer to'), z: n('stacking order'), style: STYLE
};
const withPos = (props, req = []) => obj(Object.assign({}, POS, props), req);

function result(doc, extra = {}, warnings) {
  const s = E.summary(doc);
  const out = Object.assign({ doc: { id: doc.id, title: doc.title, kind: doc.kind, pages: doc.pages, size: doc.page.size } }, extra);
  if (warnings && warnings.length) out.warnings = warnings;
  if (extra.full) { delete out.full; out.layout = s; }
  return out;
}
const added = (doc, r) => result(doc, { element: { id: r.el.id, type: r.el.type, page: r.el.page, x: r.el.x, y: r.el.y, w: r.el.w, h: E.heightOf(doc, r.el) } }, r.warnings);
const add = (type) => async (a) => svc.mutate(a.doc, (doc) => added(doc, E.addElement(doc, Object.assign({}, a, { type }))));

// preview after a generator: measure, fix, and attach page images for the model (and the card)
async function finish(doc, extra, a = {}) {
  let pv = null;
  try { pv = await svc.preview(doc.id, { fix: 'flow', maxPages: 1 }); } catch {}
  const out = result(svc.get(doc.id), extra);
  if (pv) { out.check = { overlaps: pv.report.overlaps.length, outside: pv.report.outside.length, measured: pv.measured }; if (pv.images[0] && a.preview !== false) out.modelImages = [pv.images[0].dataUrl]; }
  return out;
}
async function lookupWord(w) {
  const chat = require('./chat');
  const e = await chat.aiEntry(w);
  if (!e) return null;
  const pos = Array.isArray(e.pos) ? e.pos : [];
  const ex = pos.flatMap(p => p.defs || []).find(d => d.ex_en);
  return { phonetic: e.ipa_us ? `/${e.ipa_us}/` : (e.ipa_uk ? `/${e.ipa_uk}/` : ''), pos: (pos[0] && pos[0].pos) || '', meaning: pos.slice(0, 2).map((p, i) => (i ? p.pos + ' ' : '') + (p.defs || []).slice(0, 2).map(d => d.zh).filter(Boolean).join('；')).join('　'), example: ex ? ex.ex_en : '' };
}

const TOOLS = [
  // ---- layout engine
  { name: 'doc_new', group: 'document', description: 'Start a new laid-out document (layout engine). Pages hold absolutely positioned elements in millimetres; elements added without y flow top-to-bottom and break onto new pages automatically. Returns the document id, which becomes the current document.',
    parameters: obj({ title: str('document title'), size: en(Object.keys(E.PAGE_SIZES)), orientation: en(['portrait', 'landscape']), margin: str('none / narrow / normal / wide, or a number of mm'), theme: en(Object.keys(E.THEMES)), pageNumbers: { type: 'boolean' }, header: str('running header'), footer: str('running footer') }),
    run: async (a) => { const r = svc.create(a); return result(r.doc, { content: E.contentBox(r.doc) }, r.warnings); } },
  { name: 'doc_set_page', group: 'document', description: 'Change page settings of a document: paper size, orientation, margins, background, theme, header / footer, page numbers. Flowed elements re-flow.',
    parameters: obj({ doc: POS.doc, title: str('new title'), size: en(Object.keys(E.PAGE_SIZES)), orientation: en(['portrait', 'landscape']), margin: str('none / narrow / normal / wide, or a number of mm'), background: en(Object.keys(E.COLORS)), theme: en(Object.keys(E.THEMES)), header: str(''), footer: str(''), pageNumbers: { type: 'boolean' } }),
    run: async (a) => svc.mutate(a.doc, (doc) => { const r = E.setPage(doc, a); return result(doc, { content: E.contentBox(doc) }, r.warnings); }) },
  { name: 'doc_add_text', group: 'document', description: 'Add a text block. Supports **bold**, *italic*, `code`, $inline maths$ (LaTeX), "- " and "1. " lists and line breaks. role gives a ready style (title, subtitle, heading, subheading, body, list, caption, note, quote, label); style overrides it with named values only.',
    parameters: withPos({ text: str('the text'), role: en(Object.keys(E.ROLES)) }, ['text']), run: add('text') },
  { name: 'doc_add_image', group: 'document', description: 'Add an image (http(s) URL, data:image URL or file:// URL) with fit contain / cover / fill and an optional caption. Give aspect (width / height) when known so the height is right before measuring.',
    parameters: withPos({ src: str('image URL'), fit: en(['contain', 'cover', 'fill']), caption: str('caption under the image'), aspect: n('width / height') }, ['src']), run: add('image') },
  { name: 'doc_add_math', group: 'document', description: 'Add a formula written in LaTeX (KaTeX; \\ce{…} for chemistry). display=false for an inline-size formula. label adds an equation number such as 1 or 2.3.',
    parameters: withPos({ tex: str('LaTeX without $ delimiters'), display: { type: 'boolean' }, label: str('equation number') }, ['tex']), run: add('math') },
  { name: 'doc_add_table', group: 'document', description: 'Add a table. Cells support the same inline formatting as text (including $maths$). colWidths are relative weights. tableStyle: grid, lines (three-line table), zebra, plain.',
    parameters: withPos({ columns: arrOf({ type: 'string' }, 'header cells (may be empty)'), rows: arrOf({ type: 'array', items: { type: 'string' } }, 'body rows'), colWidths: arrOf({ type: 'number' }), tableStyle: en(['grid', 'lines', 'zebra', 'plain']), caption: str('') }, ['rows']), run: add('table') },
  { name: 'doc_add_shape', group: 'document', description: 'Add a simple shape: rect, circle, line / hline (horizontal rule), arrow; or writing lines with type "lines" (count, gap). Shapes use style.border / borderColor / background.',
    parameters: withPos({ shape: en(E.SHAPES.concat(['lines'])), count: n('number of writing lines'), gap: n('mm between writing lines') }, ['shape']),
    run: async (a) => svc.mutate(a.doc, (doc) => added(doc, E.addElement(doc, Object.assign({}, a, a.shape === 'lines' ? { type: 'lines' } : { type: 'shape' })))) },
  { name: 'doc_page_break', group: 'document', description: 'Start a new page: the next flowed element goes to the top of the next page.', parameters: obj({ doc: POS.doc }),
    run: async (a) => svc.mutate(a.doc, (doc) => result(doc, E.pageBreak(doc))) },
  { name: 'doc_update_element', group: 'document', description: 'Change an element: its content (text / tex / rows / src / caption), position (page, x, y, w, h, rotation, anchor, z), role or style. Setting y makes it absolutely positioned; flow=true puts it back into the flow.',
    parameters: obj({ doc: POS.doc, id: str('element id'), changes: obj(Object.assign({}, POS, { text: str(''), tex: str(''), src: str(''), caption: str(''), role: en(Object.keys(E.ROLES)), rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, columns: { type: 'array', items: { type: 'string' } }, flow: { type: 'boolean' } })) }, ['id', 'changes']),
    run: async (a) => svc.mutate(a.doc, (doc) => { const r = E.updateElement(doc, String(a.id), a.changes || {}); return added(doc, r); }) },
  { name: 'doc_remove_element', group: 'document', description: 'Remove an element by id.', parameters: obj({ doc: POS.doc, id: str('element id') }, ['id']),
    run: async (a) => svc.mutate(a.doc, (doc) => result(doc, E.removeElement(doc, String(a.id)))) },
  { name: 'doc_list', group: 'document', description: 'Show a document\'s layout (every element with page, x, y, w, h in mm) — or, without doc, list saved documents.', parameters: obj({ doc: POS.doc, all: { type: 'boolean', description: 'list all saved documents' } }),
    run: async (a) => (a.all || (!a.doc && !svc.currentId()) ? { documents: svc.list().slice(0, 40) } : result(svc.use(a.doc), { full: true })) },
  { name: 'doc_fix_overlaps', group: 'document', description: 'Measure the real size of every element, then move elements so none overlap or leave the paper (flowed elements re-flow; absolutely positioned ones are pushed down, onto the next page if needed). Returns what moved.',
    parameters: obj({ doc: POS.doc, mode: en(['all', 'flow'], 'all (default) also moves absolutely positioned elements') }),
    run: async (a) => { const doc = svc.use(a.doc); await svc.measure(doc); const r = E.fixOverlaps(doc, a.mode === 'flow' ? 'flow' : 'all'); svc.save(doc); return result(doc, { before: r.before, after: r.after, moved: r.moved.slice(0, 40), outside: r.remaining.outside }); } },
  { name: 'doc_preview', group: 'document', description: 'Render a page of the document and look at it (the image is returned to you), with a layout check: overlapping elements and elements outside the paper. Use it to verify the layout before exporting.',
    parameters: obj({ doc: POS.doc, page: n('page to render (default 1)'), fix: { type: 'boolean', description: 'fix overlaps first' } }),
    run: async (a) => { const pv = await svc.preview(svc.use(a.doc).id, { page: a.page || 1, fix: a.fix ? 'all' : false }); const out = result(svc.get(pv.doc.id), { check: { overlaps: pv.report.overlaps, outside: pv.report.outside, measured: pv.measured } }); if (pv.images[0]) out.modelImages = [pv.images[0].dataUrl]; else out.note = '本平台无法生成预览图，已返回版面检查结果'; return out; } },
  { name: 'doc_export', group: 'document', description: 'Export the document as PDF (default) or a self-contained HTML file into the Downloads folder.', parameters: obj({ doc: POS.doc, format: en(['pdf', 'html']) }),
    run: async (a) => { const doc = svc.use(a.doc); const r = await svc.exportDoc(doc.id, a.format); return result(svc.get(doc.id), { exported: r }); } },
  // ---- generator agents
  { name: 'layout_agent', group: 'document', description: '排版助手: lay out Markdown content as a finished document — headings, paragraphs, lists, $maths$ / $$display maths$$, tables, images ![caption](url), ```chem blocks, page breaks (\\newpage). Pick a template; the result is measured and overlap-free and can be refined with doc_* tools.',
    parameters: obj({ content: str('Markdown content'), title: str(''), subtitle: str(''), template: en(Object.keys(G.TEMPLATES)), size: en(Object.keys(E.PAGE_SIZES)), orientation: en(['portrait', 'landscape']), theme: en(Object.keys(E.THEMES)), columns: n('body text columns 1-3'), header: str(''), footer: str('') }, ['content']),
    run: async (a) => { const r = G.layoutMarkdown(a); return finish(r.doc, { blocks: r.blocks }, a); } },
  { name: 'slides_agent', group: 'document', description: '幻灯片助手: build a 16:9 (or 4:3) slide deck. Each slide: title plus bullets / text, optional math (LaTeX), image URL, table {columns, rows}, chart {type, labels, series} and notes; layout bullets, two-column, image-left, image-right, section, quote. Export as PDF to present.',
    parameters: obj({ title: str(''), subtitle: str(''), author: str(''), theme: en(Object.keys(E.THEMES)), aspect: en(['16:9', '4:3']), slides: arrOf(obj({ title: str(''), bullets: arrOf({ type: 'string' }), text: str(''), math: str(''), image: str(''), caption: str(''), table: obj({ columns: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }), chart: { type: 'object' }, quote: str(''), by: str(''), layout: en(['bullets', 'two-column', 'image-left', 'image-right', 'section', 'quote']), notes: str('') })), markdown: str('alternative: Markdown outline, one ## heading per slide') }),
    run: async (a) => { const spec = (!a.slides || !a.slides.length) && a.markdown ? Object.assign({}, a, G.slidesFromMarkdown(a.markdown, a.title)) : a; const r = G.slides(spec); return finish(r.doc, { slides: r.slides }, a); } },
  { name: 'table_chart_agent', group: 'document', description: '表格与图表助手: a data sheet with a formatted table and charts (bar, hbar, line, pie, scatter). chart.x = the label column (name or index), chart.y = value columns; or give chart.labels + chart.series directly.',
    parameters: obj({ title: str(''), description: str(''), columns: arrOf({ type: 'string' }), rows: arrOf({ type: 'array', items: { type: 'string' } }), chart: obj({ type: en(['bar', 'hbar', 'line', 'pie', 'scatter']), title: str(''), x: str('label column name'), y: { type: 'array', items: { type: 'string' }, description: 'value column names' }, labels: { type: 'array', items: { type: 'string' } }, series: { type: 'array', items: { type: 'object' } }, xLabel: str(''), yLabel: str('') }), charts: arrOf({ type: 'object' }, 'several charts'), caption: str(''), notes: str(''), tableStyle: en(['grid', 'lines', 'zebra', 'plain']) }),
    run: async (a) => { const r = G.tableChart(a); return finish(r.doc, { charts: r.charts, rows: r.rows }, a); } },
  { name: 'exam_agent', group: 'document', description: '错题本 / 试卷助手: mode exam builds a printable test paper (name / class fields, numbered sections, choice options laid out in columns, answer lines, answers inline or at the end); mode mistakes builds a mistake notebook (my answer, cause of the error, correct answer, explanation, tip). Stems and options support $maths$.',
    parameters: obj({ mode: en(['exam', 'mistakes']), title: str(''), subtitle: str(''), instructions: str(''), fields: arrOf({ type: 'string' }), showAnswers: en(['none', 'inline', 'end']), sections: arrOf(obj({ title: str(''), note: str(''), questions: arrOf(obj({ type: en(['choice', 'fill', 'short', 'calc', 'proof']), stem: str(''), options: { type: 'array', items: { type: 'string' } }, points: n(''), space: n('answer lines'), answer: str(''), explanation: str(''), wrongAnswer: str(''), reason: str(''), tip: str(''), source: str('') }, ['stem'])) })) }, ['sections']),
    run: async (a) => { const r = G.exam(a); return finish(r.doc, { questions: r.questions }, a); } },
  { name: 'word_cards_agent', group: 'document', description: '单词卡助手: printable vocabulary cards. Words can be plain strings (looked up in the dictionary for phonetics, meaning and an example) or objects {word, phonetic, pos, meaning, example}. layout grid (cards with meanings) or flash (front / back pages for double-sided printing).',
    parameters: obj({ title: str(''), words: arrOf(obj({ word: str(''), phonetic: str(''), pos: str(''), meaning: str(''), example: str('') }, ['word']), 'words; only word is required'), layout: en(['grid', 'flash']), columns: n('2 or 3'), lookup: { type: 'boolean', description: 'look up missing fields (default true)' } }, ['words']),
    run: async (a) => { const r = await G.wordCards(a, lookupWord); return finish(r.doc, { words: r.words }, a); } },
  { name: 'mindmap_agent', group: 'document', description: '思维导图助手: a mind map from a Markdown outline (# root, ## branches, - leaves) or a tree {root, children:[{text, children}]}; branches spread to both sides (direction both) or to the right.',
    parameters: obj({ title: str(''), outline: str('Markdown outline'), root: str(''), children: arrOf({ type: 'object' }), direction: en(['both', 'right']) }),
    run: async (a) => { const r = G.mindmap(a); return finish(r.doc, { nodes: r.nodes }, a); } }
];
const LABELS = {
  doc_new: '新建文档', doc_set_page: '页面设置', doc_add_text: '添加文字', doc_add_image: '添加图片', doc_add_math: '添加公式', doc_add_table: '添加表格', doc_add_shape: '添加图形',
  doc_page_break: '分页', doc_update_element: '修改元素', doc_remove_element: '删除元素', doc_list: '文档版面', doc_fix_overlaps: '修正重叠', doc_preview: '预览文档', doc_export: '导出文档',
  layout_agent: '排版助手', slides_agent: '幻灯片助手', table_chart_agent: '表格与图表助手', exam_agent: '错题本 / 试卷助手', word_cards_agent: '单词卡助手', mindmap_agent: '思维导图助手'
};
module.exports = { TOOLS, LABELS, lookupWord };
