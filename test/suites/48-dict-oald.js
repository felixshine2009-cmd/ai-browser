'use strict';
// v3.0.1 / desktop parity: large MDX dictionaries in the OALDPE style (own CSS, scripts that expand the senses,
// fonts and sounds in the .mdd) show the whole entry, and a reload of the dictionary / wiki tool stays on the result.
const { launch, sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer } = require('../lib/mock-server');
const { checkOald, entryFrame } = require('../lib/dict-oald-check');
const os = require('os'), fs = require('fs'), path = require('path');
const FIX = path.join(__dirname, '..', 'fixtures', 'dict-oald');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('词典：OALDPE 类词典完整显示（脚本、样式、字体、自动高度）与工具页刷新保留结果');
  const llm = await createLlmServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-oald-'));
  seedSettings(ud, apiSettings(llm.port));
  const src = path.join(ud, 'OALDPE'); fs.mkdirSync(src);
  for (const f of ['oald.mdx', 'oald.mdd']) fs.copyFileSync(path.join(FIX, f), path.join(src, f));
  const bare = path.join(ud, 'bare'); fs.mkdirSync(bare); fs.copyFileSync(path.join(FIX, 'oald.mdx'), path.join(bare, 'nomdd.mdx'));
  const pickFile = path.join(ud, 'pick.json');
  const app = await launch({ userData: ud, env: { AIB_TEST_PICK_FILE: pickFile } });
  const ch = await app.chrome();
  const toolPage = () => app.waitPage(u => /aibrowser:\/\/tool\/?\?id=dict/.test(u));
  try {
    await test('导入 OALDPE 类词典（.mdx + 同名 .mdd）', async () => {
      fs.writeFileSync(pickFile, JSON.stringify([path.join(src, 'oald.mdx')]));
      await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'pickAndAdd', {}));
      const s = await ch.evaluate(() => window.aib.invoke('settings:get'));
      eq(s.dicts.length, 1); eq(s.dicts[0].mdd.length, 1);
    });
    await test('词典工具查 apple：词典自带脚本展开全部义项，框高随内容，结果区可滚动到末行，白色背景不变', async () => {
      await ch.evaluate(() => window.aib.invoke('tool:open', 'dict'));
      const p = await toolPage();
      await until(async () => (await p.locator('#w').count()) === 1, 8000);
      await p.fill('#w', 'apple'); await p.press('#w', 'Enter');
      await checkOald({ page: p, until, assert, eq });
    });
    await test('@@@LINK：apples → apple 词条', async () => {
      const p = await toolPage();
      await p.fill('#w', 'apples'); await p.press('#w', 'Enter');
      await until(async () => /[?&]q=apples(&|$)/.test(p.url()), 8000, 'query');
      await until(async () => { const f = await entryFrame(p, until); return (await f.locator('.headword').innerText().catch(() => '')) === 'ap·ple' && await f.evaluate(() => document.body.classList.contains('oald-ready')); }, 10000, 'redirected to apple');
    });
    await test('刷新词典工具页：停留在结果页并重新查询（不回到工具首页）', async () => {
      const p = await toolPage();
      await p.fill('#w', 'apple'); await p.press('#w', 'Enter');
      await until(async () => /[?&]q=apple(&|$)/.test(p.url()), 5000, 'query kept in the address');
      await ch.evaluate(() => window.aib.invoke('nav:reload'));
      await sleep(800);
      const p2 = await toolPage();
      await until(async () => (await p2.locator('.dict-frame').count()) === 1, 15000, 'result shown again after reload');
      eq(await p2.inputValue('#w'), 'apple');
      assert(await p2.evaluate(() => document.querySelector('.tool-main').classList.contains('dict-reading')), 'result view');
    });
    await test('只导入 .mdx（缺少 .mdd）时，词条顶部提示缺少的资源', async () => {
      fs.writeFileSync(pickFile, JSON.stringify([path.join(bare, 'nomdd.mdx')]));
      await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'pickAndAdd', {}));
      const s = await ch.evaluate(() => window.aib.invoke('settings:get'));
      const id = s.dicts.find(d => /nomdd/.test(d.mdx)).id;
      await ch.evaluate((id) => window.aib.invoke('nav:openUrl', `aibdict://${id}/__entry__?key=apple`), id);
      const p = await app.waitPage(u => u.startsWith(`aibdict://${id}/__entry__`));
      await until(async () => (await p.locator('.aib-dict-missing').count()) === 1, 8000, 'missing note');
      const t = await p.locator('.aib-dict-missing').innerText();
      assert(/OALDPE\.css/.test(t) && /oaldpe\.js/.test(t) && /\.mdd/.test(t), t);
    });
    await test('文件名匹配：NFC 的 .mdx 与 NFD / 大写扩展名的 .mdd、分卷 .1.mdd 都被识别并按顺序链接', async () => {
      const name = 'OALDPE En-Cn V2024.8.10 Édition';
      const dir = path.join(ud, 'nfd'); fs.mkdirSync(dir);
      fs.copyFileSync(path.join(FIX, 'oald.mdx'), path.join(dir, name.normalize('NFC') + '.mdx'));
      fs.copyFileSync(path.join(FIX, 'oald.mdd'), path.join(dir, name.normalize('NFD') + '.1.mdd'));
      fs.copyFileSync(path.join(FIX, 'oald.mdd'), path.join(dir, name.normalize('NFD') + '.MDD'));
      assert(fs.readdirSync(dir).some(f => f !== f.normalize('NFC')), 'fixture really has NFD names');
      fs.writeFileSync(pickFile, JSON.stringify([path.join(dir, name.normalize('NFC') + '.mdx')]));
      await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'pickAndAdd', {}));
      const s = await ch.evaluate(() => window.aib.invoke('settings:get'));
      const d = s.dicts.find(x => /Édition/.test(x.mdx.normalize('NFC')));
      eq(d.mdd.map(x => path.basename(x)), [name.normalize('NFD') + '.MDD', name.normalize('NFD') + '.1.mdd'], 'both .mdd linked, main file first');
      assert(d.mdd.every(x => fs.existsSync(x)), 'copied');
    });
    await test('设置页“词典”：每本词典列出已链接的 .mdd；缺少时提示，并可稍后“添加资源…”', async () => {
      await app.submit('aibrowser://settings#dict');
      const sp = await app.waitPage('aibrowser://settings');
      await sp.click('[data-nav="dict"]');
      const fr = await until(() => sp.frames().find(f => f.url().includes('aib.dictionary/settings.html')), 10000, 'dict settings frame');
      await until(async () => (await fr.locator('.row').count()) >= 3, 8000, 'rows');
      const texts = await fr.locator('.row').evaluateAll(rs => rs.map(r => [r.querySelector('b').textContent, r.querySelector('.path').textContent, r.querySelector('.mdd').textContent, r.querySelector('.mdd').classList.contains('warn')]));
      const withMdd = texts.find(t => /oald\.mdx/.test(t[1]) && !/nomdd/.test(t[1]));
      assert(withMdd && /oald\.mdd/.test(withMdd[2]) && !withMdd[3], JSON.stringify(texts));
      const bare = texts.findIndex(t => /nomdd\.mdx/.test(t[1]));
      assert(bare >= 0 && texts[bare][3] && /未链接 \.mdd/.test(texts[bare][2]), JSON.stringify(texts));
      // add the .mdd later
      fs.writeFileSync(pickFile, JSON.stringify([path.join(FIX, 'oald.mdd')]));
      await fr.locator('.row').nth(bare).locator('button.res').click();
      await until(async () => /oald\.mdd/.test(await fr.locator('.row').nth(bare).locator('.mdd').innerText()), 8000, 'mdd listed after adding');
      const s = await ch.evaluate(() => window.aib.invoke('settings:get'));
      const id = s.dicts.find(d => /nomdd/.test(d.mdx)).id;
      await ch.evaluate((id) => window.aib.invoke('nav:openUrl', `aibdict://${id}/__entry__?key=apple&r=2`), id);
      const p = await app.waitPage(u => u.includes(`aibdict://${id}/__entry__?key=apple&r=2`));
      await until(async () => p.evaluate(() => document.body.classList.contains('oald-ready')), 8000, 'entry script from the added .mdd');
      eq(await p.locator('.aib-dict-missing').count(), 0, 'no missing note after adding the .mdd');
    });
    await test('只选择 .mdd：自动加入同名的已导入词典', async () => {
      const dir = path.join(ud, 'solo'); fs.mkdirSync(dir);
      fs.copyFileSync(path.join(FIX, 'oald.mdx'), path.join(dir, 'Solo Dict.mdx'));
      fs.writeFileSync(pickFile, JSON.stringify([path.join(dir, 'Solo Dict.mdx')]));
      await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'pickAndAdd', {}));
      let s = await ch.evaluate(() => window.aib.invoke('settings:get'));
      eq(s.dicts.find(d => /Solo Dict\.mdx$/.test(d.mdx)).mdd.length, 0);
      const later = path.join(ud, 'later'); fs.mkdirSync(later);
      fs.copyFileSync(path.join(FIX, 'oald.mdd'), path.join(later, 'solo dict.mdd'));
      fs.writeFileSync(pickFile, JSON.stringify([path.join(later, 'solo dict.mdd')]));
      const r = await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'pickAndAdd', {}));
      s = await ch.evaluate(() => window.aib.invoke('settings:get'));
      eq(s.dicts.find(d => /Solo Dict\.mdx$/.test(d.mdx)).mdd.map(x => path.basename(x)), ['solo dict.mdd'], JSON.stringify(r));
    });
  } finally { await app.close(); await llm.close?.(); }
};
