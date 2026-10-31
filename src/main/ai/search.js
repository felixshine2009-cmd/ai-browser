'use strict';
// Agentic-search helpers: SERP scraping in a hidden window (default engine), DuckDuckGo html fallback,
// readable-text extraction with Mozilla Readability.
let BrowserWindow = null, net = null;
try { ({ BrowserWindow, net } = require('electron')); } catch {}
if (typeof BrowserWindow !== 'function') { BrowserWindow = null; net = null; }
const store = require('../store');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Runs inside the page (stringified) AND in jsdom tests: no closures allowed.
function extractSerp(doc, engineId, baseHref) {
  const out = [];
  const seen = new Set();
  const text = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  function push(a, title, snippet) {
    let href = a.getAttribute('href') || '';
    try { href = new URL(href, baseHref).href; } catch { return; }
    if (!/^https?:/i.test(href)) return;
    // Bing click-tracking: /ck/a?...&u=a1<base64url>
    try {
      const u = new URL(href);
      if (/bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/')) {
        const v = u.searchParams.get('u');
        if (v && v.startsWith('a1')) {
          let b = v.slice(2).replace(/-/g, '+').replace(/_/g, '/');
          while (b.length % 4) b += '=';
          href = (typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8'));
        }
      }
      if (/duckduckgo\.com$/.test(u.hostname) && u.pathname.startsWith('/l/')) {
        const v = u.searchParams.get('uddg'); if (v) href = v;
      }
    } catch {}
    if (seen.has(href)) return;
    seen.add(href);
    title = title || text(a);
    if (!title) return;
    out.push({ title: title.slice(0, 200), url: href, snippet: (snippet || '').slice(0, 400) });
  }
  const q = s => Array.from(doc.querySelectorAll(s));
  if (engineId === 'bing') {
    q('li.b_algo').forEach(li => { const a = li.querySelector('h2 a'); if (a) push(a, text(a), text(li.querySelector('.b_caption p, p'))); });
  } else if (engineId === 'google') {
    q('div.g, div[data-hveid] div.MjjYud').forEach(g => { const h = g.querySelector('h3'); const a = h && h.closest('a'); if (a) push(a, text(h), text(g.querySelector('.VwiC3b, [data-sncf]'))); });
    if (!out.length) q('a h3').forEach(h => { const a = h.closest('a'); if (a) push(a, text(h), ''); });
  } else if (engineId === 'baidu') {
    q('#content_left .result, #content_left .c-container').forEach(r => { const a = r.querySelector('h3 a'); if (a) push(a, text(a), text(r.querySelector('.c-abstract, .content-right_8Zs40, [class*=content-right]'))); });
  } else if (engineId === 'duckduckgo') {
    q('a.result__a, a[data-testid="result-title-a"]').forEach(a => { const r = a.closest('.result, article, li'); push(a, text(a), text(r && r.querySelector('.result__snippet, [data-result="snippet"]'))); });
  }
  if (!out.length && !['bing', 'google', 'baidu', 'duckduckgo'].includes(engineId)) { // generic fallback (custom engines only): external links with sentence-like text
    let host = ''; try { host = new URL(baseHref).hostname; } catch {}
    q('h3 a, h2 a, a').forEach(a => {
      const h = a.getAttribute('href') || '';
      if (!/^https?:/i.test(h)) return;
      let hh = ''; try { hh = new URL(h).hostname; } catch { return; }
      if (hh === host) return;
      if (text(a).length < 8) return;
      push(a, text(a), '');
    });
  }
  return out.slice(0, 10);
}

// --- network layer: Electron (net / hidden BrowserWindow) in the app, plain fetch in node (live tests)
const electronNet = net || null;
const doFetch = (u, o) => (electronNet ? electronNet.fetch(u, o) : fetch(u, o));
const nodeFetch = (u, o) => fetch(u, o); // undici: serves the plain SSR result pages of bing / baidu / ddg reliably
const HAS_WINDOW = !!BrowserWindow;

function loadHidden(url, timeoutMs = 12000, partition = 'persist:serp') {
  return new Promise((resolve, reject) => {
    // Incognito callers pass the private in-memory partition so SERP cookies never land in the shared persist:serp jar.
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true, contextIsolation: true, partition } });
    win.webContents.setUserAgent(UA);
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(t); try { win.destroy(); } catch {} err ? reject(err) : resolve(val); };
    const t = setTimeout(async () => {
      // still try to extract whatever has loaded
      try { finish(null, { html: await win.webContents.executeJavaScript('document.documentElement.outerHTML'), href: win.webContents.getURL() }); } catch (e) { finish(new Error('timeout')); }
    }, timeoutMs);
    win.webContents.once('did-finish-load', async () => {
      setTimeout(async () => {
        try { finish(null, { html: await win.webContents.executeJavaScript('document.documentElement.outerHTML'), href: win.webContents.getURL() }); }
        catch (e) { finish(e); }
      }, 700);
    });
    win.webContents.once('did-fail-load', (e, code, desc, u, isMain) => { if (isMain) finish(new Error('load failed: ' + desc)); });
    win.loadURL(url, { userAgent: UA, extraHeaders: 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.7\n' }).catch(() => {});
  });
}

