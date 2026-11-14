'use strict';
// 2.3.0 unit checks that run in plain Node (no Electron): sampling parameter rules and the one-time retry (B4),
// thinking level options per model (U5), math rendering in the Markdown renderer (B7).
const http = require('http');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
// under the device-like Node (no ICU, --jitless) the same shims as on iPad are needed for fetch / TextDecoder
if (typeof globalThis.WebAssembly === 'undefined') require(path.join(ROOT, 'ipad/node/wasm-shim.js'));
try { new TextDecoder('gb18030'); } catch { try { require(path.join(ROOT, 'ipad/node/encoding-shim.js')); } catch {} }

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

  await test('公式渲染（B7）：离线 KaTeX + mhchem 渲染 $…$、$$…$$、\\(…\\)、\\[…\\]，代码与价格不误判', () => {
    const vm = require('vm'), fs = require('fs');
    const D = path.join(ROOT, 'src/renderer/static/');
    const ctx = vm.createContext({}); ctx.window = ctx; ctx.self = ctx;
    for (const f of ['vendor/katex/katex.min.js', 'vendor/katex/contrib/mhchem.min.js', 'md.js']) vm.runInContext(fs.readFileSync(D + f, 'utf8'), ctx, { filename: f });
    const r = ctx.MD.render('解：$x^2+1=0$\n$$\\frac{a}{b}$$\n价格 $5 和 $6，\\(\\ce{H2O}\\)\n`$code$`\n```\n$$no$$\n```\n\\[ \\int_0^1 x\\,dx \\]');
    eq((r.match(/class="katex"/g) || []).length, 4, 'four formulas');
    eq((r.match(/katex-display/g) || []).length, 2, 'two display formulas');
    assert(r.includes('$5 和 $6'), 'prices untouched'); assert(r.includes('<code>$code$</code>'), 'inline code untouched'); assert(r.includes('$$no$$'), 'fenced code untouched');
    assert(!r.includes('\\ce'), 'mhchem rendered');
    for (const f of ['katex.min.js', 'katex.min.css', 'contrib/mhchem.min.js', 'LICENSE']) assert(fs.existsSync(path.join(D, 'vendor/katex', f)), f);
    const css = fs.readFileSync(path.join(D, 'vendor/katex/katex.min.css'), 'utf8');
    for (const m of css.matchAll(/url\((fonts\/[^)]+)\)/g)) assert(fs.existsSync(path.join(D, 'vendor/katex', m[1])), 'font ' + m[1]);
    for (const pg of ['chat', 'siri', 'tool']) assert(fs.readFileSync(path.join(ROOT, 'src/renderer/pages', pg + '.html'), 'utf8').includes('vendor/katex/katex.min.js'), pg + ' loads KaTeX');
  });
  await test('自定义镜像（F6）：识别 ISO / QCOW2 / IMG；QCOW2（v2、v3、压缩簇）转换为原始格式后逐字节一致', async () => {
    const os = require('os'); const fs = require('fs'); const { execFileSync } = require('child_process'); const crypto = require('crypto');
    const custom = require(path.join(ROOT, 'src/main/vm/custom'));
    let qemuImg = null; try { execFileSync('qemu-img', ['--version']); qemuImg = 'qemu-img'; } catch {}
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-qc-'));
    const raw = path.join(d, 'src.raw'); const b = Buffer.alloc(4 * 1024 * 1024);
    crypto.randomBytes(300000).copy(b, 500000); b.write('hello', 3500000); b[510] = 0x55; b[511] = 0xaa; fs.writeFileSync(raw, b);
    eq(custom.detect(raw).format, 'raw');
    const iso = path.join(d, 'x.iso'); const ib = Buffer.alloc(0x9000); ib.write('CD001', 0x8001, 'latin1'); fs.writeFileSync(iso, ib);
    eq(custom.detect(iso).format, 'iso');
    if (!qemuImg) { console.log('    (跳过 QCOW2 转换：没有 qemu-img)'); return; }
    const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
    for (const [n, args] of [['v3', ['-O', 'qcow2']], ['v3c', ['-c', '-O', 'qcow2']], ['v2', ['-O', 'qcow2', '-o', 'compat=0.10']]]) {
      const q = path.join(d, n + '.qcow2'); execFileSync(qemuImg, ['convert', ...args, raw, q]);
      eq(custom.detect(q).format, 'qcow2');
      await custom.qcow2ToRaw(q, path.join(d, n + '.out'));
      eq(md5(path.join(d, n + '.out')), md5(raw), n);
    }
  });
};
