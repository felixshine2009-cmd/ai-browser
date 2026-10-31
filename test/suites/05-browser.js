'use strict';
const { launch, sleep, seedSettings, apiSettings, patchSettings } = require('../lib/app');
const { createWebServer, createLlmServer } = require('../lib/mock-server');
const { extractSerp } = require('../../src/main/ai/search');
const { JSDOM } = require('jsdom');
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私');
  const web = await createWebServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-br-'));
  const app = await launch({ userData: ud });
  const ch = await app.chrome();
  const inv = (...a) => ch.evaluate((a) => window.aib.invoke(...a), a);
  const go = async (u) => { await app.setMode('search'); await app.submit(u); await until(async () => { const t = (await app.tabsState()).tabs.find(x => x.active); return t && t.url.startsWith(u.split('?')[0]) && !t.loading; }, 10000, 'loaded ' + u); await sleep(300); };
  const openMenuItem = async (action) => { await ch.click('#menu'); const m = await app.waitPage('aibrowser://menu'); await m.click(`[data-action="${action}"]`).catch(e => { if (!/closed/.test(e.message)) throw e; }); return m; };
  const activeUrl = async () => (await app.tabsState()).tabs.find(t => t.active).url;

  await test('历史记录：访问的网页被记录，可搜索 / 删除 / 清除', async () => {
    await go(`http://127.0.0.1:${web.port}/alpha-page`); await go(`http://127.0.0.1:${web.port}/beta-page`);
    await app.submit('aibrowser://history'); const hp = await app.waitPage('aibrowser://history');
    await until(async () => (await hp.locator('.lrow').count()) === 2, 8000, 'two history rows');
    assert((await hp.locator('.lrow .sub').first().innerText()).endsWith('/beta-page'), 'most recent first');
    await hp.fill('#lq', 'alpha');
    await until(async () => (await hp.locator('.lrow').count()) === 1, 5000, 'filtered');
    await hp.locator('.lrow [data-del]').click();
    await until(async () => (await hp.locator('.empty').count()) === 1, 5000, 'deleted -> empty');
    eq((await inv('hist:list', '')).length, 1, 'beta-page remains');
    await inv('hist:clear'); eq((await inv('hist:list', '')).length, 0);
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '10-history.png'));
  });
  await test('书签：加入 / 在书签页列出 / 删除', async () => {
    await go(`http://127.0.0.1:${web.port}/bm-page`);
    await ch.click('#bookmark');
    await until(async () => (await ch.locator('#bookmark.bookmarked').count()) === 1, 5000, 'bookmark icon active');
    await app.submit('aibrowser://bookmarks'); const bp = await app.waitPage('aibrowser://bookmarks');
    await until(async () => (await bp.locator('.lrow').count()) === 1, 5000, 'bookmark row');
    assert((await bp.locator('.lrow .sub').innerText()).endsWith('/bm-page'));
    await bp.locator('[data-del]').click();
    await until(async () => (await bp.locator('.empty').count()) === 1, 5000, 'removed');
  });
  await test('下载管理器：下载文件 → 列表显示完成 → 文件落盘', async () => {
    await go(`http://127.0.0.1:${web.port}/x`);
    await app.submit(`http://127.0.0.1:${web.port}/download.bin`);
    await until(async () => (await inv('dl:list')).some(d => d.state === 'completed'), 10000, 'download completed');
    const d = (await inv('dl:list'))[0]; 
    eq(d.filename, 'test-file.bin'); eq(fs.statSync(path.join(app.dlDir, 'test-file.bin')).size, 2048);
    await app.submit('aibrowser://downloads'); const dp = await app.waitPage('aibrowser://downloads');
    await until(async () => (await dp.locator('.lrow .ttl').first().innerText()) === 'test-file.bin', 5000, 'row');
    assert((await dp.locator('.lrow .time').first().innerText()).includes('已完成'));
    await app.submit(`http://127.0.0.1:${web.port}/download.bin`);
    await until(async () => (await inv('dl:list')).length === 2 && (await inv('dl:list')).every(x => x.state === 'completed'), 10000, 'second download');
    assert(fs.existsSync(path.join(app.dlDir, 'test-file (1).bin')), 'unique filename for repeat download');
    await dp.locator('[data-del]').first().click();
    await until(async () => (await inv('dl:list')).length === 1, 5000, 'removed from list');
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '11-downloads.png'));
  });
  await test('在页面上查找：菜单 → 查找条 → 匹配计数', async () => {
    await go(`http://127.0.0.1:${web.port}/words`);
    await openMenuItem('find');
    const fp = await app.waitPage('aibrowser://find', 8000);
    await fp.fill('#fq', 'needle');
    await until(async () => /1\/4/.test(await fp.locator('#cnt').innerText()), 8000, 'count 1/4');
    await fp.press('#fq', 'Enter');
    await until(async () => /2\/4/.test(await fp.locator('#cnt').innerText()), 5000, 'next 2/4');
    await fp.fill('#fq', 'zzzznotfound');
    await until(async () => (await fp.locator('#cnt').innerText()) === '无结果', 5000, 'no results');
    await fp.click('#fx');
    await until(() => !app.pages().some(p => p.url().startsWith('aibrowser://find')), 4000, 'find closed');
  });
  await test('缩放：菜单 +/−/重置 作用于当前页（devicePixelRatio 验证）', async () => {
    const wp = await app.waitPage(`127.0.0.1:${web.port}/words`);
    const base = await wp.evaluate(() => window.devicePixelRatio);
    await ch.click('#menu'); const m = await app.waitPage('aibrowser://menu');
    await m.click('[data-z="in"]');
    await until(async () => (await m.locator('#zv').innerText()) === '110%', 4000, 'zoom label 110%');
    await until(async () => Math.abs((await wp.evaluate(() => window.devicePixelRatio)) / base - 1.1) < 0.01, 4000, 'dpr ×1.1');
    await m.click('[data-z="reset"]');
    await until(async () => Math.abs((await wp.evaluate(() => window.devicePixelRatio)) - base) < 0.01, 4000, 'reset');
    await m.keyboard.press('Escape').catch(() => {});
  });
  await test('菜单项导航：历史记录/下载内容/拓展/书签/设置 分别打开对应页面', async () => {
    for (const [a, u] of [['history', 'history'], ['downloads', 'downloads'], ['extensions', 'extensions'], ['bookmarks', 'bookmarks'], ['settings', 'settings']]) {
      await openMenuItem(a);
      await until(async () => (await activeUrl()).startsWith('aibrowser://' + u), 5000, a);
    }
  });
  await test('检查（DevTools）：菜单项为当前网页打开开发者工具', async () => {
    await go(`http://127.0.0.1:${web.port}/words`);
    const list = () => new Promise(r => http.get(`http://127.0.0.1:${app.port}/json/list`, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => r(JSON.parse(b))); }));
    assert(!(await list()).some(t => /devtools/.test(t.url)), 'no devtools before');
    await openMenuItem('devtools');
    await until(async () => (await list()).some(t => /devtools/.test(t.url)), 8000, 'devtools target');
  });
  await test('Chat 模式首页输入 URL 直接导航（不进入 AI）', async () => {
    await app.setMode('chat'); await app.submit(`http://127.0.0.1:${web.port}/direct`);
    await until(async () => (await activeUrl()).endsWith('/direct'), 8000, 'navigated');
  });
  await test('隐私：清除历史/下载记录/缓存/Cookie 不报错', async () => {
    await go(`http://127.0.0.1:${web.port}/p1`);
    assert((await inv('hist:list', '')).length > 0);
    await inv('privacy:clear', { history: true, downloads: true, cache: true, cookies: true });
    eq((await inv('hist:list', '')).length, 0); eq((await inv('dl:list')).length, 0);
  });
  await test('关闭最后一个标签页时自动新建首页（应用不退出）', async () => {
    let st = await app.tabsState();
    for (const t of st.tabs) { await ch.click(`.tab[data-id="${t.id}"] .close-tab`).catch(() => {}); await sleep(150); }
    await until(async () => { const s = await app.tabsState(); return s.tabs.length >= 1 && s.tabs.some(t => t.kind === 'home'); }, 5000, 'fresh home tab');
    assert(!app.exited);
  });
  await app.close();

  group('本地模型（node-llama-cpp）：缺失模型不影响启动');
  const llm = await createLlmServer();
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-lm-'));
  const hf = await new Promise(r => { const total = 3 * 1024 * 1024; const s = http.createServer(async (req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range || ''); const start = m ? +m[1] : 0;
    res.writeHead(m ? 206 : 200, { 'Content-Length': total - start, 'Content-Type': 'application/octet-stream' });
    for (let o = start; o < total; o += 256 * 1024) { res.write(Buffer.alloc(Math.min(256 * 1024, total - o), 1)); await sleep(120); }
    res.end(); }); s.listen(0, '127.0.0.1', () => r({ s, port: s.address().port, total })); });
  seedSettings(ud2, { ai: { source: 'local', local: { modelPath: '', modelId: '' } } });
  const a2 = await launch({ userData: ud2, env: { AIB_HF_BASE: `http://127.0.0.1:${hf.port}` } });
  const c2 = await a2.chrome(); const inv2 = (...a) => c2.evaluate((a) => window.aib.invoke(...a), a);
  await test('未选择模型时应用正常启动；提问给出清晰提示而不崩溃', async () => {
    await a2.setMode('chat'); await a2.submit('The quick brown fox jumps over the lazy dog near the river.');
    const p = await a2.waitPage(u => u.startsWith('aibrowser://chat'));
    await until(async () => (await p.locator('.chat-error').count()) === 1, 10000, 'error');
    assert((await p.locator('.chat-error').innerText()).includes('本地模型'));
    assert(!a2.exited);
  });
  await test('模型目录 + 引擎状态（引擎在本机可加载或给出可读错误）', async () => {
    const l = await inv2('lm:list'); eq(l.length, 3); assert(l[0].file === 'qwen2.5-7b-instruct-q4_k_m.gguf' && l[0].repo === 'Qwen/Qwen2.5-7B-Instruct-GGUF' && !l[0].downloaded);
    const st = await inv2('lm:status'); assert(st.engine === 'ok' || (st.engine === 'error' && st.engineError), JSON.stringify(st));
    console.log('      engine status:', JSON.stringify(st).slice(0, 200));
  });
  await test('选择无效的 .gguf 文件：报错但不崩溃', async () => {
    const bad = path.join(ud2, 'bad.gguf'); fs.writeFileSync(bad, 'not a model');
    await inv2('settings:patch', { ai: { local: { modelPath: bad } } });
    await a2.submit('The quick brown fox jumps over the lazy dog near the river.');
    const p = await a2.waitPage(u => u.startsWith('aibrowser://chat'));
    await until(async () => (await p.locator('.chat-error').count()) === 1, 30000, 'error for invalid model');
    assert(!a2.exited);
    await inv2('settings:patch', { ai: { local: { modelPath: '' } } });
  }, { timeout: 60000 });
  await test('设置页“本地模型”：模型列表 + 下载进度条 + 取消/完成（本地模拟 HF 服务）', async () => {
    await a2.submit('aibrowser://settings'); const sp = await a2.waitPage('aibrowser://settings');
    await sp.click('[data-src="local"]');
    await until(async () => (await sp.locator('.model-row').count()) === 3, 8000, 'rows');
    assert((await sp.locator('.model-row').first().innerText()).includes('Qwen2.5-7B-Instruct'));
    const row = sp.locator('.model-row[data-model="qwen2.5-1.5b-instruct-q4_k_m"]');
    await row.locator('[data-act="dl"]').click();
    await until(async () => (await sp.locator('.model-row .progress').count()) === 1, 8000, 'progress bar visible');
    await a2.screenshot(path.join(__dirname, '..', '..', 'shots', '12-settings-local-model.png'));
    await until(() => fs.existsSync(path.join(ud2, 'models', 'qwen2.5-1.5b-instruct-q4_k_m.gguf')), 20000, 'download finished');
    eq(fs.statSync(path.join(ud2, 'models', 'qwen2.5-1.5b-instruct-q4_k_m.gguf')).size, hf.total);
    assert(!fs.existsSync(path.join(ud2, 'models', 'qwen2.5-1.5b-instruct-q4_k_m.gguf.part')), '.part removed');
    const s = await inv2('settings:get'); assert(s.ai.local.modelPath.endsWith('qwen2.5-1.5b-instruct-q4_k_m.gguf'), 'auto-selected after download');
  }, { timeout: 60000 });
  await a2.close(); hf.s.close();

  group('静态检查');
  await test('i18n：所有界面字符串键在 zh/en 中均存在', () => { const r = cp.spawnSync('node', ['scripts/check-i18n.js'], { cwd: ROOT, encoding: 'utf8' }); assert(r.status === 0, r.stdout); });
  await test('v1 无动画 / 无自定义鼠标指针（使用系统光标），样式使用 CSS 变量', () => {
    const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.(css|html|js)$/.test(f) && files.push(p); } })(path.join(ROOT, 'src', 'renderer'));
    const bad = [];
    for (const f of files) { const s = fs.readFileSync(f, 'utf8'); if (/@keyframes|animation\s*:|transition\s*:(?!\s*none)/.test(s)) bad.push(f + ' anim'); if (/cursor\s*:\s*url\(/.test(s)) bad.push(f + ' cursor-url'); }
    assert(!bad.length, bad.join(', '));
    const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'static', 'shared.css'), 'utf8'); assert(css.includes('--green-text') && css.includes(':root'));
    assert(!fs.existsSync(path.join(ROOT, 'src', 'renderer', 'static', 'cursors')), 'no cursor assets');
  });
  await test('SERP 解析器：Bing(含 /ck/a 跳转解码) / Google / 百度 / DuckDuckGo / 通用', () => {
    const run = (html, id, base) => extractSerp(new JSDOM(html, { url: base }).window.document, id, base);
    const target = 'https://example.org/a?x=1';
    const b64 = Buffer.from(target).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    let r = run(`<ol><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=1&u=a1${b64}&ntb=1">Example Title</a></h2><div class="b_caption"><p>Snippet text</p></div></li></ol>`, 'bing', 'https://www.bing.com/search?q=x');
    eq([r.length, r[0].url, r[0].title, r[0].snippet], [1, target, 'Example Title', 'Snippet text']);
    r = run('<div class="g"><a href="https://g.example/1"><h3>Google Result</h3></a><div class="VwiC3b">gs</div></div>', 'google', 'https://www.google.com/search?q=x'); eq([r.length, r[0].title], [1, 'Google Result']);
    r = run('<div id="content_left"><div class="result c-container"><h3><a href="http://www.baidu.com/link?url=abc">百度结果标题</a></h3></div></div>', 'baidu', 'https://www.baidu.com/s?wd=x'); eq([r.length, r[0].title], [1, '百度结果标题']);
    r = run('<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg.example%2Fp">DDG Result</a><a class="result__snippet">sn</a></div>', 'duckduckgo', 'https://html.duckduckgo.com/html/'); eq([r[0].url, r[0].title], ['https://ddg.example/p', 'DDG Result']);
    r = run('<h3><a href="http://other.test/page">A sufficiently long link text</a></h3><a href="/local">internal long link text here</a>', 'custom', 'http://localhost:1/search'); eq(r.length, 1);
  });
  await llm.close(); await web.close();
};