async function decodeBody(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  let cs = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) { const head = buf.slice(0, 2048).toString('latin1'); cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1]; }
  try { return new TextDecoder((cs || 'utf-8').toLowerCase()).decode(buf); } catch { return buf.toString('utf8'); }
}

async function fetchHtml(url, timeoutMs = 12000, f = doFetch) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await f(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7', Accept: 'text/html,application/xhtml+xml,*/*' }, signal: ac.signal, redirect: 'follow' });
    return { html: await decodeBody(res), href: res.url || url, status: res.status };
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- query terms / relevance
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'what', 'how', 'why', 'with', 'vs', 'by', 'at', 'from', 'about']);
// Latin words + CJK bigrams (a lone CJK char counts as a term). Used to decide whether a hit is about the query at all.
function queryTerms(q) {
  const terms = new Set();
  String(q || '').toLowerCase().replace(/[a-z0-9][a-z0-9.+#_-]*/g, w => { if (w.length >= 2 && !STOP.has(w)) terms.add(w); return ' '; })
    .split(/[^\u3400-\u9fff\uf900-\ufaff]+/).forEach(run => {
      if (!run) return;
      if (run.length === 1) terms.add(run); else for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
    });
  return [...terms];
}
function relevanceScore(r, q) {
  const terms = queryTerms(q); if (!terms.length) return 1;
  let u = r.url || ''; try { u = decodeURIComponent(u); } catch {}
  const hay = ((r.title || '') + ' ' + (r.snippet || '') + ' ' + u).toLowerCase();
  let hit = 0; for (const t of terms) if (hay.includes(t)) hit++;
  return hit / terms.length;
}
function isRelevant(r, q) {
  const terms = queryTerms(q); if (!terms.length) return true;
  // short queries (names): every term must appear; longer ones: at least a third (min 2)
  const need = terms.length <= 2 ? terms.length : Math.max(2, Math.ceil(terms.length * 0.34));
  return relevanceScore(r, q) * terms.length + 1e-9 >= need;
}
const BAD_HOST = /(^|\.)(roblox\.com|login\.live\.com|accounts\.google\.com)$/;
function isNavJunk(r) { try { const u = new URL(r.url); if (/^(image|video|map|v|xue|tieba)\.baidu\.com$/.test(u.hostname)) return true; if (/(^|\.)baidu\.com$/.test(u.hostname) && (u.pathname === '/baidu.php' || u.pathname === '/s' || u.pathname === '/')) return true; return BAD_HOST.test(u.hostname) || /\/(login|signin|sign-in|passport)(\/|$)/i.test(u.pathname); } catch { return true; } }

// ---------------------------------------------------------------- engines
function engineTemplate(id, custom) {
  if (id === 'custom') return custom || '';
  return (store.ENGINES[id] || store.ENGINES.bing).url;
}
// URL with locale parameters so CJK queries get Chinese results (bing mkt/setlang, google hl, ddg kl)
function engineUrl(id, q, custom) {
  let url = engineTemplate(id, custom).replace('%s', encodeURIComponent(q));
  const cjk = CJK.test(q);
  const add = (k, v) => { if (!new RegExp('[?&]' + k + '=').test(url)) url += (url.includes('?') ? '&' : '?') + k + '=' + v; };
  if (id === 'bing') { if (cjk) { add('mkt', 'zh-CN'); add('setlang', 'zh-Hans'); } else add('setlang', 'en'); }
  else if (id === 'google') add('hl', cjk ? 'zh-CN' : 'en');
  else if (id === 'duckduckgo') add('kl', cjk ? 'cn-zh' : 'wt-wt');
  return url;
}
const FALLBACKS = ['bing', 'duckduckgo', 'baidu'];

async function resolveBaiduLinks(results) {
  await Promise.all(results.map(async r => {
    if (!/^https?:\/\/(www\.)?baidu\.com\/link\?/.test(r.url)) return;
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 5000);
      const res = await nodeFetch(r.url.replace(/^http:/, 'https:'), { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA, Referer: 'https://www.baidu.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' }, signal: ac.signal }); clearTimeout(t);
      const loc = res.headers.get('location'); if (loc) r.url = loc;
      else if (res.url && !/baidu\.com\/link/.test(res.url)) r.url = res.url;
    } catch {}
  }));
}

