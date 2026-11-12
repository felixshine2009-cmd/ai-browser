// i18n: all UI strings come from strings.json (zh/en). Pages call I18N.init() once.
(function () {
  const I18N = {
    lang: 'zh', strings: {}, listeners: [],
    t(key, vars) {
      let s = (this.strings[this.lang] && this.strings[this.lang][key]) ?? (this.strings.zh && this.strings.zh[key]) ?? key;
      if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
      return s;
    },
    apply(root) {
      root = root || document;
      root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.t(el.dataset.i18n); });
      root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = this.t(el.dataset.i18nTitle); });
      root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = this.t(el.dataset.i18nPlaceholder); });
      document.documentElement.lang = this.lang === 'en' ? 'en' : 'zh-CN';
    },
    onChange(fn) { this.listeners.push(fn); },
    setLang(l) { this.lang = l === 'en' ? 'en' : 'zh'; this.apply(); this.listeners.forEach(f => f(this.lang)); },
    // tell embedded frames (extension panels, dictionary entries) and page scripts about the palette
    themeChanged(r) {
      const T = window.AIBTheme; if (!T) return;
      const msg = { aibTheme: { id: r.id, scheme: r.scheme, mode: r.mode, css: T.css(r.id, 'ext') } };
      for (const f of document.querySelectorAll('iframe')) { try { f.contentWindow && f.contentWindow.postMessage(msg, '*'); } catch {} }
      try { window.dispatchEvent(new CustomEvent('aib-theme', { detail: r })); } catch {}
    },
    themeMessage() { const T = window.AIBTheme; const r = this.theme && this.theme.current(); return r && T ? { id: r.id, scheme: r.scheme, mode: r.mode, css: T.css(r.id, 'ext') } : null; },
    async init() {
      const res = await fetch('aibrowser://static/strings.json');
      this.strings = await res.json();
      const s = await window.aib.invoke('settings:get');
      this.lang = s.lang === 'en' ? 'en' : 'zh';
      // appearance: light / dark / follow system (theme.js). Applies at once on every settings change and OS change.
      const T = window.AIBTheme;
      // embedded frames ask for the palette when they load; frames that load later get it on their load event too
      window.addEventListener('message', (ev) => { const m = ev.data; if (m && m.aibThemeHello && ev.source) { const t = this.themeMessage(); if (t) try { ev.source.postMessage({ aibTheme: t }, '*'); } catch {} } });
      document.addEventListener('load', (ev) => { const f = ev.target; if (f && f.tagName === 'IFRAME') { const t = this.themeMessage(); if (t) try { f.contentWindow.postMessage({ aibTheme: t }, '*'); } catch {} } }, true);
      if (T) {
        this.theme = T.follow(document, s.appearance, 'desktop', (r) => I18N.themeChanged(r));
        window.aib.on('theme:changed', () => { this.theme.set(this.lastAppearance); });
        window.aib.on('tab:shown', () => { try { window.dispatchEvent(new Event('aib-shown')); } catch {} });
      }
      this.lastAppearance = s.appearance;
      this.apply();
      window.aib.on('settings:changed', (ns) => {
        if (ns.lang !== this.lang) this.setLang(ns.lang);
        this.lastAppearance = ns.appearance;
        if (this.theme) this.theme.set(ns.appearance);
      });
      return s;
    }
  };
  window.I18N = I18N;
  window.t = (k, v) => I18N.t(k, v);
})();
