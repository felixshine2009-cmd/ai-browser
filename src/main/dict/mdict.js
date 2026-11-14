'use strict';
// MDict (.mdx/.mdd) dictionary manager: multiple dictionaries, @@@LINK redirects,
// entry:// links, sound:// audio, resources served from MDD through the aibdict:// protocol.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// js-mdict is loaded on first use: an optional parser that fails to load (e.g. a runtime without some text decoder)
// must only disable dictionaries, never the app's main process.
let mdictLib = null;
function jsMdict() {
  if (!mdictLib) {
    try { mdictLib = require('js-mdict'); } catch (e) { throw new Error('词典解析模块加载失败：' + (e && e.message || e)); }
  }
  return mdictLib;
}
const store = require('../store');
let electronApp = null; try { electronApp = require('electron').app; } catch {}
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
  if (c && c.mtime === st && c.mdxPath === d.mdx && c.mddKey === (d.mdd || []).join('|')) return c;
  if (!st) throw new Error('文件不存在: ' + d.mdx);
  const { MDX, MDD } = jsMdict();
  const mdx = new MDX(d.mdx);
  const mdds = [];
  const mddStatus = [];
  for (const p of d.mdd || []) {
    let bytes = 0; try { bytes = fs.statSync(p).size; } catch {}
    try { mdds.push(new MDD(p)); mddStatus.push({ file: path.basename(p), bytes, ok: true }); }
    catch (e) { console.error('mdd open failed', p, e.message); mddStatus.push({ file: path.basename(p), bytes, ok: false, error: String(e && e.message || e) }); }
  }
  const rec = { mdx, mdds, mddStatus, mtime: st, mdxPath: d.mdx, mddKey: (d.mdd || []).join('|') };
  loaded.set(d.id, rec);
  return rec;
}

// names compared as the Files app and other systems may write them: Unicode NFC vs NFD, any letter case
const normName = (n) => String(n).normalize('NFC').toLowerCase().trim();
// the resource files of a dictionary: "<name>.mdd", "<name>.1.mdd", "<name>.2.mdd" … next to "<name>.mdx". When the folder
// holds a single .mdx, every .mdd in it belongs to that dictionary (some releases name the .mdd differently).
function findMddFiles(mdxPath) {
  const dir = path.dirname(mdxPath), base = normName(path.basename(mdxPath, path.extname(mdxPath)));
  const out = [], all = [];
  let mdxCount = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const low = normName(f);
      if (low.endsWith('.mdx')) mdxCount++;
      if (!low.endsWith('.mdd')) continue;
      all.push(path.join(dir, f));
      const fb = low.slice(0, -4);
      if (fb === base || fb.startsWith(base + '.')) out.push(path.join(dir, f));
    }
  } catch {}
  const r = out.length ? out : (mdxCount === 1 ? all : []);
  // "<name>.mdd" first, then "<name>.1.mdd", "<name>.2.mdd" …
  return r.sort((a, b) => { const k = (x) => { const m = normName(path.basename(x)).match(/\.(\d+)\.mdd$/); return m ? Number(m[1]) : 0; }; return k(a) - k(b) || (a < b ? -1 : a > b ? 1 : 0); });
}

function getTitle(rec, fallback) {
  try { const t = (rec.mdx.header && (rec.mdx.header.Title || rec.mdx.header.title)) || ''; const s = String(t).replace(/<[^>]*>/g, '').trim(); if (s && !/No HTML code/i.test(s)) return s; } catch {}
  return fallback;
}

// ---- dictionaries are COPIED into <userData>/dictionaries/<name>/ so deleting / moving the originals never breaks them
function dictRoot() { return path.join(process.env.AIB_USER_DATA || electronApp.getPath('userData'), 'dictionaries'); }
const insideRoot = (p) => { let r = path.resolve(dictRoot()) + path.sep, q = path.resolve(p); if (process.platform === 'win32') { r = r.toLowerCase(); q = q.toLowerCase(); } return q.startsWith(r); }; // Windows paths are case-insensitive
const slug = (n) => String(n).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'dictionary';
let progressState = { active: false };
const getProgress = () => progressState;

