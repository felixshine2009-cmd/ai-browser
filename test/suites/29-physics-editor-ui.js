'use strict';
// v3.4.0 — physics element editor, driven in the real Electron app: palette add, canvas select, inspector edit (live + range check),
// undo/redo, delete, and the phys_* element tools through the same Bridge.panelCall path the agent uses.
const { launch, sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer } = require('../lib/mock-server');
const fs = require('fs'), path = require('path'), os = require('os');

module.exports = async ({ test, group, assert, until }) => {
  group('物理元件库：桌面端编辑器 UI 冒烟');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-pe-'));
  const llm = await createLlmServer(); seedSettings(ud, apiSettings(llm.port));
  const app = await launch({ userData: ud, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  await app.chrome();
  await app.setMode('chat'); await app.submit('牛顿第二定律'); await sleep(300);
  const p = await app.waitPage(u => u.startsWith('aibrowser://chat'), 10000); await sleep(2000);
  const call = (m, a) => p.evaluate(([m, a]) => Bridge.panelCall('aib.physics', 'canvas', m, a || {}), [m, a]);
  const frame = () => p.frames().find(f => f.url().includes('aib.physics/panel.html'));
  const els = async () => (await call('getElements')).elements;

  await test('工具：phys_list_element_types 返回 54 类；newScene + addElement 成功，越界参数被拒绝并给出范围', async () => {
    const t = await call('listElementTypes'); assert(t.ok && t.types.length >= 54, 'types ' + (t.types && t.types.length));
    await call('newScene'); await sleep(600);
    const a = await call('addElement', { type: 'ground', x: 0, y: 0 }); assert(a.ok, JSON.stringify(a));
    const b = await call('addElement', { type: 'block', x: 0, y: 1, mass: 2 }); assert(b.ok && b.id, JSON.stringify(b));
    const bad = await call('addElement', { type: 'block', x: 0, y: 3, mass: -5 }); assert(!bad.ok && /mass/.test(JSON.stringify(bad.errors)), JSON.stringify(bad));
    const u = await call('updateElement', { id: b.id, props: { mu: 0.3 } }); assert(u.ok, JSON.stringify(u));
    assert((await els()).find(e => e.id === b.id).mu === 0.3, 'mu applied');
  });

  await test('UI：调色板点击添加；画布点选；检查器修改质量实时生效；越界值被拒；撤销/重做；Delete 删除', async () => {
    const fr = await until(() => frame(), 8000, 'physics frame');
    const n0 = (await els()).length;
    // The chat side panel is small (collapsed layout, palette partly below the fold) → drive the controls through the DOM, as a tap would.
    await fr.evaluate(() => { const pal = document.getElementById('palette'); if (getComputedStyle(pal).display === 'none') document.getElementById('palToggle').click(); });
    assert(await fr.locator('.pal-item').count() >= 54, 'palette items');
    await fr.evaluate(() => {   // a tap = pointerdown + pointerup without movement
      const b = document.querySelector('.pal-item[data-type="ball"]'), r = b.getBoundingClientRect();
      const o = { clientX: r.left + 5, clientY: r.top + 5, pointerId: 3, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, bubbles: true };
      b.dispatchEvent(new PointerEvent('pointerdown', o)); b.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { buttons: 0 })));
    }); await sleep(300);
    let all = await els(); assert(all.length === n0 + 1 && all[all.length - 1].type === 'ball', 'ball added');
    const id = all[all.length - 1].id;
    await fr.evaluate(i => {   // select by a real pointer tap on the element's on-screen position
      const sp = window.aibPhysDebug.screenOf(i), cv = document.getElementById('cv');
      const o = { clientX: sp.x, clientY: sp.y, pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, bubbles: true };
      cv.dispatchEvent(new PointerEvent('pointerdown', o)); cv.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, o, { buttons: 0 })));
    }, id); await sleep(300);
    assert((await fr.locator('.ins-head').textContent()).includes(id), 'inspector shows ' + id);
    const m = fr.locator('#inspector input[data-k="mass"]');
    await fr.evaluate(() => { const i = document.querySelector('#inspector input[data-k="mass"]'); i.value = '4.5'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(200); assert((await els()).find(e => e.id === id).mass === 4.5, 'mass live');
    await fr.evaluate(() => { const i = document.querySelector('#inspector input[data-k="mass"]'); i.value = '-1'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(200); assert(/bad/.test(await m.getAttribute('class')) && (await els()).find(e => e.id === id).mass === 4.5, 'range rejected');
    await fr.evaluate(() => document.querySelector('.ebtn[title^="Undo"]').click()); await sleep(200); assert((await els()).find(e => e.id === id).mass !== 4.5, 'undo');
    await fr.evaluate(() => document.querySelector('.ebtn[title^="Redo"]').click()); await sleep(200); assert((await els()).find(e => e.id === id).mass === 4.5, 'redo');
    await fr.evaluate(() => document.querySelector('.ebtn[title^="Delete"], .ebtn[title^="删除"]').click()); await sleep(200);
    assert(!(await els()).some(e => e.id === id), 'deleted');
  });

  await test('示例：el_conveyor_horizontal / el_atwood 载入并运行，时间推进', async () => {
    for (const id of ['el_conveyor_horizontal', 'el_atwood', 'el_loop_the_loop']) {
      const r = await call('loadExample', { id }); assert(r.ok, id + JSON.stringify(r)); await sleep(500);
      await call('play'); await sleep(700); await call('pause');
      const s = await call('state'); assert((s.t || 0) > 0.1 && s.elements && s.elements.length > 1, id + ' ' + JSON.stringify(s).slice(0, 200));
    }
  });

  await test('自定义元件：phys_define_custom_element → 添加；列表包含「我的元件」', async () => {
    await call('newScene');
    const d = await call('defineCustomElement', { id: 'my_heavy', zh: '重块', base: 'block', defaults: { mass: 20 } }); assert(d.ok, JSON.stringify(d));
    const a = await call('addElement', { type: 'my_heavy', x: 0, y: 2 }); assert(a.ok, JSON.stringify(a));
    assert((await els()).find(e => e.id === a.id).mass === 20, 'preset applied');
    const t = await call('listElementTypes', { category: 'mine' }); assert(t.types.some(x => x.id === 'my_heavy'), 'listed');
  });

  await app.close();
  try { llm.close && llm.close(); } catch (e) {}
};
