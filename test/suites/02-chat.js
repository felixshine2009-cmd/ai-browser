'use strict';
const { launch, sleep, seedSettings, apiSettings, patchSettings } = require('../lib/app');
const { createWebServer, createLlmServer } = require('../lib/mock-server');
const { classify, lemmaCandidates } = require('../../src/main/classify');
const os = require('os'), fs = require('fs'), path = require('path');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('Chat 模式：输入分类（单元）');
  await test('单个英文单词 → word；屈折形式 → word', () => {
    for (const w of ['abandon', 'running', "don't", 'well-known']) eq(classify(w).kind, 'word', w);
    assert(lemmaCandidates('running').includes('run'), 'running→run'); assert(lemmaCandidates('studies').includes('study')); assert(lemmaCandidates('abandoned').includes('abandon'));
  });
  await test('一句英文 → sentence', () => {
    for (const s of ['The quick brown fox jumps over the lazy dog near the river.', 'I love you.', 'She has been living in Paris since 2019.']) eq(classify(s).kind, 'sentence', s);
  });
  await test('多段/长文 → article；中文长文 → article(目标英文)', () => {
    eq(classify('First paragraph here.\n\nSecond paragraph follows with more text.').kind, 'article');
    eq(classify('word '.repeat(150)).kind, 'article');
    const c = classify('这是一段很长的中文。'.repeat(40)); eq(c.kind, 'article'); eq(c.target, 'en');
  });
  await test('问题（中/英）→ question', () => {
    for (const q of ['苹果 M1 和 M2 有什么区别？', 'What is the capital of France?', 'how to cook rice', '画出 y=sin x 的图像', 'Why is the sky blue']) eq(classify(q).kind, 'question', q);
  });

  group('Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务）');
  const llm = await createLlmServer();
  const web = await createWebServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-chat-'));
  seedSettings(ud, apiSettings(llm.port, { search: { engine: 'custom', custom: `http://localhost:${web.port}/search?q=%s` } }));
  const app = await launch({ userData: ud });
  const chatPage = async (hint) => app.waitPage(u => u.startsWith('aibrowser://chat'), 10000);
  const ask = async (text) => {
    await app.setMode('chat');
    if (text.includes('\n')) { // multi-paragraph text is entered via the home textarea
      await app.submit('aibrowser://home'); const home = await app.waitPage(u => u.startsWith('aibrowser://home'));
      await sleep(400); await home.fill('#q', text); await home.press('#q', 'Enter');
    } else await app.submit(text);
    await sleep(200); return chatPage();
  };

  await test('测试连接：成功返回 pong；错误 Key 返回错误且不回显密钥', async () => {
    const ch = await app.chrome();
    const ok = await ch.evaluate(() => window.aib.invoke('ai:test', {}));
    assert(ok.ok, JSON.stringify(ok)); assert(/pong/.test(ok.sample));
    const bad = await ch.evaluate(() => window.aib.invoke('ai:test', { apiKey: 'wrong-key-XYZ' }));
    assert(!bad.ok && /401/.test(bad.error), JSON.stringify(bad)); assert(!bad.error.includes('wrong-key-XYZ'));
    const reqs = await (await fetch(`http://127.0.0.1:${llm.port}/__requests`)).json();
    assert(reqs.some(r => r.auth === 'test-key' && r.stream === true && r.model === 'mock-1'), 'request had bearer key, stream, model, temperature');
  });
  await test('单词（无词典）→ AI 生成词条，并明确标注“AI 生成 · 非词典”', async () => {
    const p = await ask('serendipity');
    await until(async () => (await p.locator('.dict-headword').count()) > 1, 15000, 'ai entry');
    assert((await p.locator('.ai-note').innerText()).includes('AI 生成'), 'label');
    assert((await p.locator('.pos-block .def').first().innerText()).includes('意外发现'), 'def');
    assert((await p.locator('.phrase-sec .ph').count()) === 1);
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '04-word-ai-fallback.png'));
  });
  await test('句子 → 翻译 + 成分分析（主/谓/宾/定/状 着色 + 结构拆解）', async () => {
    const p = await ask('The quick brown fox jumps over the lazy dog near the river.');
    await until(async () => (await p.locator('.tok.subj').count()) === 1, 15000, 'tokens');
    for (const c of ['subj', 'pred', 'obj', 'attr', 'adv']) assert((await p.locator('.tok.' + c).count()) >= 1, c);
    eq(await p.locator('.sent-orig').innerText().then(s => s.replace(/\s+/g, ' ').trim()), 'The quick brown fox jumps over the lazy dog near the river.');
    assert((await p.locator('.trans-box .txt').innerText()).includes('棕色狐狸'));
    eq(await p.locator('.tree .row').count(), 6);
    const bg = await p.locator('.tok.subj').evaluate(e => getComputedStyle(e).borderBottomColor);
    assert(bg === 'rgb(255, 107, 107)', 'subject colour ' + bg);
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '03-sentence.png'));
  });
  await test('长文 → 仅翻译（双栏：原文 / 译文逐段）', async () => {
    const art = 'The first paragraph of the article talks about chips.\n\nThe second paragraph is a bit longer and talks about memory.\n\nThird paragraph ends it.';
    const p = await ask(art);
    await until(async () => (await p.locator('#atext p').count()) === 3, 15000, 'translation paragraphs');
    eq(await p.locator('#asrc p').count(), 3);
    assert((await p.locator('#atext p').first().innerText()).includes('第一段'));
    eq(await p.locator('.tree').count(), 0);
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '05-article.png'));
  });
  let questionSid;
  await test('问题 → 智能体搜索：改写查询(可编辑) → SERP → 读取网页 → 流式作答带 [n] 引用', async () => {
    llm.state.slow = 40;
    const p = await ask('苹果 M1 和 M2 有什么区别？');
    await until(async () => (await p.locator('.q-edit').count()) === 2, 20000, 'rewritten queries');
    eq(await p.locator('.q-edit').first().inputValue(), 'apple m1 vs m2 comparison');
    // streaming: answer text must grow over time
    const lens = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) { const n = (await p.locator('#answer').innerText().catch(() => '')).length; lens.add(n); if (n > 40 && (await p.locator('.cite').count()) >= 3 && lens.size > 4) break; await sleep(80); }
    assert(lens.size >= 4, 'answer streamed incrementally (distinct lengths: ' + lens.size + ')');
    await until(async () => (await p.locator('.page-row').count()) === 3, 10000, 'pages read');
    await until(async () => (await p.locator('.page-row .dot:not(.fail):not(.loading)').count()) === 3, 15000, 'pages ok');
    await until(async () => (await p.locator('.source-card').count()) === 3, 5000, 'source cards');
    const hrefs = await p.locator('#answer a.cite').evaluateAll(a => a.map(x => x.getAttribute('href')));
    assert(hrefs.length >= 3 && hrefs.every(h => /127\.0\.0\.1:\d+\/page\/\d/.test(h)), 'citations link to sources: ' + hrefs);
    const txt = await p.locator('#answer').innerText(); assert(txt.includes('5nm'), 'answer text');
    // LLM got numbered sources text extracted by Readability (not nav/footer)
    const reqs = await (await fetch(`http://127.0.0.1:${llm.port}/__requests`)).json();
    const ans = reqs.filter(r => /Web sources:/.test(JSON.stringify(r.messages))).pop();
    const src = ans.messages.find(m => m.role === 'user').content;
    assert(/\[1\] Apple M\d chip overview/.test(src) && src.includes('unified memory') && !src.includes('footer'), 'readability extracted article text');
    assert(web.hits.filter(h => h.path === '/search').length >= 2, 'default engine SERP fetched for both queries');
    assert(web.hits.some(h => h.path.startsWith('/page/')), 'pages fetched');
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '02-chat-answer.png'));
    await until(async () => (await p.locator('#actions').count()) === 1, 15000, 'done');
  }, { timeout: 90000 });
  await test('点击引用 [n] 在新标签页打开来源网页', async () => {
    const p = await chatPage();
    const before = (await app.tabsState()).tabs.length;
    await p.locator('#answer a.cite').first().click();
    await until(async () => (await app.tabsState()).tabs.length === before + 1, 5000, 'new tab');
    const st = await app.tabsState();
    assert(/\/page\/\d/.test(st.tabs[st.tabs.length - 1].url));
    const ch = await app.chrome(); await ch.click(`.tab[data-id="${st.tabs[st.tabs.length - 1].id}"] .close-tab`);
    await until(async () => (await app.tabsState()).tabs.length === before, 5000, 'tab closed');
  });
  await test('用户编辑改写查询后重新搜索（只用编辑后的查询）', async () => {
    const p = await chatPage();
    const edits = p.locator('.q-edit');
    await edits.nth(1).fill('');   // drop one
    await edits.first().fill('custom edited query');
    const hitsBefore = web.hits.filter(h => h.path === '/search').length;
    await p.locator('.rerun').click();
    const p2 = await until(async () => { const ps = app.pages().filter(x => x.url().startsWith('aibrowser://chat')); return ps.find(x => x.url() !== p.url()) || (ps[0] && await ps[0].locator('.q-edit').count() === 1 ? ps[0] : null); }, 10000, 'rerun page');
    await until(async () => (await p2.locator('.q-edit').count()) === 1 && (await p2.locator('.q-edit').first().inputValue()) === 'custom edited query', 15000, 'edited chip');
    await until(() => web.hits.filter(h => h.path === '/search' && h.q === 'custom edited query').length === 1, 15000, 'serp for edited query');
    eq(web.hits.filter(h => h.path === '/search').length - hitsBefore, 1);
  }, { timeout: 60000 });
  await test('数学作图：LLM 工具调用 ggb_eval → GeoGebra 面板真实绘制（通过 GGB API 校验）', async () => {
    await patchSettings(app, {}); llm.state.slow = 10;
    const p = await ask('请画出 y = sin x 与 y = x^2/4 的图像，并标出交点');
    await until(async () => (await p.locator('.tool-chip').count()) >= 1, 40000, 'tool chip');
    assert((await p.locator('.tool-chip').first().innerText()).startsWith('ggb_eval(f(x)=sin(x)'), 'tool chip text');
    const frame = await until(() => p.frames().find(f => f.url().includes('aib.geogebra/panel.html')), 10000, 'ggb frame');
    const names = await until(async () => { const n = await frame.evaluate(() => window.ggbApplet ? window.ggbApplet.getAllObjectNames() : null); return n && n.length >= 3 ? n : null; }, 90000, 'ggb objects');
    assert(['f', 'g', 'A'].every(n => names.includes(n)), 'objects ' + names);
    const info = await frame.evaluate(() => ({ f: ggbApplet.getValueString('f'), type: ggbApplet.getObjectType('f'), ax: ggbApplet.getXcoord('A'), ay: ggbApplet.getYcoord('A') }));
    assert(/sin/.test(info.f) && info.type === 'function', JSON.stringify(info));
    assert(Math.abs(info.ay - info.ax * info.ax / 4) < 1e-6 && Math.abs(Math.sin(info.ax) - info.ay) < 1e-6, 'A is a true intersection of f and g: ' + info.ax + ',' + info.ay);
    await until(async () => /已通过工具完成/.test(await p.locator('#answer').innerText()), 15000, 'final answer after tool');
    await sleep(1500);
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '06-geogebra-plot.png'));
    // exercise the other tools on the same panel
    const png = await p.evaluate(() => Bridge.panelCall('aib.geogebra', 'canvas', 'exportPng', {}));
    assert(png.ok && png.bytes > 1000, 'png export ' + JSON.stringify(png));
    const cl = await p.evaluate(() => Bridge.panelCall('aib.geogebra', 'canvas', 'clear', {}));
    eq(cl.count, 0);
    eq(await frame.evaluate(() => ggbApplet.getAllObjectNames().length), 0);
    const reqs = await (await fetch(`http://127.0.0.1:${llm.port}/__requests`)).json();
    assert(reqs.some(r => (r.tools || []).includes('ggb_eval') && (r.tools || []).includes('ggb_clear') && (r.tools || []).includes('ggb_export_png')), 'tools offered to LLM');
  }, { timeout: 150000 });
  await test('Anthropic 格式（/v1/messages 流式）可用', async () => {
    await patchSettings(app, { ai: { api: { format: 'anthropic', baseUrl: `http://127.0.0.1:${llm.port}`, preset: 'anthropic' } } });
    const ch = await app.chrome();
    const ok = await ch.evaluate(() => window.aib.invoke('ai:test', {}));
    assert(ok.ok && /pong/.test(ok.sample), JSON.stringify(ok));
    const p = await ask('The quick brown fox jumps over the lazy dog near the river.');
    await until(async () => (await p.locator('.tok.subj').count()) === 1, 15000, 'sentence via anthropic');
    const reqs = await (await fetch(`http://127.0.0.1:${llm.port}/__requests`)).json();
    assert(reqs.some(r => r.path === '/v1/messages' && r.auth === 'test-key'), 'anthropic endpoint called');
    await patchSettings(app, { ai: { api: { format: 'openai', baseUrl: `http://127.0.0.1:${llm.port}/v1`, preset: 'custom' } } });
  });
  await test('未配置 API 时给出友好错误，应用不崩溃', async () => {
    await patchSettings(app, { ai: { api: { baseUrl: '' } } });
    const p = await ask('The quick brown fox jumps over the lazy dog near the river.');
    await until(async () => (await p.locator('.chat-error').count()) === 1, 10000, 'error box');
    assert((await p.locator('.chat-error').innerText()).includes('API 未配置'));
    assert(!app.exited);
  });
  await app.close(); await llm.close(); await web.close();
};
