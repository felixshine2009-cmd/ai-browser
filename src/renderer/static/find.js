(async function () {
  await I18N.init();
  const root = document.getElementById('root');
  root.innerHTML = `<div class="find-bar"><input id="fq" autocomplete="off" spellcheck="false"/><span class="cnt" id="cnt"></span><button id="fp" title="↑">↑</button><button id="fn" title="↓">↓</button><button id="fx">✕</button></div>`;
  const q = document.getElementById('fq'), cnt = document.getElementById('cnt');
  q.placeholder = t('find.placeholder');
  q.focus();
  const run = (forward, next) => window.aib.invoke('find:query', q.value, forward, next);
  q.addEventListener('input', () => { run(true, false); if (!q.value) cnt.textContent = ''; });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(!e.shiftKey, true); else if (e.key === 'Escape') window.aib.invoke('find:close'); });
  document.getElementById('fn').onclick = () => run(true, true);
  document.getElementById('fp').onclick = () => run(false, true);
  document.getElementById('fx').onclick = () => window.aib.invoke('find:close');
  window.aib.on('find:result', (r) => { cnt.textContent = r.matches ? `${r.active}/${r.matches}` : t('find.none'); });
  window.aib.on('find:focus', () => { q.focus(); q.select(); });
})();
