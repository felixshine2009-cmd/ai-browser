/* AI Browser appearance: light / dark / follow-system mode plus colour palettes.
   ONE source of truth shared by the desktop main process (require), every internal page (aibrowser://static/theme.js),
   the web app (web/js/theme.js, an exact copy enforced by test/suites/35-theme.js) and the iPad app (same pages).
   settings.appearance = { mode: 'system' | 'light' | 'dark', theme: <dark palette>, light: <light palette> }
   Legacy settings ({ theme: 'sand' }) are migrated by normAppearance(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AIBTheme = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MODES = ['system', 'light', 'dark'];
  // swatch = colours shown in Settings. desktop = CSS custom properties of src/renderer/static/shared.css,
  // web = custom properties of web/css/app.css, ext = the extension panels (physics, GeoGebra, dictionary settings).
  // 'aurora' and the defaults of each stylesheet are the same palette, so its override sets are empty.
  const THEMES = {
    aurora: {
      id: 'aurora', zh: '极光', en: 'Aurora', scheme: 'dark', base: '#050508',
      swatch: ['#07100f', '#0b1416', '#f7f7f9', '#5fb99a', '#3b82f6'],
      desktop: {}, web: {}, ext: {}
    },
    night: {
      id: 'night', zh: '夜色', en: 'Night', scheme: 'dark', base: '#0b0510',
      swatch: ['#120818', '#1a0d28', '#f3e9ff', '#b48cff', '#7ec8ff'],
      desktop: {
        '--bg-base': '#0b0510',
        '--bg-solid': '#1c1029', '--bg-popover': 'rgba(30, 17, 44, 0.99)', '--bg-sheet': 'rgba(26, 14, 38, 0.97)', '--bg-shade': 'rgba(18, 9, 28, 0.55)', '--bg-well': '#100718', '--bg-raised': '#2e1d44', '--bg-search': 'rgba(44, 28, 64, 0.72)', '--bg-search-focus': 'rgba(52, 34, 76, 0.85)', '--bg-window': '#0d0612', '--bg-toolbar': 'rgba(24, 12, 36, 0.92)', '--bg-tabbar': '#100718',
        '--bg-sidebar': 'rgba(28, 14, 42, 0.72)', '--bg-vibrancy': 'rgba(40, 24, 60, 0.55)', '--bg-card': 'rgba(36, 20, 54, 0.72)',
        '--bg-muted': 'rgba(30, 16, 44, 0.85)', '--bg-panel': 'rgba(32, 18, 48, 0.78)',
        '--page-bg': 'radial-gradient(ellipse 80% 55% at 50% 88%, rgba(120, 70, 190, 0.28) 0%, transparent 65%), linear-gradient(180deg, #08040c 0%, #120818 42%, #1a0d28 100%)',
        '--text-primary': '#f3e9ff', '--text-secondary': '#dcd0ec', '--text-tertiary': '#b8a9cc', '--text-link': '#9fd2ff',
        '--accent': '#6a4cf0', '--accent-soft': 'rgba(180, 140, 255, 0.18)', '--green': '#b48cff', '--green-text': '#dcc8ff', '--green-soft': 'rgba(180, 140, 255, 0.18)'
      },
      web: { '--bg': '#120818', '--panel': '#1a0d28', '--panel2': '#241338', '--border': '#36214f', '--text': '#f3e9ff', '--muted': '#b8a9cc', '--accent': '#b48cff', '--accent-dim': '#2e1a48', '--disabled': '#8f80a8' },
      ext: { '--bg': '#120818', '--panel': 'rgba(30, 16, 44, 0.85)', '--panel-solid': '#1a0d28', '--border': 'rgba(255, 255, 255, 0.14)', '--text': '#f3e9ff', '--muted': '#b8a9cc', '--accent': '#b48cff', '--btn': 'rgba(40, 24, 60, 0.8)', '--well': '#100718' }
    },
    ink: {
      id: 'ink', zh: '墨黑', en: 'Ink', scheme: 'dark', base: '#0a0a0b',
      swatch: ['#111214', '#181a1e', '#f4f4f5', '#c3c9d2', '#8b939e'],
      desktop: {
        '--bg-base': '#0a0a0b',
        '--bg-solid': '#1a1c20', '--bg-popover': 'rgba(26, 28, 32, 0.99)', '--bg-sheet': 'rgba(22, 23, 26, 0.97)', '--bg-shade': 'rgba(12, 12, 14, 0.55)', '--bg-well': '#0e0f11', '--bg-raised': '#2a2d33', '--bg-search': 'rgba(36, 38, 42, 0.72)', '--bg-search-focus': 'rgba(44, 46, 52, 0.85)', '--bg-window': '#0c0c0e', '--bg-toolbar': 'rgba(20, 21, 24, 0.92)', '--bg-tabbar': '#0e0f11',
        '--bg-sidebar': 'rgba(24, 26, 30, 0.72)', '--bg-vibrancy': 'rgba(36, 38, 44, 0.55)', '--bg-card': 'rgba(30, 32, 36, 0.72)',
        '--bg-muted': 'rgba(26, 28, 32, 0.85)', '--bg-panel': 'rgba(28, 30, 34, 0.78)',
        '--page-bg': 'radial-gradient(ellipse 80% 55% at 50% 88%, rgba(140, 150, 160, 0.14) 0%, transparent 65%), linear-gradient(180deg, #080809 0%, #111214 42%, #181a1e 100%)',
        '--text-primary': '#f4f4f5', '--text-secondary': '#d6d8dc', '--text-tertiary': '#adb1b8', '--text-link': '#a9c8ff',
        '--accent': '#5b6472', '--accent-soft': 'rgba(200, 210, 220, 0.14)', '--green': '#aab4c0', '--green-text': '#e4e8ee', '--green-soft': 'rgba(200, 210, 220, 0.14)'
      },
      web: { '--bg': '#111214', '--panel': '#181a1e', '--panel2': '#202328', '--border': '#30343a', '--text': '#f4f4f5', '--muted': '#adb1b8', '--accent': '#c3c9d2', '--accent-dim': '#2a2e34', '--disabled': '#868b93' },
      ext: { '--bg': '#111214', '--panel': 'rgba(26, 28, 32, 0.85)', '--panel-solid': '#181a1e', '--border': 'rgba(255, 255, 255, 0.14)', '--text': '#f4f4f5', '--muted': '#adb1b8', '--accent': '#aab4c0', '--btn': 'rgba(40, 43, 48, 0.8)', '--well': '#0e0f11' }
    },
    sand: {
      id: 'sand', zh: '暖沙', en: 'Warm sand', scheme: 'light', base: '#efe4d6',
      swatch: ['#f4ebe0', '#efe2d2', '#2e2116', '#b2501f', '#8a6f58'],
      desktop: Object.assign(lightCommon('58, 42, 28'), {
        '--bg-base': '#efe4d6',
        '--bg-solid': '#fbf6ef', '--bg-popover': 'rgba(252, 247, 240, 0.99)', '--bg-sheet': 'rgba(248, 241, 232, 0.98)', '--bg-shade': 'rgba(233, 219, 201, 0.55)', '--bg-well': '#fbf6ef', '--bg-raised': '#eadbc8', '--bg-search': 'rgba(255, 251, 245, 0.85)', '--bg-search-focus': 'rgba(255, 252, 248, 0.96)', '--bg-window': '#f4ebe0', '--bg-toolbar': 'rgba(246, 238, 228, 0.95)', '--bg-tabbar': '#e8dbc9',
        '--bg-sidebar': 'rgba(239, 226, 210, 0.82)', '--bg-vibrancy': 'rgba(255, 250, 243, 0.72)', '--bg-card': 'rgba(255, 251, 245, 0.88)',
        '--bg-muted': 'rgba(239, 226, 210, 0.92)', '--bg-panel': 'rgba(250, 243, 234, 0.94)', '--bg-segment-active': 'rgba(255, 252, 247, 0.98)',
        '--page-bg': 'radial-gradient(ellipse 80% 55% at 50% 88%, rgba(196, 92, 38, 0.10) 0%, transparent 65%), linear-gradient(180deg, #f8f1e8 0%, #f4ebe0 42%, #efe2d2 100%)',
        '--text-primary': '#2e2116', '--text-secondary': '#584330', '--text-tertiary': '#6f5643', '--text-link': '#9c4418',
        '--accent': '#b2501f', '--accent-soft': 'rgba(196, 92, 38, 0.14)', '--green': '#b2501f', '--green-text': '#8a3c12', '--green-soft': 'rgba(196, 92, 38, 0.14)',
        '--glow-blue': '#f0d9c0'
      }),
      web: { '--bg': '#f4ebe0', '--panel': '#efe2d2', '--panel2': '#fbf5ee', '--border': '#d9c6b0', '--text': '#2e2116', '--muted': '#6f5643', '--accent': '#b2501f', '--accent-dim': '#f1d9c6', '--danger': '#b3261e', '--disabled': '#b9a794' },
      ext: { '--bg': '#f4ebe0', '--panel': 'rgba(250, 243, 234, 0.92)', '--panel-solid': '#efe2d2', '--border': 'rgba(58, 42, 28, 0.2)', '--text': '#2e2116', '--muted': '#6f5643', '--accent': '#b2501f', '--btn': 'rgba(255, 251, 245, 0.95)', '--well': '#fbf5ee', '--danger': '#b3261e', '--on-accent': '#ffffff' }
    },
    paper: {
      id: 'paper', zh: '纸白', en: 'Paper', scheme: 'light', base: '#eef0f3',
      swatch: ['#f6f7f9', '#ffffff', '#17191c', '#2563eb', '#1d6b50'],
      desktop: Object.assign(lightCommon('0, 0, 0'), {
        '--bg-base': '#eef0f3',
        '--bg-solid': '#ffffff', '--bg-popover': 'rgba(255, 255, 255, 0.99)', '--bg-sheet': 'rgba(250, 251, 252, 0.98)', '--bg-shade': 'rgba(228, 231, 236, 0.55)', '--bg-well': '#ffffff', '--bg-raised': '#e4e7ec', '--bg-search': 'rgba(255, 255, 255, 0.88)', '--bg-search-focus': '#ffffff', '--bg-window': '#f6f7f9', '--bg-toolbar': 'rgba(248, 249, 250, 0.95)', '--bg-tabbar': '#e6e8ec',
        '--bg-sidebar': 'rgba(238, 240, 243, 0.86)', '--bg-vibrancy': 'rgba(255, 255, 255, 0.72)', '--bg-card': 'rgba(255, 255, 255, 0.92)',
        '--bg-muted': 'rgba(240, 242, 245, 0.95)', '--bg-panel': 'rgba(255, 255, 255, 0.94)', '--bg-segment-active': '#ffffff',
        '--page-bg': 'radial-gradient(ellipse 80% 55% at 50% 88%, rgba(37, 99, 235, 0.06) 0%, transparent 65%), linear-gradient(180deg, #fbfbfc 0%, #f6f7f9 42%, #eceef2 100%)',
        '--text-primary': '#17191c', '--text-secondary': '#3b4149', '--text-tertiary': '#585f69', '--text-link': '#1a5fd0',
        '--accent': '#2563eb', '--accent-soft': 'rgba(37, 99, 235, 0.12)', '--green': '#23805f', '--green-text': '#17664a', '--green-soft': 'rgba(35, 128, 95, 0.13)',
        '--glow-blue': '#dbe6fb'
      }),
      web: { '--bg': '#f6f7f9', '--panel': '#ffffff', '--panel2': '#eef0f3', '--border': '#d5d9df', '--text': '#17191c', '--muted': '#585f69', '--accent': '#23805f', '--accent-dim': '#d6eee4', '--danger': '#b3261e', '--disabled': '#a4aab2' },
      ext: { '--bg': '#f6f7f9', '--panel': 'rgba(255, 255, 255, 0.94)', '--panel-solid': '#ffffff', '--border': 'rgba(0, 0, 0, 0.16)', '--text': '#17191c', '--muted': '#585f69', '--accent': '#23805f', '--btn': '#ffffff', '--well': '#eef0f3', '--danger': '#b3261e', '--on-accent': '#ffffff' }
    }
  };
  // overlays / inputs / separators of a light palette are ink-tinted instead of white-tinted
  function lightCommon(ink) {
    const a = (x) => `rgba(${ink}, ${x})`;
    return {
      '--bg-input': a(0.06), '--bg-input-focus': a(0.09), '--bg-segment': a(0.07), '--bg-hover': a(0.08),
      '--separator': a(0.2), '--separator-light': a(0.11), '--scrim': a(0.28),
      '--danger': '#b3261e', '--success': '#23805f', '--warning': '#8a5a00',
      '--shadow-sm': `0 1px 2px ${a(0.12)}`, '--shadow-md': `0 8px 28px ${a(0.16)}`, '--shadow-window': `0 16px 48px ${a(0.18)}, 0 0 0 0.5px ${a(0.08)}`,
      '--pos-subj': '#c92a2a', '--pos-pred': '#1864ab', '--pos-obj': '#2b8a3e', '--pos-attr': '#862e9c', '--pos-adv': '#c2410c', '--pos-comp': '#0b7285',
      '--incog': '#5b45d6', '--incog-bg': 'rgba(91, 69, 214, 0.12)'
    };
  }
  const DARK = Object.keys(THEMES).filter(k => THEMES[k].scheme === 'dark');
  const LIGHT = Object.keys(THEMES).filter(k => THEMES[k].scheme === 'light');

  /** Normalise settings.appearance (fills defaults, migrates the pre-5.5 single `theme` field). */
  function normAppearance(a) {
    a = a && typeof a === 'object' ? a : {};
    let mode = MODES.includes(a.mode) ? a.mode : '';
    let dark = DARK.includes(a.theme) ? a.theme : 'aurora';
    let light = LIGHT.includes(a.light) ? a.light : 'sand';
    if (!mode) {
      // legacy: the palette picker was the only control; a light palette meant "light"
      if (LIGHT.includes(a.theme)) { mode = 'light'; light = a.theme; }
      else mode = 'dark';
    }
    return { mode, theme: dark, light };
  }
  /** Effective palette for a mode + the OS appearance. */
  function resolve(appearance, systemDark) {
    const a = normAppearance(appearance);
    const scheme = a.mode === 'system' ? (systemDark === false ? 'light' : 'dark') : a.mode;
    const id = scheme === 'light' ? a.light : a.theme;
    return { mode: a.mode, scheme, id, base: THEMES[id].base };
  }
  const decl = (o) => Object.keys(o).map(k => `${k}:${o[k]};`).join('');
  /** CSS text for a page. target: 'desktop' | 'web' | 'ext'. */
  function css(id, target) {
    const t = THEMES[id] || THEMES.aurora;
    return `:root:root{color-scheme:${t.scheme};${decl(t[target || 'desktop'] || {})}}`;
  }
  /** Apply to a document: sets data-theme / data-scheme on <html>, colour-scheme and the variable overrides. */
  function apply(doc, r, target) {
    if (!doc || !doc.documentElement) return;
    const h = doc.documentElement;
    // switch at once: no colour transitions while the palette changes (they also freeze in background tabs)
    if (h.dataset.theme && (h.dataset.theme !== r.id || h.dataset.scheme !== r.scheme)) {
      let ns = doc.getElementById('aib-theme-switch');
      if (!ns) { ns = doc.createElement('style'); ns.id = 'aib-theme-switch'; ns.textContent = '*,*::before,*::after{transition:none!important}'; (doc.head || h).appendChild(ns); }
      // Chromium starts a transition from the style of the last *rendered* frame. A background tab renders no frames,
      // so lifting the suppression there makes colours animate from the old palette (frozen half-way) once shown.
      // Keep it until the page is really on screen: its tab is activated, or the user points/types/scrolls in it, then two frames.
      const w = doc.defaultView; const seq = (apply._seq = (apply._seq || 0) + 1);
      const lift = () => { if (apply._seq !== seq) return; const x = doc.getElementById('aib-theme-switch'); if (x) x.remove(); };
      const later = () => { if (w && w.requestAnimationFrame) w.requestAnimationFrame(() => w.requestAnimationFrame(lift)); else setTimeout(lift, 120); };
      // 'aib-shown' is dispatched by the host page script when its tab/view is brought to the front.
      // Until then only transitions are off; colours themselves switch immediately.
      if (!w) lift();
      else {
        const evs = ['aib-shown', 'pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'];
        const on = () => { evs.forEach(e => w.removeEventListener(e, on, true)); later(); };
        evs.forEach(e => w.addEventListener(e, on, true));
      }
    }
    h.dataset.theme = r.id; h.dataset.scheme = r.scheme; h.dataset.themeMode = r.mode;
    h.style.colorScheme = r.scheme;
    let el = doc.getElementById('aib-theme-vars');
    if (!el) { el = doc.createElement('style'); el.id = 'aib-theme-vars'; (doc.head || h).appendChild(el); }
    else if (el.parentNode && el.parentNode.lastElementChild !== el) el.parentNode.appendChild(el); // stay last: wins over page CSS
    el.textContent = css(r.id, target);
    let m = doc.querySelector('meta[name="color-scheme"]');
    if (m) m.setAttribute('content', r.scheme);
    let tc = doc.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', r.base);
    // resolve styles now, while transitions are off (a background tab would otherwise animate when shown)
    try { void h.offsetHeight; } catch (e) {} // full style + layout flush
  }
  /** Browser helper: apply now and keep following the OS while mode = 'system'. Returns { set(appearance), current() }. */
  function follow(doc, appearance, target, onChange) {
    const w = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const mq = w && w.matchMedia ? w.matchMedia('(prefers-color-scheme: dark)') : null;
    let a = normAppearance(appearance); let cur = null;
    const run = () => {
      const r = resolve(a, mq ? mq.matches : true);
      const changed = !cur || cur.id !== r.id || cur.scheme !== r.scheme || cur.mode !== r.mode;
      cur = r; apply(doc, r, target);
      if (changed && onChange) { try { onChange(r); } catch (e) { console.error(e); } }
    };
    if (mq) { const h = () => run(); if (mq.addEventListener) mq.addEventListener('change', h); else if (mq.addListener) mq.addListener(h); }
    run();
    return { set(next) { a = normAppearance(next); run(); }, current: () => cur };
  }
  return { MODES, THEMES, DARK, LIGHT, normAppearance, resolve, css, apply, follow };
});
