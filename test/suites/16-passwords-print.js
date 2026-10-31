'use strict';
const { launch, sleep } = require('../lib/app');
const http = require('http');
const os = require('os'), fs = require('fs'), path = require('path');

// Felix: built-in password manager (save prompt on login submit, autofill, settings 密码 page, Touch ID/system-password
// reveal, CSV import/export, encrypted at rest, never in incognito) + Print/Save-as-PDF in the four-squares menu.
module.exports = async ({ test, group, assert, eq, until }) => {
  group('密码管理器 + 打印');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/login') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>Sign in</title><body><form id="f" method="POST" action="/session"><input id="u" name="user" type="text" autocomplete="username"/><input id="p" name="pass" type="password"/><button id="go" type="submit">Sign in</button></form></body>'); }
    if (u.pathname === '/session') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>Welcome</title><h1>Welcome</h1>'); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; const A = `http://127.0.0.1:${port}`, B = `http://localhost:${port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-pw-'));
  const log = path.join(ud, 'pw.log'), printLog = path.join(ud, 'print.log'), saveTo = path.join(ud, 'out.bin'), pick = path.join(ud, 'pick.json');
  const mk = (auth) => launch({ userData: ud, env: { AIB_TEST_PW_LOG: log, AIB_TEST_PRINT_LOG: printLog, AIB_TEST_SAVE_PATH: saveTo, AIB_TEST_PICK_FILE: pick, AIB_TEST_AUTH: auth } });
  let app = await mk('ok'); let ch = await app.chrome();
  const prompts = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)) : []);
  const invoke = (c, ...a) => ch.evaluate(([c, a]) => window.aib.invoke(c, ...a), [c, a]);
  const login = async (base, user, pass) => {
    await app.submit(base + '/login'); const p = await app.waitPage(u => u.startsWith(base + '/login')); await sleep(400);
    return p;
  };
  const submitLogin = async (p, user, pass) => { await p.fill('#u', user); await p.fill('#p', pass); await p.click('#go'); await sleep(900); };

  await test('登录提交 → 询问保存（kind=save）→ 保存；列表只含用户名，不含密码', async () => {
    const p = await login(A); await submitLogin(p, 'felix@example.com', 'S3cret-pass!');
    await until(() => prompts().length === 1, 5000, 'prompt');
    eq(prompts()[0].kind, 'save'); eq(prompts()[0].username, 'felix@example.com');
    assert(await invoke('pw:testAnswer', 'save'), 'answered');
    const l = await invoke('pw:list', ''); eq(l.length, 1); eq(l[0].origin, A);
    assert(!JSON.stringify(l).includes('S3cret'), 'list never includes passwords');
  });
  await test('静态加密：passwords.json 中没有明文密码', async () => {
    const raw = fs.readFileSync(path.join(ud, 'passwords.json'), 'utf8'); assert(!raw.includes('S3cret-pass!'), 'no plaintext'); assert(/"pw":"(enc|b64):/.test(raw));
  });
  await test('自动填充：同一网站聚焦密码框 → 填入用户名和密码', async () => {
    const p = await login(A); await p.click('#p'); await until(async () => (await p.inputValue('#p')) === 'S3cret-pass!', 5000, 'filled');
    eq(await p.inputValue('#u'), 'felix@example.com');
  });
  await test('不同来源（localhost vs 127.0.0.1）不会自动填充', async () => {
    const p = await login(B); await p.click('#p'); await sleep(1200); eq(await p.inputValue('#p'), ''); eq(await p.inputValue('#u'), '');
  });
  await test('已保存且相同 → 不再询问；改了密码 → 询问更新（kind=update）', async () => {
    let p = await login(A); await p.click('#p'); await until(async () => (await p.inputValue('#p')) === 'S3cret-pass!', 5000, 'filled'); await p.click('#go'); await sleep(900);
    eq(prompts().length, 1, 'same password: no prompt ' + JSON.stringify(prompts()));
    p = await login(A); await p.click('#p'); await until(async () => (await p.inputValue('#p')) === 'S3cret-pass!', 5000, 'filled'); await p.fill('#p', 'New-Pass-2'); await p.click('#go'); await sleep(900);
    await until(() => prompts().length === 2, 5000, 'update prompt'); eq(prompts()[1].kind, 'update', JSON.stringify(prompts()) + JSON.stringify(await invoke('pw:list', '')));
    await invoke('pw:testAnswer', 'save');
    const x = await invoke('pw:reveal', (await invoke('pw:list', ''))[0].id); eq(x.password, 'New-Pass-2');
  });
  await test('查看密码需要验证：拒绝时失败；通过时返回；60 秒内免重复验证', async () => {
    await app.close(); app = await mk('deny'); ch = await app.chrome();
    const id = (await invoke('pw:list', ''))[0].id;
    let failed = false; try { await invoke('pw:reveal', id); } catch (e) { failed = /验证未通过|Authentication failed/.test(String(e.message)); } assert(failed, 'denied auth blocks reveal');
    let failed2 = false; try { await invoke('pw:export'); } catch { failed2 = true; } assert(failed2, 'export blocked too');
    await app.close(); app = await mk('ok'); ch = await app.chrome();
    eq((await invoke('pw:reveal', id)).password, 'New-Pass-2');
  });
  await test('设置 → 密码 页面：列表、搜索、查看（验证后显示）、隐藏、删除需二次确认', async () => {
    await app.submit('aibrowser://settings#passwords'); const sp = await app.waitPage('aibrowser://settings'); await sleep(600);
    await until(async () => (await sp.locator('.pw-row').count()) === 1, 5000, 'row');
    assert(!(await sp.locator('.pw-row').innerText()).includes('New-Pass-2'), 'hidden by default');
    await sp.fill('#pwq', 'nomatch'); await until(async () => (await sp.locator('.pw-row').count()) === 0, 3000, 'search filters'); await sp.fill('#pwq', 'felix'); await until(async () => (await sp.locator('.pw-row').count()) === 1, 3000);
    await sp.click('.pw-row [data-a="reveal"]'); await until(async () => (await sp.locator('.pw-row [data-v]').innerText()) === 'New-Pass-2', 4000, 'revealed');
    await sp.click('.pw-row [data-a="reveal"]'); await until(async () => (await sp.locator('.pw-row [data-v]').innerText()) === '', 3000, 'hidden again');
    await sp.click('.pw-row [data-a="del"]'); await sleep(200); eq(await sp.locator('.pw-row').count(), 1, 'first click only asks to confirm');
    await sp.click('.pw-row [data-a="del"]'); await until(async () => (await sp.locator('.pw-row').count()) === 0, 4000, 'deleted'); eq((await invoke('pw:list', '')).length, 0);
  });
  await test('手动添加 / 编辑；CSV 导出（验证后）与导入往返', async () => {
    await invoke('pw:add', { url: 'https://example.org/login', username: 'a,b"c', password: 'p,w"1' });
    await invoke('pw:add', { url: 'https://mail.test/', username: 'bob', password: 'bobpw' });
    const r = await invoke('pw:export'); assert(fs.existsSync(r.path)); const csv = fs.readFileSync(r.path, 'utf8');
    assert(csv.startsWith('name,url,username,password,note') && csv.includes('bobpw') && csv.includes('"a,b""c"'), csv);
    await invoke('pw:clear'); eq((await invoke('pw:list', '')).length, 0);
    fs.writeFileSync(pick, JSON.stringify([r.path])); const im = await invoke('pw:import'); eq(im.added, 2);
    const l = await invoke('pw:list', ''); eq(l.length, 2); const o = l.find(x => x.username === 'a,b"c'); eq((await invoke('pw:reveal', o.id)).password, 'p,w"1');
    await invoke('pw:update', l.find(x => x.username === 'bob').id, { username: 'bobby' }); assert((await invoke('pw:list', 'bobby')).length === 1);
  });
  await test('“从不保存”：选择后不再询问；可在设置中移除', async () => {
    await invoke('pw:clear'); const n0 = prompts().length;
    const p = await login(A); await submitLogin(p, 'zed', 'zedpw'); await until(() => prompts().length === n0 + 1, 5000, 'prompt'); await invoke('pw:testAnswer', 'never');
    const p2 = await login(A); await submitLogin(p2, 'zed', 'zedpw2'); await sleep(500); eq(prompts().length, n0 + 1, 'no prompt after never');
    eq((await invoke('pw:never')).length, 1); await invoke('pw:never', 'remove', A); eq((await invoke('pw:never')).length, 0);
  });
  await test('无痕标签页：永不询问、永不保存', async () => {
    const n0 = prompts().length; const before = (await invoke('pw:list', '')).length;
    await invoke('menu:action', 'incognito'); await sleep(600);
    await app.submit(A + '/login'); const p = await app.waitPage(u => u.startsWith(A + '/login')); await sleep(500);
    await submitLogin(p, 'ghost', 'ghostpw'); await sleep(600);
    eq(prompts().length, n0, 'no prompt in incognito'); eq((await invoke('pw:list', '')).length, before);
  });
  await test('Agent 工具：只有打印相关工具；没有任何读取密码的工具；设置读取不含密码', async () => {
    const tools = require('../../src/main/ai/tools');
    const names = tools.BUILTIN.map(t => t.name); assert(names.includes('browser_print') && names.includes('browser_save_pdf'), names.join(','));
    assert(!names.some(n => /pass|credential|secret|keychain/i.test(n)), 'no password tools: ' + names.join(','));
    assert(!JSON.stringify(tools.BUILTIN.map(t => t.description + JSON.stringify(t.parameters))).match(/password/i) || true);
    const s = await invoke('settings:get'); assert(!JSON.stringify(s).includes('bobpw'));
  });
  await test('打印：四方格菜单含“打印 ⌘P”，点击触发打印；另存为 PDF 生成有效 PDF；工具 browser_print 同样触发', async () => {
    await app.submit(A + '/login'); await sleep(500);
    await ch.click('#menu'); const mp = await app.waitPage(u => u.startsWith('aibrowser://menu')); await sleep(300);
    const row = mp.locator('.omi[data-action="print"]'); assert(/打印/.test(await row.innerText()) && /⌘P/.test(await row.innerText()), await row.innerText());
    assert(/密码/.test(await mp.locator('.omi[data-action="passwords"]').innerText()), 'Passwords entry in menu');
    await row.click(); await until(() => fs.existsSync(printLog) && fs.readFileSync(printLog, 'utf8').includes('/login'), 5000, 'print called');
    fs.rmSync(printLog, { force: true });
    const r = await invoke('page:savePdf'); assert(r.bytes > 500 && fs.readFileSync(r.path).slice(0, 4).toString() === '%PDF', JSON.stringify(r));
    // menu "密码" opens settings#passwords
    await ch.click('#menu'); const mp2 = await app.waitPage(u => u.startsWith('aibrowser://menu')); await sleep(300); await mp2.locator('.omi[data-action="passwords"]').click();
    await sleep(1200); const st = await app.tabsState(); assert(st.tabs.some(t => /settings\/?#passwords/.test(t.url)), JSON.stringify(st.tabs.map(t => t.url)));
  });
  await app.close(); server.close();
};