function looksBlocked(html, href) {
  return /captcha|verify|wappass\.baidu|安全验证|unusual traffic|are you a robot/i.test((href || '') + ' ' + (html || '').slice(0, 3000)) && (html || '').length < 20000;
}

// One engine, one query -> parsed + junk-filtered results (relevance applied by caller). Throws on network/blocked.
const lastReq = {};
async function searchOnce(id, query, custom, partition) {
  const url = engineUrl(id, query, custom);
  const hidden = (u) => loadHidden(u, 12000, partition || 'persist:serp');
  const { JSDOM, VirtualConsole } = require('jsdom');
  const parse = (page) => {
    if (looksBlocked(page.html, page.href)) throw new Error('blocked (captcha / verification page)');
    const dom = new JSDOM(page.html, { url: page.href, virtualConsole: new VirtualConsole() });
    return extractSerp(dom.window.document, id, page.href);
  };
  let parsed = []; let lastErr = null;
  const attempts = [];
  // gentle pacing per engine (baidu answers bursts with a captcha page)
  const gap = id === 'baidu' ? 1500 : 0; const wait = gap - (Date.now() - (lastReq[id] || 0)); lastReq[id] = Date.now() + Math.max(0, wait); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  if (id === 'custom' || id === 'google') { if (HAS_WINDOW) attempts.push(() => hidden(url)); attempts.push(() => fetchHtml(url, 12000, nodeFetch)); }
  else { attempts.push(() => fetchHtml(url, 12000, nodeFetch)); if (electronNet) attempts.push(() => fetchHtml(url, 12000, doFetch)); if (HAS_WINDOW && id !== 'duckduckgo') attempts.push(() => hidden(url)); }
  let attemptNo = 0;
  if (id === 'baidu') attempts.push(async () => { await new Promise(r => setTimeout(r, 2500)); return fetchHtml(url, 12000, nodeFetch); });
  for (const get of attempts) {
    attemptNo++;
    try { const pg = await get(); if (process.env.AIB_DEBUG_SEARCH) { console.error('[serp-attempt]', id, pg.href.slice(0, 60), (pg.html || '').length); } parsed = parse(pg); lastErr = null; if (parsed.length) break; } catch (e) { lastErr = e; if (process.env.AIB_DEBUG_SEARCH) console.error('[serp-attempt-err]', id, e.message); }
  }
  if (!parsed.length && lastErr) throw lastErr;
  if (id === 'baidu') await resolveBaiduLinks(parsed);
  return parsed.filter(r => !isNavJunk(r));
}

// serp(query, {engine, partition}) -> { query, via, tried:[{engine,count,error?}], results }
// Chain: selected engine -> bing -> duckduckgo. A hit list only counts if enough of it is ABOUT the query.
// partition: pass the active tab's session partition (e.g. 'aib-incognito') so SERP cookies stay private.
async function serp(query, opts = {}) {
  let s = {}; try { s = store.getSettings().search || {}; } catch {}
  const selected = opts.engine || s.engine || 'bing';
  const partition = opts.partition || 'persist:serp';
  const fb = (CJK.test(query) ? ['baidu', 'bing', 'duckduckgo'] : FALLBACKS).filter(e => e !== selected);
  const chain = [selected, ...fb];
  const tried = [];
  for (const id of chain) {
    try {
      const all = await searchOnce(id, query, s.custom, partition);
      const rel = all.filter(r => isRelevant(r, query));
      tried.push({ engine: id, count: all.length, relevant: rel.length });
      if (rel.length) return { query, via: id, selected, fallback: id !== selected, tried, results: rel.slice(0, 10) };
    } catch (e) { tried.push({ engine: id, count: 0, error: String(e.message || e).slice(0, 120) }); }
  }
  return { query, via: 'none', selected, fallback: false, tried, results: [] };
}

function siteOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

async function readPage(url, { maxChars = 5000, timeoutMs = 9000 } = {}) {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const { Readability } = require('@mozilla/readability');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', Accept: 'text/html,*/*' }, signal: ac.signal, redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ct = res.headers.get('content-type') || '';
    if (!/html|text|xml/i.test(ct)) throw new Error('unsupported type ' + ct);
    const html = (await decodeBody(res)).slice(0, 2_000_000);
    const vc = new VirtualConsole();
    const dom = new JSDOM(html, { url: res.url || url, virtualConsole: vc });
    const doc = dom.window.document;
    const art = new Readability(doc).parse();
    let text = (art && art.textContent || doc.body?.textContent || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
    return { url, title: (art && art.title) || doc.title || url, text: text.slice(0, maxChars), site: siteOf(url) };
  } finally { clearTimeout(t); }
}

module.exports = { serp, readPage, extractSerp, siteOf, queryTerms, isRelevant, relevanceScore, engineUrl, searchOnce };
