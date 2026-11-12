'use strict';
// Text-contrast audit run inside a page (page.evaluate / frame.evaluate). Every visible element with its own text (and
// every text field) is measured against its effective background: the stacked backgrounds of its ancestors, over the
// window colour (desktop: --bg-base of the active palette; web: --bg). WCAG AA: 4.5:1.
// Returns { checked, bad: [{ el, text, ratio, fg, bg }], scheme, theme }.
module.exports.EVAL = (min) => {
  min = min || 4.5;
  const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const hex = (h) => { h = String(h || '').trim(); return /^#[0-9a-f]{6}$/i.test(h) ? [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1] : null; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const over = (t, b) => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), 1]; };
  const rs = getComputedStyle(document.documentElement);
  const scheme = rs.colorScheme;
  const light = /light/.test(scheme) && !/dark/.test(scheme);
  const winBg = hex(rs.getPropertyValue('--bg-base')) || hex(rs.getPropertyValue('--bg')) || (light ? [255, 255, 255, 1] : [10, 10, 15, 1]);
  const bgOf = (el) => { const L = []; let e = el; while (e && e.nodeType === 1) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) L.push(c); if (c[3] >= 0.999) break; e = e.parentElement; } let b = winBg; for (let i = L.length - 1; i >= 0; i--) b = over(L[i], b); return b; };
  const vis = (el) => { if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true })) return false; /* closed <details>, display:none ancestors */ const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; let e = el; while (e && e.nodeType === 1) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false; e = e.parentElement; } return true; };
  const bad = []; let checked = 0;
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    const tag = el.tagName.toUpperCase();
    if (['SCRIPT', 'STYLE', 'IFRAME', 'SVG', 'PATH', 'CANVAS', 'OPTION'].includes(tag)) continue;
    if (el.closest('svg, canvas, .swatches, [data-contrast-skip]')) continue;
    const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    const form = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !['checkbox', 'radio', 'hidden', 'range', 'color', 'file'].includes(el.type);
    if (!own && !form) continue; if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage !== 'none' && /url\(/.test(cs.backgroundImage)) continue; // text on an image
    const bg = bgOf(el); const fg = over(parse(cs.color), bg);
    const a = lum(fg), b = lum(bg); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); checked++;
    // disabled controls are exempt in WCAG; still require they are visible at all (3:1 → 2:1 floor)
    const disabled = el.disabled || el.closest('[disabled], .disabled, [aria-disabled="true"]');
    if (ratio < (disabled ? 2 : min)) bad.push({ el: tag.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), text: (el.value || el.textContent || el.placeholder || '').trim().slice(0, 24), ratio: Math.round(ratio * 100) / 100, fg: cs.color, bg: 'rgb(' + bg.slice(0, 3).map(Math.round) + ')' });
  }
  return { checked, bad, scheme, theme: document.documentElement.dataset.theme || '' };
};
// audit a page and all its frames
module.exports.audit = async (page) => {
  let checked = 0; const bad = []; const themes = [];
  for (const f of page.frames()) {
    let r; try { r = await f.evaluate(module.exports.EVAL); } catch { continue; }
    checked += r.checked; themes.push(r.theme);
    for (const b of r.bad) bad.push((f === page.mainFrame() ? '' : '[' + f.url().split('?')[0].slice(0, 48) + '] ') + `${b.el} "${b.text}" ${b.ratio}:1 (${b.fg} on ${b.bg})`);
  }
  return { checked, bad, themes };
};
