// PhysElements — the v3.4.0 element library core: registry, scene document API (add/update/remove/
// duplicate/custom types), runtime builder, stepping, optics ray tracer, readouts and canvas drawing.
// Element *type definitions* live in elements-types.js. Scene document = plain JSON ({elements:[…]}).
(function (root) {
  'use strict';
  const R = root.PhysRigid || (typeof require !== 'undefined' ? require('./rigid.js') : null);
  const D2R = Math.PI / 180;
  const PE = { T: {}, order: [], custom: {}, D2R };
  PE.CATS = [
    { id: 'shape', zh: '形体', en: 'Shapes' }, { id: 'surface', zh: '表面与轨道', en: 'Surfaces' },
    { id: 'mech', zh: '机构', en: 'Mechanisms' }, { id: 'field', zh: '场与区域', en: 'Fields' },
    { id: 'optic', zh: '电学与光学', en: 'Electrical & optical' }, { id: 'meas', zh: '测量', en: 'Measurement' },
    { id: 'mine', zh: '我的元件', en: 'My elements' }
  ];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  PE.clone = clone;

  // ---------- parameter schema helpers ----------
  function P(k, zh, unit, min, max, step, def, extra) { return Object.assign({ k, zh, unit, min, max, step, def, kind: 'num' }, extra || {}); }
  PE.P = P;
  const B = (k, zh, def, extra) => Object.assign({ k, zh, kind: 'bool', def }, extra || {});
  const S = (k, zh, opts, def, extra) => Object.assign({ k, zh, kind: 'select', opts, def }, extra || {});
  const REF = (k, zh, extra) => Object.assign({ k, zh, kind: 'ref', def: '' }, extra || {});
  PE.B = B; PE.S = S; PE.REF = REF;
  PE.BASE = [
    P('x', 'x 位置', 'm', -1000, 1000, 0.05, 0, { grp: 'pos' }), P('y', 'y 位置', 'm', -1000, 1000, 0.05, 0, { grp: 'pos' }),
    P('angle', '角度', '°', -360, 360, 1, 0, { grp: 'pos' }),
    { k: 'label', zh: '标签', kind: 'text', def: '', grp: 'look' }, { k: 'color', zh: '颜色', kind: 'color', def: '#3d9b6e', grp: 'look' }
  ];
  PE.BODYP = [
    P('mass', '质量 m', 'kg', 0.001, 10000, 0.1, 1, { grp: 'phys' }),
    P('mu0', '静摩擦因数 μ₀', '', 0, 5, 0.05, 0.5, { grp: 'phys' }), P('mu', '动摩擦因数 μ', '', 0, 5, 0.05, 0.4, { grp: 'phys' }),
    P('e', '恢复系数 e', '', 0, 1, 0.05, 0.3, { grp: 'phys' }), P('q', '电荷量 q', 'C', -10, 10, 'any', 0, { grp: 'phys' }),
    B('fixed', '固定', false, { grp: 'phys' }), B('gravity', '受重力', true, { grp: 'phys' }),
    P('vx', '初速度 vₓ', 'm/s', -1000, 1000, 0.1, 0, { grp: 'init' }), P('vy', '初速度 v_y', 'm/s', -1000, 1000, 0.1, 0, { grp: 'init' }),
    P('omega', '初角速度 ω', 'rad/s', -1000, 1000, 0.1, 0, { grp: 'init' })
  ];
  PE.SURFP = [
    P('mu0', '静摩擦因数 μ₀', '', 0, 5, 0.05, 0.5, { grp: 'phys' }), P('mu', '动摩擦因数 μ', '', 0, 5, 0.05, 0.4, { grp: 'phys' }),
    P('e', '恢复系数 e', '', 0, 1, 0.05, 0.3, { grp: 'phys' })
  ];

  PE.register = function (def) {
    def.params = (def.base === false ? [] : PE.BASE).concat(def.own || []).map(p => Object.assign({}, p));
    if (!def.noBase) { /* nothing */ }
    def.defaults = {}; def.params.forEach(p => { if (p.def !== undefined) def.defaults[p.k] = p.def; });
    Object.assign(def.defaults, def.dflt || {});
    if (def.dflt) def.params.forEach(p => { if (def.dflt[p.k] !== undefined) p.def = def.dflt[p.k]; });
    if (!PE.T[def.id]) PE.order.push(def.id);
    PE.T[def.id] = def; return def;
  };
  PE.typeOf = (el) => PE.T[el.type];

  // ---------- scene document ----------
  function ensureDoc(doc) { if (!Array.isArray(doc.elements)) doc.elements = []; if (!Array.isArray(doc.bodies)) doc.bodies = []; if (!Array.isArray(doc.customTypes)) doc.customTypes = []; return doc; }
  PE.ensureDoc = ensureDoc;
  function findEl(doc, id) { return (doc.elements || []).find(e => e.id === id); }
  PE.find = findEl;
  function uniqueId(doc, base) { let n = 1; const ids = new Set((doc.elements || []).map(e => e.id)); while (ids.has(base + n)) n++; return base + n; }
  function fullEl(type, props) {
    const T = PE.T[type]; const el = Object.assign({}, T.defaults, props || {}); el.type = type; return el;
  }
  PE.makeElement = fullEl;

  // check one value against its schema; returns {ok, value, error}
  function coerce(p, v) {
    if (p.kind === 'num') {
      if (typeof v === 'string' && v.trim() !== '') v = Number(v);
      if (!isNum(v)) return { ok: false, error: p.k + ' 必须是数字 / must be a number' };
      if (p.min != null && v < p.min) return { ok: false, error: p.k + ' 不能小于 ' + p.min + ' / must be ≥ ' + p.min };
      if (p.max != null && v > p.max) return { ok: false, error: p.k + ' 不能大于 ' + p.max + ' / must be ≤ ' + p.max };
      return { ok: true, value: v };
    }
    if (p.kind === 'bool') return { ok: true, value: !!(v === 'false' ? false : v) };
    if (p.kind === 'select') {
      const o = (p.opts || []).map(x => (typeof x === 'object' ? x.v : x));
      if (o.indexOf(v) < 0) return { ok: false, error: p.k + ' 必须是 ' + o.join('/') };
      return { ok: true, value: v };
    }
    if (p.kind === 'color') { if (typeof v !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(v)) return { ok: false, error: p.k + ' 需要 #rrggbb 颜色' }; return { ok: true, value: v }; }
    if (p.kind === 'verts') {
      if (typeof v === 'string') { try { v = parseVerts(v); } catch (e) { return { ok: false, error: p.k + ': ' + e.message }; } }
      if (!Array.isArray(v) || v.length < 3 || v.length > 64 || v.some(q => !Array.isArray(q) || !isNum(q[0]) || !isNum(q[1]))) return { ok: false, error: p.k + ' 需要 3–64 个 [x,y] 顶点' };
      return { ok: true, value: v };
    }
    if (p.kind === 'text' || p.kind === 'ref') return { ok: true, value: v == null ? '' : String(v) };
    if (p.kind === 'json') return { ok: true, value: v };
    return { ok: true, value: v };
  }
  function parseVerts(str) {
    const out = String(str).split(/[;\n]+/).map(s => s.trim()).filter(Boolean).map(s => { const m = s.split(/[,\s]+/).map(Number); if (m.length !== 2 || m.some(x => !isFinite(x))) throw new Error('顶点格式 "x,y; x,y; …"'); return m; });
    return out;
  }
  PE.parseVerts = parseVerts;
  PE.vertsToText = (v) => (v || []).map(p => +(+p[0]).toFixed(3) + ',' + +(+p[1]).toFixed(3)).join('; ');

  PE.add = function (doc, type, props, opts) {
    ensureDoc(doc); opts = opts || {};
    const cd = PE.custom[type] || (doc.customTypes || []).find(c => c.id === type);
    if (cd) return instantiateCustom(doc, cd, props || {});
    const T = PE.T[type]; if (!T) return { ok: false, errors: ['未知元件类型 unknown element type: ' + type] };
    const el = fullEl(type, {}); const errors = [];
    Object.keys(props || {}).forEach(k => {
      if (k === 'id' || k === 'type') return;
      const p = T.params.find(q => q.k === k);
      if (!p) { if (T.free) { el[k] = props[k]; return; } errors.push('未知参数 ' + k + '（类型 ' + type + '）'); return; }
      const r = coerce(p, props[k]); if (r.ok) el[k] = r.value; else errors.push(r.error);
    });
    if (errors.length) return { ok: false, errors };
    if (props && props.id) { if (findEl(doc, props.id)) return { ok: false, errors: ['id 已存在 duplicate id: ' + props.id] }; el.id = String(props.id); }
    else el.id = uniqueId(doc, type);
    if (T.expand && !opts.noExpand) { // templates (mass spectrometer, cyclotron…) expand to several elements
      const list = T.expand(el); const ids = [];
      list.forEach((sub, i) => { const t = sub.type; delete sub.type; const base = sub.id || (el.id + '_' + i); sub.id = base; const r = PE.add(doc, t, sub, { noExpand: true }); if (r.ok) ids.push(r.id); else errors.push(...r.errors); });
      return errors.length ? { ok: false, errors } : { ok: true, id: ids[0], ids };
    }
    doc.elements.push(el);
    return { ok: true, id: el.id, ids: [el.id], element: el };
  };
  PE.update = function (doc, id, patch) {
    const el = findEl(doc, id); if (!el) return { ok: false, errors: ['找不到元件 no element ' + id] };
    const T = PE.T[el.type]; const errors = [], applied = {};
    Object.keys(patch || {}).forEach(k => {
      if (k === 'id' || k === 'type') { errors.push(k + ' 不可修改'); return; }
      const p = T.params.find(q => q.k === k);
      if (!p) { if (T.free) { applied[k] = patch[k]; return; } errors.push('未知参数 ' + k + '（类型 ' + el.type + '）'); return; }
      const r = coerce(p, patch[k]); if (r.ok) applied[k] = r.value; else errors.push(r.error);
    });
    if (errors.length) return { ok: false, errors };
    Object.assign(el, applied); if (T.afterUpdate) T.afterUpdate(el); return { ok: true, id, applied };
  };
  function refsOf(el) { const T = PE.T[el.type]; return T ? T.params.filter(p => p.kind === 'ref').map(p => ({ k: p.k, v: el[p.k] })).filter(r => r.v) : []; }
  PE.remove = function (doc, id) {
    const i = (doc.elements || []).findIndex(e => e.id === id); if (i < 0) return { ok: false, errors: ['找不到元件 no element ' + id] };
    const removed = [id]; doc.elements.splice(i, 1);
    // dependents (ropes/springs/hinges/readouts that reference the element) go with it
    let again = true;
    while (again) {
      again = false;
      for (let j = doc.elements.length - 1; j >= 0; j--) { const e = doc.elements[j]; const T = PE.T[e.type]; if (T && T.dependent && refsOf(e).some(r => removed.indexOf(r.v) >= 0 && T.hard !== false && (T.hardRefs ? T.hardRefs.indexOf(r.k) >= 0 : true))) { removed.push(e.id); doc.elements.splice(j, 1); again = true; } }
    }
    doc.elements.forEach(e => { refsOf(e).forEach(r => { if (removed.indexOf(r.v) >= 0) e[r.k] = ''; }); });
    return { ok: true, removed };
  };
  PE.duplicate = function (doc, ids, dx, dy) {
    const out = []; const map = {};
    ids.forEach(id => { const e = findEl(doc, id); if (!e) return; const c = clone(e); c.id = uniqueId(doc, e.type); c.x = (c.x || 0) + (dx == null ? 0.5 : dx); c.y = (c.y || 0) + (dy == null ? 0.5 : dy); map[id] = c.id; doc.elements.push(c); out.push(c.id); });
    out.forEach(nid => { const e = findEl(doc, nid); refsOf(e).forEach(r => { if (map[r.v]) e[r.k] = map[r.v]; }); });
    return { ok: true, ids: out };
  };

  // ---------- custom element types (我的元件) ----------
  // def: {id, zh, en?, base?:'polygon'|…, defaults?:{…}, template?:[{type,…,x,y}] (group relative to the drop point), icon?}
  PE.defineCustom = function (def, lib) {
    const errors = [];
    if (!def || typeof def !== 'object') return { ok: false, errors: ['definition must be an object'] };
    if (!/^[A-Za-z][A-Za-z0-9_\-]{1,40}$/.test(def.id || '')) errors.push('id 需为字母开头的 2–41 个字母/数字/_/-');
    if (PE.T[def.id]) errors.push('id 与内置类型重名: ' + def.id);
    if (!def.base && !(Array.isArray(def.template) && def.template.length)) errors.push('需要 base（基础类型）或 template（元件组）之一');
    if (def.base && !PE.T[def.base]) errors.push('未知 base 类型: ' + def.base);
    if (def.base) { const T = PE.T[def.base]; Object.keys(def.defaults || {}).forEach(k => { const p = T.params.find(q => q.k === k); if (!p) errors.push('base ' + def.base + ' 没有参数 ' + k); else { const r = coerce(p, def.defaults[k]); if (!r.ok) errors.push(r.error); } }); }
    if (def.template) {
      if (def.template.length > 40) errors.push('template 最多 40 个元件');
      def.template.forEach((t, i) => { if (!PE.T[t.type]) errors.push('template[' + i + '].type 未知: ' + t.type); });
    }
    if (errors.length) return { ok: false, errors };
    const d = { id: def.id, zh: def.zh || def.id, en: def.en || def.zh || def.id, base: def.base || null, defaults: clone(def.defaults || {}), template: def.template ? clone(def.template) : null, icon: def.icon || null };
    if (lib) lib[d.id] = d; else PE.custom[d.id] = d;
    return { ok: true, id: d.id, def: d };
  };
  PE.customList = () => Object.keys(PE.custom).map(k => PE.custom[k]);
  PE.exportLibrary = () => JSON.stringify({ aibPhysLibrary: 1, types: PE.customList() }, null, 2);
  PE.importLibrary = function (text) {
    let j; try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { ok: false, errors: ['不是有效的 JSON'] }; }
    const list = Array.isArray(j) ? j : (j && j.types) || (j && j.id ? [j] : null); if (!list) return { ok: false, errors: ['找不到元件定义'] };
    const ok = [], errors = [];
    list.forEach(d => { const r = PE.defineCustom(d); if (r.ok) ok.push(d.id); else errors.push(d.id + ': ' + r.errors.join('；')); });
    return { ok: errors.length === 0 || ok.length > 0, imported: ok, errors };
  };
  function instantiateCustom(doc, cd, props) {
    const x0 = props.x == null ? 0 : props.x, y0 = props.y == null ? 0 : props.y;
    if (!cd.template) {
      const p = Object.assign({}, cd.defaults, props); const r = PE.add(doc, cd.base, p); if (r.ok) { const e = findEl(doc, r.id); e.from = cd.id; } return r;
    }
    const ids = [], errors = [], map = {}; const grp = uniqueId(doc, cd.id + '_');
    cd.template.forEach((t, i) => { map[t.id || ('#' + i)] = grp + '_' + (t.id || i); });
    cd.template.forEach((t, i) => {
      const sub = clone(t); const sid = map[t.id || ('#' + i)]; sub.id = sid; const tp = sub.type; delete sub.type;
      const T = PE.T[tp]; if (T.params.some(p => p.k === 'x')) { sub.x = (sub.x || 0) + x0; sub.y = (sub.y || 0) + y0; }
       T.params.filter(p => p.kind === 'ref').forEach(p => { if (sub[p.k] && map[sub[p.k]]) sub[p.k] = map[sub[p.k]]; });
      // world-anchored link ends are in template coordinates too
      if (T.anchorKeys) T.anchorKeys.forEach(([ik, xk, yk]) => { if (!sub[ik]) { if (sub[xk] != null) sub[xk] += x0; if (sub[yk] != null) sub[yk] += y0; } });
      const r = PE.add(doc, tp, sub, { noExpand: true }); if (r.ok) { ids.push(r.id); findEl(doc, r.id).from = cd.id; findEl(doc, r.id).group = grp; } else errors.push(...r.errors);
    });
    return errors.length ? { ok: false, errors } : { ok: true, id: ids[0], ids, group: grp };
  }
  // save the selected elements as a reusable type
  PE.saveSelectionAsType = function (doc, ids, meta) {
    const els = ids.map(id => findEl(doc, id)).filter(Boolean); if (!els.length) return { ok: false, errors: ['没有选中元件'] };
    meta = meta || {};
    if (els.length === 1 && !PE.T[els[0].type].dependent) {
      const e = els[0]; const T = PE.T[e.type]; const defs = {};
      T.params.forEach(p => { if (['x', 'y', 'label'].indexOf(p.k) < 0 && p.kind !== 'ref' && e[p.k] !== undefined) defs[p.k] = clone(e[p.k]); });
      return PE.defineCustom({ id: meta.id, zh: meta.zh, en: meta.en, base: e.type, defaults: defs });
    }
    const pos = els.filter(e => PE.T[e.type].params.some(p => p.k === 'x')); const np = Math.max(1, pos.length);
    const cx = pos.reduce((a, e) => a + (e.x || 0), 0) / np, cy = pos.reduce((a, e) => a + (e.y || 0), 0) / np;
    const idx = {}; els.forEach((e, i) => { idx[e.id] = 't' + i; });
    const template = els.map((e, i) => { const c = clone(e); const T = PE.T[e.type]; c.id = idx[e.id]; delete c.from; delete c.group; if (T.params.some(p => p.k === 'x')) { c.x = +((c.x || 0) - cx).toFixed(4); c.y = +((c.y || 0) - cy).toFixed(4); }
      T.params.filter(p => p.kind === 'ref').forEach(p => { if (c[p.k] && idx[c[p.k]]) c[p.k] = idx[c[p.k]]; else if (c[p.k]) c[p.k] = ''; });
      if (T.anchorKeys) T.anchorKeys.forEach(([ik, xk, yk]) => { if (!c[ik]) { c[xk] = +((c[xk] || 0) - cx).toFixed(4); c[yk] = +((c[yk] || 0) - cy).toFixed(4); } });
      return c; });
    return PE.defineCustom({ id: meta.id, zh: meta.zh, en: meta.en, template });
  };

  PE.listTypes = function (opts) {
    opts = opts || {};
    const mk = (T) => ({ id: T.id, zh: T.zh, en: T.en, category: T.cat, description: T.desc || '', params: T.params.map(p => { const o = { key: p.k, zh: p.zh, kind: p.kind, unit: p.unit || '', default: p.def }; if (p.min != null) o.min = p.min; if (p.max != null) o.max = p.max; if (p.opts) o.options = p.opts.map(x => typeof x === 'object' ? x.v : x); return o; }) });
    const out = PE.order.map(id => mk(PE.T[id]));
    PE.customList().forEach(c => out.push({ id: c.id, zh: c.zh, en: c.en, category: 'mine', custom: true, base: c.base, template: !!c.template, description: '自定义元件', params: c.base ? mk(PE.T[c.base]).params : [] }));
    return opts.category ? out.filter(t => t.category === opts.category) : out;
  };

  // ---------- validation ----------
  PE.validate = function (scene) {
    const errors = [], warnings = [];
    const ids = new Set();
    (scene.elements || []).forEach((el, i) => {
      const T = PE.T[el.type]; const tag = 'elements[' + i + '](' + (el.id || '?') + ')';
      if (!el.id) errors.push(tag + ': id required'); else if (ids.has(el.id)) errors.push(tag + ': duplicate id'); else ids.add(el.id);
      if (!T) { errors.push(tag + ': unknown type ' + el.type); return; }
      T.params.forEach(p => { if (el[p.k] === undefined) return; const r = coerce(p, el[p.k]); if (!r.ok) errors.push(tag + ': ' + r.error); });
    });
    (scene.elements || []).forEach((el, i) => {
      const T = PE.T[el.type]; if (!T) return;
      T.params.filter(p => p.kind === 'ref').forEach(p => { if (el[p.k] && !ids.has(el[p.k])) errors.push('elements[' + i + '](' + el.id + '): ' + p.k + ' 引用了不存在的元件 ' + el[p.k]); });
      if (T.check) T.check(el, scene, errors, warnings);
      if (el.mu != null && el.mu0 != null && el.mu > el.mu0) warnings.push(el.id + ': 动摩擦因数 μ 大于静摩擦因数 μ₀（μ 应 ≤ μ₀）');
    });
    return { errors, warnings };
  };
  PE.has = (s) => !!(s && Array.isArray(s.elements) && s.elements.length);

  // ---------- runtime ----------
  function isBodyEl(el) { const T = PE.T[el.type]; return T && T.kind === 'body'; }
  function pose(s, el) {
    const rt = s._el; const m = rt && rt.map[el.id];
    if (m && m.bodies && m.bodies[0]) { const b = m.bodies[0]; return { x: b.x, y: b.y, a: b.a }; }
    return { x: el.x || 0, y: el.y || 0, a: (el.angle || 0) * D2R };
  }
  PE.pose = pose;

  PE.init = function (s) {
    const rt = { world: new R.World({ gy: -(s.g == null ? 9.8 : s.g), sub: 4 }), map: {}, regions: [], rays: [], hits: {}, gates: {}, trails: {}, acc: {}, prevV: {}, sensors: [], readouts: [], pairs: [], warnings: [], optics: [], t0: 0, tracePts: {}, rails: {}, coils: {}, scales: {} };
    const w = rt.world; w.pairFn = (A, Bb) => { for (const p of rt.pairs) if ((p.a === A.eid && p.b === Bb.eid) || (p.a === Bb.eid && p.b === A.eid)) return p; return null; };
    Object.defineProperty(s, '_el', { value: rt, writable: true, enumerable: false, configurable: true });
    const els = s.elements || [];
    const ctx = {
      s, rt, world: w, gAcc: s.g == null ? 9.8 : s.g,
      body(el, spec) {
        spec.id = spec.id || el.id; spec.eid = el.id;
        const b = R.makeBody(spec); b.eid = el.id; b.surfOnly = !!spec.surfOnly;
        w.add(b); (rt.map[el.id] = rt.map[el.id] || { bodies: [], joints: [] }).bodies.push(b); return b;
      },
      joint(el, j) { w.addJoint(j); (rt.map[el.id] = rt.map[el.id] || { bodies: [], joints: [] }).joints.push(j); j.eid = el.id; return j; },
      hook(fn) { w.hooks.push(fn); },
      bodyOf(id) { const m = rt.map[id]; return m && m.bodies[0] || null; },
      el(id) { return els.find(e => e.id === id); }
    };
    rt.ctx = ctx;
    els.forEach(el => { const T = PE.T[el.type]; if (T && T.kind !== 'link' && T.build) { rt.map[el.id] = rt.map[el.id] || { bodies: [], joints: [] }; try { T.build(el, ctx); } catch (e) { rt.warnings.push(el.id + ': ' + e.message); } } });
    els.forEach(el => { const T = PE.T[el.type]; if (T && T.kind === 'link' && T.build) { rt.map[el.id] = rt.map[el.id] || { bodies: [], joints: [] }; try { T.build(el, ctx); } catch (e) { rt.warnings.push(el.id + ': ' + e.message); } } });
    // optics last (static)
    PE.traceOptics(s);
    return rt;
  };

  PE.step = function (s, n) {
    const rt = s._el; if (!rt) PE.init(s);
    const r = s._el, w = r.world; n = n == null ? 1 : n;
    for (let k = 0; k < n; k++) {
      // remember velocities for acceleration readouts
      w.bodies.forEach(b => { r.prevV[b.eid + '#' + b.uid] = [b.vx, b.vy, b.w]; });
      w.step(s.dt);
      s.t += s.dt; r.t = s.t;
      afterStep(s);
      w.bodies.forEach(b => { if (!b.fixed) { const pv = r.prevV[b.eid + '#' + b.uid]; if (pv) r.acc[b.eid] = { ax: (b.vx - pv[0]) / s.dt, ay: (b.vy - pv[1]) / s.dt }; } });
      if (k % 2 === 0) PE.record(s);
    }
    return s;
  };
  function afterStep(s) {
    const rt = s._el; const w = rt.world;
    // hits on screens (physical particles)
    (w.contacts || []).forEach(c => {
      [[c.A, c.B], [c.B, c.A]].forEach(([a, b]) => { const m = a.tag === 'screen' ? a : null; if (m && !b.fixed) { const arr = rt.hits[m.eid] = rt.hits[m.eid] || []; if (!arr.some(h => h.id === b.eid)) arr.push({ id: b.eid, x: c.pts[0].x, y: c.pts[0].y, t: s.t }); } });
    });
    rt.sensors.forEach(fn => fn(s, rt));
  }
  PE.record = function (s) {
    const rt = s._el; if (!rt) return;
    rt.world.bodies.forEach(b => {
      if (b.fixed) return; const el = (s.elements || []).find(e => e.id === b.eid); if (!el || el.trail === false) return;
      const tr = rt.trails[b.eid] = rt.trails[b.eid] || []; tr.push({ x: b.x, y: b.y }); if (tr.length > 600) tr.shift();
    });
    (s.plots || []).forEach(p => {
      if (!p.of || p.of.indexOf('el:') !== 0) return; const parts = p.of.split(':'); const q = PE.quantity(s, parts[1], parts[2]);
      if (!p.history) p.history = []; p.history.push({ t: s.t, v: q ? q.value : 0 }); if (p.history.length > 600) p.history.shift();
    });
  };

  // ---------- quantities (readouts, tools, plots) ----------
  PE.QTY = [
    { v: 'vx', zh: '速度 vₓ', unit: 'm/s' }, { v: 'vy', zh: '速度 v_y', unit: 'm/s' }, { v: 'speed', zh: '速率 v', unit: 'm/s' },
    { v: 'x', zh: '位置 x', unit: 'm' }, { v: 'y', zh: '位置 y', unit: 'm' }, { v: 'ax', zh: '加速度 aₓ', unit: 'm/s²' }, { v: 'ay', zh: '加速度 a_y', unit: 'm/s²' }, { v: 'a', zh: '加速度 a', unit: 'm/s²' },
    { v: 'ke', zh: '动能 Ek', unit: 'J' }, { v: 'pe', zh: '重力势能 Ep', unit: 'J' }, { v: 'px', zh: '动量 pₓ', unit: 'kg·m/s' }, { v: 'py', zh: '动量 p_y', unit: 'kg·m/s' },
    { v: 'omega', zh: '角速度 ω', unit: 'rad/s' }, { v: 'angle', zh: '转角 θ', unit: '°' }, { v: 'N', zh: '支持力 N', unit: 'N' }, { v: 'f', zh: '摩擦力 f', unit: 'N' },
    { v: 'T', zh: '拉力/弹力/张力', unit: 'N' }, { v: 'emf', zh: '感应电动势 ε', unit: 'V' }, { v: 'I', zh: '电流 I', unit: 'A' }, { v: 's', zh: '位移 s（导轨/传送带）', unit: 'm' }, { v: 'time', zh: '时间 t', unit: 's' }
  ];
  PE.quantity = function (s, id, q) {
    const rt = s._el; if (!rt) return null; const el = (s.elements || []).find(e => e.id === id); if (!el) return null;
    if (q === 'time') return { value: s.t, unit: 's' };
    const m = rt.map[id]; const b = m && m.bodies[0];
    const unit = (PE.QTY.find(z => z.v === q) || {}).unit || '';
    const T = PE.T[el.type];
    if (T && T.quantity) { const r = T.quantity(el, q, s, rt); if (r != null) return { value: r, unit }; }
    if (!b) return null;
    const g = s.g == null ? 9.8 : s.g;
    switch (q) {
      case 'vx': return { value: b.vx, unit }; case 'vy': return { value: b.vy, unit }; case 'speed': return { value: Math.hypot(b.vx, b.vy), unit };
      case 'x': return { value: b.x, unit }; case 'y': return { value: b.y, unit };
      case 'ax': return { value: (rt.acc[id] || {}).ax || 0, unit }; case 'ay': return { value: (rt.acc[id] || {}).ay || 0, unit };
      case 'a': { const a = rt.acc[id] || {}; return { value: Math.hypot(a.ax || 0, a.ay || 0), unit }; }
      case 'ke': return { value: 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + 0.5 * b.I * b.w * b.w, unit };
      case 'pe': return { value: b.m * g * (b.y - (s.world ? s.world.ymin : 0)) * b.gscale, unit };
      case 'px': return { value: b.m * b.vx, unit }; case 'py': return { value: b.m * b.vy, unit };
      case 'omega': return { value: b.w, unit }; case 'angle': return { value: b.a / D2R, unit };
      case 'N': case 'f': {
        let sum = 0; (rt.world.contacts || []).forEach(c => { if (c.A === b || c.B === b) sum += q === 'N' ? (c.N || 0) : Math.abs(c.F || 0); });
        return { value: sum / (s.dt / rt.world.sub), unit };
      }
    }
    return null;
  };

  // ---------- optics ----------
  const D = (a, b) => a.x * b.x + a.y * b.y;
  function segHit(o, d, a, b) { // ray o+t d vs segment a-b → {t,u} or null
    const ex = b.x - a.x, ey = b.y - a.y, den = d.x * ey - d.y * ex; if (Math.abs(den) < 1e-12) return null;
    const ox = a.x - o.x, oy = a.y - o.y; const t = (ox * ey - oy * ex) / den, u = (ox * d.y - oy * d.x) / den;
    if (t > 1e-7 && u >= -1e-9 && u <= 1 + 1e-9) return { t, u }; return null;
  }
  PE.traceOptics = function (s) {
    const rt = s._el; rt.rays = []; const objs = [], srcs = [], screens = [];
    rt.optics.forEach(o => { if (o.kind === 'source') srcs.push(o); else if (o.kind === 'screen') screens.push(o); else objs.push(o); });
    rt.screenHits = {};
    srcs.forEach(src => {
      src.rays.forEach(r0 => {
        let o = { x: r0.x, y: r0.y }, d = { x: Math.cos(r0.a), y: Math.sin(r0.a) }; const pts = [{ x: o.x, y: o.y }]; let nmed = 1; const ci = r0.ci == null ? 3 : r0.ci;
        let inPoly = null;
        for (let k = 0; k < 60; k++) {
          let best = null;
          const consider = (h, obj, extra) => { if (h && (!best || h.t < best.t)) best = Object.assign({ obj }, h, extra || {}); };
          objs.forEach(ob => {
            if (ob.kind === 'mirror') consider(segHit(o, d, ob.a, ob.b), ob);
            else if (ob.kind === 'lens') consider(segHit(o, d, ob.a, ob.b), ob);
            else if (ob.kind === 'poly') for (let i = 0; i < ob.v.length; i++) consider(segHit(o, d, ob.v[i], ob.v[(i + 1) % ob.v.length]), ob, { edge: i });
            else if (ob.kind === 'block') consider(segHit(o, d, ob.a, ob.b), ob);
          });
          screens.forEach(sc => consider(segHit(o, d, sc.a, sc.b), sc));
          if (!best) { pts.push({ x: o.x + d.x * 40, y: o.y + d.y * 40 }); break; }
          const P = { x: o.x + d.x * best.t, y: o.y + d.y * best.t }; pts.push(P); o = P;
          const ob = best.obj;
          if (ob.kind === 'screen') { (rt.screenHits[ob.id] = rt.screenHits[ob.id] || []).push({ u: best.u, x: P.x, y: P.y }); break; }
          if (ob.kind === 'block') break;
          if (ob.kind === 'mirror') { const e = { x: ob.b.x - ob.a.x, y: ob.b.y - ob.a.y }; const L = Math.hypot(e.x, e.y) || 1; const n = { x: -e.y / L, y: e.x / L }; const dn = D(d, n); d = { x: d.x - 2 * dn * n.x, y: d.y - 2 * dn * n.y }; o = { x: P.x + d.x * 1e-6, y: P.y + d.y * 1e-6 }; continue; }
          if (ob.kind === 'lens') {
            const ax = ob.axis, px = { x: -ax.y, y: ax.x }; const sg = D(d, ax) >= 0 ? 1 : -1; const a2 = { x: ax.x * sg, y: ax.y * sg }, p2 = { x: px.x * sg, y: px.y * sg };
            const hh = (P.x - ob.c.x) * p2.x + (P.y - ob.c.y) * p2.y; const tn = D(d, p2) / Math.max(1e-9, D(d, a2)) - hh / ob.f;
            const L = Math.hypot(1, tn); d = { x: (a2.x + tn * p2.x) / L, y: (a2.y + tn * p2.y) / L }; o = { x: P.x + d.x * 1e-6, y: P.y + d.y * 1e-6 }; continue;
          }
          if (ob.kind === 'poly') {
            const a = ob.v[best.edge], b = ob.v[(best.edge + 1) % ob.v.length]; const e = { x: b.x - a.x, y: b.y - a.y }; const L = Math.hypot(e.x, e.y) || 1; const Nout = { x: e.y / L, y: -e.x / L };
            const entering = D(d, Nout) < 0; const Nf = entering ? Nout : { x: -Nout.x, y: -Nout.y };
            const n2 = ob.n + (ob.disp || 0) * (ci / 6 - 0.5); const n1 = entering ? 1 : n2, n2e = entering ? n2 : 1; const eta = n1 / n2e;
            const cosi = -D(d, Nf); const kk = 1 - eta * eta * (1 - cosi * cosi);
            if (kk < 0) { const dn = D(d, Nf); d = { x: d.x - 2 * dn * Nf.x, y: d.y - 2 * dn * Nf.y }; }
            else { const c2 = Math.sqrt(kk); d = { x: eta * d.x + (eta * cosi - c2) * Nf.x, y: eta * d.y + (eta * cosi - c2) * Nf.y }; }
            const Ld = Math.hypot(d.x, d.y) || 1; d = { x: d.x / Ld, y: d.y / Ld }; o = { x: P.x + d.x * 1e-6, y: P.y + d.y * 1e-6 };
          }
        }
        rt.rays.push({ pts, color: r0.color || src.color, w: src.width });
      });
    });
  };

  // ---------- derived / vectors for the panel ----------
  PE.derived = function (s) {
    const out = {}; const rt = s._el; if (!rt) return out; const g = s.g == null ? 9.8 : s.g;
    let ke = 0, pe = 0, px = 0, py = 0, n = 0;
    rt.world.bodies.forEach(b => { if (b.fixed) return; n++; ke += 0.5 * b.m * (b.vx * b.vx + b.vy * b.vy) + 0.5 * b.I * b.w * b.w; pe += b.m * g * b.gscale * (b.y - (s.world ? s.world.ymin : 0)); px += b.m * b.vx; py += b.m * b.vy; });
    if (n) Object.assign(out, { 'kinetic energy Ek (J)': ke, 'gravitational PE Ep (J)': pe, 'momentum px (kg·m/s)': px, 'momentum py (kg·m/s)': py, 'g (m/s²)': g });
    (s.elements || []).forEach(el => {
      const T = PE.T[el.type]; if (T && T.readout) { const r = T.readout(el, s, rt); if (r) Object.keys(r).forEach(k => { out[(el.label || el.id) + ' ' + k] = r[k]; }); }
    });
    return out;
  };

  PE.fromLegacy = function (scene) {
    const d = ensureDoc(clone(scene)); if (d.elements.length) return d;
    d.bodies.forEach(b => { const r = PE.add(d, 'ball', { id: b.id, x: b.x, y: b.y, vx: b.vx || 0, vy: b.vy || 0, mass: b.mass || 1, r: b.radius || 0.25, q: b.q || 0, color: /^#/.test(b.color || '') ? b.color : '#3d9b6e', label: b.label && b.label !== b.id ? b.label : '', fixed: !!b.fixed, e: b.e == null ? 0.5 : b.e, mu: b.mu != null ? b.mu : 0.4, mu0: b.mu0 != null ? b.mu0 : (b.mu != null ? b.mu : 0.5) }); });
    d.bodies = [];
    (d.walls || []).forEach(w => {
      const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1) || 0.1; const a = Math.atan2(w.y2 - w.y1, w.x2 - w.x1) / D2R;
      const cx = (w.x1 + w.x2) / 2, cy = (w.y1 + w.y2) / 2; const t = 0.1; const nx = -Math.sin(a * D2R), ny = Math.cos(a * D2R);
      PE.add(d, 'wallSeg', { x: cx - nx * t / 2, y: cy - ny * t / 2, angle: a, len: L, thick: t, mu: w.mu != null ? w.mu : (w.friction || 0), mu0: w.mu0 != null ? w.mu0 : (w.mu != null ? w.mu : (w.friction || 0)), e: w.bounce == null ? 0.5 : w.bounce });
    });
    delete d.walls;
    (d.springs || []).forEach(sp => { PE.add(d, 'spring', { a: sp.a, b: sp.b, k: sp.k == null ? 20 : sp.k, rest: sp.rest == null ? 1 : sp.rest, damping: sp.damping || 0 }); });
    delete d.springs;
    (d.fields || []).forEach(f => {
      const wd = d.world; const w = wd.xmax - wd.xmin, h = wd.ymax - wd.ymin; const base = { x: (wd.xmin + wd.xmax) / 2, y: (wd.ymin + wd.ymax) / 2, w, h };
      if (f.type === 'E') { const E = root.PhysSim.fieldE(f); PE.add(d, 'fieldE', Object.assign({ E: Math.hypot(E.x, E.y), dir: Math.atan2(E.y, E.x) / D2R }, base)); }
      if (f.type === 'B') { const Bz = root.PhysSim.fieldB(f); PE.add(d, 'fieldB', Object.assign({ B: Math.abs(Bz), into: Bz < 0 }, base)); }
    });
    delete d.fields;
    return d;
  };
  PE.hasLegacyContent = (scene) => !!((scene.bodies && scene.bodies.length) || (scene.walls && scene.walls.length) || (scene.springs && scene.springs.length) || (scene.fields && scene.fields.length));

  root.PhysElements = PE;
  if (typeof module !== 'undefined') module.exports = PE;
})(typeof window !== 'undefined' ? window : globalThis);
