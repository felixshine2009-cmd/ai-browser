// Find in page for web views (webContents.findInPage / stopFindInPage), injected into the isolated content world.
// Counts every match, highlights them (CSS Custom Highlight API where available, else <mark>), scrolls to the active one.
(function () {
  if (window.__aibFind) return;
  let ranges = [], active = -1, last = '', lastCase = false, marks = [];
  const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  if (HL) { const st = document.createElement('style'); st.textContent = '::highlight(aib-find){background:#ffe36e;color:#000}::highlight(aib-find-active){background:#ff9632;color:#000}'; (document.head || document.documentElement).appendChild(st); }
  function clear() {
    if (HL) { CSS.highlights.delete('aib-find'); CSS.highlights.delete('aib-find-active'); }
    for (const m of marks) { const p = m.parentNode; if (!p) continue; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize(); }
    marks = []; ranges = []; active = -1;
  }
  function collect(text, matchCase) {
    const needle = matchCase ? text : text.toLowerCase();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode(n) { const p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT; const cs = getComputedStyle(p); return cs.display === 'none' || cs.visibility === 'hidden' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    const out = [];
    for (let n = walker.nextNode(); n && out.length < 5000; n = walker.nextNode()) {
      const hay = matchCase ? n.data : n.data.toLowerCase();
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length); out.push(r); }
    }
    return out;
  }
  function paint() {
    if (HL) {
      CSS.highlights.set('aib-find', new Highlight(...ranges));
      if (active >= 0) CSS.highlights.set('aib-find-active', new Highlight(ranges[active]));
    } else if (!marks.length) {
      for (let i = ranges.length - 1; i >= 0; i--) { const m = document.createElement('mark'); m.setAttribute('data-aib-find', ''); try { ranges[i].surroundContents(m); marks.unshift(m); } catch (e) { marks.unshift(null); } }
    }
    if (!HL) marks.forEach((m, i) => { if (m) m.style.cssText = 'background:' + (i === active ? '#ff9632' : '#ffe36e') + ';color:#000'; });
    const target = HL ? ranges[active] : marks[active];
    if (target) { const r = target.getBoundingClientRect ? target.getBoundingClientRect() : null; if (r) window.scrollBy({ top: r.top - innerHeight / 3, behavior: 'instant' }); }
  }
  window.__aibFind = function (a) {
    const text = String(a.text || '');
    if (!text) { clear(); last = ''; return { active: 0, matches: 0 }; }
    if (text !== last || !!a.matchCase !== lastCase || !a.next) { clear(); last = text; lastCase = !!a.matchCase; ranges = collect(text, lastCase); active = ranges.length ? 0 : -1; }
    else if (ranges.length) active = (active + (a.forward === false ? -1 : 1) + ranges.length) % ranges.length;
    paint();
    return { active: active + 1, matches: ranges.length };
  };
  window.__aibFindClear = function () { clear(); last = ''; };
})();
