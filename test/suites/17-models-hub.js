'use strict';
const { launch, sleep } = require('../lib/app');
const { hfServer } = require('../lib/mock-models');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');

// Felix: built-in catalog (Qwen / Gemma / Hunyuan-MT … grouped by family), hf-mirror default + endpoint switch + fallback,
// Hugging Face search / file picker / download (progress, resume, cancel, sha), custom models in the list, roles.
module.exports = async ({ test, group, assert, eq, until }) => {
  group('模型：目录 / 家族分组 / HF 搜索与下载 / 下载源 / 角色');
  const rnd = (n, seed) => { const b = Buffer.alloc(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >> 16; } return b; };
  const hf = await hfServer({
    'acme/Tiny-Qwen3-GGUF': { tags: ['gguf', 'license:apache-2.0'], downloads: 4321, likes: 12, files: { 'tiny-Q4_K_M.gguf': rnd(700000, 1), 'tiny-Q8_0.gguf': rnd(1200000, 2) } },
    'acme/Tiny-Gemma-GGUF': { tags: ['gguf'], downloads: 99, likes: 3, files: { 'gemma-tiny-Q4_K_M.gguf': rnd(300000, 3) } },
    'acme/Broken-GGUF': { tags: ['gguf'], downloads: 1, likes: 0, badSha: 'broken-Q4_K_M.gguf', files: { 'broken-Q4_K_M.gguf': rnd(100000, 4) } },
    'mlx-community/Tiny-Qwen3-4bit': { tags: ['mlx', 'license:apache-2.0'], downloads: 55, likes: 2, files: { 'config.json': Buffer.from('{"model_type":"qwen3"}'), 'model.safetensors': rnd(400000, 5), 'tokenizer.json': Buffer.from('{}') } }
  });
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-hub-'));
  let app = await launch({ userData: ud, env: { AIB_HF_BASE: hf.base } }); let ch = await app.chrome();
  const inv = (c, ...a) => ch.evaluate(([c, a]) => window.aib.invoke(c, ...a), [c, a]);
  const settings = async (hash) => { await app.submit('aibrowser://settings#' + hash); const p = await app.waitPage('aibrowser://settings'); await sleep(500); return p; };
  const local = async () => { const p = await settings('ai'); await p.click('[data-src="local"]'); await until(async () => (await p.locator('.fam-group').count()) > 0, 6000, 'groups'); return p; };

  await test('内嵌目录：Qwen3 / Qwen2.5 / Gemma 4 / Gemma 3n / Gemma 3 / Hunyuan-MT / EmbeddingGemma，含 GGUF 与 MLX 变体，带大小与内存', async () => {
    const l = await inv('lm:list'); const fams = new Set(l.map(x => x.family));
    for (const f of ['Qwen3', 'Qwen2.5', 'Gemma 4', 'Gemma 3n', 'Gemma 3', 'Hunyuan-MT', 'EmbeddingGemma']) assert(fams.has(f), 'family ' + f + ' in ' + [...fams].join(','));
    for (const x of l) { assert(x.size && x.ram && x.repo && x.family, 'fields ' + x.id); }
    assert(l.some(x => x.family === 'Gemma 4' && x.engine === 'llama') && l.some(x => x.family === 'Gemma 4' && x.engine === 'mlx'), 'gemma4 gguf+mlx');
    assert(l.some(x => x.family === 'Gemma 3' && x.repo.startsWith('mlx-community/')), 'gemma3 mlx-community');
    assert(l.find(x => x.id === 'qwen2.5-1.5b-instruct-q4_k_m'), 'legacy id kept');
  });
  await test('设置 → AI → 本地模型：按家族折叠；点击展开/收起（平滑动画）；头部显示家族名、数量、体积范围', async () => {
    const p = await local();
    const names = await p.$$eval('.fam-group .fam-name', e => e.map(x => x.innerText)); assert(names.includes('Gemma 4') && names.includes('Qwen3'), names.join(','));
    const g = p.locator('.fam-group[data-family="Gemma 3"]'); const head = g.locator('.fam-head');
    assert(/个|models/.test(await head.locator('.fam-meta').innerText()) && /[MG]B/.test(await head.locator('.fam-meta').innerText()), await head.locator('.fam-meta').innerText());
    eq(await head.getAttribute('aria-expanded'), 'false'); assert(!(await g.locator('.model-row').first().isVisible()), 'collapsed rows hidden');
    const tr = await g.locator('.fam-body').evaluate(e => getComputedStyle(e).transitionProperty + '|' + getComputedStyle(e).transitionDuration); assert(/grid-template-rows/.test(tr) && !/\b0s\b/.test(tr.split('|')[1]), 'animated: ' + tr);
    await head.click(); await until(async () => (await g.locator('.model-row').first().isVisible()), 2000, 'expanded'); eq(await head.getAttribute('aria-expanded'), 'true');
    await head.click(); await until(async () => !(await g.locator('.model-row').first().isVisible()), 2000, 'collapsed again');
  });
  await test('单选仍然有效：选中某型号 → 仅一个选中、所在家族自动展开并显示“已选中”；重新打开设置页时自动展开该组', async () => {
    let p = await local(); const id = 'gemma-3-1b-it-q4_k_m' ;
    const l = await inv('lm:list'); const gem = l.find(x => x.family === 'Gemma 3' && x.engine === 'llama'); assert(gem, 'a Gemma 3 gguf entry');
    await p.click('.fam-group[data-family="Gemma 3"] .fam-head'); await sleep(300);
    await p.locator(`.model-row[data-model="${gem.id}"] .m-name`).click(); await until(async () => (await p.locator('.model-row.selected').count()) >= 1, 3000, 'selected');
    eq(await p.locator('.model-row.selected[data-model]').evaluateAll(e => e.filter(x => x.closest('#mlist')).length), 1);
    eq(await p.locator(`.model-row[data-model="${gem.id}"]`).getAttribute('aria-checked'), 'true');
    assert((await p.locator('.fam-group[data-family="Gemma 3"] .fbadge.sel').count()) === 1, 'selected badge');
    const s = (await inv('settings:get')).ai.local; eq(s.modelId, gem.id); eq(s.roles.chat, 'llama:' + gem.id);
    // fresh render: group with the selection is open, the others are closed
    p = await local(); eq(await p.locator('.fam-group[data-family="Gemma 3"] .fam-head').getAttribute('aria-expanded'), 'true');
    eq(await p.locator('.fam-group[data-family="Qwen2.5"] .fam-head').getAttribute('aria-expanded'), 'false');
    // switching to another family moves the selection
    await p.click('.fam-group[data-family="Qwen3"] .fam-head'); await sleep(300);
    const q = l.find(x => x.family === 'Qwen3' && x.engine === 'llama'); await p.locator(`.model-row[data-model="${q.id}"] .radio`).click();
    await until(async () => (await inv('settings:get')).ai.local.roles.chat === 'llama:' + q.id, 3000, 'switched');
    eq(await p.locator('#mlist .model-row.selected').count(), 1);
  });
  await test('下载源：默认 hf-mirror；可切换 huggingface.co / 自定义；“测试连接”显示每个源的结果', async () => {
    const p = await local(); eq(await p.locator('#hubep').inputValue(), 'mirror');
    assert((await p.locator('#hubep option:checked').innerText()).includes('hf-mirror.com'));
    await p.selectOption('#hubep', 'custom'); await until(async () => !(await p.locator('#hubcustom').isHidden()), 2000, 'custom input');
    await p.fill('#hubcustom', hf.base); await p.press('#hubcustom', 'Enter'); await p.locator('#hubcustom').blur(); await sleep(300);
    let h = (await inv('settings:get')).ai.local.hub; eq(h.endpoint, 'custom'); eq(h.custom, hf.base);
    await p.click('#hubprobe'); await until(async () => (await p.locator('.probe-row').count()) >= 1, 6000, 'probe rows');
    assert((await p.locator('.probe-row').first().innerText()).includes('127.0.0.1'));
    await p.selectOption('#hubep', 'mirror'); await sleep(300); eq((await inv('settings:get')).ai.local.hub.endpoint, 'mirror');
  });
  await test('HF 搜索（GGUF）：按家族分组显示 repo / 下载量 / 点赞 / 引擎；展开文件列表显示量化、大小、内存', async () => {
    const p = await local(); await p.fill('#hfq', 'tiny'); await p.click('#hfgo');
    await until(async () => (await p.locator('.hf-repo').count()) >= 2, 8000, 'results');
    await p.evaluate(() => document.querySelectorAll('#hfres .fam-group:not(.open) .fam-head').forEach(h => h.click())); await sleep(400);
    const txt = await p.locator('#hfres').innerText(); assert(txt.includes('acme/Tiny-Qwen3-GGUF') && txt.includes('4321') && /llama\.cpp/.test(txt), txt);
    assert(!txt.includes('mlx-community'), 'gguf filter excludes mlx');
    await p.locator('#hfres .fam-head').first().click().catch(() => {}); await p.evaluate(() => document.querySelectorAll('#hfres .fam-group:not(.open) .fam-head').forEach(h => h.click())); await sleep(300);
    await p.locator('.hf-repo[data-repo="acme/Tiny-Qwen3-GGUF"] [data-act="files"]').click();
    await until(async () => (await p.locator('.hf-repo[data-repo="acme/Tiny-Qwen3-GGUF"] .hf-file').count()) === 2, 6000, 'files');
    const ft = await p.locator('.hf-repo[data-repo="acme/Tiny-Qwen3-GGUF"] .hf-files').innerText(); assert(/Q4_K_M/.test(ft) && /Q8_0/.test(ft) && /RAM/.test(ft) && /(KB|MB)/.test(ft), ft);
  });
  await test('下载自定义模型：进度条、完成后出现在模型列表（可选中）、sha256 校验通过、文件落盘', async () => {
    const p = await local(); hf.state.slowMs = 25;
    await p.fill('#hfq', 'tiny'); await p.click('#hfgo'); await until(async () => (await p.locator('.hf-repo').count()) >= 2, 8000);
    await p.evaluate(() => document.querySelectorAll('#hfres .fam-group:not(.open) .fam-head').forEach(h => h.click())); await sleep(300);
    await p.locator('.hf-repo[data-repo="acme/Tiny-Gemma-GGUF"] [data-act="files"]').click();
    await p.locator('.hf-repo[data-repo="acme/Tiny-Gemma-GGUF"] .hf-file button').click();
    await until(async () => (await p.locator('#mlist .model-row[data-model^="hf:acme/Tiny-Gemma-GGUF"] .progress').count()) === 1, 8000, 'progress bar');
    await until(() => fs.existsSync(path.join(ud, 'models')) && fs.readdirSync(path.join(ud, 'models')).some(f => f.includes('gemma-tiny') && !f.endsWith('.part')), 30000, 'file on disk');
    hf.state.slowMs = 0; await sleep(500);
    const l = await inv('lm:list'); const ent = l.find(x => x.id.startsWith('hf:acme/Tiny-Gemma-GGUF')); assert(ent && ent.downloaded, JSON.stringify(ent));
    const f = fs.readdirSync(path.join(ud, 'models')).find(x => x.includes('gemma-tiny')); assert(fs.statSync(path.join(ud, 'models', f)).size === 300000);
    const q = await local(); await q.evaluate(() => document.querySelectorAll('#mlist .fam-group:not(.open) .fam-head').forEach(h => h.click())); await sleep(300);
    const row = q.locator(`#mlist .model-row[data-model="${ent.id}"]`); assert(await row.isVisible(), 'custom model listed'); await row.locator('.m-name').click();
    await until(async () => (await inv('settings:get')).ai.local.roles.chat === 'llama:' + ent.id, 3000, 'custom selectable');
  }, { timeout: 60000 });
  await test('取消 → 继续（HTTP Range 续传，字节一致）', async () => {
    hf.state.slowMs = 40; hf.state.ranges.length = 0; const p = await local();
    await p.fill('#hfq', 'Tiny-Qwen3'); await p.click('#hfgo'); await until(async () => (await p.locator('.hf-repo').count()) >= 1, 8000);
    await p.evaluate(() => document.querySelectorAll('#hfres .fam-group:not(.open) .fam-head').forEach(h => h.click())); await sleep(300);
    await p.locator('.hf-repo[data-repo="acme/Tiny-Qwen3-GGUF"] [data-act="files"]').click();
    await until(async () => (await p.locator('.hf-repo[data-repo="acme/Tiny-Qwen3-GGUF"] .hf-file').count()) === 2, 6000);
    await p.locator('.hf-repo[data-repo="acme/Tiny-Qwen3-GGUF"] .hf-file', { hasText: 'Q4_K_M' }).locator('button').click();
    const id = 'hf:acme/Tiny-Qwen3-GGUF/tiny-Q4_K_M.gguf';
    const dest = () => { const d = path.join(ud, 'models'); return fs.readdirSync(d).filter(x => x === 'tiny-Q4_K_M.gguf' || x === 'tiny-Q4_K_M.gguf.part'); };
    await until(() => dest().some(x => x.endsWith('.part') && fs.statSync(path.join(ud, 'models', x)).size > 20000), 20000, 'partial data');
    await p.evaluate(() => document.querySelectorAll('#mlist .fam-group:not(.open) .fam-head').forEach(h => h.click())); await sleep(200);
    await p.locator(`#mlist .model-row[data-model="${id}"] [data-act="cancel"]`).click();
    await until(async () => /继续|Resume/.test(await p.locator(`#mlist .model-row[data-model="${id}"] [data-act="dl"]`).innerText().catch(() => '')), 8000, 'resume offered');
    const partSize = fs.statSync(path.join(ud, 'models', dest().find(x => x.endsWith('.part')))).size; assert(partSize > 0 && partSize < 700000, 'part ' + partSize);
    hf.state.slowMs = 0; await p.locator(`#mlist .model-row[data-model="${id}"] [data-act="dl"]`).click();
    await until(() => dest().some(x => !x.endsWith('.part')), 30000, 'finished');
    assert(hf.state.ranges.some(r => r.startsWith('bytes=') && Number(r.match(/\d+/)[0]) > 0), 'used Range: ' + hf.state.ranges.join(','));
    const buf = fs.readFileSync(path.join(ud, 'models', dest().find(x => !x.endsWith('.part')))); eq(buf.length, 700000);
    eq(crypto.createHash('sha256').update(buf).digest('hex'), crypto.createHash('sha256').update(rnd(700000, 1)).digest('hex'));
  }, { timeout: 90000 });
  await test('粘贴 repo id / HF 链接也能找到；MLX 搜索只给 mlx-community 且按快照下载（含全部文件）', async () => {
    const p = await local(); await p.fill('#hfq', 'https://huggingface.co/acme/Tiny-Gemma-GGUF'); await p.click('#hfgo');
    await until(async () => (await p.locator('.hf-repo[data-repo="acme/Tiny-Gemma-GGUF"]').count()) === 1, 8000, 'direct link');
    await p.click('#hfkind [data-kind="mlx"]'); await p.fill('#hfq', 'Tiny-Qwen3'); await p.click('#hfgo');
    await until(async () => (await p.locator('.hf-repo[data-repo="mlx-community/Tiny-Qwen3-4bit"]').count()) === 1, 8000, 'mlx result');
    assert(/MLX/.test(await p.locator('.hf-repo[data-repo="mlx-community/Tiny-Qwen3-4bit"]').innerText()));
    await p.evaluate(() => document.querySelectorAll('#hfres .fam-group:not(.open) .fam-head').forEach(h => h.click())); await sleep(300);
    await p.locator('.hf-repo[data-repo="mlx-community/Tiny-Qwen3-4bit"] [data-act="files"]').click();
    await until(async () => (await p.locator('.hf-repo[data-repo="mlx-community/Tiny-Qwen3-4bit"] .hf-file').count()) === 1, 6000);
    await p.locator('.hf-repo[data-repo="mlx-community/Tiny-Qwen3-4bit"] .hf-file button').click();
    const dir = path.join(ud, 'models', 'mlx', 'mlx-community__Tiny-Qwen3-4bit');
    await until(() => fs.existsSync(path.join(dir, '.aib-complete')), 30000, 'mlx snapshot complete');
    assert(fs.existsSync(path.join(dir, 'model.safetensors')) && fs.existsSync(path.join(dir, 'config.json')) && fs.existsSync(path.join(dir, 'tokenizer.json')));
  }, { timeout: 60000 });
  await test('清晰的失败原因：sha256 不匹配 / 仓库不存在 / 服务器 5xx / 全部下载源不可用', async () => {
    const p = await local();
    await p.click('#hfkind [data-kind="gguf"]'); await p.fill('#hfq', 'Broken'); await p.click('#hfgo'); await until(async () => (await p.locator('.hf-repo').count()) === 1, 8000);
    await p.evaluate(() => document.querySelectorAll('#hfres .fam-group:not(.open) .fam-head').forEach(h => h.click())); await sleep(300);
    await p.locator('.hf-repo [data-act="files"]').click(); await until(async () => (await p.locator('.hf-file').count()) === 1, 6000);
    await p.locator('.hf-file button').click();
    await until(async () => /sha256/i.test(await p.locator('#mlist .m-err').allInnerTexts().then(a => a.join(' ')).catch(() => '')), 15000, 'sha mismatch reason shown');
    const ud2 = ud; const brokenFiles = fs.readdirSync(path.join(ud2, 'models')).filter(x => x.includes('broken')); assert(brokenFiles.length === 0, 'corrupt file removed: ' + brokenFiles);
    hf.state.fail = 503; await p.fill('#hfq', 'tiny'); await p.click('#hfgo');
    await until(async () => /503|服务器错误|server error/i.test(await p.locator('#hfmsg').innerText()), 8000, '5xx reason'); hf.state.fail = null;
    const r = await inv('hub:files', 'nobody/nothing'); assert(r.ok === false && /不存在|not found|404/.test(r.error), JSON.stringify(r));
  }, { timeout: 60000 });
  await test('自动回退：首选源不可用时自动改用其他源（搜索 + 下载）', async () => {
    await app.close();
    const dsrv = require('http').createServer(); await new Promise(r => dsrv.listen(0, '127.0.0.1', r)); const dead = 'http://127.0.0.1:' + dsrv.address().port; await new Promise(r => dsrv.close(r)); // refuses connections
    app = await launch({ userData: ud, env: { AIB_HF_BASE: dead + ',' + hf.base } }); ch = await app.chrome();
    const r = await inv('hub:search', 'tiny', 'gguf'); assert(r.ok && r.items.length >= 2, JSON.stringify(r)); assert(r.via && r.via.includes(String(hf.port)), 'via ' + r.via);
    assert(Array.isArray(r.tried) && r.tried.length >= 1 && /refused|拒绝/.test(JSON.stringify(r.tried)), 'tried: ' + JSON.stringify(r.tried));
    const f = await inv('hub:files', 'acme/Tiny-Gemma-GGUF'); assert(f.ok && f.files.length === 1);
  });
  await test('角色：自定义模型可指定为 聊天 / 词典 / 翻译 / 嵌入；删除模型后角色被清空', async () => {
    const l = await inv('lm:list'); const ent = l.find(x => x.id.startsWith('hf:acme/Tiny-Qwen3-GGUF/')); assert(ent && ent.downloaded);
    const p = await local(); await sleep(600);
    for (const r of ['dictionary', 'translate', 'embedding']) { await p.selectOption(`[data-role="${r}"]`, 'llama:' + ent.id); await until(async () => (await inv('settings:get')).ai.local.roles[r] === 'llama:' + ent.id, 3000, r); await sleep(500); }
    const roles = (await inv('settings:get')).ai.local.roles; eq(roles.translate, 'llama:' + ent.id);
    await inv('hub:removeCustom', ent.id); const r2 = (await inv('settings:get')).ai.local.roles; eq(r2.translate, ''); eq(r2.dictionary, '');
    assert(!fs.readdirSync(path.join(ud, 'models')).some(x => x.startsWith('tiny-Q4_K_M')), 'files deleted');
  });
  await app.close(); await hf.close();
};
