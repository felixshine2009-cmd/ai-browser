'use strict';
const { launch, sleep, seedSettings, apiSettings, patchSettings } = require('../lib/app');
const { createWebServer, createLlmServer } = require('../lib/mock-server');
const os = require('os'), fs = require('fs'), path = require('path');
const FIX = path.join(__dirname, '..', 'fixtures', 'dict');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('词典拓展：MDX/MDD');
  const llm = await createLlmServer(); const web = await createWebServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-dict-'));
  seedSettings(ud, apiSettings(llm.port));
  const dict2 = path.join(ud, 'dict2'); fs.mkdirSync(dict2);
  fs.copyFileSync(path.join(FIX, 'test.mdx'), path.join(dict2, 'second.mdx')); fs.copyFileSync(path.join(FIX, 'test.mdd'), path.join(dict2, 'second.mdd'));
  const pickFile = path.join(ud, 'pick.json');
  const app = await launch({ userData: ud, env: { AIB_TEST_PICK_FILE: pickFile } });
  const ch = await app.chrome();
  const ask = async (text) => { await app.setMode('chat'); await app.submit(text); await sleep(200); return app.waitPage(u => u.startsWith('aibrowser://chat')); };
  const dictFrame = async (p, i = 0) => { const f = await until(async () => { const fr = p.frames().filter(f => f.url().startsWith('aibdict://')); return fr.length > i ? fr[fr.length - 1 - 0] : null; }, 10000, 'dict frame'); return f; };

  await test('内置“词典”拓展预装、默认启用，遵循功能拓展标准清单', async () => {
    const l = await ch.evaluate(() => window.aib.invoke('ext:list'));
    const d = l.find(e => e.id === 'aib.dictionary');
    assert(d && d.builtin && d.enabled && d.version === '1.0.0' && d.update_url && d.permissions.includes('host.dictionary'), JSON.stringify(d));
    assert(d.contributes.inputHandlers[0].types.includes('word') && d.settingsPage.startsWith('aibext://aib.dictionary/'));
  });
  await test('设置页“词典”：通过文件选择导入 .mdx（同名 .mdd 自动加载）', async () => {
    fs.writeFileSync(pickFile, JSON.stringify([path.join(FIX, 'test.mdx')]));
    await app.submit('aibrowser://settings#dict');
    const sp = await app.waitPage('aibrowser://settings');
    await sp.click('[data-nav="dict"]');
    const fr = await until(() => sp.frames().find(f => f.url().includes('aib.dictionary/settings.html')), 10000, 'dict settings frame');
    await until(async () => (await fr.locator('#add').innerText()).includes('添加词典'), 8000, 'settings loaded');
    await fr.click('#add');
    await until(async () => (await fr.locator('.row').count()) === 1 && (await fr.locator('.row b').innerText()) === 'Test Dict', 8000, 'row');
    const s = await ch.evaluate(() => window.aib.invoke('settings:get'));
    eq(s.dicts.length, 1); eq(s.dicts[0].mdd.length, 1, 'mdd auto-detected');
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '08-settings-dictionary.png'));
  });
  await test('查词：Chat 输入英文单词 → 词典标签页 + 隔离 iframe 渲染词条', async () => {
    const p = await ask('abandon');
    await until(async () => (await p.locator('.dict-tabs .dt[data-kind="dict"]').count()) === 1, 10000, 'dict tab');
    eq(await p.locator('.dict-tabs .dt').first().innerText(), 'Test Dict');
    const f = await dictFrame(p);
    await until(async () => (await f.locator('.hw').count()) === 1, 8000, 'entry rendered');
    eq(await p.locator('.dict-frame').getAttribute('sandbox'), 'allow-scripts allow-popups');
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '03-dictionary-word.png'));
  });
  await test('词典资源：MDD 中的 CSS 生效、图片加载、音频可取', async () => {
    const p = await app.waitPage(u => u.startsWith('aibrowser://chat')); const f = await dictFrame(p);
    const color = await f.locator('.hw').evaluate(e => getComputedStyle(e).color + '|' + getComputedStyle(e).fontSize);
    eq(color, 'rgb(1, 2, 3)|22px', 'css from mdd applied');
    const w = await f.locator('img').evaluate(i => new Promise(r => { if (i.complete) r(i.naturalWidth); else i.onload = () => r(i.naturalWidth); }));
    eq(w, 24, 'image from mdd');
    const au = await f.evaluate(async () => { const r = await fetch(new URL('beep.wav', document.baseURI)); return [r.status, r.headers.get('content-type'), (await r.arrayBuffer()).byteLength]; });
    eq(au.slice(0, 2), [200, 'audio/wav']); assert(au[2] > 1000);
  });
  await test('sound:// 链接点击播放 MDD 音频（解析到 aibdict 资源）', async () => {
    const p = await app.waitPage(u => u.startsWith('aibrowser://chat')); const f = await dictFrame(p);
    await f.locator('a.snd').click();
    const src = await until(async () => f.evaluate(() => window.__aud && window.__aud.src), 5000, 'audio element');
    assert(/^aibdict:\/\/d[0-9a-f]+\/beep\.wav$/.test(src), src);
    const st = await until(async () => f.evaluate(() => window.__aud.readyState), 8000, 'audio loaded');
    assert(st >= 1, 'audio readyState ' + st);
  });
  await test('@@@LINK 重定向：abandoned → abandon 词条', async () => {
    const p = await ask('abandoned');
    await until(async () => (await p.locator('.dict-frame').count()) === 1, 10000, 'frame');
    const f = await dictFrame(p);
    await until(async () => (await f.locator('.hw').count()) === 1, 8000, 'rendered');
    eq(await f.locator('.hw').innerText(), 'abandon');
  });
  await test('词形还原：abandons / running→run 能查到', async () => {
    const p = await ask('abandons');
    await until(async () => (await p.locator('.dict-frame').count()) === 1, 10000, 'frame for inflected form');
    const p2 = await ask('running');
    await until(async () => (await p2.locator('.dict-frame').count()) === 1, 10000, 'frame running');
    const f = await dictFrame(p2); await until(async () => (await f.locator('.hw').count()) === 1, 8000);
    eq(await f.locator('.hw').innerText(), 'run');
  });
  await test('entry:// 链接在词典框内跳转到 abandonment', async () => {
    const p = await ask('abandon'); const f = await dictFrame(p);
    await until(async () => (await f.locator('a[href^="entry://"]').count()) === 1, 8000, 'entry link');
    await f.locator('a[href^="entry://"]').click();
    await until(async () => { const fr = p.frames().filter(x => x.url().includes('__entry__')); return fr.length && fr[fr.length - 1].url().includes('abandonment'); }, 8000, 'navigated');
    const f2 = await dictFrame(p);
    await until(async () => (await f2.locator('.hw').innerText().catch(() => '')) === 'abandonment', 8000, 'abandonment entry');
  });
  await test('前缀联想：rpc suggest 与结果页“相近词”', async () => {
    const r = await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'suggest', { prefix: 'aban' }));
    assert(['abandon', 'abandoned', 'abandonment'].every(w => r.includes(w)), JSON.stringify(r));
    const p = await ask('abandon');
    await until(async () => (await p.locator('.dict-suggest .chip').count()) >= 2, 8000, 'chips');
    assert((await p.locator('.dict-suggest .chip').allInnerTexts()).includes('abandonment'));
  });
  await test('多词典：第二本词典出现为第二个标签；排序与启用/停用生效', async () => {
    fs.writeFileSync(pickFile, JSON.stringify([path.join(dict2, 'second.mdx')]));
    await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'pickAndAdd', {}));
    let s = await ch.evaluate(() => window.aib.invoke('settings:get')); eq(s.dicts.length, 2);
    await ch.evaluate(() => window.aib.invoke('settings:patch', {}));
    const id2 = s.dicts[1].id;
    let p = await ask('abandon');
    await until(async () => (await p.locator('.dict-tabs .dt[data-kind="dict"]').count()) === 2, 10000, 'two tabs');
    await ch.evaluate((id) => window.aib.invoke('ext:rpc', 'aib.dictionary', 'move', { id, delta: -1 }), id2);
    s = await ch.evaluate(() => window.aib.invoke('settings:get')); eq(s.dicts[0].id, id2, 'moved first');
    await ch.evaluate((id) => window.aib.invoke('ext:rpc', 'aib.dictionary', 'setEnabled', { id, enabled: false }), id2);
    p = await ask('abandon');
    await until(async () => (await p.locator('.dict-tabs .dt[data-kind="dict"]').count()) === 1, 10000, 'one tab after disabling');
    await ch.evaluate((id) => window.aib.invoke('ext:rpc', 'aib.dictionary', 'setEnabled', { id, enabled: true }), id2);
  });
  await test('网页划词/双击查词弹窗（选中单词后弹出词典浮层）', async () => {
    await app.setMode('search');
    await app.submit(`http://127.0.0.1:${web.port}/words`);
    const wp = await app.waitPage(`127.0.0.1:${web.port}/words`);
    await until(async () => (await wp.locator('#w').count()) === 1, 8000);
    await wp.locator('#w').dblclick();
    const lk = await app.waitPage('aibrowser://lookup', 8000);
    await until(async () => (await lk.locator('.dict-tabs .dt').count()) >= 1, 8000, 'lookup popup dict tabs');
    assert(lk.url().includes('q=abandon'));
    await app.screenshot(path.join(__dirname, '..', '..', 'shots', '09-selection-lookup-popup.png'));
    await lk.keyboard.press('Escape').catch(() => {});
    await until(() => !app.pages().some(p => p.url().startsWith('aibrowser://lookup')), 4000, 'popup closed');
  });
  await test('关闭词典拓展后：单词回退为 AI 生成词条（带标注）', async () => {
    await ch.evaluate(() => window.aib.invoke('ext:setEnabled', 'aib.dictionary', false));
    const p = await ask('serendipity');
    await until(async () => (await p.locator('.ai-note').count()) === 1, 15000, 'ai note');
    eq(await p.locator('.dict-frame').count(), 0);
    await ch.evaluate(() => window.aib.invoke('ext:setEnabled', 'aib.dictionary', true));
  });
  await test('词典未命中的单词回退为 AI 词条', async () => {
    const p = await ask('zzyzxq');
    await until(async () => (await p.locator('.ai-note').count()) === 1, 15000, 'ai fallback on miss');
  });
  await test('重启后词典配置保留且仍可查词', async () => {
    await app.close(); await sleep(500);
    const a2 = await launch({ userData: ud });
    await a2.setMode('chat'); await a2.submit('abandon');
    const p = await a2.waitPage(u => u.startsWith('aibrowser://chat'));
    await until(async () => (await p.locator('.dict-tabs .dt[data-kind="dict"]').count()) >= 1, 10000, 'dict after restart');
    await a2.close();
  });
  await llm.close(); await web.close();
};
