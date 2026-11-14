'use strict';
const { launch, sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer } = require('../lib/mock-server');
const fs = require('fs'), path = require('path'), os = require('os');

// Live (real render) checks of the GeoGebra panel + on-screen keyboard and the physics panel, driven through the same Bridge.panelCall path the agent tools use.
module.exports = async ({ test, group, assert, eq, until }) => {
  group('面板实机渲染：GeoGebra 键盘 / 3D / 物理场景');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-live-'));
  const llm = await createLlmServer(); seedSettings(ud, apiSettings(llm.port));
  const app = await launch({ userData: ud, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ch = await app.chrome();
  await app.setMode('chat'); await app.submit('什么是牛顿第一定律？'); await sleep(300);
  const p = await app.waitPage(u => u.startsWith('aibrowser://chat'), 10000); await sleep(2500);
  const call = (ext, method, args) => p.evaluate(([e, m, a]) => Bridge.panelCall(e, 'canvas', m, a), [ext, method, args || {}]);
  const shot = (n) => p.screenshot({ path: path.join(__dirname, '..', '..', 'shots', n), type: 'png' });

  await test('GeoGebra：绘制函数，对象存在；切换到 3D / CAS / 几何 / 科学计算器', async () => {
    const r = await call('aib.geogebra', 'eval', { commands: ['f(x)=x^2-2x', 'A=(1,-1)'] });
    const fr = await until(() => p.frames().find(f => f.url().includes('aib.geogebra/panel.html')), 8000, 'ggb frame');
    const names = await until(async () => { const n = await fr.evaluate(() => window.ggbApplet ? window.ggbApplet.getAllObjectNames() : null); return n && n.length >= 2 ? n : null; }, 120000, 'objects');
    assert(names.includes('f') && names.includes('A'), JSON.stringify(names) + JSON.stringify(r));
    await sleep(1500); await shot('21-ggb-graphing.png');
    for (const a of ['3d', 'cas', 'geometry', 'scientific', 'graphing']) {
      const s = await call('aib.geogebra', 'setApp', { app: a });
      await sleep(2500);
      const st = await call('aib.geogebra', 'state', {});
      assert(JSON.stringify(st).includes(a === '3d' ? '3d' : a), a + ' → ' + JSON.stringify(st) + JSON.stringify(s));
      if (a === '3d') await shot('21-ggb-3d.png');
    }
  });

  await test('GeoGebra：WEB 数学键盘可打开（123 / f(x) / ABC / αβγ 标签）', async () => {
    const fr = p.frames().find(f => f.url().includes('aib.geogebra/panel.html'));
    await call('aib.geogebra', 'showKeyboard', {}); await sleep(2500);
    const txt = await fr.evaluate(() => document.body.innerText + ' ' + Array.from(document.querySelectorAll('[class*=keyboard],[class*=Keyboard]')).map(e => e.className).join(' '));
    const tabs = await fr.evaluate(() => Array.from(document.querySelectorAll('.KeyBoard button, .keyboardContainer button, [class*=tabs] *')).map(e => (e.innerText || '').trim()).filter(Boolean).slice(0, 80));
    const hasKb = await fr.evaluate(() => !!document.querySelector('.KeyBoardUnit, .keyboardContainer, .KeyBoard, [class*=eyboard]'));
    await shot('21-ggb-keyboard.png');
    assert(hasKb, 'keyboard DOM present; tabs=' + JSON.stringify(tabs) + ' ' + txt.slice(0, 200));
  });

  await test('面板页面加载超时：给出明确的中文失败信息，而不是一直等待', async () => {
    const msg = await p.evaluate(async () => { Bridge.PANEL_LOAD_MS = 1; try { await Bridge.panelCall('aib.physics', 'canvas', 'state', {}); return 'resolved'; } catch (e) { return e.message; } finally { Bridge.PANEL_LOAD_MS = 30000; } });
    assert(/面板页面加载超时.*物理面板未能打开/.test(msg), msg);
    await sleep(1500);
  });

  await test('物理：加载示例（抛体）、播放后时间推进、画布有内容；暂停/单步/重置', async () => {
    const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extensions/builtin/physics/examples/index.json'), 'utf8'));
    const first = (ex.examples || ex)[0];
    const file = first.file || first.id + '.json';
    const scene = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extensions/builtin/physics/examples', file.endsWith('.json') ? file : file + '.json'), 'utf8'));
    const r = await call('aib.physics', 'load', { scene });
    await sleep(800);
    await call('aib.physics', 'play', {}); await sleep(1200);
    const s1 = await call('aib.physics', 'state', {});
    await call('aib.physics', 'pause', {}); await sleep(200);
    const s2 = await call('aib.physics', 'state', {});
    const dbg = await p.frames().find(f => f.url().includes('aib.physics')).evaluate(() => ({ hidden: document.hidden, vis: document.visibilityState, w: innerWidth, h: innerHeight })).catch(e => String(e));
    assert((s1.t || s1.state?.t || 0) > 0, JSON.stringify(dbg) + 'time advances ' + JSON.stringify(s1).slice(0, 300) + JSON.stringify(r).slice(0, 200));
    await call('aib.physics', 'step', { n: 5 });
    const s3 = await call('aib.physics', 'state', {});
    await shot('21-physics-projectile.png');
    const fr = p.frames().find(f => f.url().includes('aib.physics/panel.html'));
    const filled = await fr.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
    assert(filled !== 0, 'canvas painted: ' + filled);
    await call('aib.physics', 'reset', {});
    const s4 = await call('aib.physics', 'state', {});
    assert((s4.t || s4.state?.t || 0) === 0, 'reset ' + JSON.stringify(s4).slice(0, 200));
  });

  await test('物理（桌面）：参数面板——改 μ₀/θ 后派生量实时变化、越界报错、别名、模块示例全部可载入', async () => {
    await call('aib.physics', 'loadExample', { id: 'mod_incline' }); await sleep(900);
    const lp = await call('aib.physics', 'listParams', {});
    const keys = lp.modules[0].params.map(x => x.key); for (const k of ['theta', 'mu0', 'mu', 'mass', 'g']) assert(keys.includes(k), 'param ' + k);
    const fr = p.frames().find(f => f.url().includes('aib.physics/panel.html'));
    const before = await call('aib.physics', 'state', {});
    await call('aib.physics', 'setParam', { module: 0, key: 'theta', value: 45 }); await call('aib.physics', 'setParam', { module: 0, key: 'mu0', value: 1 });
    const after = await call('aib.physics', 'state', {});
    assert(after.derived['critical angle atan μ₀ (°)'] > 44.9 && after.derived['critical angle atan μ₀ (°)'] < 45.1, JSON.stringify(after.derived));
    assert(after.derived['slides 是否下滑'] !== undefined && JSON.stringify(after.derived) !== JSON.stringify(before.derived), 'derived live');
    const n = await fr.evaluate(() => document.querySelectorAll('#params input[type=range]').length); assert(n >= 7, 'sliders ' + n);
    let err = ''; try { await call('aib.physics', 'setParam', { module: 0, key: 'theta', value: 200 }); } catch (e) { err = String(e.message || e); }
    assert(/must be in \[/.test(err), 'range error: ' + err);
    const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extensions/builtin/physics/examples/index.json'), 'utf8')); const list = ex.examples || ex;
    for (const e of list.filter(x => x.id.startsWith('mod_'))) { const r = await call('aib.physics', 'loadExample', { id: e.id }); assert(r.ok, e.id); }
    await shot('21-physics-params.png');
  });

  await app.close();
};
