// Parametric physics modules for Chinese high-school topics.
// Every quantity is a registered parameter {key,label,zh,unit,min,max,step,def} so the panel can build
// sliders + number inputs automatically, validation gives clear errors, and phys_set_param can set it by path.
// Each module has init(m) / step(m,dt) / derive(m) / viz(m) (draw primitives). Pure functions, deterministic.
(function (root) {
  'use strict';
  const PI = Math.PI, rad = d => d * PI / 180, deg = r => r * 180 / PI;
  const C0 = 3e8, H0 = 6.626e-34, QE = 1.602e-19, R_GAS = 8.314;
  const P = (key, zh, label, unit, min, max, step, def, extra) => Object.assign({ key, zh, label, unit, min, max, step, def }, extra || {});
  const E = (key, zh, label, options, def) => ({ key, zh, label, enum: options, def });
  const R = {};

  function lineV(x1, y1, x2, y2, c) { return { t: 'line', x1, y1, x2, y2, c }; }
  function circ(x, y, r, c, fill) { return { t: 'circle', x, y, r, c, fill: fill !== false }; }
  function txt(x, y, s, c) { return { t: 'text', x, y, s, c }; }
  function arrow(x1, y1, x2, y2, c) { return { t: 'arrow', x1, y1, x2, y2, c }; }
  function polyline(pts, c) { return { t: 'poly', pts, c }; }
  function wavelengthColor(nm) {
    let r = 0, g = 0, b = 0;
    if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm < 510) { g = 1; b = -(nm - 510) / 20; } else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm < 645) { r = 1; g = -(nm - 645) / 65; } else if (nm <= 780) { r = 1; }
    const h = v => ('0' + Math.round(255 * Math.max(0, Math.min(1, v))).toString(16)).slice(-2);
    return '#' + h(r) + h(g) + h(b);
  }

  // ---------------------------------------------------------------- mechanics
  R.projectile = {
    zh: '抛体运动', title: 'Projectile',
    params: [P('v0', '初速度', 'Launch speed', 'm/s', 0, 100, 0.5, 15), P('angle', '抛射角', 'Launch angle', '°', -90, 90, 1, 45),
      P('h0', '初始高度', 'Initial height', 'm', 0, 200, 0.5, 0), P('g', '重力加速度', 'g', 'm/s²', 0.1, 30, 0.1, 9.8),
      P('k', '空气阻力系数', 'Air drag coeff.', 'kg/s', 0, 2, 0.01, 0), P('mass', '质量', 'Mass', 'kg', 0.01, 10, 0.01, 1)],
    init(m) { m.x = 0; m.y = m.h0; m.vx = m.v0 * Math.cos(rad(m.angle)); m.vy = m.v0 * Math.sin(rad(m.angle)); m.t = 0; m.trail = [{ x: 0, y: m.y }]; m.landed = false; },
    step(m, dt) {
      if (m.landed) return; const k = m.k / m.mass;
      m.vx += -k * m.vx * dt; m.vy += (-m.g - k * m.vy) * dt; m.x += m.vx * dt; m.y += m.vy * dt; m.t += dt;
      if (m.y <= 0 && m.vy < 0) { m.y = 0; m.landed = true; } m.trail.push({ x: m.x, y: m.y }); if (m.trail.length > 800) m.trail.shift();
    },
    derive(m) { const s = Math.sin(rad(m.angle)), c = Math.cos(rad(m.angle)); const vy0 = m.v0 * s;
      const disc = vy0 * vy0 + 2 * m.g * m.h0; const T = (vy0 + Math.sqrt(disc)) / m.g;
      return { 'range 射程 (no drag)': m.v0 * c * T, 'max height 最大高度': m.h0 + (vy0 > 0 ? vy0 * vy0 / (2 * m.g) : 0), 'flight time 飞行时间': T, 'impact speed 落地速度': Math.sqrt(m.v0 * m.v0 + 2 * m.g * m.h0) }; },
    viz(m) { const e = m.derive(); const X = Math.max(10, e['range 射程 (no drag)'] * 1.2, m.x * 1.1), Y = Math.max(5, e['max height 最大高度'] * 1.3, m.y * 1.1);
      return { box: [-0.05 * X, X, -0.1 * Y, Y], items: [lineV(0, 0, X, 0, '#3d9b6e'), polyline(m.trail, '#fb923c'), circ(m.x, m.y, 0.02 * X, '#fde047')] }; }
  };
  R.incline = {
    zh: '斜面与摩擦', title: 'Incline & friction',
    params: [P('theta', '斜面倾角 θ', 'Incline angle θ', '°', 0, 80, 1, 30), P('mass', '质量', 'Mass', 'kg', 0.1, 20, 0.1, 2),
      P('mu0', '静摩擦因数 μ₀', 'Static friction μ₀', '', 0, 1.5, 0.01, 0.5), P('mu', '动摩擦因数 μ', 'Kinetic friction μ', '', 0, 1.5, 0.01, 0.3),
      P('length', '斜面长度', 'Incline length', 'm', 0.5, 20, 0.1, 5), P('v0', '初速度(沿斜面向下为正)', 'Initial speed (down +)', 'm/s', -10, 10, 0.1, 0), P('g', '重力加速度', 'g', 'm/s²', 0.1, 30, 0.1, 9.8)],
    init(m) { m.s = 0; m.v = m.v0; m.t = 0; },
    step(m, dt) { const th = rad(m.theta), N = m.mass * m.g * Math.cos(th), drive = m.mass * m.g * Math.sin(th);
      if (Math.abs(m.v) < 1e-9) { if (drive <= m.mu0 * N) { m.v = 0; m.t += dt; return; } m.v = 1e-6; }
      const dir = Math.sign(m.v); let a = m.g * Math.sin(th) - dir * m.mu * m.g * Math.cos(th);
      const nv = m.v + a * dt; if (Math.sign(nv) !== dir) { m.v = 0; } else m.v = nv;
      m.s += m.v * dt; if (m.s >= m.length) { m.s = m.length; m.v = 0; } if (m.s < 0) { m.s = 0; m.v = 0; } m.t += dt; },
    derive(m) { const th = rad(m.theta), N = m.mass * m.g * Math.cos(th), drive = m.mass * m.g * Math.sin(th);
      const slides = drive > m.mu0 * N || Math.abs(m.v0) > 0; const a = m.g * Math.sin(th) - m.mu * m.g * Math.cos(th);
      let tb = a > 0 ? (-m.v0 + Math.sqrt(m.v0 * m.v0 + 2 * a * m.length)) / a : Infinity;
      return { 'normal force N 支持力 (N)': N, 'max static friction μ₀N (N)': m.mu0 * N, 'kinetic friction μN (N)': m.mu * N, 'gravity component mg sinθ (N)': drive,
        'acceleration a (m/s²)': slides ? a : 0, 'slides 是否下滑': slides ? 1 : 0, 'critical angle atan μ₀ (°)': deg(Math.atan(m.mu0)), 'time to bottom (s)': isFinite(tb) ? tb : -1 }; },
    viz(m) { const L = m.length, th = rad(m.theta), ex = L * Math.cos(th), ey = L * Math.sin(th); const bx = (L - m.s) * Math.cos(th), by = (L - m.s) * Math.sin(th);
      return { box: [-0.1 * L, L * 1.1, -0.1 * L, L * 1.1], items: [lineV(0, 0, ex, 0, '#3d9b6e'), lineV(0, 0, ex, ey, '#8aa096'), lineV(ex, 0, ex, ey, '#8aa096'), circ(ex - (m.s) * Math.cos(th) * 1, ey - m.s * Math.sin(th), 0.04 * L, '#fb923c'), txt(0.02 * L, 0.05 * L, 'θ=' + m.theta.toFixed(0) + '°', '#e8f0ea')] }; }
  };
  R.circular = {
    zh: '匀速圆周运动', title: 'Circular motion',
    params: [P('radius', '半径 r', 'Radius r', 'm', 0.1, 50, 0.1, 2), P('omega', '角速度 ω', 'Angular velocity ω', 'rad/s', 0.1, 30, 0.1, 3),
      P('mass', '质量', 'Mass', 'kg', 0.01, 100, 0.01, 1), P('phase0', '初相位', 'Initial phase', '°', -180, 180, 1, 0)],
    init(m) { m.phase = rad(m.phase0); m.t = 0; }, step(m, dt) { m.phase += m.omega * dt; m.t += dt; },
    derive(m) { return { 'linear speed v=ωr (m/s)': m.omega * m.radius, 'period T (s)': 2 * PI / m.omega, 'frequency f (Hz)': m.omega / (2 * PI), 'centripetal accel ω²r (m/s²)': m.omega * m.omega * m.radius, 'centripetal force mω²r (N)': m.mass * m.omega * m.omega * m.radius }; },
    viz(m) { const r = m.radius, x = r * Math.cos(m.phase), y = r * Math.sin(m.phase), v = m.omega * r, s = 0.35;
      return { box: [-1.6 * r, 1.6 * r, -1.6 * r, 1.6 * r], items: [circ(0, 0, r, '#1e2c30', false), circ(0, 0, 0.03 * r, '#8aa096'), lineV(0, 0, x, y, '#8aa096'), circ(x, y, 0.08 * r, '#fb923c'), arrow(x, y, x - Math.sin(m.phase) * v * s, y + Math.cos(m.phase) * v * s, '#fde047'), arrow(x, y, x * 0.55, y * 0.55, '#f87171')] }; }
  };
  R.pendulum = {
    zh: '单摆', title: 'Pendulum',
    params: [P('L', '摆长 / 绳长', 'Rope length L', 'm', 0.1, 20, 0.05, 1), P('theta0', '初始摆角', 'Initial angle', '°', 1, 170, 1, 20), P('mass', '质量', 'Mass', 'kg', 0.01, 20, 0.01, 0.5),
      P('g', '重力加速度', 'g', 'm/s²', 0.1, 30, 0.1, 9.8), P('damping', '阻尼系数', 'Damping', '1/s', 0, 2, 0.01, 0)],
    init(m) { m.th = rad(m.theta0); m.w = 0; m.t = 0; },
    step(m, dt) { const a = -(m.g / m.L) * Math.sin(m.th) - m.damping * m.w; m.w += a * dt; m.th += m.w * dt; m.t += dt; },
    derive(m) { const t0 = rad(m.theta0); return { 'period T≈2π√(L/g) (s)': 2 * PI * Math.sqrt(m.L / m.g), 'frequency f (Hz)': 1 / (2 * PI * Math.sqrt(m.L / m.g)), 'max speed (m/s)': Math.sqrt(2 * m.g * m.L * (1 - Math.cos(t0))), 'max tension (N)': m.mass * (m.g + 2 * m.g * (1 - Math.cos(t0))) }; },
    viz(m) { const x = m.L * Math.sin(m.th), y = -m.L * Math.cos(m.th); return { box: [-1.3 * m.L, 1.3 * m.L, -1.3 * m.L, 0.3 * m.L], items: [lineV(-0.3 * m.L, 0, 0.3 * m.L, 0, '#8aa096'), lineV(0, 0, x, y, '#8aa096'), circ(x, y, 0.07 * m.L, '#fb923c')] }; }
  };
  R.spring = {
    zh: '弹簧振子', title: 'Spring oscillator',
    params: [P('k', '劲度系数 k', 'Spring k', 'N/m', 1, 500, 1, 20), P('mass', '质量', 'Mass', 'kg', 0.05, 50, 0.05, 1), P('amplitude', '振幅 A', 'Amplitude A', 'm', 0.01, 5, 0.01, 0.5),
      P('damping', '阻尼系数', 'Damping c', 'kg/s', 0, 10, 0.05, 0), P('rest', '原长', 'Rest length', 'm', 0.1, 5, 0.05, 1)],
    init(m) { m.x = m.amplitude; m.v = 0; m.t = 0; m.hist = []; },
    step(m, dt) { const a = (-m.k * m.x - m.damping * m.v) / m.mass; m.v += a * dt; m.x += m.v * dt; m.t += dt; m.hist.push({ x: m.t, y: m.x }); if (m.hist.length > 600) m.hist.shift(); },
    derive(m) { const w = Math.sqrt(m.k / m.mass); return { 'ω=√(k/m) (rad/s)': w, 'period T (s)': 2 * PI / w, 'frequency f (Hz)': w / (2 * PI), 'total energy ½kA² (J)': 0.5 * m.k * m.amplitude * m.amplitude, 'max speed Aω (m/s)': m.amplitude * w }; },
    viz(m) { const A = m.amplitude, L = m.rest; return { box: [-0.3, L + A * 1.4 + 0.3, -A * 1.6, A * 1.6], items: [lineV(0, -A, 0, A, '#8aa096'), lineV(0, 0, L + m.x, 0, '#fbbf24'), circ(L + m.x, 0, 0.1 * A + 0.05, '#fb923c')] }; }
  };
  R.collision = {
    zh: '一维碰撞', title: '1D collision',
    params: [P('m1', '质量 m₁', 'Mass m₁', 'kg', 0.1, 20, 0.1, 2), P('m2', '质量 m₂', 'Mass m₂', 'kg', 0.1, 20, 0.1, 1), P('v1', '初速度 v₁', 'Speed v₁', 'm/s', -20, 20, 0.1, 4),
      P('v2', '初速度 v₂', 'Speed v₂', 'm/s', -20, 20, 0.1, 0), P('e', '恢复系数 e', 'Restitution e', '', 0, 1, 0.01, 1)],
    init(m) { m.x1 = -4; m.x2 = 2; m.u1 = m.v1; m.u2 = m.v2; m.t = 0; m.done = false; },
    step(m, dt) { m.x1 += m.u1 * dt; m.x2 += m.u2 * dt; m.t += dt; if (!m.done && m.x2 - m.x1 <= 0.5 && m.u1 > m.u2) { const d = R.collision.derive(m); m.u1 = d['v₁′ after (m/s)']; m.u2 = d['v₂′ after (m/s)']; m.done = true; } },
    derive(m) { const s = m.m1 + m.m2, e = m.e; const a = ((m.m1 - e * m.m2) * m.v1 + (1 + e) * m.m2 * m.v2) / s, b = ((m.m2 - e * m.m1) * m.v2 + (1 + e) * m.m1 * m.v1) / s;
      return { 'v₁′ after (m/s)': a, 'v₂′ after (m/s)': b, 'momentum p (kg·m/s)': m.m1 * m.v1 + m.m2 * m.v2, 'energy lost ΔE (J)': 0.5 * m.m1 * m.v1 * m.v1 + 0.5 * m.m2 * m.v2 * m.v2 - 0.5 * m.m1 * a * a - 0.5 * m.m2 * b * b }; },
    viz(m) { return { box: [-8, 10, -2, 2], items: [lineV(-8, -0.3, 10, -0.3, '#3d9b6e'), circ(m.x1, 0.1, 0.25 * Math.cbrt(m.m1), '#fb923c'), circ(m.x2, 0.1, 0.25 * Math.cbrt(m.m2), '#60a5fa')] }; }
  };
  R.gravitation = {
    zh: '万有引力与天体', title: 'Gravitation',
    params: [P('G', '引力常量 G', 'G', '×1e-11 N·m²/kg²', 1, 20, 0.001, 6.674), P('M', '行星质量 M', 'Planet mass M', '×1e24 kg', 0.01, 5000, 0.01, 5.97), P('Rp', '行星半径', 'Planet radius', '×1e6 m', 0.1, 100, 0.01, 6.371),
      P('h', '轨道高度', 'Altitude h', '×1e6 m', 0, 100, 0.01, 0.4), P('m', '卫星质量', 'Satellite mass', 'kg', 1, 10000, 1, 1000)],
    init(m) { m.phase = 0; m.t = 0; },
    step(m, dt) { const d = R.gravitation.derive(m); m.phase += 2 * PI / d['orbital period T (s)'] * dt * 600; m.t += dt; },
    derive(m) { const G = m.G * 1e-11, M = m.M * 1e24, Rp = m.Rp * 1e6, r = Rp + m.h * 1e6; return { 'surface gravity g=GM/R² (m/s²)': G * M / (Rp * Rp), 'orbital speed v=√(GM/r) (m/s)': Math.sqrt(G * M / r), 'orbital period T (s)': 2 * PI * Math.sqrt(r * r * r / (G * M)), 'escape speed (m/s)': Math.sqrt(2 * G * M / Rp), 'gravity on satellite F (N)': G * M * m.m / (r * r) }; },
    viz(m) { const Rp = m.Rp, r = Rp + m.h; return { box: [-1.5 * r, 1.5 * r, -1.5 * r, 1.5 * r], items: [circ(0, 0, Rp, '#3b82f6'), circ(0, 0, r, '#1e2c30', false), circ(r * Math.cos(m.phase), r * Math.sin(m.phase), 0.06 * r, '#fde047')] }; }
  };
  // ---------------------------------------------------------------- oscillation & waves
  R.shm = {
    zh: '简谐运动', title: 'Simple harmonic motion',
    params: [P('A', '振幅', 'Amplitude', 'm', 0.01, 5, 0.01, 1), P('T', '周期 T', 'Period T', 's', 0.1, 20, 0.05, 2), P('phase', '初相位 φ', 'Phase φ', '°', -180, 180, 1, 0), P('damping', '阻尼系数', 'Damping', '1/s', 0, 2, 0.01, 0)],
    aliases: { frequency: { zh: '频率 f', unit: 'Hz', min: 0.05, max: 10, get: m => 1 / m.T, set: (m, v) => { m.T = 1 / v; } } },
    init(m) { m.t = 0; m.hist = []; },
    step(m, dt) { m.t += dt; m.hist.push({ x: m.t, y: R.shm.disp(m, m.t) }); if (m.hist.length > 600) m.hist.shift(); },
    disp(m, t) { return m.A * Math.exp(-m.damping * t) * Math.cos(2 * PI * t / m.T + rad(m.phase)); },
    derive(m) { return { 'frequency f (Hz)': 1 / m.T, 'angular freq ω (rad/s)': 2 * PI / m.T, 'x(t) now (m)': R.shm.disp(m, m.t || 0), 'max speed Aω (m/s)': m.A * 2 * PI / m.T }; },
    viz(m) { const pts = m.hist.map(p => ({ x: p.x, y: p.y })); const t1 = Math.max(5, m.t); return { box: [Math.max(0, t1 - 10), t1, -1.3 * m.A, 1.3 * m.A], items: [lineV(0, 0, t1 + 10, 0, '#1e2c30'), polyline(pts, '#3d9b6e')] }; }
  };
  R.wave = {
    zh: '机械波', title: 'Mechanical wave',
    params: [P('A', '振幅', 'Amplitude', 'm', 0.01, 2, 0.01, 0.5), P('T', '周期 T', 'Period T', 's', 0.1, 10, 0.05, 2), P('lambda', '波长 λ', 'Wavelength λ', 'm', 0.1, 20, 0.05, 4),
      P('phase', '初相位 φ', 'Phase φ', '°', -180, 180, 1, 0), P('damping', '阻尼系数', 'Damping', '1/m', 0, 1, 0.01, 0)],
    aliases: { frequency: { zh: '频率 f', unit: 'Hz', min: 0.1, max: 10, get: m => 1 / m.T, set: (m, v) => { m.T = 1 / v; } }, speed: { zh: '波速 v', unit: 'm/s', min: 0.05, max: 100, get: m => m.lambda / m.T, set: (m, v) => { m.lambda = v * m.T; } } },
    init(m) { m.t = 0; }, step(m, dt) { m.t += dt; },
    y(m, x, t) { return m.A * Math.exp(-m.damping * x) * Math.sin(2 * PI * (t / m.T - x / m.lambda) + rad(m.phase)); },
    derive(m) { return { 'frequency f=1/T (Hz)': 1 / m.T, 'wave speed v=λ/T (m/s)': m.lambda / m.T, 'wave number k=2π/λ (rad/m)': 2 * PI / m.lambda, 'ω (rad/s)': 2 * PI / m.T }; },
    viz(m) { const pts = []; for (let x = 0; x <= 10; x += 0.1) pts.push({ x, y: R.wave.y(m, x, m.t || 0) }); return { box: [0, 10, -1.3 * m.A, 1.3 * m.A], items: [lineV(0, 0, 10, 0, '#1e2c30'), polyline(pts, '#60a5fa')] }; }
  };
  // ---------------------------------------------------------------- electromagnetism
  R.plates = {
    zh: '带电粒子（平行板 + 磁场）', title: 'Charged particle (plates + B)',
    params: [P('q', '电荷量 q', 'Charge q', 'µC', -10, 10, 0.01, 1), P('mass', '质量 m', 'Mass m', 'mg', 0.01, 100, 0.01, 1), P('U', '板间电压 U', 'Voltage U', 'V', 0, 10000, 1, 10),
      P('d', '板间距 d', 'Plate spacing d', 'cm', 0.5, 50, 0.1, 10), P('Lp', '极板长度', 'Plate length', 'cm', 1, 200, 0.5, 40), P('B', '磁感应强度 B', 'Magnetic field B', 'T', -5, 5, 0.01, 0, { hint: '+ out of page 垂直纸面向外, − into page' }),
      P('v0', '入射速度', 'Entry speed', 'm/s', 0, 500, 1, 20), P('angle', '入射角', 'Entry angle', '°', -80, 80, 1, 0), P('Edir', '电场方向(°，向上=90)', 'E direction', '°', -180, 180, 1, -90)],
    init(m) { m.x = 0; m.y = 0; m.vx = m.v0 * Math.cos(rad(m.angle)); m.vy = m.v0 * Math.sin(rad(m.angle)); m.t = 0; m.trail = [{ x: 0, y: 0 }]; m.out = false; },
    // Slow-motion: scaled so one transit of the plates takes ~4 s on screen (physical dt = dt × slow), sub-stepped for accuracy.
    slow(m) { return Math.min(1, (m.Lp / 100) / Math.max(1e-9, m.v0 * Math.cos(rad(m.angle))) / 4); },
    step(m, dt) { const sdt = dt * R.plates.slow(m) / 4; for (let i = 0; i < 4 && !m.out; i++) R.plates.sub(m, sdt); m.t += dt; },
    sub(m, dt) { if (m.out) return; const E = m.U / (m.d / 100); const Ex = E * Math.cos(rad(m.Edir)), Ey = E * Math.sin(rad(m.Edir));
      const ax = (m.q * (Ex + m.vy * m.B)) / m.mass, ay = (m.q * (Ey - m.vx * m.B)) / m.mass; // q µC / m mg → SI
      m.vx += ax * dt; m.vy += ay * dt; m.x += m.vx * dt; m.y += m.vy * dt; m.trail.push({ x: m.x, y: m.y }); if (m.trail.length > 800) m.trail.shift();
      if (Math.abs(m.y) >= m.d / 200) m.out = 'plate'; if (m.x >= m.Lp / 100 || m.x < -0.5) m.out = m.out || 'exit'; },
    derive(m) { const E = m.U / (m.d / 100), v = m.v0, t = (m.Lp / 100) / Math.max(1e-9, v * Math.cos(rad(m.angle))); const a = m.q * E / m.mass;
      return { 'field E=U/d (V/m)': E, 'electric accel qE/m (m/s²)': a, 'deflection ½at² (m)': 0.5 * a * t * t, 'cyclotron radius mv/(|q|B) (m)': m.B ? (m.mass * v) / (Math.abs(m.q) * Math.abs(m.B)) : -1, 'cyclotron period 2πm/(|q|B) (s)': m.B ? 2 * PI * m.mass / (Math.abs(m.q) * Math.abs(m.B)) : -1, 'slow-motion factor (display)': R.plates.slow(m) }; },
    viz(m) { const L = m.Lp / 100, h = m.d / 200; const items = [lineV(0, h, L, h, '#f87171'), lineV(0, -h, L, -h, '#60a5fa'), polyline(m.trail, '#fde047'), circ(m.x, m.y, 0.015 * L + 0.001, '#fb923c')];
      return { box: [-0.1 * L, 1.1 * L, -Math.max(h * 1.6, 0.002), Math.max(h * 1.6, 0.002)], items }; }
  };
  R.circuit = {
    zh: '电路（直流 / RC / RL / 交流）', title: 'Circuit',
    params: [E('type', '类型', 'Type', ['DC', 'RC', 'RL', 'AC'], 'DC'), P('emf', '电动势 ε', 'EMF ε', 'V', 0, 100, 0.1, 12), P('r', '内阻 r', 'Internal resistance r', 'Ω', 0, 20, 0.01, 1), P('R', '电阻 R', 'Resistance R', 'Ω', 0.1, 1000, 0.1, 10),
      P('C', '电容 C', 'Capacitance C', 'µF', 0.1, 1000, 0.1, 100), P('L', '电感 L', 'Inductance L', 'mH', 1, 1000, 1, 100), P('rho', '电阻率 ρ', 'Resistivity ρ', 'Ω·mm²/m', 0, 1, 0.0005, 0.0175),
      P('wireLen', '导线长度 l', 'Wire length l', 'm', 0, 1000, 0.5, 0), P('area', '导线横截面积 S', 'Wire cross-section S', 'mm²', 0.1, 50, 0.1, 1), P('freq', '交流频率 f', 'AC frequency f', 'Hz', 1, 1000, 1, 50), P('V0', '交流峰值 V₀', 'AC peak V₀', 'V', 0, 500, 1, 311)],
    init(m) { m.t = 0; m.q = 0; m.i = 0; m.hist = []; },
    // characteristic time: RC → RC, RL → L/R, AC → period; time is scaled so it spans ~1.5 s on screen, sub-stepped 20×
    tau(m) { const d = R.circuit.calc(m); if (m.type === 'RC') return d.Rt * m.C * 1e-6; if (m.type === 'RL') return m.L * 1e-3 / d.Rt; if (m.type === 'AC') return 1 / m.freq; return 1; },
    win(m) { return m.type === 'AC' ? 4 / m.freq : m.type === 'DC' ? 1 : 6 * R.circuit.tau(m); },
    step(m, dt) { const tau = R.circuit.tau(m), sdt = m.type === 'DC' ? dt : dt * (tau / 1.5) / 20; for (let k = 0; k < 20; k++) R.circuit.sub(m, sdt, k % 4 === 0); },
    sub(m, dt, rec) { const d = R.circuit.calc(m); m.t += dt; let v = 0;
      if (m.type === 'DC') { m.i = m.emf / d.Rt; v = m.i; }
      else if (m.type === 'RC') { const i = (m.emf - m.q / (m.C * 1e-6)) / d.Rt; m.q += i * dt; m.i = i; v = m.q / (m.C * 1e-6); }
      else if (m.type === 'RL') { const di = (m.emf - d.Rt * m.i) / (m.L * 1e-3); m.i += di * dt; v = m.i; }
      else { const w = 2 * PI * m.freq; const phi = Math.atan2(d.XL - d.XC, d.Rt); m.i = (m.V0 / d.Z) * Math.sin(w * m.t - phi); v = m.i; }
      if (rec) { m.hist.push({ x: m.t, y: v }); const W = R.circuit.win(m); while (m.hist.length > 2 && m.hist[0].x < m.t - W) m.hist.shift(); } },
    calc(m) { const Rw = m.rho * m.wireLen / m.area, Rt = m.R + m.r + Rw, w = 2 * PI * m.freq, XL = w * m.L * 1e-3, XC = 1 / (w * m.C * 1e-6); return { Rw, Rt, XL, XC, Z: Math.sqrt(Rt * Rt + Math.pow(XL - XC, 2)) }; },
    derive(m) { const d = R.circuit.calc(m); const o = { 'wire resistance ρl/S (Ω)': d.Rw, 'total resistance R+r+R_wire (Ω)': d.Rt, 'DC current ε/R_total (A)': m.emf / d.Rt, 'terminal voltage (V)': m.emf - m.emf / d.Rt * m.r };
      if (m.type === 'RC') o['time constant τ=RC (s)'] = d.Rt * m.C * 1e-6; if (m.type === 'RL') o['time constant τ=L/R (s)'] = m.L * 1e-3 / d.Rt;
      if (m.type === 'AC') { o['XL (Ω)'] = d.XL; o['XC (Ω)'] = d.XC; o['impedance Z (Ω)'] = d.Z; o['Irms (A)'] = m.V0 / Math.SQRT2 / d.Z; o['resonance f₀ (Hz)'] = 1 / (2 * PI * Math.sqrt(m.L * 1e-3 * m.C * 1e-6)); } return o; },
    viz(m) { const W = R.circuit.win(m), t1 = Math.max(W, m.t), t0 = t1 - W; const ys = m.hist.map(p => Math.abs(p.y)); const ym = Math.max(1e-6, ...ys, 1e-6) * 1.3; const lo = m.type === 'RC' || m.type === 'DC' || m.type === 'RL' ? 0 : -ym; return { box: [t0, t1, Math.min(lo, 0), ym], items: [lineV(t0, 0, t1, 0, '#1e2c30'), polyline(m.hist, '#fde047'), txt(t0 + W * 0.02, ym * 0.85, (m.type === 'RC' ? 'Vc (V)' : 'i (A)') + '  window ' + W.toExponential(2) + ' s', '#8aa096')] }; }
  };
  R.transformer = {
    zh: '变压器', title: 'Transformer',
    params: [P('N1', '原线圈匝数 n₁', 'Primary turns n₁', '', 1, 5000, 1, 100), P('N2', '副线圈匝数 n₂', 'Secondary turns n₂', '', 1, 5000, 1, 50), P('U1', '原线圈电压 U₁', 'Primary voltage U₁', 'V', 1, 1000, 1, 220), P('Rl', '负载电阻', 'Load resistance', 'Ω', 1, 1000, 1, 10), P('freq', '频率', 'Frequency', 'Hz', 1, 1000, 1, 50)],
    init(m) { m.t = 0; }, step(m, dt) { m.t += dt; },
    derive(m) { const U2 = m.U1 * m.N2 / m.N1, I2 = U2 / m.Rl; return { 'turns ratio n₁:n₂': m.N1 / m.N2, 'secondary voltage U₂ (V)': U2, 'secondary current I₂ (A)': I2, 'primary current I₁ (A)': I2 * m.N2 / m.N1, 'power P (W)': U2 * I2 }; },
    viz(m) { const s = m.derive(); const U2 = s['secondary voltage U₂ (V)'], U1 = m.U1; const Um = Math.max(U1, U2) * 1.2, pts1 = [], pts2 = []; for (let t = 0; t <= 0.06; t += 0.0005) { pts1.push({ x: t, y: U1 * Math.sin(2 * PI * m.freq * t) }); pts2.push({ x: t, y: U2 * Math.sin(2 * PI * m.freq * t) }); }
      return { box: [0, 0.06, -Um, Um], items: [lineV(0, 0, 0.06, 0, '#1e2c30'), polyline(pts1, '#f87171'), polyline(pts2, '#60a5fa')] }; }
  };
  R.induction = {
    zh: '电磁感应（线圈 / 导体棒）', title: 'Induction',
    params: [E('mode', '模式', 'Mode', ['coil', 'rod'], 'coil'), P('N', '线圈匝数 N', 'Coil turns N', '', 1, 1000, 1, 100), P('area', '线圈面积 S', 'Coil area S', 'cm²', 1, 1000, 1, 100), P('B', '磁感应强度 B', 'Field B', 'T', 0.001, 5, 0.001, 0.5),
      P('omega', '转动角速度 ω', 'Rotation ω', 'rad/s', 0, 300, 1, 100), P('Rc', '回路电阻', 'Loop resistance', 'Ω', 0.1, 100, 0.1, 10), P('len', '棒长 l', 'Rod length l', 'm', 0.05, 5, 0.01, 0.5), P('vrod', '棒速度 v', 'Rod speed v', 'm/s', 0, 50, 0.1, 4)],
    init(m) { m.t = 0; m.hist = []; },
    win(m) { return m.mode === 'rod' || !m.omega ? 1 : 4 * 2 * PI / m.omega; },
    // coil mode: time scaled so one rotation period spans ~1.5 s on screen
    step(m, dt) { const sdt = m.mode === 'rod' || !m.omega ? dt : dt * (2 * PI / m.omega / 1.5) / 4; for (let k = 0; k < 4; k++) { m.t += sdt; m.hist.push({ x: m.t, y: R.induction.emf(m, m.t) }); } const W = R.induction.win(m); while (m.hist.length > 2 && m.hist[0].x < m.t - W) m.hist.shift(); },
    emf(m, t) { return m.mode === 'rod' ? m.B * m.len * m.vrod : m.N * m.B * (m.area * 1e-4) * m.omega * Math.sin(m.omega * t); },
    derive(m) { const Em = m.mode === 'rod' ? m.B * m.len * m.vrod : m.N * m.B * m.area * 1e-4 * m.omega; return { 'peak emf (V)': Em, 'rms emf (V)': m.mode === 'rod' ? Em : Em / Math.SQRT2, 'peak current (A)': Em / m.Rc, 'period T (s)': m.mode === 'rod' || !m.omega ? -1 : 2 * PI / m.omega }; },
    viz(m) { const Em = Math.max(1e-6, m.derive()['peak emf (V)']) * 1.3, W = R.induction.win(m), t1 = Math.max(W, m.t), t0 = t1 - W; return { box: [t0, t1, -Em, Em], items: [lineV(t0, 0, t1, 0, '#1e2c30'), polyline(m.hist, '#a78bfa'), txt(t0 + W * 0.02, Em * 0.8, 'emf (V)', '#8aa096')] }; }
  };
  // ---------------------------------------------------------------- optics
  R.refraction = {
    zh: '折射与全反射', title: 'Refraction / TIR',
    params: [P('n1', '介质1折射率 n₁', 'Index n₁', '', 1, 3, 0.01, 1), P('n2', '介质2折射率 n₂', 'Index n₂', '', 1, 3, 0.01, 1.5), P('incidence', '入射角', 'Incidence angle', '°', 0, 89.9, 0.1, 30), P('wavelength', '真空波长 λ', 'Wavelength λ', 'nm', 380, 780, 1, 550)],
    init(m) { m.t = 0; }, step(m, dt) { m.t += dt; },
    derive(m) { const s2 = m.n1 * Math.sin(rad(m.incidence)) / m.n2, tir = Math.abs(s2) > 1; return { 'refraction angle θ₂ (°)': tir ? -1 : deg(Math.asin(s2)), 'total internal reflection 全反射': tir ? 1 : 0, 'critical angle C=asin(n₂/n₁) (°)': m.n1 > m.n2 ? deg(Math.asin(m.n2 / m.n1)) : -1, 'speed in medium 1 c/n₁ (m/s)': C0 / m.n1, 'speed in medium 2 c/n₂ (m/s)': C0 / m.n2, 'wavelength in medium 2 (nm)': m.wavelength / m.n2 }; },
    viz(m) { const col = wavelengthColor(m.wavelength), a = rad(m.incidence), d = m.derive(), tir = d['total internal reflection 全反射'] === 1; const items = [lineV(-3, 0, 3, 0, '#8aa096'), lineV(0, -3, 0, 3, '#1e2c30'), lineV(-2.5 * Math.sin(a), 2.5 * Math.cos(a), 0, 0, col), lineV(0, 0, 2.5 * Math.sin(a), 2.5 * Math.cos(a), col)];
      if (tir) items.push(lineV(0, 0, 2.5 * Math.sin(a), 2.5 * Math.cos(a), col)); else { const b = rad(d['refraction angle θ₂ (°)']); items.push(lineV(0, 0, 2.5 * Math.sin(b), -2.5 * Math.cos(b), col)); }
      items.push(txt(-2.8, 2.6, 'n₁=' + m.n1.toFixed(2), '#e8f0ea'), txt(-2.8, -2.8, 'n₂=' + m.n2.toFixed(2), '#e8f0ea')); return { box: [-3, 3, -3, 3], items }; }
  };
  R.lens = {
    zh: '薄透镜成像', title: 'Thin lens',
    params: [P('f', '焦距 f (凸+ 凹−)', 'Focal length f (convex +, concave −)', 'cm', -50, 50, 0.5, 10), P('u', '物距 u', 'Object distance u', 'cm', 1, 100, 0.5, 25), P('h', '物高', 'Object height', 'cm', 0.1, 20, 0.1, 2), P('wavelength', '光波长', 'Wavelength', 'nm', 380, 780, 1, 550)],
    init(m) { m.t = 0; }, step(m, dt) { m.t += dt; },
    derive(m) { const den = m.u - m.f, v = m.f * m.u / (Math.abs(den) < 1e-9 ? 1e-9 : den); const mag = -v / m.u; return { 'image distance v (cm)': v, 'magnification m=−v/u': mag, 'image height (cm)': mag * m.h, 'real image 实像': v > 0 ? 1 : 0, 'inverted 倒立': mag < 0 ? 1 : 0 }; },
    viz(m) { const d = m.derive(), v = d['image distance v (cm)'], col = wavelengthColor(m.wavelength), ih = d['image height (cm)']; const X = Math.max(40, m.u * 1.3, Math.abs(v) * 1.3), Y = Math.max(8, m.h * 2, Math.abs(ih) * 2);
      return { box: [-X, X, -Y, Y], items: [lineV(-X, 0, X, 0, '#8aa096'), lineV(0, -Y, 0, Y, '#8aa096'), arrow(-m.u, 0, -m.u, m.h, '#fb923c'), arrow(v, 0, v, ih, '#60a5fa'), lineV(-m.u, m.h, 0, m.h, col), lineV(0, m.h, v, ih, col), lineV(-m.u, m.h, v, ih, col), circ(m.f, 0, 0.01 * X, '#fde047'), circ(-m.f, 0, 0.01 * X, '#fde047')] }; }
  };
  R.mirror = {
    zh: '球面镜', title: 'Spherical mirror',
    params: [P('Rc', '曲率半径 R (凹+ 凸−)', 'Radius of curvature R (concave +)', 'cm', -100, 100, 0.5, 20), P('u', '物距 u', 'Object distance u', 'cm', 1, 100, 0.5, 30), P('h', '物高', 'Object height', 'cm', 0.1, 20, 0.1, 2)],
    init(m) { m.t = 0; }, step(m, dt) { m.t += dt; },
    derive(m) { const f = m.Rc / 2, den = m.u - f, v = f * m.u / (Math.abs(den) < 1e-9 ? 1e-9 : den), mag = -v / m.u; return { 'focal length f=R/2 (cm)': f, 'image distance v (cm)': v, 'magnification': mag, 'image height (cm)': mag * m.h, 'real image 实像': v > 0 ? 1 : 0 }; },
    viz(m) { const d = m.derive(), v = d['image distance v (cm)'], ih = d['image height (cm)']; const X = Math.max(50, m.u * 1.3, Math.abs(v) * 1.3), Y = Math.max(8, m.h * 2, Math.abs(ih) * 2);
      return { box: [-X, X, -Y, Y], items: [lineV(-X, 0, X, 0, '#8aa096'), lineV(0, -Y * 0.8, 0, Y * 0.8, '#e8f0ea'), arrow(-m.u, 0, -m.u, m.h, '#fb923c'), arrow(-v, 0, -v, ih, '#60a5fa'), circ(-m.Rc / 2, 0, 0.01 * X, '#fde047'), circ(-m.Rc, 0, 0.01 * X, '#8aa096')] }; }
  };
  // ---------------------------------------------------------------- thermal
  R.gas = {
    zh: '理想气体（等温/等压/等容/绝热）', title: 'Ideal gas processes',
    params: [P('n', '物质的量 n', 'Amount n', 'mol', 0.01, 10, 0.01, 1), P('T', '初温 T', 'Initial T', 'K', 50, 1500, 1, 300), P('V', '初体积 V', 'Initial V', 'L', 1, 100, 0.5, 20),
      E('process', '过程', 'Process', ['isothermal', 'isobaric', 'isochoric', 'adiabatic'], 'isothermal'), P('Vend', '末体积 V₂', 'Final V₂', 'L', 1, 100, 0.5, 40), P('Tend', '末温 T₂ (等容)', 'Final T₂ (isochoric)', 'K', 50, 1500, 1, 600),
      P('gamma', '比热比 γ', 'γ', '', 1.05, 1.7, 0.01, 1.4), P('c', '比热容 c', 'Specific heat c', 'J/(kg·K)', 100, 5000, 10, 1000), P('mass', '质量', 'Mass', 'kg', 0.001, 10, 0.001, 0.1)],
    aliases: { p: { zh: '初压强 p', unit: 'kPa', min: 1, max: 5000, get: m => m.n * R_GAS * m.T / (m.V * 1e-3) / 1000, set: (m, v) => { m.T = v * 1000 * m.V * 1e-3 / (m.n * R_GAS); } } },
    path(m, s) { const V1 = m.V, T1 = m.T; let V = V1, T = T1;
      if (m.process === 'isothermal') { V = V1 + (m.Vend - V1) * s; T = T1; } else if (m.process === 'isobaric') { V = V1 + (m.Vend - V1) * s; T = T1 * V / V1; }
      else if (m.process === 'isochoric') { V = V1; T = T1 + (m.Tend - T1) * s; } else { V = V1 + (m.Vend - V1) * s; T = T1 * Math.pow(V1 / V, m.gamma - 1); }
      return { V, T, p: m.n * R_GAS * T / (V * 1e-3) / 1000 }; },
    init(m) { m.s = 0; m.t = 0; }, step(m, dt) { m.t += dt; m.s = Math.min(1, m.s + dt / 8); },
    derive(m) { const a = R.gas.path(m, 0), b = R.gas.path(m, 1), Cv = R_GAS / (m.gamma - 1); const dU = m.n * Cv * (b.T - a.T); let W = 0;
      if (m.process === 'isothermal') W = m.n * R_GAS * a.T * Math.log(b.V / a.V); else if (m.process === 'isobaric') W = a.p * 1000 * (b.V - a.V) * 1e-3; else if (m.process === 'adiabatic') W = -dU;
      return { 'initial pressure p₁ (kPa)': a.p, 'final pressure p₂ (kPa)': b.p, 'final T₂ (K)': b.T, 'final V₂ (L)': b.V, 'work by gas W (J)': W, 'ΔU = nCvΔT (J)': dU, 'heat absorbed Q=ΔU+W (J)': dU + W, 'Q=mcΔT (J)': m.mass * m.c * (b.T - a.T) }; },
    viz(m) { const pts = []; for (let s = 0; s <= 1.0001; s += 0.02) { const q = R.gas.path(m, s); pts.push({ x: q.V, y: q.p }); } const cur = R.gas.path(m, m.s || 0); const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x0 = Math.min(...xs) * 0.8, x1 = Math.max(...xs) * 1.2, y0 = Math.min(...ys) * 0.8, y1 = Math.max(...ys) * 1.2; return { box: [x0, x1, y0, y1], items: [polyline(pts, '#60a5fa'), circ(cur.V, cur.p, (x1 - x0) * 0.015, '#fb923c')] }; }
  };
  // ---------------------------------------------------------------- modern physics
  R.photoelectric = {
    zh: '光电效应', title: 'Photoelectric effect',
    params: [P('nu', '光子频率 ν', 'Photon frequency ν', '×10¹⁴ Hz', 1, 20, 0.05, 8), P('W0', '逸出功 W₀', 'Work function W₀', 'eV', 0.5, 6, 0.01, 2.2), P('h', '普朗克常量 h', 'Planck h', '×10⁻³⁴ J·s', 1, 10, 0.001, 6.626),
      P('intensity', '光强', 'Intensity', '%', 0, 100, 1, 50), P('Vapp', '外加电压 U', 'Applied voltage U', 'V', -6, 6, 0.05, 0)],
    aliases: { wavelength: { zh: '光子波长 λ', unit: 'nm', min: 15, max: 3000, get: m => C0 / (m.nu * 1e14) * 1e9, set: (m, v) => { m.nu = C0 / (v * 1e-9) / 1e14; } } },
    init(m) { m.t = 0; m.count = 0; }, step(m, dt) { m.t += dt; const d = R.photoelectric.derive(m); m.count += (d['emits electrons 发生光电效应'] ? m.intensity * dt : 0); },
    derive(m) { const h = m.h * 1e-34, nu = m.nu * 1e14, E = h * nu / QE, Ek = Math.max(0, E - m.W0), emits = E > m.W0; return { 'photon energy hν (eV)': E, 'wavelength λ=c/ν (nm)': C0 / nu * 1e9, 'threshold frequency ν₀=W₀/h (×10¹⁴ Hz)': m.W0 * QE / h / 1e14, 'max kinetic energy Ek=hν−W₀ (eV)': Ek, 'stopping voltage U_c=Ek/e (V)': Ek, 'emits electrons 发生光电效应': emits ? 1 : 0, 'photocurrent (rel. units)': emits && m.Vapp > -Ek ? m.intensity * (m.Vapp >= 0 ? 1 : (Ek + m.Vapp) / Ek) : 0 }; },
    viz(m) { const d = m.derive(), E = d['photon energy hν (eV)'], Ek = d['max kinetic energy Ek=hν−W₀ (eV)']; const Y = Math.max(E, m.W0) * 1.3 + 0.5; const col = wavelengthColor(d['wavelength λ=c/ν (nm)']);
      return { box: [0, 6, 0, Y], items: [lineV(0, 0, 6, 0, '#1e2c30'), { t: 'rect', x: 0.5, y: 0, w: 1.2, h: E, c: col }, { t: 'rect', x: 2.4, y: 0, w: 1.2, h: m.W0, c: '#8aa096' }, { t: 'rect', x: 4.3, y: 0, w: 1.2, h: Ek, c: '#fb923c' }, txt(0.5, E + 0.15, 'hν', '#e8f0ea'), txt(2.4, m.W0 + 0.15, 'W₀', '#e8f0ea'), txt(4.3, Ek + 0.15, 'Ek', '#e8f0ea')] }; }
  };
  R.decay = {
    zh: '半衰期与放射性衰变', title: 'Radioactive decay',
    params: [P('N0', '初始原子核数 N₀', 'Initial nuclei N₀', '', 100, 10000, 10, 1000), P('halfLife', '半衰期 T½', 'Half-life T½', 's', 1, 100, 0.5, 10)],
    init(m) { m.t = 0; m.hist = [{ x: 0, y: m.N0 }]; }, step(m, dt) { m.t += dt; m.hist.push({ x: m.t, y: m.N0 * Math.pow(0.5, m.t / m.halfLife) }); if (m.hist.length > 1500) m.hist.shift(); },
    derive(m) { const t = m.t || 0, N = m.N0 * Math.pow(0.5, t / m.halfLife), lam = Math.LN2 / m.halfLife; return { 'decay constant λ=ln2/T½ (1/s)': lam, 'remaining N(t)': N, 'fraction remaining': N / m.N0, 'activity A=λN (Bq)': lam * N, 'mean lifetime τ=1/λ (s)': 1 / lam }; },
    viz(m) { const t1 = Math.max(m.halfLife * 5, m.t); const pts = []; for (let t = 0; t <= t1; t += t1 / 80) pts.push({ x: t, y: m.N0 * Math.pow(0.5, t / m.halfLife) }); return { box: [0, t1, 0, m.N0 * 1.1], items: [lineV(0, 0, t1, 0, '#1e2c30'), polyline(pts, '#3d9b6e'), circ(m.t, m.N0 * Math.pow(0.5, m.t / m.halfLife), t1 * 0.012, '#fb923c')] }; }
  };

  // ---------------------------------------------------------------- registry API
  function paramList(kind) { const k = R[kind]; if (!k) return []; const arr = k.params.slice(); for (const [key, a] of Object.entries(k.aliases || {})) arr.push({ key, zh: a.zh, label: key, unit: a.unit, min: a.min, max: a.max, step: (a.max - a.min) / 200, alias: true }); return arr; }
  function make(kind, over) {
    const k = R[kind]; if (!k) throw new Error('unknown module kind: ' + kind);
    const m = { kind }; for (const p of k.params) m[p.key] = p.def; Object.assign(m, over || {}); init(m); return m;
  }
  function init(m) { const k = R[m.kind]; k.init(m); }
  const SUB = { spring: 8, pendulum: 4, collision: 4, projectile: 2, gravitation: 1 };
  function step(m, dt, n) { const k = R[m.kind], s = SUB[m.kind] || 1; for (let i = 0; i < (n || 1); i++) for (let j = 0; j < s; j++) k.step(m, dt / s); }
  function derive(m) { return R[m.kind].derive(m); }
  function viz(m) { const k = R[m.kind]; const mm = Object.assign({}, m, { derive: () => k.derive(m) }); return k.viz(mm); }
  function getParam(m, key) { const k = R[m.kind]; if (k.aliases && k.aliases[key]) return k.aliases[key].get(m); return m[key]; }
  function checkRange(m, p, v) { if (p.enum) { if (!p.enum.includes(v)) return p.key + ' must be one of ' + p.enum.join('/'); return null; } if (typeof v !== 'number' || !isFinite(v)) return p.key + ' must be a number'; if (v < p.min || v > p.max) return p.label + ' (' + p.key + ') must be in [' + p.min + ', ' + p.max + '] ' + (p.unit || ''); return null; }
  function setParam(m, key, v) {
    const k = R[m.kind]; if (!k) return { ok: false, errors: ['unknown module'] };
    const p = paramList(m.kind).find(q => q.key === key); if (!p) return { ok: false, errors: ['unknown parameter ' + key + ' for ' + m.kind] };
    const val = p.enum ? v : Number(v); const e = checkRange(m, p, val); if (e) return { ok: false, errors: [e] };
    if (p.alias) k.aliases[key].set(m, val); else m[key] = val;
    return { ok: true, key, value: val };
  }
  function validateModule(mod, i) {
    const errs = [], warn = []; const k = R[mod && mod.kind]; if (!k) return { errors: ['modules[' + i + '].kind unknown: ' + (mod && mod.kind)], warnings: [] };
    for (const p of k.params) { if (mod[p.key] == null) continue; const e = checkRange(mod, p, mod[p.key]); if (e) errs.push('modules[' + i + '] ' + e); }
    if (mod.kind === 'incline' && mod.mu != null && mod.mu0 != null && mod.mu > mod.mu0) warn.push('kinetic μ should not exceed static μ₀');
    return { errors: errs, warnings: warn };
  }
  root.PhysModules = { REGISTRY: R, kinds: () => Object.keys(R), paramList, make, init, step, derive, viz, getParam, setParam, validateModule, wavelengthColor, consts: { C0, H0, QE, R_GAS } };
})(typeof window !== 'undefined' ? window : globalThis);
