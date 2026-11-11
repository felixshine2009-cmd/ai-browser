// Compact model switcher shown next to an input box (desktop pages and the web / iPad app share this file;
// web/js/model-picker.js is an exact copy). Grouped by provider, searchable, keyboard navigable.
// AIBModelPicker.mount(host, { load, select, onManage, lang, scopeNote }) -> { refresh, close, el, destroy }
//   load():  Promise<{ current:{provider,model,label}, groups:[{id,name,models:[{id,name,ctx,vision,reasoning}]}] }>
//   select(ref): Promise<any>  (ref = {provider, model})
(function (root) {
  'use strict';
  const STR = {
    zh: { search: '搜索模型', manage: '管理模型', empty: '尚未启用任何模型。请前往“设置 → AI 模型”，为服务商获取并启用模型。', noMatch: '未找到匹配的模型', vision: '视觉', reasoning: '思考', ctx: '上下文长度', current: '当前模型', choose: '选择模型', none: '未选择模型', loading: '正在加载…' },
    en: { search: 'Search models', manage: 'Manage models', empty: 'No models are enabled yet. Open Settings → AI models to fetch and enable models for a provider.', noMatch: 'No matching models', vision: 'Vision', reasoning: 'Thinking', ctx: 'Context length', current: 'Current model', choose: 'Choose model', none: 'No model selected', loading: 'Loading…' }
  };
  const CSS = `
.mp{position:relative;display:inline-flex;max-width:100%;vertical-align:middle;
  --_t:var(--mp-text,var(--text-primary,var(--text,#eef2f0)));--_m:var(--mp-muted,var(--text-tertiary,var(--muted,#9aa6a2)));
  --_b:var(--mp-border,var(--separator,var(--border,rgba(255,255,255,.16))));--_a:var(--mp-accent,var(--green,var(--accent,#5fb99a)));
  --_bg:var(--mp-bg,rgba(255,255,255,.06));--_h:var(--mp-hover,rgba(255,255,255,.08));--_p:var(--mp-pop,var(--panel,#141b1d))}
.mp .mp-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;max-width:100%;min-width:0;height:32px;padding:0 10px 0 11px;
  border-radius:999px;border:1px solid var(--_b);background:var(--_bg);color:var(--_t);font:inherit;font-size:13px;font-weight:500;line-height:1;cursor:default;
  transition:background var(--dur-fast,120ms) var(--ease,ease),border-color var(--dur-fast,120ms) var(--ease,ease)}
.mp .mp-btn:hover{background:var(--_h)}
.mp .mp-btn:focus-visible{outline:2px solid var(--_a);outline-offset:2px}
.mp .mp-btn[aria-expanded="true"]{border-color:var(--_a)}
.mp .mp-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:var(--_a)}
.mp .mp-prov{flex:0 1 auto;color:var(--_m);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:9em}
.mp .mp-sep{flex:0 0 auto;color:var(--_m);opacity:.6}
.mp .mp-name{flex:0 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.mp .mp-scope{flex:0 0 auto;font-size:11px;color:var(--_a);border:1px solid var(--_a);border-radius:999px;padding:2px 6px;line-height:1}
.mp .mp-chev{flex:0 0 auto;width:10px;height:10px;opacity:.75}
.mp-pop{position:fixed;z-index:2147483000;box-sizing:border-box;display:flex;flex-direction:column;width:min(380px,calc(100vw - 16px));max-height:min(440px,70vh);
  background:var(--_p);color:var(--_t);border:1px solid var(--_b);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.38);overflow:hidden;font-size:13px;font-weight:500;
  animation:mp-in var(--dur,160ms) var(--ease,ease)}
@keyframes mp-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.mp-pop{animation:none}.mp .mp-btn{transition:none}}
.mp-pop .mp-q{all:unset;box-sizing:border-box;display:block;margin:8px;padding:0 10px;height:34px;border-radius:8px;border:1px solid var(--_b);background:var(--_bg);color:var(--_t);font:inherit;font-size:13px;width:auto}
.mp-pop .mp-q::placeholder{color:var(--_m)}
.mp-pop .mp-q:focus{border-color:var(--_a)}
.mp-pop .mp-list{flex:1 1 auto;overflow:auto;padding:0 6px 6px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.mp-pop .mp-g{padding:10px 8px 4px;font-size:11.5px;font-weight:600;color:var(--_m);letter-spacing:.02em;position:sticky;top:0;background:var(--_p)}
.mp-pop .mp-it{display:flex;align-items:center;gap:8px;min-height:34px;padding:6px 8px;border-radius:7px;cursor:default}
.mp-pop .mp-it.on{background:var(--_h)}
.mp-pop .mp-it .mp-ck{flex:0 0 14px;color:var(--_a);font-weight:700;text-align:center}
.mp-pop .mp-it .mp-id{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-pop .mp-it .mp-id small{display:block;color:var(--_m);font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis}
.mp-pop .mp-chip{flex:0 0 auto;font-size:10.5px;line-height:1;padding:3px 6px;border-radius:999px;border:1px solid var(--_b);color:var(--_m);white-space:nowrap}
.mp-pop .mp-empty{padding:18px 14px;color:var(--_m);line-height:1.6}
.mp-pop .mp-foot{all:unset;box-sizing:border-box;display:block;border-top:1px solid var(--_b);padding:9px 14px;color:var(--_a);font:inherit;font-size:12.5px;font-weight:600;cursor:default;text-align:left}
.mp-pop .mp-foot:hover,.mp-pop .mp-foot:focus-visible{background:var(--_h)}
@media (pointer:coarse){.mp .mp-btn{height:40px;font-size:14px;padding:0 12px}.mp-pop .mp-it{min-height:44px}.mp-pop .mp-q{height:40px;font-size:16px}}
`;
  function injectCss() {
    if (document.getElementById('mp-style')) return;
    const st = document.createElement('style'); st.id = 'mp-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtCtx(v) {
    v = Number(v) || 0; if (!v) return '';
    if (v >= 1000000) return (v % 1000000 === 0 ? v / 1000000 : Math.round(v / 104857.6) / 10) + 'M';
    if (v >= 1000) return (v % 1000 === 0 ? v / 1000 : Math.round(v / 1024)) + 'K';
    return String(v);
  }
  const CHEV = '<svg class="mp-chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.8L5 6.6 8 3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let seq = 0;

  function mount(host, opts) {
    injectCss();
    opts = opts || {};
    const S = () => STR[(opts.lang && opts.lang()) === 'en' ? 'en' : 'zh'];
    const id = 'mp' + (++seq);
    const wrap = document.createElement('div'); wrap.className = 'mp';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mp-btn';
    btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    wrap.appendChild(btn); host.appendChild(wrap);
    let data = { current: null, groups: [] };
    let pop = null, flat = [], active = -1, q = '';
    function paintBtn() {
      const c = data.current || {};
      const g = (data.groups || []).find(x => x.id === c.provider);
      const prov = g ? g.name : (c.label ? String(c.label).split(' · ')[0] : '');
      const m = g && g.models.find(x => x.id === c.model);
      const name = (m && m.name) || c.model || '';
      const scope = opts.scopeNote && data.override ? `<span class="mp-scope">${esc(opts.scopeNote())}</span>` : '';
      btn.innerHTML = name
        ? `<span class="mp-dot" aria-hidden="true"></span>${prov ? `<span class="mp-prov">${esc(prov)}</span><span class="mp-sep" aria-hidden="true">/</span>` : ''}<span class="mp-name">${esc(name)}</span>${scope}${CHEV}`
        : `<span class="mp-dot" aria-hidden="true" style="opacity:.4"></span><span class="mp-name">${esc(S().none)}</span>${CHEV}`;
      btn.title = S().current + '：' + (name ? (prov ? prov + ' / ' : '') + name : S().none);
      btn.setAttribute('aria-label', S().choose + '，' + btn.title);
    }
    async function refresh() {
      try { data = (await opts.load()) || { current: null, groups: [] }; } catch { data = data || { current: null, groups: [] }; }
      paintBtn(); if (pop) renderList();
      return data;
    }
    function items() {
      const f = q.trim().toLowerCase(); const out = [];
      for (const g of data.groups || []) {
        const ms = g.models.filter(m => !f || (m.id + ' ' + (m.name || '') + ' ' + g.name).toLowerCase().includes(f));
        if (ms.length) out.push({ g, ms });
      }
      return out;
    }
    function renderList() {
      const list = pop.querySelector('.mp-list');
      const groups = items(); flat = [];
      const c = data.current || {};
      if (!groups.length) {
        list.innerHTML = `<div class="mp-empty">${esc((data.groups || []).length ? S().noMatch : S().empty)}</div>`;
        active = -1; return;
      }
      let html = '';
      for (const { g, ms } of groups) {
        html += `<div class="mp-g" role="presentation">${esc(g.name)}</div>`;
        for (const m of ms) {
          const i = flat.length; flat.push({ provider: g.id, model: m.id });
          const sel = c.provider === g.id && c.model === m.id;
          const chips = [m.vision ? `<span class="mp-chip">${esc(S().vision)}</span>` : '', m.reasoning ? `<span class="mp-chip">${esc(S().reasoning)}</span>` : '', m.ctx ? `<span class="mp-chip" title="${esc(S().ctx)}">${esc(fmtCtx(m.ctx))}</span>` : ''].join('');
          html += `<div class="mp-it" role="option" id="${id}-o${i}" data-i="${i}" aria-selected="${sel}"><span class="mp-ck" aria-hidden="true">${sel ? '✓' : ''}</span><span class="mp-id">${esc(m.name || m.id)}${m.name && m.name !== m.id ? `<small>${esc(m.id)}</small>` : ''}</span>${chips}</div>`;
        }
      }
      list.innerHTML = html;
      if (active < 0 || active >= flat.length) active = Math.max(0, flat.findIndex(x => x.provider === c.provider && x.model === c.model));
      setActive(active, true);
    }
    function setActive(i, scroll) {
      if (!pop) return;
      pop.querySelectorAll('.mp-it.on').forEach(e => e.classList.remove('on'));
      active = i;
      const el = pop.querySelector(`[data-i="${i}"]`);
      if (el) { el.classList.add('on'); pop.querySelector('.mp-q').setAttribute('aria-activedescendant', el.id); if (scroll) el.scrollIntoView({ block: 'nearest' }); }
    }
    function place() {
      if (!pop) return;
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.min(380, vw - 16);
      let left = Math.min(Math.max(8, r.left), vw - w - 8);
      const below = vh - r.bottom - 8, above = r.top - 8;
      const h = Math.min(440, Math.round(vh * 0.7));
      pop.style.left = left + 'px'; pop.style.width = w + 'px';
      if (below >= Math.min(h, 260) || below >= above) { pop.style.top = (r.bottom + 6) + 'px'; pop.style.bottom = 'auto'; pop.style.maxHeight = Math.max(160, Math.min(h, below - 6)) + 'px'; }
      else { pop.style.bottom = (vh - r.top + 6) + 'px'; pop.style.top = 'auto'; pop.style.maxHeight = Math.max(160, Math.min(h, above - 6)) + 'px'; }
    }
    function open() {
      if (pop) return;
      q = ''; active = -1;
      pop = document.createElement('div'); pop.className = 'mp-pop';
      // the popup lives on <body> so parent overflow never clips it; it copies the switcher's custom properties
      const cs = getComputedStyle(wrap);
      for (const v of ['--_t', '--_m', '--_b', '--_a', '--_bg', '--_h', '--_p']) pop.style.setProperty(v, cs.getPropertyValue(v));
      pop.innerHTML = `<input class="mp-q" type="text" role="combobox" aria-expanded="true" aria-controls="${id}-l" aria-autocomplete="list" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${esc(S().search)}" aria-label="${esc(S().search)}"><div class="mp-list" role="listbox" id="${id}-l" aria-label="${esc(S().choose)}"></div>${opts.onManage ? `<button type="button" class="mp-foot">${esc(S().manage)}</button>` : ''}`;
      document.body.appendChild(pop);
      btn.setAttribute('aria-expanded', 'true');
      renderList(); place();
      const input = pop.querySelector('.mp-q');
      input.addEventListener('input', () => { q = input.value; active = 0; renderList(); });
      input.addEventListener('keydown', onKey);
      pop.addEventListener('mousedown', (e) => { if (e.target !== input) e.preventDefault(); });
      pop.addEventListener('click', (e) => {
        const it = e.target.closest('.mp-it'); if (it) { choose(Number(it.dataset.i)); return; }
        if (e.target.closest('.mp-foot')) { close(); opts.onManage && opts.onManage(); }
      });
      pop.addEventListener('mousemove', (e) => { const it = e.target.closest('.mp-it'); if (it && Number(it.dataset.i) !== active) setActive(Number(it.dataset.i), false); });
      setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('touchstart', outside, true); }, 0);
      window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
      // touch devices: do not pop the on-screen keyboard over the list
      if (!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches)) input.focus();
      refresh();
    }
    function close(focusBtn) {
      if (!pop) return;
      pop.remove(); pop = null; flat = [];
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', outside, true); document.removeEventListener('touchstart', outside, true);
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      if (focusBtn) btn.focus();
    }
    function outside(e) { if (pop && !pop.contains(e.target) && !wrap.contains(e.target)) close(); }
    function onKey(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) setActive((active + 1) % flat.length, true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) setActive((active - 1 + flat.length) % flat.length, true); }
      else if (e.key === 'Home' && flat.length) { e.preventDefault(); setActive(0, true); }
      else if (e.key === 'End' && flat.length) { e.preventDefault(); setActive(flat.length - 1, true); }
      else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && flat[active]) choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close();
    }
    async function choose(i) {
      const ref = flat[i]; if (!ref) return;
      close(true);
      data.current = Object.assign({}, data.current || {}, ref); paintBtn();
      try { const r = await opts.select(ref); if (r && r.current) { data = r; paintBtn(); } else await refresh(); } catch { await refresh(); }
    }
    btn.addEventListener('click', () => (pop ? close() : open()));
    btn.addEventListener('keydown', (e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !pop) { e.preventDefault(); open(); } });
    paintBtn();
    refresh();
    return { el: wrap, refresh, close, open, destroy() { close(); wrap.remove(); }, get data() { return data; } };
  }
  root.AIBModelPicker = { mount, fmtCtx };
})(typeof window !== 'undefined' ? window : globalThis);
