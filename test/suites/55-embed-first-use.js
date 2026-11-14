'use strict';
// v6.1.0: no model files ship in the mac zip. The knowledge-base embedding model (EmbeddingGemma 300M) is downloaded on
// first use into userData/models, then used for real embeddings. Uses a local mock Hugging Face endpoint (AIB_HF_BASE)
// that serves the real GGUF file with Range support, and AIB_NO_LOCAL_MODELS=1 so that a source checkout's models/ is
// ignored, as in the packaged app.
const { launch, seedSettings } = require('../lib/app');
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const SRC = process.env.AIB_EMBED_GGUF || '/workspace/models/embeddinggemma-300M-Q8_0.gguf';
const ROOT = path.join(__dirname, '..', '..');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('嵌入模型（v6.1.0）：安装包不含模型；知识库首次使用时下载 EmbeddingGemma 并正常生成向量');
  await test('打包脚本：stage 不复制 models/，打包后检查应用内无 .gguf 与 models 目录', async () => {
    const st = require(path.join(ROOT, 'scripts', 'stage.js'));
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-nomodels-'));
    fs.mkdirSync(path.join(d, 'app', 'src'), { recursive: true }); fs.writeFileSync(path.join(d, 'app', 'src', 'a.js'), '');
    st.assertNoModels(d);
    fs.mkdirSync(path.join(d, 'app', 'models')); fs.writeFileSync(path.join(d, 'app', 'models', 'x.gguf'), 'x');
    let err = ''; try { st.assertNoModels(d); } catch (e) { err = e.message; }
    assert(/must not be packaged/.test(err) && /x\.gguf/.test(err), err);
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'stage.js'), 'utf8');
    assert(!/copyFileSync\([^)]*models/.test(src) && /assertNoModels\(STAGE\)/.test(src), 'stage never copies models');
    assert(/assertNoModels\(appDir\)/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'pack-mac.js'), 'utf8')), 'pack-mac checks the app');
    fs.rmSync(d, { recursive: true, force: true });
  });
  if (!fs.existsSync(SRC)) { await test('首次使用下载（需要本机模型文件作为模拟下载源）', () => 'skip: ' + SRC + ' not present'); return; }
  const total = fs.statSync(SRC).size, paths = [];
  const srv = await new Promise(r => { const s = http.createServer((req, res) => {
    paths.push(req.url);
    if (!req.url.endsWith('/embeddinggemma-300M-Q8_0.gguf')) { res.writeHead(404); return res.end(); }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || ''); const start = m ? +m[1] : 0; const end = m && m[2] ? +m[2] : total - 1;
    res.writeHead(m ? 206 : 200, Object.assign({ 'Content-Length': end - start + 1, 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' }, m ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {}));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(SRC, { start, end }).pipe(res);
  }); s.listen(0, '127.0.0.1', () => r(s)); });
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-embed1-'));
  seedSettings(ud, { onboarding: { completed: true, skipped: false, completedAt: 1 } });
  const app = await launch({ userData: ud, env: { AIB_HF_BASE: `http://127.0.0.1:${srv.address().port}`, AIB_NO_LOCAL_MODELS: '1' } });
  const ch = await app.chrome();
  const invoke = (c, ...a) => ch.evaluate(([c, a]) => window.aib.invoke(c, ...a), [c, a]);
  try {
    await test('知识库添加文本：自动下载嵌入模型到用户数据目录，完成后生成向量并可检索', async () => {
      const dest = path.join(ud, 'models', 'embeddinggemma-300M-Q8_0.gguf');
      assert(!fs.existsSync(dest), 'not present before first use');
      const r = await invoke('kb:addText', '测试文档', '光合作用是植物利用光能，把二氧化碳和水转化为有机物并释放氧气的过程。\n\nThe Eiffel Tower is a wrought-iron lattice tower in Paris.');
      assert(r && r.ok !== false && !r.error, JSON.stringify(r).slice(0, 300));
      eq(fs.statSync(dest).size, total, 'downloaded in full');
      assert(paths.some(p => p.endsWith('/embeddinggemma-300M-Q8_0.gguf')), 'fetched from the model source');
      const s = await invoke('kb:search', '植物如何利用光能制造养分', 2);
      assert(s.ok && s.hits.length >= 1 && /光合作用/.test(s.hits[0].text), JSON.stringify(s).slice(0, 300));
      const s2 = await invoke('kb:search', 'famous tower in France', 2);
      assert(s2.ok && /Eiffel/.test(s2.hits[0].text), JSON.stringify(s2).slice(0, 300));
    }, { timeout: 300000 });
  } finally { await app.close(); srv.close(); fs.rmSync(ud, { recursive: true, force: true }); }
};
