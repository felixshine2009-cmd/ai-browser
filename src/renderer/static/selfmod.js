(async function () {
  await I18N.init();
  const root = document.getElementById('root');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function render() {
    const pending = await window.aib.invoke('selfmod:pending');
    const hist = await window.aib.invoke('selfmod:history');
    const st = await window.aib.invoke('selfmod:state');
    let html = `<h1>${esc(t('selfmod.title'))}</h1><p class="sub">${esc(t('selfmod.sub'))}</p>`;
    if (st.safeMode) html += `<div class="banner">${esc(t('selfmod.safeOn'))} <button class="btn-secondary" id="disSafe">${esc(t('selfmod.safeOff'))}</button></div>`;
    else html += `<div class="banner ok">${esc(t('selfmod.safeOffHint'))} <button class="btn-ghost" id="enSafe">${esc(t('selfmod.safeEnable'))}</button></div>`;

    if (pending && pending.files) {
      html += `<h2>${esc(t('selfmod.pending'))}: ${esc(pending.title||pending.id)}</h2>`;
      html += `<p class="sub">${esc(pending.description||'')}</p>`;
      html += pending.files.map(f => `<div class="file"><div><b>${esc(f.path)}</b> · ${esc(f.action)}</div><pre class="diff">${esc(f.diff)}</pre></div>`).join('');
      html += `<div class="actions"><button class="btn-primary" id="approve">${esc(t('selfmod.approve'))}</button><button class="btn-secondary" id="reject">${esc(t('selfmod.reject'))}</button></div>`;
    } else {
      html += `<p class="sub">${esc(t('selfmod.none'))}</p>`;
    }

    html += `<h2>${esc(t('selfmod.history'))}</h2><ul class="hist">`;
    html += (hist||[]).map(h => `<li><span class="tag ${esc(h.status)}">${esc(h.status)}</span><span>${esc(h.title||h.id)}</span><span class="sub">${esc((h.files||[]).join(', '))}</span>${h.status==='applied'?`<button class="btn-ghost rb" data-id="${esc(h.id)}">${esc(t('selfmod.rollback'))}</button>`:''}</li>`).join('') || `<li class="sub">${esc(t('selfmod.histEmpty'))}</li>`;
    html += `</ul>`;
    root.innerHTML = html;

    const approve = document.getElementById('approve');
    if (approve) approve.onclick = async () => {
      if (!confirm(t('selfmod.confirmApply'))) return;
      try { await window.aib.invoke('selfmod:apply', pending.id); toast(t('selfmod.applied')); render(); }
      catch (e) { alert(e.message||e); }
    };
    const reject = document.getElementById('reject');
    if (reject) reject.onclick = async () => { await window.aib.invoke('selfmod:reject', pending.id); render(); };
    document.querySelectorAll('.rb').forEach(b => b.onclick = async () => {
      if (!confirm(t('selfmod.confirmRollback'))) return;
      await window.aib.invoke('selfmod:rollback', b.dataset.id); render();
    });
    const en = document.getElementById('enSafe'); if (en) en.onclick = async () => { await window.aib.invoke('selfmod:setSafeMode', true); render(); };
    const dis = document.getElementById('disSafe'); if (dis) dis.onclick = async () => { await window.aib.invoke('selfmod:setSafeMode', false); render(); };
  }
  function toast(m){ /* reuse nothing; alert light */ const d=document.createElement('div'); d.className='banner ok'; d.textContent=m; root.prepend(d); setTimeout(()=>d.remove(),2500); }
  window.aib.on('selfmod:changed', () => render());
  render();
})();
