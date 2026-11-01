// Element type definitions for the v3.4.0 library: parameters (units/ranges), physics builders and
// canvas drawing in the app's minimal dark style. All visuals are drawn here (no third-party art).
(function (root) {
  'use strict';
  const PE = root.PhysElements, R = root.PhysRigid || require('./rigid.js');
  const { P, B, S, REF, BASE, BODYP, SURFP, D2R } = PE;
  const reg = PE.register;
  const INK = '#e8f0ea', MUTED = '#8aa096';
  function hexA(h, a) { h = String(h || '#3d9b6e'); if (h[0] !== '#') return h; if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; const n = parseInt(h.slice(1, 7), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function lighten(h) { h = String(h || '#3d9b6e'); if (h[0] !== '#' || h.length < 7) return INK; const n = parseInt(h.slice(1, 7), 16); const f = (v) => Math.min(255, v + 70); return 'rgb(' + f(n >> 16 & 255) + ',' + f(n >> 8 & 255) + ',' + f(n & 255) + ')'; }
  const rotv = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
  const wpt = (el, lx, ly) => { const r = rotv(lx, ly, (el.angle || 0) * D2R); return { x: (el.x || 0) + r.x, y: (el.y || 0) + r.y }; };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  // -------- drawing helpers (local frame: metres, y up) --------
  function L(g, p, fn) { const c = g.c; c.save(); c.translate(g.V.x(p.x), g.V.y(p.y)); c.rotate(-p.a); c.scale(g.V.s, -g.V.s); c.lineWidth = 1.5 / g.V.s; c.lineJoin = 'round'; fn(c); c.restore(); }
  function polyPath(c, v) { c.beginPath(); v.forEach((p, i) => { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.closePath(); }
  function drawShapes(g, el, b, opts) {
    opts = opts || {}; const col = el.color || '#3d9b6e';
    L(g, { x: b.x, y: b.y, a: b.a }, (c) => {
      c.fillStyle = hexA(col, opts.alpha || 0.85); c.strokeStyle = lighten(col);
      b.shapes.forEach(sh => {
        if (sh.kind === 'circle') { c.beginPath(); c.arc(sh.ox, sh.oy, sh.r, 0, Math.PI * 2); c.fill(); if (!opts.noStroke) c.stroke(); }
        else { polyPath(c, sh.verts); c.fill(); if (!opts.noStroke) c.stroke(); }
      });
      if (opts.deco) opts.deco(c, b);
    });
  }
  function hatch(g, p, verts, col) {
    L(g, p, (c) => {
      c.save(); polyPath(c, verts); c.clip(); c.strokeStyle = col || 'rgba(138,160,150,.35)'; c.lineWidth = 1 / g.V.s;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; verts.forEach(v => { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      const step = Math.max(0.12, 8 / g.V.s); c.beginPath(); for (let x = x0 - (y1 - y0); x < x1; x += step) { c.moveTo(x, y0); c.lineTo(x + (y1 - y0), y1); } c.stroke(); c.restore();
    });
  }
  function text(g, s, wx, wy, o) { o = o || {}; const c = g.c; c.save(); c.fillStyle = o.color || INK; c.font = (o.size || 11) + 'px sans-serif'; c.textAlign = o.align || 'left'; c.fillText(s, g.V.x(wx) + (o.dx || 0), g.V.y(wy) + (o.dy || 0)); c.restore(); }
  function arrow(g, x0, y0, x1, y1, col, wpx) { const c = g.c; const ax = g.V.x(x0), ay = g.V.y(y0), bx = g.V.x(x1), by = g.V.y(y1); const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy); if (l < 2) return; const ux = dx / l, uy = dy / l; c.save(); c.strokeStyle = c.fillStyle = col; c.lineWidth = wpx || 1.5; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - 7 * ux + 3.5 * uy, by - 7 * uy - 3.5 * ux); c.lineTo(bx - 7 * ux - 3.5 * uy, by - 7 * uy + 3.5 * ux); c.closePath(); c.fill(); c.restore(); }
  function line(g, a, b, col, w, dash) { const c = g.c; c.save(); c.strokeStyle = col; c.lineWidth = w || 1.5; if (dash) c.setLineDash(dash); c.beginPath(); c.moveTo(g.V.x(a.x), g.V.y(a.y)); c.lineTo(g.V.x(b.x), g.V.y(b.y)); c.stroke(); c.restore(); }
  function zigzag(g, a, b, turns, amp, col) { const c = g.c; const ax = g.V.x(a.x), ay = g.V.y(a.y), bx = g.V.x(b.x), by = g.V.y(b.y); const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1; const ux = dx / l, uy = dy / l; const lead = Math.min(l * 0.15, 14); c.save(); c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + ux * lead, ay + uy * lead); const n = turns * 2; for (let i = 0; i < n; i++) { const t = lead + (l - 2 * lead) * (i + 0.5) / n; const s = (i % 2 ? -1 : 1) * amp; c.lineTo(ax + ux * t - uy * s, ay + uy * t + ux * s); } c.lineTo(bx - ux * lead, by - uy * lead); c.lineTo(bx, by); c.stroke(); c.restore(); }
  const gfx = { L, polyPath, drawShapes, hatch, text, arrow, line, zigzag, hexA, lighten, INK, MUTED };
  PE.gfx = gfx;

  // -------- shared building helpers --------
  const box = (w, h, ox, oy) => R.box(w, h, ox, oy);
  function bodyKinematics(el) { return { x: el.x, y: el.y, a: (el.angle || 0) * D2R, vx: el.vx || 0, vy: el.vy || 0, w: el.omega || 0 }; }
  function bodySpec(el, shapes, extra) {
    return Object.assign(bodyKinematics(el), { shapes, mass: num(el.mass, 1), fixed: !!el.fixed, mu0: num(el.mu0, 0.5), mu: num(el.mu, 0.4), e: num(el.e, 0.3), q: num(el.q, 0), gscale: el.gravity === false ? 0 : 1 }, extra || {});
  }
  function surfSpec(el, shapes, extra) { return Object.assign({ x: el.x, y: el.y, a: (el.angle || 0) * D2R, shapes, fixed: true, surfOnly: true, mu0: num(el.mu0, 0.5), mu: num(el.mu, 0.4), e: num(el.e, 0.3) }, extra || {}); }
  function arcQuads(R0, a0, a1, thick, side, cx, cy, owFn) {
    // quads of an annular strip around (cx,cy); side 'inner' = solid outside the running radius
    const span = a1 - a1 * 0 - a0; const n = Math.max(2, Math.ceil(Math.abs(span) / 4)); const out = [];
    const rin = side === 'inner' ? R0 : R0 - thick, rout = side === 'inner' ? R0 + thick : R0;
    for (let i = 0; i < n; i++) {
      const t0 = (a0 + span * i / n) * D2R, t1 = (a0 + span * (i + 1) / n) * D2R;
      const mid = (t0 + t1) / 2; const ow = owFn && owFn(mid / D2R) ? { dn: true, x: (side === 'inner' ? -1 : 1) * Math.cos(mid), y: (side === 'inner' ? -1 : 1) * Math.sin(mid), px: cx + R0 * Math.cos(mid), py: cy + R0 * Math.sin(mid) } : null;
      out.push({ kind: 'poly', oneWay: ow, verts: [{ x: cx + rin * Math.cos(t0), y: cy + rin * Math.sin(t0) }, { x: cx + rin * Math.cos(t1), y: cy + rin * Math.sin(t1) }, { x: cx + rout * Math.cos(t1), y: cy + rout * Math.sin(t1) }, { x: cx + rout * Math.cos(t0), y: cy + rout * Math.sin(t0) }] });
    }
    return out;
  }
  function slotDeco(el) { return (c, b) => { }; }

  // body-type factory ---------------------------------------------------------------
  function bodyType(id, zh, en, desc, own, o) {
    return reg(Object.assign({
      id, zh, en, desc, cat: o.cat || 'shape', kind: 'body', own: own, dflt: o.dflt,
      build(el, ctx) { const shapes = o.shapes(el); const b = ctx.body(el, bodySpec(el, shapes, o.extra ? o.extra(el) : null)); if (o.after) o.after(el, b, ctx); return b; },
      draw(el, g) { const b = g.body(el); if (!b) return; drawShapes(g, el, b, { deco: o.deco ? (c, bb) => o.deco(c, el, bb, g) : null }); if (el.label) text(g, el.label, b.x, b.y, { dx: 4, dy: -4 }); },
      extent: o.extent, resize: o.resize, afterUpdate: o.afterUpdate
    }, o.def || {}));
  }
  const mk = (a) => a;
  const blockExtent = (el) => [-el.w / 2, -el.h / 2, el.w / 2, el.h / 2];
  const blockResize = (el, lx, ly) => { el.w = Math.max(0.05, +(2 * Math.abs(lx)).toFixed(3)); el.h = Math.max(0.05, +(2 * Math.abs(ly)).toFixed(3)); };

  bodyType('block', '物块/方块', 'Block', '矩形物块，可设质量、摩擦、恢复系数、初速度、电荷。',
    [P('w', '宽 w', 'm', 0.02, 50, 0.05, 0.4, { grp: 'geom' }), P('h', '高 h', 'm', 0.02, 50, 0.05, 0.4, { grp: 'geom' })].concat(BODYP),
    { shapes: (el) => [{ kind: 'poly', verts: box(el.w, el.h) }], extent: blockExtent, resize: blockResize, dflt: { color: '#4d8fd1' } });
  bodyType('plank', '木板（地面上）', 'Plank', '放在地面上的长木板，用来做滑块-木板两物体摩擦问题（两者之间的摩擦因数用「摩擦对」精确指定）。',
    [P('w', '长 w', 'm', 0.1, 50, 0.1, 4, { grp: 'geom' }), P('h', '厚 h', 'm', 0.02, 5, 0.02, 0.2, { grp: 'geom' })].concat(BODYP),
    { shapes: (el) => [{ kind: 'poly', verts: box(el.w, el.h) }], extent: blockExtent, resize: blockResize, dflt: { color: '#b58a4a', mass: 2, w: 4, h: 0.2 } });
  bodyType('cart', '小车/滑车', 'Cart / trolley', '带轮小车：与接触面的摩擦用自己的 μ₀、μ（滚动阻力），默认很小。',
    [P('w', '车长 w', 'm', 0.1, 20, 0.05, 0.8, { grp: 'geom' }), P('h', '车高 h', 'm', 0.05, 5, 0.05, 0.3, { grp: 'geom' }), P('wr', '轮半径', 'm', 0.01, 1, 0.01, 0.07, { grp: 'geom' })].concat(BODYP),
    {
      cat: 'mech', shapes: (el) => [{ kind: 'poly', verts: box(el.w, el.h, 0, el.wr * 0.4) }, { kind: 'circle', r: el.wr, ox: -el.w * 0.32, oy: -el.h / 2 - el.wr * 0.6, k: 0.5 }, { kind: 'circle', r: el.wr, ox: el.w * 0.32, oy: -el.h / 2 - el.wr * 0.6, k: 0.5 }].map(sh => sh),
      extra: () => ({ ownMu: true, noCollideSelf: true }), extent: (el) => [-el.w / 2, -el.h / 2 - 2 * el.wr, el.w / 2, el.h / 2], resize: (el, lx, ly) => { el.w = Math.max(0.1, +(2 * Math.abs(lx)).toFixed(3)); },
      dflt: { color: '#d19a4d', mass: 1, mu0: 0.02, mu: 0.02, e: 0.1 }
    });
  bodyType('ball', '小球', 'Ball', '实心小球（转动惯量系数 k：实心球 0.4，圆柱 0.5，圆环 1），会滚动。',
    [P('r', '半径 r', 'm', 0.01, 20, 0.01, 0.2, { grp: 'geom' }), P('k', '转动惯量系数 k（I=k·m·r²）', '', 0.05, 1, 0.05, 0.4, { grp: 'geom' })].concat(BODYP),
    { shapes: (el) => [{ kind: 'circle', r: el.r, k: el.k }], extent: (el) => [-el.r, -el.r, el.r, el.r], resize: (el, lx, ly) => { el.r = Math.max(0.01, +Math.hypot(lx, ly).toFixed(3)); }, dflt: { color: '#e0a23a', mu0: 0.5, mu: 0.4, e: 0.5 },
      deco: (c, el, b) => { c.strokeStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.moveTo(0, 0); c.lineTo(el.r, 0); c.stroke(); } });
  bodyType('cylinder', '圆柱/圆盘', 'Cylinder / disc', '圆盘或圆柱的侧视图，会滚动（k=0.5）。',
    [P('r', '半径 r', 'm', 0.01, 20, 0.01, 0.25, { grp: 'geom' }), P('k', '转动惯量系数 k', '', 0.05, 1, 0.05, 0.5, { grp: 'geom' })].concat(BODYP),
    { shapes: (el) => [{ kind: 'circle', r: el.r, k: el.k }], extent: (el) => [-el.r, -el.r, el.r, el.r], resize: (el, lx, ly) => { el.r = Math.max(0.01, +Math.hypot(lx, ly).toFixed(3)); }, dflt: { color: '#7fb069', k: 0.5, mu0: 0.5, mu: 0.4 },
      deco: (c, el, b) => { c.strokeStyle = 'rgba(0,0,0,.45)'; for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; c.beginPath(); c.moveTo(-Math.cos(a) * el.r, -Math.sin(a) * el.r); c.lineTo(Math.cos(a) * el.r, Math.sin(a) * el.r); c.stroke(); } } });
  bodyType('ring', '圆环', 'Ring / hoop', '圆环（k=1），会滚动；碰撞按外圆计算。',
    [P('r', '外半径 r', 'm', 0.02, 20, 0.01, 0.3, { grp: 'geom' }), P('t', '环宽 t', 'm', 0.005, 5, 0.005, 0.04, { grp: 'geom' })].concat(BODYP),
    { shapes: (el) => [{ kind: 'circle', r: el.r, k: 1 }], extent: (el) => [-el.r, -el.r, el.r, el.r], resize: (el, lx, ly) => { el.r = Math.max(0.02, +Math.hypot(lx, ly).toFixed(3)); }, dflt: { color: '#c77dff' }, def: {
      draw(el, g) { const b = g.body(el); if (!b) return; L(g, { x: b.x, y: b.y, a: b.a }, (c) => { c.strokeStyle = el.color; c.lineWidth = Math.max(el.t, 1.5 / g.V.s); c.beginPath(); c.arc(0, 0, el.r - el.t / 2, 0, Math.PI * 2); c.stroke(); c.lineWidth = 1.5 / g.V.s; c.strokeStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(el.r - el.t, 0); c.lineTo(el.r, 0); c.stroke(); }); if (el.label) text(g, el.label, b.x, b.y, { dx: 4, dy: -4 }); }
    } });
  bodyType('rod', '细棒/杆（刚体）', 'Rod (rigid body)', '有质量的细棒，可转动。',
    [P('len', '长 L', 'm', 0.05, 50, 0.05, 1.2, { grp: 'geom' }), P('t', '粗 t', 'm', 0.01, 1, 0.01, 0.06, { grp: 'geom' })].concat(BODYP),
    { shapes: (el) => [{ kind: 'poly', verts: box(el.len, el.t) }], extent: (el) => [-el.len / 2, -el.t / 2, el.len / 2, el.t / 2], resize: (el, lx) => { el.len = Math.max(0.05, +(2 * Math.abs(lx)).toFixed(3)); }, dflt: { color: '#9aa7b1' } });
  function wedgeVerts(el) { const b = el.base, h = el.height; let v = el.flip ? [{ x: 0, y: 0 }, { x: -b, y: 0 }, { x: 0, y: h }] : [{ x: 0, y: 0 }, { x: b, y: 0 }, { x: 0, y: h }]; const c = R.polyCentroid(v); v = v.map(p => ({ x: p.x - c.x, y: p.y - c.y })); if (R.polyArea(v) < 0) v.reverse(); return v; }
  bodyType('wedge', '三角劈/斜面体', 'Triangle wedge', '直角三角形物块（可动或固定），直角边在下。',
    [P('base', '底边 b', 'm', 0.05, 50, 0.05, 1, { grp: 'geom' }), P('height', '高 h', 'm', 0.05, 50, 0.05, 0.6, { grp: 'geom' }), B('flip', '镜像（斜面朝左）', false, { grp: 'geom' })].concat(BODYP),
    { shapes: (el) => [{ kind: 'poly', verts: wedgeVerts(el) }], extent: (el) => { const v = wedgeVerts(el); return [Math.min(...v.map(p => p.x)), Math.min(...v.map(p => p.y)), Math.max(...v.map(p => p.x)), Math.max(...v.map(p => p.y))]; }, resize: (el, lx, ly) => { const v = wedgeVerts(el); const x0 = Math.min(...v.map(p => p.x)), y0 = Math.min(...v.map(p => p.y)); el.base = Math.max(0.05, +(Math.abs(lx - x0)).toFixed(3)); el.height = Math.max(0.05, +(Math.abs(ly - y0)).toFixed(3)); }, dflt: { color: '#8f9bb3', mass: 3 } });
  function polyVerts(el) { let v = (el.verts || []).map(p => ({ x: p[0], y: p[1] })); v = R.convexHull(v); if (v.length < 3) v = box(0.4, 0.4); const c = R.polyCentroid(v); return v.map(p => ({ x: p.x - c.x, y: p.y - c.y })); }
  bodyType('polygon', '任意多边形', 'Polygon', '顶点（相对质心）可编辑；非凸多边形按凸包处理。',
    [{ k: 'verts', zh: '顶点 x,y;…', kind: 'verts', def: [[-0.3, -0.2], [0.3, -0.2], [0.4, 0.15], [0, 0.35], [-0.4, 0.15]], grp: 'geom' }].concat(BODYP),
    { shapes: (el) => [{ kind: 'poly', verts: polyVerts(el) }], extent: (el) => { const v = polyVerts(el); return [Math.min(...v.map(p => p.x)), Math.min(...v.map(p => p.y)), Math.max(...v.map(p => p.x)), Math.max(...v.map(p => p.y))]; }, resize: (el, lx, ly) => { const v = polyVerts(el); const k = Math.max(0.1, Math.hypot(lx, ly) / (Math.max(...v.map(p => Math.hypot(p.x, p.y))) || 1)); el.verts = (el.verts || []).map(p => [+(p[0] * k).toFixed(3), +(p[1] * k).toFixed(3)]); }, dflt: { color: '#6a8caf' } });
  bodyType('compound', '组合体（多形状刚体）', 'Compound body', 'parts 是 JSON 数组：{shape:"box"|"circle", w,h,r, dx,dy, da(°)}；整体是一个刚体（可用于自定义元件）。',
    [{ k: 'parts', zh: '组成 parts（JSON）', kind: 'json', def: [{ shape: 'box', w: 0.6, h: 0.2, dx: 0, dy: 0 }, { shape: 'box', w: 0.2, h: 0.5, dx: 0, dy: 0.25 }], grp: 'geom' }].concat(BODYP),
    { shapes: (el) => (el.parts || []).map(p => { if (p.shape === 'circle') return { kind: 'circle', r: Math.max(0.01, +p.r || 0.1), ox: +p.dx || 0, oy: +p.dy || 0, k: 0.5 }; const v = box(Math.max(0.02, +p.w || 0.2), Math.max(0.02, +p.h || 0.2)).map(q => { const r = rotv(q.x, q.y, (+p.da || 0) * D2R); return { x: r.x + (+p.dx || 0), y: r.y + (+p.dy || 0) }; }); return { kind: 'poly', verts: v }; }),
      extent: (el) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; (el.parts || []).forEach(p => { const r = p.shape === 'circle' ? [p.r, p.r] : [(p.w || 0.2) / 2 + Math.abs(p.h || 0) / 4, (p.h || 0.2) / 2 + Math.abs(p.w || 0) / 4]; x0 = Math.min(x0, (p.dx || 0) - r[0]); x1 = Math.max(x1, (p.dx || 0) + r[0]); y0 = Math.min(y0, (p.dy || 0) - r[1]); y1 = Math.max(y1, (p.dy || 0) + r[1]); }); return isFinite(x0) ? [x0, y0, x1, y1] : [-0.2, -0.2, 0.2, 0.2]; },
      resize: null, dflt: { color: '#b07cc6' },
      check: null });
  PE.T.compound.check = (el, s, err) => { if (!Array.isArray(el.parts) || !el.parts.length) err.push(el.id + ': parts 不能为空'); else if (el.parts.length > 24) err.push(el.id + ': parts 最多 24 个'); else el.parts.forEach((p, i) => { if (p.shape !== 'box' && p.shape !== 'circle') err.push(el.id + ': parts[' + i + '].shape 必须是 box 或 circle'); }); };
  bodyType('particle', '带电粒子', 'Charged particle', '小电荷粒子（默认不受重力、留下轨迹），用于电场、磁场、质谱仪、回旋加速器。数值采用演示用 SI 量级。',
    [P('r', '显示半径', 'm', 0.01, 1, 0.01, 0.06, { grp: 'geom' })].concat(BODYP),
    { shapes: (el) => [{ kind: 'circle', r: el.r, k: 0.4 }], extent: (el) => [-el.r, -el.r, el.r, el.r], resize: (el, lx, ly) => { el.r = Math.max(0.01, +Math.hypot(lx, ly).toFixed(3)); },
      dflt: { color: '#ff6b6b', mass: 0.002, q: 0.01, gravity: false, e: 0, mu0: 0, mu: 0 }, after: (el, b, ctx) => { b.noCollide = ctx.s.elements.filter(e => e.type === 'particle' && e.id !== el.id).map(e => e.id); },
      deco: (c, el, b) => { c.fillStyle = '#fff'; c.font = 'bold ' + (el.r * 1.4) + 'px sans-serif'; c.save(); c.scale(1, -1); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(el.q >= 0 ? '+' : '−', 0, 0); c.restore(); } });
  // recentre polygon / wedge after edit so the origin stays at the centre of mass
  PE.T.polygon.afterUpdate = (el) => { const v = (el.verts || []).map(p => ({ x: p[0], y: p[1] })); if (v.length < 3) return; const h = R.convexHull(v); if (h.length < 3) return; const c = R.polyCentroid(h); if (Math.hypot(c.x, c.y) > 1e-6) { el.verts = (el.verts || []).map(p => [+(p[0] - c.x).toFixed(4), +(p[1] - c.y).toFixed(4)]); const r = rotv(c.x, c.y, (el.angle || 0) * D2R); el.x = +((el.x || 0) + r.x).toFixed(4); el.y = +((el.y || 0) + r.y).toFixed(4); } };

  // ---------------- surfaces ----------------
  function surfType(id, zh, en, desc, own, o) {
    return reg({
      id, zh, en, desc, cat: o.cat || 'surface', kind: 'static', own, dflt: o.dflt,
      build(el, ctx) { const sp = o.build(el, ctx); (Array.isArray(sp) ? sp : [sp]).forEach(spec => ctx.body(el, surfSpec(el, spec.shapes, spec.extra))); },
      draw(el, g) { const m = g.rt.map[el.id]; if (!m || !m.bodies.length) return; const col = el.color || '#8aa096'; m.bodies.forEach(b => { drawShapes(g, el, b, { alpha: 0.55, noStroke: !!o.noStroke }); if (o.hatch !== false && b.shapes.length <= 4) b.shapes.forEach(sh => { if (sh.kind === 'poly') hatch(g, { x: b.x, y: b.y, a: b.a }, sh.verts); }); }); if (o.line) o.line(el, g); if (el.label) { const p = g.pose(el); text(g, el.label, p.x, p.y, { dx: 4, dy: -6 }); } },
      extent: o.extent, resize: o.resize
    });
  }
  surfType('ground', '地面', 'Ground', '水平地面，y 是地面高度；可用 segments 设置粗糙/光滑分段，如 "0:2:0.8:0.6; 2:5:0.05:0.05"（x0:x1:μ₀:μ）。',
    [P('w', '长度', 'm', 1, 2000, 1, 60, { grp: 'geom' }), P('thick', '厚度', 'm', 0.05, 20, 0.05, 1, { grp: 'geom' }), { k: 'segments', zh: '分段 x0:x1:μ₀:μ;…', kind: 'text', def: '', grp: 'phys' }].concat(SURFP),
    {
      dflt: { color: '#5b6b66', mu0: 0.5, mu: 0.4, e: 0.3 },
      build(el, ctx) {
        const a = (el.angle || 0) * D2R; const segs = String(el.segments || '').split(';').map(s => s.trim()).filter(Boolean).map(s => { const m = s.split(/[:,]/).map(Number); return m.length >= 4 && m.every(isFinite) ? { x0: m[0], x1: m[1], mu0: m[2], mu: m[3] } : null; }).filter(Boolean).sort((p, q) => p.x0 - q.x0);
        const full = [el.x - el.w / 2, el.x + el.w / 2]; const parts = []; let cur = full[0];
        segs.forEach(sg => { const x0 = Math.max(sg.x0, cur), x1 = Math.min(sg.x1, full[1]); if (x1 <= x0) return; if (x0 > cur) parts.push({ x0: cur, x1: x0, mu0: el.mu0, mu: el.mu }); parts.push({ x0, x1, mu0: sg.mu0, mu: sg.mu }); cur = x1; });
        if (cur < full[1]) parts.push({ x0: cur, x1: full[1], mu0: el.mu0, mu: el.mu });
        parts.forEach(pt => { const cx = (pt.x0 + pt.x1) / 2 - el.x; return ctx.body(el, surfSpec(el, [{ kind: 'poly', verts: box(pt.x1 - pt.x0, el.thick, cx, -el.thick / 2) }], { mu0: pt.mu0, mu: Math.min(pt.mu, pt.mu0), tag: 'ground' })); });
      },
      extent: (el) => [-el.w / 2, -el.thick, el.w / 2, 0.05], resize: (el, lx) => { el.w = Math.max(1, +(2 * Math.abs(lx)).toFixed(2)); }
    });
  // custom build for ground (it needs multiple bodies with own μ): override generic wrapper
  (function () { const T = PE.T.ground; const spec = T._spec; })();
  PE.T.ground.build = function (el, ctx) {
    const segs = String(el.segments || '').split(';').map(s => s.trim()).filter(Boolean).map(s => { const m = s.split(/[:,]/).map(Number); return m.length >= 4 && m.every(isFinite) ? { x0: m[0], x1: m[1], mu0: m[2], mu: m[3] } : null; }).filter(Boolean).sort((p, q) => p.x0 - q.x0);
    const full = [el.x - el.w / 2, el.x + el.w / 2]; const parts = []; let cur = full[0];
    segs.forEach(sg => { const x0 = Math.max(sg.x0, cur), x1 = Math.min(sg.x1, full[1]); if (x1 <= x0) return; if (x0 > cur) parts.push({ x0: cur, x1: x0, mu0: el.mu0, mu: el.mu }); parts.push({ x0, x1, mu0: sg.mu0, mu: sg.mu }); cur = x1; });
    if (cur < full[1]) parts.push({ x0: cur, x1: full[1], mu0: el.mu0, mu: el.mu });
    parts.forEach(pt => { const cx = (pt.x0 + pt.x1) / 2 - el.x; ctx.body(el, Object.assign(surfSpec(el, [{ kind: 'poly', verts: box(pt.x1 - pt.x0, el.thick, cx, -el.thick / 2) }]), { mu0: pt.mu0, mu: Math.min(pt.mu, pt.mu0) })); (ctx.rt.map[el.id].segs = ctx.rt.map[el.id].segs || []).push(pt); });
  };
  const slabBuild = (el) => ({ shapes: [{ kind: 'poly', verts: box(el.len, el.thick) }] });
  const slabOwn = (len, thick) => [P('len', '长 L', 'm', 0.05, 200, 0.05, len, { grp: 'geom' }), P('thick', '厚 t', 'm', 0.01, 5, 0.01, thick, { grp: 'geom' })].concat(SURFP);
  const slabExt = (el) => [-el.len / 2, -el.thick / 2, el.len / 2, el.thick / 2];
  const slabRes = (el, lx, ly) => { el.len = Math.max(0.05, +(2 * Math.abs(lx)).toFixed(3)); el.thick = Math.max(0.01, +(2 * Math.abs(ly)).toFixed(3)); };
  surfType('wall', '竖直墙', 'Wall', '竖直墙/挡板（x,y 为中心）。', [P('h', '高 h', 'm', 0.1, 100, 0.1, 3, { grp: 'geom' }), P('thick', '厚 t', 'm', 0.02, 5, 0.02, 0.2, { grp: 'geom' })].concat(SURFP), { dflt: { color: '#6d7d77', e: 0.4 }, build: (el) => ({ shapes: [{ kind: 'poly', verts: box(el.thick, el.h) }] }), extent: (el) => [-el.thick / 2, -el.h / 2, el.thick / 2, el.h / 2], resize: (el, lx, ly) => { el.h = Math.max(0.1, +(2 * Math.abs(ly)).toFixed(2)); el.thick = Math.max(0.02, +(2 * Math.abs(lx)).toFixed(2)); } });
  surfType('wallSeg', '平板/线段', 'Plate / segment', '任意角度的固定平板（x,y 为中心）。', slabOwn(2, 0.1), { dflt: { color: '#8aa096' }, build: slabBuild, extent: slabExt, resize: slabRes });
  surfType('patch', '粗糙/光滑段', 'Rough / smooth patch', '一段表面，μ₀、μ 可单独设置；放在抬高的平台上（顶面对齐地面时请改用地面的 segments）。', slabOwn(1.5, 0.06), { dflt: { color: '#c0793a', mu0: 0.8, mu: 0.6 }, build: slabBuild, extent: slabExt, resize: slabRes });
  surfType('stopper', '挡板/止动块', 'Stopper / baffle', '固定挡板，默认完全非弹性（e=0）。', [P('h', '高 h', 'm', 0.05, 20, 0.05, 0.6, { grp: 'geom' }), P('thick', '厚 t', 'm', 0.02, 2, 0.02, 0.1, { grp: 'geom' })].concat(SURFP), { cat: 'mech', dflt: { color: '#c75c5c', e: 0, mu0: 0.3, mu: 0.2 }, build: (el) => ({ shapes: [{ kind: 'poly', verts: box(el.thick, el.h) }] }), extent: (el) => [-el.thick / 2, -el.h / 2, el.thick / 2, el.h / 2], resize: (el, lx, ly) => { el.h = Math.max(0.05, +(2 * Math.abs(ly)).toFixed(2)); } });
  function inclineVerts(el) { const th = el.slope * D2R, Lx = el.len * Math.cos(th), Ly = el.len * Math.sin(th); const s = el.flip ? -1 : 1; let v = [{ x: 0, y: 0 }, { x: s * Lx, y: Ly }, { x: s * Lx, y: 0 }]; if (R.polyArea(v) < 0) v.reverse(); return v; }
  surfType('incline', '斜面', 'Incline', '斜面（x,y 是斜面底端）：倾角 θ、斜面长 L、μ₀/μ。',
    [P('slope', '倾角 θ', '°', 1, 85, 1, 30, { grp: 'geom' }), P('len', '斜面长 L', 'm', 0.1, 100, 0.1, 3, { grp: 'geom' }), B('flip', '镜像（向左升高）', false, { grp: 'geom' })].concat(SURFP),
    { dflt: { color: '#6d7d77', mu0: 0.3, mu: 0.2 }, build: (el) => ({ shapes: [{ kind: 'poly', verts: inclineVerts(el) }] }), extent: (el) => { const v = inclineVerts(el); return [Math.min(...v.map(p => p.x)), 0, Math.max(...v.map(p => p.x)), Math.max(...v.map(p => p.y))]; },
      resize: (el, lx, ly) => { const d = Math.hypot(lx, ly); el.len = Math.max(0.1, +d.toFixed(2)); el.slope = Math.max(1, Math.min(85, +(Math.atan2(Math.abs(ly), Math.abs(lx)) / D2R).toFixed(1))); } });
  const arcOwn = (R0, a0, a1, side) => [P('R', '轨道半径 R', 'm', 0.05, 100, 0.05, R0, { grp: 'geom' }), P('a0', '起始角', '°', -720, 720, 5, a0, { grp: 'geom' }), P('a1', '终止角', '°', -720, 720, 5, a1, { grp: 'geom' }), P('thick', '轨道厚', 'm', 0.02, 2, 0.02, 0.1, { grp: 'geom' }), S('side', '运行面', [{ v: 'inner', zh: '内侧（球在圆内）' }, { v: 'outer', zh: '外侧（球在圆外）' }], side, { grp: 'geom' })].concat(SURFP);
  function arcBuild(el) { return { shapes: arcQuads(el.R, el.a0, el.a1, el.thick, el.side, 0, 0) }; }
  const arcExt = (el) => { const r = el.R + el.thick; return [-r, -r, r, r]; };
  const arcRes = (el, lx, ly) => { el.R = Math.max(0.05, +Math.hypot(lx, ly).toFixed(2)); };
  const arcLine = (el, g) => { const p = g.pose(el); L(g, p, (c) => { c.strokeStyle = 'rgba(232,240,234,.55)'; c.beginPath(); c.arc(0, 0, el.R, el.a0 * D2R, el.a1 * D2R, el.a1 < el.a0); c.stroke(); }); };
  surfType('arc', '圆弧轨道', 'Arc track', '圆弧轨道，圆心在 (x,y)，R 为运行半径；起止角可设（逆时针），内/外侧运行。', arcOwn(1, 180, 360, 'inner'), { dflt: { color: '#7a8a84', mu0: 0.1, mu: 0.05 }, build: arcBuild, extent: arcExt, resize: arcRes, hatch: false, noStroke: true, line: arcLine });
  surfType('semiTrack', '半圆轨道', 'Semicircular track', '半圆形碗状轨道（180°→360°）。', arcOwn(1, 180, 360, 'inner'), { dflt: { color: '#7a8a84', mu0: 0.05, mu: 0.02 }, build: arcBuild, extent: arcExt, resize: arcRes, hatch: false, noStroke: true, line: arcLine });
  surfType('quarterRamp', '四分之一圆弧斜坡', 'Quarter-circle ramp', '凹形（球从高处滑下）或凸形（球在圆弧顶部滑下）的四分之一圆弧；x,y 是圆心。',
    [P('R', '半径 R', 'm', 0.05, 100, 0.05, 1, { grp: 'geom' }), P('thick', '轨道厚', 'm', 0.02, 2, 0.02, 0.1, { grp: 'geom' }), B('convex', '凸形（外侧运行）', false, { grp: 'geom' }), B('flip', '镜像（向左下）', false, { grp: 'geom' })].concat(SURFP),
    { dflt: { color: '#7a8a84', mu0: 0.1, mu: 0.05 }, build: (el) => { const cv = el.convex, fl = el.flip; const a0 = cv ? (fl ? 90 : 0) : (fl ? 270 : 180); return { shapes: arcQuads(el.R, a0, a0 + 90, el.thick, cv ? 'outer' : 'inner', 0, 0) }; }, extent: arcExt, resize: arcRes, hatch: false, noStroke: true,
      line: (el, g) => { const cv = el.convex, fl = el.flip; const a0 = cv ? (fl ? 90 : 0) : (fl ? 270 : 180); L(g, g.pose(el), (c) => { c.strokeStyle = 'rgba(232,240,234,.55)'; c.beginPath(); c.arc(0, 0, el.R, a0 * D2R, (a0 + 90) * D2R); c.stroke(); }); } });
  // loop-the-loop: quarter ramp (optional) → floor → full ring with a small gap at the bottom → exit floor
  surfType('loop', '竖直圆环轨道（回环）', 'Loop-the-loop', '入口四分之一圆弧 + 平地 + 竖直圆环（底部有小缺口）+ 出口平地。x,y 是圆环最低点；小球可从入口圆弧释放。2D 投影：通过环后可能再次进入圆环。',
    [P('R', '圆环半径 R', 'm', 0.1, 20, 0.05, 0.5, { grp: 'geom' }), P('Rq', '入口圆弧半径（0=无）', 'm', 0, 50, 0.1, 1.6, { grp: 'geom' }), P('floor', '入口平地长', 'm', 0, 20, 0.1, 0.6, { grp: 'geom' }), P('exitLen', '出口平地长', 'm', 0, 50, 0.1, 2, { grp: 'geom' }), P('gap', '底部缺口角', '°', 4, 40, 1, 14, { grp: 'geom' }), P('thick', '轨道厚', 'm', 0.02, 1, 0.02, 0.08, { grp: 'geom' })].concat(SURFP),
    {
      dflt: { color: '#7a8a84', mu0: 0.05, mu: 0.02 },
      build: (el) => {
        const sh = []; const t = el.thick;
        sh.push(...arcQuads(el.R, -90 + el.gap / 2, 270 - el.gap / 2, t, 'inner', 0, el.R, (m) => m > 185 && m < 270));
        if (el.floor > 0) sh.push({ kind: 'poly', verts: box(el.floor + 0.0, t, -el.floor / 2, -t / 2) });
        if (el.Rq > 0) sh.push(...arcQuads(el.Rq, 180, 270, t, 'inner', -el.floor, el.Rq));
        if (el.exitLen > 0) sh.push({ kind: 'poly', verts: box(el.exitLen, t, el.exitLen / 2 + 0.0, -t / 2) });
        return { shapes: sh };
      },
      extent: (el) => [-(el.floor + el.Rq + 0.2), -0.1, el.exitLen + el.R, 2 * el.R + 0.1], resize: (el, lx, ly) => { el.R = Math.max(0.1, +(Math.abs(ly) / 2).toFixed(2)); }, hatch: false, noStroke: true
    });

  // ---------------- mechanisms ----------------
  reg({
    id: 'conveyor', zh: '传送带', en: 'Conveyor belt', cat: 'mech', kind: 'static',
    desc: '传送带：表面速度 = 带速（可反向、可倾斜）。物块与带面之间先静摩擦（μ₀）带动，超过最大静摩擦则滑动摩擦（μ），直到速度与带相同。',
    own: [P('len', '带长 L', 'm', 0.3, 200, 0.1, 5, { grp: 'geom' }), P('thick', '厚度', 'm', 0.05, 2, 0.01, 0.15, { grp: 'geom' }), P('speed', '带速 v', 'm/s', 0, 100, 0.1, 2, { grp: 'phys', live: true }), S('dir', '方向（沿带的 +x）', [{ v: 'fwd', zh: '正向 →' }, { v: 'rev', zh: '反向 ←' }], 'fwd', { grp: 'phys', live: true }),
      P('mu0', '静摩擦因数 μ₀', '', 0, 5, 0.05, 0.6, { grp: 'phys', live: true }), P('mu', '动摩擦因数 μ', '', 0, 5, 0.05, 0.5, { grp: 'phys', live: true }), P('e', '恢复系数 e', '', 0, 1, 0.05, 0.1, { grp: 'phys', live: true })],
    dflt: { color: '#556b6a' }, live: ['speed', 'dir', 'mu0', 'mu', 'e', 'label', 'color'],
    build(el, ctx) {
      const b = ctx.body(el, surfSpec(el, [{ kind: 'poly', verts: box(el.len, el.thick) }], { surfaceSpeed: (el.dir === 'rev' ? -1 : 1) * el.speed, tag: 'belt' }));
      ctx.hook(() => { b.surfaceSpeed = (el.dir === 'rev' ? -1 : 1) * el.speed; b.mu0 = el.mu0; b.mu = Math.min(el.mu, el.mu0); b.e = el.e; });
    },
    draw(el, g) {
      const b = g.body(el); if (!b) return; const p = { x: b.x, y: b.y, a: b.a }; const sp = (el.dir === 'rev' ? -1 : 1) * el.speed; const ph = ((g.t * sp) % 0.3 + 0.3) % 0.3;
      L(g, p, (c) => {
        const L2 = el.len / 2, t = el.thick / 2; c.fillStyle = hexA(el.color, 0.9); c.strokeStyle = lighten(el.color);
        c.beginPath(); c.moveTo(-L2, -t); c.lineTo(L2, -t); c.arc(L2, 0, t, -Math.PI / 2, Math.PI / 2); c.lineTo(-L2, t); c.arc(-L2, 0, t, Math.PI / 2, 3 * Math.PI / 2); c.closePath(); c.fill(); c.stroke();
        c.strokeStyle = 'rgba(232,240,234,.5)'; c.beginPath(); for (let x = -L2 + ph; x < L2; x += 0.3) { c.moveTo(x, t * 0.55); c.lineTo(x, t); c.moveTo(x, -t); c.lineTo(x, -t * 0.55); } c.stroke();
        c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(L2, 0, t * 0.55, 0, 7); c.fill(); c.beginPath(); c.arc(-L2, 0, t * 0.55, 0, 7); c.fill();
      });
      const d = sp >= 0 ? 1 : -1; const a0 = rotv(0, el.thick / 2 + 0.12, b.a); arrow(g, b.x + a0.x - d * 0.3 * Math.cos(b.a), b.y + a0.y - d * 0.3 * Math.sin(b.a), b.x + a0.x + d * 0.3 * Math.cos(b.a), b.y + a0.y + d * 0.3 * Math.sin(b.a), '#fbbf24', 2);
      text(g, (el.label ? el.label + ' ' : '') + 'v=' + el.speed + ' m/s', b.x, b.y, { dx: -24, dy: -el.thick * g.V.s / 2 - 16, size: 10, color: MUTED });
    },
    extent: (el) => [-el.len / 2 - el.thick / 2, -el.thick / 2, el.len / 2 + el.thick / 2, el.thick / 2], resize: (el, lx) => { el.len = Math.max(0.3, +(2 * Math.abs(lx) - el.thick).toFixed(2)); }
  });
  reg({
    id: 'pulley', zh: '滑轮', en: 'Pulley', cat: 'mech', kind: 'body', hardPulley: true,
    desc: '定滑轮/动滑轮。「理想」= 轻质无摩擦；否则按圆盘转动惯量 I=½·m·r² 计入（单个定滑轮 + 两端物体时精确，其他连接方式按理想处理并提示）。',
    own: [P('r', '半径 r', 'm', 0.02, 5, 0.01, 0.15, { grp: 'geom' }), B('ideal', '理想滑轮（轻、无摩擦）', true, { grp: 'phys' }), P('mass', '滑轮质量 m', 'kg', 0.001, 1000, 0.1, 0.5, { grp: 'phys' }), B('fixed', '固定（定滑轮）', true, { grp: 'phys' }), B('gravity', '受重力（动滑轮）', true, { grp: 'phys' })],
    dflt: { color: '#aab6bf' },
    build(el, ctx) {
      const b = ctx.body(el, { x: el.x, y: el.y, a: 0, shapes: [{ kind: 'circle', r: el.r, k: 0.5 }], mass: el.mass, fixed: !!el.fixed, sensor: true, gscale: el.gravity === false ? 0 : 1 });
      return b;
    },
    draw(el, g) {
      const b = g.body(el); if (!b) return; const m = g.rt.map[el.id]; const ang = (m && m.wheelJoint && m.wheelJoint.wheelAngle) || 0;
      if (el.fixed) { line(g, { x: b.x, y: b.y }, { x: b.x, y: b.y + Math.max(0.5, el.r * 3) }, MUTED, 2); }
      L(g, { x: b.x, y: b.y, a: ang }, (c) => { c.fillStyle = hexA(el.color, 0.35); c.strokeStyle = lighten(el.color); c.lineWidth = 2 / g.V.s; c.beginPath(); c.arc(0, 0, el.r, 0, 7); c.fill(); c.stroke(); c.lineWidth = 1 / g.V.s; for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; c.beginPath(); c.moveTo(-Math.cos(a) * el.r * 0.8, -Math.sin(a) * el.r * 0.8); c.lineTo(Math.cos(a) * el.r * 0.8, Math.sin(a) * el.r * 0.8); c.stroke(); } c.fillStyle = INK; c.beginPath(); c.arc(0, 0, el.r * 0.12, 0, 7); c.fill(); });
      if (el.label) text(g, el.label, b.x, b.y, { dx: el.r * g.V.s + 4, dy: -4 });
    },
    extent: (el) => [-el.r, -el.r, el.r, el.r], resize: (el, lx, ly) => { el.r = Math.max(0.02, +Math.hypot(lx, ly).toFixed(3)); }
  });
  // ----- link elements: two anchors (element + local offset, or world point when the element is empty)
  const LINKP = [REF('a', '端点 A 所在元件（空=世界点）'), P('ax', 'A 偏移 x（无元件=世界 x）', 'm', -1000, 1000, 0.05, 0, { grp: 'ends' }), P('ay', 'A 偏移 y（无元件=世界 y）', 'm', -1000, 1000, 0.05, 0, { grp: 'ends' }), REF('b', '端点 B 所在元件（空=世界点）'), P('bx', 'B 偏移 x（无元件=世界 x）', 'm', -1000, 1000, 0.05, 1, { grp: 'ends' }), P('by', 'B 偏移 y（无元件=世界 y）', 'm', -1000, 1000, 0.05, 0, { grp: 'ends' })];
  const LOOK = [{ k: 'label', zh: '标签', kind: 'text', def: '', grp: 'look' }, { k: 'color', zh: '颜色', kind: 'color', def: '#c9d1d9', grp: 'look' }];
  const ANCH = [['a', 'ax', 'ay'], ['b', 'bx', 'by']];
  function nodeOf(ctx, el, pre) { const id = el[pre]; const x = num(el[pre + 'x'], 0), y = num(el[pre + 'y'], 0); if (id) { const b = ctx.bodyOf(id); if (!b) throw new Error('端点 ' + pre.toUpperCase() + ' 的元件 ' + id + ' 没有刚体'); return { b, l: { x, y } }; } return { b: null, l: { x, y } }; }
  const nodeW = (n) => (n.b ? R.toWorld(n.b, n.l) : { x: n.l.x, y: n.l.y });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function tangentPt(C, r, E) { const d = dist(C, E); if (d <= r * 1.0001) return { x: C.x, y: C.y }; const al = Math.atan2(E.y - C.y, E.x - C.x), be = Math.acos(r / d); const c1 = { x: C.x + r * Math.cos(al + be), y: C.y + r * Math.sin(al + be) }, c2 = { x: C.x + r * Math.cos(al - be), y: C.y + r * Math.sin(al - be) }; return c1.y >= c2.y ? c1 : c2; }
  function linkExtent(el) { return [-0.1, -0.1, 0.1, 0.1]; }
  function linkEnds(el, g) { const m = g.rt.map[el.id]; return m && m.ends ? m.ends() : null; }
  function mapLink(ctx, el, ends) { ctx.rt.map[el.id].ends = ends; }
  reg({
    id: 'rope', zh: '轻绳', en: 'Light rope', cat: 'mech', kind: 'link', base: false, dependent: true, hardRefs: ['a', 'b', 'via', 'via2'], anchorKeys: ANCH,
    desc: '轻绳：只能拉不能推，可绕过 1–2 个滑轮（via）。length=0 表示按初始位置自动取绳长；设置更大的长度则初始松弛。',
    own: LOOK.concat(LINKP, [REF('via', '绕过滑轮 1'), REF('via2', '绕过滑轮 2'), P('length', '绳长（0=自动）', 'm', 0, 1000, 0.05, 0, { grp: 'geom' })]),
    dflt: {},
    build(el, ctx) {
      const A = nodeOf(ctx, el, 'a'), Bn = nodeOf(ctx, el, 'b'); const nodes = [A]; const pul = [];
      const via = [el.via, el.via2].filter(Boolean);
      via.forEach((id, vi) => {
        const pe = ctx.el(id); const pb = ctx.bodyOf(id); if (!pe || !pb) throw new Error('滑轮 ' + id + ' 不存在');
        const prevW = nodeW(nodes[nodes.length - 1]);
        const nextW = vi + 1 < via.length ? { x: ctx.bodyOf(via[vi + 1]).x, y: ctx.bodyOf(via[vi + 1]).y } : nodeW(Bn);
        if (pe.fixed) { nodes.push({ b: null, l: tangentPt({ x: pb.x, y: pb.y }, pe.r, prevW) }); nodes.push({ b: null, l: tangentPt({ x: pb.x, y: pb.y }, pe.r, nextW) }); }
        else { const left = prevW.x <= pb.x; nodes.push({ b: pb, l: { x: left ? -pe.r : pe.r, y: 0 } }); nodes.push({ b: pb, l: { x: left ? pe.r : -pe.r, y: 0 } }); }
        pul.push({ pe, pb });
      });
      nodes.push(Bn);
      let auto = 0; for (let i = 1; i < nodes.length; i++) auto += dist(nodeW(nodes[i - 1]), nodeW(nodes[i]));
      const Ltot = el.length > 0 ? Math.max(el.length, 0.01) : auto;
      const m = ctx.rt.map[el.id]; m.nodes = nodes;
      let j;
      if (pul.length === 1 && pul[0].pe.fixed && !pul[0].pe.ideal && A.b && Bn.b && nodes.length === 4) {
        const pe = pul[0].pe; const gA = nodes[1].l, gB = nodes[2].l; const dd = dist(gA, gB);
        j = { kind: 'pulley', A: A.b, B: Bn.b, la: A.l, lb: Bn.l, gA, gB, ratio: 1, total: Ltot - dd, wheelI: 0.5 * pe.mass * pe.r * pe.r, wheelR: pe.r, wheelW: 0, dir: nodeW(A).x <= pul[0].pb.x ? 1 : -1, type: 'rope', arc: dd };
        const pm = ctx.rt.map[pe.id]; if (pm) pm.wheelJoint = j;
        ctx.joint(el, j);
      } else {
        if (pul.some(p => !p.pe.ideal)) ctx.rt.warnings.push(el.id + ': 绳经多个滑轮或动滑轮时滑轮转动惯量按理想处理');
        j = { kind: 'rope2', nodes, length: Ltot, type: 'rope' }; ctx.joint(el, j);
      }
      m.slack = () => (j.kind === 'pulley' ? !j.taut : !j.taut);
      m.joint = j;
      m.ends = () => { const pts = nodes.map(nodeW); if (j.kind === 'pulley') return [nodeW(A), nodes[1].l, nodes[2].l, nodeW(Bn)]; return pts; };
    },
    draw(el, g) { const pts = linkEnds(el, g); if (!pts) return; const c = g.c; const m = g.rt.map[el.id]; const slack = m.joint && m.joint.taut === false; c.save(); c.strokeStyle = el.color || '#c9d1d9'; c.lineWidth = slack ? 1 : 2; if (slack) c.setLineDash([5, 4]); c.beginPath(); pts.forEach((p, i) => { if (i) c.lineTo(g.V.x(p.x), g.V.y(p.y)); else c.moveTo(g.V.x(p.x), g.V.y(p.y)); }); c.stroke(); c.restore(); pts.forEach((p, i) => { if (i === 0 || i === pts.length - 1) { c.save(); c.fillStyle = INK; c.beginPath(); c.arc(g.V.x(p.x), g.V.y(p.y), 2.5, 0, 7); c.fill(); c.restore(); } }); if (el.label) text(g, el.label, (pts[0].x + pts[pts.length - 1].x) / 2, (pts[0].y + pts[pts.length - 1].y) / 2, { dx: 4, dy: -4 }); },
    quantity(el, q, s, rt) { const j = rt.map[el.id] && rt.map[el.id].joint; if (q === 'T' && j) return j.T || 0; return null; },
    readout(el, s, rt) { const j = rt.map[el.id] && rt.map[el.id].joint; if (!j) return null; return { 'tension T (N)': j.T || 0 }; }
  });
  reg({
    id: 'lightRod', zh: '轻杆', en: 'Light rod', cat: 'mech', kind: 'link', base: false, dependent: true, hardRefs: ['a', 'b'], anchorKeys: ANCH,
    desc: '轻质刚性杆：保持两端距离不变，可受拉也可受压。length=0 自动取初始距离。',
    own: LOOK.concat(LINKP, [P('length', '杆长（0=自动）', 'm', 0, 1000, 0.05, 0, { grp: 'geom' })]),
    build(el, ctx) { const A = nodeOf(ctx, el, 'a'), Bn = nodeOf(ctx, el, 'b'); const Ls = el.length > 0 ? el.length : dist(nodeW(A), nodeW(Bn)); const j = ctx.joint(el, { kind: 'dist', A: A.b, B: Bn.b, la: A.l, lb: Bn.l, length: Ls, type: 'rod' }); const m = ctx.rt.map[el.id]; m.joint = j; m.ends = () => [nodeW(A), nodeW(Bn)]; },
    draw(el, g) { const p = linkEnds(el, g); if (!p) return; line(g, p[0], p[1], el.color || '#c9d1d9', 4); [p[0], p[1]].forEach(q => { g.c.save(); g.c.fillStyle = INK; g.c.beginPath(); g.c.arc(g.V.x(q.x), g.V.y(q.y), 3, 0, 7); g.c.fill(); g.c.restore(); }); if (el.label) text(g, el.label, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, { dx: 4, dy: -4 }); },
    quantity(el, q, s, rt) { const j = rt.map[el.id] && rt.map[el.id].joint; return q === 'T' && j ? -(j.lam || 0) / (s.dt / rt.world.sub) : null; }
  });
  function springBuild(cord, scale) {
    return function (el, ctx) {
      const A = nodeOf(ctx, el, 'a'), Bn = nodeOf(ctx, el, 'b'); const L0 = dist(nodeW(A), nodeW(Bn)); const rest = el.rest > 0 ? el.rest : L0; const m = ctx.rt.map[el.id]; m.rest = rest; m.F = 0; m.len = L0;
      m.ends = () => [nodeW(A), nodeW(Bn)];
      ctx.hook((w, h) => {
        const pa = nodeW(A), pb = nodeW(Bn); const dx = pb.x - pa.x, dy = pb.y - pa.y, Lc = Math.hypot(dx, dy) || 1e-9, ux = dx / Lc, uy = dy / Lc;
        const rest2 = el.rest > 0 ? el.rest : m.rest; const k = scale ? 2000 : el.k;
        let F = k * (Lc - rest2); if (cord && Lc <= rest2) F = 0;
        const va = A.b ? { x: A.b.vx - A.b.w * (pa.y - A.b.y), y: A.b.vy + A.b.w * (pa.x - A.b.x) } : { x: 0, y: 0 }, vb = Bn.b ? { x: Bn.b.vx - Bn.b.w * (pb.y - Bn.b.y), y: Bn.b.vy + Bn.b.w * (pb.x - Bn.b.x) } : { x: 0, y: 0 };
        const vrel = (vb.x - va.x) * ux + (vb.y - va.y) * uy; if (!cord || Lc > rest2) F += (el.damping || 0) * vrel; if (cord && F < 0) F = 0;
        m.F = F; m.len = Lc;
        if (A.b) { A.b.fx += F * ux; A.b.fy += F * uy; A.b.tq += (pa.x - A.b.x) * F * uy - (pa.y - A.b.y) * F * ux; }
        if (Bn.b) { Bn.b.fx -= F * ux; Bn.b.fy -= F * uy; Bn.b.tq += (pb.x - Bn.b.x) * (-F * uy) - (pb.y - Bn.b.y) * (-F * ux); }
      });
    };
  }
  const SPRINGP = (k, rest) => [P('k', '劲度系数 k', 'N/m', 0.01, 100000, 1, k, { grp: 'phys', live: true }), P('rest', '原长（0=初始距离）', 'm', 0, 1000, 0.05, rest, { grp: 'geom' }), P('damping', '阻尼 c', 'N·s/m', 0, 1000, 0.1, 0, { grp: 'phys', live: true }), P('turns', '显示圈数', '', 3, 40, 1, 10, { grp: 'look' })];
  reg({
    id: 'spring', zh: '弹簧', en: 'Spring', cat: 'mech', kind: 'link', base: false, dependent: true, hardRefs: ['a', 'b'], anchorKeys: ANCH, live: ['k', 'damping', 'turns', 'label', 'color'],
    desc: '轻弹簧：F = k·(L − 原长)，既可拉伸也可压缩。rest=0 表示初始距离即原长。', own: LOOK.concat(LINKP, SPRINGP(50, 0)), build: springBuild(false, false),
    draw(el, g) { const p = linkEnds(el, g); if (!p) return; zigzag(g, p[0], p[1], el.turns || 10, 7, el.color || '#fbbf24'); if (el.label) text(g, el.label, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, { dx: 4, dy: -10 }); },
    quantity(el, q, s, rt) { const m = rt.map[el.id]; return q === 'T' && m ? m.F : null; }, readout(el, s, rt) { const m = rt.map[el.id]; return m ? { 'force F (N)': m.F, 'length (m)': m.len } : null; }
  });
  reg({
    id: 'cord', zh: '弹性绳', en: 'Elastic cord', cat: 'mech', kind: 'link', base: false, dependent: true, hardRefs: ['a', 'b'], anchorKeys: ANCH, live: ['k', 'damping', 'label', 'color'],
    desc: '弹性绳：只在拉伸（L>原长）时产生拉力 k·(L−原长)，松弛时没有力。', own: LOOK.concat(LINKP, SPRINGP(40, 0).filter(p => p.k !== 'turns')), dflt: { color: '#f08c5a' }, build: springBuild(true, false),
    draw(el, g) { const p = linkEnds(el, g); if (!p) return; const m = g.rt.map[el.id]; const slack = m && m.F <= 0; const c = g.c; c.save(); c.strokeStyle = el.color || '#f08c5a'; c.lineWidth = slack ? 1.2 : 2.4; if (slack) c.setLineDash([4, 3]); c.beginPath(); c.moveTo(g.V.x(p[0].x), g.V.y(p[0].y)); c.lineTo(g.V.x(p[1].x), g.V.y(p[1].y)); c.stroke(); c.restore(); if (el.label) text(g, el.label, (p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, { dx: 4, dy: -6 }); },
    quantity(el, q, s, rt) { const m = rt.map[el.id]; return q === 'T' && m ? m.F : null; }
  });
  reg({
    id: 'hinge', zh: '铰链/固定销', en: 'Hinge / pin', cat: 'mech', kind: 'link', base: false, dependent: true, hardRefs: ['a', 'b'], anchorKeys: [],
    desc: '在世界点 (x,y) 把元件 A 与元件 B（或空=固定在世界上）连接：pin=自由转动的铰链，weld=固接。',
    own: LOOK.concat([REF('a', '元件 A（空=世界）'), REF('b', '元件 B（空=世界）'), P('x', '销点 x', 'm', -1000, 1000, 0.05, 0, { grp: 'pos' }), P('y', '销点 y', 'm', -1000, 1000, 0.05, 0, { grp: 'pos' }), S('mode', '类型', [{ v: 'pin', zh: '铰链（可转动）' }, { v: 'weld', zh: '固接（不转动）' }], 'pin', { grp: 'phys' })]),
    build(el, ctx) {
      const pt = { x: el.x, y: el.y }; const ba = el.a ? ctx.bodyOf(el.a) : null, bb = el.b ? ctx.bodyOf(el.b) : null; if (!ba && !bb) throw new Error('铰链至少连接一个元件');
      const loc = (b) => { if (!b) return { x: pt.x, y: pt.y }; const dx = pt.x - b.x, dy = pt.y - b.y; return { x: dx * Math.cos(-b.a) - dy * Math.sin(-b.a), y: dx * Math.sin(-b.a) + dy * Math.cos(-b.a) }; };
      ctx.joint(el, { kind: el.mode === 'weld' ? 'weld' : 'pin', A: ba, B: bb, la: loc(ba), lb: loc(bb), refAngle: (bb ? bb.a : 0) - (ba ? ba.a : 0) });
    },
    draw(el, g) { const c = g.c; const m = g.rt.map[el.id]; const j = m && m.joints[0]; let p = { x: el.x, y: el.y }; if (j) { const A = j.A, B = j.B; p = A ? R.toWorld(A, j.la) : (B ? R.toWorld(B, j.lb) : p); } c.save(); c.strokeStyle = INK; c.fillStyle = '#0b1416'; c.lineWidth = 2; c.beginPath(); c.arc(g.V.x(p.x), g.V.y(p.y), 6, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.moveTo(g.V.x(p.x), g.V.y(p.y) - 6); c.lineTo(g.V.x(p.x), g.V.y(p.y) + 6); c.stroke(); c.restore(); if (el.label) text(g, el.label, p.x, p.y, { dx: 8, dy: -8 }); },
    extent: () => [-0.12, -0.12, 0.12, 0.12], free: false
  });
  reg({
    id: 'turntable', zh: '转盘（俯视）', en: 'Turntable (top view)', cat: 'mech', kind: 'body', hard: true,
    desc: '俯视图转盘：盘上的物块（建立场景时圆心在盘内的物块/小球/圆柱）受摩擦力随盘转动；超过最大静摩擦就滑动。盘上物体不受重力沿面方向影响（俯视），支持力 N=mg。',
    own: [P('r', '半径 r', 'm', 0.1, 50, 0.05, 1.5, { grp: 'geom' }), P('omega0', '初角速度 ω₀', 'rad/s', -100, 100, 0.1, 0, { grp: 'phys', live: true }), P('alpha', '角加速度 α', 'rad/s²', -100, 100, 0.05, 0.3, { grp: 'phys', live: true }), P('omegaMax', '角速度上限（0=无）', 'rad/s', 0, 1000, 0.5, 0, { grp: 'phys', live: true }), P('mu0', '静摩擦因数 μ₀', '', 0, 5, 0.05, 0.5, { grp: 'phys' }), P('mu', '动摩擦因数 μ', '', 0, 5, 0.05, 0.4, { grp: 'phys' })],
    dflt: { color: '#3b5360' }, live: ['omega0', 'alpha', 'omegaMax', 'label', 'color'],
    build(el, ctx) {
      const b = ctx.body(el, { x: el.x, y: el.y, a: 0, fixed: true, sensor: true, shapes: [{ kind: 'circle', r: el.r }] });
      const riders = []; let collected = false;
      const collect = () => { collected = true; const statics = ctx.s.elements.filter(e => PE.T[e.type] && PE.T[e.type].kind === 'static').map(e => e.id);
        ctx.s.elements.forEach(e => { const T = PE.T[e.type]; if (!T || T.kind !== 'body' || e.type === 'turntable' || e.fixed) return; const bb = ctx.bodyOf(e.id); if (bb && Math.hypot(bb.x - el.x, bb.y - el.y) <= el.r) { riders.push(bb); bb.gscale = 0; bb.noCollide = (bb.noCollide || []).concat(statics); } }); };
      const m = ctx.rt.map[el.id]; m.angle = 0; m.omega = el.omega0; m.riders = riders;
      ctx.hook((w, h) => {
        if (!collected) collect();
        let om = el.omega0 + el.alpha * w.t; if (el.omegaMax > 0) om = Math.max(-el.omegaMax, Math.min(el.omegaMax, om)); const al = (el.omegaMax > 0 && Math.abs(el.omega0 + el.alpha * w.t) >= el.omegaMax) ? 0 : el.alpha;
        m.omega = om; m.angle += om * h; const g = ctx.gAcc;
        riders.forEach(r => {
          const px = r.x - el.x, py = r.y - el.y; const vdx = -om * py, vdy = om * px; const rx = r.vx - vdx, ry = r.vy - vdy; const rl = Math.hypot(rx, ry);
          const adx = -om * om * px - al * py, ady = -om * om * py + al * px; const Fx = r.m * adx - r.fx, Fy = r.m * ady - r.fy; const Fr = Math.hypot(Fx, Fy); const N = r.m * g;
          const inside = Math.hypot(px, py) <= el.r; if (!inside) return;
          const mu0 = Math.max(el.mu0, el.mu), mu = el.mu;
          if (rl < 0.02 && Fr <= mu0 * N) { r.vx = vdx; r.vy = vdy; r.fx += Fx; r.fy += Fy; m.stuck = true; }
          else { const dx = rl > 1e-6 ? rx / rl : (Fr ? Fx / Fr : 0), dy = rl > 1e-6 ? ry / rl : (Fr ? Fy / Fr : 0); r.fx += -mu * N * dx; r.fy += -mu * N * dy; m.stuck = false; }
        });
      });
    },
    draw(el, g) { const m = g.rt.map[el.id]; const ang = m ? m.angle : 0; const p = g.pose(el); L(g, { x: el.x, y: el.y, a: ang }, (c) => { c.fillStyle = hexA(el.color, 0.55); c.strokeStyle = lighten(el.color); c.lineWidth = 2 / g.V.s; c.beginPath(); c.arc(0, 0, el.r, 0, 7); c.fill(); c.stroke(); c.lineWidth = 1 / g.V.s; c.strokeStyle = 'rgba(232,240,234,.35)'; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * el.r, Math.sin(a) * el.r); c.stroke(); } c.beginPath(); c.arc(0, 0, el.r * 0.5, 0, 7); c.stroke(); c.fillStyle = INK; c.beginPath(); c.arc(0, 0, el.r * 0.04, 0, 7); c.fill(); }); text(g, (el.label ? el.label + ' ' : '') + 'ω=' + (m ? m.omega : el.omega0).toFixed(2) + ' rad/s', el.x, el.y, { dx: -30, dy: -el.r * g.V.s - 6, size: 10, color: MUTED }); },
    extent: (el) => [-el.r, -el.r, el.r, el.r], resize: (el, lx, ly) => { el.r = Math.max(0.1, +Math.hypot(lx, ly).toFixed(2)); },
    quantity(el, q, s, rt) { const m = rt.map[el.id]; if (q === 'omega') return m ? m.omega : 0; if (q === 'angle') return m ? m.angle / D2R : 0; return null; }
  });
    reg({
    id: 'launcher', zh: '发射器', en: 'Launcher', cat: 'mech', kind: 'body',
    desc: '在 fireT 时刻以速度 speed 沿炮管方向（角度）发射一个小球。', 
    own: [P('len', '炮管长', 'm', 0.1, 20, 0.05, 0.6, { grp: 'geom' }), P('speed', '发射速度', 'm/s', 0, 1000, 0.1, 6, { grp: 'phys' }), P('fireT', '发射时刻', 's', 0, 1000, 0.1, 0, { grp: 'phys' }), P('mass', '弹丸质量', 'kg', 0.001, 100, 0.05, 0.2, { grp: 'phys' }), P('pr', '弹丸半径', 'm', 0.01, 2, 0.01, 0.06, { grp: 'geom' }), P('e', '恢复系数 e', '', 0, 1, 0.05, 0.5, { grp: 'phys' }), P('mu0', '静摩擦因数 μ₀', '', 0, 5, 0.05, 0.5, { grp: 'phys' }), P('mu', '动摩擦因数 μ', '', 0, 5, 0.05, 0.4, { grp: 'phys' }), P('q', '弹丸电荷 q', 'C', -10, 10, 'any', 0, { grp: 'phys' }), B('gravity', '受重力', true, { grp: 'phys' })],
    dflt: { color: '#e06c75', angle: 45 },
    build(el, ctx) {
      const a = el.angle * D2R; const mx = el.x + Math.cos(a) * el.len, my = el.y + Math.sin(a) * el.len;
      const b = ctx.body(el, { x: mx, y: my, a: 0, shapes: [{ kind: 'circle', r: el.pr, k: 0.4 }], mass: el.mass, mu0: el.mu0, mu: el.mu, e: el.e, q: el.q, gscale: 0 });
      const m = ctx.rt.map[el.id]; m.fired = false;
      ctx.hook((w, h) => { if (!m.fired) { if (w.t >= el.fireT - 1e-9) { m.fired = true; b.vx = el.speed * Math.cos(a); b.vy = el.speed * Math.sin(a); b.gscale = el.gravity === false ? 0 : 1; } else { b.vx = b.vy = 0; b.x = mx; b.y = my; } } });
    },
    draw(el, g) { const b = g.body(el); const a = el.angle * D2R; L(g, { x: el.x, y: el.y, a }, (c) => { c.fillStyle = hexA(el.color, 0.9); c.strokeStyle = lighten(el.color); c.beginPath(); c.rect(0, -0.06, el.len, 0.12); c.fill(); c.stroke(); }); L(g, { x: el.x, y: el.y, a: 0 }, (c) => { c.fillStyle = '#39454a'; c.strokeStyle = MUTED; c.beginPath(); c.arc(0, 0, 0.12, 0, 7); c.fill(); c.stroke(); }); if (b) { L(g, { x: b.x, y: b.y, a: b.a }, (c) => { c.fillStyle = '#f0c36a'; c.beginPath(); c.arc(0, 0, el.pr, 0, 7); c.fill(); }); } if (el.label) text(g, el.label, el.x, el.y, { dx: 8, dy: 14 }); },
    extent: (el) => { const a = el.angle * D2R; const ex = Math.cos(a) * el.len, ey = Math.sin(a) * el.len; return [Math.min(0, ex) - 0.15, Math.min(0, ey) - 0.15, Math.max(0, ex) + 0.15, Math.max(0, ey) + 0.15].map((v, i) => v); },
    resize: null
  });

  // ---------------- fields / regions ----------------
  const REGP = [S('shape', '形状', [{ v: 'rect', zh: '矩形' }, { v: 'circle', zh: '圆形' }], 'rect', { grp: 'geom' }), P('w', '宽 w', 'm', 0.1, 1000, 0.1, 4, { grp: 'geom' }), P('h', '高 h', 'm', 0.1, 1000, 0.1, 3, { grp: 'geom' }), P('r', '半径 r（圆形）', 'm', 0.05, 500, 0.1, 1.5, { grp: 'geom' })];
  function regionInside(el) { const a = -(el.angle || 0) * D2R, c = Math.cos(a), s = Math.sin(a); return (x, y) => { const dx = x - el.x, dy = y - el.y; const lx = dx * c - dy * s, ly = dx * s + dy * c; return el.shape === 'circle' ? lx * lx + ly * ly <= el.r * el.r : (Math.abs(lx) <= el.w / 2 && Math.abs(ly) <= el.h / 2); }; }
  PE.regionInside = regionInside;
  function regionPath(c, el) { if (el.shape === 'circle') { c.beginPath(); c.arc(0, 0, el.r, 0, 7); } else { c.beginPath(); c.rect(-el.w / 2, -el.h / 2, el.w, el.h); } }
  const regExt = (el) => (el.shape === 'circle' ? [-el.r, -el.r, el.r, el.r] : [-el.w / 2, -el.h / 2, el.w / 2, el.h / 2]);
  const regRes = (el, lx, ly) => { if (el.shape === 'circle') el.r = Math.max(0.05, +Math.hypot(lx, ly).toFixed(2)); else { el.w = Math.max(0.1, +(2 * Math.abs(lx)).toFixed(2)); el.h = Math.max(0.1, +(2 * Math.abs(ly)).toFixed(2)); } };
  function drawRegion(el, g, fill, stroke, deco) { L(g, { x: el.x, y: el.y, a: (el.angle || 0) * D2R }, (c) => { regionPath(c, el); c.fillStyle = fill; c.fill(); c.save(); c.setLineDash([6 / g.V.s, 4 / g.V.s]); c.strokeStyle = stroke; c.stroke(); c.restore(); if (deco) { c.save(); regionPath(c, el); c.clip(); deco(c); c.restore(); } }); if (el.label) { text(g, el.label, el.x, el.y, { dx: -10, dy: 4, color: stroke }); } }
  reg({
    id: 'fieldE', zh: '匀强电场区', en: 'Uniform E field', cat: 'field', kind: 'region', live: ['E', 'dir', 'alt', 'period', 'shape', 'w', 'h', 'r', 'label', 'color', 'x', 'y', 'angle'],
    desc: '区域内带电体受力 F=qE。dir 是电场方向（世界坐标，90°=向上）；alt 开启则电场方向按 period 周期反向（回旋加速器）。',
    own: REGP.concat([P('E', '场强 E', 'V/m', 0, 1e6, 0.5, 20, { grp: 'phys', live: true }), P('dir', '方向（世界角）', '°', -360, 360, 5, 90, { grp: 'phys', live: true }), B('alt', '交变（方向周期反转）', false, { grp: 'phys' }), P('period', '交变周期 T', 's', 0.001, 1000, 0.01, 1, { grp: 'phys' })]),
    dflt: { color: '#4aa3ff' }, extent: regExt, resize: regRes,
    build(el, ctx) { const inside = () => regionInside(el); ctx.rt.regions.push(el); ctx.hook((w) => { const ins = inside(); const sg = el.alt ? (Math.sin(2 * Math.PI * w.t / el.period) >= 0 ? 1 : -1) : 1; const ex = el.E * Math.cos(el.dir * D2R) * sg, ey = el.E * Math.sin(el.dir * D2R) * sg; w.bodies.forEach(b => { if (b.fixed || !b.q) return; if (ins(b.x, b.y)) { b.fx += b.q * ex; b.fy += b.q * ey; } }); }); },
    draw(el, g) { const a = el.dir * D2R; drawRegion(el, g, hexA(el.color, 0.1), el.color, (c) => { c.strokeStyle = hexA(el.color, 0.7); c.fillStyle = hexA(el.color, 0.7); c.lineWidth = 1.2 / g.V.s; const ext = regExt(el); const sp = Math.max(0.5, 40 / g.V.s); const rr = rotv(1, 0, a); const sg = el.alt && g.rt ? (Math.sin(2 * Math.PI * g.t / el.period) >= 0 ? 1 : -1) : 1; const ax = -(el.angle || 0) * D2R; const dd = rotv(Math.cos(a) * sg, Math.sin(a) * sg, ax); for (let x = ext[0] + sp / 2; x < ext[2]; x += sp) for (let y = ext[1] + sp / 2; y < ext[3]; y += sp) { const L2 = sp * 0.32; c.beginPath(); c.moveTo(x - dd.x * L2, y - dd.y * L2); c.lineTo(x + dd.x * L2, y + dd.y * L2); c.stroke(); c.beginPath(); c.moveTo(x + dd.x * L2, y + dd.y * L2); c.lineTo(x + dd.x * L2 - (dd.x * 0.5 - dd.y * 0.3) * L2, y + dd.y * L2 - (dd.y * 0.5 + dd.x * 0.3) * L2); c.lineTo(x + dd.x * L2 - (dd.x * 0.5 + dd.y * 0.3) * L2, y + dd.y * L2 - (dd.y * 0.5 - dd.x * 0.3) * L2); c.closePath(); c.fill(); } }); text(g, 'E=' + el.E + ' V/m', el.x, el.y, { dx: -24, dy: 0, size: 10, color: el.color }); }
  });
  reg({
    id: 'fieldB', zh: '匀强磁场区', en: 'Uniform B field', cat: 'field', kind: 'region', live: ['B', 'into', 'shape', 'w', 'h', 'r', 'label', 'color', 'x', 'y', 'angle'],
    desc: '区域内带电体受洛伦兹力 F=qv×B（垂直于纸面，into=向里 ⊗，否则向外 ⊙）。', own: REGP.concat([P('B', '磁感应强度 B', 'T', 0, 1000, 0.05, 1, { grp: 'phys', live: true }), B('into', '垂直纸面向里 ⊗', true, { grp: 'phys', live: true })]),
    dflt: { color: '#b07cff' }, extent: regExt, resize: regRes,
    build(el, ctx) { ctx.rt.regions.push(el); const ins = (x, y) => regionInside(el)(x, y); ctx.hook((w, h) => { const Bz = (el.into ? -1 : 1) * el.B; w.bodies.forEach(b => { if (b.fixed || !b.q || !Bz || !ins(b.x, b.y)) return; const wc = b.q * Bz / b.m; const ph = -wc * h; const c = Math.cos(ph), s = Math.sin(ph); const vx = b.vx * c - b.vy * s, vy = b.vx * s + b.vy * c; b.vx = vx; b.vy = vy; }); }); },
    draw(el, g) { drawRegion(el, g, hexA(el.color, 0.1), el.color, (c) => { c.strokeStyle = hexA(el.color, 0.75); c.fillStyle = hexA(el.color, 0.75); c.lineWidth = 1.2 / g.V.s; const ext = regExt(el); const sp = Math.max(0.5, 38 / g.V.s); for (let x = ext[0] + sp / 2; x < ext[2]; x += sp) for (let y = ext[1] + sp / 2; y < ext[3]; y += sp) { const s = sp * 0.14; if (el.into) { c.beginPath(); c.moveTo(x - s, y - s); c.lineTo(x + s, y + s); c.moveTo(x - s, y + s); c.lineTo(x + s, y - s); c.stroke(); } else { c.beginPath(); c.arc(x, y, s * 0.35, 0, 7); c.fill(); c.beginPath(); c.arc(x, y, s, 0, 7); c.stroke(); } } }); text(g, 'B=' + el.B + ' T ' + (el.into ? '⊗' : '⊙'), el.x, el.y, { dx: -26, dy: 0, size: 10, color: el.color }); }
  });
  reg({
    id: 'fieldG', zh: '重力场区', en: 'Gravity region', cat: 'field', kind: 'region', live: ['g', 'dir', 'shape', 'w', 'h', 'r', 'label', 'color', 'x', 'y', 'angle'],
    desc: '区域内重力加速度改为 g、方向 dir（世界角，−90°=向下）。', own: REGP.concat([P('g', '重力加速度 g', 'm/s²', 0, 1000, 0.1, 1.6, { grp: 'phys', live: true }), P('dir', '方向（世界角）', '°', -360, 360, 5, -90, { grp: 'phys', live: true })]),
    dflt: { color: '#f2a65a' }, extent: regExt, resize: regRes,
    build(el, ctx) { ctx.rt.regions.push(el); const ins = (x, y) => regionInside(el)(x, y); const g0 = ctx.gAcc; ctx.hook((w) => { w.bodies.forEach(b => { if (b.fixed || !b.gscale || !ins(b.x, b.y)) return; b.fx += b.m * (el.g * Math.cos(el.dir * D2R)); b.fy += b.m * (el.g * Math.sin(el.dir * D2R) + g0); }); }); },
    draw(el, g) { drawRegion(el, g, hexA(el.color, 0.09), el.color, (c) => { c.strokeStyle = c.fillStyle = hexA(el.color, 0.6); const ext = regExt(el); const sp = Math.max(0.6, 50 / g.V.s); const ax = -(el.angle || 0) * D2R; const d = rotv(Math.cos(el.dir * D2R), Math.sin(el.dir * D2R), ax); c.lineWidth = 1.2 / g.V.s; for (let x = ext[0] + sp / 2; x < ext[2]; x += sp) for (let y = ext[1] + sp / 2; y < ext[3]; y += sp) { c.beginPath(); c.moveTo(x - d.x * sp * 0.25, y - d.y * sp * 0.25); c.lineTo(x + d.x * sp * 0.25, y + d.y * sp * 0.25); c.stroke(); } }); text(g, 'g=' + el.g + ' m/s²', el.x, el.y, { dx: -24, dy: 0, size: 10, color: el.color }); }
  });
  reg({
    id: 'boundary', zh: '场边界/参考线', en: 'Boundary', cat: 'field', kind: 'region',
    desc: '画出场区边界或参考线（虚线）。absorb 开启时，进入该区域的物体会被吸收（冻结）。', own: REGP.concat([B('absorb', '吸收进入的物体', false, { grp: 'phys' })]), dflt: { color: '#8aa096', w: 6, h: 0.02, shape: 'rect' }, extent: regExt, resize: regRes,
    build(el, ctx) { if (el.absorb) { const ins = (x, y) => regionInside(el)(x, y); ctx.hook((w) => { w.bodies.forEach(b => { if (!b.fixed && ins(b.x, b.y)) { b.vx = b.vy = b.w = 0; b.gscale = 0; } }); }); } },
    draw(el, g) { drawRegion(el, g, 'rgba(0,0,0,0)', el.color, null); }
  });
  // templates -----------------------------------------------------
  reg({
    id: 'massSpectrometer', zh: '质谱仪（模板）', en: 'Mass spectrometer (template)', cat: 'field', kind: 'template',
    desc: '一次放入：加速电容器（含缝）+ 匀强磁场 + 两个不同质量的离子。离子在磁场中沿半圆运动，落点间距 = 2(r₂−r₁)，r=√(2mU/q)/B。',
    own: [P('U', '加速电压 U', 'V', 0.1, 1e5, 1, 10, { grp: 'phys' }), P('Bf', '磁感应强度 B', 'T', 0.05, 100, 0.05, 2, { grp: 'phys' }), P('m1', '离子 1 质量', 'kg', 1e-6, 100, 0.001, 0.002, { grp: 'phys' }), P('m2', '离子 2 质量', 'kg', 1e-6, 100, 0.001, 0.003, { grp: 'phys' }), P('q', '离子电荷 q', 'C', 1e-6, 10, 'any', 0.01, { grp: 'phys' })],
    dflt: {}, expand(el) {
      const x = el.x, y = el.y, d = 0.4;
      return [
        { type: 'capacitor', x: x + 2.5, y: y + d / 2 + 0.04, len: 6, d, U: el.U, top: '+', slit: 0.24, slitX: -2.5, detect: true, label: '加速板' },
        { type: 'fieldB', x: x + 2.5, y: y - 1.9, w: 6, h: 3.8, B: el.Bf, into: true, label: 'B ⊗' },
        { type: 'particle', x, y: y + 0.04 + d - 0.025, r: 0.02, mass: el.m1, q: el.q, color: '#ff6b6b', label: 'm₁' },
        { type: 'particle', x, y: y + 0.04 + d - 0.025, r: 0.02, mass: el.m2, q: el.q, color: '#4aa3ff', label: 'm₂' }
      ];
    }
  });
  reg({
    id: 'cyclotron', zh: '回旋加速器（模板）', en: 'Cyclotron (template)', cat: 'field', kind: 'template',
    desc: '圆形匀强磁场 + 中间缝隙里的交变电场（周期 T=2πm/(qB)）+ 中心的粒子；粒子半径随速度增大。（近似：缝隙处也有磁场）',
    own: [P('Bf', '磁感应强度 B', 'T', 0.05, 100, 0.05, 1, { grp: 'phys' }), P('E', '缝隙电场 E', 'V/m', 0.1, 1e4, 0.5, 5, { grp: 'phys' }), P('m', '粒子质量', 'kg', 1e-6, 100, 0.001, 0.01, { grp: 'phys' }), P('q', '粒子电荷 q', 'C', 1e-6, 10, 'any', 0.1, { grp: 'phys' }), P('Rd', 'D 形盒半径', 'm', 0.5, 50, 0.1, 3, { grp: 'geom' })],
    dflt: {}, expand(el) {
      const T = 2 * Math.PI * el.m / (el.q * el.Bf);
      return [
        { type: 'fieldB', shape: 'circle', x: el.x, y: el.y, r: el.Rd, B: el.Bf, into: true, label: 'B ⊗' },
        { type: 'fieldE', x: el.x, y: el.y, w: 0.4, h: 2 * el.Rd, B: undefined, E: el.E, dir: 0, alt: true, period: +T.toFixed(5), label: '交变 E' },
        { type: 'particle', x: el.x, y: el.y, mass: el.m, q: el.q, color: '#ffb84d', label: '粒子' }
      ].map(o => { delete o.B; if (o.type === 'fieldB') o.B = el.Bf; return o; });
    }
  });

  // ---------------- electrical / optical ----------------
  reg({
    id: 'capacitor', zh: '平行板电容器', en: 'Capacitor plates', cat: 'optic', kind: 'static',
    desc: '两块平行板，板间匀强电场 E=U/d（从正板指向负板）。底板可开缝（slit）并作为落点探测板（detect）。带电粒子穿过板间会偏转/加速。',
    own: [P('len', '板长', 'm', 0.1, 100, 0.1, 2, { grp: 'geom' }), P('d', '板间距 d', 'm', 0.02, 50, 0.02, 0.5, { grp: 'geom' }), P('thick', '板厚', 'm', 0.01, 0.5, 0.01, 0.04, { grp: 'geom' }), P('U', '电压 U', 'V', 0, 1e6, 1, 100, { grp: 'phys', live: true }), S('top', '上板电性', [{ v: '+', zh: '上板为正' }, { v: '-', zh: '上板为负' }], '+', { grp: 'phys', live: true }), P('slit', '底板缝宽（0=无）', 'm', 0, 50, 0.02, 0, { grp: 'geom' }), P('slitX', '缝的位置（相对中心）', 'm', -50, 50, 0.05, 0, { grp: 'geom' }), B('detect', '底板记录落点', false, { grp: 'phys' }), P('e', '恢复系数 e', '', 0, 1, 0.05, 0.1, { grp: 'phys' })],
    dflt: { color: '#d4a84a' }, live: ['U', 'top', 'label', 'color'],
    build(el, ctx) {
      const t = el.thick, d = el.d; const top = ctx.body(el, surfSpec(el, [{ kind: 'poly', verts: box(el.len, t, 0, d / 2 + t / 2) }], { mu0: 0.2, mu: 0.2, e: el.e, sensor: false }));
      const pieces = []; if (el.slit > 0) { const a = el.slitX - el.slit / 2, b = el.slitX + el.slit / 2; if (a > -el.len / 2) pieces.push({ kind: 'poly', verts: box(a + el.len / 2, t, (a - el.len / 2) / 2, -d / 2 - t / 2) }); if (b < el.len / 2) pieces.push({ kind: 'poly', verts: box(el.len / 2 - b, t, (b + el.len / 2) / 2, -d / 2 - t / 2) }); } else pieces.push({ kind: 'poly', verts: box(el.len, t, 0, -d / 2 - t / 2) });
      if (pieces.length) ctx.body(el, surfSpec(el, pieces, { mu0: 0.2, mu: 0.2, e: el.e, tag: el.detect ? 'screen' : 'plate' }));
      const a = (el.angle || 0) * D2R, ca = Math.cos(a), sa = Math.sin(a);
      ctx.rt.regions.push(el);
      ctx.hook((w) => { const E = el.U / el.d * (el.top === '+' ? -1 : 1); const ex = -sa * E, ey = ca * E; w.bodies.forEach(b => { if (b.fixed || !b.q) return; const dx = b.x - el.x, dy = b.y - el.y; const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca; if (Math.abs(lx) <= el.len / 2 && Math.abs(ly) <= el.d / 2) { b.fx += b.q * ex; b.fy += b.q * ey; } }); });
    },
    draw(el, g) {
      const p = { x: el.x, y: el.y, a: (el.angle || 0) * D2R }; const m = g.rt.map[el.id]; const t = el.thick, d = el.d;
      L(g, p, (c) => {
        const col = el.color; c.fillStyle = hexA(col, 0.9); c.fillRect(-el.len / 2, d / 2, el.len, t); c.strokeStyle = lighten(col);
        if (el.slit > 0) { const a = el.slitX - el.slit / 2, b = el.slitX + el.slit / 2; c.fillRect(-el.len / 2, -d / 2 - t, a + el.len / 2, t); c.fillRect(b, -d / 2 - t, el.len / 2 - b, t); } else c.fillRect(-el.len / 2, -d / 2 - t, el.len, t);
        c.strokeStyle = hexA(col, 0.6); c.lineWidth = 1.2 / g.V.s; const dir = el.top === '+' ? -1 : 1; const sp = Math.max(0.35, 36 / g.V.s); for (let x = -el.len / 2 + sp / 2; x < el.len / 2; x += sp) { c.beginPath(); c.moveTo(x, -dir * d * 0.3); c.lineTo(x, dir * d * 0.3); c.stroke(); const y = dir * d * 0.3; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 0.04, y - dir * 0.07); c.moveTo(x, y); c.lineTo(x + 0.04, y - dir * 0.07); c.stroke(); }
      });
      const tp = rotv(-el.len / 2 - 0.12, d / 2 + t / 2, p.a), bp = rotv(-el.len / 2 - 0.12, -d / 2 - t / 2, p.a);
      text(g, el.top === '+' ? '+' : '−', el.x + tp.x, el.y + tp.y, { dx: -4, dy: 4, size: 13 }); text(g, el.top === '+' ? '−' : '+', el.x + bp.x, el.y + bp.y, { dx: -4, dy: 4, size: 13 });
      text(g, 'U=' + el.U + ' V  E=' + +(el.U / el.d).toFixed(2) + ' V/m', el.x, el.y, { dx: -40, dy: -d * g.V.s / 2 - t * g.V.s - 8, size: 10, color: el.color });
      if (el.detect && g.rt.hits) { const hs = [].concat(...(m ? [g.rt.hits[el.id] || []] : [])); hs.forEach(h => { g.c.save(); g.c.fillStyle = '#ff6b6b'; g.c.beginPath(); g.c.arc(g.V.x(h.x), g.V.y(h.y), 3, 0, 7); g.c.fill(); g.c.restore(); }); }
    },
    extent: (el) => [-el.len / 2, -el.d / 2 - el.thick, el.len / 2, el.d / 2 + el.thick], resize: (el, lx, ly) => { el.len = Math.max(0.1, +(2 * Math.abs(lx)).toFixed(2)); el.d = Math.max(0.02, +(2 * Math.abs(ly) - el.thick).toFixed(2)); },
    readout(el, s, rt) { const h = rt.hits[el.id]; if (!el.detect) return { 'E (V/m)': el.U / el.d }; const o = { 'E (V/m)': el.U / el.d }; (h || []).forEach(q => { o['hit ' + q.id + ' x (m)'] = q.x; }); return o; }
  });
  // rails + sliding rod: own 1-D dynamics along the rails (exact EMF / current / Ampère force / friction)
  reg({
    id: 'rails', zh: '导轨+导体棒（电磁感应）', en: 'Rails with sliding rod', cat: 'optic', kind: 'sensor',
    desc: '俯视图：两根平行导轨（间距 gap）左端接电阻 R，导体棒（质量 M、电阻 Rr）在匀强磁场 B 中沿导轨滑动。ε=B·gap·v，I=(E−ε)/(R+Rr)，安培力 F=B·I·gap；可加外力 F、倾角 incline（沿轨道方向的重力分量 M·g·sinθ，摩擦 μ·M·g·cosθ）。',
    own: [P('len', '导轨长', 'm', 0.5, 200, 0.1, 5, { grp: 'geom' }), P('gap', '导轨间距 L', 'm', 0.05, 20, 0.05, 0.6, { grp: 'geom' }), P('B', '磁感应强度 B', 'T', 0, 1000, 0.05, 1, { grp: 'phys', live: true }), B('into', '磁场垂直纸面向里 ⊗', true, { grp: 'phys', live: true }), P('R', '定值电阻 R', 'Ω', 0.001, 1e6, 0.1, 1, { grp: 'phys', live: true }), P('Rr', '棒电阻 r', 'Ω', 0, 1e6, 0.05, 0.2, { grp: 'phys', live: true }), P('E', '电源电动势（0=无）', 'V', -1e5, 1e5, 0.5, 0, { grp: 'phys', live: true }), P('M', '棒质量 M', 'kg', 0.001, 1000, 0.05, 0.2, { grp: 'phys' }), P('F', '外力 F（沿 +轨道方向）', 'N', -1e4, 1e4, 0.1, 0, { grp: 'phys', live: true }), P('incline', '倾角 θ（+方向为下坡）', '°', -89, 89, 1, 0, { grp: 'phys', live: true }), P('mu0', '静摩擦因数 μ₀', '', 0, 5, 0.05, 0, { grp: 'phys', live: true }), P('mu', '动摩擦因数 μ', '', 0, 5, 0.05, 0, { grp: 'phys', live: true }), P('s0', '棒初位置 s₀（距左端）', 'm', 0, 200, 0.1, 0.5, { grp: 'init' }), P('v0', '棒初速度 v₀', 'm/s', -1000, 1000, 0.1, 0, { grp: 'init' })],
    dflt: { color: '#d9a441' }, live: ['B', 'into', 'R', 'Rr', 'E', 'F', 'incline', 'mu0', 'mu', 'label', 'color'],
    check(el, s, err, warn) { if (el.s0 > el.len) err.push(el.id + ': s₀ 不能超过导轨长'); },
    build(el, ctx) {
      const m = ctx.rt.map[el.id] = ctx.rt.map[el.id] || { bodies: [], joints: [] }; const st = { s: el.s0, v: el.v0, emf: 0, I: 0, FB: 0, a: 0, Q: 0 }; ctx.rt.rails[el.id] = st; m.rail = st;
      const g = ctx.gAcc;
      ctx.hook((w, h) => {
        const th = el.incline * D2R; const N = el.M * g * Math.cos(th); const Fg = el.M * g * Math.sin(th); const BL = el.B * el.gap; const Rt = el.R + el.Rr; const k = BL * BL / Rt;
        const F0 = el.F + Fg + (el.E ? BL * el.E / Rt : 0);
        let v = st.v; const vOld = v;
        v = (v + h * F0 / el.M) / (1 + h * k / el.M);
        const fk = el.mu * N, f0 = Math.max(el.mu0, el.mu) * N;
        if (Math.abs(vOld) < 1e-9 && Math.abs(F0 - k * 0) <= f0 && Math.abs(F0) <= f0) v = 0;
        else if (fk > 0) { const dv = fk * h / el.M; if (Math.abs(v) <= dv && Math.abs(vOld) < dv + 1e-9 && Math.abs(F0 - k * v) <= f0) v = 0; else v -= Math.sign(v || F0) * dv; }
        st.s += v * h; if (st.s < 0) { st.s = 0; if (v < 0) v = 0; } if (st.s > el.len) { st.s = el.len; if (v > 0) v = 0; }
        st.a = (v - vOld) / h; st.v = v;
        st.emf = BL * v; st.I = ((el.E || 0) - BL * v) / Rt; st.FB = BL * st.I; st.P = st.I * st.I * Rt; st.Q += st.P * h;
      });
    },
    draw(el, g) {
      const p = { x: el.x, y: el.y, a: (el.angle || 0) * D2R }; const st = g.rt.rail(el.id);
      L(g, p, (c) => {
        const hw = el.gap / 2; c.strokeStyle = '#b8c2c8'; c.lineWidth = 3 / g.V.s; c.beginPath(); c.moveTo(-el.len / 2, hw); c.lineTo(el.len / 2, hw); c.moveTo(-el.len / 2, -hw); c.lineTo(el.len / 2, -hw); c.stroke();
        c.lineWidth = 1.5 / g.V.s; c.strokeStyle = '#8aa096'; const x0 = -el.len / 2; c.beginPath(); c.moveTo(x0, hw); c.lineTo(x0 - 0.2, hw); c.lineTo(x0 - 0.2, hw * 0.45); c.moveTo(x0 - 0.2, -hw * 0.45); c.lineTo(x0 - 0.2, -hw); c.lineTo(x0, -hw); c.stroke();
        c.save(); c.translate(x0 - 0.2, 0); c.beginPath(); const rh = hw * 0.9; c.rect(-0.06, -rh * 0.5, 0.12, rh); c.stroke(); c.restore();
        c.fillStyle = 'rgba(176,124,255,.07)'; c.fillRect(-el.len / 2, -hw - 0.12, el.len, el.gap + 0.24); c.strokeStyle = 'rgba(176,124,255,.6)'; c.lineWidth = 1.2 / g.V.s;
        const sp = Math.max(0.4, 38 / g.V.s); for (let x = -el.len / 2 + sp / 2; x < el.len / 2; x += sp) for (let y = -hw + sp * 0.3; y < hw; y += sp) { const s = sp * 0.1; if (el.into) { c.beginPath(); c.moveTo(x - s, y - s); c.lineTo(x + s, y + s); c.moveTo(x - s, y + s); c.lineTo(x + s, y - s); c.stroke(); } else { c.beginPath(); c.arc(x, y, s, 0, 7); c.stroke(); } }
        const rx = -el.len / 2 + (st ? st.s : el.s0); c.strokeStyle = el.color; c.lineWidth = 5 / g.V.s; c.beginPath(); c.moveTo(rx, -hw - 0.1); c.lineTo(rx, hw + 0.1); c.stroke();
      });
      const q = rotv(-el.len / 2 - 0.4, el.gap / 2 + 0.2, p.a); text(g, 'R', el.x + q.x, el.y + q.y, { size: 11, color: MUTED });
      const lab = st ? 'v=' + st.v.toFixed(2) + ' m/s  ε=' + st.emf.toFixed(2) + ' V  I=' + st.I.toFixed(2) + ' A' : ''; text(g, (el.label ? el.label + '  ' : '') + lab, el.x, el.y, { dx: -el.len * g.V.s / 2, dy: el.gap * g.V.s / 2 + 24, size: 10, color: el.color });
    },
    extent: (el) => [-el.len / 2 - 0.3, -el.gap / 2 - 0.15, el.len / 2, el.gap / 2 + 0.15], resize: (el, lx, ly) => { el.len = Math.max(0.5, +(2 * Math.abs(lx)).toFixed(2)); el.gap = Math.max(0.05, +(2 * Math.abs(ly) - 0.3).toFixed(2)); },
    quantity(el, q, s, rt) { const st = rt.rails[el.id]; if (!st) return null; const a = (el.angle || 0) * D2R; switch (q) { case 'speed': return Math.abs(st.v); case 'vx': return st.v * Math.cos(a); case 'vy': return st.v * Math.sin(a); case 's': return st.s; case 'emf': return st.emf; case 'I': return st.I; case 'a': return Math.abs(st.a); case 'T': return st.FB; case 'x': return el.x + (st.s - el.len / 2) * Math.cos(a); case 'y': return el.y + (st.s - el.len / 2) * Math.sin(a); case 'ke': return 0.5 * el.M * st.v * st.v; } return null; },
    readout(el, s, rt) { const st = rt.rails[el.id]; return st ? { 'rod v (m/s)': st.v, 'rod s (m)': st.s, 'EMF ε (V)': st.emf, 'current I (A)': st.I, 'Ampère force (N)': st.FB, 'heat Q (J)': st.Q } : null; }
  });
  function rectOverlap(x0, y0, x1, y1, r) { return Math.max(0, Math.min(x1, r[2]) - Math.max(x0, r[0])) * Math.max(0, Math.min(y1, r[3]) - Math.max(y0, r[1])); }
  function coilFlux(el, x, y, fields) {
    let phi = 0; const x0 = x - el.w / 2, x1 = x + el.w / 2, y0 = y - el.h / 2, y1 = y + el.h / 2;
    fields.forEach(f => {
      const Bz = (f.into ? -1 : 1) * f.B; if (!Bz) return; let A;
      if (f.shape !== 'circle' && !(f.angle % 90 !== 0 && f.angle)) { const rot = ((f.angle || 0) % 180 + 180) % 180; const hw = rot === 90 ? f.h / 2 : f.w / 2, hh = rot === 90 ? f.w / 2 : f.h / 2; A = rectOverlap(x0, y0, x1, y1, [f.x - hw, f.y - hh, f.x + hw, f.y + hh]); }
      else { const ins = regionInside(f); const n = 48; let c = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (ins(x0 + (i + 0.5) / n * el.w, y0 + (j + 0.5) / n * el.h)) c++; } A = c / (n * n) * el.w * el.h; }
      phi += Bz * A;
    });
    return el.N * phi;
  }
  reg({
    id: 'coil', zh: '线框/线圈（电磁感应）', en: 'Coil / loop', cat: 'optic', kind: 'body',
    desc: '矩形闭合线框（N 匝、总电阻 Rc）：穿过磁场区时磁通 Φ=N·B·S 变化产生 ε=−dΦ/dt、I=ε/Rc，受安培阻力（能量守恒）。线框是运动的刚体，不与其他物体碰撞。',
    own: [P('w', '宽 w', 'm', 0.05, 50, 0.05, 0.6, { grp: 'geom' }), P('h', '高 h', 'm', 0.05, 50, 0.05, 0.5, { grp: 'geom' }), P('N', '匝数 N', '', 1, 10000, 1, 1, { grp: 'phys' }), P('Rc', '总电阻 Rc', 'Ω', 0.001, 1e6, 0.1, 0.5, { grp: 'phys' }), P('mass', '质量 m', 'kg', 0.001, 1000, 0.05, 0.3, { grp: 'phys' }), B('gravity', '受重力', true, { grp: 'phys' }), P('vx', '初速度 vₓ', 'm/s', -1000, 1000, 0.1, 2, { grp: 'init' }), P('vy', '初速度 v_y', 'm/s', -1000, 1000, 0.1, 0, { grp: 'init' })],
    dflt: { color: '#e5c07b' },
    build(el, ctx) {
      const b = ctx.body(el, { x: el.x, y: el.y, a: 0, vx: el.vx, vy: el.vy, mass: el.mass, shapes: [{ kind: 'poly', verts: box(el.w, el.h) }], sensor: true, noRotate: true, gscale: el.gravity === false ? 0 : 1 });
      const m = ctx.rt.map[el.id]; const st = m.coil = { phi: 0, emf: 0, I: 0, Q: 0 }; ctx.rt.coils[el.id] = st; const fields = ctx.s.elements.filter(e => e.type === 'fieldB');
      ctx.hook((w, h) => {
        const x = b.x, y = b.y, d = 1e-3; const px = (coilFlux(el, x + d, y, fields) - coilFlux(el, x - d, y, fields)) / (2 * d), py = (coilFlux(el, x, y + d, fields) - coilFlux(el, x, y - d, fields)) / (2 * d);
        st.phi = coilFlux(el, x, y, fields); const dot = px * b.vx + py * b.vy; st.emf = -dot; st.I = st.emf / el.Rc; st.Q += st.I * st.I * el.Rc * h;
        let Fx = -dot * px / el.Rc, Fy = -dot * py / el.Rc;
        // never let the braking force reverse the motion within one sub-step
        const dvx = Fx * h / b.m, dvy = Fy * h / b.m; const sp = Math.hypot(b.vx, b.vy); const dv = Math.hypot(dvx, dvy); if (dv > sp && dv > 0) { const k = sp / dv; Fx *= k; Fy *= k; }
        b.fx += Fx; b.fy += Fy;
      });
    },
    draw(el, g) { const b = g.body(el); if (!b) return; const st = g.rt.coils[el.id]; L(g, { x: b.x, y: b.y, a: 0 }, (c) => { c.strokeStyle = el.color; c.lineWidth = 3 / g.V.s; c.strokeRect(-el.w / 2, -el.h / 2, el.w, el.h); if (el.N > 1) { c.lineWidth = 1 / g.V.s; c.strokeRect(-el.w / 2 + 0.04, -el.h / 2 + 0.04, el.w - 0.08, el.h - 0.08); } }); if (st) text(g, (el.label ? el.label + ' ' : '') + 'ε=' + st.emf.toFixed(2) + ' V  I=' + st.I.toFixed(2) + ' A', b.x, b.y, { dx: -el.w * g.V.s / 2, dy: -el.h * g.V.s / 2 - 8, size: 10, color: el.color }); },
    extent: (el) => [-el.w / 2, -el.h / 2, el.w / 2, el.h / 2], resize: (el, lx, ly) => { el.w = Math.max(0.05, +(2 * Math.abs(lx)).toFixed(2)); el.h = Math.max(0.05, +(2 * Math.abs(ly)).toFixed(2)); },
    quantity(el, q, s, rt) { const st = rt.coils[el.id]; if (!st) return null; if (q === 'emf') return st.emf; if (q === 'I') return st.I; return null; },
    readout(el, s, rt) { const st = rt.coils[el.id]; return st ? { 'flux Φ (Wb)': st.phi, 'EMF ε (V)': st.emf, 'current I (A)': st.I, 'heat Q (J)': st.Q } : null; }
  });
  // optics ---------------------------------------------------------
  const OPTP = [P('n', '折射率 n', '', 1, 4, 0.01, 1.5, { grp: 'phys' }), P('disp', '色散 Δn（红→紫）', '', 0, 0.3, 0.005, 0.03, { grp: 'phys' })];
  const worldVerts = (el, v) => v.map(p => { const r = rotv(p.x, p.y, (el.angle || 0) * D2R); return { x: el.x + r.x, y: el.y + r.y }; });
  function polyOpt(id, zh, en, desc, own, vertsOf, dflt, resize) {
    reg({
      id, zh, en, desc, cat: 'optic', kind: 'optic', own: OPTP.concat(own), dflt: Object.assign({ color: '#7fd4e6' }, dflt || {}),
      build(el, ctx) { let v = worldVerts(el, vertsOf(el)); if (R.polyArea(v) < 0) v.reverse(); ctx.rt.optics.push({ kind: 'poly', id: el.id, v, n: el.n, disp: el.disp }); },
      draw(el, g) { const p = { x: el.x, y: el.y, a: (el.angle || 0) * D2R }; L(g, p, (c) => { polyPath(c, vertsOf(el)); c.fillStyle = hexA(el.color, 0.16); c.fill(); c.strokeStyle = hexA(el.color, 0.85); c.stroke(); }); text(g, (el.label ? el.label + ' ' : '') + 'n=' + el.n, el.x, el.y, { dx: -10, dy: 3, size: 10, color: el.color }); },
      extent: (el) => { const v = vertsOf(el); return [Math.min(...v.map(q => q.x)), Math.min(...v.map(q => q.y)), Math.max(...v.map(q => q.x)), Math.max(...v.map(q => q.y))]; }, resize
    });
  }
  polyOpt('glass', '玻璃砖', 'Glass block', '矩形玻璃砖（折射率 n 与色散可调）。', [P('w', '宽 w', 'm', 0.05, 100, 0.05, 2, { grp: 'geom' }), P('h', '高 h', 'm', 0.05, 100, 0.05, 1, { grp: 'geom' })], (el) => box(el.w, el.h), null, (el, lx, ly) => { el.w = Math.max(0.05, +(2 * Math.abs(lx)).toFixed(2)); el.h = Math.max(0.05, +(2 * Math.abs(ly)).toFixed(2)); });
  polyOpt('prism', '三棱镜', 'Prism', '等腰三棱镜（顶角 α、腰长 side）；白光会色散。', [P('apex', '顶角 α', '°', 5, 170, 1, 60, { grp: 'geom' }), P('side', '腰长', 'm', 0.1, 50, 0.05, 1.5, { grp: 'geom' })], (el) => { const b2 = el.side * Math.sin(el.apex * D2R / 2), H = el.side * Math.cos(el.apex * D2R / 2); return [{ x: -b2, y: -H / 3 }, { x: b2, y: -H / 3 }, { x: 0, y: 2 * H / 3 }]; }, { n: 1.52, disp: 0.04 }, (el, lx, ly) => { el.side = Math.max(0.1, +Math.hypot(lx, ly).toFixed(2)); });
  polyOpt('semiGlass', '半圆形玻璃', 'Semicircular glass', '半圆柱玻璃（直边在原点，朝 +x 半圆）。', [P('r', '半径 r', 'm', 0.05, 50, 0.05, 1, { grp: 'geom' })], (el) => { const v = []; const n = 48; for (let i = 0; i <= n; i++) { const a = (-90 + 180 * i / n) * D2R; v.push({ x: el.r * Math.cos(a), y: el.r * Math.sin(a) }); } return v; }, null, (el, lx, ly) => { el.r = Math.max(0.05, +Math.hypot(lx, ly).toFixed(2)); });
  reg({
    id: 'lens', zh: '透镜', en: 'Thin lens', cat: 'optic', kind: 'optic', desc: '薄透镜：光轴方向 = 角度；凸透镜会聚、凹透镜发散，焦距 f。', own: [P('f', '焦距 f', 'm', 0.05, 100, 0.05, 1, { grp: 'phys' }), S('kind', '类型', [{ v: 'convex', zh: '凸透镜' }, { v: 'concave', zh: '凹透镜' }], 'convex', { grp: 'phys' }), P('h', '口径 h', 'm', 0.1, 50, 0.1, 1.8, { grp: 'geom' })], dflt: { color: '#8ad6ff' },
    build(el, ctx) { const a = (el.angle || 0) * D2R; const ax = { x: Math.cos(a), y: Math.sin(a) }, pr = { x: -ax.y, y: ax.x }; ctx.rt.optics.push({ kind: 'lens', id: el.id, c: { x: el.x, y: el.y }, axis: ax, a: { x: el.x - pr.x * el.h / 2, y: el.y - pr.y * el.h / 2 }, b: { x: el.x + pr.x * el.h / 2, y: el.y + pr.y * el.h / 2 }, f: (el.kind === 'convex' ? 1 : -1) * el.f }); },
    draw(el, g) { L(g, { x: el.x, y: el.y, a: (el.angle || 0) * D2R }, (c) => { c.strokeStyle = el.color; c.lineWidth = 2 / g.V.s; c.beginPath(); c.moveTo(0, -el.h / 2); c.lineTo(0, el.h / 2); c.stroke(); const s = 0.12, d = el.kind === 'convex' ? 1 : -1; [-1, 1].forEach(sg => { const y = sg * el.h / 2; c.beginPath(); c.moveTo(0, y); c.lineTo(-s, y - sg * s * d * 1.3); c.moveTo(0, y); c.lineTo(s, y - sg * s * d * 1.3); c.stroke(); }); c.setLineDash([3 / g.V.s, 3 / g.V.s]); c.lineWidth = 1 / g.V.s; c.strokeStyle = 'rgba(138,214,255,.4)'; c.beginPath(); c.moveTo(-3 * el.f, 0); c.lineTo(3 * el.f, 0); c.stroke(); c.setLineDash([]); c.fillStyle = 'rgba(138,214,255,.8)'; [-el.f, el.f].forEach(x => { c.beginPath(); c.arc(x, 0, 0.025, 0, 7); c.fill(); }); }); text(g, (el.label ? el.label + ' ' : '') + 'f=' + el.f + ' m', el.x, el.y, { dx: 6, dy: -el.h * g.V.s / 2 - 4, size: 10, color: el.color }); },
    extent: (el) => [-0.15, -el.h / 2, 0.15, el.h / 2], resize: (el, lx, ly) => { el.h = Math.max(0.1, +(2 * Math.abs(ly)).toFixed(2)); }
  });
  reg({
    id: 'mirror', zh: '平面镜', en: 'Plane mirror', cat: 'optic', kind: 'optic', desc: '平面镜（角度 = 镜面方向；镜背有斜线）。', own: [P('len', '镜长', 'm', 0.1, 100, 0.1, 1.5, { grp: 'geom' })], dflt: { color: '#cfd8dc' },
    build(el, ctx) { const a = (el.angle || 0) * D2R; ctx.rt.optics.push({ kind: 'mirror', id: el.id, a: { x: el.x - Math.cos(a) * el.len / 2, y: el.y - Math.sin(a) * el.len / 2 }, b: { x: el.x + Math.cos(a) * el.len / 2, y: el.y + Math.sin(a) * el.len / 2 } }); },
    draw(el, g) { L(g, { x: el.x, y: el.y, a: (el.angle || 0) * D2R }, (c) => { c.strokeStyle = el.color; c.lineWidth = 3 / g.V.s; c.beginPath(); c.moveTo(-el.len / 2, 0); c.lineTo(el.len / 2, 0); c.stroke(); c.lineWidth = 1 / g.V.s; c.strokeStyle = 'rgba(207,216,220,.5)'; c.beginPath(); for (let x = -el.len / 2; x <= el.len / 2; x += 0.1) { c.moveTo(x, 0); c.lineTo(x - 0.06, -0.08); } c.stroke(); }); if (el.label) text(g, el.label, el.x, el.y, { dx: 4, dy: -8 }); },
    extent: (el) => [-el.len / 2, -0.08, el.len / 2, 0.04], resize: (el, lx) => { el.len = Math.max(0.1, +(2 * Math.abs(lx)).toFixed(2)); }
  });
  const SPEC = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#5ac8fa', '#0a84ff', '#bf5af2'];
  reg({
    id: 'lightSource', zh: '光源', en: 'Light source', cat: 'optic', kind: 'optic', desc: '点光源（扇形）或平行光束；白光 = 七色，遇棱镜/玻璃色散。角度 = 出射方向。',
    own: [S('mode', '类型', [{ v: 'beam', zh: '平行光束' }, { v: 'point', zh: '点光源（扇形）' }], 'beam', { grp: 'phys' }), P('count', '光线条数', '', 1, 25, 1, 5, { grp: 'phys' }), P('spread', '束宽 / 扇角（m 或 °）', '', 0, 360, 0.05, 0.6, { grp: 'phys' }), B('white', '白光（七色）', false, { grp: 'phys' })], dflt: { color: '#ffe066' },
    build(el, ctx) { const a = (el.angle || 0) * D2R; const rays = []; const pr = { x: -Math.sin(a), y: Math.cos(a) }; const cols = el.white ? SPEC : [el.color];
      for (let i = 0; i < el.count; i++) { const t = el.count === 1 ? 0 : (i / (el.count - 1) - 0.5); cols.forEach((col, ci) => { if (el.mode === 'beam') rays.push({ x: el.x + pr.x * t * el.spread, y: el.y + pr.y * t * el.spread, a, color: col, ci: el.white ? ci : 3 }); else rays.push({ x: el.x, y: el.y, a: a + t * el.spread * D2R, color: col, ci: el.white ? ci : 3 }); }); }
      ctx.rt.optics.push({ kind: 'source', id: el.id, rays, color: el.color, width: 1.4 }); },
    draw(el, g) { L(g, { x: el.x, y: el.y, a: (el.angle || 0) * D2R }, (c) => { c.fillStyle = el.white ? '#fff' : el.color; c.strokeStyle = '#fff'; c.lineWidth = 1.5 / g.V.s; c.beginPath(); if (el.mode === 'beam') { c.rect(-0.12, -el.spread / 2 - 0.04, 0.12, el.spread + 0.08); c.fill(); } else { c.arc(0, 0, 0.07, 0, 7); c.fill(); c.stroke(); } }); if (el.label) text(g, el.label, el.x, el.y, { dx: -6, dy: -10 }); },
    extent: (el) => (el.mode === 'beam' ? [-0.12, -el.spread / 2 - 0.04, 0.05, el.spread / 2 + 0.04] : [-0.1, -0.1, 0.1, 0.1]), resize: (el, lx, ly) => { if (el.mode === 'beam') el.spread = Math.max(0.05, +(2 * Math.abs(ly) - 0.08).toFixed(2)); }
  });
  reg({
    id: 'screen', zh: '屏/探测板', en: 'Screen', cat: 'optic', kind: 'static', desc: '接收光线（记录光斑位置）并阻挡带电粒子/物体（记录落点）；可开缝。', own: [P('len', '长度', 'm', 0.1, 100, 0.1, 1.5, { grp: 'geom' }), P('thick', '厚度', 'm', 0.01, 1, 0.01, 0.04, { grp: 'geom' }), P('slit', '缝宽（0=无）', 'm', 0, 50, 0.02, 0, { grp: 'geom' }), P('slitX', '缝位置', 'm', -50, 50, 0.05, 0, { grp: 'geom' }), P('e', '恢复系数 e', '', 0, 1, 0.05, 0, { grp: 'phys' })], dflt: { color: '#9fb3a8' },
    build(el, ctx) {
      const a = (el.angle || 0) * D2R, ca = Math.cos(a), sa = Math.sin(a); const pieces = []; const L0 = el.len;
      if (el.slit > 0) { const s0 = el.slitX - el.slit / 2, s1 = el.slitX + el.slit / 2; if (s0 > -L0 / 2) pieces.push([-L0 / 2, s0]); if (s1 < L0 / 2) pieces.push([s1, L0 / 2]); } else pieces.push([-L0 / 2, L0 / 2]);
      ctx.body(el, surfSpec(el, pieces.map(p => ({ kind: 'poly', verts: box(p[1] - p[0], el.thick, (p[0] + p[1]) / 2, 0) })), { mu0: 0.3, mu: 0.3, e: el.e, tag: 'screen' }));
      pieces.forEach((p, i) => ctx.rt.optics.push({ kind: 'screen', id: el.id, a: { x: el.x + ca * p[0], y: el.y + sa * p[0] }, b: { x: el.x + ca * p[1], y: el.y + sa * p[1] }, off: p[0] + L0 / 2 }));
    },
    draw(el, g) { L(g, { x: el.x, y: el.y, a: (el.angle || 0) * D2R }, (c) => { c.fillStyle = hexA(el.color, 0.9); const L0 = el.len; if (el.slit > 0) { const s0 = el.slitX - el.slit / 2, s1 = el.slitX + el.slit / 2; c.fillRect(-L0 / 2, -el.thick / 2, Math.max(0, s0 + L0 / 2), el.thick); c.fillRect(s1, -el.thick / 2, Math.max(0, L0 / 2 - s1), el.thick); } else c.fillRect(-L0 / 2, -el.thick / 2, L0, el.thick); }); const hs = (g.rt.screenHits && g.rt.screenHits[el.id]) || []; hs.forEach(h => { g.c.save(); g.c.fillStyle = '#ffe066'; g.c.beginPath(); g.c.arc(g.V.x(h.x), g.V.y(h.y), 3.5, 0, 7); g.c.fill(); g.c.restore(); }); (g.rt.hits[el.id] || []).forEach(h => { g.c.save(); g.c.fillStyle = '#ff6b6b'; g.c.beginPath(); g.c.arc(g.V.x(h.x), g.V.y(h.y), 3.5, 0, 7); g.c.fill(); g.c.restore(); }); if (el.label) text(g, el.label, el.x, el.y, { dx: 4, dy: -8 }); },
    extent: (el) => [-el.len / 2, -el.thick / 2 - 0.02, el.len / 2, el.thick / 2 + 0.02], resize: (el, lx) => { el.len = Math.max(0.1, +(2 * Math.abs(lx)).toFixed(2)); },
    readout(el, s, rt) { const o = {}; (rt.screenHits[el.id] || []).forEach((h, i) => { o['light spot ' + (i + 1) + ' at (m)'] = +h.x.toFixed(3); }); (rt.hits[el.id] || []).forEach(h => { o['hit ' + h.id + ' x (m)'] = +h.x.toFixed(3); }); return Object.keys(o).length ? o : null; }
  });

  // ---------------- measurement ----------------
  const MEASBODY = { kind: 'meas' };
  reg({
    id: 'ruler', zh: '刻度尺', en: 'Ruler', cat: 'meas', kind: 'meas', desc: '刻度尺（仅显示，不参与碰撞），单位 m，刻度 1 cm / 5 cm / 10 cm。', own: [P('len', '长度', 'm', 0.1, 100, 0.1, 2, { grp: 'geom' })], dflt: { color: '#d8c690' },
    draw(el, g) { L(g, { x: el.x, y: el.y, a: (el.angle || 0) * D2R }, (c) => { c.fillStyle = hexA(el.color, 0.22); c.strokeStyle = el.color; c.lineWidth = 1 / g.V.s; c.fillRect(0, -0.07, el.len, 0.07); c.strokeRect(0, -0.07, el.len, 0.07); c.beginPath(); for (let i = 0; i <= el.len * 100 + 1e-6; i++) { const x = i / 100; const lg = i % 10 === 0 ? 0.05 : (i % 5 === 0 ? 0.035 : 0.02); if (g.V.s / 100 < 2.5 && i % 5) continue; if (g.V.s / 100 < 0.6 && i % 10) continue; c.moveTo(x, 0); c.lineTo(x, -lg); } c.stroke(); }); for (let i = 0; i <= el.len + 1e-6; i += Math.max(0.1, Math.round(el.len / 10 * 10) / 10)) { const q = wpt(el, i, -0.1); text(g, (+i.toFixed(2)) + '', q.x, q.y, { dx: -6, dy: 10, size: 9, color: el.color }); } },
    extent: (el) => [0, -0.08, el.len, 0.01], resize: (el, lx) => { el.len = Math.max(0.1, +Math.abs(lx).toFixed(2)); }
  });
  reg({
    id: 'protractor', zh: '量角器', en: 'Protractor', cat: 'meas', kind: 'meas', desc: '量角器（半圆，0°–180°，仅显示）。', own: [P('r', '半径', 'm', 0.1, 20, 0.05, 0.6, { grp: 'geom' })], dflt: { color: '#9fd0e8' },
    draw(el, g) { L(g, { x: el.x, y: el.y, a: (el.angle || 0) * D2R }, (c) => { c.fillStyle = hexA(el.color, 0.12); c.strokeStyle = el.color; c.lineWidth = 1 / g.V.s; c.beginPath(); c.arc(0, 0, el.r, 0, Math.PI); c.closePath(); c.fill(); c.stroke(); c.beginPath(); for (let a = 0; a <= 180; a += 2) { const lg = a % 10 === 0 ? 0.1 : (a % 5 === 0 ? 0.07 : 0.04) * el.r / 0.6; const ca = Math.cos(a * D2R), sa = Math.sin(a * D2R); c.moveTo(ca * el.r, sa * el.r); c.lineTo(ca * (el.r - lg * el.r / 0.6 * 0.6), sa * (el.r - lg * el.r / 0.6 * 0.6)); } c.stroke(); c.beginPath(); c.arc(0, 0, el.r * 0.04, 0, 7); c.stroke(); }); for (let a = 0; a <= 180; a += 30) { const q = wpt(el, Math.cos(a * D2R) * el.r * 0.76, Math.sin(a * D2R) * el.r * 0.76); text(g, a + '', q.x, q.y, { dx: -7, dy: 4, size: 9, color: el.color }); } },
    extent: (el) => [-el.r, 0, el.r, el.r], resize: (el, lx, ly) => { el.r = Math.max(0.1, +Math.hypot(lx, ly).toFixed(2)); }
  });
  function segHitsBody(a, b, body) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
    return body.ws.some(sh => {
      if (sh.kind === 'circle') { const t = Math.max(0, Math.min(1, ((sh.x - a.x) * dx + (sh.y - a.y) * dy) / L2)); return Math.hypot(sh.x - (a.x + t * dx), sh.y - (a.y + t * dy)) <= sh.r; }
      const v = sh.v; const side = (p) => (p.x - a.x) * dy - (p.y - a.y) * dx; let pos = false, neg = false;
      v.forEach(p => { if (side(p) >= 0) pos = true; if (side(p) <= 0) neg = true; }); if (!(pos && neg)) return false;
      // projections onto the segment must overlap
      let t0 = Infinity, t1 = -Infinity; v.forEach(p => { const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }); return t1 >= 0 && t0 <= 1;
    });
  }
  reg({
    id: 'photogate', zh: '光电门', en: 'Photogate', cat: 'meas', kind: 'sensor', desc: '一条光线段：物体遮光时记录进入时刻 t_in、离开时刻 t_out、遮光时间 Δt 和通过时的速度。', own: [P('len', '光线长度', 'm', 0.05, 50, 0.05, 0.6, { grp: 'geom' }), B('showLine', '显示光线', true, { grp: 'look' })], dflt: { color: '#ff5252', angle: 90 },
    build(el, ctx) {
      const a = (el.angle || 0) * D2R; const A = { x: el.x - Math.cos(a) * el.len / 2, y: el.y - Math.sin(a) * el.len / 2 }, Bp = { x: el.x + Math.cos(a) * el.len / 2, y: el.y + Math.sin(a) * el.len / 2 };
      const st = ctx.rt.gates[el.id] = { inside: {}, events: [] }; ctx.rt.sensors.push((s, rt) => { rt.world.bodies.forEach(b => { if (b.fixed || b.sensorOnly && !b.eid) return; const hit = segHitsBody(A, Bp, b); const key = b.eid; if (hit && !st.inside[key]) { st.inside[key] = true; st.events.push({ id: key, tIn: s.t, tOut: null, v: Math.hypot(b.vx, b.vy) }); } else if (!hit && st.inside[key]) { st.inside[key] = false; for (let i = st.events.length - 1; i >= 0; i--) if (st.events[i].id === key && st.events[i].tOut == null) { st.events[i].tOut = s.t; break; } } }); });
    },
    draw(el, g) { const st = g.rt.gates[el.id]; const on = st && Object.keys(st.inside).some(k => st.inside[k]); const a = (el.angle || 0) * D2R; const A = { x: el.x - Math.cos(a) * el.len / 2, y: el.y - Math.sin(a) * el.len / 2 }, Bp = { x: el.x + Math.cos(a) * el.len / 2, y: el.y + Math.sin(a) * el.len / 2 }; if (el.showLine) line(g, A, Bp, on ? '#ffffff' : el.color, on ? 2.5 : 1.5, [4, 3]); [A, Bp].forEach(p => { g.c.save(); g.c.fillStyle = '#39454a'; g.c.strokeStyle = el.color; g.c.beginPath(); g.c.rect(g.V.x(p.x) - 4, g.V.y(p.y) - 4, 8, 8); g.c.fill(); g.c.stroke(); g.c.restore(); }); const ev = st && st.events[0]; text(g, (el.label ? el.label + ' ' : '') + (ev ? 'Δt=' + (ev.tOut != null ? (ev.tOut - ev.tIn).toFixed(3) + ' s' : '…') + ' v=' + ev.v.toFixed(2) : ''), el.x, el.y, { dx: 8, dy: -el.len * g.V.s / 2 - 6, size: 10, color: el.color }); },
    extent: (el) => { const a = (el.angle || 0) * D2R; const ex = Math.abs(Math.cos(a)) * el.len / 2 + 0.05, ey = Math.abs(Math.sin(a)) * el.len / 2 + 0.05; return [-ex, -ey, ex, ey].map(v => v); }, localExtentWorld: true, resize: (el, lx, ly) => { el.len = Math.max(0.05, +(2 * Math.hypot(lx, ly)).toFixed(2)); },
    readout(el, s, rt) { const st = rt.gates[el.id]; if (!st || !st.events.length) return { 'state': 0 }; const e = st.events[0]; const o = { 't_in (s)': e.tIn, 'speed at gate (m/s)': e.v }; if (e.tOut != null) { o['t_out (s)'] = e.tOut; o['Δt (s)'] = e.tOut - e.tIn; } return o; },
    quantity(el, q, s, rt) { const st = rt.gates[el.id]; const e = st && st.events[0]; if (!e) return 0; if (q === 'time') return e.tIn; if (q === 'speed') return e.v; return null; }
  });
  reg({
    id: 'stopwatch', zh: '秒表/计时器', en: 'Stopwatch', cat: 'meas', kind: 'sensor', desc: '计时：不设光电门时从 t=0 开始一直走；设置起、止光电门则从起门触发计时到止门触发。', own: [REF('startGate', '起始光电门（空=t=0 开始）'), REF('stopGate', '终止光电门（空=不停止）')], dflt: { color: '#e8f0ea' },
    build(el, ctx) { const m = ctx.rt.map[el.id]; m.sw = { t: 0, running: !el.startGate, stopped: false }; ctx.rt.sensors.push((s, rt) => { const sw = m.sw; const gs = el.startGate && rt.gates[el.startGate], ge = el.stopGate && rt.gates[el.stopGate]; const t0 = el.startGate ? (gs && gs.events[0] ? gs.events[0].tIn : null) : 0; const t1 = el.stopGate ? (ge && ge.events[0] ? ge.events[0].tIn : null) : null; if (t0 == null) { sw.t = 0; return; } sw.t = (t1 != null ? t1 : s.t) - t0; sw.stopped = t1 != null; }); },
    draw(el, g) { const sw = g.rt.map[el.id] && g.rt.map[el.id].sw; const c = g.c; const x = g.V.x(el.x), y = g.V.y(el.y); c.save(); c.fillStyle = '#0b1416'; c.strokeStyle = sw && sw.stopped ? '#fbbf24' : el.color; c.lineWidth = 1.5; c.beginPath(); c.roundRect ? c.roundRect(x - 44, y - 16, 88, 32, 7) : c.rect(x - 44, y - 16, 88, 32); c.fill(); c.stroke(); c.fillStyle = INK; c.font = 'bold 15px monospace'; c.textAlign = 'center'; c.fillText((sw ? sw.t : 0).toFixed(3) + ' s', x, y + 5); c.restore(); if (el.label) text(g, el.label, el.x, el.y, { dx: -40, dy: -22, size: 10, color: MUTED }); },
    extent: () => [-0.5, -0.2, 0.5, 0.2],
    quantity(el, q, s, rt) { const m = rt.map[el.id]; return q === 'time' && m && m.sw ? m.sw.t : null; }, readout(el, s, rt) { const m = rt.map[el.id]; return m && m.sw ? { 'time (s)': m.sw.t } : null; }
  });
  reg({
    id: 'springScale', zh: '弹簧秤', en: 'Spring scale', cat: 'meas', kind: 'link', base: false, dependent: true, hardRefs: ['a', 'b'], anchorKeys: ANCH, live: ['label', 'color', 'maxF'],
    desc: '弹簧秤：两端受拉，表盘显示拉力 F（k 取 2000 N/m，伸长很小）。可串在绳上或挂物体，读数 = 拉力。', own: LOOK.concat(LINKP, [P('maxF', '量程 F_max', 'N', 1, 1e5, 1, 20, { grp: 'look' }), P('rest', '原长（0=初始距离）', 'm', 0, 100, 0.05, 0, { grp: 'geom' })]), dflt: { color: '#cfd8dc' }, build: springBuild(false, true),
    draw(el, g) { const p = linkEnds(el, g); if (!p) return; const m = g.rt.map[el.id]; const F = m ? m.F : 0; line(g, p[0], p[1], '#8aa096', 2); const cx = (p[0].x + p[1].x) / 2, cy = (p[0].y + p[1].y) / 2; const c = g.c; const x = g.V.x(cx), y = g.V.y(cy); c.save(); c.fillStyle = '#0b1416'; c.strokeStyle = el.color; c.lineWidth = 1.6; c.beginPath(); c.arc(x, y, 17, 0, 7); c.fill(); c.stroke(); const fr = Math.max(0, Math.min(1, F / el.maxF)); const ang = Math.PI * 0.75 + fr * Math.PI * 1.5; c.strokeStyle = '#fbbf24'; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(ang) * 13, y + Math.sin(ang) * 13); c.stroke(); c.fillStyle = INK; c.font = '9px sans-serif'; c.textAlign = 'center'; c.fillText(F.toFixed(2) + ' N', x, y + 29); c.restore(); if (el.label) text(g, el.label, cx, cy, { dx: 20, dy: -14, size: 10 }); },
    quantity(el, q, s, rt) { const m = rt.map[el.id]; return q === 'T' && m ? m.F : null; }, readout(el, s, rt) { const m = rt.map[el.id]; return m ? { 'reading F (N)': m.F } : null; }
  });
  reg({
    id: 'readout', zh: '读数显示（速度/受力…）', en: 'Readout', cat: 'meas', kind: 'sensor', dependent: true, hardRefs: ['target'], desc: '在画布上实时显示某个元件的某个物理量（速度、加速度、动能、支持力、摩擦力、张力、感应电动势…）；勾选「曲线」会把它画到右侧曲线图。',
    own: [REF('target', '目标元件'), S('qty', '物理量', PE.QTY.map(z => ({ v: z.v, zh: z.zh })), 'speed', { grp: 'phys' }), P('digits', '小数位', '', 0, 6, 1, 2, { grp: 'look' }), B('plot', '同时画曲线', false, { grp: 'look' })], dflt: { color: '#9be3c3' },
    build(el, ctx) { if (el.plot && el.target) { const s = ctx.s; s.plots = s.plots || []; const of = 'el:' + el.target + ':' + el.qty; if (!s.plots.some(p => p.of === of)) s.plots.push({ id: 'p_' + el.id, of, label: (el.label || el.target) + ' ' + el.qty, history: [] }); } },
    draw(el, g) { const q = el.target ? PE.quantity(g.s, el.target, el.qty) : null; const info = PE.QTY.find(z => z.v === el.qty) || {}; const c = g.c; const x = g.V.x(el.x), y = g.V.y(el.y); const s = (el.label ? el.label + ' ' : (el.target ? el.target + ' ' : '')) + (info.zh || el.qty).split(' ').pop() + ' = ' + (q ? q.value.toFixed(el.digits) + ' ' + q.unit : '—'); c.save(); c.font = '12px monospace'; const w = c.measureText(s).width + 14; c.fillStyle = 'rgba(11,20,22,.88)'; c.strokeStyle = el.color; c.lineWidth = 1.2; c.beginPath(); c.rect(x - 4, y - 16, w, 24); c.fill(); c.stroke(); c.fillStyle = INK; c.fillText(s, x + 3, y); c.restore(); },
    extent: () => [-0.1, -0.15, 1.6, 0.15], readout(el, s, rt) { const q = el.target ? PE.quantity(s, el.target, el.qty) : null; return q ? { [el.qty + ' (' + q.unit + ')']: q.value } : null; }
  });
  reg({
    id: 'trace', zh: '轨迹点（频闪）', en: 'Trace points', cat: 'meas', kind: 'sensor', dependent: true, hardRefs: ['target'], desc: '每隔 interval 秒在目标元件（及其局部偏移点）的位置打一个点，像频闪照片，并标出时刻。',
    own: [REF('target', '目标元件'), P('interval', '间隔', 's', 0.01, 100, 0.01, 0.1, { grp: 'phys' }), P('ox', '偏移 x（元件局部）', 'm', -100, 100, 0.05, 0, { grp: 'geom' }), P('oy', '偏移 y（元件局部）', 'm', -100, 100, 0.05, 0, { grp: 'geom' }), B('labels', '标注时刻', false, { grp: 'look' })], dflt: { color: '#f78fb3' },
    build(el, ctx) { const pts = ctx.rt.tracePts[el.id] = []; let next = 0; ctx.rt.sensors.push((s, rt) => { if (s.t + 1e-9 < next) return; const b = el.target && ctx.bodyOf(el.target); if (!b) return; const p = R.toWorld(b, { x: el.ox, y: el.oy }); pts.push({ x: p.x, y: p.y, t: s.t }); next += el.interval; if (pts.length > 500) pts.shift(); }); },
    draw(el, g) { const pts = g.rt.tracePts[el.id] || []; const c = g.c; c.save(); c.fillStyle = el.color; pts.forEach(p => { c.beginPath(); c.arc(g.V.x(p.x), g.V.y(p.y), 3, 0, 7); c.fill(); if (el.labels) { c.font = '9px sans-serif'; c.fillText(p.t.toFixed(1), g.V.x(p.x) + 4, g.V.y(p.y) - 4); } }); c.restore(); },
    extent: () => [-0.1, -0.1, 0.1, 0.1]
  });
  reg({
    id: 'frictionPair', zh: '摩擦对（两物体间 μ）', en: 'Friction pair', cat: 'meas', kind: 'virtual', base: false, dependent: true, hardRefs: ['a', 'b'],
    desc: '精确指定两个元件之间的摩擦因数 μ₀、μ（和恢复系数 e）。没有摩擦对时：物体与固定表面取表面的 μ；两个动体取两者平均。',
    own: [{ k: 'label', zh: '标签', kind: 'text', def: '', grp: 'look' }, REF('a', '元件 A'), REF('b', '元件 B'), P('mu0', '静摩擦因数 μ₀', '', 0, 5, 0.05, 0.5, { grp: 'phys' }), P('mu', '动摩擦因数 μ', '', 0, 5, 0.05, 0.4, { grp: 'phys' }), P('e', '恢复系数 e（-1=按默认）', '', -1, 1, 0.05, -1, { grp: 'phys' })], dflt: {},
    build(el, ctx) { if (el.a && el.b) ctx.rt.pairs.push({ a: el.a, b: el.b, mu0: Math.max(el.mu0, el.mu), mu: el.mu, e: el.e >= 0 ? el.e : null }); },
    draw() { }, extent: () => [0, 0, 0, 0]
  });

  // cleanup of the placeholders used while defining ground
  PE.T.ground._spec = undefined;

  // ---------------- live edits, drawing, hit-testing ----------------
  PE.live = function (s, id, patch) {
    const el = (s.elements || []).find(e => e.id === id); if (!el) return false; const T = PE.T[el.type]; if (!T) return false;
    const keys = Object.keys(patch || {}); const liveKeys = (T.live || []).concat(T.params.filter(p => p.live).map(p => p.k));
    if (!keys.length || !keys.every(k => liveKeys.indexOf(k) >= 0)) return false;
    Object.assign(el, patch); return true;
  };
  const KIND_RANK = { region: 0, static: 1, optic: 2, body: 3, link: 4, sensor: 5, meas: 5, template: 5, virtual: 9 };
  PE.drawOrder = (s) => (s.elements || []).map((e, i) => ({ e, i })).sort((a, b) => { const ra = KIND_RANK[(PE.T[a.e.type] || {}).kind] || 5, rb = KIND_RANK[(PE.T[b.e.type] || {}).kind] || 5; return ra - rb || a.i - b.i; }).map(o => o.e);
  PE.draw = function (c, s, V, o) {
    o = o || {}; const rt = s._el; if (!rt) return;
    rt.rail = (id) => rt.rails[id];
    const g = { c, V, rt, s, t: s.t, sel: o.sel, body(el) { const m = rt.map[el.id]; return m && m.bodies[0] || null; }, pose(el) { return PE.pose(s, el); } };
    const order = PE.drawOrder(s);
    order.forEach(el => { const T = PE.T[el.type]; if (!T || !T.draw || T.kind === 'link' || T.kind === 'sensor' || T.kind === 'meas' || T.kind === 'virtual') return; try { T.draw(el, g); } catch (e) { /* keep drawing */ } });
    if (o.trail !== false) Object.keys(rt.trails).forEach(id => { const tr = rt.trails[id]; if (tr.length < 2) return; const el = s.elements.find(e => e.id === id); c.save(); c.strokeStyle = (el && el.color) || '#3d9b6e'; c.globalAlpha = 0.45; c.lineWidth = 1.5; c.beginPath(); tr.forEach((p, i) => { if (i) c.lineTo(V.x(p.x), V.y(p.y)); else c.moveTo(V.x(p.x), V.y(p.y)); }); c.stroke(); c.restore(); });
    rt.rays.forEach(r => { c.save(); c.strokeStyle = r.color; c.globalAlpha = 0.85; c.lineWidth = r.w || 1.4; c.beginPath(); r.pts.forEach((p, i) => { if (i) c.lineTo(V.x(p.x), V.y(p.y)); else c.moveTo(V.x(p.x), V.y(p.y)); }); c.stroke(); c.restore(); });
    order.forEach(el => { const T = PE.T[el.type]; if (!T || !T.draw) return; if (T.kind === 'link' || T.kind === 'sensor' || T.kind === 'meas') { try { T.draw(el, g); } catch (e) { /* ignore */ } } });
    if (o.vectors) rt.world.bodies.forEach(b => { if (b.fixed || b.sensorOnly && !b.eid) return; const el = s.elements.find(e => e.id === b.eid); if (!el || PE.T[el.type].kind !== 'body') return; arrow(g, b.x, b.y, b.x + b.vx * 0.25, b.y + b.vy * 0.25, '#fde047', 1.6); const a = rt.acc[b.eid]; if (a && (a.ax || a.ay)) arrow(g, b.x, b.y, b.x + a.ax * b.m * 0.05, b.y + a.ay * b.m * 0.05, '#f87171', 1.4); });
  };
  // element-local → world, hit testing and handles
  PE.toLocal = function (s, el, wx, wy) { const p = PE.pose(s, el); const dx = wx - p.x, dy = wy - p.y, c = Math.cos(-p.a), sn = Math.sin(-p.a); return { x: dx * c - dy * sn, y: dx * sn + dy * c, p }; };
  PE.extentOf = function (el) { const T = PE.T[el.type]; if (!T) return [0, 0, 0, 0]; try { return T.extent ? T.extent(el) : [-0.2, -0.2, 0.2, 0.2]; } catch (e) { return [-0.2, -0.2, 0.2, 0.2]; } };
  PE.hit = function (s, el, wx, wy, tol) {
    const T = PE.T[el.type]; if (!T || T.kind === 'virtual') return false; tol = tol || 0.05;
    if (T.kind === 'link') { const ends = s._el && s._el.map[el.id] && s._el.map[el.id].ends && s._el.map[el.id].ends(); if (!ends) return false; for (let i = 1; i < ends.length; i++) { const a = ends[i - 1], b = ends[i]; const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12; const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / L2)); if (Math.hypot(wx - (a.x + t * dx), wy - (a.y + t * dy)) <= tol * 1.5) return true; } return false; }
    if (el.type === 'hinge') return Math.hypot(wx - el.x, wy - el.y) <= 0.18 + tol;
    const l = PE.toLocal(s, el, wx, wy); const e = PE.extentOf(el);
    if (el.type === 'photogate') { const a = (el.angle || 0) * D2R; const px = wx - el.x, py = wy - el.y; const along = px * Math.cos(a) + py * Math.sin(a), perp = -px * Math.sin(a) + py * Math.cos(a); return Math.abs(along) <= el.len / 2 + tol && Math.abs(perp) <= tol * 2; }
    if (el.type === 'launcher') { const a = el.angle * D2R; const px = wx - el.x, py = wy - el.y; const along = px * Math.cos(a) + py * Math.sin(a), perp = -px * Math.sin(a) + py * Math.cos(a); return (along >= -0.15 && along <= el.len + 0.1 && Math.abs(perp) <= 0.12) || Math.hypot(px, py) < 0.18; }
    if (T.kind === 'sensor' || T.kind === 'meas') { if (el.type === 'readout' || el.type === 'stopwatch' || el.type === 'trace') return Math.hypot(wx - el.x, wy - el.y) < 0.6; }
    return l.x >= e[0] - tol && l.x <= e[2] + tol && l.y >= e[1] - tol && l.y <= e[3] + tol;
  };
  PE.hitTest = function (s, wx, wy, tolWorld) {
    const order = PE.drawOrder(s).slice().reverse(); // topmost first; prefer small dynamic things over big static ones
    const hits = order.filter(el => PE.hit(s, el, wx, wy, tolWorld));
    const rank = (el) => { const k = PE.T[el.type].kind; return k === 'body' || k === 'link' || k === 'sensor' || k === 'meas' ? 0 : (k === 'optic' ? 1 : 2); };
    hits.sort((a, b) => rank(a) - rank(b));
    return hits[0] || null;
  };
  PE.bboxWorld = function (s, el) {
    const T = PE.T[el.type]; const ends = T && T.kind === 'link' && s._el && s._el.map[el.id] && s._el.map[el.id].ends && s._el.map[el.id].ends();
    if (ends) { const xs = ends.map(p => p.x), ys = ends.map(p => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
    const e = PE.extentOf(el); const p = PE.pose(s, el); const cs = [[e[0], e[1]], [e[2], e[1]], [e[2], e[3]], [e[0], e[3]]].map(q => { const r = rotv(q[0], q[1], p.a); return [p.x + r.x, p.y + r.y]; });
    return [Math.min(...cs.map(q => q[0])), Math.min(...cs.map(q => q[1])), Math.max(...cs.map(q => q[0])), Math.max(...cs.map(q => q[1]))];
  };
  // sample every scene value as a flat readable summary (agent tool / state)
  PE.summary = function (s) {
    const rt = s._el; if (!rt) return [];
    return (s.elements || []).map(el => { const T = PE.T[el.type]; const o = { id: el.id, type: el.type, label: el.label || '' }; const b = rt.map[el.id] && rt.map[el.id].bodies[0]; if (b && T.kind === 'body') Object.assign(o, { x: +b.x.toFixed(4), y: +b.y.toFixed(4), vx: +b.vx.toFixed(4), vy: +b.vy.toFixed(4), angle: +(b.a / D2R).toFixed(2), omega: +b.w.toFixed(4) }); const r = T.readout && T.readout(el, s, rt); if (r) o.readout = r; return o; });
  };
})(typeof window !== 'undefined' ? window : globalThis);
