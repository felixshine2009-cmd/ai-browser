'use strict';
// v3.6 lean tests: pure logic, mocked downloads, no model inference.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const v36 = require('../../src/main/v36/v36');
const parallel = require('../../src/main/v36/parallel');
const mtp = require('../../src/main/v36/mtp');
const phone = require('../../src/main/v36/phone');

module.exports = async ({ test, group, assert, eq }) => {
  group('v3.6 主题 / 风格 / 思考 / 路由');
  await test('四个主题都列出全部颜色，界面名不含来源品牌', () => {
    const ids = Object.keys(v36.THEMES);
    eq(ids, ['aurora', 'sand', 'night', 'ink']);
    for (const id of ids) {
      const colors = Object.values(v36.THEMES[id].colors);
      assert(colors.length >= 6, id);
      assert(new Set(colors).size === colors.length, 'duplicate swatch ' + id);
      const blob = JSON.stringify(v36.THEMES[id]);
      assert(!/SiriAI|Claude|Kimi|Grok/i.test(blob), id);
    }
    eq(v36.dictScheme('sand'), 'light');
    eq(v36.dictScheme('ink'), 'dark');
  });
  await test('简洁只去掉装饰，提示仍要求详细结构', () => {
    const c = v36.styleBlock('简洁');
    const d = v36.styleBlock('详细');
    assert(/detailed and clearly structured/.test(c) && /detailed and clearly structured/.test(d));
    assert(/drop decoration/.test(c));
    assert(/Do not name or describe which tools/.test(v36.answerAddendum('concise')));
    assert(/JSON/.test(v36.answerAddendum('detailed')));
  });
  await test('思考等级可映射且从不自动打断', () => {
    eq(v36.thinkingPolicy(), { interrupt: false, maxWaitMs: null });
    const oai = v36.reasoningFields('max', { provider: 'openai', model: 'o4-mini' });
    eq(oai.reasoning_effort, 'high');
    assert(!('interrupt' in oai));
    eq(v36.reasoningFields('low', { provider: 'openai', model: 'o4-mini' }).reasoning_effort, 'low');
    assert(!v36.reasoningFields('medium', { provider: 'deepseek', model: 'deepseek-chat' }).thinking);
  });
  await test('没有专门请求时默认网页搜索；作图走工具', () => {
    eq(v36.route('今天的新闻').kind, 'search');
    eq(v36.route('画 y=x^2').kind, 'draw');
    eq(v36.route('帮我解题').kind, 'solve');
    eq(v36.selectionKind('apple'), 'word');
    eq(v36.selectionKind('The cat sat.'), 'sentence');
  });

  group('v3.6 计算 / 百科 / 解题上下文');
  await test('高中计算：牛顿、求根、欧姆', () => {
    eq(v36.hscalc('newton', { m: 2, a: 3 }).F, 6);
    const q = v36.hscalc('quad', { a: 1, b: -3, c: 2 });
    eq(q.roots.slice().sort((a, b) => a - b), [1, 2]);
    eq(v36.hscalc('ohm', { V: 12, R: 4 }).I, 3);
    assert(v36.hscalc('gas', { P: 101325, V: 0.0224, T: 273.15 }).n > 0.9);
  });
  await test('离线百科检索与 JSONL 导入', () => {
    const hits = v36.wikiSearch(v36.WIKI_SEED, '欧姆');
    assert(hits[0].title.includes('欧姆'));
    const extra = v36.parseWikiJsonl('{"title":"自定义","text":"只在本地的说明"}\nnot json\n');
    eq(extra.length, 1);
    assert(v36.wikiSearch(v36.WIKI_SEED.concat(extra), '自定义')[0].title === '自定义');
  });
  await test('解题保留参考资料和上一轮', () => {
    const s = v36.solverSession();
    v36.solverAddRef(s, { title: '课本', text: 'F=ma' });
    v36.solverAddTurn(s, 'user', '第一问');
    v36.solverAddTurn(s, 'assistant', '先写受力');
    const ctx = v36.solverContext(s);
    assert(ctx.includes('课本') && ctx.includes('第一问') && ctx.includes('先写受力'));
  });

  group('v3.6 下载 / MTP / 手机拍照 / 任务');
  await test('不支持 Range 时取消多线程并保留普通下载', async () => {
    const dest = path.join(os.tmpdir(), 'aib-mt-' + Date.now() + '.bin');
    let normal = false;
    const fetchImpl = async () => ({ status: 200, headers: { get: (h) => h === 'content-length' ? '4' : '' }, body: { cancel: async () => {} } });
    const r = await parallel.takeover({ url: 'http://example/a', dest, fetchImpl, normalWrite: async () => { normal = true; fs.writeFileSync(dest, 'keep'); } });
    eq(r.mode, 'normal');
    assert(r.cancelledMultithread && normal);
    eq(fs.readFileSync(dest, 'utf8'), 'keep');
    fs.unlinkSync(dest);
  });
  await test('支持 Range 时分块拼回原文', async () => {
    const payload = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789');
    const dest = path.join(os.tmpdir(), 'aib-mt2-' + Date.now() + '.bin');
    const fetchImpl = async (url, opts) => {
      const range = opts.headers && opts.headers.Range;
      if (range === 'bytes=0-0') return { status: 206, headers: { get: (h) => h === 'content-range' ? 'bytes 0-0/' + payload.length : 'bytes' }, body: { cancel: async () => {} } };
      const m = /bytes=(\d+)-(\d+)/.exec(range || '');
      const start = Number(m[1]), end = Number(m[2]);
      const buf = payload.subarray(start, end + 1);
      return { status: 206, headers: { get: () => '' }, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    };
    const r = await parallel.takeover({ url: 'http://example/b', dest, fetchImpl, parts: 4, normalWrite: async () => {} });
    eq(r.mode, 'multithread');
    eq(fs.readFileSync(dest).equals(payload), true);
    fs.unlinkSync(dest);
  });
  await test('MTP 只读配置，不启动推理', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-mtp-'));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ mtp_num_heads: 2 }));
    const info = mtp.probe(dir);
    assert(info.mtp && info.infer === false && info.engine === 'mlx-lm');
    eq(mtp.extraArgs(dir).includes('--trust-remote-code'), true);
    eq(v36.mtpExtraArgs({ mtp: false }).length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await test('手机页使用系统相机输入，页面可收照片', async () => {
    const html = v36.phonePage();
    assert(html.includes('capture="environment"') && html.includes('accept="image/*"'));
    assert(!/getUserMedia/.test(html));
    eq(v36.phoneLink({ desktop: false }), v36.PUBLIC_SOLVER);
    const got = [];
    const srv = phone.createPhoneServer({ onImage: (buf) => got.push(buf) });
    const info = await srv.start();
    const page = await fetch('http://127.0.0.1:' + info.port + '/c/' + srv.token);
    assert((await page.text()).includes('capture="environment"'));
    const up = await fetch('http://127.0.0.1:' + info.port + '/c/' + srv.token, { method: 'POST', body: Buffer.from('img') });
    eq(up.status, 200);
    assert(got.length === 1 && got[0].toString() === 'img');
    assert(info.qr.includes('<svg'));
    await srv.stop();
  });
  await test('任务循环用假模型完成目标，状态不含真实推理', async () => {
    const seen = [];
    const out = await v36.runTask({
      goal: '打开示例页',
      onStatus: (s) => seen.push(s.label),
      ask: async ({ steps }) => steps.length ? { done: true, summary: '已打开页面' } : { action: 'navigate', args: { url: 'https://example.com' } },
      act: async (step) => ({ ok: true, url: step.args.url })
    });
    eq(out.summary, '已打开页面');
    eq(out.steps[0].action, 'navigate');
    assert(seen.includes('思考中') && seen.includes('工具调用中'));
    const cleaned = v36.redactToolTalk('结论如下。\n我调用了 web_search 工具。\n所以答案是 2。');
    assert(cleaned.includes('结论如下') && cleaned.includes('所以答案是 2') && !/web_search|工具/.test(cleaned));
  });

  group('v3.6 聊天记录 / 插件 / 内核 / 版本');
  await test('聊天记录与浏览历史不是同一份列表', () => {
    const history = [{ url: 'https://example.com', title: 'web' }];
    const chats = v36.createChats([]);
    chats.upsert({ id: 'c1', title: '解题：受力', messages: [{ role: 'user', text: '第一问' }] });
    assert(!history.some(h => h.title === '解题：受力'));
    eq(chats.list()[0].id, 'c1');
    eq(v36.cleanTitle('"  受力分析  "'), '受力分析');
  });
  await test('插件可以改主题和布局，不能写入密钥', () => {
    const r = v36.sanitizePluginPatch({ appearance: { theme: 'night' }, answerStyle: '简洁', workMode: 'task', ai: { api: { apiKey: 'sk-secret' } }, lang: 'en' });
    eq(r.patch.appearance.theme, 'night');
    eq(r.patch.answerStyle, 'concise');
    eq(r.patch.lang, 'en');
    assert(!JSON.stringify(r.patch).includes('sk-secret'));
    assert(r.rejectedSecrets);
  });
  await test('内核版本比较', () => {
    const plan = v36.kernelPlan({ chrome: '130.0.0', electron: '33.0.0' }, { chrome: '132.0.1', electron: '34.0.0' });
    assert(plan.updateAvailable && plan.inApp);
    assert(!v36.kernelPlan({ chrome: '140.0.0', electron: '40.0.0' }, { chrome: '132.0.0', electron: '34.0.0' }).updateAvailable);
  });
  await test('添加模型时可选择常见服务商，而不是只有空白地址', () => {
    const ids = Object.keys(v36.API_PROVIDERS);
    for (const id of ['openai', 'deepseek', 'qwen', 'zhipu', 'gemini', 'groq', 'mistral', 'doubao', 'anthropic', 'custom']) assert(ids.includes(id), id);
    eq(v36.API_PROVIDERS.deepseek.baseUrl, 'https://api.deepseek.com/v1');
    eq(v36.API_PROVIDERS.deepseek.model, 'deepseek-chat');
    eq(v36.API_PROVIDERS.custom.baseUrl, '');
    assert(v36.API_PROVIDERS.gemini.models.length >= 1);
    const names = Object.values(v36.API_PROVIDERS).map(p => p.name).join('\n');
    assert(!/SiriAI|\bKimi\b|\bGrok\b|\bClaude\b/.test(names), names);
    const web = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
    assert(web.includes('id="apiPreset"'));
  });
  await test('版本号与网页缓存名匹配，网页把桌面功能标灰', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    eq(pkg.version, '5.4.0');
    const sw = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'sw.js'), 'utf8');
    assert(sw.includes("aib-web-v2.4.0"));
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
    assert(html.includes('data-desktop-only') && html.includes('Siri'));
    const zh = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'js', 'i18n.js'), 'utf8');
    assert(zh.includes('仅桌面版可用') && zh.includes('Desktop only'));
    assert(!/5\.1\.0|aib-web-v2\.1\.0/.test(pkg.version + sw));
  });
};
