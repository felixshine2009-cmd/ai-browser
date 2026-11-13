'use strict';
// 2.3.0 unit checks that run in plain Node (no Electron): sampling parameter rules and the one-time retry (B4),
// thinking level options per model (U5), math rendering in the Markdown renderer (B7).
const http = require('http');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async ({ test, group, assert, eq }) => {
  group('2.3.0 单元检查：采样参数规则、思考等级、公式渲染');
  const sampling = require(path.join(ROOT, 'src/main/ai/sampling'));

  await test('采样参数规则（B4）：Kimi K3 / K2.5+ 与 OpenAI 推理模型不发送 temperature，max_tokens 改为 max_completion_tokens', () => {
    sampling._reset();
    const b = sampling.apply({ model: 'kimi-k3', temperature: 0.3, top_p: 0.9, max_tokens: 800 }, { preset: 'moonshot', model: 'kimi-k3', baseUrl: 'https://api.moonshot.cn/v1' });
    eq(b, { model: 'kimi-k3', max_completion_tokens: 800 });
    const b2 = sampling.apply({ temperature: 0.2 }, { preset: 'custom', model: 'kimi-k2.6', baseUrl: 'https://api.moonshot.ai/v1' });
    assert(!('temperature' in b2), 'kimi-k2.6 by base URL');
    eq(sampling.apply({ temperature: 0.2 }, { preset: 'moonshot', model: 'moonshot-v1-8k' }).temperature, 0.2, 'moonshot-v1 keeps temperature');
    const o = sampling.apply({ temperature: 0, max_tokens: 16 }, { preset: 'openai', model: 'gpt-5-mini' });
    eq(o, { max_completion_tokens: 16 });
    eq(sampling.apply({ temperature: 0.3 }, { preset: 'openai', model: 'gpt-4o-mini' }).temperature, 0.3, 'gpt-4o keeps temperature');
    eq(sampling.apply({ temperature: 0.3 }, { preset: 'deepseek', model: 'deepseek-chat' }).temperature, 0.3);
  });

  await test('HTTP 400“invalid temperature: only 1 is allowed”时去掉采样参数重试一次，并记住该模型', async () => {
    sampling._reset();
    const seen = [];
    const srv = http.createServer((req, res) => {
      const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => {
        const body = JSON.parse(Buffer.concat(ch).toString()); seen.push(body);
        if (body.temperature !== undefined && body.temperature !== 1) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'invalid temperature: only 1 is allowed for this model', type: 'invalid_request_error' } })); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'pong' } }] }) + '\n\n'); res.end('data: [DONE]\n\n');
      });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    try {
      const llm = require(path.join(ROOT, 'src/main/ai/llm'));
      const fn = llm._chatOpenAI || llm.chatOpenAI;
      assert(typeof fn === 'function', 'llm exports chatOpenAI for tests');
      const cfg = { preset: 'custom', format: 'openai', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, model: 'some-new-model', temperature: 0.3 };
      const r = await fn(cfg, 'k', { messages: [{ role: 'user', content: 'ping' }], thinkingLevel: 'low' });
      eq(String(r.content || r).trim(), 'pong');
      eq(seen.length, 2, 'one retry'); eq(seen[0].temperature, 0.3); assert(!('temperature' in seen[1]), 'retried without temperature');
      await fn(cfg, 'k', { messages: [{ role: 'user', content: 'ping' }], thinkingLevel: 'low' });
      eq(seen.length, 3, 'rule remembered: no second failing request');
      // other 400s are not retried
      const cfg2 = Object.assign({}, cfg, { model: 'other' });
      const srv2 = http.createServer((q, s) => { q.resume(); q.on('end', () => { seen.push('x'); s.writeHead(400); s.end('{"error":{"message":"invalid api key format"}}'); }); });
      await new Promise(r => srv2.listen(0, '127.0.0.1', r)); cfg2.baseUrl = `http://127.0.0.1:${srv2.address().port}/v1`;
      const n = seen.length; let failed = false;
      try { await fn(cfg2, 'k', { messages: [{ role: 'user', content: 'x' }] }); } catch (e) { failed = e.status === 400; }
      srv2.close(); assert(failed, 'error propagated'); eq(seen.length, n + 1, 'no retry for unrelated 400');
    } finally { srv.close(); }
  });
};
