'use strict';
// v3.0.1: GeoGebra panel beside a chat answer — sensible share of the width (55% by default), equal axis units (1:1)
// that follow the pane's shape, a draggable divider, and an answer column that collapses (both remembered); the applet
// is resized with the pane every time.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function checkGgbLayout({ page: p, frame, until, assert, eq, shot }) {
  const geo = () => p.evaluate(() => {
    const b = document.querySelector('.ai-body.tool-split'), pp = b.querySelector('.plot-panel'), m = b.querySelector('.ai-main');
    const r = (e) => { const x = e.getBoundingClientRect(); return { w: Math.round(x.width), h: Math.round(x.height), l: Math.round(x.left) }; };
    return { body: r(b), plot: r(pp), main: m.offsetParent ? r(m) : null, collapsed: b.classList.contains('answer-collapsed') };
  });
  const view = async () => frame.evaluate(() => window.__ggbView());
  const square = (v) => v.props && Math.abs(v.props.invXscale / v.props.invYscale - 1) < 0.02;
  // defaults
  await p.evaluate(() => { localStorage.removeItem('aib.plotSplit'); localStorage.removeItem('aib.plotAnswerCollapsed'); });
  let g = await geo();
  const frac = g.plot.w / g.body.w;
  assert(frac > 0.5 && frac < 0.6, 'graph takes about 55% of the width: ' + JSON.stringify(g));
  assert(g.plot.h >= 340, 'graph height ' + JSON.stringify(g));
  assert(g.main && g.main.w > 200, 'answer column visible ' + JSON.stringify(g));
  let v = await until(async () => { const x = await view(); return x && x.props ? x : null; }, 15000, 'ggb view');
  assert(square(v), 'axes 1:1 by default: ' + JSON.stringify(v.props));
  // applet fills the pane
  const fit = async () => { const s = await view(); const fr = await p.evaluate(() => { const f = document.querySelector('#plotcanvas iframe:not([style*="none"])'); const r = f.getBoundingClientRect(); return { w: r.width, h: r.height }; }); return Math.abs(s.size.w - fr.w) <= 4 ? { s, fr } : null; };
  await until(fit, 8000, 'applet sized to the pane');
  // collapse the answer: the graph takes the whole width, applet follows, still 1:1
  await p.locator('.plot-collapse').scrollIntoViewIfNeeded(); await sleep(150); await p.locator('.plot-collapse').click();
  g = await until(async () => { const x = await geo(); return x.collapsed && x.plot.w > x.body.w * 0.95 ? x : null; }, 5000, 'collapsed').catch(async (e) => { throw new Error(e.message + ' ' + JSON.stringify(await geo()) + ' ' + await p.evaluate(() => getComputedStyle(document.querySelector('.ai-body.tool-split')).gridTemplateColumns)); });
  eq(g.main, null, 'answer hidden');
  eq(await p.evaluate(() => localStorage.getItem('aib.plotAnswerCollapsed')), '1');
  await until(fit, 8000, 'applet resized after collapsing');
  v = await view(); assert(square(v), 'still 1:1 after collapsing ' + JSON.stringify(v.props));
  if (shot) await shot('ggb-answer-collapsed');
  eq(await p.locator('.plot-collapse').innerText(), '展开回答');
  await p.locator('.plot-collapse').scrollIntoViewIfNeeded(); await sleep(150); await p.locator('.plot-collapse').click();
  await until(async () => !(await geo()).collapsed, 5000, 'expanded');
  eq(await p.evaluate(() => localStorage.getItem('aib.plotAnswerCollapsed')), '0');
  // drag the divider to the left
  const h = await p.locator('.split-handle').boundingBox();
  await p.locator('.split-handle').hover({ position: { x: 5, y: Math.min(60, h.height / 2) } });
  await p.mouse.down(); await p.mouse.move(h.x - 120, h.y + Math.min(60, h.height / 2), { steps: 6 }); await p.mouse.up();
  if (!(await p.evaluate(() => document.querySelector('.ai-body.tool-split').style.getPropertyValue('--plot-w') !== '55%'))) {
    // the simulated iPad host does not route CDP mouse input to this view: drive the same pointer sequence directly
    await p.evaluate(({ x0, x1, y }) => {
      const el = document.querySelector('.split-handle'); const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientY: y };
      el.setPointerCapture = () => {};
      el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x0 }));
      for (let i = 1; i <= 6; i++) el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x0 + (x1 - x0) * i / 6 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x1 }));
    }, { x0: h.x + h.width / 2, x1: h.x - 120, y: h.y + Math.min(60, h.height / 2) });
  }
  g = await geo();
  assert(g.plot.w < frac * g.body.w - 80, 'divider moved: ' + JSON.stringify(g));
  const saved = parseFloat(await p.evaluate(() => localStorage.getItem('aib.plotSplit')));
  assert(saved > 25 && saved < 50, 'split remembered ' + saved);
  await until(fit, 8000, 'applet resized after dragging');
  // keyboard and reset
  await p.locator('.split-handle').dblclick();
  g = await geo(); assert(Math.abs(g.plot.w / g.body.w - 0.55) < 0.03, 'double-click resets to 55% ' + JSON.stringify(g));
  await sleep(300);
  if (shot) await shot('ggb-split-default');
}
module.exports = { checkGgbLayout };
