import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 844 } });
test('web physics: 15 examples, controls, params, import/export, no h-scroll', async ({ page }) => {
  await page.goto('http://127.0.0.1:8765/');
  await page.click('#btnPhys');
  const fr = page.frameLocator('iframe[title="Physics"]');
  await expect(fr.locator('#play')).toBeVisible({ timeout: 15000 });
  // examples loaded
  await expect.poll(async () => fr.locator('#ex option').count()).toBeGreaterThanOrEqual(15);
  await fr.locator('#pause').click();
  await fr.locator('#step').click();
  await fr.locator('#reset').click();
  // params panel exists and is collapsible on mobile
  await expect(fr.locator('#params')).toBeVisible();
  await expect(fr.locator('#params details').first()).toBeVisible();
  // open world section and change g
  await fr.locator('#params details').first().locator('summary').click();
  const g = fr.locator('#params details').first().locator('input[type=number]').nth(4); // g field
  await g.fill('5');
  await fr.locator('#btnExport').click();
  // setParam via postMessage
  const r = await page.evaluate(async () => {
    const f = document.querySelector('iframe[title="Physics"]');
    return await new Promise((resolve, reject) => {
      const id = 't1';
      const on = (ev) => { if (ev.data && ev.data.aibPanelReply === id) { window.removeEventListener('message', on); ev.data.error ? reject(new Error(ev.data.error)) : resolve(ev.data.result); } };
      window.addEventListener('message', on);
      f.contentWindow.postMessage({ aibPanelCall: id, method: 'setParam', args: { path: 'world.air', value: 0.1 } }, '*');
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
  });
  expect(r.ok).toBeTruthy();
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw + 1);
});

async function call(page, method, args) {
  return page.evaluate(async ([method, args]) => {
    const f = document.querySelector('iframe[title="Physics"]');
    return await new Promise((resolve) => {
      const id = 'c' + Math.random();
      const on = (ev) => { if (ev.data && ev.data.aibPanelReply === id) { window.removeEventListener('message', on); resolve(ev.data); } };
      window.addEventListener('message', on);
      f.contentWindow.postMessage({ aibPanelCall: id, method, args }, '*');
      setTimeout(() => resolve({ error: 'timeout' }), 5000);
    });
  }, [method, args]);
}
test('web physics modules: all-params panel edits change live derived values; range errors; mobile fit', async ({ page }) => {
  await page.goto('http://127.0.0.1:8765/');
  await page.click('#btnPhys');
  const fr = page.frameLocator('iframe[title="Physics"]');
  await expect(fr.locator('#play')).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => fr.locator('#ex option').count()).toBeGreaterThanOrEqual(34);
  await call(page, 'loadExample', { id: 'mod_refraction' });
  await expect(fr.locator('#params input[data-param="n2"]')).toBeVisible();
  const before = await fr.locator('#readout').innerText();
  await fr.locator('#params input[data-param="n1"]').fill('1.8');
  await fr.locator('#params input[data-param="n2"]').fill('1.0');
  await expect.poll(async () => fr.locator('#readout').innerText()).not.toBe(before);
  await expect(fr.locator('#readout')).toContainText('critical angle');
  await expect(fr.locator('#readout')).toContainText('total internal reflection');
  // every module example renders its parameter inputs (slider + number) and the readout
  for (const id of ['mod_projectile', 'mod_incline', 'mod_gas', 'mod_circuit', 'mod_photoelectric', 'mod_plates']) {
    await call(page, 'loadExample', { id });
    await expect.poll(async () => fr.locator('#params input[data-param]').count()).toBeGreaterThan(3);
    const n = await fr.locator('#params input[type=range]').count(); expect(n).toBeGreaterThan(3);
  }
  // agent tools: list params, set by key / path, alias, out-of-range error text
  await call(page, 'loadExample', { id: 'mod_wave' });
  const lp = await call(page, 'listParams', {});
  expect(lp.result.modules[0].params.map(p => p.key)).toEqual(expect.arrayContaining(['A', 'T', 'lambda', 'frequency', 'speed']));
  expect((await call(page, 'setParam', { module: 0, key: 'speed', value: 8 })).result.ok).toBeTruthy();
  const st = await call(page, 'state', {}); expect(st.result.derived['wave speed v=λ/T (m/s)']).toBeCloseTo(8, 6);
  expect((await call(page, 'update', { changes: { 'modules[0].A': 1.2, 'modules[0].T': 4 } })).result.applied.length).toBe(2);
  const bad = await call(page, 'setParam', { path: 'modules[0].A', value: 99 }); expect(bad.error).toMatch(/must be in \[/);
  await expect(fr.locator('#err')).toContainText('Amplitude');
  // mobile: no horizontal overflow, controls inside viewport
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw + 1);
  const over = await fr.locator('body').evaluate(() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll('#bar button,#bar select,#params input,#params select')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).length; });
  expect(over).toBe(0);
});
