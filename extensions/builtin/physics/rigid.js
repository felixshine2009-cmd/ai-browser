// PhysRigid — compact 2D rigid-body core for the element library (v3.4.0).
// Sequential-impulse solver: convex polygons + circles, Coulomb friction with a static/kinetic
// split (μ₀ holds until the required friction exceeds μ₀·N, then μ applies), surface velocity
// (conveyor belts), restitution, split-impulse penetration correction, distance/rope/rod,
// pin, weld and pulley joints (incl. a massive, non-slipping pulley wheel). Pure maths, no DOM.
(function (root) {
  'use strict';
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const len = (a) => Math.hypot(a.x, a.y);
  const SLOP = 0.002, BETA = 0.2, STICK_V = 0.01, REST_THRESH = 0.6;

  function polyArea(v) { let a = 0; for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; a += cross(p, q); } return a / 2; }
  function polyCentroid(v) {
    let cx = 0, cy = 0, A = 0;
    for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length], c = cross(p, q); A += c; cx += (p.x + q.x) * c; cy += (p.y + q.y) * c; }
    A /= 2; if (Math.abs(A) < 1e-12) return { x: v[0].x, y: v[0].y }; return { x: cx / (6 * A), y: cy / (6 * A) };
  }
  // polar inertia of polygon about origin (per unit mass-density-normalised: returns I/m)
  function polyInertiaOverMass(v) {
    let num = 0, den = 0;
    for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length], c = Math.abs(cross(p, q)); num += c * (dot(p, p) + dot(p, q) + dot(q, q)); den += c; }
    return den ? num / (6 * den) : 0;
  }
  function convexHull(pts) {
    const p = pts.map(a => ({ x: a.x, y: a.y })).sort((a, b) => a.x - b.x || a.y - b.y);
    if (p.length < 3) return p;
    const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    lo.pop(); up.pop(); return lo.concat(up);
  }
  function box(w, h, ox, oy) { ox = ox || 0; oy = oy || 0; return [{ x: ox - w / 2, y: oy - h / 2 }, { x: ox + w / 2, y: oy - h / 2 }, { x: ox + w / 2, y: oy + h / 2 }, { x: ox - w / 2, y: oy + h / 2 }]; }

  const ccw = (v) => (polyArea(v) < 0 ? v.slice().reverse() : v);
  let UID = 1;
  // spec: {id,x,y,a,vx,vy,w,mass,fixed,shapes:[{kind:'circle',r,ox,oy,k}|{kind:'poly',verts}],mu0,mu,e,surfaceSpeed,gscale,q,tag}
  function makeBody(s) {
    const b = {
      uid: UID++, id: s.id, x: s.x || 0, y: s.y || 0, a: s.a || 0, vx: s.vx || 0, vy: s.vy || 0, w: s.w || 0,
      fixed: !!s.fixed, mu0: s.mu0 == null ? 0.5 : s.mu0, mu: s.mu == null ? 0.4 : s.mu, e: s.e == null ? 0.2 : s.e,
      surfaceSpeed: s.surfaceSpeed || 0, gscale: s.gscale == null ? 1 : s.gscale, q: s.q || 0, tag: s.tag || '', noCollide: s.noCollide || null,
      shapes: (s.shapes || []).map(sh => sh.kind === 'circle'
        ? { kind: 'circle', r: sh.r, ox: sh.ox || 0, oy: sh.oy || 0, k: sh.k == null ? 0.5 : sh.k }
        : { kind: 'poly', verts: ccw(sh.verts.map(p => ({ x: p.x, y: p.y }))), oneWay: sh.oneWay ? { dn: sh.oneWay.dn, x: sh.oneWay.x, y: sh.oneWay.y, px: sh.oneWay.px, py: sh.oneWay.py } : null }),
      pvx: 0, pvy: 0, pw: 0, fx: 0, fy: 0, tq: 0, sensorOnly: !!s.sensor, surfOnly: !!s.surfOnly, ownMu: !!s.ownMu, eid: s.eid || s.id
    };
    b.mass = s.mass == null ? 1 : s.mass;
    b.noRotate = !!s.noRotate;
    computeMass(b);
    return b;
  }
  function computeMass(b) {
    if (b.fixed) { b.m = Infinity; b.im = 0; b.I = Infinity; b.iI = 0; return; }
    const areas = b.shapes.map(sh => sh.kind === 'circle' ? Math.PI * sh.r * sh.r : Math.abs(polyArea(sh.verts)));
    const tot = areas.reduce((a, c) => a + c, 0) || 1; let I = 0;
    b.shapes.forEach((sh, i) => {
      const m = b.mass * areas[i] / tot;
      if (sh.kind === 'circle') I += m * (sh.k * sh.r * sh.r + sh.ox * sh.ox + sh.oy * sh.oy);
      else { const c = polyCentroid(sh.verts); const Io = polyInertiaOverMass(sh.verts); I += m * (Io - dot(c, c) + dot(c, c)); }
    });
    b.m = b.mass; b.im = 1 / b.mass; b.I = Math.max(I, 1e-9); b.iI = b.noRotate ? 0 : 1 / b.I;
  }
  function refresh(b) {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    b.c = c; b.s = s; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    b.ws = b.shapes.map(sh => {
      let o;
      if (sh.kind === 'circle') {
        const cx = b.x + c * sh.ox - s * sh.oy, cy = b.y + s * sh.ox + c * sh.oy;
        o = { kind: 'circle', x: cx, y: cy, r: sh.r, bb: [cx - sh.r, cy - sh.r, cx + sh.r, cy + sh.r] };
      } else {
        const v = sh.verts.map(p => ({ x: b.x + c * p.x - s * p.y, y: b.y + s * p.x + c * p.y }));
        const n = v.map((p, i) => { const q = v[(i + 1) % v.length]; const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1; return { x: dy / L, y: -dx / L }; });
        let a0 = Infinity, a1 = Infinity, a2 = -Infinity, a3 = -Infinity; for (const p of v) { if (p.x < a0) a0 = p.x; if (p.y < a1) a1 = p.y; if (p.x > a2) a2 = p.x; if (p.y > a3) a3 = p.y; }
        o = { kind: 'poly', v, n, bb: [a0, a1, a2, a3] };
        if (sh.oneWay) { o.ow = { dn: !!sh.oneWay.dn, x: c * sh.oneWay.x - s * sh.oneWay.y, y: s * sh.oneWay.x + c * sh.oneWay.y }; const lp = sh.oneWay.px === undefined ? { x: sh.verts.reduce((q, p) => q + p.x, 0) / sh.verts.length, y: sh.verts.reduce((q, p) => q + p.y, 0) / sh.verts.length } : { x: sh.oneWay.px, y: sh.oneWay.py }; o.cen = { x: b.x + c * lp.x - s * lp.y, y: b.y + s * lp.x + c * lp.y }; }
      }
      if (o.bb[0] < x0) x0 = o.bb[0]; if (o.bb[1] < y0) y0 = o.bb[1]; if (o.bb[2] > x1) x1 = o.bb[2]; if (o.bb[3] > y1) y1 = o.bb[3];
      return o;
    });
    b.bb = [x0, y0, x1, y1];
  }
  const toWorld = (b, p) => ({ x: b.x + b.c * p.x - b.s * p.y, y: b.y + b.s * p.x + b.c * p.y });

  // ---------- narrow phase ----------
  function maxSep(A, B) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < A.v.length; i++) {
      const n = A.n[i], vi = A.v[i]; let si = Infinity;
      for (let j = 0; j < B.v.length; j++) { const s = (B.v[j].x - vi.x) * n.x + (B.v[j].y - vi.y) * n.y; if (s < si) si = s; }
      if (si > best) { best = si; bi = i; }
    }
    return { sep: best, idx: bi };
  }
  function clip(pts, n, o) {
    const d0 = dot(n, pts[0]) - o, d1 = dot(n, pts[1]) - o, out = [];
    if (d0 <= 0) out.push(pts[0]); if (d1 <= 0) out.push(pts[1]);
    if (d0 * d1 < 0) { const t = d0 / (d0 - d1); out.push({ x: pts[0].x + (pts[1].x - pts[0].x) * t, y: pts[0].y + (pts[1].y - pts[0].y) * t }); }
    return out;
  }
  function polyPoly(A, B) {
    const a = maxSep(A, B); if (a.sep > 0) return null;
    const b = maxSep(B, A); if (b.sep > 0) return null;
    let R = A, I = B, ri = a.idx, flip = false;
    if (b.sep > a.sep + 1e-4) { R = B; I = A; ri = b.idx; flip = true; }
    const rn = R.n[ri]; let ii = 0, md = Infinity;
    for (let j = 0; j < I.v.length; j++) { const d = dot(rn, I.n[j]); if (d < md) { md = d; ii = j; } }
    let pts = [I.v[ii], I.v[(ii + 1) % I.v.length]];
    const v1 = R.v[ri], v2 = R.v[(ri + 1) % R.v.length]; const L = Math.hypot(v2.x - v1.x, v2.y - v1.y) || 1;
    const t = { x: (v2.x - v1.x) / L, y: (v2.y - v1.y) / L };
    pts = clip(pts, { x: -t.x, y: -t.y }, -dot(t, v1)); if (pts.length < 2) return null;
    pts = clip(pts, t, dot(t, v2)); if (pts.length < 2 && !pts.length) return null;
    const front = dot(rn, v1), cs = [];
    for (const p of pts) { const sep = dot(rn, p) - front; if (sep <= 0) cs.push({ x: p.x, y: p.y, sep }); }
    if (!cs.length) return null;
    return { n: flip ? { x: -rn.x, y: -rn.y } : rn, pts: cs, face: flip ? 'B' : 'A', faceNormal: rn };
  }
  // circle vs polygon → normal from polygon to circle
  function circlePoly(C, P) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < P.v.length; i++) { const s = (C.x - P.v[i].x) * P.n[i].x + (C.y - P.v[i].y) * P.n[i].y; if (s > best) { best = s; bi = i; } }
    if (best > C.r) return null;
    const v1 = P.v[bi], v2 = P.v[(bi + 1) % P.v.length];
    if (best < 1e-9) return { n: P.n[bi], pts: [{ x: C.x - P.n[bi].x * best, y: C.y - P.n[bi].y * best, sep: best - C.r }] };
    const u1 = (C.x - v1.x) * (v2.x - v1.x) + (C.y - v1.y) * (v2.y - v1.y), u2 = (C.x - v2.x) * (v1.x - v2.x) + (C.y - v2.y) * (v1.y - v2.y);
    const vtx = u1 <= 0 ? v1 : (u2 <= 0 ? v2 : null);
    if (vtx) {
      const dx = C.x - vtx.x, dy = C.y - vtx.y, d = Math.hypot(dx, dy); if (d > C.r || d < 1e-12) return null;
      return { n: { x: dx / d, y: dy / d }, pts: [{ x: vtx.x, y: vtx.y, sep: d - C.r }] };
    }
    return { n: P.n[bi], pts: [{ x: C.x - P.n[bi].x * best, y: C.y - P.n[bi].y * best, sep: best - C.r }] };
  }
  function collideShapes(sa, sb) {
    if (sa.kind === 'circle' && sb.kind === 'circle') {
      const dx = sb.x - sa.x, dy = sb.y - sa.y, d = Math.hypot(dx, dy), R = sa.r + sb.r; if (d > R) return null;
      const n = d > 1e-12 ? { x: dx / d, y: dy / d } : { x: 0, y: 1 };
      return { n, pts: [{ x: sa.x + n.x * (sa.r + (d - R) / 2), y: sa.y + n.y * (sa.r + (d - R) / 2), sep: d - R }] };
    }
    if (sa.kind === 'poly' && sb.kind === 'poly') return polyPoly(sa, sb);
    if (sa.kind === 'circle') { const m = circlePoly(sa, sb); if (!m) return null; return { n: { x: -m.n.x, y: -m.n.y }, pts: m.pts, face: 'B', faceNormal: m.n }; }
    const m = circlePoly(sb, sa); if (!m) return null; return { n: m.n, pts: m.pts, face: 'A', faceNormal: m.n };
  }
  // ---------- world ----------
  function World(o) {
    o = o || {};
    this.bodies = []; this.joints = []; this.gx = o.gx || 0; this.gy = o.gy == null ? -9.8 : o.gy; this.t = 0;
    this.hooks = []; this.stick = new Map(); this.warm = new Map(); this.contacts = []; this.iters = o.iters || 16; this.sub = o.sub || 4;
  }
  World.prototype.add = function (b) { this.bodies.push(b); refresh(b); return b; };
  World.prototype.addJoint = function (j) { this.joints.push(j); return j; };
  World.prototype.detect = function () {
    const out = [], B = this.bodies;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      if (a.fixed && b.fixed) continue; if (a.sensorOnly || b.sensorOnly) continue;
      if (a.noCollide && a.noCollide.indexOf(b.id) >= 0) continue; if (b.noCollide && b.noCollide.indexOf(a.id) >= 0) continue;
      if (a.bb[2] < b.bb[0] || b.bb[2] < a.bb[0] || a.bb[3] < b.bb[1] || b.bb[3] < a.bb[1]) continue;
      for (let p = 0; p < a.ws.length; p++) for (let q = 0; q < b.ws.length; q++) {
        const sa = a.ws[p], sb = b.ws[q];
        if (sa.ow && ((sa.ow.dn && b.vy > -0.25) || (b.x - sa.cen.x) * sa.ow.x + (b.y - sa.cen.y) * sa.ow.y < 0)) continue;
        if (sb.ow && ((sb.ow.dn && a.vy > -0.25) || (a.x - sb.cen.x) * sb.ow.x + (a.y - sb.cen.y) * sb.ow.y < 0)) continue;
        if (sa.bb[2] < sb.bb[0] || sb.bb[2] < sa.bb[0] || sa.bb[3] < sb.bb[1] || sb.bb[3] < sa.bb[1]) continue;
        const m = collideShapes(sa, sb); if (!m) continue;
        out.push({ A: a, B: b, n: m.n, pts: m.pts, key: a.uid + '|' + b.uid + '|' + p + '|' + q, face: m.face, faceNormal: m.faceNormal });
      }
    }
    return out;
  };
  function velAt(b, r) { return { x: b.vx - b.w * r.y, y: b.vy + b.w * r.x }; }
  function applyImp(b, r, J) { b.vx += J.x * b.im; b.vy += J.y * b.im; b.w += b.iI * cross(r, J); }
  function applyPseudo(b, r, J) { b.pvx += J.x * b.im; b.pvy += J.y * b.im; b.pw += b.iI * cross(r, J); }

  World.prototype.prepare = function (cs, dt) {
    for (const c of cs) {
      const A = c.A, B = c.B;
      // pair coefficients: explicit pair table > surface-vs-body: the surface's value > two bodies: mean
      const pf = this.pairFn && this.pairFn(A, B);
      if (pf) { c.mu0 = pf.mu0; c.mu = pf.mu; c.e = pf.e != null ? pf.e : (A.e + B.e) / 2; }
      else {
        c.e = (A.e + B.e) / 2;
        if (A.ownMu || B.ownMu) { const o = A.ownMu && B.ownMu ? { mu0: Math.min(A.mu0, B.mu0), mu: Math.min(A.mu, B.mu) } : (A.ownMu ? A : B); c.mu0 = o.mu0; c.mu = o.mu; }
        else if (A.surfOnly && !B.surfOnly) { c.mu0 = A.mu0; c.mu = A.mu; }
        else if (B.surfOnly && !A.surfOnly) { c.mu0 = B.mu0; c.mu = B.mu; }
        else if (A.surfOnly && B.surfOnly) { c.mu0 = Math.max(A.mu0, B.mu0); c.mu = Math.max(A.mu, B.mu); }
        else { c.mu0 = (A.mu0 + B.mu0) / 2; c.mu = (A.mu + B.mu) / 2; }
      }
      if (c.mu > c.mu0) c.mu0 = c.mu;
      // conveyor surface velocity: applies on the belt's top face
      c.sv = { x: 0, y: 0 };
      const belt = A.surfaceSpeed ? A : (B.surfaceSpeed ? B : null);
      if (belt) {
        const bn = belt === A ? c.n : { x: -c.n.x, y: -c.n.y }; // normal pointing out of belt toward the other body
        const up = { x: -belt.s, y: belt.c }; // belt's local +y in world
        if (dot(bn, up) > 0.7) { c.sv = { x: belt.c * belt.surfaceSpeed, y: belt.s * belt.surfaceSpeed }; if (belt === B) { /* surface velocity of B seen from A */ } c.beltIsB = belt === B; }
      }
      c.t = { x: -c.n.y, y: c.n.x };
      let st = this.stick.get(c.key);
      for (const p of c.pts) {
        p.rA = { x: p.x - A.x, y: p.y - A.y }; p.rB = { x: p.x - B.x, y: p.y - B.y };
        const rnA = cross(p.rA, c.n), rnB = cross(p.rB, c.n), rtA = cross(p.rA, c.t), rtB = cross(p.rB, c.t);
        p.nM = 1 / (A.im + B.im + A.iI * rnA * rnA + B.iI * rnB * rnB);
        p.tM = 1 / (A.im + B.im + A.iI * rtA * rtA + B.iI * rtB * rtB);
        const va = velAt(A, p.rA), vb = velAt(B, p.rB);
        const rv = { x: vb.x - va.x, y: vb.y - va.y };
        const vn = dot(rv, c.n);
        p.bounce = (vn < -REST_THRESH && c.e > 0) ? -c.e * vn : 0;
        p.bias = BETA / dt * Math.max(0, -p.sep - SLOP);
        p.jn = 0; p.jt = 0; p.jb = 0;
        const wm = this.warm.get(c.key); const wp = wm && wm.length === c.pts.length ? wm[c.pts.indexOf(p)] : null;
        if (wp && !(p.bounce > 0)) { p.jn = wp.jn * 0.9; p.jt = wp.jt * 0.9; const Jw = { x: c.n.x * p.jn + (-c.n.y) * p.jt, y: c.n.y * p.jn + c.n.x * p.jt }; applyImp(A, p.rA, { x: -Jw.x, y: -Jw.y }); applyImp(B, p.rB, Jw); }
        const sv = c.sv; // relative tangential velocity of the surfaces
        const vt0 = dot(rv, c.t) - (c.beltIsB ? -dot(sv, c.t) : dot(sv, c.t));
        p.vt0 = vt0;
      }
      if (!st) { st = { stick: Math.abs(c.pts[0].vt0) < STICK_V }; this.stick.set(c.key, st); }
      st.seen = this.t; c.st = st;
    }
  };
  World.prototype.solveContacts = function (cs, dt) {
    for (const c of cs) {
      const A = c.A, B = c.B, t = c.t, n = c.n;
      const mu = c.st.stick ? c.mu0 : c.mu;
      for (const p of c.pts) {
        // friction (against the clamp from the previous normal impulse)
        const va = velAt(A, p.rA), vb = velAt(B, p.rB);
        const rv = { x: vb.x - va.x, y: vb.y - va.y };
        const svT = dot(c.sv, t);
        // belt surface moves with the belt: if belt is A its surface velocity adds to A; if B, to B
        const vtRel = dot(rv, t) - (c.beltIsB ? -svT : svT);
        let jt = -vtRel * p.tM;
        const maxF = mu * p.jn; const nj = Math.max(-maxF, Math.min(maxF, p.jt + jt)); jt = nj - p.jt; p.jt = nj;
        const Jt = { x: t.x * jt, y: t.y * jt };
        applyImp(A, p.rA, { x: -Jt.x, y: -Jt.y }); applyImp(B, p.rB, Jt);
      }
      for (const p of c.pts) {
        const va = velAt(A, p.rA), vb = velAt(B, p.rB);
        const vn = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y;
        let jn = -(vn - p.bounce) * p.nM;
        const nj = Math.max(0, p.jn + jn); jn = nj - p.jn; p.jn = nj;
        const Jn = { x: n.x * jn, y: n.y * jn };
        applyImp(A, p.rA, { x: -Jn.x, y: -Jn.y }); applyImp(B, p.rB, Jn);
      }
      // pseudo-velocity (split impulse) for penetration
      for (const p of c.pts) {
        if (p.bias <= 0) continue;
        const va = { x: A.pvx - A.pw * p.rA.y, y: A.pvy + A.pw * p.rA.x }, vb = { x: B.pvx - B.pw * p.rB.y, y: B.pvy + B.pw * p.rB.x };
        const vn = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y;
        let jn = (p.bias - vn) * p.nM; const nj = Math.max(0, p.jb + jn); jn = nj - p.jb; p.jb = nj;
        const Jn = { x: n.x * jn, y: n.y * jn };
        applyPseudo(A, p.rA, { x: -Jn.x, y: -Jn.y }); applyPseudo(B, p.rB, Jn);
      }
    }
  };
  World.prototype.finishContacts = function (cs) {
    const nw = new Map();
    for (const c of cs) {
      nw.set(c.key, c.pts.map(p => ({ jn: p.jn, jt: p.jt })));
      const p0 = c.pts[0], jn = c.pts.reduce((s, p) => s + p.jn, 0), jt = c.pts.reduce((s, p) => s + p.jt, 0);
      const va = velAt(c.A, p0.rA), vb = velAt(c.B, p0.rB); const rv = { x: vb.x - va.x, y: vb.y - va.y };
      const svT = dot(c.sv, c.t); const vtRel = dot(rv, c.t) - (c.beltIsB ? -svT : svT);
      if (c.st.stick) { if (Math.abs(jt) >= c.mu0 * jn * 0.9999 && jn > 0 && Math.abs(vtRel) > STICK_V) c.st.stick = false; }
      else if (Math.abs(vtRel) < STICK_V) c.st.stick = true;
      c.N = jn; c.F = jt;
    }
    this.warm = nw;
  };

  // ---------- joints ----------
  // kinds: 'dist' (rod: two-sided, rope: pull-only), 'pin', 'weld', 'pulley'
  function anchorW(b, l) { return b ? toWorld(b, l) : { x: l.x, y: l.y }; }
  function rOf(b, p) { return b ? { x: p.x - b.x, y: p.y - b.y } : { x: 0, y: 0 }; }
  const IM = (b) => b ? b.im : 0, II = (b) => b ? b.iI : 0;
  function jVel(b, r) { return b ? velAt(b, r) : { x: 0, y: 0 }; }
  function jImp(b, r, J) { if (b) applyImp(b, r, J); }
  function JointPrep(j, dt) {
    j.dt = dt;
    if (j.kind === 'dist') {
      const pa = anchorW(j.A, j.la), pb = anchorW(j.B, j.lb); j.rA = rOf(j.A, pa); j.rB = rOf(j.B, pb);
      const d = { x: pb.x - pa.x, y: pb.y - pa.y }; const L = len(d) || 1e-9; j.u = { x: d.x / L, y: d.y / L }; j.cur = L;
      const rnA = cross(j.rA, j.u), rnB = cross(j.rB, j.u);
      j.M = 1 / (IM(j.A) + IM(j.B) + II(j.A) * rnA * rnA + II(j.B) * rnB * rnB);
      j.C = L - j.length; j.taut = j.type === 'rod' ? true : j.C >= -1e-6;
      j.lam = 0;
    } else if (j.kind === 'pin' || j.kind === 'weld') {
      const pa = anchorW(j.A, j.la), pb = anchorW(j.B, j.lb); j.rA = rOf(j.A, pa); j.rB = rOf(j.B, pb);
      j.err = { x: pb.x - pa.x, y: pb.y - pa.y };
      const mA = IM(j.A), mB = IM(j.B), iA = II(j.A), iB = II(j.B), rA = j.rA, rB = j.rB;
      const k11 = mA + mB + iA * rA.y * rA.y + iB * rB.y * rB.y, k12 = -iA * rA.x * rA.y - iB * rB.x * rB.y, k22 = mA + mB + iA * rA.x * rA.x + iB * rB.x * rB.x;
      const det = k11 * k22 - k12 * k12 || 1e-12; j.K = { a: k22 / det, b: -k12 / det, d: k11 / det };
      j.lam2 = { x: 0, y: 0 };
      if (j.kind === 'weld') { const k = II(j.A) + II(j.B); j.kW = k > 0 ? 1 / k : 0; j.aErr = (j.B ? j.B.a : 0) - (j.A ? j.A.a : 0) - (j.refAngle || 0); j.lamW = 0; }
    } else if (j.kind === 'rope2') {
      const P = j.nodes.map(n => anchorW(n.b, n.l)); j.rs = j.nodes.map((n, i) => rOf(n.b, P[i]));
      const u = [null]; let cur = 0; for (let k = 1; k < P.length; k++) { const dx = P[k].x - P[k - 1].x, dy = P[k].y - P[k - 1].y, L = Math.hypot(dx, dy) || 1e-9; u.push({ x: dx / L, y: dy / L }); cur += L; }
      j.g = P.map((_, k) => { const a = k > 0 ? u[k] : { x: 0, y: 0 }, b = k < P.length - 1 ? u[k + 1] : { x: 0, y: 0 }; return { x: a.x - b.x, y: a.y - b.y }; });
      const acc = new Map(); j.nodes.forEach((n, k) => { if (!n.b || n.b.im === 0) return; let e = acc.get(n.b); if (!e) { e = { fx: 0, fy: 0, t: 0, b: n.b }; acc.set(n.b, e); } e.fx += j.g[k].x; e.fy += j.g[k].y; e.t += cross(j.rs[k], j.g[k]); });
      let K = 0; acc.forEach(e => { K += e.b.im * (e.fx * e.fx + e.fy * e.fy) + e.b.iI * e.t * e.t; });
      j.K = K; j.cur = cur; j.C = cur - j.length; j.taut = j.C >= -1e-6; j.lam = 0;
    } else if (j.kind === 'pulley') {
      const pa = anchorW(j.A, j.la), pb = anchorW(j.B, j.lb); j.rA = rOf(j.A, pa); j.rB = rOf(j.B, pb);
      const dA = { x: pa.x - j.gA.x, y: pa.y - j.gA.y }, dB = { x: pb.x - j.gB.x, y: pb.y - j.gB.y };
      const LA = len(dA) || 1e-9, LB = len(dB) || 1e-9; j.uA = { x: dA.x / LA, y: dA.y / LA }; j.uB = { x: dB.x / LB, y: dB.y / LB };
      j.LA = LA; j.LB = LB; j.C = LA + j.ratio * LB - j.total;
      const rA = cross(j.rA, j.uA), rB = cross(j.rB, j.uB);
      j.mA = IM(j.A) + II(j.A) * rA * rA; j.mB = IM(j.B) + II(j.B) * rB * rB;
      j.kEq = j.mA + j.ratio * j.ratio * j.mB;        // single-impulse (massless wheel) effective mass term
      j.taut = j.type === 'rod' || j.C >= -1e-6;
      j.lamP = 0; j.lamA = 0; j.lamB = 0;
    }
  }
  function jointSolve(j) {
    const dt = j.dt;
    if (j.kind === 'dist') {
      if (!j.taut) return;
      const va = jVel(j.A, j.rA), vb = jVel(j.B, j.rB); const cdot = (vb.x - va.x) * j.u.x + (vb.y - va.y) * j.u.y;
      const bias = BETA / dt * Math.max(0, j.C - SLOP) * (j.C >= 0 ? 1 : 0) + (j.type === 'rod' && j.C < 0 ? BETA / dt * (j.C + SLOP) : 0);
      let l = -j.M * (cdot + bias);
      if (j.type === 'rope') { const nl = Math.min(0, j.lam + l); l = nl - j.lam; j.lam = nl; } else j.lam += l;
      const J = { x: j.u.x * l, y: j.u.y * l }; jImp(j.A, j.rA, { x: -J.x, y: -J.y }); jImp(j.B, j.rB, J);
    } else if (j.kind === 'pin' || j.kind === 'weld') {
      if (j.kind === 'weld' && j.kW) { const cd = (j.B ? j.B.w : 0) - (j.A ? j.A.w : 0); const l = -j.kW * (cd + 0.2 / dt * j.aErr); if (j.A) j.A.w -= II(j.A) * l; if (j.B) j.B.w += II(j.B) * l; j.lamW += l; }
      const va = jVel(j.A, j.rA), vb = jVel(j.B, j.rB);
      const cd = { x: vb.x - va.x + BETA / dt * j.err.x, y: vb.y - va.y + BETA / dt * j.err.y };
      const l = { x: -(j.K.a * cd.x + j.K.b * cd.y), y: -(j.K.b * cd.x + j.K.d * cd.y) };
      j.lam2.x += l.x; j.lam2.y += l.y;
      jImp(j.A, j.rA, { x: -l.x, y: -l.y }); jImp(j.B, j.rB, l);
    } else if (j.kind === 'rope2') {
      if (!j.taut || j.K < 1e-12) return;
      let cd = 0; j.nodes.forEach((n, k) => { if (!n.b) return; const v = velAt(n.b, j.rs[k]); cd += v.x * j.g[k].x + v.y * j.g[k].y; });
      let l = (cd + BETA / dt * Math.max(0, j.C - SLOP)) / j.K; const nl = Math.max(0, j.lam + l); l = nl - j.lam; j.lam = nl;
      j.nodes.forEach((n, k) => { if (n.b) applyImp(n.b, j.rs[k], { x: -j.g[k].x * l, y: -j.g[k].y * l }); });
    } else if (j.kind === 'pulley') {
      if (!j.taut) return;
      const vA = jVel(j.A, j.rA), vB = jVel(j.B, j.rB);
      // rope speeds away from the pulley on each side
      const sA = dot(vA, j.uA), sB = dot(vB, j.uB);
      const bias = BETA / dt * Math.max(0, j.C - SLOP);
      if (j.wheelI > 0) {
        // massive non-slipping wheel (ratio 1): tensions differ, wheel turns with the rope.
        // unknown tension impulses lA, lB (toward the pulley); exact 2x2 solve per iteration.
        const R = j.wheelR, I = j.wheelI, d = j.dir, iA = j.mA, iB = j.mB, q = R * R / I;
        const c1 = sA + sB + bias, c2 = d * sA - j.wheelW * R;
        const det = iA * (-q) - iB * (q + d * iA) || 1e-12;
        let lA = (c1 * (-q) - iB * c2) / det, lB = (iA * c2 - (q + d * iA) * c1) / det;
        const nA = Math.max(0, (j.lamA || 0) + lA), nB = Math.max(0, (j.lamB || 0) + lB);
        lA = nA - (j.lamA || 0); lB = nB - (j.lamB || 0); j.lamA = nA; j.lamB = nB;
        jImp(j.A, j.rA, { x: -j.uA.x * lA, y: -j.uA.y * lA }); jImp(j.B, j.rB, { x: -j.uB.x * lB, y: -j.uB.y * lB });
        j.wheelW += (lA - lB) * R / I;
      } else {
        let l = (sA + j.ratio * sB + bias) / j.kEq; const nl = Math.max(0, (j.lamP || 0) + l); l = nl - (j.lamP || 0); j.lamP = nl;
        jImp(j.A, j.rA, { x: -j.uA.x * l, y: -j.uA.y * l }); jImp(j.B, j.rB, { x: -j.uB.x * l * j.ratio, y: -j.uB.y * l * j.ratio });
      }
    }
  }

  World.prototype.step = function (dt, sub) {
    sub = sub || this.sub; const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (const b of this.bodies) refresh(b);
      for (const hk of this.hooks) hk(this, h);
      for (const b of this.bodies) {
        if (b.fixed) continue;
        b.vx += (this.gx * b.gscale + b.fx * b.im) * h; b.vy += (this.gy * b.gscale + b.fy * b.im) * h; b.w += b.tq * b.iI * h;
        b.fx = b.fy = b.tq = 0; b.pvx = b.pvy = b.pw = 0;
      }
      const cs = this.detect(); this.prepare(cs, h);
      for (const j of this.joints) if (!j.off) JointPrep(j, h);
      for (let k = 0; k < this.iters; k++) { this.solveContacts(cs, h); for (const j of this.joints) if (!j.off) jointSolve(j); }
      this.finishContacts(cs);
      for (const j of this.joints) {
        if (j.kind === 'pulley' && j.wheelI > 0) j.wheelAngle = (j.wheelAngle || 0) + j.wheelW * h;
        if (j.kind === 'dist') j.T = j.taut ? -j.lam / h : 0;
        if (j.kind === 'rope2') j.T = j.taut ? j.lam / h : 0;
        if (j.kind === 'pulley') { j.T = j.taut ? (j.wheelI > 0 ? ((j.lamA || 0) + (j.lamB || 0)) / 2 : (j.lamP || 0)) / h : 0; j.TA = j.taut ? (j.wheelI > 0 ? (j.lamA || 0) : (j.lamP || 0)) / h : 0; j.TB = j.taut ? (j.wheelI > 0 ? (j.lamB || 0) : (j.lamP || 0) * j.ratio) / h : 0; }
      }
      for (const b of this.bodies) {
        if (b.fixed) continue;
        b.x += (b.vx + b.pvx) * h; b.y += (b.vy + b.pvy) * h; b.a += (b.w + b.pw) * h;
      }
      this.contacts = cs; this.t += h;
    }
    for (const b of this.bodies) refresh(b);
  };
  root.PhysRigid = { makeBody, computeMass, refresh, World, polyArea, polyCentroid, convexHull, box, toWorld, JointPrep, jointSolve };
  if (typeof module !== 'undefined') module.exports = root.PhysRigid;
})(typeof window !== 'undefined' ? window : globalThis);
