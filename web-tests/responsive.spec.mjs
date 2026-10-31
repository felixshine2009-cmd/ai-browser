import { test, expect, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = 'http://127.0.0.1:8765/';

const VIEWPORTS = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-15-360', width: 360, height: 780 },
  { name: 'iphone-15', width: 393, height: 852 },
  { name: 'iphone-15-pro-max', width: 430, height: 932 },
  { name: 'ipad', width: 820, height: 1180 },
  { name: 'laptop-1366', width: 1366, height: 768 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-2560', width: 2560, height: 1440 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

async function assertNoHScroll(page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, `horizontal overflow ${sw}>${cw}`).toBeLessThanOrEqual(cw + 1);
}

async function assertTouchTargets(page) {
  const bad = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a.btn, #modeseg .seg, #btnSend, #btnSettings')];
    return els.filter(e => {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      return r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44);
    }).map(e => ({ t: e.tagName, id: e.id, c: e.className, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
  });
  expect(bad, JSON.stringify(bad)).toEqual([]);
}

async function assertNoClipped(page) {
  const bad = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    return [...document.querySelectorAll('button, input, textarea, select, .seg')].filter(e => {
      const st = getComputedStyle(e); if (st.display === 'none' || st.visibility === 'hidden') return false;
      if (e.closest('#settings:not(.open)') || e.closest('#panelcol') && getComputedStyle(e.closest('#panelcol')).display === 'none') return false;
      const r = e.getBoundingClientRect(); if (!r.width) return false;
      // inside a horizontally scrollable strip (tabs) is fine
      if (e.closest('#tabs')) return false;
      return r.left < -1 || r.right > W + 1;
    }).map(e => e.id || e.className || e.tagName);
  });
  expect(bad, 'clipped: ' + bad.join(',')).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test('loads, no h-scroll, desktop-only toast, touch targets', async ({ page }) => {
      await page.goto(ROOT);
      await expect(page.locator('#greet')).toBeVisible();
      await assertNoHScroll(page);
      await assertTouchTargets(page);
      await page.locator('button[data-desktop-only]').first().click({ force: true });
      await expect(page.locator('#toast')).toHaveClass(/show/);
      const txt = await page.locator('#toast').innerText();
      expect(/Desktop only|仅桌面版可用/.test(txt)).toBeTruthy();
      await assertNoClipped(page);
      await page.screenshot({ path: path.join(__dirname, 'shots', `${test.info().project.name}-${vp.name}.png`), fullPage: false });
    });
    test('panel opens (GeoGebra + physics), fits viewport, settings sheet fits', async ({ page }) => {
      await page.goto(ROOT);
      await page.click('#btnGgb');
      const fr = page.frameLocator('iframe[title="GeoGebra"]');
      await expect(fr.locator('#apps')).toBeVisible({ timeout: 20000 });
      await page.waitForFunction(() => { const f = document.querySelector('iframe[title="GeoGebra"]'); return f && f.contentWindow && f.contentWindow.document.querySelector('.applet_scaler,.GeoGebraFrame'); }, null, { timeout: 90000 });
      await assertNoHScroll(page);
      const box = await page.locator('iframe[title="GeoGebra"]').boundingBox();
      expect(box.width).toBeGreaterThan(200); expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);
      await page.screenshot({ path: path.join(__dirname, 'shots', `${test.info().project.name}-${vp.name}-ggb.png`) });
      await page.click(vp.width < 768 ? '#ptPhys' : '#btnPhys');
      const pf = page.frameLocator('iframe[title="Physics"]');
      await expect(pf.locator('#play')).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(800);
      await assertNoHScroll(page);
      await page.screenshot({ path: path.join(__dirname, 'shots', `${test.info().project.name}-${vp.name}-phys.png`) });
      if (vp.width < 768) { await page.click('#btnClosePanel'); await expect(page.locator('#panelcol')).toBeHidden(); }
      await page.click('#btnSettings');
      await expect(page.locator('#settings.open .sheet')).toBeVisible();
      const sb = await page.locator('#settings .sheet').boundingBox();
      expect(sb.x).toBeGreaterThanOrEqual(-1); expect(sb.x + sb.width).toBeLessThanOrEqual(vp.width + 1);
      await assertNoHScroll(page);
      await page.screenshot({ path: path.join(__dirname, 'shots', `${test.info().project.name}-${vp.name}-settings.png`) });
    });
  });
}
