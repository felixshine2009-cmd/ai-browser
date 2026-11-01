'use strict';
// v3.3.0 — confirmation dialog for every history clear + per-model disk usage / cache / delete. Real Electron app, no real downloads.
const { launch, sleep } = require('../lib/app');
const fs = require('fs'), path = require('path'), os = require('os');

module.exports = async ({ test, group, assert, until }) => {
  group('确认对话框 / 模型磁盘与清理（v3.3.0）');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-cf-'));
  const now = Date.now();
  const hist = [0, 1, 2, 3].map(i => ({ url: 'https://e.test/' + i, title: 'e' + i, time: i < 2 ? now - 60000 * (i + 1) : now - 3 * 3600e3 - i }));
  fs.writeFileSync(path.join(ud, 'history.json'), JSON.stringify(hist));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ onboarding: { completed: true, skipped: false, completedAt: 1 } }));
  // pretend two models exist: one complete, one with a .part
  fs.mkdirSync(path.join(ud, 'models'), { recursive: true });
  const app = await launch({ userData: ud, env: { AIB_TEST_HOOKS: '1', AIB_HF_BASE: 'http://127.0.0.1:9' } });
  const ch = await app.chrome();
  const inv = (c, ...a) => ch.evaluate(([c, a]) => window.aib.invoke(c, ...a), [c, a]);
  try {
    await test('历史页：清除 → 弹窗，默认焦点在“取消”，Esc / 点遮罩取消，不删除', async () => {
      await app.submit('aibrowser://history'); const p = await app.waitPage('aibrowser://history');
      await until(async () => (await p.locator('#lclear').count()) === 1, 8000, 'clear btn');
      await p.click('#lclear'); await p.waitForSelector('#aibc');
      assert((await p.evaluate(() => document.activeElement.id)) === 'aibc-cancel', 'default focus cancel');
      const txt = await p.innerText('#aibc'); assert(/4/.test(txt) && /确认清除/.test(txt) && /取消/.test(txt), txt);
      const cls = await p.getAttribute('#aibc-ok', 'class'); assert(/danger/.test(cls), 'danger button');
      await p.keyboard.press('Escape'); await sleep(150); assert((await p.locator('#aibc').count()) === 0, 'esc closes');
      assert((await inv('hist:list', '')).length === 4, 'nothing deleted after Esc');
      await p.click('#lclear'); await p.waitForSelector('#aibc'); await p.mouse.click(5, 5); await sleep(150);
      assert((await p.locator('#aibc').count()) === 0 && (await inv('hist:list', '')).length === 4, 'outside click cancels');
    });
    await test('按范围清除（最近一小时）→ 数量正确，确认后显示 已清除 N 条', async () => {
      const p = await app.waitPage('aibrowser://history');
      await p.selectOption('#lrange', 'hour'); await p.click('#lclear'); await p.waitForSelector('#aibc');
      const txt = await p.innerText('#aibc'); assert(/2 条/.test(txt) && /最近一小时/.test(txt), txt);
      await p.click('#aibc-ok'); await p.waitForSelector('#aibc-done');
      assert(/已清除 2 条/.test(await p.innerText('#aibc-done')), 'feedback');
      assert((await inv('hist:list', '')).length === 2, 'two older entries remain');
    });
    await test('设置 → 隐私：确认列出将删除的内容；确认后 已清除', async () => {
      await app.submit('aibrowser://settings#privacy'); const p = await app.waitPage('aibrowser://settings'); await sleep(500);
      await p.click('#clr'); await p.waitForSelector('#aibc');
      const txt = await p.innerText('#aibc'); assert(/历史记录：【全部】2 条/.test(txt), txt);
      await p.click('#aibc-cancel'); assert((await inv('hist:list', '')).length === 2, 'cancel keeps');
      await p.click('#clr'); await p.waitForSelector('#aibc'); await p.click('#aibc-ok'); await p.waitForSelector('#aibc-done');
      assert((await inv('hist:list', '')).length === 0, 'cleared');
    });
    await test('代理工具 history_clear：必须经同一弹窗；拒绝则不删除，同意才删除', async () => {
      assert((await inv('test:seedHistory', 3)) === 3, 'seeded');
      const p = await app.waitPage('aibrowser://settings');
      // decline
      let pr = ch.evaluate(() => window.aib.invoke('test:tool', 'history_clear', { range: 'all' }));
      await p.waitForSelector('#aibc', { timeout: 8000 });
      const txt = await p.innerText('#aibc'); assert(/AI/.test(txt) && /3/.test(txt), txt);
      assert((await p.evaluate(() => document.activeElement.id)) === 'aibc-cancel', 'default cancel');
      await p.click('#aibc-cancel'); const r1 = await pr;
      assert(r1.declined === true && r1.cleared === 0 && (await inv('hist:list', '')).length === 3, JSON.stringify(r1));
      // approve
      pr = ch.evaluate(() => window.aib.invoke('test:tool', 'history_clear', { range: 'all' }));
      await p.waitForSelector('#aibc', { timeout: 8000 }); await p.click('#aibc-ok'); const r2 = await pr;
      assert(r2.cleared === 3 && (await inv('hist:list', '')).length === 0, JSON.stringify(r2));
    });
    // ---- model disk usage
    const MB = 1024 * 1024; const embFile = path.join(ud, 'models', 'embeddinggemma-300M-Q8_0.gguf');
    fs.writeFileSync(embFile, Buffer.alloc(2 * MB, 1)); fs.writeFileSync(embFile + '.part', Buffer.alloc(MB / 2, 2)); fs.writeFileSync(embFile + '.part.json', '{}');
    await inv('settings:patch', { ai: { local: { roles: { embedding: 'llama:embeddinggemma-300m-q8_0' } } } });
    const openLocal = async () => { await app.submit('aibrowser://settings#ai'); const p = await app.waitPage('aibrowser://settings'); await sleep(500); await p.click('[data-src="local"]'); await until(async () => (await p.locator('[data-model="embeddinggemma-300m-q8_0"]').count()) > 0, 8000, 'row'); return p; };
    await test('磁盘：每个模型拆分 模型文件 / 缓存，并有汇总', async () => {
      const u = await inv('lm:disk'); const r = u.models.find(x => x.id === 'embeddinggemma-300m-q8_0');
      assert(r && r.files === 2 * MB && r.cache >= MB / 2, JSON.stringify(r && { f: r.files, c: r.cache }));
      assert(u.totals.files >= 2 * MB && u.totals.cache >= MB / 2 && Array.isArray(u.external) && u.external.every(x => x.readOnly), 'totals/external');
      const p = await openLocal(); const row = p.locator('[data-model="embeddinggemma-300m-q8_0"]');
      const t = await row.innerText(); assert(/模型文件 2 MB/.test(t) && /缓存 \d/.test(t) && /清理缓存/.test(t) && /删除模型文件/.test(t), t);
      assert(/磁盘占用/.test(await p.innerText('#diskbox')) && (await p.locator('#clrAllCache').count()) === 1, 'summary');
    });
    await test('清理缓存：弹窗确认 → 仅删 .part，模型仍在；显示 已释放', async () => {
      const p = await openLocal(); await p.click('[data-model="embeddinggemma-300m-q8_0"] [data-act="cc"]'); await p.waitForSelector('#aibc');
      assert((await p.evaluate(() => document.activeElement.id)) === 'aibc-cancel', 'default cancel');
      await p.click('#aibc-cancel'); assert(fs.existsSync(embFile + '.part'), 'cancel keeps part');
      await p.click('[data-model="embeddinggemma-300m-q8_0"] [data-act="cc"]'); await p.waitForSelector('#aibc'); await p.click('#aibc-ok'); await p.waitForSelector('#aibc-done');
      const ft = await p.innerText('#aibc-done'); assert(/已释放/.test(ft), 'feedback: ' + ft);
      assert(!fs.existsSync(embFile + '.part') && !fs.existsSync(embFile + '.part.json') && fs.statSync(embFile).size === 2 * MB, 'only cache removed');
    });
    await test('删除模型文件：说明将清空的角色；确认后文件删除、角色清空、提示知识库需要它并给出重新下载', async () => {
      const p = await openLocal(); await p.click('[data-model="embeddinggemma-300m-q8_0"] [data-act="delf"]'); await p.waitForSelector('#aibc');
      const t = await p.innerText('#aibc'); assert(/嵌入/.test(t) && /释放约 2 MB/.test(t), t);
      await p.keyboard.press('Escape'); await sleep(100); assert(fs.existsSync(embFile), 'esc keeps');
      await p.click('[data-model="embeddinggemma-300m-q8_0"] [data-act="delf"]'); await p.waitForSelector('#aibc'); await p.click('#aibc-ok'); await p.waitForSelector('#aibc-done');
      const ft2 = await p.innerText('#aibc-done'); assert(/已释放 2 MB/.test(ft2), 'freed text: ' + ft2);
      assert(!fs.existsSync(embFile), 'file deleted');
      const s = await inv('settings:get'); assert(!s.ai.local.roles.embedding, 'role cleared: ' + JSON.stringify(s.ai.local.roles));
      await until(async () => /知识库语义搜索需要/.test(await p.innerText('#diskmsg').catch(() => '')), 6000, 'kb notice');
      assert((await p.locator('#restoreModel').count()) === 1, 'restore button');
    });
    await test('工具：local_models_disk_usage 返回拆分；local_models_delete 经弹窗（拒绝不删除）', async () => {
      const u = await inv('test:tool', 'local_models_disk_usage'); assert(u.totals && 'files' in u.totals && Array.isArray(u.models), JSON.stringify(u).slice(0, 200));
      fs.writeFileSync(embFile, Buffer.alloc(MB, 3));
      const p = await app.waitPage('aibrowser://settings');
      const pr = ch.evaluate(() => window.aib.invoke('test:tool', 'local_models_delete', { id: 'embeddinggemma-300m-q8_0' }));
      await p.waitForSelector('#aibc', { timeout: 8000 }); assert(/AI/.test(await p.innerText('#aibc')), 'AI-labelled');
      await p.click('#aibc-cancel'); const r = await pr; assert(r.declined && fs.existsSync(embFile), JSON.stringify(r));
    });
    await test('工具 local_models_* 已注册；delete/clear 工具带确认', async () => {
      const src = fs.readFileSync(path.join(__dirname, '../../src/main/ai/tools.js'), 'utf8');
      for (const n of ['local_models_download', 'local_models_pause', 'local_models_resume', 'local_models_status', 'local_models_disk_usage', 'local_models_clear_cache', 'local_models_delete', 'history_clear']) assert(src.includes(`name: '${n}'`), n);
      assert((src.match(/require\('\.\.\/confirm'\)\.ask/g) || []).length >= 3, 'confirm used by clear/delete tools');
    });
  } finally { await app.close(); }
};
