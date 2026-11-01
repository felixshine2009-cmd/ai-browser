// Shared confirmation modal (web). Dark style, bilingual, default focus on Cancel, Esc / outside-click cancel.
import { getLang } from './i18n.js';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const L = (zh, en) => (getLang() === 'zh' ? zh : en);
export function confirmDialog(o = {}) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'cf-ov'; ov.id = 'cfDialog'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    const danger = o.danger !== false;
    ov.innerHTML = `<div class="cf-box"><h3>${esc(o.title || L('请确认', 'Please confirm'))}</h3><div class="cf-m">${esc(o.message || '')}</div>${o.detail ? `<div class="cf-d">${esc(o.detail)}</div>` : ''}<div class="cf-btns"><button type="button" id="cfCancel">${esc(o.cancelText || L('取消', 'Cancel'))}</button><button type="button" id="cfOk" class="${danger ? 'danger' : 'ok'}">${esc(o.confirmText || L('确认清除', 'Confirm clear'))}</button></div></div>`;
    let fin = false;
    const close = (v) => { if (fin) return; fin = true; document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); } else if (e.key === 'Tab') { e.preventDefault(); const a = ov.querySelector('#cfCancel'), b = ov.querySelector('#cfOk'); (document.activeElement === a ? b : a).focus(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(false); });
    document.body.appendChild(ov);
    ov.querySelector('#cfOk').onclick = () => close(true);
    ov.querySelector('#cfCancel').onclick = () => close(false);
    ov.querySelector('#cfCancel').focus();
  });
}
export function doneBanner(text) {
  const old = document.getElementById('cfDone'); if (old) old.remove();
  const d = document.createElement('div'); d.className = 'cf-done'; d.id = 'cfDone'; d.textContent = text; document.body.appendChild(d);
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 450); }, 3200);
}