// every file to copy: the .mdx, all same-name .mdd (.1.mdd, .2.mdd …) and companion files (css/js/fonts/images/subfolders)
function planCopy(mdxPath) {
  const dir = path.dirname(mdxPath), base = path.basename(mdxPath, path.extname(mdxPath));
  const mdds = findMddFiles(mdxPath).map(f => path.basename(f));
  const files = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        let hasDict = false; try { hasDict = fs.readdirSync(full).some(x => /\.mdx$/i.test(x)); } catch {}
        if (!hasDict) walk(full, r); // never pull in another dictionary's folder
        continue;
      }
      if (!e.isFile()) continue;
      const low = e.name.toLowerCase();
      if (!rel && (low.endsWith('.mdx') || low.endsWith('.mdd'))) { if (e.name === path.basename(mdxPath) || mdds.includes(e.name)) files.push({ full, rel: r, bytes: fs.statSync(full).size }); continue; }
      files.push({ full, rel: r, bytes: fs.statSync(full).size });
    }
  };
  walk(dir, '');
  return { dir, base, files, total: files.reduce((a, f) => a + f.bytes, 0), mdds };
}
function copyWithProgress(src, dst, onBytes) {
  return new Promise((res, rej) => {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const rs = fs.createReadStream(src), ws = fs.createWriteStream(dst);
    rs.on('data', c => onBytes(c.length)); rs.on('error', rej); ws.on('error', rej); ws.on('close', res); rs.pipe(ws);
  });
}
async function importDict(mdxPath, opts = {}) {
  mdxPath = path.resolve(mdxPath);
  const dicts = list().slice();
  if (dicts.some(d => d.origin === mdxPath || d.mdx === mdxPath)) return { dup: true };
  const plan = planCopy(mdxPath);
  let name = slug(plan.base), n = 1, target = path.join(dictRoot(), name);
  while (fs.existsSync(target)) { n++; target = path.join(dictRoot(), name + ' (' + n + ')'); }
  progressState = { active: true, name: plan.base, got: 0, total: plan.total, files: plan.files.length, done: 0 };
  try {
    fs.mkdirSync(target, { recursive: true });
    for (const f of plan.files) {
      await copyWithProgress(f.full, path.join(target, f.rel), (b) => { progressState.got += b; opts.onProgress && opts.onProgress(progressState); });
      progressState.done++;
    }
  } catch (e) { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} progressState = { active: false, error: String(e.message || e) }; throw e; }
  const mdxCopy = path.join(target, path.basename(mdxPath));
  const mddCopies = plan.mdds.map(f => path.join(target, f)); // order kept: <name>.mdd, <name>.1.mdd …
  const id = 'd' + crypto.createHash('md5').update(mdxPath).digest('hex').slice(0, 8);
  const d = { id, name: plan.base, mdx: mdxCopy, mdd: mddCopies, dir: target, origin: mdxPath, bytes: plan.total, enabled: true };
  try { const rec = openDict(d); d.name = getTitle(rec, plan.base); }
  catch (e) { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} progressState = { active: false, error: String(e.message || e) }; throw e; }
  dicts.push(d); store.patchSettings({ dicts });
  progressState = { active: false, done: plan.files.length, total: plan.total, got: plan.total, name: d.name, finished: true };
  return d;
}
// legacy synchronous API (kept for tests / callers): registers a dictionary by reference (no copy)
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
// startup migration: path-referenced dictionaries get copied (if the source still exists) or flagged 'source missing'
async function migrate() {
  const out = { copied: [], missing: [] };
  for (const d of list().slice()) {
    if (d.mdx && insideRoot(d.mdx)) continue;
    if (!d.mdx || !fs.existsSync(d.mdx)) { store.patchSettings({ dicts: list().map(x => x.id === d.id ? { ...x, missing: true, missingReason: '源文件已不存在：' + d.mdx + ' / source file is gone' } : x) }); out.missing.push(d.name); continue; }
    try {
      const plan = planCopy(d.mdx);
      let name = slug(d.name || plan.base), n = 1, target = path.join(dictRoot(), name);
      while (fs.existsSync(target)) { n++; target = path.join(dictRoot(), name + ' (' + n + ')'); }
      fs.mkdirSync(target, { recursive: true });
      for (const f of plan.files) await copyWithProgress(f.full, path.join(target, f.rel), () => {});
      const mdxCopy = path.join(target, path.basename(d.mdx));
      const nd = { ...d, origin: d.mdx, mdx: mdxCopy, mdd: plan.mdds.map(f => path.join(target, f)).sort(), dir: target, bytes: plan.total, missing: false, missingReason: '' };
      store.patchSettings({ dicts: list().map(x => x.id === d.id ? nd : x) }); loaded.delete(d.id); out.copied.push(d.name);
    } catch (e) { store.patchSettings({ dicts: list().map(x => x.id === d.id ? { ...x, missing: true, missingReason: '复制失败：' + e.message + ' / copy failed' } : x) }); out.missing.push(d.name); }
  }
  return out;
}
function dirSize(p) { let t = 0; try { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); t += e.isDirectory() ? dirSize(f) : fs.statSync(f).size; } } catch {} return t; }
function mddInfo(d) {
  try { const rec = openDict(d); return rec.mddStatus; }
  catch { return (d.mdd || []).map(p => ({ file: path.basename(p), bytes: (() => { try { return fs.statSync(p).size; } catch { return 0; } })(), ok: fs.existsSync(p) })); }
}
function listWithInfo() { return list().map(d => ({ ...d, bytes: d.dir ? dirSize(d.dir) : (d.bytes || 0), copied: !!(d.mdx && insideRoot(d.mdx)), missing: d.missing || (d.mdx && !fs.existsSync(d.mdx)), mddInfo: d.mdx && fs.existsSync(d.mdx) ? mddInfo(d) : [] })); }

