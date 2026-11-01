// Generates the v3.4.0 element-library example scenes (extensions/builtin/physics/examples/el_*.json) through the same
// PhysElements API the editor and the agent tools use, so every example is validated by construction.
// usage: node scripts/gen-element-examples.js
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'extensions', 'builtin', 'physics');
['modules', 'rigid', 'elements', 'elements-types', 'sim'].forEach((f) => require(path.join(dir, f + '.js')));
const PE = global.PhysElements, S = global.PhysSim, D2R = Math.PI / 180;
const out = [];
function scene(id, zh, title, world, els, extra) {
  const d = Object.assign({ topic: 'elements.' + id.replace(/^el_/, ''), zh, meta: { title, zh }, g: 9.8, world, bodies: [], elements: [] }, extra || {});
  els.forEach((e) => { const t = e[0]; const r = PE.add(d, t, e[1]); if (!r.ok) throw new Error(id + ': ' + t + ' ' + r.errors.join(';')); });
  const v = S.validate(d); if (!v.ok) throw new Error(id + ': ' + v.errors.join(';'));
  const s = S.defaults(JSON.parse(JSON.stringify(d))); if (s._el && s._el.warnings.length) throw new Error(id + ' warnings: ' + s._el.warnings.join(';'));
  fs.writeFileSync(path.join(dir, 'examples', id + '.json'), JSON.stringify(d, null, 1) + '\n'); out.push({ id, topic: d.topic, zh, title });
}
// 1 horizontal conveyor
scene('el_conveyor_horizontal', '水平传送带（物块加速到带速）', 'Horizontal conveyor belt', { xmin: -6, xmax: 6, ymin: -1.5, ymax: 3.5 }, [
  ['conveyor', { id: 'belt', x: 0, y: 0, len: 10, thick: 0.15, speed: 2, mu0: 0.6, mu: 0.4, e: 0, label: '传送带 v=2 m/s' }],
  ['block', { id: 'blk', x: -4, y: 0.275, w: 0.4, h: 0.4, mass: 1, mu0: 0.6, mu: 0.4, e: 0, label: '物块' }],
  ['readout', { id: 'rv', target: 'blk', qty: 'vx', x: -5.5, y: 3, plot: true, label: '物块' }],
  ['readout', { id: 'rf', target: 'blk', qty: 'f', x: -5.5, y: 2.5, label: '摩擦力' }],
  ['trace', { id: 'tr', target: 'blk', interval: 0.25 }]
]);
// 2 inclined conveyor
{
  const th = 30, up = { x: Math.cos(th * D2R), y: Math.sin(th * D2R) }, n = { x: -up.y, y: up.x }; const o = 0.275, along = 2.5;
  scene('el_conveyor_incline', '倾斜传送带（物块随带上行）', 'Inclined conveyor belt', { xmin: -2, xmax: 10, ymin: -1, ymax: 6 }, [
    ['conveyor', { id: 'belt', x: 1, y: 0, angle: th, len: 9, thick: 0.15, speed: 2, mu0: 0.9, mu: 0.7, e: 0, label: '传送带 30°' }],
    ['block', { id: 'blk', x: +(1 + n.x * o + up.x * 0.5).toFixed(4), y: +(n.y * o + up.y * 0.5).toFixed(4), angle: th, w: 0.4, h: 0.4, mass: 1, mu0: 0.9, mu: 0.7, e: 0, label: '物块' }],
    ['readout', { id: 'rv', target: 'blk', qty: 'speed', x: -1.8, y: 5.2, plot: true, label: '物块' }],
    ['readout', { id: 'rf', target: 'blk', qty: 'f', x: -1.8, y: 4.6, label: '摩擦力' }]
  ]);
}
// 3 Atwood machine with a massive pulley
scene('el_atwood', '阿特伍德机（有质量滑轮）', 'Atwood machine (massive pulley)', { xmin: -2.5, xmax: 2.5, ymin: -0.5, ymax: 5.5 }, [
  ['pulley', { id: 'pul', x: 0, y: 5, r: 0.15, ideal: false, mass: 0.5, fixed: true, label: '滑轮 M=0.5 kg' }],
  ['block', { id: 'A', x: -0.15, y: 3, w: 0.2, h: 0.2, mass: 2, label: 'A 2 kg', color: '#4d8fd1' }],
  ['block', { id: 'B', x: 0.15, y: 3, w: 0.2, h: 0.2, mass: 1, label: 'B 1 kg', color: '#e0a23a' }],
  ['rope', { id: 'rope', a: 'A', ax: 0, ay: 0.1, b: 'B', bx: 0, by: 0.1, via: 'pul' }],
  ['readout', { id: 'ra', target: 'A', qty: 'a', x: -2.3, y: 5.2, label: 'A' }],
  ['readout', { id: 'rT', target: 'rope', qty: 'T', x: -2.3, y: 4.7, label: '绳张力' }]
]);
// 4 block on plank
scene('el_block_on_plank', '木板—木块（滑块滑上木板）', 'Block sliding on a plank', { xmin: -4, xmax: 6, ymin: -1, ymax: 3 }, [
  ['ground', { id: 'g', x: 0, y: -0.5, w: 30, thick: 1, mu0: 0.1, mu: 0.1, e: 0 }],
  ['plank', { id: 'pl', x: 0, y: 0.1, w: 4, h: 0.2, mass: 2, mu0: 0.4, mu: 0.4, e: 0, label: '木板 M=2 kg' }],
  ['block', { id: 'blk', x: -1.7, y: 0.35, w: 0.3, h: 0.3, mass: 1, vx: 3, mu0: 0.4, mu: 0.4, e: 0, label: '物块 m=1 kg v₀=3' }],
  ['frictionPair', { id: 'f1', a: 'blk', b: 'pl', mu0: 0.4, mu: 0.4, e: 0 }],
  ['frictionPair', { id: 'f2', a: 'pl', b: 'g', mu0: 0.1, mu: 0.1, e: 0 }],
  ['readout', { id: 'rb', target: 'blk', qty: 'vx', x: -3.8, y: 2.6, plot: true, label: '物块' }],
  ['readout', { id: 'rp', target: 'pl', qty: 'vx', x: -3.8, y: 2.1, plot: true, label: '木板' }]
]);
// 5 loop-the-loop
{
  const Rq = 2, h = 1.6, phi = Math.acos((Rq - h) / Rq);
  scene('el_loop_the_loop', '竖直圆环轨道（过最高点）', 'Loop-the-loop', { xmin: -3.5, xmax: 5, ymin: -0.5, ymax: 3 }, [
    ['loop', { id: 'loop', x: 0, y: 0, R: 0.5, Rq, floor: 0.6, exitLen: 3, mu0: 0.02, mu: 0.01, e: 0 }],
    ['ball', { id: 'ball', r: 0.05, k: 0.4, mass: 0.1, mu0: 0, mu: 0, e: 0, x: +(-0.6 - (Rq - 0.05) * Math.sin(phi)).toFixed(4), y: +(Rq - (Rq - 0.05) * Math.cos(phi)).toFixed(4), label: 'h=1.6 m' }],
    ['readout', { id: 'rv', target: 'ball', qty: 'speed', x: -3.3, y: 2.7, plot: true, label: '小球' }],
    ['trace', { id: 'tr', target: 'ball', interval: 0.08 }]
  ]);
}
// 6 rails + rod
scene('el_rails_rod', '导轨与导体棒（电磁感应）', 'Rails and rod (induction)', { xmin: -1, xmax: 9, ymin: -1.5, ymax: 3 }, [
  ['rails', { id: 'rails', x: 0, y: 0.8, len: 8, gap: 1, B: 1, into: true, R: 1, Rr: 0.2, M: 0.2, F: 1, incline: 0, s0: 0.5, label: 'B=1 T  F=1 N' }],
  ['readout', { id: 'rv', target: 'rails', qty: 'speed', x: 0, y: 2.6, plot: true, label: '棒' }],
  ['readout', { id: 'ri', target: 'rails', qty: 'I', x: 0, y: 2.1, label: '电流' }],
  ['readout', { id: 're', target: 'rails', qty: 'emf', x: 3, y: 2.1, label: '电动势' }]
]);
// 7 mass spectrometer
scene('el_mass_spectrometer', '质谱仪（电场加速 + 磁场偏转）', 'Mass spectrometer', { xmin: -1.5, xmax: 6.5, ymin: -3.5, ymax: 2 }, [['massSpectrometer', { id: 'ms', x: 0, y: 0 }]]);
// 8 prism dispersion
scene('el_prism_dispersion', '三棱镜色散', 'Prism dispersion', { xmin: -5, xmax: 7, ymin: -4, ymax: 3 }, [
  ['lightSource', { id: 'src', x: -4, y: -1.0, angle: 19.5, mode: 'beam', count: 1, spread: 0, white: true, label: '白光' }],
  ['prism', { id: 'prism', x: 0, y: 0, angle: 0, n: 1.52, disp: 0.08, apex: 60, side: 2 }],
  ['screen', { id: 'scr', x: 5.5, y: -1.6, angle: 90, len: 4.2 }]
]);
// register in index.json (idempotent)
const idxPath = path.join(dir, 'examples', 'index.json'); const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')).filter((e) => !/^el_/.test(e.id)); out.forEach((o) => idx.push(o)); fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n');
console.log('wrote ' + out.length + ' element examples');
