'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['vm:state', 'tabs:state', 'settings:changed', 'chat:event', 'panel:call', 'downloads:changed', 'history:changed',
  'bookmarks:changed', 'ext:changed', 'lm:progress', 'find:result', 'find:focus', 'addr:focus', 'overlay:leave', 'vkeyboard:cmd', 'selfmod:changed', 'confirm:request', 'confirm:cancel', 'solve:photo', 'wiki:progress']);

if (location.protocol === 'aibrowser:') {
  // Internal pages only: privileged bridge (main re-checks sender URL on every call).
  contextBridge.exposeInMainWorld('aib', {
    invoke: (channel, ...args) => {
      if (!/^[a-z]+:[A-Za-z]+$/.test(channel)) return Promise.reject(new Error('bad channel'));
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel, cb) => {
      if (!EVENTS.has(channel)) return () => {};
      const h = (e, payload) => cb(payload);
      ipcRenderer.on(channel, h);
      return () => ipcRenderer.removeListener(channel, h);
    },
    platform: process.platform
  });
} else if (/^https?:$/.test(location.protocol)) {
  // Ordinary web pages: selection lookup trigger only. No API is exposed to the page.
  let timer = null;
  const WORD = /^[A-Za-z][A-Za-z'’-]{1,40}$/;
  function report() {
    try {
      const sel = window.getSelection();
      const text = (sel && sel.toString() || '').trim();
      if (!text || text.length > 500 || !sel.rangeCount) return;
      const kind = WORD.test(text) ? 'word' : ((text.split(/\s+/).length >= 2 || /[。！？!?，,;；]/.test(text)) ? 'sentence' : '');
      if (!kind) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      ipcRenderer.send('sel:lookup', { text, kind, x: r.left, y: r.bottom });
    } catch {}
  }
  window.addEventListener('dblclick', () => { clearTimeout(timer); timer = setTimeout(report, 30); }, true);
  window.addEventListener('mouseup', (e) => {
    if (e.detail > 1) return; // dblclick handled above
    clearTimeout(timer); timer = setTimeout(report, 220);
  }, true);

  // ---------------- password manager content script (isolated world; the page gets NO API from this)
  (function passwords() {
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const setVal = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const userFieldFor = (pw) => {
      const scope = pw.form || document; const all = Array.from(scope.querySelectorAll('input')).filter(i => /^(text|email|tel|)$/i.test(i.type || '') && visible(i));
      let best = null; for (const i of all) { if (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) best = i; } return best;
    };
    const filled = new WeakSet(); let asking = false;
    async function fill(pw) {
      if (filled.has(pw) || asking) return; asking = true;
      try {
        const creds = await ipcRenderer.invoke('pw:creds');
        if (!creds || !creds.length) { filled.add(pw); return; }
        if (creds.length === 1) await apply(pw, creds[0].id); else picker(pw, creds);
        filled.add(pw);
      } catch {} finally { asking = false; }
    }
    async function apply(pw, id) {
      const c = await ipcRenderer.invoke('pw:fill', id); if (!c) return;
      const u = userFieldFor(pw); if (pw.value) return; /* never overwrite what the user is typing */ if (u && c.username && !u.value) setVal(u, c.username); setVal(pw, c.password);
    }
    function ui() {
      let host = document.getElementById('__aib_pw_host');
      if (host) return host.__root;
      host = document.createElement('div'); host.id = '__aib_pw_host'; host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:12px;right:12px';
      const root = host.attachShadow({ mode: 'closed' }); host.__root = root;
      root.innerHTML = '<style>.c{font:14px/1.4 -apple-system,"PingFang SC",sans-serif;background:#141b1d;color:#f7f7f9;border:1px solid rgba(255,255,255,.3);border-radius:12px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.5);width:300px;animation:i .18s ease}@keyframes i{from{opacity:0;transform:translateY(-6px)}}b{font-weight:700;display:block;margin-bottom:2px}.s{color:#d0d3d9;font-weight:600;margin-bottom:10px;word-break:break-all}.r{display:flex;gap:8px;justify-content:flex-end}button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:6px 12px;cursor:pointer;background:#2a3336;color:#f7f7f9}button.p{background:#1f8f6a;color:#fff}button:hover{filter:brightness(1.15)}.x{position:absolute;top:6px;right:8px;background:none;font-size:18px;padding:0 6px}.u{display:block;width:100%;text-align:left;margin-top:6px}</style><div class="c"></div>';
      (document.documentElement).appendChild(host); return root;
    }
    const close = () => { const h = document.getElementById('__aib_pw_host'); if (h) h.remove(); };
    function picker(pw, creds) {
      const root = ui(); const c = root.querySelector('.c'); c.innerHTML = '<button class="x" id="x">×</button>';
      for (const cr of creds) { const b = document.createElement('button'); b.className = 'u'; b.textContent = cr.username || '(no username)'; b.onclick = async () => { await apply(pw, cr.id); close(); }; c.appendChild(b); }
      c.querySelector('#x').onclick = close;
    }
    ipcRenderer.on('pw:prompt', (e, p) => {
      const zh = p.lang !== 'en'; const root = ui(); const c = root.querySelector('.c');
      const title = p.kind === 'update' ? (zh ? '更新已保存的密码？' : 'Update saved password?') : (zh ? '保存密码？' : 'Save password?');
      c.innerHTML = '<button class="x" id="x">×</button><b></b><div class="s"></div><div class="r"><button id="n"></button><button class="p" id="y"></button></div>';
      c.querySelector('b').textContent = title; c.querySelector('.s').textContent = (p.username || (zh ? '（无用户名）' : '(no username)')) + ' · ' + p.host;
      c.querySelector('#n').textContent = zh ? '从不' : 'Never'; c.querySelector('#y').textContent = p.kind === 'update' ? (zh ? '更新' : 'Update') : (zh ? '保存' : 'Save');
      const answer = (action) => { ipcRenderer.send('pw:answer', { action }); close(); };
      c.querySelector('#y').onclick = () => answer('save'); c.querySelector('#n').onclick = () => answer('never'); c.querySelector('#x').onclick = () => answer('dismiss');
    });
    let lastSent = 0;
    function capture(scope) {
      const pws = Array.from((scope && scope.querySelectorAll ? scope : document).querySelectorAll('input[type=password]')).filter(i => i.value);
      if (!pws.length) return; const pw = pws[pws.length - 1];
      const u = userFieldFor(pw); const now = Date.now(); if (now - lastSent < 800) return; lastSent = now;
      ipcRenderer.send('pw:submit', { username: u ? u.value : '', password: pw.value, url: location.href });
    }
    document.addEventListener('submit', (e) => capture(e.target), true);
    document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button,input[type=submit],input[type=button],[role=button]'); if (!b) return; const f = b.form || b.closest('form') || document; if (f.querySelector && f.querySelector('input[type=password]')) setTimeout(() => capture(f), 0); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.type === 'password') capture(e.target.form || document); }, true);
    window.addEventListener('pagehide', () => capture(document), true);
    const onFocus = (e) => { const t = e.target; if (t && t.tagName === 'INPUT') { if (t.type === 'password') fill(t); else { const pw = (t.form || document).querySelector('input[type=password]'); if (pw && visible(pw)) fill(pw); } } };
    document.addEventListener('focusin', onFocus, true); document.addEventListener('click', onFocus, true);
    document.addEventListener('DOMContentLoaded', () => { ipcRenderer.send('pw:ready'); }, { once: true });
  })();
}