// v3.0.1: add .mdd files (and loose css / js / fonts / images) to a dictionary after it was imported — on the iPad
// the Files picker hands over only what was selected, so the resources may come in a second pick
async function addResources(id, paths) {
  const d = list().find(x => x.id === id);
  if (!d) throw new Error('词典不存在');
  const target = d.dir || path.dirname(d.mdx);
  fs.mkdirSync(target, { recursive: true });
  const mdd = (d.mdd || []).slice(), added = [], skipped = [];
  for (const p of paths) {
    let st; try { st = fs.statSync(p); } catch { skipped.push(path.basename(p)); continue; }
    if (st.isDirectory()) { // a folder: its .mdd files and companion files
      for (const n of fs.readdirSync(p)) { if (!/\.mdx$/i.test(n) && !n.startsWith('.')) { const r = await addResources(id, [path.join(p, n)]).catch(() => null); if (r) added.push(...r.added); } }
      continue;
    }
    if (/\.mdx$/i.test(p)) { skipped.push(path.basename(p)); continue; }
    const dst = path.join(target, path.basename(p));
    if (path.resolve(dst) !== path.resolve(p)) await copyWithProgress(p, dst, () => {});
    if (/\.mdd$/i.test(p) && !mdd.some(x => normName(path.basename(x)) === normName(path.basename(p)))) mdd.push(dst);
    added.push(path.basename(p));
  }
  const cur = list().find(x => x.id === id) || d;
  const order = (x) => { const m = normName(path.basename(x)).match(/\.(\d+)\.mdd$/); return m ? Number(m[1]) : 0; };
  mdd.sort((a, b) => order(a) - order(b));
  store.patchSettings({ dicts: list().map(x => x.id === id ? { ...cur, mdd, bytes: dirSize(target) } : x) });
  loaded.delete(id); missingCache.delete(id);
  return { added, skipped, mdd: mdd.map(x => path.basename(x)) };
}
// a pick without any .mdx: .mdd files go to the imported dictionary of the same name
function dictForMdd(mddPath) {
  const b = normName(path.basename(mddPath)).replace(/(\.\d+)?\.mdd$/, '');
  return list().find(d => [d.mdx, d.origin].filter(Boolean).some(m => normName(path.basename(m)).replace(/\.mdx$/, '') === b)) || null;
}
function remove(id) {
  const d = list().find(x => x.id === id);
  store.patchSettings({ dicts: list().filter(x => x.id !== id) }); loaded.delete(id);
  // delete the app's own copy (never an original the user pointed at)
  if (d && d.dir && insideRoot(d.dir)) { try { fs.rmSync(d.dir, { recursive: true, force: true }); } catch {} }
}
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

