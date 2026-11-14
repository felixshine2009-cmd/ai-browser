'use strict';
// Read later / offline copies (F4). A saved page keeps a full offline copy (iPad: WKWebView web archive; desktop:
// MHTML) and its text, so saved pages can be read without a network and searched together with the offline
// encyclopedia. Stored in userData/readlater: index.json plus <id>.webarchive|.mhtml and <id>.txt.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let electronApp = null; try { electronApp = require('electron').app; } catch {}
const dir = () => { const d = path.join(electronApp ? electronApp.getPath('userData') : require('os').tmpdir(), 'readlater'); fs.mkdirSync(d, { recursive: true }); return d; };
const indexFile = () => path.join(dir(), 'index.json');
function list() { try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return []; } }
function saveIndex(l) { fs.writeFileSync(indexFile(), JSON.stringify(l, null, 1)); }
function textOf(id) { try { return fs.readFileSync(path.join(dir(), id + '.txt'), 'utf8'); } catch { return ''; } }

const TEXT_JS = `(function(){var r=document.querySelector('article, main, [role=main]')||document.body;return {title:document.title||'',text:(r?r.innerText:'').slice(0,600000),lang:document.documentElement.lang||''}})()`;

/** save a tab's page -> entry */
async function save(tab) {
  if (!tab || !tab.wc || tab.wc.isDestroyed()) throw new Error('没有可保存的页面');
  const url = tab.wc.getURL() || '';
  if (!/^https?:/i.test(url)) throw new Error('只能保存网页（http 或 https 地址）');
  const l = list();
  const ex = l.find(x => x.url === url);
  const id = ex ? ex.id : 'r' + crypto.createHash('md5').update(url + Date.now()).digest('hex').slice(0, 10);
  let info = { title: tab.wc.getTitle() || url, text: '' };
  try { info = Object.assign(info, await tab.wc.executeJavaScript(TEXT_JS)); } catch {}
  const copy = await require('./native').savePage(tab.wc, dir(), id);
  fs.writeFileSync(path.join(dir(), id + '.txt'), String(info.text || ''));
  const entry = { id, url, title: String(info.title || tab.wc.getTitle() || url).slice(0, 300), savedAt: Date.now(), file: path.basename(copy.file), format: copy.format, bytes: copy.bytes, chars: String(info.text || '').length, excerpt: String(info.text || '').replace(/\s+/g, ' ').slice(0, 220), read: false };
  const next = l.filter(x => x.id !== id); next.unshift(entry); saveIndex(next);
  return entry;
}
function remove(id) {
  const l = list(); const e = l.find(x => x.id === id); if (!e) return false;
  for (const f of [e.file, id + '.txt']) { try { fs.unlinkSync(path.join(dir(), f)); } catch {} }
  saveIndex(l.filter(x => x.id !== id)); return true;
}
function markRead(id, read = true) { const l = list(); const e = l.find(x => x.id === id); if (!e) return false; e.read = !!read; saveIndex(l); return true; }
/** file:// URL of the offline copy */
function fileUrl(id) { const e = list().find(x => x.id === id); if (!e) return null; const f = path.join(dir(), e.file); return fs.existsSync(f) ? require('url').pathToFileURL(f).href : null; }
function get(id) { const e = list().find(x => x.id === id); return e ? Object.assign({ text: textOf(id) }, e) : null; }

/** full-text search over saved pages: [{ id, title, url, snippet, score }] */
function search(q, limit = 30) {
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const out = [];
  for (const e of list()) {
    const title = (e.title || '').toLowerCase(); const text = textOf(e.id); const low = text.toLowerCase();
    let score = 0, at = -1;
    for (const t of terms) {
      const tt = title.includes(t) ? 5 : 0; const i = low.indexOf(t);
      if (!tt && i < 0) { score = 0; break; }
      score += tt + (i >= 0 ? 1 : 0); if (at < 0 && i >= 0) at = i;
    }
    if (!score) continue;
    const s = Math.max(0, at - 60);
    out.push({ id: e.id, title: e.title, url: e.url, snippet: (s > 0 ? '…' : '') + text.slice(s, s + 200).replace(/\s+/g, ' ') + '…', score, savedAt: e.savedAt, source: 'readlater' });
  }
  return out.sort((a, b) => b.score - a.score || b.savedAt - a.savedAt).slice(0, limit);
}
module.exports = { list, save, remove, markRead, fileUrl, get, search, dir };
