'use strict';
const { launch, sleep } = require('../lib/app');
const http = require('http');
const os = require('os'), fs = require('fs'), path = require('path');
const AdmZip = require('adm-zip');
const FIX = path.join(__dirname, '..', 'fixtures', 'chrome-ext');

// Felix: Chrome extensions install directly from the Chrome Web Store (one click) — no manual download/import.
module.exports = async ({ test, group, assert, eq, until }) => {
  group('Chrome 应用商店：一键在线安装（下载 CRX → 解包 → 加载）');
  const ID = 'abcdefghijklmnopabcdefghijklmnop', MISSING = 'pppppppppppppppppppppppppppppppp';
  const z = new AdmZip(); z.addLocalFolder(FIX); const zip = z.toBuffer();
  const hdr = Buffer.alloc(12); hdr.write('Cr24', 0); hdr.writeUInt32LE(3, 4); hdr.writeUInt32LE(0, 8);
  const crx = Buffer.concat([hdr, zip]);
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits.push(req.url);
    if (u.pathname === '/service/update2/crx') {
      const x = decodeURIComponent(u.searchParams.get('x') || '');
      if (x.includes(MISSING)) { res.writeHead(204); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/x-chrome-extension' }); return res.end(crx);
    }
    if (u.pathname.startsWith('/webstore/detail/')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><title>Test Extension - Chrome Web Store</title><h1>Test Extension</h1>'); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-cws-'));
  const app = await launch({ userData: ud, env: { AIB_CWS_BASE: base } });
  const ch = await app.chrome();
  let ep;
  await test('扩展页：粘贴扩展 ID → “从应用商店添加” → 卡片出现并已加载；请求带 id/prodversion/acceptformat', async () => {
    await app.submit('aibrowser://extensions'); ep = await app.waitPage(u => u.startsWith('aibrowser://extensions')); await sleep(500);
    await ep.fill('#cwsin', ID); await ep.click('#cwsgo');
    await until(async () => /已添加|Added/.test(await ep.locator('#cwsstat').innerText()), 15000, 'added ' + (await ep.locator('#cwsstat').innerText()));
    const l = await ch.evaluate(() => window.aib.invoke('cx:list'));
    eq(l.length, 1); assert(l[0].enabled && l[0].name, JSON.stringify(l[0]));
    const s = await ch.evaluate(() => window.aib.invoke('settings:get')); eq(s.chromeExtensions[0].storeId, ID);
    const h = hits.find(x => x.startsWith('/service/update2/crx')); assert(h.includes('prodversion=') && h.includes('acceptformat=crx2,crx3') && decodeURIComponent(h).includes('id=' + ID), h);
    await until(async () => (await ep.locator('[data-cx]').count()) === 1, 6000, 'card');
  });
  await test('粘贴完整商店链接也可安装；重复安装会替换而不是重复', async () => {
    await ep.fill('#cwsin', `https://chromewebstore.google.com/detail/test-extension/${ID}?hl=zh-CN`); await ep.click('#cwsgo');
    await until(async () => /已添加|Added/.test(await ep.locator('#cwsstat').innerText()), 15000, 'added again'); await sleep(500);
    eq((await ch.evaluate(() => window.aib.invoke('cx:list'))).length, 1);
  });
  await test('错误：商店无此扩展 / 非法输入 → 清晰的错误原因', async () => {
    await ep.fill('#cwsin', MISSING); await ep.click('#cwsgo');
    await until(async () => /没有找到|not found/i.test(await ep.locator('#cwsstat').innerText()), 10000, 'not found msg');
    await ep.fill('#cwsin', 'hello world'); await ep.click('#cwsgo');
    await until(async () => /不是 Chrome|Not a Chrome/.test(await ep.locator('#cwsstat').innerText()), 5000, 'bad input msg');
  });
  await test('商店详情页：地址栏旁出现“添加到 AI浏览器”按钮，一键安装，已安装后按钮消失', async () => {
    await ch.evaluate(async (id) => { const l = await window.aib.invoke('cx:list'); for (const e of l) await window.aib.invoke('cx:remove', e.path); }, ID);
    await app.submit(`${base}/webstore/detail/test-extension/${ID}`); await sleep(600);
    await until(async () => await ch.locator('#cwsadd').isVisible(), 8000, 'chip visible');
    assert(/添加到 AI浏览器/.test(await ch.locator('#cwsadd').innerText()));
    await ch.click('#cwsadd');
    await until(async () => /已添加/.test(await ch.locator('#cwsadd').innerText()), 15000, 'added chip');
    eq((await ch.evaluate(() => window.aib.invoke('cx:list'))).length, 1);
    await app.submit('aibrowser://home'); await sleep(500);
    assert(!(await ch.locator('#cwsadd').isVisible()), 'chip hidden on normal pages');
  });
  await test('手动“加载已解压扩展”仅作为高级选项（折叠）', async () => {
    await app.submit('aibrowser://extensions'); ep = await app.waitPage(u => u.startsWith('aibrowser://extensions')); await sleep(400);
    eq(await ep.locator('details.adv-load').count(), 1); assert(!(await ep.locator('details.adv-load #loadchrome').isVisible()), 'collapsed by default');
    await ep.click('details.adv-load summary'); assert(await ep.locator('#loadchrome').isVisible());
  });
  await app.close(); server.close();
  // live: the real Chrome Web Store (uBlock Origin Lite), skipped when offline
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-cws-live-'));
  const app2 = await launch({ userData: ud2 }); const ch2 = await app2.chrome();
  await test('真实 Chrome 应用商店：在线安装 uBlock Origin Lite（无网络则跳过）', async () => {
    const r = await ch2.evaluate(() => window.aib.invoke('cx:installStore', 'https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh'));
    if (!r.ok && /Cannot reach|无法连接/.test(r.error)) { console.log('      (offline: ' + r.error + ')'); return; }
    assert(r.ok, r.error); assert(/ublock/i.test(r.ext.name), r.ext.name);
    const l = await ch2.evaluate(() => window.aib.invoke('cx:list')); eq(l.length, 1); assert(l[0].enabled && l[0].mv === 3, JSON.stringify(l[0]));
  }, { timeout: 90000 });
  await app2.close();
};
