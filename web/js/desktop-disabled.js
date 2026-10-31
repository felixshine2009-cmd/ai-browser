import { t } from './i18n.js';
export function toast(msg){ const el=document.getElementById('toast'); if(!el) return; el.textContent=msg; el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'),2200); }
export function wireDesktopOnly(root=document){
  root.querySelectorAll('[data-desktop-only]').forEach(el=>{
    el.classList.add('disabled');
    el.setAttribute('aria-disabled','true');
    el.addEventListener('click', ev=>{ ev.preventDefault(); ev.stopPropagation(); toast(t('deskOnly')); }, true);
  });
}
