// Deterministic 2D physics simulator for Chinese high-school topics.
// Scene JSON is validated by schema.js (panel loads both). Pure functions; no DOM.
(function (root) {
  'use strict';
  const G = 9.8;
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function mag(v) { return Math.hypot(v.x || 0, v.y || 0); }
  function norm(v) { const m = mag(v) || 1; return { x: (v.x || 0) / m, y: (v.y || 0) / m }; }
  function add(a, b) { return { x: (a.x || 0) + (b.x || 0), y: (a.y || 0) + (b.y || 0) }; }
  function scale(v, s) { return { x: (v.x || 0) * s, y: (v.y || 0) * s }; }
  function sub(a, b) { return { x: (a.x || 0) - (b.x || 0), y: (a.y || 0) - (b.y || 0) }; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function validate(scene) {
    const err = [];
    if (!scene || typeof scene !== 'object') return { ok: false, errors: ['scene must be an object'] };
    if (!scene.topic) err.push('missing topic');
    if (!Array.isArray(scene.bodies)) err.push('bodies[] required');
    else scene.bodies.forEach((b, i) => {
      if (!b.id) err.push('bodies[' + i + '].id required');
      if (b.mass != null && !(b.mass > 0)) err.push('bodies[' + i + '].mass must be > 0');
    });
    if (scene.dt != null && !(scene.dt > 0 && scene.dt <= 0.05)) err.push('dt must be in (0, 0.05]');
    const warnings = [];
    if (scene.g != null && !(scene.g >= 0 && scene.g <= 100)) err.push('g must be in [0, 100] m/s²');
    if (scene.world && scene.world.air != null && !(scene.world.air >= 0)) err.push('world.air (drag coefficient) must be ≥ 0');
    if (scene.planet) { const p = scene.planet; ['G', 'M', 'R'].forEach(k => { if (!(p[k] > 0)) err.push('planet.' + k + ' must be > 0'); }); }
    (scene.bodies || []).forEach((b, i) => {
      if (b.e != null && !(b.e >= 0 && b.e <= 1)) err.push('bodies[' + i + '].e (restitution) must be in [0, 1]');
      if (b.radius != null && !(b.radius > 0)) err.push('bodies[' + i + '].radius must be > 0');
    });
    (scene.springs || []).forEach((sp, i) => {
      if (sp.k != null && !(sp.k >= 0)) err.push('springs[' + i + '].k must be ≥ 0');
      if (sp.rest != null && !(sp.rest >= 0)) err.push('springs[' + i + '].rest must be ≥ 0');
      if (sp.damping != null && !(sp.damping >= 0)) err.push('springs[' + i + '].damping must be ≥ 0');
    });
    (scene.walls || []).forEach((w, i) => {
      if (w.mu != null && !(w.mu >= 0)) err.push('walls[' + i + '].mu must be ≥ 0');
      if (w.mu0 != null && !(w.mu0 >= 0)) err.push('walls[' + i + '].mu0 must be ≥ 0');
      if (w.mu != null && w.mu0 != null && w.mu > w.mu0) warnings.push('walls[' + i + ']: kinetic μ should not exceed static μ₀');
    });
    (scene.fields || []).forEach((f, i) => {
      if (f.d != null && !(f.d > 0)) err.push('fields[' + i + '].d (plate spacing) must be > 0');
    });
    const PM = root.PhysModules;
    (scene.modules || []).forEach((m, i) => { if (PM) { const r = PM.validateModule(m, i); err.push(...r.errors); warnings.push(...r.warnings); } });
    return { ok: !err.length, errors: err, warnings };
  }

  function defaults(scene) {
    const s = clone(scene);
    s.dt = s.dt || 1 / 120;
    s.g = s.g == null ? G : s.g;
    s.t = s.t || 0;
    if (s.planet && s.planet.G > 0 && s.planet.M > 0 && s.planet.R > 0) s.g = s.planet.G * s.planet.M / (s.planet.R * s.planet.R);
    s.world = Object.assign({ xmin: -10, xmax: 10, ymin: -2, ymax: 12, air: 0 }, s.world || {});
    s.bodies = (s.bodies || []).map(b => Object.assign({
      x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, mass: 1, radius: 0.25, q: 0,
      color: '#3d9b6e', label: b.id, trail: [], fixed: false, shape: 'circle'
    }, b));
    s.forces = s.forces || [];
    s.springs = s.springs || [];
    s.fields = s.fields || []; // {type:'E'|'B', Ex,Ey,Bz, region?}
    s.walls = s.walls || [];   // {x1,y1,x2,y2, bounce:1}
    s.optics = s.optics || null; // {rays:[{x,y,angle,n}], mirrors:[], lenses:[]}
    s.plots = s.plots || [];   // {id, of:'body.vx', history:[]}
    s.meta = Object.assign({ title: s.topic || 'scene', zh: s.zh || s.topic || '' }, s.meta || {});
    s.history = s.history || {};
    s.modules = s.modules || [];
    // runtime module state lives in a non-enumerable property so clone()/export never serialise it
    Object.defineProperty(s, '_mod', { value: root.PhysModules ? s.modules.map(m => root.PhysModules.make(m.kind, m)) : [], writable: true, enumerable: false, configurable: true });
    return s;
  }

  // E field: {Ex,Ey} or {mag|E, angle(deg, default 90 = up)} or {U, d, angle}  (E = U/d)
  function fieldE(f) {
    if (f.Ex != null || f.Ey != null) return { x: f.Ex || 0, y: f.Ey || 0 };
    const m = f.U != null && f.d > 0 ? f.U / f.d : (f.mag != null ? f.mag : (f.E || 0));
    const a = (f.angle == null ? 90 : f.angle) * Math.PI / 180; return { x: m * Math.cos(a), y: m * Math.sin(a) };
  }
  // B field (z component, + = out of page): {Bz} or {mag, dir:'out'|'in'}
  function fieldB(f) { if (f.Bz != null) return f.Bz; const m = f.mag != null ? f.mag : (f.B || 0); return f.dir === 'in' ? -m : m; }
  function forceOn(s, b) {
    let fx = 0, fy = 0;
    if (!b.fixed && s.g) fy -= b.mass * s.g * (b.gravity == null ? 1 : b.gravity);
    // drag
    const air = s.world.air || 0;
    if (air) { fx -= air * b.vx; fy -= air * b.vy; }
    // springs
    for (const sp of s.springs) {
      if (sp.a !== b.id && sp.b !== b.id) continue;
      const other = s.bodies.find(x => x.id === (sp.a === b.id ? sp.b : sp.a));
      if (!other) continue;
      const d = sub(other, b); const L = mag(d) || 1e-9; const n = scale(d, 1 / L);
      const rest = sp.rest == null ? 1 : sp.rest; const k = sp.k == null ? 20 : sp.k;
      const f = k * (L - rest);
      fx += n.x * f; fy += n.y * f;
      if (sp.damping) { const rel = sub({ x: other.vx, y: other.vy }, { x: b.vx, y: b.vy }); fx += sp.damping * rel.x; fy += sp.damping * rel.y; }
    }
    // EM fields on charged bodies
    if (b.q) {
      for (const f of s.fields) {
        if (f.type === 'E') { const E = fieldE(f); fx += b.q * E.x; fy += b.q * E.y; }
        if (f.type === 'B') { // F = q v × B (Bz out of page): Fx=q vy Bz, Fy=-q vx Bz
          const Bz = fieldB(f); fx += b.q * b.vy * Bz; fy += -b.q * b.vx * Bz;
        }
      }
    }
    // custom force scripts (simple named)
    for (const f of s.forces) {
      if (f.body && f.body !== b.id) continue;
      if (f.type === 'const') { fx += f.fx || 0; fy += f.fy || 0; }
      if (f.type === 'gravity_point') {
        const o = s.bodies.find(x => x.id === f.center); if (!o) continue;
        const d = sub(o, b); const L2 = Math.max(1e-6, d.x * d.x + d.y * d.y); const L = Math.sqrt(L2);
        const F = (f.G || 1) * o.mass * b.mass / L2; fx += F * d.x / L; fy += F * d.y / L;
      }
    }
    return { x: fx, y: fy };
  }

  // friction coefficient for a contact: surface value first, then the body's own, then fallback
  function frictionOf(surf, b, key, fb) {
    if (surf[key] != null) return surf[key]; if (key === 'mu' && surf.friction != null) return surf.friction;
    if (b[key] != null) return b[key]; if (key === 'mu' && b.friction != null) return b.friction; return fb || 0;
  }
  function collideWalls(s, b) {
    const w = s.world;
    const r = b.radius || 0;
    if (b.x - r < w.xmin) { b.x = w.xmin + r; b.vx = Math.abs(b.vx) * (b.bounce == null ? 0.0 : b.bounce); }
    if (b.x + r > w.xmax) { b.x = w.xmax - r; b.vx = -Math.abs(b.vx) * (b.bounce == null ? 0.0 : b.bounce); }
    if (b.y - r < w.ymin) {
      const e = b.bounce == null ? 0.0 : b.bounce, dvn = Math.abs(b.vy) * (1 + e);
      b.y = w.ymin + r; b.vy = Math.abs(b.vy) * e;
      const mu = frictionOf(w, b, 'mu'), mu0 = frictionOf(w, b, 'mu0', mu);
      if (mu > 0 || mu0 > 0) { if (Math.abs(b.vx) <= mu0 * dvn) { b.x -= b.vx * s.dt; b.vx = 0; } else b.vx -= Math.sign(b.vx) * mu * dvn; }
    }
    if (b.y + r > w.ymax) { b.y = w.ymax - r; b.vy = -Math.abs(b.vy) * (b.bounce == null ? 0.0 : b.bounce); }
    for (const wall of s.walls) {
      // axis-aligned segments only for v1 of engine
      if (Math.abs(wall.y1 - wall.y2) < 1e-9) { // horizontal
        const y = wall.y1, x1 = Math.min(wall.x1, wall.x2), x2 = Math.max(wall.x1, wall.x2);
        if (b.x >= x1 && b.x <= x2 && Math.abs(b.y - y) < r + 0.01) {
          const e = wall.bounce == null ? 0.9 : wall.bounce, dvn = Math.abs(b.vy) * (1 + e);
          b.y = y + (b.y >= y ? r : -r); b.vy *= -e;
          // Coulomb friction along the wall: static μ₀ holds, kinetic μ decelerates (impulse ≤ μ·Δvn)
          const mu = frictionOf(wall, b, 'mu'), mu0 = frictionOf(wall, b, 'mu0', mu);
          if (mu > 0 || mu0 > 0) { if (Math.abs(b.vx) <= mu0 * dvn) { b.x -= b.vx * s.dt; b.vx = 0; } else b.vx -= Math.sign(b.vx) * mu * dvn; }
        }
      }
      if (Math.abs(wall.x1 - wall.x2) < 1e-9) {
        const x = wall.x1, y1 = Math.min(wall.y1, wall.y2), y2 = Math.max(wall.y1, wall.y2);
        if (b.y >= y1 && b.y <= y2 && Math.abs(b.x - x) < r + 0.01) {
          const e = wall.bounce == null ? 0.9 : wall.bounce, dvn = Math.abs(b.vx) * (1 + e);
          b.x = x + (b.x >= x ? r : -r); b.vx *= -e;
          const mu = frictionOf(wall, b, 'mu'), mu0 = frictionOf(wall, b, 'mu0', mu);
          if (mu > 0 || mu0 > 0) { if (Math.abs(b.vy) <= mu0 * dvn) { b.y -= b.vy * s.dt; b.vy = 0; } else b.vy -= Math.sign(b.vy) * mu * dvn; }
        }
      }
    }
  }

  function collideBodies(s) {
    for (let i = 0; i < s.bodies.length; i++) for (let j = i + 1; j < s.bodies.length; j++) {
      const a = s.bodies[i], b = s.bodies[j];
      if (a.fixed && b.fixed) continue;
      const d = sub(b, a); const dist = mag(d); const min = (a.radius || 0) + (b.radius || 0);
      if (dist >= min || dist < 1e-9) continue;
      const n = scale(d, 1 / dist); const overlap = min - dist;
      if (!a.fixed && !b.fixed) { a.x -= n.x * overlap / 2; a.y -= n.y * overlap / 2; b.x += n.x * overlap / 2; b.y += n.y * overlap / 2; }
      else if (a.fixed) { b.x += n.x * overlap; b.y += n.y * overlap; }
      else { a.x -= n.x * overlap; a.y -= n.y * overlap; }
      // 1D elastic along normal
      const rv = sub({ x: b.vx, y: b.vy }, { x: a.vx, y: a.vy });
      const vn = rv.x * n.x + rv.y * n.y; if (vn > 0) continue;
      const e = (a.e != null ? a.e : 1) * (b.e != null ? b.e : 1);
      const jimp = -(1 + e) * vn / ((a.fixed ? 0 : 1 / a.mass) + (b.fixed ? 0 : 1 / b.mass));
      if (!a.fixed) { a.vx -= jimp / a.mass * n.x; a.vy -= jimp / a.mass * n.y; }
      if (!b.fixed) { b.vx += jimp / b.mass * n.x; b.vy += jimp / b.mass * n.y; }
    }
  }

  function stepOptics(s) {
    if (!s.optics || !s.optics.rays) return;
    // Ray marching: reflection (mirrors) + Snell's law (interfaces)
    s.optics.paths = (s.optics.rays || []).map(ray => {
      const path = [{ x: ray.x, y: ray.y }];
      let x = ray.x, y = ray.y, ang = ray.angle || 0, n = ray.n || 1;
      for (let k = 0; k < 40; k++) {
        const dx = Math.cos(ang) * 0.15, dy = Math.sin(ang) * 0.15;
        x += dx; y += dy;
        let hit = false;
        for (const m of (s.optics.mirrors || [])) {
          // horizontal/vertical mirrors
          if (Math.abs(m.y1 - m.y2) < 1e-9 && Math.abs(y - m.y1) < 0.08 && x >= Math.min(m.x1, m.x2) && x <= Math.max(m.x1, m.x2)) {
            ang = -ang; y = m.y1; hit = true; break;
          }
          if (Math.abs(m.x1 - m.x2) < 1e-9 && Math.abs(x - m.x1) < 0.08 && y >= Math.min(m.y1, m.y2) && y <= Math.max(m.y1, m.y2)) {
            ang = Math.PI - ang; x = m.x1; hit = true; break;
          }
        }
        for (const L of (s.optics.lenses || [])) {
          // thin lens on vertical line x=L.x : 1/u+1/v=1/f approximated by angle bend
          if (Math.abs(x - L.x) < 0.1 && y > L.y - L.h / 2 && y < L.y + L.h / 2) {
            const f = L.f || 2; const h = y - L.y; ang = Math.atan(Math.tan(ang) - h / f); x = L.x + 0.11; hit = true; break;
          }
        }
        for (const iface of (s.optics.interfaces || [])) {
          // vertical interface at x with n1->n2
          if (Math.abs(x - iface.x) < 0.08) {
            const n2 = iface.n2 || 1.5; const s1 = Math.sin(ang), c1 = Math.cos(ang);
            const s2 = (n / n2) * s1;
            if (Math.abs(s2) > 1) { ang = Math.PI - ang; } // TIR
            else { ang = Math.asin(s2) * Math.sign(c1 || 1); if (c1 < 0) ang = Math.PI - ang; n = n2; }
            x = iface.x + 0.1 * Math.sign(Math.cos(ray.angle) || 1); hit = true; break;
          }
        }
        path.push({ x, y });
        if (x < s.world.xmin - 1 || x > s.world.xmax + 1 || y < s.world.ymin - 1 || y > s.world.ymax + 1) break;
        if (hit) { /* continue */ }
      }
      return path;
    });
  }

  function record(s) {
    for (const b of s.bodies) {
      if (!b.trail) b.trail = [];
      b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 400) b.trail.shift();
    }
    for (const p of s.plots) {
      if (!p.history) p.history = [];
      let v = 0; const m = /^(\w+)\.(\w+)$/.exec(p.of || '');
      if (m) { const b = s.bodies.find(x => x.id === m[1]); if (b) v = b[m[2]]; }
      else if (p.of === 't') v = s.t;
      p.history.push({ t: s.t, v }); if (p.history.length > 600) p.history.shift();
    }
  }

  function step(scene, n) {
    const s = scene; const steps = n == null ? 1 : n;
    for (let k = 0; k < steps; k++) {
      for (const b of s.bodies) {
        if (b.fixed) { b.vx = b.vy = 0; continue; }
        const f = forceOn(s, b); b.ax = f.x / b.mass; b.ay = f.y / b.mass;
        // semi-implicit Euler (deterministic)
        b.vx += b.ax * s.dt; b.vy += b.ay * s.dt;
        b.x += b.vx * s.dt; b.y += b.vy * s.dt;
        collideWalls(s, b);
      }
      collideBodies(s);
      // circuits (simple RC / AC source readout)
      if (s.circuit) {
        const c = s.circuit;
        c.t = (c.t || 0) + s.dt;
        if (c.type === 'RC') {
          const R = c.R || 1000, C = c.C || 1e-3, V = c.V || 5;
          c.Vc = c.Vc || 0;
          const I = (V - c.Vc) / R; c.Vc += I * s.dt / C; c.I = I;
        } else if (c.type === 'AC') {
          const V0 = c.V0 || 5, w = c.w || 2 * Math.PI * 50;
          c.V = V0 * Math.sin(w * c.t); c.I = c.V / (c.R || 100);
        }
      }
      for (const m of (s._mod || [])) root.PhysModules.step(m, s.dt, 1);
      s.t += s.dt;
      if ((k % 2) === 0) record(s);
    }
    stepOptics(s);
    return s;
  }

  function vectors(s) {
    // for renderer: per-body force / velocity arrows
    return s.bodies.map(b => {
      const f = forceOn(s, b);
      return { id: b.id, x: b.x, y: b.y, v: { x: b.vx, y: b.vy }, f, q: b.q };
    });
  }

  // Live derived quantities for the readout panel
  function derived(s) {
    const out = {}; let ke = 0, pe = 0, px = 0, py = 0;
    for (const b of s.bodies) { ke += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy); pe += b.mass * s.g * (b.y - s.world.ymin); px += b.mass * b.vx; py += b.mass * b.vy; }
    if (s.bodies.length) Object.assign(out, { 'kinetic energy Ek (J)': ke, 'potential energy Ep (J)': pe, 'total energy E (J)': ke + pe, 'momentum px (kg·m/s)': px, 'momentum py (kg·m/s)': py, 'g (m/s²)': s.g });
    s.fields.forEach((f, i) => { if (f.type === 'E') { const E = fieldE(f); out['E' + i + ' (V/m)'] = Math.hypot(E.x, E.y); } if (f.type === 'B') out['B' + i + ' (T, + out)'] = fieldB(f); });
    (s._mod || []).forEach((m, i) => { const d = root.PhysModules.derive(m); for (const k in d) out[(s._mod.length > 1 ? 'm' + i + ' ' : '') + k] = d[k]; });
    return out;
  }
  // set a module parameter (aliases allowed), keep the scene's param record in sync, restart the module
  function setModuleParam(s, i, key, value) {
    const M = s._mod && s._mod[i]; if (!M) return { ok: false, errors: ['no module at index ' + i] };
    const r = root.PhysModules.setParam(M, key, value); if (!r.ok) return r;
    const rec = s.modules[i]; for (const p of root.PhysModules.paramList(M.kind)) if (!p.alias) rec[p.key] = M[p.key];
    root.PhysModules.init(M); return r;
  }

  root.PhysSim = { validate, defaults, step, vectors, derived, setModuleParam, fieldE, fieldB, clone, G };
})(typeof window !== 'undefined' ? window : globalThis);
