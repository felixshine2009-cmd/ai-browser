'use strict';
// MDict (.mdx/.mdd) dictionary manager: multiple dictionaries, @@@LINK redirects,
// entry:// links, sound:// audio, resources served from MDD through the aibdict:// protocol.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MDX, MDD } = require('js-mdict');
const store = require('../store');
const { lemmaCandidates } = require('../classify');

const loaded = new Map(); // id -> {mdx, mdds:[], mtime}

const MIME = {
  css: 'text/css', js: 'application/javascript', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', spx: 'audio/ogg', aac: 'audio/aac',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', html: 'text/html', htm: 'text/html', json: 'application/json'
};
function mimeOf(p) { return MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream'; }

function list() { return store.getSettings().dicts || []; }
function enabled() { return list().filter(d => d.enabled !== false); }

function openDict(d) {
  const st = (() => { try { return fs.statSync(d.mdx).mtimeMs; } catch { return 0; } })();
  const c = loaded.get(d.id);
  if (c && c.mtime === st && c.mdxPath === d.mdx) return c;
  if (!st) throw new Error('文件不存在: ' + d.mdx);
  const mdx = new MDX(d.mdx);
  const mdds = [];
  for (const p of d.mdd || []) { try { mdds.push(new MDD(p)); } catch (e) { console.error('mdd open failed', p, e.message); } }
  const rec = { mdx, mdds, mtime: st, mdxPath: d.mdx };
  loaded.set(d.id, rec);
  return rec;
}

function findMddFiles(mdxPath) {
  const dir = path.dirname(mdxPath), base = path.basename(mdxPath, path.extname(mdxPath));
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.mdd')) continue;
      const fb = path.basename(f, path.extname(f));
      if (fb === base || fb.startsWith(base + '.')) out.push(path.join(dir, f));
    }
  } catch {}
  return out.sort();
}

function getTitle(rec, fallback) {
  try { const t = (rec.mdx.header && (rec.mdx.header.Title || rec.mdx.header.title)) || ''; const s = String(t).replace(/<[^>]*>/g, '').trim(); if (s && !/No HTML code/i.test(s)) return s; } catch {}
  return fallback;
}

function add(mdxPath, mddPaths) {
  mdxPath = path.resolve(mdxPath);
  const dicts = list().slice();
  if (dicts.some(d => d.mdx === mdxPath)) return { dup: true };
  const id = 'd' + crypto.createHash('md5').update(mdxPath).digest('hex').slice(0, 8);
  const mdds = mddPaths && mddPaths.length ? mddPaths : findMddFiles(mdxPath);
  const fallback = path.basename(mdxPath, path.extname(mdxPath));
  const d = { id, name: fallback, mdx: mdxPath, mdd: mdds, enabled: true };
  const rec = openDict(d); // throws if broken
  d.name = getTitle(rec, fallback);
  dicts.push(d);
  store.patchSettings({ dicts });
  return d;
}
function remove(id) { store.patchSettings({ dicts: list().filter(d => d.id !== id) }); loaded.delete(id); }
function setEnabled(id, v) { store.patchSettings({ dicts: list().map(d => d.id === id ? { ...d, enabled: !!v } : d) }); }
function move(id, delta) {
  const a = list().slice(); const i = a.findIndex(d => d.id === id); const j = i + delta;
  if (i < 0 || j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  store.patchSettings({ dicts: a });
}
function rename(id, name) { store.patchSettings({ dicts: list().map(d => d.id === id ? { ...d, name } : d) }); }

function rawLookup(rec, key) {
  let r;
  try { r = rec.mdx.lookup(key); } catch { return null; }
  if (!r || r.definition == null) return null;
  return r;
}

// Follow @@@LINK=target redirects (max 6 hops). Returns {key, html} or null
function resolveEntry(rec, key) {
  let k = key;
  for (let i = 0; i < 6; i++) {
    const r = rawLookup(rec, k);
    if (!r) return null;
    const def = String(r.definition).replace(/\u0000+$/, '');
    const m = def.match(/^@@@LINK=([\s\S]*?)\s*$/);
    if (m) { k = m[1].trim(); continue; }
    return { key: r.keyText || k, html: def };
  }
  return null;
}

function lookupIn(d, word, candidates) {
  const rec = openDict(d);
  for (const c of candidates) {
    const e = resolveEntry(rec, c);
    if (e) return { dictId: d.id, name: d.name, key: e.key, lookupKey: c };
  }
  return null;
}

function lookup(word) {
  const cands = lemmaCandidates(word.trim());
  const out = [];
  for (const d of enabled()) {
    try { const r = lookupIn(d, word, cands); if (r) out.push(r); } catch (e) { console.error('dict lookup', d.name, e.message); }
  }
  return out;
}

function suggest(prefix, limit = 12) {
  const out = new Set();
  const p = prefix.trim();
  if (!p) return [];
  for (const d of enabled()) {
    try {
      const rec = openDict(d);
      const r = rec.mdx.prefix(p) || [];
      for (const x of r.slice(0, limit)) out.add(x.keyText || x.k || x);
    } catch {}
    if (out.size >= limit) break;
  }
  return [...out].slice(0, limit).map(String);
}

const INJECT = (id) => `<script>(function(){
var ID=${JSON.stringify(id)};
document.addEventListener('click',function(ev){
  var a=ev.target.closest&&ev.target.closest('a[href]'); if(!a) return;
  var h=a.getAttribute('href')||'';
  if(/^entry:\\/\\//i.test(h)){ev.preventDefault();var k=decodeURIComponent(h.replace(/^entry:\\/\\//i,'').replace(/#.*$/,'').replace(/\\/$/,''));
    location.href='aibdict://'+ID+'/__entry__?key='+encodeURIComponent(k);}
  else if(/^sound:\\/\\//i.test(h)){ev.preventDefault();var p=h.replace(/^sound:\\/\\//i,'');
    try{if(window.__aud)window.__aud.pause();window.__aud=new Audio('aibdict://'+ID+'/'+p.replace(/^\\//,''));window.__aud.play();}catch(e){}}
  else if(/^https?:/i.test(h)){ev.preventDefault();window.open(h,'_blank');}
},true);
window.addEventListener('load',function(){try{parent.postMessage({aibDictHeight:document.documentElement.scrollHeight,id:ID},'*')}catch(e){}});
})();</script>`;

const BASE_CSS = `<style>html{color-scheme:light}body{margin:0;padding:14px 18px;font:15px/1.6 -apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif;background:#fff;color:#111}</style>`;

function entryDocument(id, key) {
  const d = list().find(x => x.id === id);
  if (!d) return null;
  const rec = openDict(d);
  const cands = lemmaCandidates(key);
  let e = null;
  for (const c of cands) { e = resolveEntry(rec, c); if (e) break; }
  const base = `<base href="aibdict://${id}/">`;
  if (!e) return `<!doctype html><meta charset="utf-8">${BASE_CSS}<p style="color:#888">未找到：${String(key).replace(/[<&>]/g, '')}</p>`;
  // keep entry's own <head>/<link>; inject base + our script
  let html = e.html;
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, m => m + '<meta charset="utf-8">' + base);
  else html = '<meta charset="utf-8">' + base + html;
  return `<!doctype html>${BASE_CSS}${html}${INJECT(id)}`;
}

