import { test, expect } from '@playwright/test';
test('web virtual keyboard collapses, inserts symbols, tools exposed', async ({ page }) => {
  await page.goto('http://127.0.0.1:8765/');
  await expect(page.locator('#vkToggle')).toBeVisible();
  await expect(page.locator('.vk.collapsed')).toHaveCount(1);
  await page.click('#vkToggle');
  await expect(page.locator('.vk.collapsed')).toHaveCount(0);
  await page.click('.vk-key[data-k="π"]');
  await expect(page.locator('#q')).toHaveValue(/π/);
  await page.click('.vk-tab[data-t="chem"]');
  await page.click('.vk-key[data-k="⇌"]');
  await expect(page.locator('#q')).toHaveValue(/⇌/);
  const cat = await page.evaluate(() => window.__AIB_TOOLS__.vkeyboard_catalog());
  expect(cat.keys.math.length).toBeGreaterThan(3);
});
