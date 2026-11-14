// Tiny safe Markdown renderer (escape first, then a small subset) with [n] citation links.
// 2.3.0: TeX math ($$…$$, \[…\], \(…\), $…$) is rendered with the bundled offline KaTeX (+ mhchem for \ce{…}) when
// the page loaded vendor/katex; otherwise it stays as escaped source. Math inside code is left alone.
(function () {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function inline(s, cites) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\[(\d{1,2})\]/g, (m, n) => {
      const c = cites && cites[n];
      return c ? `<a class="cite" href="${esc(c.url)}" title="${esc(c.title || c.url)}">${n}</a>` : `<span class="cite">${n}</span>`;
    });
    return s;
  }
  // ---- math
  const PH = (i) => '\u0001' + i + '\u0002';
  function katexOf() { return (typeof window !== 'undefined' && window.katex && typeof window.katex.renderToString === 'function') ? window.katex : null; }
  function texHtml(tex, display) {
    const k = katexOf();
    if (k) { try { return k.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'html' }); } catch {} }
    return `<span class="math-raw${display ? ' display' : ''}">${esc(display ? '$$' + tex + '$$' : '$' + tex + '$')}</span>`;
  }
  // replaces math outside code with placeholders; returns { text, math: [{tex, display}] }
  function extractMath(text) {
    const math = [];
    const parts = text.split(/(^\s*```[\s\S]*?^\s*```[^\n]*$)/m); // fenced code blocks stay untouched
    for (let i = 0; i < parts.length; i += 2) {
      let seg = parts[i];
      const codes = [];
      seg = seg.replace(/`[^`\n]+`/g, (m) => { codes.push(m); return '\u0003' + (codes.length - 1) + '\u0004'; });
      const put = (tex, display) => { math.push({ tex: tex.trim(), display }); return display ? '\n\n' + PH(math.length - 1) + '\n\n' : PH(math.length - 1); };
      seg = seg.replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => put(t, true));
      seg = seg.replace(/\\\[([\s\S]+?)\\\]/g, (m, t) => put(t, true));
      seg = seg.replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => put(t, false));
      // inline $…$: no space just inside the dollars, not a price such as "$5 and $6"
      // (no look-behind: older iPadOS WebKit cannot parse it)
      seg = seg.replace(/(^|[^\\$\w])\$(?!\s)([^$\n]{1,400}?)\$(?![\w$])/g, (m, pre, t) => (/[\s\\]$/.test(t) || /^\d+(?:[.,]\d+)?$/.test(t) ? m : pre + put(t, false)));
      seg = seg.replace(/\u0003(\d+)\u0004/g, (m, n) => codes[Number(n)]);
      parts[i] = seg;
    }
    return { text: parts.join(''), math };
  }
  function render(text, cites) {
    const ex = extractMath(String(text || '').replace(/\r/g, ''));
    const html = renderBlocks(ex.text, cites);
    if (!ex.math.length) return html;
    return html.replace(/\u0001(\d+)\u0002/g, (m, n) => { const x = ex.math[Number(n)]; return x ? texHtml(x.tex, x.display) : ''; });
  }
  function renderBlocks(text, cites) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = []; let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>'), cites).replace(/&lt;br&gt;/g, '<br>') + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.t}>` + list.items.map(i => '<li>' + inline(i, cites) + '</li>').join('') + `</${list.t}>`); list = null; } };
    let fence = null;
    for (const ln of lines) {
      let m;
      if (/^\s*```/.test(ln)) { if (fence) { out.push('<pre><code>' + esc(fence.join('\n')) + '</code></pre>'); fence = null; } else { flushPara(); flushList(); fence = []; } continue; }
      if (fence) { fence.push(ln); continue; }
      if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
      else if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); }
      else if ((m = ln.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); out.push(`<h4>${inline(m[2], cites)}</h4>`); }
      else if (!ln.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(ln); }
    }
    if (fence) out.push('<pre><code>' + esc(fence.join('\n')) + '</code></pre>');
    flushPara(); flushList();
    return out.join('');
  }
  window.MD = { render, esc, extractMath, texHtml, hasKatex: () => !!katexOf() };
})();