function mddLocate(rec, p) {
  const tries = new Set();
  let dp = p; try { dp = decodeURIComponent(p); } catch {}
  for (const x of [dp, p]) {
    const n = x.replace(/^\/+/, '');
    tries.add('\\' + n.replace(/\//g, '\\'));
    tries.add('\\' + n);
    tries.add(n);
  }
  for (const m of rec.mdds) {
    for (const t of tries) {
      let r; try { r = m.locate(t); } catch { r = null; }
      if (r && r.definition != null) return Buffer.from(String(r.definition), 'base64');
    }
  }
  return null;
}

function resource(id, relPath) {
  const d = list().find(x => x.id === id);
  if (!d) return null;
  const rec = openDict(d);
  const buf = mddLocate(rec, relPath);
  if (buf) return { data: buf, mime: mimeOf(relPath) };
  // loose files next to the .mdx (common for user-supplied css/js)
  try {
    const f = path.join(path.dirname(d.mdx), decodeURIComponent(relPath).replace(/^\/+/, ''));
    if (f.startsWith(path.dirname(d.mdx)) && fs.existsSync(f) && fs.statSync(f).isFile()) return { data: fs.readFileSync(f), mime: mimeOf(f) };
  } catch {}
  return null;
}

function handleProtocol(req) {
  const u = new URL(req.url);
  const id = u.hostname;
  const rel = u.pathname;
  const hdr = { 'Access-Control-Allow-Origin': '*' };
  try {
    if (rel === '/__entry__') {
      const html = entryDocument(id, u.searchParams.get('key') || '');
      if (html == null) return new Response('no dict', { status: 404, headers: hdr });
      return new Response(html, { headers: { ...hdr, 'Content-Type': 'text/html; charset=utf-8' } });
    }
    const r = resource(id, rel);
    if (!r) return new Response('not found', { status: 404, headers: hdr });
    return new Response(r.data, { headers: { ...hdr, 'Content-Type': r.mime } });
  } catch (e) {
    return new Response(String(e.message), { status: 500, headers: hdr });
  }
}

module.exports = { list, enabled, add, remove, setEnabled, move, rename, lookup, suggest, handleProtocol, entryDocument, resource, findMddFiles };