const INJECT = (id, missing) => `<script>(function(){
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
var last=0,tm=0;
function rep(){try{var b=document.body;if(!b)return;var cs=getComputedStyle(b),mt=parseFloat(cs.marginTop)||0,mb=parseFloat(cs.marginBottom)||0;
  var h=Math.ceil(Math.max(b.scrollHeight+mt+mb,b.getBoundingClientRect().bottom+(window.scrollY||0)+mb));
  if(Math.abs(h-last)>2){last=h;parent.postMessage({aibDictHeight:h,id:ID},'*')}}catch(e){}}
function q(){if(tm)return;tm=setTimeout(function(){tm=0;rep()},60)}
function watch(){q();try{new ResizeObserver(q).observe(document.body)}catch(e){}try{new MutationObserver(q).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true})}catch(e){}}
if(document.body)watch();else document.addEventListener('DOMContentLoaded',watch);
window.addEventListener('load',function(){q();setTimeout(q,300);setTimeout(q,1200)});
try{document.fonts&&document.fonts.ready.then(q)}catch(e){}
document.addEventListener('click',function(){setTimeout(q,50);setTimeout(q,400)});
document.addEventListener('load',function(e){if(e.target&&e.target.tagName==='IMG')q()},true);
var MISSING=${JSON.stringify(missing || []).replace(/</g, '\\u003c')};
if(MISSING.length){var show=function(){var d=document.createElement('div');d.className='aib-dict-missing';d.setAttribute('role','note');
  d.style.cssText='font:13px/1.5 -apple-system,"PingFang SC",sans-serif;color:#7a5b00;background:#fff8e1;border:1px solid #f0d58a;border-radius:8px;padding:6px 10px;margin:0 0 10px';
  d.textContent='此词典的部分资源未找到（'+MISSING.join('、')+'），词条的样式或展开功能可能不完整。请重新导入词典，并同时选择同名的 .mdd 文件或整个词典文件夹。';
  document.body.insertBefore(d,document.body.firstChild);q()};if(document.body)show();else document.addEventListener('DOMContentLoaded',show)}
})();</script>`;

