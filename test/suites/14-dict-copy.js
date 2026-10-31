'use strict';
const { launch, sleep, seedSettings } = require('../lib/app');
const os = require('os'), fs = require('fs'), path = require('path');
const FIX = path.join(__dirname, '..', 'fixtures', 'dict');

// Felix: importing an MDX COPIES the whole dictionary (mdx + all .mdd + companion files) into userData/dictionaries/<name>/.
module.exports = async ({ test, group, assert, eq, until }) => {
  group('词典导入：复制到应用数据目录（mdx + 全部 mdd + 同目录资源）/ 删除 / 迁移');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-dcopy-'));
  const src = path.join(ud, 'orig', 'My Dict'); fs.mkdirSync(path.join(src, 'fonts'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'test.mdx'), path.join(src, 'test.mdx'));
  fs.copyFileSync(path.join(FIX, 'test.mdd'), path.join(src, 'test.mdd'));
  fs.copyFileSync(path.join(FIX, 'test.mdd'), path.join(src, 'test.1.mdd'));
  fs.writeFileSync(path.join(src, 'style.css'), '.hw{color:red}'); fs.writeFileSync(path.join(src, 'fonts', 'f.woff'), 'FONT');
  fs.copyFileSync(path.join(FIX, 'test.mdx'), path.join(src, 'other.mdx')); // a DIFFERENT dictionary in the same folder
  const pickFile = path.join(ud, 'pick.json');
  fs.writeFileSync(pickFile, JSON.stringify([path.join(src, 'test.mdx')]));
  let app = await launch({ userData: ud, env: { AIB_TEST_PICK_FILE: pickFile } });
  let ch = await app.chrome();
  const dictFrame = async (sp) => { await sp.click('[data-nav="dict"]'); return until(() => sp.frames().find(f => f.url().includes('aib.dictionary/settings.html')), 10000, 'dict frame'); };
  let target;
  await test('导入：复制 mdx、全部 mdd（含 .1.mdd）、css、子文件夹；不复制同目录的其他词典', async () => {
    await app.submit('aibrowser://settings#dict'); const sp = await app.waitPage('aibrowser://settings');
    const fr = await dictFrame(sp);
    await until(async () => (await fr.locator('#add').innerText()).includes('添加词典'), 8000, 'loaded');
    await fr.click('#add');
    await until(async () => (await fr.locator('.row b').count()) === 1, 10000, 'row');
    const s = await ch.evaluate(() => window.aib.invoke('settings:get'));
    const d = s.dicts[0]; target = d.dir;
    assert(d.mdx.startsWith(path.join(ud, 'dictionaries') + path.sep), 'mdx in app data: ' + d.mdx);
    assert(d.mdd.every(p => p.startsWith(target)) && d.mdd.length === 2, 'both mdd copied: ' + d.mdd.join(','));
    for (const f of ['test.mdx', 'test.mdd', 'test.1.mdd', 'style.css', 'fonts/f.woff']) assert(fs.existsSync(path.join(target, f)), 'copied ' + f);
    assert(!fs.existsSync(path.join(target, 'other.mdx')), 'other dictionary not copied');
    eq(d.origin, path.join(src, 'test.mdx'));
    const info = await fr.locator('.row .info').innerText(); assert(/占用 .*(KB|MB)/.test(info) && info.includes('已复制到应用数据'), info);
  });
  await test('删除/移动原文件后词典仍可用（使用副本）', async () => {
    fs.rmSync(path.join(ud, 'orig'), { recursive: true, force: true });
    const r = await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'lookup', { word: 'abandon' }));
    assert(Array.isArray(r) && r.length >= 1, 'lookup works from the copy: ' + JSON.stringify(r).slice(0, 100));
    const sp = await app.waitPage('aibrowser://settings'); const fr = await dictFrame(sp);
    assert(!(await fr.locator('.row.missing').count()), 'not flagged missing');
  });
  await test('同一词典不重复导入（按来源路径）', async () => {
    fs.mkdirSync(path.join(ud, 'orig', 'My Dict'), { recursive: true }); fs.copyFileSync(path.join(FIX, 'test.mdx'), path.join(ud, 'orig', 'My Dict', 'test.mdx'));
    const r = await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'pickAndAdd', {}));
    eq(r.added.length, 0); eq((await ch.evaluate(() => window.aib.invoke('settings:get'))).dicts.length, 1);
  });
  await test('删除词典：需确认；确认后删除复制的文件夹，取消则保留', async () => {
    const sp = await app.waitPage('aibrowser://settings'); const fr = await dictFrame(sp);
    await fr.click('.row .rm'); await fr.waitForSelector('.row .conf');
    await fr.click('.row .conf .no'); await sleep(300);
    assert(fs.existsSync(target), 'cancel keeps folder'); eq(await fr.locator('.row b').count(), 1);
    await fr.click('.row .rm'); await fr.waitForSelector('.row .conf'); await fr.click('.row .conf .yes');
    await until(async () => (await fr.locator('.row b').count()) === 0, 5000, 'row removed');
    assert(!fs.existsSync(target), 'folder deleted');
  });
  await app.close();

  // ---- startup migration of legacy path-referenced dictionaries
  const ud2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-dmig-'));
  const old = path.join(ud2, 'legacy'); fs.mkdirSync(old);
  fs.copyFileSync(path.join(FIX, 'test.mdx'), path.join(old, 'legacy.mdx')); fs.copyFileSync(path.join(FIX, 'test.mdd'), path.join(old, 'legacy.mdd'));
  seedSettings(ud2, { dicts: [
    { id: 'dlegacy', name: 'Legacy Dict', mdx: path.join(old, 'legacy.mdx'), mdd: [path.join(old, 'legacy.mdd')], enabled: true },
    { id: 'dgone', name: 'Gone Dict', mdx: '/nonexistent/path/gone.mdx', mdd: [], enabled: true }] });
  app = await launch({ userData: ud2 }); ch = await app.chrome();
  await test('启动迁移：原文件仍在 → 复制到应用目录；原文件缺失 → 标记“源文件缺失”并给出原因', async () => {
    await until(async () => { const s = await ch.evaluate(() => window.aib.invoke('settings:get')); return s.dicts.find(d => d.id === 'dlegacy' && d.dir); }, 15000, 'migrated');
    const s = await ch.evaluate(() => window.aib.invoke('settings:get'));
    const a = s.dicts.find(d => d.id === 'dlegacy'), g = s.dicts.find(d => d.id === 'dgone');
    assert(a.mdx.startsWith(path.join(ud2, 'dictionaries')) && fs.existsSync(a.mdx) && a.mdd.length === 1 && fs.existsSync(a.mdd[0]), JSON.stringify(a));
    assert(g.missing === true && /不存在|gone/.test(g.missingReason), JSON.stringify(g));
    fs.rmSync(old, { recursive: true, force: true });
    const r = await ch.evaluate(() => window.aib.invoke('ext:rpc', 'aib.dictionary', 'lookup', { word: 'abandon' }));
    assert(r.length >= 1, 'migrated copy works without the original');
    await app.submit('aibrowser://settings#dict'); const sp = await app.waitPage('aibrowser://settings'); const fr = await dictFrame(sp);
    await until(async () => (await fr.locator('.row.missing').count()) === 1, 6000, 'missing row');
    assert(/源文件缺失/.test(await fr.locator('.row.missing .info').innerText()));
  });
  await app.close();
};
