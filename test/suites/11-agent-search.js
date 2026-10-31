'use strict';
const { launch, sleep, seedSettings, apiSettings, patchSettings } = require('../lib/app');
const { createWebServer, createLlmServer } = require('../lib/mock-server');
const search = require('../../src/main/ai/search');
const os = require('os'), fs = require('fs'), path = require('path');

module.exports = async ({ test, group, assert, eq, until }) => {
  // ------------------------------------------------------------------ unit
  group('AI 搜索检索层（单元）：编码 / 相关性 / 引擎 URL');
  await test('查询词：CJK 二元组 + 拉丁词；相关性过滤丢弃无关结果（roblox / stackexchange 类）', () => {
    eq(search.queryTerms('李庆忠 简介').join(','), '李庆,庆忠,简介');
    assert(!search.isRelevant({ title: 'Roblox - Play Free Online Games', url: 'https://www.roblox.com/login', snippet: '登录 Roblox' }, '李庆忠'));
    assert(!search.isRelevant({ title: 'Next Friday vs This Friday', url: 'https://english.stackexchange.com/q/1', snippet: 'Last N days' }, '李庆忠 人物'));
    assert(!search.isRelevant({ title: '李（汉语汉字）_百度百科', url: 'https://baike.baidu.com/item/%E6%9D%8E', snippet: '李姓' }, '李庆忠'), 'surname-only page is not about 李庆忠');
    assert(search.isRelevant({ title: '李庆忠 - 百度百科', url: 'https://baike.baidu.com/x', snippet: '' }, '李庆忠'));
    assert(search.isRelevant({ title: 'Rust async runtimes compared', url: 'https://x.dev/a', snippet: '' }, 'rust async runtime comparison'));
  });
  await test('引擎 URL：只编码一次；CJK 查询带 Bing mkt/setlang、Google hl、DDG kl', () => {
    const b = search.engineUrl('bing', '李庆忠'); assert(b.startsWith('https://www.bing.com/search?q=%E6%9D%8E%E5%BA%86%E5%BF%A0&') && b.includes('mkt=zh-CN') && b.includes('setlang=zh-Hans'), b);
    assert(!b.includes('%25'), 'no double encoding');
    assert(search.engineUrl('baidu', '北京天气') === 'https://www.baidu.com/s?wd=%E5%8C%97%E4%BA%AC%E5%A4%A9%E6%B0%94');
    assert(search.engineUrl('google', '牛顿第二定律').includes('hl=zh-CN'));
    assert(search.engineUrl('duckduckgo', 'a b').includes('q=a%20b'));
    eq(search.engineUrl('custom', 'x y', 'http://h/s?k=%s'), 'http://h/s?k=x%20y');
  });
  await test('提示词：agent 提示词存在，含工具说明、引用规则、所选引擎名', () => {
    const P = require('../../src/main/ai/prompts');
    const a = P.agent({ engine: '百度' });
    assert(/web_search/.test(a) && /open_page/.test(a) && /\[n\]/.test(a) && a.includes('百度') && /FIRST query/.test(a));
  });

  // ------------------------------------------------------------------ live engines (box network)
  group('AI 搜索检索层（真实引擎，CJK + 英文）');
  const LIVE = [['李庆忠', ['李庆']], ['北京天气', ['北京', '天气']], ['牛顿第二定律', ['牛顿']], ['高考英语作文模板', ['高考', '作文']], ['rust async runtime comparison', ['rust']], ['what is the speed of light', ['light', 'speed']]];
  for (const [q, must] of LIVE) {
    await test(`真实检索「${q}」：默认 Bing，经回退链得到与查询相关的结果`, async () => {
      const r = await search.serp(q, { engine: 'bing' });
      if (r.via === 'none' && r.tried.some(t => t.error) && !r.results.length && r.tried.every(t => t.error || !t.relevant)) { console.log('      (no network: ' + JSON.stringify(r.tried) + ')'); return; }
      assert(r.results.length >= 1, 'results for ' + q + ' ' + JSON.stringify(r.tried));
      const hay = r.results.slice(0, 5).map(x => (x.title + x.snippet + x.url).toLowerCase()).join(' ');
      assert(must.some(m => hay.includes(m.toLowerCase())), 'top results mention query terms: ' + hay.slice(0, 200));
      assert(r.results.every(x => !/roblox\.com|\/login/.test(x.url)), 'no login/junk');
      console.log(`      ${q}: via ${r.via} (${r.tried.map(t => t.engine + ':' + (t.relevant ?? t.error)).join(', ')}) -> ${r.results[0].title.slice(0, 40)}`);
    }, { timeout: 60000 });
  }
  await test('真实检索：选择百度时直接使用百度并解析自然结果、解析 baidu.com/link 跳转', async () => {
    const r = await search.serp('李庆忠', { engine: 'baidu' });
    if (r.via === 'none') { console.log('      (baidu not reachable from this network: ' + JSON.stringify(r.tried) + ')'); return; }
    assert(r.results.every(x => !/baidu\.php/.test(x.url)), 'ads dropped: ' + r.results.map(x => x.url).join(' '));
    assert(r.results.some(x => !/baidu\.com\/link\?/.test(x.url)), 'at least some baidu.com/link redirects resolved to the target site');
    assert(r.results.slice(0, 3).some(x => /李庆忠/.test(x.title)), 'title has name');
  }, { timeout: 60000 });

  // ------------------------------------------------------------------ agent (mock LLM tool calls + mock/live engines)
  group('AI 搜索智能体：工具调用循环 / 所选引擎 / 回退 / 引用');
  const llm = await createLlmServer();
  const web = await createWebServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-agent-'));
  seedSettings(ud, apiSettings(llm.port, { search: { engine: 'custom', custom: `http://localhost:${web.port}/search?q=%s` } }));
  const app = await launch({ userData: ud });
  const chatPage = async () => app.waitPage(u => u.startsWith('aibrowser://chat'), 10000);
  const ask = async (text) => { await app.setMode('chat'); await app.submit(text); await sleep(200); return chatPage(); };
  const reqs = async () => (await fetch(`http://127.0.0.1:${llm.port}/__requests`)).json();

  await test('自定义 %s 引擎：LLM 发出 web_search ×2 → open_page ×3 → 作答；状态行显示所用引擎与阅读的页面', async () => {
    llm.state.slow = 5;
    const p = await ask('苹果 M1 和 M2 有什么区别？');
    await until(async () => (await p.locator('#actions').count()) === 1, 40000, 'done');
    const trace = await p.locator('#trace').innerText();
    assert(/用 自定义搜索 搜索：苹果 M1/.test(trace), 'trace searching: ' + trace);
    assert(/阅读：Apple M\d chip overview/.test(trace), 'trace reading: ' + trace);
    eq(await p.locator('.q-edit').count(), 2);
    eq(await p.locator('.page-row').count(), 3);
    const txt = await p.locator('#answer').innerText(); assert(txt.includes('5nm') && !/\[3\]/.test(txt), txt);
    const hrefs = await p.locator('#answer a.cite').evaluateAll(a => a.map(x => x.getAttribute('href'))); assert(hrefs.length >= 2 && hrefs.every(h => /\/page\/\d/.test(h)), String(hrefs));
    const r = await reqs();
    const agentReq = r.filter(x => (x.tools || []).includes('web_search')); assert(agentReq.length >= 3, 'agent rounds ' + agentReq.length);
    assert(web.hits.some(h => h.path === '/search' && h.q === '苹果 M1 和 M2 有什么区别？'), 'selected engine used (original query first)');
    assert(web.hits.some(h => h.path === '/search' && h.q === '苹果 M1 和 M2 有什么区别？ 对比'));
  }, { timeout: 90000 });
  await test('不需要搜索的问题：智能体直接回答，不发起搜索', async () => {
    const before = web.hits.filter(h => h.path === '/search').length;
    const p = await ask('你好');
    await until(async () => (await p.locator('#actions').count()) === 1, 20000, 'done');
    assert((await p.locator('#answer').innerText()).includes('直接回答'));
    eq(web.hits.filter(h => h.path === '/search').length, before, 'no search');
  }, { timeout: 40000 });
  await test('数学作图仍可用：ggb_eval 与 web 工具同时提供', async () => {
    const p = await ask('请画出 y = sin x 与 y = x^2/4 的图像，并标出交点');
    await until(async () => (await p.locator('.tool-chip').count()) >= 1, 40000, 'tool chip');
    assert((await p.locator('.tool-chip').first().innerText()).startsWith('ggb_eval('));
  }, { timeout: 60000 });
  await test('引擎不可用 → 状态行提示并回退（Bing / 百度）；不会把不相关页面当作来源', async () => {
    await patchSettings(app, { search: { engine: 'custom', custom: 'http://127.0.0.1:1/search?q=%s' } });
    const p = await ask('李庆忠');
    await until(async () => (await p.locator('#actions').count()) === 1, 80000, 'done');
    const trace = await p.locator('#trace').innerText();
    assert(/自定义搜索 (不可用|没有相关结果|没有找到相关结果)/.test(trace), 'fallback note in trace: ' + trace);
    const rows = await p.locator('.page-row a').allInnerTexts();
    assert(rows.every(t => !/roblox|stackexchange|techcommunity/i.test(t)), rows.join(' | '));
  }, { timeout: 120000 });
  for (const eng of ['bing', 'baidu']) {
    await test(`所选引擎 ${eng}（真实网络）：「李庆忠」→ 搜索 → 打开页面 → 回答只引用已打开页面`, async () => {
      await patchSettings(app, { search: { engine: eng } });
      const p = await ask('李庆忠');
      await until(async () => (await p.locator('#actions').count()) === 1, 100000, 'done');
      const engName = eng === 'bing' ? 'Bing' : '百度';
      const trace = await p.locator('#trace').innerText();
      assert(trace.includes(`用 ${engName} 搜索：李庆忠`), 'trace uses selected engine: ' + trace);
      const links = await p.locator('.page-row a').allInnerTexts();
      if (!links.length) { console.log('      (no pages readable from this network)'); return; }
      assert(links.every(t => !/roblox|stackexchange|techcommunity/i.test(t)), links.join(' | '));
      console.log('      ' + eng + ' pages: ' + links.slice(0, 3).join(' | ').slice(0, 160));
    }, { timeout: 130000 });
  }
  await app.close(); await llm.close(); await web.close();
};
