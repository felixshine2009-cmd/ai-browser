'use strict';
// Agentic-search helpers: SERP scraping in a hidden window (default engine), DuckDuckGo html fallback,
// readable-text extraction with Mozilla Readability.
const { BrowserWindow, net } = require('electron');
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
  if (!out.length) { // generic fallback (custom engines): external links with sentence-like text
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

function loadHidden(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { sandbox: true, contextIsolation: true, partition: 'persist:serp' } });
    win.webContents.setUserAgent(UA);
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(t); try { win.destroy(); } catch {} err ? reject(err) : resolve(val); };
    const t = setTimeout(async () => {
      // still try to extract whatever has loaded
      try { finish(null, await win.webContents.executeJavaScript('document.documentElement.outerHTML')); } catch (e) { finish(new Error('timeout')); }
    }, timeoutMs);
    win.webContents.once('did-finish-load', async () => {
      setTimeout(async () => {
        try { finish(null, { html: await win.webContents.executeJavaScript('document.documentElement.outerHTML'), href: win.webContents.getURL() }); }
        catch (e) { finish(e); }
      }, 700);
    });
    win.webContents.once('did-fail-load', (e, code, desc, u, isMain) => { if (isMain) finish(new Error('load failed: ' + desc)); });
    win.loadURL(url).catch(() => {});
  });
}

async function decodeBody(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  let cs = ((res.headers.get('content-type') || '').match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) { const head = buf.slice(0, 2048).toString('latin1'); cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1]; }
  try { return new TextDecoder((cs || 'utf-8').toLowerCase()).decode(buf); } catch { return buf.toString('utf8'); }
}

async function ddgFallback(query) {
  const { JSDOM } = require('jsdom');
  const res = await net.fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { headers: { 'User-Agent': UA, 'Accept-Language': 'en,zh-CN;q=0.8' } });
  const html = await decodeBody(res);
  const dom = new JSDOM(html, { url: 'https://html.duckduckgo.com/html/' });
  return extractSerp(dom.window.document, 'duckduckgo', 'https://html.duckduckgo.com/html/');
}

async function serp(query) {
  const info = store.searchEngineInfo();
  const url = store.searchUrl(query);
  let results = [];
  try {
    const r = await loadHidden(url);
    const { JSDOM } = require('jsdom');
    const html = typeof r === 'string' ? r : r.html;
    const href = typeof r === 'string' ? url : r.href;
    const dom = new JSDOM(html, { url: href });
    results = extractSerp(dom.window.document, info.id, href);
  } catch (e) { console.error('serp failed:', e.message); }
  let via = info.id;
  if (!results.length) {
    try { results = await ddgFallback(query); via = 'duckduckgo-html'; } catch (e) { console.error('ddg fallback failed:', e.message); }
  }
  return { query, via, results };
}

function siteOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

async function readPage(url, { maxChars = 5000, timeoutMs = 9000 } = {}) {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const { Readability } = require('@mozilla/readability');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', Accept: 'text/html,*/*' }, signal: ac.signal, redirect: 'follow' });
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

module.exports = { serp, readPage, extractSerp, siteOf };
