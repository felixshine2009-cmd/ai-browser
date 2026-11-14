// v3.0.0 answer blocks: turns the special fenced blocks of the answer format into live widgets.
//   ```graph  GeoGebra commands, one per line   → drawn in the GeoGebra tool view (automatically for a live answer)
//   ```chem   chemical equations, one per line  → typeset with mhchem, each checked for atom and charge balance
//   ```word   English words (lines or commas)   → dictionary cards (phonetic, meaning); a click opens the full entry
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const zh = () => !(window.I18N && I18N.lang === 'en');

  // ------------------------------------------------------------ chemistry: formula parsing and balance check
  const ARROW = /\s*(<=>|<->|⇌|<-->|-->|->|→|⟶|==|=)(\[[^\]]*\])*\s*/;
  function parseFormula(f) {
    // returns { atoms: {El: n}, charge }
    let s = String(f).replace(/\((s|l|g|aq)\)\s*$/i, '').replace(/\s*[↑↓]\s*$/, '').replace(/\s+v$|\s+\^$/, '').trim();
    let charge = 0;
    // mhchem notation: Cu^2+ / SO4^{2-} carry a charge number; without a caret the digits are a subscript (NO3- → NO₃⁻)
    const cm = s.match(/\^\{?(\d*)([+-])\}?$/) || s.match(/()([+-])$/);
    if (cm && /[A-Za-z)\]\d}]/.test(s.slice(0, cm.index).slice(-1) || '')) { charge = (cm[1] ? Number(cm[1]) : 1) * (cm[2] === '+' ? 1 : -1); s = s.slice(0, cm.index); }
    const parts = s.split(/[·*•.](?=\d*[A-Z(])/);
    const atoms = {};
    for (const part of parts) {
      const mm = part.match(/^(\d+)(.*)$/); const mult = mm ? Number(mm[1]) : 1; const body = mm ? mm[2] : part;
      const a = parseGroup(body); if (!a) return null;
      for (const [k, v] of Object.entries(a)) atoms[k] = (atoms[k] || 0) + v * mult;
    }
    return { atoms, charge };
  }
  function parseGroup(s) {
    const stack = [{}]; let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '(' || ch === '[' || ch === '{') { stack.push({}); i++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') {
        i++; let n = ''; while (i < s.length && /\d/.test(s[i])) n += s[i++];
        const top = stack.pop(); if (!stack.length) return null;
        for (const [k, v] of Object.entries(top)) stack[stack.length - 1][k] = (stack[stack.length - 1][k] || 0) + v * (n ? Number(n) : 1);
        continue;
      }
      const m = s.slice(i).match(/^([A-Z][a-z]?)(\d*)/);
      if (m) { const t = stack[stack.length - 1]; t[m[1]] = (t[m[1]] || 0) + (m[2] ? Number(m[2]) : 1); i += m[0].length; continue; }
      if (/\s|_/.test(ch)) { i++; continue; }
      return null;
    }
    return stack.length === 1 ? stack[0] : null;
  }
  function sideTotals(side) {
    const tot = { atoms: {}, charge: 0 };
    for (let term of side.split(/\s\+\s/)) {
      term = term.trim(); if (!term) continue;
      const em = term.match(/^(\d*)\s*e\^?\{?-\}?$/); if (em) { tot.charge -= em[1] ? Number(em[1]) : 1; continue; }
      const m = term.match(/^(\d+(?:\/\d+)?|\d*\.\d+)\s*(.*)$/);
      let coef = 1, f = term;
      if (m && /^[A-Z(\[]/.test(m[2])) { coef = m[1].includes('/') ? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1]) : Number(m[1]); f = m[2]; }
      const p = parseFormula(f); if (!p) return null;
      for (const [k, v] of Object.entries(p.atoms)) tot.atoms[k] = (tot.atoms[k] || 0) + v * coef;
      tot.charge += p.charge * coef;
    }
    return tot;
  }
  function checkEquation(line) {
    const m = line.split(ARROW);
    if (m.length < 4) return { ok: null };
    const left = sideTotals(m[0]), right = sideTotals(m.slice(3).join(' '));
    if (!left || !right) return { ok: null };
    const els = Array.from(new Set(Object.keys(left.atoms).concat(Object.keys(right.atoms))));
    const diff = els.filter(e => Math.abs((left.atoms[e] || 0) - (right.atoms[e] || 0)) > 1e-9).map(e => ({ el: e, left: left.atoms[e] || 0, right: right.atoms[e] || 0 }));
    const chargeOk = Math.abs(left.charge - right.charge) < 1e-9;
    return { ok: !diff.length && chargeOk, diff, charge: chargeOk ? null : { left: left.charge, right: right.charge } };
  }
  function renderChem(block) {
    const lines = block.dataset.src.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 30);
    const wrap = document.createElement('div'); wrap.className = 'ab-chem';
    for (const line of lines) {
      const row = document.createElement('div'); row.className = 'ab-chem-row';
      const eq = document.createElement('div'); eq.className = 'ab-chem-eq';
      if (window.katex) { try { eq.innerHTML = katex.renderToString('\\ce{' + line + '}', { displayMode: true, throwOnError: false, strict: 'ignore' }); } catch { eq.textContent = line; } } else eq.textContent = line;
      const r = checkEquation(line);
      const st = document.createElement('span'); st.className = 'ab-chem-check';
      if (r.ok === true) { st.dataset.state = 'ok'; st.textContent = zh() ? '✓ 已配平' : '✓ Balanced'; }
      else if (r.ok === false) {
        st.dataset.state = 'bad';
        const parts = r.diff.map(d => `${d.el} ${d.left}≠${d.right}`); if (r.charge) parts.push((zh() ? '电荷 ' : 'charge ') + `${r.charge.left}≠${r.charge.right}`);
        st.textContent = (zh() ? '✗ 未配平：' : '✗ Not balanced: ') + parts.join('，');
      } else st.hidden = true;
      row.appendChild(eq); row.appendChild(st); wrap.appendChild(row);
    }
    block.innerHTML = ''; block.appendChild(wrap);
  }

  // ------------------------------------------------------------ GeoGebra
  function graphCommands(src) { return src.split('\n').map(s => s.replace(/^\s*\d+[.)]\s+/, '').replace(/;\s*$/, '').trim()).filter(s => s && !/^(#|\/\/)/.test(s)).slice(0, 80); }
  function renderGraph(block, live) {
    const cmds = graphCommands(block.dataset.src);
    block.innerHTML = '<div class="ab-graph"><div class="ab-graph-head"><b></b><span class="ab-graph-state"></span><button type="button" class="chip ab-graph-run"></button></div><pre class="ab-graph-src"></pre></div>';
    block.querySelector('b').textContent = zh() ? `GeoGebra 作图 · ${cmds.length} 条命令` : `GeoGebra · ${cmds.length} command(s)`;
    block.querySelector('.ab-graph-src').textContent = cmds.join('\n');
    const btn = block.querySelector('.ab-graph-run'), stEl = block.querySelector('.ab-graph-state');
    btn.textContent = zh() ? '在 GeoGebra 中作图' : 'Draw in GeoGebra';
    const run = async () => {
      btn.disabled = true; block.dataset.state = 'run'; stEl.textContent = zh() ? '正在作图…' : 'Drawing…';
      try {
        const r = await window.aib.invoke('answer:block', 'graph', { commands: cmds });
        const res = (r && r.results) || [];
        const bad = res.filter(x => x && x.ok === false).length;
        block.dataset.state = r && r.error ? 'error' : (bad ? 'partial' : 'ok');
        stEl.textContent = r && r.error ? (zh() ? '作图失败：' : 'Failed: ') + r.error : bad ? (zh() ? `${res.length - bad} 条成功，${bad} 条失败` : `${bad} failed`) : (zh() ? '已作图' : 'Drawn');
      } catch (e) { block.dataset.state = 'error'; stEl.textContent = (zh() ? '作图失败：' : 'Failed: ') + (e && e.message || e); }
      btn.disabled = false; btn.textContent = zh() ? '重新作图' : 'Draw again';
    };
    btn.onclick = run;
    if (live && cmds.length) run();
  }

  // ------------------------------------------------------------ dictionary words
  function renderWords(block) {
    const words = Array.from(new Set(block.dataset.src.split(/[\n,，;；]+/).map(s => s.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim()).filter(w => /^[A-Za-z][A-Za-z' -]{0,40}$/.test(w)))).slice(0, 16);
    const wrap = document.createElement('div'); wrap.className = 'ab-words';
    block.innerHTML = ''; block.appendChild(wrap);
    words.forEach((w) => {
      const c = document.createElement('div'); c.setAttribute('role', 'button'); c.tabIndex = 0; c.className = 'ab-word';
      c.innerHTML = `<span class="ab-w">${esc(w)}</span><span class="ab-ph"></span><span class="ab-mean">${zh() ? '正在查询…' : 'Looking up…'}</span>`;
      c.onclick = () => { const r = c.getBoundingClientRect(); window.aib.invoke('lookup:show', w, { x: Math.round(r.left), y: Math.round(r.bottom + 4) }); };
      c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.onclick(); } };
      wrap.appendChild(c);
    });
    // look the words up one after another (the dictionary model runs one request at a time)
    (async () => {
      for (const c of wrap.querySelectorAll('.ab-word')) {
        const w = c.querySelector('.ab-w').textContent;
        try {
          const d = await window.aib.invoke('answer:block', 'word', { word: w });
          c.querySelector('.ab-ph').textContent = (d && d.phonetic) || '';
          c.querySelector('.ab-mean').textContent = d && d.meaning ? (d.pos ? d.pos + ' ' : '') + d.meaning : (zh() ? '点击查看词典' : 'Open in dictionary');
        } catch { c.querySelector('.ab-mean').textContent = zh() ? '点击查看词典' : 'Open in dictionary'; }
      }
    })();
  }

  function enhance(root, opts = {}) {
    if (!root) return;
    root.querySelectorAll('.ablock:not([data-done])').forEach((b) => {
      b.dataset.done = '1';
      try {
        if (b.dataset.kind === 'chem') renderChem(b);
        else if (b.dataset.kind === 'graph') renderGraph(b, !!opts.live);
        else if (b.dataset.kind === 'word') renderWords(b);
      } catch (e) { console.error('answer block', e); }
    });
  }
  window.AnswerBlocks = { enhance, checkEquation, parseFormula, graphCommands };
})();
