import { test, expect } from '@playwright/test';
// v1.2.0 — element library editor in the web PWA: palette add (tap + drag), select, inspector edit with live update,
// undo/redo, delete, custom element save/export, agent-tool style calls, mobile layout (collapsible palette / inspector).
async function openPhys(page) {
  await page.goto('http://127.0.0.1:8765/');
  await page.click('#btnPhys');
  const fr = page.frameLocator('iframe[title="Physics"]');
  await expect(fr.locator('#play')).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => fr.locator('#ex option').count()).toBeGreaterThanOrEqual(20);
  return fr;
}
async function pos(page, id) {   // screen position of an element's anchor (page coordinates)
  const f = page.frameLocator('iframe[title="Physics"]'); const off = await page.locator('iframe[title="Physics"]').boundingBox();
  const l = await f.locator('body').evaluate((_, id) => window.aibPhysDebug.screenOf(id), id); return { x: off.x + l.x, y: off.y + l.y };
}
async function call(page, method, args) {
  return page.evaluate(async ([method, args]) => {
    const f = document.querySelector('iframe[title="Physics"]');
    return await new Promise((resolve, reject) => {
      const id = 'c' + Math.random(); const on = (ev) => { if (ev.data && ev.data.aibPanelReply === id) { window.removeEventListener('message', on); ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data.result); } };
      window.addEventListener('message', on); f.contentWindow.postMessage({ aibPanelCall: id, method, args }, '*'); setTimeout(() => reject(new Error('timeout')), 6000);
    });
  }, [method, args]);
}

