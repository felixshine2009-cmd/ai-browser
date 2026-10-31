import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

async function gotoMock(page, mock) {
  await page.addInitScript(m => { window.__AIB_MOCK_WEBGPU__ = m; window.__AIB_MOCK_EMBED__ = { ok: true }; }, mock);
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => !!window.__AIB_TOOLS__);
}

test('WebGPU available: local engine enabled, catalog, progress, tools', async ({ page }) => {
  await gotoMock(page, { ok: true });
  await expect(page.locator('#btnLocal')).toBeVisible();
  await expect(page.locator('#btnLocal')).not.toHaveClass(/disabled/);
  await expect(page.locator('button[data-desktop-only]').first()).toHaveClass(/disabled/);
  await page.click('#btnLocal');
  await expect(page.locator('#settings.open')).toBeVisible();
  await expect(page.locator('#webgpuBadge')).toContainText(/WebGPU/);
  await page.selectOption('#engKind', 'local');
  await expect(page.locator('#localBlock')).toBeVisible();
  await expect(page.locator('#localModel option')).toHaveCount(5);
  await page.click('#btnLoadLocal');
  await expect.poll(async () => page.evaluate(async () => {
    const s = await window.__AIB_TOOLS__.callTool('local_model_status');
    return !!(s && s.ready);
  }), { timeout: 10000 }).toBeTruthy();
  await expect(page.locator('#localProg')).toContainText(/Qwen|Gemma|Llama|mock|%/i);
  const tools = await page.evaluate(() => window.__AIB_TOOLS__.listTools().map(t => t.name));
  expect(tools).toEqual(expect.arrayContaining(['local_models_list', 'local_model_load', 'local_model_unload', 'local_model_status', 'webgpu_detect', 'kb_embed_status']));
  const list = await page.evaluate(async () => await window.__AIB_TOOLS__.callTool('local_models_list'));
  expect(list.catalog.length).toBeGreaterThanOrEqual(4);
  expect(list.webgpu.ok).toBeTruthy();
  await page.click('#btnUnloadLocal');
  await expect.poll(async () => page.evaluate(async () => !(await window.__AIB_TOOLS__.callTool('local_model_status')).ready)).toBeTruthy();
});

test('WebGPU missing: local option grayed with clear reason', async ({ page }) => {
  await gotoMock(page, { ok: false, reason: 'no-navigator-gpu' });
  await page.click('#btnSettings');
  await expect(page.locator('#webgpuBadge')).toContainText(/WebGPU|GPU/);
  await expect(page.locator('#webgpuReason')).toBeVisible();
  await expect(page.locator('#webgpuReason')).toContainText(/WebGPU/);
  expect(await page.locator('#engKind option[value=local]').isDisabled()).toBeTruthy();
  // reveal local block via DOM to assert load button is disabled
  await page.evaluate(() => { document.getElementById('localBlock').style.display = ''; });
  await expect(page.locator('#btnLoadLocal')).toBeDisabled();
});

test('phone UA: memory warning for 3B model', async ({ page }) => {
  await page.addInitScript(() => {
    window.__AIB_MOCK_WEBGPU__ = { ok: true };
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' });
  });
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => !!window.__AIB_TOOLS__);
  await page.click('#btnLocal');
  await page.selectOption('#engKind', 'local');
  await page.selectOption('#localModel', 'Qwen2.5-3B-Instruct-q4f16_1-MLC');
  await expect(page.locator('#localWarn')).toBeVisible();
  await expect(page.locator('#localWarn')).toContainText(/GB|内存|memory|crash|崩溃/i);
  const warn = await page.evaluate(async () => await window.__AIB_TOOLS__.callTool('local_model_memory_warning', { modelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC' }));
  expect(warn.level).toBe('high');
});

test('mock local chat + EmbeddingGemma vector mode', async ({ page }) => {
  await gotoMock(page, { ok: true });
  await page.click('#btnLocal');
  await page.selectOption('#engKind', 'local');
  await page.click('#btnLoadLocal');
  await expect.poll(async () => page.evaluate(async () => (await window.__AIB_TOOLS__.callTool('local_model_status')).ready)).toBeTruthy();
  await page.selectOption('#kbEmbed', 'vector');
  await page.click('#btnSave');
  await expect(page.locator('#settings.open')).toHaveCount(0);
  // Save does not auto-close in current UI — close explicitly
  if (await page.locator('#settings.open').count()) await page.click('#btnCloseSettings');
  await expect(page.locator('#settings.open')).toHaveCount(0);
  await page.fill('#q', 'hello local');
  await page.click('#btnSend');
  await expect.poll(async () => page.locator('#answer').innerText(), { timeout: 10000 }).toContain('[mock local] hello local');
  const emb = await page.evaluate(async () => await window.__AIB_TOOLS__.callTool('kb_embed_status'));
  expect(emb.mode).toBe('vector');
});
