// Tiny safe Markdown renderer (escape first, then a small subset) with [n] citation links.
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
  function render(text, cites) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = []; let list = null, para = [];
    const flushPara = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>'), cites).replace(/&lt;br&gt;/g, '<br>') + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.t}>` + list.items.map(i => '<li>' + inline(i, cites) + '</li>').join('') + `</${list.t}>`); list = null; } };
    for (const ln of lines) {
      let m;
      if ((m = ln.match(/^\s*[-*•]\s+(.*)/))) { flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
      else if ((m = ln.match(/^\s*\d+[.)]\s+(.*)/))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); }
      else if ((m = ln.match(/^(#{1,4})\s+(.*)/))) { flushPara(); flushList(); out.push(`<h4>${inline(m[2], cites)}</h4>`); }
      else if (!ln.trim()) { flushPara(); flushList(); }
      else { flushList(); para.push(ln); }
    }
    flushPara(); flushList();
    return out.join('');
  }
  window.MD = { render, esc };
})();
