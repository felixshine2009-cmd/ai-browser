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
    async init() {
      const res = await fetch('aibrowser://static/strings.json');
      this.strings = await res.json();
      const s = await window.aib.invoke('settings:get');
      this.lang = s.lang === 'en' ? 'en' : 'zh';
      this.apply();
      window.aib.on('settings:changed', (ns) => { if (ns.lang !== this.lang) this.setLang(ns.lang); });
      return s;
    }
  };
  window.I18N = I18N;
  window.t = (k, v) => I18N.t(k, v);
})();
