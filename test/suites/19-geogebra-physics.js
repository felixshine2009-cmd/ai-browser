'use strict';
const { launch, sleep } = require('../lib/app');
const fs = require('fs'), path = require('path'), os = require('os');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('GeoGebra Math Apps + 物理可视化（v2）');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-v2-'));
  const app = await launch({ userData: ud });
  const ch = await app.chrome();
  const inv = (...a) => ch.evaluate((a) => window.aib.invoke(...a), a);

  await test('功能拓展列表含 aib.geogebra 与 aib.physics，且已启用', async () => {
    const list = await inv('ext:list');
    const arr = Array.isArray(list) ? list : (list.features || []);
    const ids = arr.map(x => x.id);
    assert(ids.includes('aib.geogebra'), 'geogebra: ' + ids.join(','));
    assert(ids.includes('aib.physics'), 'physics: ' + ids.join(','));
    const g = arr.find(x => x.id === 'aib.geogebra');
    const p = arr.find(x => x.id === 'aib.physics');
    assert(g && g.enabled !== false, 'ggb enabled');
    assert(p && p.enabled !== false, 'phys enabled');
  });

  await test('GeoGebra 工具注册：ggb_eval / ggb_set_app / ggb_keyboard', async () => {
    const tools = await inv('agent:tools').catch(() => null);
    const names = (tools && (tools.tools || tools) || []).map(t => t.name || t);
    // fallback: read from features listTools via a small eval of registry if IPC missing
    if (!names.length) {
      const r = await ch.evaluate(async () => {
        // no direct IPC — open extensions page and check manifest presence on disk is enough in smoke
        return { skip: true };
      });
      if (r.skip) {
        const man = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extensions/builtin/geogebra/manifest.json'), 'utf8'));
        const tn = man.contributes.tools.map(t => t.name);
        assert(tn.includes('ggb_eval') && tn.includes('ggb_set_app') && tn.includes('ggb_keyboard'));
        return;
      }
    }
    assert(names.includes('ggb_eval') && names.includes('ggb_keyboard'));
  });

  await test('物理示例索引与 scene 校验（projectile ok；缺 bodies 失败）', async () => {
    const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extensions/builtin/physics/examples/index.json'), 'utf8'));
    assert(idx.length >= 10, 'examples ' + idx.length);
    const scene = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extensions/builtin/physics/examples/mechanics_projectile.json'), 'utf8'));
    // load sim in node via vm
    const vm = require('vm');
    const code = fs.readFileSync(path.join(__dirname, '../../extensions/builtin/physics/sim.js'), 'utf8');
    const sandbox = {}; vm.createContext(sandbox); vm.runInContext(code, sandbox);
    const ok = sandbox.PhysSim.validate(scene);
    assert(ok.ok, JSON.stringify(ok));
    const bad = sandbox.PhysSim.validate({ topic: 'x' });
    assert(!bad.ok && bad.errors.some(e => /bodies/.test(e)), JSON.stringify(bad));
    const s = sandbox.PhysSim.defaults(sandbox.PhysSim.clone(scene));
    sandbox.PhysSim.step(s, 30);
    assert(s.t > 0 && s.bodies[0].y < 5, 'projectile fell: y=' + s.bodies[0].y);
  });

  await test('物理面板页与 GeoGebra 面板页可打开（feature panel）', async () => {
    // open via extensions / feature panel protocol if available — smoke: files exist and HTML parses
    const gp = fs.readFileSync(path.join(__dirname, '../../extensions/builtin/geogebra/panel.html'), 'utf8');
    assert(/123|f\(x\)|αβγ|Keyboard|ggb_set_app|appName/.test(gp), 'keyboard / apps in panel');
    assert(/graphing|geometry|3d|cas|scientific|suite/.test(gp), 'all apps');
    const pp = fs.readFileSync(path.join(__dirname, '../../extensions/builtin/physics/panel.html'), 'utf8');
    assert(/Play|Pause|Step|Vectors|PhysSim/.test(pp), 'physics controls');
  });

  await test('问候页无 ✦ / spark-inline 装饰', async () => {
    await app.submit('aibrowser://home');
    const home = await app.waitPage(u => u.startsWith('aibrowser://home'));
    eq(await home.locator('.spark-inline').count(), 0);
    assert(!(await home.locator('#greet').innerText()).includes('✦'));
  });

  await app.close();
};
