'use strict';
// Every physics parameter must (a) be settable within its range, (b) be rejected outside it, and
// (c) actually change the simulation output (derived values, stepped state, or drawn geometry).
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../../extensions/builtin/physics');
module.exports = async ({ test, group, assert }) => {
  group('物理：全部参数可自定义且真正生效');
  delete globalThis.PhysModules; delete globalThis.PhysSim;
  require(path.join(dir, 'modules.js')); require(path.join(dir, 'sim.js'));
  const M = globalThis.PhysModules, S = globalThis.PhysSim;
  // contexts in which a parameter is "live" (e.g. drag mass only matters when drag > 0)
  const CTX = {
    projectile: [{}, { k: 0.5 }], incline: [{}, { theta: 10, mu0: 0.1, v0: 1 }, { theta: 5, mu0: 0.9, v0: 3 }], plates: [{}, { B: 1, v0: 40 }],
    circuit: [{ type: 'DC' }, { type: 'RC' }, { type: 'RL' }, { type: 'AC' }, { type: 'DC', wireLen: 50 }], gas: [{ process: 'isothermal' }, { process: 'isobaric' }, { process: 'isochoric' }, { process: 'adiabatic' }],
    photoelectric: [{}, { Vapp: -1 }], induction: [{ mode: 'coil' }, { mode: 'rod' }], shm: [{}], wave: [{}], refraction: [{}, { n1: 1.6, n2: 1.0, incidence: 20 }]
  };
  function signature(m) {
    const c = JSON.parse(JSON.stringify(m)); M.step(c, 1 / 120, 360);
    return JSON.stringify([M.derive(c), c, M.viz(c)], (k, v) => typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v);
  }
  function alt(p, cur) {
    if (p.enum) return p.enum.filter(o => o !== cur);
    const up = cur + (p.max - cur) * 0.5, dn = cur - (cur - p.min) * 0.5; return [up, dn, p.max, p.min].filter(v => Math.abs(v - cur) > 1e-12);
  }
  await test('注册表覆盖 19 类模块，每类 ≥ 2 个参数', () => {
    assert(M.kinds().length >= 19, 'kinds ' + M.kinds().length);
    for (const k of M.kinds()) assert(M.paramList(k).length >= 2, k);
  });
  await test('清单覆盖：力学/振动波/电磁/光学/热学/近代 的全部要求参数都存在', () => {
    const need = {
      projectile: ['v0', 'angle', 'h0', 'g', 'k'], incline: ['theta', 'mu0', 'mu', 'mass', 'g'], circular: ['radius', 'omega'], pendulum: ['L', 'g', 'damping'],
      spring: ['k', 'rest', 'damping', 'amplitude'], collision: ['e', 'm1', 'm2'], gravitation: ['G', 'M', 'Rp'], shm: ['A', 'T', 'phase', 'frequency', 'damping'],
      wave: ['A', 'T', 'lambda', 'frequency', 'speed', 'phase', 'damping'], plates: ['q', 'mass', 'U', 'd', 'B', 'Edir'], circuit: ['emf', 'r', 'R', 'C', 'L', 'rho', 'wireLen', 'area', 'freq', 'V0'],
      transformer: ['N1', 'N2'], induction: ['N', 'area', 'B'], refraction: ['n1', 'n2', 'incidence', 'wavelength'], lens: ['f', 'u', 'h'], mirror: ['Rc', 'u'],
      gas: ['n', 'p', 'V', 'T', 'process', 'gamma', 'c', 'mass'], photoelectric: ['nu', 'W0', 'h', 'Vapp', 'wavelength'], decay: ['halfLife', 'N0']
    };
    for (const k in need) { const keys = M.paramList(k).map(p => p.key); for (const n of need[k]) assert(keys.includes(n), k + ' missing ' + n); }
    const live = M.derive(M.make('refraction', { n1: 1.6, n2: 1.0 })); assert(live['critical angle C=asin(n₂/n₁) (°)'] > 0, 'critical angle');
  });
  for (const kind of M.kinds()) {
    await test('每个参数改变仿真输出：' + kind, () => {
      const dead = [];
      for (const p of M.paramList(kind)) {
        let changed = false;
        for (const ctx of (CTX[kind] || [{}])) {
          const base = M.make(kind, ctx); const cur = M.getParam(base, p.key);
          for (const v of alt(p, cur)) {
            const m2 = M.make(kind, ctx); const r = M.setParam(m2, p.key, v); assert(r.ok, kind + '.' + p.key + ' set ' + v + ': ' + JSON.stringify(r));
            M.init(m2); if (signature(m2) !== signature(M.make(kind, ctx))) { changed = true; break; }
          }
          if (changed) break;
        }
        if (!changed) dead.push(p.key);
      }
      assert(!dead.length, kind + ' parameters with no effect: ' + dead.join(','));
    });
  }
  await test('越界值被拒绝并给出范围', () => {
    for (const kind of M.kinds()) for (const p of M.paramList(kind)) {
      const m = M.make(kind);
      if (p.enum) { const r = M.setParam(m, p.key, '__bad__'); assert(!r.ok && /one of/.test(r.errors[0]), kind + p.key); continue; }
      const r = M.setParam(m, p.key, p.max + Math.abs(p.max || 1) + 1); assert(!r.ok && /must be in \[/.test(r.errors[0]), kind + '.' + p.key + ' accepted out-of-range');
      assert(!M.setParam(m, p.key, NaN).ok, 'NaN ' + p.key);
    }
    assert(!M.setParam(M.make('projectile'), 'nope', 1).ok, 'unknown key');
  });
  await test('物理量正确：抛体射程、斜面临界角、折射、光电效应、半衰期', () => {
    const near = (a, b, t, msg) => assert(Math.abs(a - b) <= t, msg + ' got ' + a + ' want ' + b);
    near(M.derive(M.make('projectile', { v0: 20, angle: 30, g: 10 }))['range 射程 (no drag)'], 20 * 20 * Math.sin(Math.PI / 3) / 10, 1e-9, 'range');
    near(M.derive(M.make('incline', { mu0: 1 }))['critical angle atan μ₀ (°)'], 45, 1e-9, 'atan');
    near(M.derive(M.make('refraction', { n1: 1.5, n2: 1, incidence: 30 }))['critical angle C=asin(n₂/n₁) (°)'], Math.asin(1 / 1.5) * 180 / Math.PI, 1e-9, 'critical');
    near(M.derive(M.make('photoelectric', { nu: 10, W0: 2, h: 6.626 }))['max kinetic energy Ek=hν−W₀ (eV)'], 6.626e-34 * 1e15 / 1.602e-19 - 2, 1e-6, 'Ek');
    near(M.derive(M.make('photoelectric', { nu: 2, W0: 4 }))['emits electrons 发生光电效应'], 0, 0, 'below threshold');
    const d = M.make('decay', { N0: 1000, halfLife: 5 }); M.step(d, 1 / 120, 600); near(M.derive(d)['remaining N(t)'], 500, 1, 'half-life');
    near(M.derive(M.make('gas', { n: 1, T: 300, V: 24.942, process: 'isothermal' }))['initial pressure p₁ (kPa)'], 100, 0.05, 'pV=nRT');
    const pj = M.make('incline', { theta: 20, mu0: 0.5, mu: 0.3 }); M.step(pj, 1 / 120, 600); assert(pj.s === 0, 'static friction holds below critical angle');
    const sl = M.make('incline', { theta: 40, mu0: 0.5, mu: 0.3 }); M.step(sl, 1 / 120, 120); assert(sl.s > 0.5, 'slides above critical angle');
    const pl = M.make('plates', { q: 1, mass: 1, U: 0, B: 1, v0: 20, Lp: 1000, d: 50 }); M.step(pl, 1 / 120, 1200); assert(Math.abs(Math.hypot(pl.vx, pl.vy) - 20) < 0.5, 'B does no work');
  });
  await test('别名参数：频率/波速/压强/波长同步改变底层量', () => {
    const w = M.make('wave'); assert(M.setParam(w, 'speed', 10).ok && Math.abs(w.lambda / w.T - 10) < 1e-9, 'speed');
    assert(M.setParam(w, 'frequency', 2).ok && Math.abs(w.T - 0.5) < 1e-9, 'frequency');
    const ph = M.make('photoelectric'); assert(M.setParam(ph, 'wavelength', 400).ok && Math.abs(3e8 / (ph.nu * 1e14) * 1e9 - 400) < 1e-6, 'wavelength');
    const g = M.make('gas'); assert(M.setParam(g, 'p', 200).ok && Math.abs(M.derive(g)['initial pressure p₁ (kPa)'] - 200) < 1e-6, 'p');
  });
  await test('刚体场景：g、空气阻力、静/动摩擦、恢复系数、弹簧、E(mag/angle/U/d)、B(mag/dir)、行星 G/M/R 全部生效', () => {
    const run = (mut, n) => { const sc = { topic: 'x', bodies: [{ id: 'a', x: 0, y: 0.25, vx: 3, vy: 0, mass: 1, q: 1, radius: 0.25, bounce: 0.5 }, { id: 'b', x: 2, y: 3, mass: 1 }], springs: [{ a: 'a', b: 'b', k: 5, rest: 1, damping: 0 }], walls: [], fields: [] };
      mut(sc); const s = S.defaults(sc); S.step(s, n || 240); return JSON.stringify(s.bodies.map(b => [b.x, b.y, b.vx, b.vy]), (k, v) => typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v); };
    const base = run(() => { });
    const diffs = {
      'g': sc => { sc.g = 3; }, 'world.air': sc => { sc.world = { air: 0.5 }; }, 'floor μ': sc => { sc.world = { mu: 0.4, mu0: 0.5 }; sc.bodies[0].y = 0.25; sc.bodies[0].vy = -1; },
      'body.e': sc => { sc.bodies[0].e = 0.1; sc.bodies[1].x = 0.9; sc.bodies[1].y = 0.25; sc.bodies[1].fixed = false; },
      'spring k': sc => { sc.springs[0].k = 50; }, 'spring rest': sc => { sc.springs[0].rest = 3; }, 'spring damping': sc => { sc.springs[0].damping = 2; },
      'E mag': sc => { sc.fields = [{ type: 'E', mag: 5, angle: 90 }]; }, 'E angle': sc => { sc.fields = [{ type: 'E', mag: 5, angle: 0 }]; }, 'E U/d': sc => { sc.fields = [{ type: 'E', U: 10, d: 2, angle: 90 }]; },
      'B mag': sc => { sc.fields = [{ type: 'B', mag: 2, dir: 'out' }]; }, 'B dir': sc => { sc.fields = [{ type: 'B', mag: 2, dir: 'in' }]; }, 'q': sc => { sc.fields = [{ type: 'E', mag: 5 }]; sc.bodies[0].q = 3; },
      'planet': sc => { sc.planet = { G: 6.674e-11, M: 7.35e22, R: 1.737e6 }; }, 'mass': sc => { sc.bodies[0].mass = 4; sc.fields = [{ type: 'E', mag: 5 }]; }
    };
    for (const k in diffs) assert(run(diffs[k]) !== base, k + ' has no effect');
    const wallRun = (mu, mu0) => { const s = S.defaults({ topic: 'x', bodies: [{ id: 'a', x: 0, y: 0.25, vx: 3, mass: 1, bounce: 0 }], walls: [{ x1: -50, y1: 0, x2: 50, y2: 0, bounce: 0, mu, mu0 }], world: { xmin: -60, xmax: 60 } }); S.step(s, 360); return s.bodies[0]; };
    assert(wallRun(0, 0).vx > wallRun(0.3, 0.5).vx + 0.5, 'wall μ slows body'); assert(wallRun(0.3, 0.5).vx > wallRun(0.8, 0.9).vx - 1e-9, 'bigger μ slows more');
    const held = S.defaults({ topic: 'x', bodies: [{ id: 'a', x: 0, y: 0.25, vx: 0, mass: 1, bounce: 0 }], walls: [{ x1: -50, y1: 0, x2: 50, y2: 0, bounce: 0, mu: 0.3, mu0: 0.6 }], forces: [{ type: 'const', fx: 4 }], world: { xmin: -60, xmax: 60 } });
    S.step(held, 360); assert(Math.abs(held.bodies[0].x) < 0.01, 'F=4N < μ₀mg=5.9N → static friction holds');
    const moving = S.defaults({ topic: 'x', bodies: [{ id: 'a', x: 0, y: 0.25, vx: 0, mass: 1, bounce: 0 }], walls: [{ x1: -50, y1: 0, x2: 50, y2: 0, bounce: 0, mu: 0.3, mu0: 0.3 }], forces: [{ type: 'const', fx: 4 }], world: { xmin: -60, xmax: 60 } });
    S.step(moving, 360); assert(moving.bodies[0].x > 0.5, 'F=4N > μmg=2.9N → slides');
    const pl = S.defaults({ topic: 'x', bodies: [], planet: { G: 6.674e-11, M: 5.972e24, R: 6.371e6 } }); assert(Math.abs(pl.g - 9.82) < 0.02, 'g=GM/R² = ' + pl.g);
  });
  await test('场景验证：模块/μ/e/k 越界给出清晰错误；μ>μ₀ 给警告；modules 不被序列化运行态', () => {
    const v = S.validate({ topic: 't', bodies: [], modules: [{ kind: 'projectile', v0: 9999 }, { kind: 'nope' }], walls: [{ mu: 2, mu0: 1 }], springs: [{ a: 'a', b: 'b', k: -1 }] });
    assert(!v.ok && v.errors.some(e => /v0|Launch speed/.test(e)) && v.errors.some(e => /unknown/.test(e)) && v.errors.some(e => /springs\[0\]\.k/.test(e)), v.errors.join('|'));
    assert(S.validate({ topic: 't', bodies: [], walls: [{ mu: 0.5, mu0: 0.2 }] }).warnings.length === 1, 'μ>μ₀ warning');
    const s = S.defaults({ topic: 't', bodies: [], modules: [{ kind: 'spring' }] }); S.step(s, 10); assert(!JSON.stringify(s).includes('"hist"'), 'runtime state leaked into JSON');
    const r = S.setModuleParam(s, 0, 'k', 99); assert(r.ok && s.modules[0].k === 99, 'record synced');
  });
  await test('全部 34 个示例场景可验证、可运行；19 个模块示例的 derive 非空', () => {
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'examples/index.json'), 'utf8')); const list = idx.examples || idx; assert(list.length >= 34, 'examples ' + list.length);
    for (const e of list) { const sc = JSON.parse(fs.readFileSync(path.join(dir, 'examples', e.id + '.json'), 'utf8')); const v = S.validate(sc); assert(v.ok, e.id + ': ' + v.errors.join(',')); const s = S.defaults(sc); S.step(s, 120);
      if (e.id.startsWith('mod_')) assert(Object.keys(S.derived(s)).length > 0, e.id); }
  });
};
