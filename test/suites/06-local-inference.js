'use strict';
// Real inference through node-llama-cpp with a tiny GGUF (CPU on Linux; Metal path is only exercised on a real Mac).
// Set AIB_TEST_GGUF=/path/to/model.gguf (Qwen2.5-0.5B-Instruct-Q4_K_M used in our run). Skipped if absent.
const { launch, sleep, seedSettings } = require('../lib/app');
const os = require('os'), fs = require('fs'), path = require('path');
module.exports = async ({ test, group, assert, eq, until, skip }) => {
  group('本地模型：真实推理（node-llama-cpp，Qwen2.5-0.5B 小模型）');
  const gguf = process.env.AIB_REAL_INFERENCE ? (process.env.AIB_TEST_GGUF || '/workspace/models/q05.gguf') : '';
  if (!gguf || !fs.existsSync(gguf)) return skip('真实本地推理', '真实推理默认关闭（CPU 太慢）— 设置 AIB_REAL_INFERENCE=1 与 AIB_TEST_GGUF 运行；需在 Mac 上验证');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-llm-'));
  seedSettings(ud, { ai: { source: 'local', local: { modelPath: gguf } } });
  const app = await launch({ userData: ud });
  const ch = await app.chrome();
  await test('本地模型加载 + 流式生成文章翻译（无错误）', async () => {
    await app.setMode('chat'); await app.submit('aibrowser://home'); const home = await app.waitPage(u => u.startsWith('aibrowser://home'));
    await sleep(400);
    await home.fill('#q', 'The weather is very nice today.\n\nWe are going to the park to have a picnic with our friends.'); await home.press('#q', 'Enter');
    const p = await app.waitPage(u => u.startsWith('aibrowser://chat'), 10000);
    const t0 = Date.now(); const lens = new Set();
    await until(async () => {
      assert((await p.locator('.chat-error').count()) === 0, 'chat error: ' + await p.locator('.chat-error').innerText().catch(() => ''));
      const n = (await p.locator('#atext').innerText().catch(() => '')).trim().length; lens.add(n); await sleep(1500); const n2 = (await p.locator('#atext').innerText().catch(() => '')).trim().length; return n > 8 && n === n2;
    }, 150000, 'local translation finished');
    const txt = await p.locator('#atext').innerText();
    console.log('      local model output:', JSON.stringify(txt.slice(0, 160)), `(${Math.round((Date.now() - t0) / 1000)}s, ${lens.size} distinct lengths)`);
    assert(/[\u4e00-\u9fff]/.test(txt), 'Chinese output expected');
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '13-local-model-translation.png'));
  }, { timeout: 170000 });
  await app.close();
};
