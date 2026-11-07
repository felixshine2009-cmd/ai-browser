(async function () {
  await I18N.init();
  const root = document.getElementById('root');
  root.innerHTML = `<h2>Siri</h2><div class="row"><button type="button" id="sum">页面摘要</button><button type="button" id="tr">对照翻译</button></div><textarea id="q" rows="2" placeholder="询问当前页面"></textarea><button type="button" id="ask">提问</button><div id="out" class="siri-out"></div>`;
  const out = document.getElementById('out');
  async function run(kind) {
    out.textContent = '思考中';
    try {
      const r = await window.aib.invoke('siri:ask', kind, document.getElementById('q').value);
      out.textContent = (r && r.text) || '';
    } catch (e) { out.textContent = e.message; }
  }
  document.getElementById('sum').onclick = () => run('summary');
  document.getElementById('tr').onclick = () => run('translate');
  document.getElementById('ask').onclick = () => run('ask');
})();
