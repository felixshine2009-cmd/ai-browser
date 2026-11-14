'use strict';
// Page assistant (F3): one-tap summary and questions about the current web page or PDF. The page is split into
// numbered passages; answers cite them as [n], and a citation scrolls the page to that passage and highlights it.
// PDF text comes from PDFKit on iPad (native.pdftext); on desktop, PDFs are not supported yet.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_PASSAGES = 90, PASSAGE_CHARS = 420, CONTEXT_CHARS = 14000;

// runs in the page: marks block elements with data-aib-p and returns their text
const EXTRACT_JS = `(function(){
  var root = document.querySelector('article, main, [role=main]') || document.body; if (!root) return [];
  var sel = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th,dd,dt,figcaption,summary';
  var els = root.querySelectorAll(sel), out = [], n = 0;
  if (els.length < 3) { root = document.body; els = root.querySelectorAll(sel + ',div'); }
  for (var i = 0; i < els.length && out.length < ${MAX_PASSAGES * 3}; i++) {
    var el = els[i];
    if (el.closest('nav,header,footer,aside,script,style,noscript,[aria-hidden=true]')) continue;
    if (el.tagName === 'DIV' && el.querySelector(sel + ',div')) continue;
    if (el.parentElement && el.parentElement.closest('[data-aib-pp]')) continue;
    var st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') continue;
    var t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
    var head = /^H[1-6]$/.test(el.tagName);
    if (!t || (!head && t.length < 12)) continue;
    el.setAttribute('data-aib-pp', '1');
    out.push({ i: n++, t: t.slice(0, 1200), h: head ? 1 : 0, sel: el });
  }
  window.__aibPassEls = out.map(function(x){ return x.sel; });
  return out.map(function(x){ return { i: x.i, t: x.t, h: x.h }; });
})()`;

function chunk(blocks) {
  // merge small blocks into passages of about PASSAGE_CHARS, keeping headings as passage starts
  const out = []; let cur = null;
  for (const b of blocks) {
    if (!cur || b.h || cur.text.length + b.t.length > PASSAGE_CHARS) { if (cur) out.push(cur); cur = { n: out.length + 1, text: b.t, els: [b.i], page: b.page || 0 }; }
    else { cur.text += (cur.text.endsWith('。') || cur.text.endsWith('.') ? ' ' : '；') + b.t; cur.els.push(b.i); }
    if (out.length >= MAX_PASSAGES) break;
  }
  if (cur && out.length < MAX_PASSAGES) out.push(cur);
  return out;
}

