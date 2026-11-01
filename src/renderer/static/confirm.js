// Shared confirmation modal (v3.3.0). Dark style, bilingual, default focus on Cancel, Esc / outside-click cancel.
//   AIBConfirm.ask({title, message, detail, confirmText, cancelText, danger}) -> Promise<boolean>
//   AIBConfirm.done(text)  prominent success banner ("已清除 N 条")
// Agent-initiated requests (main -> 'confirm:request') are shown through the very same dialog.
(function () {
  if (window.AIBConfirm) return;
  const tt = (k, d) => (window.t ? window.t(k) : d);
  const L = () => (window.I18N && I18N.lang === 'en') ? 'en' : 'zh';
  const css = `
  .aibc-ov{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)}
  .aibc-box{width:min(440px,92vw);background:#161b1d;border:1px solid rgba(255,255,255,.16);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.6);padding:20px 22px;color:#f7f7f9;font:14px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
  .aibc-box h3{margin:0 0 8px;font-size:16px;color:#ff8a8a}
  .aibc-box .m{white-space:pre-wrap;color:#e6e8ec}.aibc-box .d{margin-top:8px;color:#a9adb6;font-size:12.5px;white-space:pre-wrap}
  .aibc-btns{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}
  .aibc-btns button{border-radius:8px;padding:8px 16px;font-size:13.5px;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#f7f7f9}
  .aibc-btns button:focus{outline:2px solid #6cb6ff;outline-offset:2px}
  .aibc-btns .danger{background:#d93b3b;border-color:#d93b3b;color:#fff;font-weight:600}
  .aibc-btns .ok{background:#3b82f6;border-color:#3b82f6;color:#fff}
  .aibc-done{position:fixed;top:22px;left:50%;transform:translateX(-50%);z-index:100000;background:#1f7a57;color:#fff;font-size:17px;font-weight:600;padding:12px 26px;border-radius:12px;box-shadow:0 10px 36px rgba(0,0,0,.5);transition:opacity .4s}`;
  function style() { if (document.getElementById('aibc-css')) return; const s = document.createElement('style'); s.id = 'aibc-css'; s.textContent = css; document.head.appendChild(s); }
  function ask(o) {
    style(); o = o || {};
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'aibc-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.id = 'aibc';
      const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const danger = o.danger !== false;
      ov.innerHTML = `<div class="aibc-box"><h3>${esc(o.title || tt('confirm.title', '请确认'))}</h3><div class="m">${esc(o.message || '')}</div>${o.detail ? `<div class="d">${esc(o.detail)}</div>` : ''}<div class="aibc-btns"><button id="aibc-cancel">${esc(o.cancelText || tt('confirm.cancel', '取消'))}</button><button id="aibc-ok" class="${danger ? 'danger' : 'ok'}">${esc(o.confirmText || tt('confirm.ok', '确认清除'))}</button></div></div>`;
      let fin = false;
      const close = (v) => { if (fin) return; fin = true; document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); } else if (e.key === 'Tab') { const a = ov.querySelector('#aibc-cancel'), b = ov.querySelector('#aibc-ok'); e.preventDefault(); (document.activeElement === a ? b : a).focus(); } };
      document.addEventListener('keydown', onKey, true);
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(false); });
      document.body.appendChild(ov);
      ov.querySelector('#aibc-ok').onclick = () => close(true);
      ov.querySelector('#aibc-cancel').onclick = () => close(false);
      ov.querySelector('#aibc-cancel').focus(); // default focus = Cancel
    });
  }
  function done(text) {
    style(); const old = document.getElementById('aibc-done'); if (old) old.remove(); const d = document.createElement('div'); d.className = 'aibc-done'; d.id = 'aibc-done'; d.textContent = text; document.body.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 450); }, 3200);
  }
  window.AIBConfirm = { ask, done };
  // main-process (agent tool) requests
  const seen = new Set();
  async function handle(req) {
    if (!req || seen.has(req.id)) return; seen.add(req.id);
    const lang = L();
    const ok = await ask({ title: req.title && req.title[lang] || req.title, message: req.message && req.message[lang] || req.message, detail: (req.detail && req.detail[lang]) || req.detail, confirmText: req.confirmText && req.confirmText[lang] || req.confirmText, danger: req.danger });
    await window.aib.invoke('confirm:answer', req.id, ok);
  }
  if (window.aib && window.aib.on) {
    window.aib.on('confirm:request', handle);
    window.aib.on('confirm:cancel', (id) => { const o = document.getElementById('aibc'); if (o) o.querySelector('#aibc-cancel').click(); });
    window.addEventListener('DOMContentLoaded', () => window.aib.invoke('confirm:pending').then(a => (a || []).forEach(handle)).catch(() => {}));
    if (document.readyState !== 'loading') window.aib.invoke('confirm:pending').then(a => (a || []).forEach(handle)).catch(() => {});
  }
})();
