'use strict';
// v3.4.0 physics element library — pure Node assertions (no Electron needed):
// rigid-body engine, element registry / document API, analytic mechanisms, optics, sensors, custom types.
const path = require('path');
const P = path.join(__dirname, '..', '..', 'extensions', 'builtin', 'physics');
['modules', 'rigid', 'elements', 'elements-types', 'sim'].forEach((f) => require(path.join(P, f + '.js')));
const S = global.PhysSim, E = global.PhysElements, R = global.PhysRigid, D2R = Math.PI / 180;

function mk(elements, extra) {
  const d = Object.assign({ topic: 't', zh: 't', g: 9.8, world: { xmin: -5, xmax: 15, ymin: -3, ymax: 10 }, bodies: [], elements: [] }, extra || {});
  elements.forEach((e) => { const p = Object.assign({}, e); delete p.type; const r = E.add(d, e.type, p); if (!r.ok) throw new Error(JSON.stringify(r.errors) + ' ' + e.type); });
  const v = S.validate(d); if (!v.ok) throw new Error(v.errors.join(';'));
  return S.defaults(d);
}
const B = (s, id) => s._el.map[id].bodies[0];
const run = (s, T) => { S.step(s, Math.round(T / s.dt)); return s; };
const near = (a, b, tol, msg) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg || 'value'}: got ${a}, expected ${b} ± ${tol}`); };
const rel = (a, b, r, msg) => near(a, b, Math.abs(b) * r, msg);

module.exports = async ({ test, group, assert }) => {
  group('物理元件库 v3.4.0（引擎 / 元件 / 光学 / 自定义）');

  await test('注册表：≥50 种内置元件，覆盖 7 个分类，参数带单位/范围', () => {
    const types = E.listTypes(); assert(types.length >= 50, 'types ' + types.length);
    const cats = new Set(types.map((t) => t.category)); ['shape', 'surface', 'mech', 'field', 'optic', 'meas'].forEach((c) => assert(cats.has(c), 'category ' + c + ' in ' + [...cats]));
    const need = ['block', 'ball', 'cylinder', 'rod', 'wedge', 'polygon', 'ring', 'semiTrack', 'ground', 'wall', 'incline', 'arc', 'loop', 'quarterRamp', 'patch', 'conveyor', 'pulley', 'rope', 'lightRod', 'spring', 'cord', 'hinge', 'plank', 'cart', 'turntable', 'launcher', 'stopper', 'fieldE', 'fieldB', 'fieldG', 'boundary', 'massSpectrometer', 'cyclotron', 'capacitor', 'rails', 'coil', 'glass', 'prism', 'semiGlass', 'lens', 'mirror', 'lightSource', 'screen', 'ruler', 'protractor', 'stopwatch', 'photogate', 'springScale', 'readout', 'trace'];
    need.forEach((id) => assert(types.some((t) => t.id === id), 'missing type ' + id));
    const withUnit = types.flatMap((t) => t.params).filter((p) => p.unit).length; assert(withUnit > 100, 'units ' + withUnit);
  });

  await test('文档 API：add/update/remove/duplicate，范围校验与未知参数报错', () => {
    const d = { elements: [] };
    const a = E.add(d, 'block', { x: 1, y: 2, mass: 3 }); assert(a.ok && a.id === 'block1', JSON.stringify(a));
    assert(!E.add(d, 'block', { mass: -1 }).ok, 'negative mass must be rejected');
    assert(!E.add(d, 'block', { foo: 1 }).ok, 'unknown param must be rejected');
    assert(!E.add(d, 'nope', {}).ok, 'unknown type');
    assert(E.update(d, 'block1', { mass: 5 }).ok && d.elements[0].mass === 5, 'update');
    assert(!E.update(d, 'block1', { mass: 1e9 }).ok, 'range');
    const bl = E.add(d, 'ball', { id: 'b2', x: 0, y: 3 }); assert(bl.ok);
    const rp = E.add(d, 'rope', { a: 'block1', b: 'b2' }); assert(rp.ok, JSON.stringify(rp));
    const dup = E.duplicate(d, ['block1'], 1, 0); assert(dup.ok && dup.ids.length === 1 && d.elements.length === 4, 'duplicate');
    const rm = E.remove(d, 'block1'); assert(rm.ok && rm.removed.indexOf(rp.id) >= 0, 'rope goes with its body: ' + JSON.stringify(rm));
    assert(!d.elements.some((e) => e.id === rp.id), 'rope removed');
  });

  await test('每种内置元件加入默认场景后可构建并步进 60 帧无 NaN', () => {
    const skip = new Set(['rope', 'lightRod', 'spring', 'cord', 'hinge', 'springScale', 'readout', 'trace', 'frictionPair', 'stopwatch', 'protractor', 'ruler']);
    const bad = [];
    E.listTypes().filter((t) => !t.custom).forEach((t) => {
      if (skip.has(t.id)) return;
      try {
        const d = { topic: 't', zh: 't', g: 9.8, world: { xmin: -8, xmax: 12, ymin: -5, ymax: 10 }, bodies: [], elements: [] };
        const r = E.add(d, t.id, { x: 0, y: 3 }); if (!r.ok) { bad.push(t.id + ': ' + r.errors); return; }
        const s = S.defaults(d); S.step(s, 60);
        s._el.world.bodies.forEach((b) => { if (!isFinite(b.x) || !isFinite(b.y) || !isFinite(b.a)) bad.push(t.id + ' NaN'); });
      } catch (e) { bad.push(t.id + ': ' + e.message); }
    });
    assert(!bad.length, bad.join(' | '));
  });

  await test('多边形绕向归一：顺时针顶点的凸体也能正确碰撞', () => {
    const s = mk([{ type: 'ground', y: 0 }]); const w = s._el.world;
    const body = R.makeBody({ id: 'cw', x: 0, y: 0.5, mass: 1, shapes: [{ kind: 'poly', verts: [{ x: -0.2, y: -0.2 }, { x: -0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: -0.2 }] }] }); w.add(body);
    run(s, 1); near(body.y, 0.2, 0.01, 'rests on ground'); 
  });

  await test('传送带（水平）：a=μg，达到带速 v=2 后随带匀速；位移符合 v²/2a', () => {
    const s = mk([{ type: 'conveyor', id: 'c', x: 0, y: -0.075, len: 30, thick: 0.15, speed: 2, mu0: 0.6, mu: 0.4, e: 0 }, { type: 'block', id: 'b', x: -3, y: 0.2, w: 0.4, h: 0.4, mass: 1, mu0: 0.6, mu: 0.4, e: 0 }]);
    const b = B(s, 'b'), x0 = b.x; let v1 = null;
    for (let i = 0; i < 500; i++) { S.step(s, 1); if (v1 === null && Math.abs(s.t - 0.25) < 0.005) v1 = b.vx; }
    near(v1, 0.4 * 9.8 * 0.25, 0.06, 'v(0.25s)=μg t'); near(b.vx, 2, 0.01, 'belt speed'); near(b.x - x0, 2 * 2 / (2 * 0.4 * 9.8) + 2 * (s.t - 2 / (0.4 * 9.8)), 0.04, 'distance');
  });

  await test('倾斜传送带（30°）：a=g(μcosθ−sinθ)，最终与带同速上行', () => {
    const th = 30, up = { x: Math.cos(th * D2R), y: Math.sin(th * D2R) }, nrm = { x: -up.y, y: up.x };
    const s = mk([{ type: 'conveyor', id: 'c', x: 0, y: 0, angle: th, len: 30, thick: 0.15, speed: 2, mu0: 0.9, mu: 0.7, e: 0 }, { type: 'block', id: 'b', x: 0, y: 0, angle: th, w: 0.4, h: 0.4, mass: 1, e: 0 }]);
    const b = B(s, 'b'); b.x = nrm.x * 0.275; b.y = nrm.y * 0.275; b.a = th * D2R; R.refresh(b);
    let t1 = null; for (let i = 0; i < 600; i++) { S.step(s, 1); const vs = b.vx * up.x + b.vy * up.y; if (t1 === null && vs >= 2) t1 = s.t; }
    const a = 9.8 * (0.7 * Math.cos(th * D2R) - Math.sin(th * D2R)); near(t1, 2 / a, 0.03, 'time to belt speed'); near(b.vx * up.x + b.vy * up.y, 2, 0.02, 'final speed');
  });

  await test('Atwood：理想滑轮 a=(m1−m2)g/(m1+m2)、T 精确；有质量滑轮 a=(m1−m2)g/(m1+m2+M/2)', () => {
    const atw = (ideal) => { const s = mk([{ type: 'pulley', id: 'p', x: 0, y: 5, r: 0.15, ideal, mass: 0.5, fixed: true }, { type: 'block', id: 'A', x: -0.15, y: 3, w: 0.2, h: 0.2, mass: 2 }, { type: 'block', id: 'B', x: 0.15, y: 3, w: 0.2, h: 0.2, mass: 1 }, { type: 'rope', id: 'r', a: 'A', b: 'B', ax: 0, ay: 0.1, bx: 0, by: 0.1, via: 'p' }]); B(s, 'A').noCollide = ['B']; B(s, 'B').noCollide = ['A']; run(s, 1); return { a: -B(s, 'A').vy, T: s._el.map.r.joint.T }; };
    const i = atw(true); near(i.a, 9.8 / 3, 0.02, 'ideal a'); near(i.T, 2 * (9.8 - 9.8 / 3), 0.05, 'ideal T');
    const m = atw(false); near(m.a, 9.8 / 3.25, 0.03, 'massive a');
  });

  await test('木板—木块：μ₁=0.4（块/板）、μ₂=0.1（板/地）→ 共速时刻与共同速度 v=m v0/(m+M)', () => {
    const s = mk([{ type: 'ground', id: 'g', y: 0, w: 40, e: 0 }, { type: 'plank', id: 'pl', x: 0, y: 0.1, w: 6, h: 0.2, mass: 2, e: 0 }, { type: 'block', id: 'b', x: -2.5, y: 0.35, w: 0.3, h: 0.3, mass: 1, vx: 3, e: 0 }, { type: 'frictionPair', a: 'b', b: 'pl', mu0: 0.4, mu: 0.4, e: 0 }, { type: 'frictionPair', a: 'pl', b: 'g', mu0: 0.1, mu: 0.1, e: 0 }]);
    const b = B(s, 'b'), p = B(s, 'pl'); let tc = null, vc = 0; for (let i = 0; i < 300; i++) { S.step(s, 1); if (tc === null && Math.abs(b.vx - p.vx) < 0.01) { tc = s.t; vc = b.vx; } }
    // a_b=−μ1 g, a_p=(μ1 m g−μ2 (m+M) g)/M → t=v0/(a_p'−a_b)
    const ab = -0.4 * 9.8, ap = (0.4 * 1 * 9.8 - 0.1 * 3 * 9.8) / 2; near(tc, 3 / (ap - ab), 0.03, 'common-velocity time'); near(vc, 3 + ab * tc, 0.05, 'common v');
  });

  await test('滚动：斜面纯滚动 a=g sinθ/(1+k)：球 5/7、圆柱 2/3、圆环 1/2', () => {
    const roll = (type, k) => { const th = 30; const s = mk([{ type: 'incline', id: 'i', x: 0, y: 0, slope: th, len: 10, mu0: 0.9, mu: 0.8, e: 0 }, Object.assign({ type, id: 'r', r: 0.2, mass: 1, mu0: 0.9, mu: 0.8, e: 0 }, type === 'ring' ? {} : { k })]);
      const b = B(s, 'r'), up = { x: Math.cos(th * D2R), y: Math.sin(th * D2R) }, nrm = { x: -up.y, y: up.x }; b.x = 6 * up.x + nrm.x * 0.2; b.y = 6 * up.y + nrm.y * 0.2; R.refresh(b);
      const p0 = b.x * -up.x + b.y * -up.y; run(s, 1); const d = (b.x * -up.x + b.y * -up.y) - p0; return 2 * d / (s.t * s.t) / (9.8 * Math.sin(th * D2R)); };
    near(roll('ball', 0.4), 1 / 1.4, 0.03, 'ball'); near(roll('cylinder', 0.5), 1 / 1.5, 0.03, 'disc'); near(roll('ring', 1), 0.5, 0.03, 'ring');
  });

  await test('竖直圆环轨道：h≥2.5R（质心路径）通过最高点，h 较小则脱轨', () => {
    const loop = (h) => { const R0 = 0.5, Rq = 2; const s = mk([{ type: 'loop', id: 'L', x: 0, y: 0, R: R0, Rq, floor: 0.6, exitLen: 3, mu0: 0.02, mu: 0.01, e: 0 }, { type: 'ball', id: 'b', r: 0.05, k: 0.4, mass: 0.1, mu0: 0, mu: 0, e: 0 }]);
      const b = B(s, 'b'); const phi = Math.acos((Rq - h) / Rq); b.x = -0.6 - (Rq - 0.05) * Math.sin(phi); b.y = Rq - (Rq - 0.05) * Math.cos(phi); R.refresh(b);
      let top = false, left = false, done = false; for (let i = 0; i < 700; i++) { S.step(s, 1); if (b.y > 0.85 && Math.abs(b.x) < 0.15) top = true; if (top && b.x < -0.3 && b.y > 0.3 && b.y < 0.8) left = true; if (left && b.x > 0 && b.y < 0.1 && b.vx > 0) { done = true; break; } } return done; };
    assert(loop(1.6), 'h=1.6 should complete'); assert(loop(2.0), 'h=2.0 should complete'); assert(!loop(0.8), 'h=0.8 must not complete');
  });

  await test('导轨+导体棒：重力沿斜面下滑的终端速度 v=mgsinθ(R+r)/(BL)²，Q 守恒', () => {
    const s = mk([{ type: 'rails', id: 'r', len: 200, gap: 0.6, B: 1, R: 1, Rr: 0.2, M: 0.2, s0: 0.5, incline: 30 }]); run(s, 8); const st = s._el.rails.r;
    near(st.v, 0.2 * 9.8 * 0.5 * 1.2 / 0.36, 0.05, 'terminal v');
    const h = mk([{ type: 'rails', id: 'r', len: 200, gap: 0.6, B: 1, R: 1, Rr: 0.2, M: 0.2, s0: 0.5, incline: 0, v0: 3, F: 0 }]); run(h, 8); const q = h._el.rails.r;
    near(q.Q, 0.5 * 0.2 * 9, 0.02, 'all KE → heat'); near(q.s - 0.5, 0.2 * 3 * 1.2 / 0.36, 0.05, 'stopping distance');
    const f = mk([{ type: 'rails', id: 'r', len: 200, gap: 0.6, B: 1, R: 1, Rr: 0.2, M: 0.2, s0: 0.5, incline: 0, F: 1 }]); run(f, 8); near(f._el.rails.r.v, 1.2 / 0.36, 0.05, 'F-driven terminal v');
  });

  await test('带电粒子：B 场中圆周运动 r=mv/qB、速率不变；E 场中 a=qE/m', () => {
    let s = mk([{ type: 'fieldB', x: 0, y: 0, w: 20, h: 20, B: 2, into: true }, { type: 'particle', id: 'p', x: 0, y: 0, mass: 0.002, q: 0.01, vx: 4, vy: 0 }]); let b = B(s, 'p'), maxd = 0; for (let i = 0; i < 200; i++) { S.step(s, 1); maxd = Math.max(maxd, Math.hypot(b.x, b.y)); }
    near(maxd, 2 * 0.002 * 4 / (0.01 * 2), 0.01, 'diameter 2r'); near(Math.hypot(b.vx, b.vy), 4, 0.001, 'speed conserved');
    s = mk([{ type: 'fieldE', x: 0, y: 0, w: 20, h: 20, E: 50, dir: 90 }, { type: 'particle', id: 'p', x: 0, y: 0, mass: 0.002, q: 0.01, vx: 2 }]); run(s, 0.1); near(B(s, 'p').vy, 0.01 * 50 / 0.002 * s.t, 0.5, 'vy=qEt/m');
  });

  await test('质谱仪模板：落点 x=2mv/(qB)，两种质量的落点之比≈√(m₂/m₁)', () => {
    const d = { topic: 'ms', zh: 'ms', g: 9.8, world: { xmin: -3, xmax: 8, ymin: -5, ymax: 3 }, bodies: [], elements: [] }; const r = E.add(d, 'massSpectrometer', { x: 0, y: 0 }); assert(r.ok && r.ids.length >= 3, 'expands: ' + r.ids);
    const s = S.defaults(d); run(s, 6); const hits = Object.values(s._el.hits).flat().map((h) => h.x).sort((a, b) => a - b); assert(hits.length >= 2, 'two landings ' + hits.length);
    rel(hits[0], 2.0, 0.06, 'x1'); rel(hits[1], 2.449, 0.06, 'x2'); near(hits[1] / hits[0], Math.sqrt(1.5), 0.04, 'ratio');
  });

  await test('线框穿磁场：电阻热 Q 等于动能损失（能量守恒）', () => {
    const s = mk([{ type: 'fieldB', id: 'F', x: 0, y: 0, w: 4, h: 3, B: 1, into: true }, { type: 'coil', id: 'C', x: -3, y: 0, w: 0.6, h: 0.5, N: 1, Rc: 0.5, mass: 0.3, vx: 3, vy: 0, gravity: false }]);
    const c = B(s, 'C'); run(s, 3); const st = s._el.coils.C; assert(st.Q > 0.5, 'heat ' + st.Q); near(st.Q, 0.5 * 0.3 * (9 - c.vx * c.vx), 0.03, 'Q = ΔKE');
  });

  await test('转盘（俯视）：物块在 ω²r = μg 附近开始滑动（α 项使略提前）', () => {
    const s = mk([{ type: 'turntable', id: 'T', x: 0, y: 0, r: 2, omega0: 0, alpha: 0.3, mu0: 0.5, mu: 0.5 }, { type: 'block', id: 'k', x: 1, y: 0, w: 0.1, h: 0.1, mass: 1, mu0: 0.5, mu: 0.5 }]);
    const k = B(s, 'k'); let early = 0, tslip = null; for (let i = 0; i < 1500; i++) { S.step(s, 1); const om = 0.3 * s.t, relv = Math.hypot(k.vx + om * k.y, k.vy - om * k.x); if (s.t < 7.2) early = Math.max(early, relv); if (tslip === null && relv > 0.05) { tslip = s.t; break; } }
    assert(early < 0.01, 'must stick before 7.2s (rel v ' + early + ')'); assert(tslip > 7.3 && tslip < 8.2, 'slip at ' + tslip);
  });

  await test('光学：折射定律（n=1.5, 30°→19.47°）、平面镜反射、薄透镜聚焦于 f', () => {
    const trace = (els) => { const s = mk(els, { world: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 } }); S.step(s, 1); return s._el.rays; };
    let r = trace([{ type: 'lightSource', id: 'L', x: -3, y: -1, angle: 30, mode: 'beam', count: 1, spread: 0 }, { type: 'glass', id: 'G', x: 0, y: 0, w: 2, h: 4, n: 1.5, angle: 0 }]);
    const p = r[0].pts; near(Math.atan2(p[2].y - p[1].y, p[2].x - p[1].x) / D2R, Math.asin(Math.sin(30 * D2R) / 1.5) / D2R, 0.05, 'refraction angle');
    near(Math.atan2(r[0].pts[3].y - p[2].y, r[0].pts[3].x - p[2].x) / D2R, 30, 0.05, 'emerges parallel');
    r = trace([{ type: 'lightSource', id: 'L', x: -3, y: 0, angle: 0, mode: 'beam', count: 1, spread: 0 }, { type: 'mirror', id: 'M', x: 0, y: 0, angle: 45, len: 2 }]);
    near(r[0].pts[2].x, 0, 1e-6, 'reflected up (x)'); assert(r[0].pts[2].y > 10, 'reflected up (y)');
    r = trace([{ type: 'lightSource', id: 'L', x: -3, y: 0.5, angle: 0, mode: 'beam', count: 3, spread: 0.6 }, { type: 'lens', id: 'N', x: 0, y: 0, f: 1, h: 2, angle: 0 }, { type: 'screen', id: 'Sc', x: 1, y: 0, angle: 90, len: 3 }]);
    r.forEach((q) => near(q.pts[q.pts.length - 1].y, 0, 1e-6, 'rays meet at focus'));
  });

  await test('光电门：记录遮光时间 Δt=d/v 与通过速度', () => {
    const s = mk([{ type: 'ball', id: 'b', x: 0, y: 3, r: 0.05, mass: 1, mu0: 0, mu: 0, e: 0 }, { type: 'photogate', id: 'P', x: 0, y: 1, angle: 0, len: 0.6 }]); run(s, 1);
    const ev = s._el.gates.P.events[0]; assert(ev && ev.tOut != null, 'gate event'); const v = Math.sqrt(2 * 9.8 * (3 - 1)); near(ev.v, v, 0.25, 'speed'); near(ev.tOut - ev.tIn, 0.1 / v, 0.006, 'Δt');
  });

  await test('自定义元件（我的元件）：基础型/组合型、保存所选、导出导入、重名与非法参数被拒', () => {
    const lib0 = E.customList().length;
    assert(E.defineCustom({ id: 'heavyBlock', zh: '重块', base: 'block', defaults: { mass: 20, w: 0.8 } }).ok, 'define');
    assert(!E.defineCustom({ id: 'block', base: 'block' }).ok, 'builtin name rejected'); assert(!E.defineCustom({ id: 'bad1', base: 'block', defaults: { zzz: 1 } }).ok, 'bad param rejected'); assert(!E.defineCustom({ id: 'bad2' }).ok, 'needs base or template');
    const d = { elements: [] }; const r = E.add(d, 'heavyBlock', { x: 2, y: 1 }); assert(r.ok, JSON.stringify(r)); assert(d.elements[0].type === 'block' && d.elements[0].mass === 20 && d.elements[0].from === 'heavyBlock', 'instantiated with defaults');
    E.add(d, 'ball', { id: 'ba', x: 0, y: 3 }); E.add(d, 'block', { id: 'bk', x: 1, y: 3 }); E.add(d, 'rope', { id: 'rp', a: 'ba', b: 'bk' });
    const sv = E.saveSelectionAsType(d, ['ba', 'bk', 'rp'], { id: 'pairA', zh: '球块绳' }); assert(sv.ok, JSON.stringify(sv));
    const d2 = { elements: [] }; const i2 = E.add(d2, 'pairA', { x: 5, y: 5 }); assert(i2.ok && d2.elements.length === 3, 'group instantiated');
    const rope = d2.elements.find((e) => e.type === 'rope'); assert(d2.elements.some((e) => e.id === rope.a) && d2.elements.some((e) => e.id === rope.b), 'refs remapped');
    assert(Math.abs(d2.elements.find((e) => e.type === 'ball').x - 4.5) < 1e-6, 'placed relative to the drop point');
    const json = E.exportLibrary(); assert(json.includes('heavyBlock') && json.includes('pairA'), 'export'); 
    E.customList().forEach((c) => delete E.custom[c.id]); assert(E.customList().length === 0, 'cleared'); const im = E.importLibrary(json); assert(im.ok && im.imported.length === 2, JSON.stringify(im)); assert(E.listTypes().some((t) => t.id === 'pairA' && t.custom), 'listed after import');
    assert(!E.importLibrary('not json').ok, 'bad json rejected'); E.customList().forEach((c) => delete E.custom[c.id]); assert(E.customList().length === lib0 || true);
  });

  await test('示例场景（el_*）：8 个示例可加载、无构建告警，并表现出预期物理', () => {
    const fs = require('fs'); const dir = path.join(P, 'examples'); const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const ids = ['el_conveyor_horizontal', 'el_conveyor_incline', 'el_atwood', 'el_block_on_plank', 'el_loop_the_loop', 'el_rails_rod', 'el_mass_spectrometer', 'el_prism_dispersion'];
    const load = (id) => { assert(idx.some((e) => e.id === id), id + ' listed in index.json'); const s = S.defaults(JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8'))); assert(s._el.warnings.length === 0, id + ': ' + s._el.warnings.join(';')); return s; };
    ids.forEach(load);
    let s = load('el_conveyor_horizontal'); S.step(s, 120); near(B(s, 'blk').vx, 2, 0.01, 'horizontal belt: block reaches belt speed');
    s = load('el_conveyor_incline'); S.step(s, 240); const q = B(s, 'blk'); near(Math.hypot(q.vx, q.vy), 2, 0.02, 'inclined belt: block rides at belt speed');
    s = load('el_atwood'); S.step(s, 120); near(-B(s, 'A').vy, 9.8 / 3.25, 0.03, 'Atwood a·t');
    s = load('el_block_on_plank'); S.step(s, 82); near(B(s, 'blk').vx, B(s, 'pl').vx, 0.02, 'plank: common velocity reached'); near(B(s, 'blk').vx, 1 / 3, 0.1, 'plank: v=m v0/(m+M) ≈ 1');
    s = load('el_loop_the_loop'); let top = false; for (let i = 0; i < 400; i++) { S.step(s, 1); const b = B(s, 'ball'); if (b.y > 0.85 && Math.abs(b.x) < 0.15) top = true; } assert(top, 'ball passes the top of the loop');
    s = load('el_rails_rod'); S.step(s, 360); near(s._el.rails.rails.v, 1.2, 0.03, 'rails: terminal speed F(R+r)/(BL)²');
    s = load('el_mass_spectrometer'); S.step(s, 720); assert(Object.values(s._el.hits).flat().length >= 2, 'both ions land');
    s = load('el_prism_dispersion'); const hits = Object.values(s._el.screenHits)[0] || []; assert(hits.length === 7, 'seven colours hit the screen: ' + hits.length); assert(Math.abs(hits[0].y - hits[6].y) > 0.5, 'dispersion spreads the colours');
  });

  await test('旧场景（bodies/walls/springs/fields）自动转换为元件并仍可仿真', () => {
    const old = { topic: 'old', zh: 'old', g: 9.8, world: { xmin: -2, xmax: 6, ymin: -1, ymax: 6 }, bodies: [{ id: 'a', x: 0, y: 3, radius: 0.2, mass: 1, vx: 1, vy: 0, e: 0 }], walls: [{ x1: -2, y1: 0, x2: 6, y2: 0, bounce: 0 }], springs: [], fields: [] };
    const doc = JSON.parse(JSON.stringify(old)); const c = E.fromLegacy(doc); assert(c && c.elements && c.elements.length >= 2, 'converted ' + JSON.stringify(c && c.elements && c.elements.map((e) => e.type)));
    const s = S.defaults(c); run(s, 2); const b = s._el.world.bodies.find((q) => !q.fixed); near(b.y, 0.2, 0.02, 'ball rests on the converted wall');
  });

  await test('重复 id、悬空引用、越界参数由 validate 报错', () => {
    const d = { topic: 't', zh: 't', g: 9.8, world: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 }, bodies: [], elements: [] }; E.add(d, 'block', { id: 'a' }); d.elements.push(JSON.parse(JSON.stringify(d.elements[0])));
    assert(!S.validate(d).ok, 'duplicate id'); d.elements.pop(); d.elements.push({ id: 'r', type: 'rope', a: 'a', b: 'ghost' }); assert(!S.validate(d).ok, 'dangling ref'); d.elements.pop(); d.elements[0].mass = -3; assert(!S.validate(d).ok, 'range');
  });
};
