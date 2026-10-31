'use strict';
const { launch, sleep, seedSettings } = require('../lib/app');
const fs = require('fs'), path = require('path'), os = require('os');

module.exports = async ({ test, group, assert, until }) => {
  group('AI 自修改代码（v3.2.0）');
  const selfmod = () => require('../../src/main/selfmod');

  await test('单元：允许 renderer；拒绝 passwords/secrets；propose→diff→apply→rollback', async () => {
    // Electron app needed for app.getPath — use launched app IPC instead
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-sm-'));
    seedSettings(ud, { onboarding: { completed: true } });
    const app = await launch({ userData: ud });
    try {
      const ch = await app.chrome();
      const inv = (c, a) => ch.evaluate(({ c, a }) => window.aib.invoke(c, a), { c, a });
      // blocked
      let err = '';
      try { await inv('selfmod:propose', { title: 'bad', files: [{ path: 'src/main/passwords.js', content: 'x' }] }); } catch (e) { err = String(e.message || e); }
      assert(/blocked|password/i.test(err), err);
      try { await inv('selfmod:propose', { title: 'bad2', files: [{ path: 'src/main/store.js', content: 'x' }] }); } catch (e) { err = String(e.message || e); }
      assert(/blocked|store/i.test(err), err);
      // propose ok
      const p = await inv('selfmod:propose', {
        title: 'greet tweak', description: 'test',
        files: [{ path: 'src/renderer/static/home.js', content: '/* patched by test */\n' + (await inv('selfmod:read', 'src/renderer/static/home.js')).content + '\n// end\n' }]
      });
      assert(p.id && p.files[0].diff.includes('+'), JSON.stringify(p).slice(0, 200));
      const pend = await inv('selfmod:pending');
      assert(pend && pend.id === p.id, 'pending');
      await inv('selfmod:apply', p.id);
      const ov = path.join(ud, 'selfmod', 'overlay', 'src', 'renderer', 'static', 'home.js');
      assert(fs.existsSync(ov) && fs.readFileSync(ov, 'utf8').includes('patched by test'), 'overlay written');
      // bundle untouched: original still exists without our marker in app path — check project file
      const bundle = fs.readFileSync(path.join(__dirname, '../../src/renderer/static/home.js'), 'utf8');
      assert(!bundle.includes('patched by test'), 'bundle not overwritten');
      await inv('selfmod:rollback', p.id);
      assert(!fs.existsSync(ov) || !fs.readFileSync(ov, 'utf8').includes('patched by test') || fs.readFileSync(ov,'utf8') === (await inv('selfmod:read','src/renderer/static/home.js')).content, 'rolled');
      const hist = await inv('selfmod:history');
      assert(hist.some(h => h.id === p.id && h.status === 'rolled_back'), JSON.stringify(hist));
      // safe mode
      await inv('selfmod:setSafeMode', true);
      assert((await inv('selfmod:state')).safeMode === true);
      await inv('selfmod:setSafeMode', false);
    } finally { await app.close(); }
  });

  await test('UI：selfmod 页显示待批准补丁；工具名已注册', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-sm2-'));
    seedSettings(ud, { onboarding: { completed: true } });
    const app = await launch({ userData: ud });
    try {
      const ch = await app.chrome();
      await ch.evaluate(async () => {
        await window.aib.invoke('selfmod:propose', {
          title: 'UI patch', description: 'for ui',
          files: [{ path: 'docs/wiki/Roadmap.md', content: '# Roadmap\n\npatched\n' }]
        });
      });
      await app.submit('aibrowser://selfmod');
      const p = await app.waitPage(u => u.startsWith('aibrowser://selfmod'), 10000);
      await until(async () => (await p.locator('#approve').count()) === 1, 5000, 'approve btn');
      assert((await p.locator('.diff').innerText()).length > 10, 'diff shown');
      p.on('dialog', async d => { try { await d.accept(); } catch {} });
      await p.click('#approve');
      await until(async () => (await p.locator('#approve').count()) === 0, 8000, 'applied clears pending');
      const src = fs.readFileSync(path.join(__dirname, '../../src/main/ai/tools.js'), 'utf8');
      for (const n of ['code_propose_patch', 'code_pending_patch', 'code_list_patches', 'code_rollback', 'code_safe_mode']) assert(src.includes(n), n);
    } finally { await app.close(); }
  });
};