function isPdfUrl(u) { return /\.pdf($|[?#])/i.test(String(u || '')); }

async function pdfFile(url) {
  if (/^file:/i.test(url)) return decodeURIComponent(new URL(url).pathname);
  const f = path.join(os.tmpdir(), 'aib-pdf-' + Date.now().toString(36) + '.pdf');
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error('无法下载 PDF（HTTP ' + r.status + '）');
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
}

/** { kind: 'html'|'pdf', title, url, passages: [{n, text, els, page}] } */
async function extract(tab) {
  if (!tab || !tab.wc || tab.wc.isDestroyed()) throw new Error('没有可读取的页面');
  const url = tab.wc.getURL() || tab.url || '';
  const title = tab.wc.getTitle() || url;
  if (/^aibrowser:/i.test(url)) throw new Error('页面助手仅适用于网页与 PDF 文档');
  if (isPdfUrl(url)) {
    let electron = null; try { electron = require('electron'); } catch {}
    const nat = electron && electron.__ipad && electron.__ipad.native;
    if (!nat) throw new Error('桌面版暂不支持读取 PDF 文本，请在 iPad 版中使用，或将 PDF 内容复制到对话中提问');
    const file = await pdfFile(url);
    const r = await nat('pdftext', { path: file, maxPages: 300 });
    const blocks = []; let i = 0;
    (r.pages || []).forEach((txt, p) => {
      for (const para of String(txt || '').split(/\n\s*\n|(?<=[。！？.!?])\n/)) { const t = para.replace(/\s+/g, ' ').trim(); if (t.length >= 8) blocks.push({ i: i++, t, h: 0, page: p + 1 }); }
    });
    const passages = chunkPdf(blocks);
    if (!passages.length) throw new Error('该 PDF 没有可提取的文字（可能是扫描件）');
    return { kind: 'pdf', title: r.title || title, url, passages, pageCount: r.pageCount || 0 };
  }
  let blocks = [];
  try { blocks = await tab.wc.executeJavaScript(EXTRACT_JS); } catch (e) { throw new Error('无法读取页面内容：' + (e.message || e)); }
  const passages = chunk(blocks || []);
  if (!passages.length) throw new Error('页面中没有可读取的正文');
  return { kind: 'html', title, url, passages };
}
function chunkPdf(blocks) {
  const out = []; let cur = null;
  for (const b of blocks) {
    if (!cur || cur.page !== b.page || cur.text.length + b.t.length > PASSAGE_CHARS) { if (cur) out.push(cur); cur = { n: out.length + 1, text: b.t, els: [], page: b.page }; }
    else cur.text += ' ' + b.t;
    if (out.length >= MAX_PASSAGES) break;
  }
  if (cur && out.length < MAX_PASSAGES) out.push(cur);
  return out;
}

const cache = new Map(); // wc id -> { url, doc }
async function docFor(tab, fresh) {
  const url = tab.wc.getURL();
  const c = cache.get(tab.wc.id);
  if (!fresh && c && c.url === url) return c.doc;
  const doc = await extract(tab);
  cache.set(tab.wc.id, { url, doc });
  return doc;
}

function context(doc) {
  let used = 0; const lines = [];
  for (const p of doc.passages) {
    const line = `[${p.n}]${p.page ? `（第 ${p.page} 页）` : ''} ${p.text}`;
    if (used + line.length > CONTEXT_CHARS) break;
    lines.push(line); used += line.length;
  }
  return lines.join('\n');
}

/** ask({ tab, kind: 'summary'|'ask', question, history }) -> { text, cited: [{n, text, page}], title, url, kind } */
async function ask({ tab, kind, question, history, complete, addendum }) {
  const doc = await docFor(tab, kind === 'summary');
  const sys = [
    '你是页面助手。只依据下面编号的原文段落回答，用正式的书面简体中文。',
    '每个陈述后用方括号标注所依据的段落编号，例如 [3] 或 [2][5]；不要编造段落中没有的信息，原文没有涉及时请直接说明。',
    kind === 'summary' ? '请生成结构清晰的摘要：先用一两句话概括主旨，再分条列出要点，每条都标注出处。' : '请直接回答用户的问题，必要时分条说明。',
    '数学公式请使用 LaTeX，并用 $…$ 或 $$…$$ 包围。',
    addendum || ''
  ].filter(Boolean).join('\n');
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: `标题：${doc.title}\n来源：${doc.url}\n\n原文段落：\n${context(doc)}` }, { role: 'assistant', content: '我已阅读上述段落。' }];
  for (const h of (history || []).slice(-4)) { if (h && h.q && h.a) msgs.push({ role: 'user', content: String(h.q) }, { role: 'assistant', content: String(h.a).slice(0, 2000) }); }
  msgs.push({ role: 'user', content: kind === 'summary' ? '请总结本页内容。' : String(question || '') });
  const text = String(await complete(msgs, { maxTokens: 1600 }) || '').trim();
  const ns = new Set(); for (const m of text.matchAll(/\[(\d{1,3})\]/g)) ns.add(Number(m[1]));
  const cited = doc.passages.filter(p => ns.has(p.n)).map(p => ({ n: p.n, text: p.text, page: p.page || 0 }));
  return { text, cited, title: doc.title, url: doc.url, kind: doc.kind, passages: doc.passages.length };
}

/** scroll the page to passage n and highlight it */
async function reveal(tab, n) {
  const c = cache.get(tab.wc.id); if (!c) return false;
  const p = c.doc.passages.find(x => x.n === Number(n)); if (!p) return false;
  if (c.doc.kind === 'pdf') return { page: p.page, text: p.text };
  const js = `(function(ids){var els=(window.__aibPassEls||[]);var first=null;ids.forEach(function(i){var e=els[i];if(!e)return;if(!first)first=e;var o=e.style.outline,b=e.style.backgroundColor;e.style.transition='background-color .3s';e.style.backgroundColor='rgba(250,204,21,.35)';e.style.outline='2px solid rgba(234,179,8,.8)';setTimeout(function(){e.style.backgroundColor=b;e.style.outline=o},2600)});if(first)first.scrollIntoView({behavior:'smooth',block:'center'});return !!first})(${JSON.stringify(p.els)})`;
  try { return !!(await tab.wc.executeJavaScript(js)); } catch { return false; }
}

module.exports = { extract, ask, reveal, chunk, isPdfUrl, EXTRACT_JS, _cache: cache };
