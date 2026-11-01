// PhysEditor — the v3.4.0 scene editor UI: palette (drag or tap to add), canvas selection / move / rotate /
// resize handles, multi-select, snapping, undo/redo, inspector for every parameter, "我的元件" library.
// Pure DOM + canvas, no dependencies. The host page (panel.html) provides the canvas, containers and
// the commit() callback that validates and rebuilds the runtime scene from the document.
(function (root) {
  'use strict';
  const PE = root.PhysElements; const D2R = Math.PI / 180; const LIB_KEY = 'aib.phys.library.v1';
  const LANG = (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')) ? 'zh' : 'en';
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const GRP = { pos: ['位置', 'Position'], geom: ['几何', 'Geometry'], phys: ['物理', 'Physics'], init: ['初始状态', 'Initial state'], ends: ['端点', 'Ends'], look: ['外观', 'Look'], other: ['其他', 'Other'] };
  const GRP_ORDER = ['pos', 'geom', 'phys', 'init', 'ends', 'look', 'other'];
  const tName = (T) => (LANG === 'zh' ? T.zh : (T.en || T.zh));

  function create(host) {
    const cv = host.cv; const S = { sel: [], tool: 'select', snap: true, grid: 0.1, angSnap: 5, multi: false, view: { cx: 0, cy: 0, s: 40 }, undo: [], redo: [], clip: null };
    const ptrs = new Map(); let drag = null; let spaceDown = false; let lastLive = ''; let insEls = {}; let dirtyInspector = true;
    const doc = () => host.getDoc(); const scene = () => host.getScene();
    const byId = (id) => (doc().elements || []).find((e) => e.id === id);
    const T = (el) => PE.T[el.type];
    const hasP = (el, k) => !!(T(el) && T(el).params.some((p) => p.k === k));

    // ---------- library (我的元件) persistence ----------
    function loadLib() { try { const j = JSON.parse(localStorage.getItem(LIB_KEY) || 'null'); if (j && j.types) PE.importLibrary(j); } catch (e) { /* storage unavailable */ } }
    function saveLib() { try { localStorage.setItem(LIB_KEY, PE.exportLibrary()); } catch (e) { /* ignore */ } }

    // ---------- view ----------
    const V = { x: (wx) => (wx - S.view.cx) * S.view.s + cv.clientWidth / 2, y: (wy) => (S.view.cy - wy) * S.view.s + cv.clientHeight / 2, get s() { return S.view.s; },
      inv: (px, py) => ({ x: (px - cv.clientWidth / 2) / S.view.s + S.view.cx, y: S.view.cy - (py - cv.clientHeight / 2) / S.view.s }) };
    function fit() {
      const w = (scene() || doc()).world || { xmin: -5, xmax: 5, ymin: -1, ymax: 6 }; const W = cv.clientWidth || 600, H = cv.clientHeight || 400;
      S.view.s = Math.max(4, Math.min((W - 24) / (w.xmax - w.xmin), (H - 24) / (w.ymax - w.ymin))); S.view.cx = (w.xmin + w.xmax) / 2; S.view.cy = (w.ymin + w.ymax) / 2; host.requestDraw();
    }
    function zoomAt(px, py, k) { const before = V.inv(px, py); S.view.s = Math.max(2, Math.min(600, S.view.s * k)); const after = V.inv(px, py); S.view.cx += before.x - after.x; S.view.cy += before.y - after.y; host.requestDraw(); }
    const snapV = (v) => (S.snap ? Math.round(v / S.grid) * S.grid : v);
    const snapA = (deg) => (S.snap && S.angSnap > 0 ? Math.round(deg / S.angSnap) * S.angSnap : deg);

    // ---------- undo / redo (snapshots of the document) ----------
    const snapshot = () => JSON.stringify({ elements: doc().elements, world: doc().world, g: doc().g });
    function pushUndo() { const s = snapshot(); if (S.undo.length && S.undo[S.undo.length - 1] === s) return; S.undo.push(s); if (S.undo.length > 120) S.undo.shift(); S.redo.length = 0; updateBar(); }
    function restore(s) { const j = JSON.parse(s); const d = doc(); d.elements = j.elements; if (j.world) d.world = j.world; if (j.g != null) d.g = j.g; S.sel = S.sel.filter((id) => byId(id)); commit({ rebuildInspector: true }); }
    function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); updateBar(); }
    function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); updateBar(); }
    function commit(o) { o = o || {}; const ok = host.commit(o.live || null); if (o.rebuildInspector || dirtyInspector) buildInspector(); else refreshInspectorValues(); updateBar(); return ok; }

    // ---------- document operations ----------
    function centerPos() { const p = V.inv(cv.clientWidth / 2, cv.clientHeight / 2); return { x: snapV(p.x), y: snapV(p.y) }; }
    function addAt(type, x, y, extra) {
      host.prepareEdit(); pushUndo(); const d = doc(); const Tt = PE.T[type]; const cd = PE.custom[type];
      const props = Object.assign({}, extra || {}); const hasXY = cd ? true : (Tt && Tt.params.some((p) => p.k === 'x'));
      if (hasXY) { props.x = r4(snapV(x)); props.y = r4(snapV(y)); }
      if (Tt && Tt.kind === 'link') { // connect the selected bodies, or drop two world points around the cursor
        const bodies = S.sel.map(byId).filter((e) => e && PE.T[e.type].kind === 'body');
        if (bodies.length >= 2) Object.assign(props, { a: bodies[0].id, ax: 0, ay: 0, b: bodies[1].id, bx: 0, by: 0 });
        else if (bodies.length === 1) Object.assign(props, { a: bodies[0].id, ax: 0, ay: 0, b: '', bx: r4(bodies[0].x + 1.2), by: r4(bodies[0].y) });
        else Object.assign(props, { a: '', ax: r4(x - 0.6), ay: r4(y), b: '', bx: r4(x + 0.6), by: r4(y) });
        delete props.x; delete props.y;
      }
      if (Tt && Tt.kind === 'sensor' && Tt.params.some((p) => p.k === 'target') && S.sel.length) props.target = S.sel[0];
      const r = PE.add(d, type, props);
      if (!r.ok) { S.undo.pop(); host.toast(r.errors.join('；')); return r; }
      S.sel = r.ids.slice(); dirtyInspector = true; commit({ rebuildInspector: true }); return r;
    }
    function removeSel() { if (!S.sel.length) return; host.prepareEdit(); pushUndo(); S.sel.slice().forEach((id) => { if (byId(id)) PE.remove(doc(), id); }); S.sel = []; commit({ rebuildInspector: true }); }
    function duplicateSel() {
      if (!S.sel.length) return; host.prepareEdit(); pushUndo(); const r = PE.duplicate(doc(), S.sel, 0.5, 0.5); S.sel = r.ids; commit({ rebuildInspector: true });
    }
    function setProps(id, patch, opt) {
      const el = byId(id); if (!el) return { ok: false, errors: ['no element ' + id] };
      const r = PE.update(doc(), id, patch); if (!r.ok) return r; commit({ live: opt && opt.live === false ? null : { id, patch: r.applied } }); return r;
    }

    // ---------- geometry helpers for interaction (all in document coordinates) ----------
    function poseOf(el) { return { x: el.x || 0, y: el.y || 0, a: (el.angle || 0) * D2R }; }
    function overlayPose(el) { const s = scene(); return s && s._el ? PE.pose(s, el) : poseOf(el); }
    const isLink = (el) => T(el) && T(el).kind === 'link';
    const canRotate = (el) => { const t = T(el); return t && t.kind !== 'link' && t.free !== false && hasP(el, 'angle') && !t.localExtentWorld && !el.fixed_noRotate; };
    function handlesFor(el) {
      const t = T(el); if (!t) return []; const hs = [];
      if (isLink(el)) {
        const m = scene() && scene()._el && scene()._el.map[el.id]; const ends = m && m.ends && m.ends(); if (!ends) return hs;
        if (t.anchorKeys) t.anchorKeys.forEach((ak, i) => { const pt = i === 0 ? ends[0] : ends[ends.length - 1]; hs.push({ kind: 'end', which: ak, x: pt.x, y: pt.y }); });
        return hs;
      }
      const p = overlayPose(el); const e = PE.extentOf(el);
      if (canRotate(el)) { const q = rot(0, e[3] + 26 / S.view.s, p.a); hs.push({ kind: 'rotate', x: p.x + q.x, y: p.y + q.y, ax: p.x + rot(0, e[3], p.a).x, ay: p.y + rot(0, e[3], p.a).y }); }
      if (t.resize) { const q = t.localExtentWorld ? { x: e[2], y: e[3] } : rot(e[2], e[3], p.a); hs.push({ kind: 'resize', x: p.x + q.x, y: p.y + q.y }); }
      return hs;
    }
    function groupCenter(ids) { let sx = 0, sy = 0, n = 0; ids.forEach((id) => { const e = byId(id); if (e && hasP(e, 'x')) { sx += e.x; sy += e.y; n++; } }); return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 }; }
    function hitHandle(px, py) {
      const r = (matchMedia('(pointer:coarse)').matches ? 18 : 9);
      for (const id of S.sel) { const el = byId(id); if (!el) continue; const pc = overlayPose(el); const dc = Math.hypot(V.x(pc.x) - px, V.y(pc.y) - py); for (const hd of handlesFor(el)) { const d = Math.hypot(V.x(hd.x) - px, V.y(hd.y) - py); if (d <= r && (hd.kind === 'end' || d < dc)) return Object.assign({ id }, hd); } }
      return null;
    }

    // ---------- pointer interaction ----------
    function localPt(ev) { const r = cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    function onDown(ev) {
      if (!host.active()) return; cv.setPointerCapture && cv.setPointerCapture(ev.pointerId); const p = localPt(ev); ptrs.set(ev.pointerId, { x: p.x, y: p.y, ox: p.x, oy: p.y });
      if (ptrs.size === 2) { const a = [...ptrs.values()]; drag = { kind: 'pinch', d0: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), s0: S.view.s, mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2, cx: S.view.cx, cy: S.view.cy }; return; }
      if (ptrs.size > 2) return;
      const touch = ev.pointerType === 'touch' || ev.pointerType === 'pen'; const w = V.inv(p.x, p.y); const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey || S.multi;
      if (ev.button === 1 || ev.button === 2 || spaceDown || S.tool === 'hand') { drag = { kind: 'pan', cx: S.view.cx, cy: S.view.cy, px: p.x, py: p.y }; return; }
      const hd = hitHandle(p.x, p.y);
      if (hd) { host.prepareEdit(); pushUndo(); drag = { kind: hd.kind, h: hd, id: hd.id, start: w, snap0: JSON.stringify(doc().elements.filter((e) => S.sel.indexOf(e.id) >= 0)), c0: groupCenter(S.sel), moved: false }; if (hd.kind === 'rotate') { const el = byId(hd.id); drag.a0 = Math.atan2(w.y - overlayPose(el).y, w.x - overlayPose(el).x); drag.angles = S.sel.map((id) => { const e = byId(id); return { id, a: e ? e.angle || 0 : 0, x: e ? e.x : 0, y: e ? e.y : 0 }; }); } return; }
      if (scene() && scene().t > 0) host.prepareEdit();
      const hit = PE.hitTest(scene(), w.x, w.y, 8 / S.view.s);
      if (hit) {
        const id = hit.id;
        if (additive) { const i = S.sel.indexOf(id); if (i >= 0) S.sel.splice(i, 1); else S.sel.push(id); dirtyInspector = true; buildInspector(); if (host.selectionFromCanvas) host.selectionFromCanvas(S.sel.slice()); host.requestDraw(); drag = { kind: 'none' }; return; }
        if (S.sel.indexOf(id) < 0) { S.sel = [id]; dirtyInspector = true; buildInspector(); }
        if (host.selectionFromCanvas) host.selectionFromCanvas(S.sel.slice());
        host.prepareEdit(); pushUndo();
        drag = { kind: 'move', start: w, orig: S.sel.map((sid) => { const e = byId(sid); return { id: sid, x: e && e.x, y: e && e.y, ax: e && e.ax, ay: e && e.ay, bx: e && e.bx, by: e && e.by, a: e && e.a, b: e && e.b }; }), moved: false, t0: performance.now() };
        host.requestDraw(); return;
      }
      if (touch && !additive) { drag = { kind: 'pan', cx: S.view.cx, cy: S.view.cy, px: p.x, py: p.y, tapClear: true, moved: false }; return; }
      drag = { kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive };
      if (!additive) { S.sel = []; dirtyInspector = true; buildInspector(); }
      host.requestDraw();
    }
    function onMove(ev) {
      const p = localPt(ev); const rec = ptrs.get(ev.pointerId);
      if (!rec) { hoverCursor(p); return; } rec.x = p.x; rec.y = p.y;
      if (!drag) return;
      if (drag.kind === 'pinch' && ptrs.size >= 2) { const a = [...ptrs.values()]; const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1; const mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2; S.view.s = Math.max(2, Math.min(600, drag.s0 * d / drag.d0)); S.view.cx = drag.cx - (mx - drag.mx) / S.view.s; S.view.cy = drag.cy + (my - drag.my) / S.view.s; host.requestDraw(); return; }
      if (drag.kind === 'pan') { if (Math.hypot(p.x - drag.px, p.y - drag.py) > 4) drag.moved = true; S.view.cx = drag.cx - (p.x - drag.px) / S.view.s; S.view.cy = drag.cy + (p.y - drag.py) / S.view.s; host.requestDraw(); return; }
      const w = V.inv(p.x, p.y);
      if (drag.kind === 'marquee') { drag.x1 = p.x; drag.y1 = p.y; host.requestDraw(); return; }
      if (drag.kind === 'move') {
        const dx0 = w.x - drag.start.x, dy0 = w.y - drag.start.y; if (!drag.moved && Math.hypot(dx0, dy0) * S.view.s < 3) return; drag.moved = true;
        const first = drag.orig.find((o) => o.x != null); let dx = dx0, dy = dy0;
        if (first && !ev.altKey) { dx = snapV(first.x + dx0) - first.x; dy = snapV(first.y + dy0) - first.y; }
        drag.orig.forEach((o) => { const e = byId(o.id); if (!e) return; if (o.x != null && hasP(e, 'x')) { e.x = r4(o.x + dx); e.y = r4(o.y + dy); } else if (isLink(e)) { if (!o.a && o.ax != null) { e.ax = r4(o.ax + dx); e.ay = r4(o.ay + dy); } if (!o.b && o.bx != null) { e.bx = r4(o.bx + dx); e.by = r4(o.by + dy); } } });
        commit(); return;
      }
      if (drag.kind === 'rotate') {
        const el = byId(drag.id); if (!el) return; const c = drag.angles.length > 1 ? drag.c0 : { x: drag.angles[0].x, y: drag.angles[0].y }; const a1 = Math.atan2(w.y - c.y, w.x - c.x); let da = (a1 - drag.a0) / D2R;
        const base = drag.angles.find((o) => o.id === drag.id).a; da = snapA(base + da) - base; if (ev.altKey) da = (a1 - drag.a0) / D2R;
        drag.angles.forEach((o) => { const e = byId(o.id); if (!e) return; let a = o.a + da; a = ((a + 180) % 360 + 360) % 360 - 180; e.angle = r4(a); if (drag.angles.length > 1 && hasP(e, 'x')) { const q = rot(o.x - c.x, o.y - c.y, da * D2R); e.x = r4(c.x + q.x); e.y = r4(c.y + q.y); } });
        commit(); return;
      }
      if (drag.kind === 'resize') {
        const el = byId(drag.id); if (!el) return; const t = T(el); const pz = poseOf(el); const l = t.localExtentWorld ? { x: w.x - pz.x, y: w.y - pz.y } : rot(w.x - pz.x, w.y - pz.y, -pz.a);
        const g = S.snap ? S.grid / 2 : 0; try { t.resize(el, g ? Math.round(l.x / g) * g : l.x, g ? Math.round(l.y / g) * g : l.y); } catch (e) { return; } drag.moved = true; commit({ rebuildInspector: false }); return;
      }
      if (drag.kind === 'end') {
        const el = byId(drag.id); if (!el) return; const ak = drag.h.which; const [ik, xk, yk] = ak; const tgt = bodyUnder(w, el.id);
        drag.over = tgt ? tgt.id : null;
        if (el[ik]) { const b = byId(el[ik]); if (b) { const q = rot(w.x - (b.x || 0), w.y - (b.y || 0), -((b.angle || 0) * D2R)); el[xk] = r4(q.x); el[yk] = r4(q.y); } }
        else { el[xk] = r4(snapV(w.x)); el[yk] = r4(snapV(w.y)); }
        drag.moved = true; commit({ rebuildInspector: false }); return;
      }
    }
    function bodyUnder(w, exceptId) { const s = scene(); const list = (doc().elements || []).filter((e) => e.id !== exceptId && T(e) && T(e).kind === 'body').reverse(); for (const e of list) if (PE.hit(s, e, w.x, w.y, 0.02)) return e; return null; }
    function onUp(ev) {
      ptrs.delete(ev.pointerId); if (!drag) return; const d = drag;
      if (d.kind === 'pinch') { if (ptrs.size < 2) drag = null; return; }
      if (d.kind === 'marquee') {
        const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        if (x1 - x0 > 4 || y1 - y0 > 4) { const a = V.inv(x0, y1), b = V.inv(x1, y0); const ids = (doc().elements || []).filter((e) => { const t = T(e); if (!t || t.kind === 'virtual') return false; const bb = PE.bboxWorld(scene(), e); return bb && bb[0] >= a.x && bb[2] <= b.x && bb[1] >= a.y && bb[3] <= b.y; }).map((e) => e.id); S.sel = d.additive ? [...new Set(S.sel.concat(ids))] : ids; }
        dirtyInspector = true; buildInspector();
      }
      if (d.kind === 'pan' && d.tapClear && !d.moved) { S.sel = []; dirtyInspector = true; buildInspector(); }
      if (d.kind === 'end') { const el = byId(d.id); if (el && d.moved) { const [ik, xk, yk] = d.h.which; if (d.over && el[ik] !== d.over) { const b = byId(d.over); const w = V.inv(localPt(ev).x, localPt(ev).y); const q = rot(w.x - b.x, w.y - b.y, -((b.angle || 0) * D2R)); el[ik] = d.over; el[xk] = r4(q.x); el[yk] = r4(q.y); } else if (!d.over && el[ik]) { const pt = scene()._el.map[el.id].ends(); const i = d.h.which === T(el).anchorKeys[0] ? 0 : pt.length - 1; el[ik] = ''; el[xk] = r4(pt[i].x); el[yk] = r4(pt[i].y); } dirtyInspector = true; commit({ rebuildInspector: true }); } }
      if ((d.kind === 'move' && !d.moved) || ((d.kind === 'rotate' || d.kind === 'resize') && !d.moved && d.kind === 'resize')) { if (S.undo.length) S.undo.pop(); updateBar(); }
      drag = null; host.requestDraw();
    }
    function hoverCursor(p) { if (!host.active()) return; const hd = hitHandle(p.x, p.y); const w = V.inv(p.x, p.y); const hit = !hd && scene() && PE.hitTest(scene(), w.x, w.y, 8 / S.view.s); cv.style.cursor = S.tool === 'hand' ? 'grab' : hd ? (hd.kind === 'rotate' ? 'alias' : 'nwse-resize') : hit ? 'move' : 'default'; }
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('contextmenu', (e) => { if (host.active()) e.preventDefault(); });
    cv.addEventListener('wheel', (ev) => { if (!host.active()) return; ev.preventDefault(); const p = localPt(ev); zoomAt(p.x, p.y, Math.exp(-ev.deltaY * 0.0015)); }, { passive: false });
    cv.style.touchAction = 'none';
    document.addEventListener('keydown', (ev) => {
      if (!host.active()) return; const tag = (ev.target && ev.target.tagName) || ''; if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      const mod = ev.ctrlKey || ev.metaKey; const k = ev.key.toLowerCase();
      if (ev.key === ' ') { spaceDown = true; ev.preventDefault(); return; }
      if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
      else if (mod && k === 'y') { ev.preventDefault(); redo(); }
      else if (mod && k === 'd') { ev.preventDefault(); duplicateSel(); }
      else if (mod && k === 'a') { ev.preventDefault(); S.sel = (doc().elements || []).filter((e) => T(e) && T(e).kind !== 'virtual').map((e) => e.id); dirtyInspector = true; buildInspector(); host.requestDraw(); }
      else if (mod && k === 'c') { S.clip = JSON.stringify(S.sel.map(byId).filter(Boolean)); }
      else if (mod && k === 'v' && S.clip) { ev.preventDefault(); pasteClip(); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeSel(); }
      else if (ev.key === 'Escape') { S.sel = []; dirtyInspector = true; buildInspector(); host.requestDraw(); }
      else if (/^Arrow/.test(ev.key) && S.sel.length) { ev.preventDefault(); const st = ev.shiftKey ? S.grid * 5 : S.grid; host.prepareEdit(); pushUndo(); S.sel.forEach((id) => { const e = byId(id); if (e && hasP(e, 'x')) { e.x = r4(e.x + (ev.key === 'ArrowRight' ? st : ev.key === 'ArrowLeft' ? -st : 0)); e.y = r4(e.y + (ev.key === 'ArrowUp' ? st : ev.key === 'ArrowDown' ? -st : 0)); } }); commit(); }
      else if (k === 'v') setTool('select'); else if (k === 'h') setTool('hand');
    });
    document.addEventListener('keyup', (ev) => { if (ev.key === ' ') spaceDown = false; });
    function pasteClip() { try { const list = JSON.parse(S.clip); host.prepareEdit(); pushUndo(); const map = {}; const ids = []; list.forEach((e) => { const nid = (function () { let n = 1; const used = new Set(doc().elements.map((q) => q.id)); while (used.has(e.type + n)) n++; return e.type + n; })(); map[e.id] = nid; const c = JSON.parse(JSON.stringify(e)); c.id = nid; if (c.x != null) { c.x = r4(c.x + 0.5); c.y = r4(c.y + 0.5); } doc().elements.push(c); ids.push(nid); }); ids.forEach((id) => { const e = byId(id); T(e).params.filter((p) => p.kind === 'ref').forEach((p) => { if (map[e[p.k]]) e[p.k] = map[e[p.k]]; }); }); S.sel = ids; commit({ rebuildInspector: true }); } catch (e) { /* ignore */ } }
    function setTool(t) { S.tool = t; updateBar(); }

    // ---------- overlay drawn on top of the scene ----------
    function drawOverlay(c) {
      const s = scene(); if (!s) return; c.save();
      S.sel.forEach((id) => {
        const el = byId(id); if (!el) return; const t = T(el); if (!t) return;
        c.strokeStyle = '#7ee2b8'; c.fillStyle = '#7ee2b8'; c.lineWidth = 1.4; c.setLineDash([5, 3]);
        if (isLink(el)) { const m = s._el && s._el.map[el.id]; const ends = m && m.ends && m.ends(); if (ends) { c.beginPath(); ends.forEach((q, i) => (i ? c.lineTo(V.x(q.x), V.y(q.y)) : c.moveTo(V.x(q.x), V.y(q.y)))); c.stroke(); } }
        else { const p = overlayPose(el); const e = PE.extentOf(el); const pts = t.localExtentWorld ? [[e[0], e[1]], [e[2], e[1]], [e[2], e[3]], [e[0], e[3]]].map((q) => ({ x: p.x + q[0], y: p.y + q[1] })) : [[e[0], e[1]], [e[2], e[1]], [e[2], e[3]], [e[0], e[3]]].map((q) => { const r = rot(q[0], q[1], p.a); return { x: p.x + r.x, y: p.y + r.y }; });
          c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(V.x(q.x), V.y(q.y)) : c.moveTo(V.x(q.x), V.y(q.y)))); c.closePath(); c.stroke(); }
        c.setLineDash([]);
        handlesFor(el).forEach((hd) => {
          const x = V.x(hd.x), y = V.y(hd.y); const R = matchMedia('(pointer:coarse)').matches ? 9 : 5.5; c.lineWidth = 1.5;
          if (hd.kind === 'rotate') { c.beginPath(); c.moveTo(V.x(hd.ax), V.y(hd.ay)); c.lineTo(x, y); c.stroke(); c.fillStyle = '#0b1416'; c.beginPath(); c.arc(x, y, R, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.arc(x, y, R * 0.45, 0.3, 4.4); c.stroke(); }
          else if (hd.kind === 'resize') { c.fillStyle = '#7ee2b8'; c.fillRect(x - R, y - R, R * 2, R * 2); }
          else { c.fillStyle = '#0b1416'; c.beginPath(); c.arc(x, y, R, 0, 7); c.fill(); c.stroke(); }
        });
      });
      if (drag && drag.kind === 'end' && drag.over) { const b = byId(drag.over); if (b) { const p = overlayPose(b); c.strokeStyle = '#fbbf24'; c.lineWidth = 2; c.beginPath(); c.arc(V.x(p.x), V.y(p.y), 14, 0, 7); c.stroke(); } }
      if (drag && drag.kind === 'marquee') { c.strokeStyle = '#7ee2b8'; c.fillStyle = 'rgba(126,226,184,.08)'; c.lineWidth = 1; c.setLineDash([4, 3]); const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), hh = Math.abs(drag.y1 - drag.y0); c.fillRect(x, y, w, hh); c.strokeRect(x, y, w, hh); }
      c.restore();
    }
    function drawGrid(c, w) {
      const W = cv.clientWidth, H = cv.clientHeight; c.save(); c.lineWidth = 1; const step = S.view.s >= 60 ? 0.5 : S.view.s >= 22 ? 1 : S.view.s >= 9 ? 5 : 10; const tl = V.inv(0, 0), br = V.inv(W, H);
      for (let gx = Math.ceil(tl.x / step) * step; gx <= br.x; gx += step) { c.strokeStyle = Math.abs(gx) < 1e-9 ? '#2f6b53' : (Math.abs(gx / (step * 2) - Math.round(gx / (step * 2))) < 1e-6 ? '#1e2c30' : '#16232a'); c.beginPath(); c.moveTo(V.x(gx), 0); c.lineTo(V.x(gx), H); c.stroke(); }
      for (let gy = Math.ceil(br.y / step) * step; gy <= tl.y; gy += step) { c.strokeStyle = Math.abs(gy) < 1e-9 ? '#2f6b53' : '#16232a'; c.beginPath(); c.moveTo(0, V.y(gy)); c.lineTo(W, V.y(gy)); c.stroke(); }
      c.strokeStyle = '#2a4a40'; c.setLineDash([6, 4]); c.strokeRect(V.x(w.xmin), V.y(w.ymax), (w.xmax - w.xmin) * S.view.s, (w.ymax - w.ymin) * S.view.s); c.setLineDash([]);
      c.fillStyle = '#4c6a5f'; c.font = '10px sans-serif'; for (let gx = Math.ceil(tl.x / step) * step; gx <= br.x; gx += step * 2) if (Math.abs(gx) > 1e-9) c.fillText(String(+gx.toFixed(2)), V.x(gx) + 2, H - 4);
      c.restore();
    }

    // ---------- palette ----------
    const thumbs = {};
    function thumb(type) {
      if (thumbs[type]) return thumbs[type]; let url = '';
      try {
        const d = { topic: 'th', g: 9.8, world: { xmin: -5, xmax: 5, ymin: -5, ymax: 5 }, bodies: [], elements: [], customTypes: [] };
        const base = PE.custom[type] ? null : PE.T[type]; if (!base) throw new Error('custom');
        const r = PE.add(d, type, { x: 0, y: 0 }, { noExpand: true }); if (!r.ok) throw new Error('add');
        const el = d.elements[0]; const sc = root.PhysSim.defaults(JSON.parse(JSON.stringify(d))); const e = PE.extentOf(el);
        const cx = (e[0] + e[2]) / 2, cy = (e[1] + e[3]) / 2; const dim = Math.min(8, Math.max(0.3, e[2] - e[0], e[3] - e[1])); const px = 44, k = (px - 10) / dim; const dpr = 2;
        const c = document.createElement('canvas'); c.width = c.height = px * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr);
        const VV = { x: (wx) => px / 2 + (wx - (el.x || 0) - cx) * k, y: (wy) => px / 2 - (wy - (el.y || 0) - cy) * k, s: k };
        g.save(); g.beginPath(); g.rect(0, 0, px, px); g.clip(); PE.draw(g, sc, VV, { trail: false }); g.restore(); url = c.toDataURL();
      } catch (e) { url = ''; }
      thumbs[type] = url; return url;
    }
    function paletteItem(type, T0, custom) {
      const b = h('button', 'pal-item'); b.type = 'button'; b.dataset.type = type; const name = custom ? (LANG === 'zh' ? custom.zh : custom.en || custom.zh) : tName(T0);
      const u = thumb(type); b.innerHTML = (u ? '<img alt="" draggable="false" src="' + u + '">' : '<span class="pal-glyph">' + (custom ? '★' : esc(type.slice(0, 2))) + '</span>') + '<span class="pal-name">' + esc(name) + '</span>'; b.title = (T0 && T0.desc ? T0.desc : name) + (LANG === 'zh' ? '\n点击添加，或拖到画布' : '\nTap to add, or drag onto the canvas');
      let st = null, ghost = null; b.draggable = false; b.addEventListener('dragstart', (ev) => ev.preventDefault());
      b.addEventListener('pointerdown', (ev) => { if (ev.button) return; st = { x: ev.clientX, y: ev.clientY, moved: false }; b.setPointerCapture(ev.pointerId); });
      b.addEventListener('pointermove', (ev) => { if (!st) return; if (!st.moved && Math.hypot(ev.clientX - st.x, ev.clientY - st.y) > 8) { st.moved = true; ghost = h('div', 'pal-ghost', esc(name)); document.body.appendChild(ghost); } if (ghost) { ghost.style.left = ev.clientX + 8 + 'px'; ghost.style.top = ev.clientY + 8 + 'px'; } });
      const end = (ev) => { if (!st) return; const moved = st.moved; st = null; if (ghost) { ghost.remove(); ghost = null; } if (!moved) { const p = centerPos(); addAt(type, p.x, p.y); return; } const r = cv.getBoundingClientRect(); if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { const w = V.inv(ev.clientX - r.left, ev.clientY - r.top); addAt(type, w.x, w.y); } };
      b.addEventListener('pointerup', end); b.addEventListener('pointercancel', () => { st = null; if (ghost) { ghost.remove(); ghost = null; } });
      return b;
    }
    const catOpen = { shape: true };
    function buildPalette() {
      const box = host.palette; box.innerHTML = ''; const q = (insEls.search && insEls.search.value || '').trim().toLowerCase();
      const top = h('div', 'pal-top'); const search = h('input'); search.type = 'search'; search.placeholder = LANG === 'zh' ? '搜索元件…' : 'Search elements…'; search.value = q; search.oninput = () => { buildPalette(); insEls.search.focus(); }; insEls.search = search; top.appendChild(search); box.appendChild(top);
      PE.CATS.forEach((cat) => {
        let items = [];
        if (cat.id === 'mine') items = PE.customList().map((cd) => ({ id: cd.id, T: cd.base ? PE.T[cd.base] : null, custom: cd, name: cd.zh + ' ' + (cd.en || '') + ' ' + cd.id }));
        else items = PE.order.filter((id) => PE.T[id].cat === cat.id && (PE.T[id].kind !== 'virtual' || id === 'frictionPair')).map((id) => ({ id, T: PE.T[id], name: PE.T[id].zh + ' ' + (PE.T[id].en || '') + ' ' + id }));
        if (q) items = items.filter((it) => it.name.toLowerCase().indexOf(q) >= 0);
        if (!items.length && cat.id !== 'mine') return; if (!items.length && q) return;
        const d = h('details', 'pal-cat'); d.open = !!q || !!catOpen[cat.id]; d.addEventListener('toggle', () => { catOpen[cat.id] = d.open; }); d.appendChild(h('summary', '', esc(LANG === 'zh' ? cat.zh : cat.en) + ' <span class="cnt">' + items.length + '</span>'));
        const g = h('div', 'pal-grid'); items.forEach((it) => g.appendChild(paletteItem(it.id, it.T, it.custom))); if (cat.id === 'mine' && !items.length) g.appendChild(h('div', 'pal-empty', LANG === 'zh' ? '选中画布上的元件，点下方「保存所选」即可加入这里。' : 'Select elements on the canvas and tap “Save selection” below.'));
        d.appendChild(g); box.appendChild(d);
      });
      const lib = h('div', 'pal-lib'); const mkb = (txt, fn, title) => { const b = h('button', 'ibtn', txt); b.type = 'button'; b.onclick = fn; if (title) b.title = title; return b; };
      lib.appendChild(mkb(LANG === 'zh' ? '保存所选为元件' : 'Save selection', saveSelectionDialog));
      lib.appendChild(mkb(LANG === 'zh' ? '导出库' : 'Export lib', exportLib)); lib.appendChild(mkb(LANG === 'zh' ? '导入库' : 'Import lib', () => host.pickFile((txt) => importLib(txt))));
      box.appendChild(lib); insEls.libBox = h('div', 'pal-form'); box.appendChild(insEls.libBox);
    }
    function saveSelectionDialog() {
      const box = insEls.libBox; box.innerHTML = ''; if (!S.sel.length) { host.toast(LANG === 'zh' ? '请先选中元件' : 'Select elements first'); return; }
      const idI = h('input'); idI.placeholder = LANG === 'zh' ? '英文 id，如 myCart' : 'id, e.g. myCart'; idI.value = 'my' + (PE.customList().length + 1); const nameI = h('input'); nameI.placeholder = LANG === 'zh' ? '显示名称' : 'Display name'; const ok = h('button', 'ibtn', 'OK'); ok.type = 'button'; const cancel = h('button', 'ibtn', LANG === 'zh' ? '取消' : 'Cancel'); cancel.type = 'button'; const msg = h('div', 'pal-msg');
      ok.onclick = () => { const r = PE.saveSelectionAsType(doc(), S.sel, { id: idI.value.trim(), zh: nameI.value.trim() || idI.value.trim(), en: nameI.value.trim() || idI.value.trim() }); if (!r.ok) { msg.textContent = r.errors.join('；'); return; } saveLib(); box.innerHTML = ''; catOpen.mine = true; buildPalette(); host.toast((LANG === 'zh' ? '已保存到「我的元件」：' : 'Saved to My elements: ') + r.id); };
      cancel.onclick = () => { box.innerHTML = ''; }; [idI, nameI].forEach((i) => box.appendChild(i)); const row = h('div', 'row-actions'); row.appendChild(ok); row.appendChild(cancel); box.appendChild(row); box.appendChild(msg); idI.focus();
    }
    function exportLib() { host.download('aib-physics-library.json', PE.exportLibrary()); host.toast(LANG === 'zh' ? '已导出元件库' : 'Library exported'); }
    function importLib(txt) { const r = PE.importLibrary(txt); if (r.imported && r.imported.length) { saveLib(); catOpen.mine = true; buildPalette(); } host.toast(r.imported && r.imported.length ? (LANG === 'zh' ? '已导入 ' : 'Imported ') + r.imported.join(', ') + (r.errors.length ? ' · ' + r.errors.join('；') : '') : (r.errors || ['failed']).join('；')); }

    // ---------- inspector ----------
    function buildInspector() {
      dirtyInspector = false; const box = host.inspector; box.innerHTML = ''; insEls.fields = {}; insEls.live = null;
      const els = S.sel.map(byId).filter(Boolean);
      if (!els.length) { box.appendChild(h('div', 'ins-empty', LANG === 'zh' ? '未选中元件。点击画布中的元件，或从左侧元件库添加。<br>快捷键：Delete 删除 · Ctrl+Z/Y 撤销重做 · Ctrl+D 复制 · 方向键微调 · 空格/中键拖动画布 · 滚轮缩放' : 'Nothing selected. Tap an element on the canvas or add one from the palette.<br>Keys: Delete · Ctrl+Z/Y undo/redo · Ctrl+D duplicate · arrows nudge · Space/middle-drag pan · wheel zoom')); buildScene(box); return; }
      if (els.length > 1) {
        box.appendChild(h('div', 'ins-head', '<b>' + els.length + (LANG === 'zh' ? ' 个元件已选' : ' selected') + '</b>'));
        const same = els.every((e) => e.type === els[0].type); const row = h('div', 'row-actions');
        const mk = (t, fn) => { const b = h('button', 'ibtn', t); b.type = 'button'; b.onclick = fn; row.appendChild(b); }; mk(LANG === 'zh' ? '复制' : 'Duplicate', duplicateSel); mk(LANG === 'zh' ? '删除' : 'Delete', removeSel);
        mk(LANG === 'zh' ? '左对齐' : 'Align left', () => alignSel('x', 'min')); mk(LANG === 'zh' ? '底对齐' : 'Align bottom', () => alignSel('y', 'min')); mk(LANG === 'zh' ? '水平居中' : 'Center H', () => alignSel('x', 'mid')); mk(LANG === 'zh' ? '垂直居中' : 'Center V', () => alignSel('y', 'mid')); box.appendChild(row);
        if (same) { box.appendChild(h('div', 'ins-sub', LANG === 'zh' ? '同类型元件：修改参数将应用到全部选中项' : 'Same type: edits apply to all selected')); buildParams(box, els[0], els); }
        buildScene(box); return;
      }
      const el = els[0]; const t = T(el);
      const head = h('div', 'ins-head'); head.innerHTML = '<b>' + esc(tName(t)) + '</b> <span class="unit">' + esc(el.id) + '</span>'; box.appendChild(head); if (t.desc) box.appendChild(h('div', 'ins-desc', esc(t.desc)));
      const row = h('div', 'row-actions'); const mk = (txt, fn) => { const b = h('button', 'ibtn', txt); b.type = 'button'; b.onclick = fn; row.appendChild(b); }; mk(LANG === 'zh' ? '复制' : 'Duplicate', duplicateSel); mk(LANG === 'zh' ? '删除' : 'Delete', removeSel); mk(LANG === 'zh' ? '存为我的元件' : 'Save as element', () => { catOpen.mine = true; saveSelectionDialog(); host.revealPalette(); }); box.appendChild(row);
      buildParams(box, el, [el]);
      insEls.live = h('pre', 'ins-live'); box.appendChild(insEls.live); buildScene(box); refreshLive();
    }
    function alignSel(axis, mode) { const els = S.sel.map(byId).filter((e) => e && hasP(e, axis)); if (els.length < 2) return; host.prepareEdit(); pushUndo(); const vals = els.map((e) => e[axis]); const v = mode === 'min' ? Math.min.apply(null, vals) : (Math.min.apply(null, vals) + Math.max.apply(null, vals)) / 2; els.forEach((e) => { e[axis] = r4(v); }); commit({ rebuildInspector: true }); }
    function buildParams(box, el, targets) {
      const t = T(el); const groups = {}; t.params.forEach((p) => { if (p.kind === 'ref' && !p.k) return; (groups[p.grp || (p.kind === 'ref' ? 'ends' : 'other')] = groups[p.grp || (p.kind === 'ref' ? 'ends' : 'other')] || []).push(p); });
      GRP_ORDER.concat(Object.keys(groups).filter((g) => GRP_ORDER.indexOf(g) < 0)).forEach((gk) => {
        const ps = groups[gk]; if (!ps) return; const d = h('details', 'ins-grp'); d.open = gk !== 'look' || true; d.appendChild(h('summary', '', esc((GRP[gk] || [gk, gk])[LANG === 'zh' ? 0 : 1])));
        const body = h('div', 'ins-body'); ps.forEach((p) => body.appendChild(paramField(el, p, targets))); d.appendChild(body); box.appendChild(d);
      });
    }
    function paramField(el, p, targets) {
      const f = h('div', 'field' + (p.kind === 'text' || p.kind === 'verts' || p.kind === 'json' ? ' wide' : '')); const msg = h('div', 'ins-err');
      f.appendChild(h('label', '', esc(p.zh || p.k) + ' <b>' + esc(p.k) + '</b>' + (p.unit ? ' <span class="unit">[' + esc(p.unit) + ']</span>' : '')));
      const apply = (v, ctrl) => { let bad = null; pushUndoOnce(el.id + '.' + p.k); targets.forEach((tg) => { const r = setProps(tg.id, { [p.k]: v }, { live: true }); if (!r.ok) bad = r.errors[0]; }); if (bad) { ctrl && ctrl.classList.add('bad'); msg.textContent = bad; } else { ctrl && ctrl.classList.remove('bad'); msg.textContent = ''; } return !bad; };
      const cur = el[p.k]; let ctrl;
      if (p.kind === 'num') {
        const row = h('div', p.min != null && p.max != null && p.max - p.min <= 400 ? 'slrow' : ''); const nb = h('input'); nb.type = 'number'; nb.step = p.step || 'any'; nb.dataset.k = p.k; nb.value = cur == null ? '' : +Number(cur).toPrecision(8); if (p.min != null) nb.min = p.min; if (p.max != null) nb.max = p.max; ctrl = nb;
        let rg = null; if (row.className) { rg = h('input'); rg.type = 'range'; rg.min = p.min; rg.max = p.max; rg.step = p.step && p.step !== 'any' ? p.step : (p.max - p.min) / 400; rg.value = cur == null ? p.min : cur; rg.oninput = () => { nb.value = rg.value; apply(parseFloat(rg.value), nb); }; row.appendChild(rg); }
        nb.oninput = () => { const v = parseFloat(nb.value); if (!isFinite(v)) return; if (rg) rg.value = v; apply(v, nb); }; row.appendChild(nb); f.appendChild(row); insEls.fields[p.k] = { nb, rg };
      } else if (p.kind === 'bool') { const c = h('input'); c.type = 'checkbox'; c.checked = cur == null ? !!p.def : !!cur; c.onchange = () => apply(c.checked, c); f.appendChild(c); ctrl = c; insEls.fields[p.k] = { nb: c };
      } else if (p.kind === 'select') { const s = h('select'); (p.opts || []).forEach((o) => { const op = h('option'); const v = typeof o === 'object' ? o.v : o; op.value = v; op.textContent = typeof o === 'object' ? (LANG === 'zh' ? o.zh : o.en || o.zh) : o; s.appendChild(op); }); s.value = cur == null ? p.def : cur; s.onchange = () => { apply(s.value, s); buildInspectorSoon(); }; f.appendChild(s); ctrl = s; insEls.fields[p.k] = { nb: s };
      } else if (p.kind === 'color') { const c = h('input'); c.type = 'color'; c.value = /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#3d9b6e'; c.oninput = () => apply(c.value, c); f.appendChild(c); ctrl = c; insEls.fields[p.k] = { nb: c };
      } else if (p.kind === 'ref') { const s = h('select'); s.appendChild(Object.assign(h('option'), { value: '', textContent: '—' })); (doc().elements || []).filter((e) => e.id !== el.id && T(e) && T(e).kind !== 'virtual' && T(e).kind !== 'link').forEach((e) => { const o = h('option'); o.value = e.id; o.textContent = e.id + (e.label ? ' · ' + e.label : ''); s.appendChild(o); }); s.value = cur || ''; s.onchange = () => { apply(s.value, s); }; f.appendChild(s); ctrl = s; insEls.fields[p.k] = { nb: s };
      } else if (p.kind === 'verts') { const ta = h('textarea'); ta.rows = 3; ta.value = PE.vertsToText(cur || p.def); ta.onchange = () => apply(ta.value, ta); f.appendChild(ta); ctrl = ta; insEls.fields[p.k] = { nb: ta };
      } else if (p.kind === 'json') { const ta = h('textarea'); ta.rows = 4; ta.value = JSON.stringify(cur == null ? p.def : cur); ta.onchange = () => { try { apply(JSON.parse(ta.value), ta); } catch (e) { ta.classList.add('bad'); msg.textContent = 'JSON: ' + e.message; } }; f.appendChild(ta); ctrl = ta; insEls.fields[p.k] = { nb: ta };
      } else { const i = h('input'); i.type = 'text'; i.value = cur == null ? '' : cur; i.oninput = () => apply(i.value, i); f.appendChild(i); ctrl = i; insEls.fields[p.k] = { nb: i }; }
      f.appendChild(msg); return f;
    }
    let lastUndoKey = '', lastUndoAt = 0;
    function pushUndoOnce(key) { const now = performance.now(); if (key === lastUndoKey && now - lastUndoAt < 1500) { lastUndoAt = now; return; } lastUndoKey = key; lastUndoAt = now; pushUndo(); }
    let rebuildTimer = 0; function buildInspectorSoon() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => { if (!/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) buildInspector(); }, 60); }
    function refreshInspectorValues() {
      const el = S.sel.length === 1 ? byId(S.sel[0]) : null; if (!el || !insEls.fields) return;
      Object.keys(insEls.fields).forEach((k) => { const f = insEls.fields[k]; const v = el[k]; if (v == null || document.activeElement === f.nb) return; if (f.nb.type === 'checkbox') f.nb.checked = !!v; else if (f.nb.tagName === 'TEXTAREA') return; else { f.nb.value = typeof v === 'number' ? +Number(v).toPrecision(8) : v; if (f.rg) f.rg.value = v; } });
    }
    function refreshLive() {
      if (!insEls.live) return; const el = S.sel.length === 1 ? byId(S.sel[0]) : null; const s = scene(); if (!el || !s || !s._el) { insEls.live.textContent = ''; return; }
      const sm = PE.summary(s).find((q) => q.id === el.id); if (!sm) return; const lines = []; ['x', 'y', 'vx', 'vy', 'angle', 'omega'].forEach((k) => { if (sm[k] != null) lines.push(k + ' = ' + sm[k]); }); if (sm.readout) Object.keys(sm.readout).forEach((k) => lines.push(k + ' = ' + (typeof sm.readout[k] === 'number' ? +sm.readout[k].toFixed(4) : sm.readout[k])));
      const txt = lines.join('\n'); if (txt !== lastLive) { insEls.live.textContent = txt; lastLive = txt; }
    }
    function buildScene(box) {
      const d = h('details', 'ins-grp'); d.appendChild(h('summary', '', LANG === 'zh' ? '场景 / 世界' : 'Scene / world')); const body = h('div', 'ins-body'); const sc = doc();
      const mkNum = (label, unit, get, set, step) => { const f = h('div', 'field'); f.appendChild(h('label', '', label + (unit ? ' <span class="unit">[' + unit + ']</span>' : ''))); const i = h('input'); i.type = 'number'; i.step = step || 'any'; i.value = get(); i.oninput = () => { const v = parseFloat(i.value); if (!isFinite(v)) return; pushUndoOnce('scene.' + label); host.prepareEdit(); set(v); commit(); }; f.appendChild(i); body.appendChild(f); };
      sc.world = sc.world || { xmin: -5, xmax: 5, ymin: -1, ymax: 6 };
      mkNum('xmin', 'm', () => sc.world.xmin, (v) => { sc.world.xmin = v; }); mkNum('xmax', 'm', () => sc.world.xmax, (v) => { sc.world.xmax = v; }); mkNum('ymin', 'm', () => sc.world.ymin, (v) => { sc.world.ymin = v; }); mkNum('ymax', 'm', () => sc.world.ymax, (v) => { sc.world.ymax = v; });
      mkNum('g', 'm/s²', () => sc.g == null ? 9.8 : sc.g, (v) => { sc.g = v; }, 0.1); mkNum('dt', 's', () => sc.dt || 1 / 120, (v) => { sc.dt = v; }, 0.001);
      const act = h('div', 'row-actions'); const fb = h('button', 'ibtn', LANG === 'zh' ? '适应窗口' : 'Fit view'); fb.type = 'button'; fb.onclick = fit; act.appendChild(fb); body.appendChild(act); d.appendChild(body); box.appendChild(d);
    }

    // ---------- toolbar ----------
    const bar = host.bar; const btn = {};
    function buildBar() {
      bar.innerHTML = ''; const mk = (id, txt, title, fn, cls) => { const b = h('button', 'ebtn' + (cls ? ' ' + cls : ''), txt); b.type = 'button'; b.title = title; b.onclick = fn; bar.appendChild(b); btn[id] = b; return b; };
      mk('select', '↖', LANG === 'zh' ? '选择 (V)' : 'Select (V)', () => setTool('select')); mk('hand', '✋', LANG === 'zh' ? '平移 (H / 空格)' : 'Pan (H / Space)', () => setTool('hand')); mk('multi', '▣', LANG === 'zh' ? '多选模式（触屏点选叠加）' : 'Multi-select (tap to add)', () => { S.multi = !S.multi; updateBar(); });
      bar.appendChild(h('span', 'sep')); mk('undo', '↶', LANG === 'zh' ? '撤销 (Ctrl+Z)' : 'Undo', undo); mk('redo', '↷', LANG === 'zh' ? '重做 (Ctrl+Y)' : 'Redo', redo); mk('dup', '⧉', LANG === 'zh' ? '复制 (Ctrl+D)' : 'Duplicate', duplicateSel); mk('del', '🗑', LANG === 'zh' ? '删除 (Del)' : 'Delete', removeSel);
      bar.appendChild(h('span', 'sep')); mk('snap', '⌗', LANG === 'zh' ? '吸附网格 / 角度' : 'Snap to grid / angle', () => { S.snap = !S.snap; updateBar(); });
      const gs = h('select', 'esel'); [0.05, 0.1, 0.25, 0.5, 1].forEach((v) => { const o = h('option'); o.value = v; o.textContent = v + ' m'; gs.appendChild(o); }); gs.value = S.grid; gs.title = LANG === 'zh' ? '网格间距' : 'Grid step'; gs.onchange = () => { S.grid = parseFloat(gs.value); }; bar.appendChild(gs); btn.grid = gs;
      const as = h('select', 'esel'); [0, 1, 5, 15, 45].forEach((v) => { const o = h('option'); o.value = v; o.textContent = v ? v + '°' : 'off'; as.appendChild(o); }); as.value = S.angSnap; as.title = LANG === 'zh' ? '角度吸附' : 'Angle snap'; as.onchange = () => { S.angSnap = parseFloat(as.value); }; bar.appendChild(as); btn.ang = as;
      bar.appendChild(h('span', 'sep')); mk('fit', '⤢', LANG === 'zh' ? '适应窗口' : 'Fit view', fit); mk('zin', '+', 'Zoom in', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.25)); mk('zout', '−', 'Zoom out', () => zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 0.8));
      updateBar();
    }
    function updateBar() {
      if (!btn.undo) return; btn.undo.disabled = !S.undo.length; btn.redo.disabled = !S.redo.length; btn.dup.disabled = btn.del.disabled = !S.sel.length;
      btn.select.classList.toggle('on', S.tool === 'select'); btn.hand.classList.toggle('on', S.tool === 'hand'); btn.multi.classList.toggle('on', S.multi); btn.snap.classList.toggle('on', S.snap);
    }

    // ---------- public API ----------
    function setSelection(ids) { S.sel = (ids || []).filter((id) => byId(id)); dirtyInspector = true; buildInspector(); host.requestDraw(); }
    function onSceneLoaded(keepView) { S.sel = S.sel.filter((id) => byId(id)); S.undo = []; S.redo = []; dirtyInspector = true; buildInspector(); updateBar(); if (!keepView) fit(); }
    loadLib(); buildBar(); buildPalette(); buildInspector();
    return { V, S, fit, drawOverlay, drawGrid, onFrame: refreshLive, addAt, removeSel, undo, redo, setSelection, onSceneLoaded, buildPalette, buildInspector, importLib, exportLib, saveLib, setProps, select: () => S.sel.slice(), pushUndo, centerPos,
      refreshInspector: () => { dirtyInspector = true; buildInspector(); }, lang: LANG };
  }
  root.PhysEditor = { create };
})(typeof window !== 'undefined' ? window : globalThis);