test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('palette → add → select → inspector edit → undo/redo → delete → play', async ({ page }) => {
    const fr = await openPhys(page);
    await fr.locator('#btnNew').click();
    await expect(fr.locator('.pal-item')).toHaveCount(54);
    const box = async () => fr.locator('#cv').boundingBox();
    if (await fr.locator('#palette').isHidden()) await fr.locator('#palToggle').click();     // the web app embeds the panel in a narrow column → collapsed layout
    await fr.locator('.pal-item[data-type="block"]').click();               // tap adds at the view centre
    let els = (await call(page, 'getElements', {})).elements; expect(els.map((e) => e.type)).toEqual(['block']);
    // drag a ball from the palette onto the canvas
    await fr.locator('.pal-item[data-type="ball"]').scrollIntoViewIfNeeded(); const ball = await fr.locator('.pal-item[data-type="ball"]').boundingBox(); let cv = await box();
    await page.mouse.move(ball.x + 20, ball.y + 20); await page.mouse.down(); await page.mouse.move(ball.x + 70, ball.y + 40, { steps: 4 }); await page.mouse.move(cv.x + cv.width * 0.75, cv.y + cv.height * 0.3, { steps: 6 }); await page.mouse.up();
    els = (await call(page, 'getElements', {})).elements; expect(els.map((e) => e.type)).toEqual(['block', 'ball']);
    // select the ball by clicking it; the inspector lists its parameters with units
    let bp = await pos(page, 'ball1'); await page.mouse.click(bp.x, bp.y);
    await expect(fr.locator('.ins-head')).toContainText('ball1'); cv = await box();
    await expect(fr.locator('#inspector input[data-k="mass"]')).toBeVisible();
    await fr.locator('#inspector input[data-k="mass"]').fill('3.5');
    els = (await call(page, 'getElements', {})).elements; expect(els.find((e) => e.type === 'ball').mass).toBe(3.5);
    await fr.locator('#inspector input[data-k="mass"]').fill('-1');          // out of range is rejected and flagged
    await expect(fr.locator('#inspector input[data-k="mass"]')).toHaveClass(/bad/);
    expect((await call(page, 'getElements', {})).elements.find((e) => e.type === 'ball').mass).toBe(3.5);
    // drag-move then undo / redo
    const before = (await call(page, 'getElements', {})).elements.find((e) => e.type === 'ball');
    bp = await pos(page, 'ball1'); await page.mouse.move(bp.x, bp.y); await page.mouse.down(); await page.mouse.move(bp.x + 40, bp.y + 30, { steps: 5 }); await page.mouse.up();
    const moved = (await call(page, 'getElements', {})).elements.find((e) => e.type === 'ball'); expect(moved.x).toBeGreaterThan(before.x);
    await fr.locator('.ebtn[title^="Undo"]').click(); expect((await call(page, 'getElements', {})).elements.find((e) => e.type === 'ball').x).toBe(before.x);
    await fr.locator('.ebtn[title^="Redo"]').click(); expect((await call(page, 'getElements', {})).elements.find((e) => e.type === 'ball').x).toBe(moved.x);
    // play: the ball falls
    cv = await box(); await fr.locator('#play').click(); await page.waitForTimeout(500); await fr.locator('#pause').click();
    const st = await call(page, 'state', {}); expect(st.elements.find((e) => e.type === 'ball').y).toBeLessThan(moved.y);
    // delete with the keyboard
    await fr.locator('#reset').click(); bp = await pos(page, 'ball1'); await page.mouse.click(bp.x, bp.y); await page.keyboard.press('Delete');
    expect((await call(page, 'getElements', {})).elements.map((e) => e.type)).toEqual(['block']);
  });

  test('examples (el_*) load and run; legacy scene converts to elements', async ({ page }) => {
    const fr = await openPhys(page);
    for (const id of ['el_conveyor_horizontal', 'el_atwood', 'el_loop_the_loop', 'el_rails_rod', 'el_prism_dispersion']) {
      await fr.locator('#ex').selectOption(id); await expect(fr.locator('body')).toHaveClass(/el/);
      await page.waitForTimeout(300); const st = await call(page, 'state', {}); expect(st.elements.length).toBeGreaterThan(1);
    }
    await call(page, 'loadExample', { id: 'mechanics_projectile' }); await expect(fr.locator('body')).not.toHaveClass(/el/);
    await fr.locator('#btnEl').click(); await expect(fr.locator('body')).toHaveClass(/el/);
    const els = (await call(page, 'getElements', {})).elements; expect(els.some((e) => e.type === 'ball')).toBeTruthy();
  });

  test('agent-tool methods: add / update / remove / list types / custom element', async ({ page }) => {
    await openPhys(page);
    await call(page, 'newScene', {});
    const types = await call(page, 'listElementTypes', { category: 'mech' }); expect(types.types.some((t) => t.id === 'conveyor')).toBeTruthy();
    let r = await call(page, 'addElement', { type: 'conveyor', props: { id: 'belt', x: 0, y: 0, len: 8, speed: 2 } }); expect(r.ok).toBeTruthy();
    r = await call(page, 'addElement', { type: 'block', props: { id: 'b', x: -2, y: 0.3, mass: 1 } }); expect(r.ok).toBeTruthy();
    r = await call(page, 'addElement', { type: 'block', props: { id: 'bad', mass: -5 } }); expect(r.ok).toBe(false); expect(r.errors[0]).toContain('mass');
    r = await call(page, 'updateElement', { id: 'belt', props: { speed: 3 } }); expect(r.ok).toBeTruthy();
    r = await call(page, 'defineCustomElement', { def: { id: 'heavyBlk', zh: '重块', base: 'block', defaults: { mass: 20 } } }); expect(r.ok).toBeTruthy();
    r = await call(page, 'addElement', { type: 'heavyBlk', props: { id: 'h1', x: 2, y: 0.3 } }); expect(r.ok).toBeTruthy();
    expect((await call(page, 'getElements', {})).elements.find((e) => e.id === 'h1').mass).toBe(20);
    r = await call(page, 'removeElement', { id: 'b' }); expect(r.ok).toBeTruthy();
    const ex = await call(page, 'exportScene', {}); expect(ex.scene.customTypes.map((c) => c.id)).toContain('heavyBlk');   // custom types travel with the scene
  });
});

test.describe('mobile layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('palette / inspector collapse, touch tap adds, no horizontal scroll', async ({ page }) => {
    const fr = await openPhys(page);
    await fr.locator('#btnNew').click();
    await expect(fr.locator('#palette')).toBeHidden();                       // collapsed by default on phones
    await fr.locator('#palToggle').click(); await expect(fr.locator('#palette')).toBeVisible();
    await fr.locator('.pal-item[data-type="ball"]').tap();
    expect((await call(page, 'getElements', {})).elements.map((e) => e.type)).toEqual(['ball']);
    await fr.locator('#palToggle').click(); await expect(fr.locator('#palette')).toBeHidden();
    const bp = await pos(page, 'ball1');
    await page.touchscreen.tap(bp.x, bp.y);   // tap the ball → selected → inspector opens
    await expect(fr.locator('#side')).toBeVisible(); await expect(fr.locator('.ins-head')).toContainText('ball1');
    await fr.locator('#sideToggle').click(); await expect(fr.locator('#side')).toBeHidden();
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })); expect(sw).toBeLessThanOrEqual(cw + 1);
  });
});