// Runs before the entry's own scripts. Entry scripts of large dictionaries (OALDPE and similar) keep settings in
// localStorage; in a sandboxed frame without storage that throws and the script stops before it reveals the entry,
// which left the page blank on iPad (B3). Storage falls back to memory, and if the entry still shows no text after
// it loaded, hidden blocks are revealed.
const PRELUDE = `<script>(function(){
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}
['localStorage','sessionStorage'].forEach(function(n){var ok=false;try{var s=window[n];s.setItem('__aib','1');s.removeItem('__aib');ok=true}catch(e){}if(!ok){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(e){}}});
window.addEventListener('error',function(e){try{console.warn('[dict] entry script error',e.message)}catch(x){}});
window.addEventListener('load',function(){setTimeout(function(){
  var b=document.body;if(!b)return;
  var nw=function(t){return String(t||'').replace(/\\s+/g,'').length},bn=b.querySelector('.aib-dict-missing'),bl=bn?nw(bn.textContent):0;
  var vis=nw(b.innerText)-bl,all=nw(b.textContent)-bl;
  if(all===0)return;
  if(vis>0&&!(vis<80&&all>vis*6&&all>300))return;
  var st=document.createElement('style');st.textContent='body,body *{visibility:visible!important;opacity:1!important}body [style*="display:none"],body [style*="display: none"],body .hidden,body .hide{display:block!important}';
  document.head?document.head.appendChild(st):b.appendChild(st);
  if(nw(b.innerText)-bl<80){var els=b.querySelectorAll('*');for(var i=0;i<els.length;i++){if(getComputedStyle(els[i]).display==='none'&&!/^(SCRIPT|STYLE|TEMPLATE|HEAD|META|LINK)$/.test(els[i].tagName))els[i].style.setProperty('display','block','important')}}
},600)});
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
  if (!String(html).replace(/<[^>]*>/g, '').trim() && !/<(img|svg|audio|iframe)\b/i.test(html)) {
    return `<!doctype html><meta charset="utf-8">${BASE_CSS}<p style="color:#888">词条“${String(e.key || key).replace(/[<&>]/g, '')}”的内容为空，或无法按该词典声明的编码解码。</p>`;
  }
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, m => m + '<meta charset="utf-8">' + base + PRELUDE);
  else html = '<meta charset="utf-8">' + base + PRELUDE + html;
  return `<!doctype html>${BASE_CSS}${html}${INJECT(id, missingResources(id, rec, d, html))}`;
}

// stylesheets and scripts the entry refers to that neither the .mdd files nor the dictionary folder provide
// (typically: the .mdd was not selected together with the .mdx when importing); cached per dictionary
const missingCache = new Map();
function missingResources(id, rec, d, html) {
  const refs = new Set();
  const re = /<(?:link[^>]*?\shref|script[^>]*?\ssrc)\s*=\s*["']?([^"' >]+)/gi;
  let m; while ((m = re.exec(html))) { const r = m[1]; if (!/^(https?:|data:|blob:|aibdict:|\/\/)/i.test(r)) refs.add(r.replace(/[?#].*$/, '')); }
  const out = [];
  let c = missingCache.get(id); if (!c || c.mtime !== rec.mtime) { c = { mtime: rec.mtime, hit: new Map() }; missingCache.set(id, c); }
  for (const r of refs) {
    if (!c.hit.has(r)) { let ok = false; try { ok = !!resource(id, r); } catch {} c.hit.set(r, ok); }
    if (!c.hit.get(r)) out.push(path.basename(r));
  }
  return out;
}

function mddLocate(rec, p) {
  const tries = new Set();
  let dp = p; try { dp = decodeURIComponent(p); } catch {}
  for (const x of [dp, p, dp.toLowerCase()]) {
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
    const root = path.dirname(d.mdx);
    const rel = decodeURIComponent(relPath).replace(/\\/g, '/').replace(/^\/+/, '');
    const f = path.join(root, rel);
    if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) return { data: fs.readFileSync(f), mime: mimeOf(f) };
    // case-insensitive match (dictionaries made on Windows refer to OALDPE.css while the file is oaldpe.css)
    let cur = root; let ok = true;
    for (const part of rel.split('/').filter(Boolean)) {
      let names = []; try { names = fs.readdirSync(cur); } catch { ok = false; break; }
      const hit = names.find(n => n.toLowerCase() === part.toLowerCase());
      if (!hit) { ok = false; break; }
      cur = path.join(cur, hit);
    }
    if (ok && cur !== root && cur.startsWith(root) && fs.statSync(cur).isFile()) return { data: fs.readFileSync(cur), mime: mimeOf(cur) };
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

module.exports = { addResources, dictForMdd, normName, list, listWithInfo, enabled, add, importDict, migrate, getProgress, dictRoot, remove, setEnabled, move, rename, lookup, suggest, handleProtocol, entryDocument, resource, findMddFiles };
