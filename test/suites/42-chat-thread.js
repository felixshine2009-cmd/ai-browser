'use strict';
// v3.0.0 chat threads: follow-ups are appended under the last answer (one scrolling conversation), turns are stored
// with the thread and survive restarts, earlier turns are sent to the model within its context budget, the model's
// thinking is shown collapsed, and the send button turns into a stop button (also Esc / Cmd+.) that keeps the partial.
const { launch, sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer } = require('../lib/mock-server');
const T = require('../../src/main/ai/thread');
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..', '..');

function staticServer(dir) {
  const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json', wasm: 'application/wasm' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = path.join(dir, u === '/' ? 'index.html' : u);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).slice(1)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

module.exports = async ({ test, group, assert, eq, until }) => {
  group('对话串（单元）：上下文预算裁剪 / 用时与速度 / 记录');
  await test('web/js/thread.js 与 src/main/ai/thread.js 完全一致', () => {
    const root = path.join(__dirname, '..', '..');
    eq(fs.readFileSync(path.join(root, 'web/js/thread.js'), 'utf8'), fs.readFileSync(path.join(root, 'src/main/ai/thread.js'), 'utf8'));
  });
  await test('未超预算时原样保留全部轮次', () => {
    const turns = [{ input: 'Q1', answer: 'A1' }, { input: 'Q2', answer: 'A2' }];
    const m = T.priorMessages(turns, { contextTokens: 32000 });
    eq(m.map(x => x.role + ':' + x.content).join('|'), 'user:Q1|assistant:A1|user:Q2|assistant:A2');
  });
  await test('超出预算：先缩短较早回答，再丢弃最早轮次并保留问题摘要；最新一轮完整', () => {
    const long = '长'.repeat(3000);
    const turns = Array.from({ length: 12 }, (_, i) => ({ input: '问题' + i, answer: long + i }));
    const budget = T.budgetFor({ local: true, contextTokens: 4096 });
    const r = T.trimPrior(turns.flatMap(t => [{ role: 'user', content: t.input }, { role: 'assistant', content: t.answer }]), budget);
    assert(r.trimmed && r.dropped > 0, 'dropped ' + r.dropped);
    const tok = r.messages.reduce((a, x) => a + T.estTokens(x.content) + 4, 0);
    assert(tok <= budget + 50, 'within budget ' + tok + ' / ' + budget);
    assert(/较早的 \d+ 轮对话因长度限制已省略/.test(r.messages[0].content) && r.messages[0].content.includes('问题0'), 'note lists dropped questions');
    eq(r.messages[r.messages.length - 2].content, '问题11', 'newest question kept');
    // the API budget (32k context) keeps more than the local one (4k)
    assert(T.priorMessages(turns, { contextTokens: 128000 }).length > T.priorMessages(turns, { local: true, contextTokens: 4096 }).length, 'larger context keeps more');
  });
  await test('用时 / 首字 / 速度行；中止的轮次保留部分回答', () => {
    const line = T.statsLine({ startedAt: 1000, firstAt: 2000, endedAt: 6000, answer: '一'.repeat(200) });
    eq(line, '用时 5.0 秒 · 首字 1.0 秒 · 约 50 token/秒');
    const rec = T.turnRecord({ sid: 's1', input: 'q', answer: '部分', startedAt: 1, endedAt: 2 });
    eq(rec.answer, '部分'); eq(rec.sid, 's1');
    const row = T.addTurn({ id: 't' }, rec); T.addTurn(row, Object.assign({}, rec, { answer: '部分2' }));
    eq(row.turns.length, 1, 'same sid replaces'); eq(row.turns[0].answer, '部分2');
  });

  group('对话串（桌面端，mock 思考模型）：追问追加在下方 / 思考过程 / 停止生成 / 重启后保留');
  const llm = await createLlmServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-thread-'));
  seedSettings(ud, apiSettings(llm.port));
  llm.state.script = ({ system, lastUser }) => {
    if (!/web-research agent|AI Browser \(web\)/i.test(system)) return null;
    const m = /THREADQ(\d)/.exec(lastUser); if (!m) return null;
    const n = m[1];
    if (n === '3' || n === '4') return { reasoning: '先想一想第' + n + '个问题。', text: ('SLOW' + n + '-').repeat(400), delay: 60 };
    return { reasoning: '思考第' + n + '个问题：先分析，再作答。', text: 'ANSWER-' + n + ' 这是第 ' + n + ' 个回答。' };
  };
  let app = await launch({ userData: ud });
  const chats = () => app.pages().filter(p => p.url().startsWith('aibrowser://chat'));
  const lastReq = (re) => llm.requests.slice().reverse().find(r => (r.messages || []).some(m => m.role === 'user' && re.test(String(m.content))));
  let p;
  // like a user: wait until the previous answer has finished (Enter does nothing while an answer is being generated)
  const follow = async (text) => { await until(async () => (await p.locator('#followgo').innerText()) === '↵', 20000, 'idle'); await p.fill('#followq', text); await p.press('#followq', 'Enter'); };
  const turnCount = () => p.locator('.chat-turn').count();
  try {
    await test('首个问题：思考过程默认折叠并显示“已思考 N 秒”，回答下方有用时与速度行', async () => {
      await app.setMode('chat');
      await app.submit('THREADQ1 什么是悬链线？');
      p = await app.waitPage(u => u.startsWith('aibrowser://chat'), 15000);
      if (process.env.DBG) p.on('console', m => console.log('    [page]', m.text()));
      await until(async () => /ANSWER-1/.test(await p.locator('.chat-turn').last().innerText()), 20000, 'answer 1');
      await until(async () => /用时 [\d.]+ 秒/.test(await p.locator('.turn-meta').last().innerText().catch(() => '')), 10000, 'stats line');
      const box = p.locator('.chat-turn').last().locator('details.think-box');
      eq(await box.count(), 1, 'thinking box');
      eq(await box.evaluate(d => d.open), false, 'collapsed by default');
      assert(/思考过程 · 已思考 \d+ 秒/.test(await box.locator('summary').innerText()), 'summary');
      await box.locator('summary').click();
      assert((await box.locator('.think-body').innerText()).includes('思考第1个问题'), 'thinking text');
      eq(await p.locator('#followgo').innerText(), '↵');
    });
    await test('追问：新问题与回答追加在上一回答下方，同一页面，之前的回答仍在；模型收到上一轮', async () => {
      const url = p.url(), n0 = chats().length;
      await follow('THREADQ2 它的方程是什么？');
      await until(async () => (await turnCount()) === 2 && /ANSWER-2/.test(await p.locator('.chat-turn').nth(1).innerText()), 20000, 'second turn');
      assert(/ANSWER-1/.test(await p.locator('.chat-turn').nth(0).innerText()), 'first answer still visible');
      assert((await p.locator('.chat-turn').nth(1).innerText()).includes('它的方程是什么'), 'question bubble below');
      eq(chats().length, n0, 'no new tab');
      if (process.env.DBG) console.log('    url', url, p.url(), await p.evaluate(() => location.href), await turnCount(), (await p.locator('#turns').innerText()).slice(-300));
      assert(p.url() !== url && p.url().startsWith('aibrowser://chat'), 'url follows the newest turn');
      const req = lastReq(/THREADQ2/);
      const prior = req.messages.map(m => String(m.content || '')).join('\n');
      assert(prior.includes('THREADQ1') && prior.includes('ANSWER-1'), 'prior turn sent');
      // turn 1 sits above turn 2
      const [a, b] = await p.locator('.chat-turn').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().top));
      assert(a < b, 'order');
    });
    await test('停止生成：发送按钮变为停止按钮；点击后保留部分回答并标记“已中止”', async () => {
      await follow('THREADQ3 请详细展开');
      try { await until(async () => (await p.locator('.chat-turn').count()) === 3 && /SLOW3/.test(await p.locator('.chat-turn').nth(2).innerText()), 20000, 'streaming'); }
      catch (e) { if (process.env.DBG) { console.log('    turns', await turnCount(), p.url(), await p.evaluate(() => [window.__AIB_CHAT__ && window.__AIB_CHAT__.busy(), document.getElementById('followq') && document.getElementById('followq').value, document.getElementById('turns').innerHTML.length]), JSON.stringify((await p.locator('#turns').innerText()).slice(0, 900))); console.log('    reqs', JSON.stringify(llm.requests.slice(-3).map(r => ({ sys: String((r.messages || [])[0] && r.messages[0].content).slice(0, 80), last: r.messages && String(r.messages[r.messages.length - 1].content).slice(0, 120) })))); } throw e; }
      eq(await p.locator('#followgo.stop').count(), 1, 'stop button');
      eq(await p.locator('#followgo').innerText(), '■');
      await p.click('#followgo');
      await until(async () => /已中止/.test(await p.locator('.chat-turn').nth(2).locator('.turn-meta').innerText().catch(() => '')), 5000, 'stopped mark');
      const len1 = (await p.locator('.chat-turn').nth(2).locator('.ai-answer').innerText()).length;
      assert(len1 > 0 && len1 < 400 * 6, 'partial answer ' + len1);
      await sleep(1200);
      eq((await p.locator('.chat-turn').nth(2).locator('.ai-answer').innerText()).length, len1, 'no more text after stop');
      eq(await p.locator('#followgo').innerText(), '↵', 'send button back');
      assert(/用时 [\d.]+ 秒/.test(await p.locator('.chat-turn').nth(2).locator('.turn-meta').innerText()), 'stats line on stopped turn');
    });
    await test('Esc 也能停止生成；中止后追问会带上已生成的部分回答', async () => {
      await follow('THREADQ4 再展开');
      await until(async () => (await turnCount()) === 4 && /SLOW4/.test(await p.locator('.chat-turn').nth(3).innerText()), 20000, 'streaming 4');
      await p.keyboard.press('Escape');
      await until(async () => /已中止/.test(await p.locator('.chat-turn').nth(3).locator('.turn-meta').innerText().catch(() => '')), 5000, 'esc stop');
      await follow('THREADQ5 总结一下');
      await until(async () => (await turnCount()) === 5 && /ANSWER-5/.test(await p.locator('.chat-turn').nth(4).innerText()), 20000, 'turn 5');
      const ctx = lastReq(/THREADQ5/).messages.map(m => String(m.content || '')).join('\n');
      assert(ctx.includes('SLOW4-') && ctx.includes('THREADQ4'), 'partial of the stopped turn is in context');
    });
    await test('刷新页面：整段对话（含思考与“已中止”）从记录中恢复', async () => {
      await p.reload(); await sleep(800);
      await until(async () => (await turnCount()) === 5, 10000, 'five turns after reload');
      const all = await p.locator('#turns').innerText();
      for (const s of ['ANSWER-1', 'ANSWER-2', 'SLOW3-', 'ANSWER-5', '已中止']) assert(all.includes(s), s);
      eq(await p.locator('.chat-turn details.think-box').count(), 5, 'thinking kept per turn');
    });
    const sid = new URL(p.url()).searchParams.get('sid');
    await test('重启应用后打开对话：全部轮次仍在，并可继续追问（模型收到之前的轮次）', async () => {
      await app.close();
      app = await launch({ userData: ud });
      await (await app.chrome()).evaluate((u) => window.aib.invoke('nav:openUrl', u), 'aibrowser://chat?sid=' + sid);
      p = await app.waitPage(u => u.startsWith('aibrowser://chat'), 15000);
      await until(async () => (await turnCount()) === 5, 10000, 'restored turns');
      await follow('THREADQ6 最后一个问题');
      await until(async () => (await turnCount()) === 6 && /ANSWER-6/.test(await p.locator('.chat-turn').nth(5).innerText()), 20000, 'turn 6');
      const ctx = lastReq(/THREADQ6/).messages.map(m => String(m.content || '')).join('\n');
      assert(ctx.includes('ANSWER-5') && ctx.includes('THREADQ1'), 'prior after restart');
      await p.screenshot({ path: path.join(__dirname, '..', '..', 'shots', '42-chat-thread.png') });
    });
    await test('“新对话”按钮回到首页开始新的对话', async () => {
      await p.click('#newchat');
      await until(() => app.pages().some(x => x.url().startsWith('aibrowser://home')), 5000, 'home');
    });
  } finally { await app.close().catch(() => {}); }

  group('对话串（网页版）：追问追加 / 思考过程 / 停止生成（按钮与 Esc）/ 刷新后保留 / 新对话');
  {
    const { srv, port } = await staticServer(path.join(ROOT, 'web'));
    const wapp = await launch({});
    let wp;
    const wfrozen = () => wp.locator('#thread .turn.frozen');
    const wask = async (text) => {
      await until(async () => (await wp.locator('#btnSend').getAttribute('class') || '').indexOf('stop') < 0, 20000, 'idle');
      await wp.fill('#q', text); await wp.click('#btnSend');
    };
    try {
      await wapp.submit(`http://127.0.0.1:${port}/index.html`);
      wp = await wapp.waitPage(u => u.startsWith(`http://127.0.0.1:${port}/`), 15000);
      await wp.evaluate((llmPort) => {
        const k = 'aib.settings.v1'; const s = JSON.parse(localStorage.getItem(k) || '{}');
        s.engine = 'api'; s.api = { preset: 'custom', baseUrl: `http://127.0.0.1:${llmPort}/v1`, apiKey: 'test-key', model: 'mock-1' };
        localStorage.setItem(k, JSON.stringify(s)); localStorage.removeItem('aib.threads'); localStorage.removeItem('aib.lastThread');
      }, llm.port);
      await wp.reload(); await sleep(1200);
      await test('网页版：第一问与追问依次出现在对话中，思考过程折叠，模型收到上一轮', async () => {
        await wask('THREADQ1 什么是悬链线？');
        await until(async () => (await wfrozen().count()) === 1 && /ANSWER-1/.test(await wfrozen().first().innerText()), 20000, 'web turn 1');
        const box = wfrozen().first().locator('details.think-box');
        eq(await box.evaluate(d => d.open), false, 'collapsed');
        assert(/思考过程 · 已思考 \d+ 秒/.test(await box.locator('summary').innerText()), 'summary');
        assert(/用时 [\d.]+ 秒/.test(await wfrozen().first().locator('.turn-meta').innerText()), 'stats');
        await wask('THREADQ2 它的方程是什么？');
        await until(async () => (await wfrozen().count()) === 2 && /ANSWER-2/.test(await wfrozen().nth(1).innerText()), 20000, 'web turn 2');
        const [a, b] = await wfrozen().evaluateAll(ns => ns.map(n => n.getBoundingClientRect().top)); assert(a < b, 'order');
        const ms = lastReq(/THREADQ2/).messages;
        assert(ms.some(m => m.role === 'user' && /THREADQ1/.test(m.content)) && ms.some(m => m.role === 'assistant' && /ANSWER-1/.test(m.content)), 'prior as chat messages');
      });
      await test('网页版：生成中发送按钮变为“停止”，点击后保留部分回答并标记“已中止”；Esc 同样可停止', async () => {
        await wask('THREADQ3 请详细展开');
        await until(async () => /SLOW3/.test(await wp.locator('#answer').innerText()), 20000, 'web streaming');
        eq(await wp.locator('#btnSend').innerText(), '停止');
        await wp.click('#btnSend');
        await until(async () => (await wfrozen().count()) === 3, 5000, 'stopped turn kept');
        const t3 = await wfrozen().nth(2).innerText();
        assert(/SLOW3-/.test(t3) && /已中止/.test(t3), 'partial + mark');
        eq(await wp.locator('#btnSend').innerText(), '发送');
        await wask('THREADQ4 再展开');
        await until(async () => /SLOW4/.test(await wp.locator('#answer').innerText()), 20000, 'web streaming 4');
        await wp.keyboard.press('Escape');
        await until(async () => (await wfrozen().count()) === 4 && /已中止/.test(await wfrozen().nth(3).innerText()), 5000, 'esc stop');
        await wask('THREADQ5 总结一下');
        await until(async () => (await wfrozen().count()) === 5, 20000, 'web turn 5');
        assert(lastReq(/THREADQ5/).messages.some(m => m.role === 'assistant' && /SLOW4-/.test(m.content)), 'partial in context');
      });
      await test('网页版：刷新后对话仍在；“新对话”开始新的上下文', async () => {
        await wp.reload(); await sleep(1200);
        await until(async () => (await wfrozen().count()) === 5, 8000, 'restored');
        await wp.click('#btnNewChat');
        eq(await wfrozen().count(), 0);
        await wask('THREADQ6 新的问题？');
        await until(async () => (await wfrozen().count()) === 1, 20000, 'new thread');
        assert(!lastReq(/THREADQ6/).messages.some(m => /THREADQ1/.test(String(m.content))), 'no old context');
        await wp.screenshot({ path: path.join(ROOT, 'shots', '42-web-thread.png') });
      });
    } finally { await wapp.close().catch(() => {}); srv.close(); }
  }
  await llm.close();
};
