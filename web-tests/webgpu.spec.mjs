import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

async function gotoMock(page, mock) {
  await page.addInitScript(m => { window.__AIB_MOCK_WEBGPU__ = m; window.__AIB_MOCK_EMBED__ = { ok: true }; }, mock);
  await page.goto('http://127.0.0.1:8765/');
}

test('WebGPU available: local engine enabled, catalog, progress, tools, phone warning', async ({ page }) => {
  await gotoMock(page, { ok: true });
  await expect(page.locator('#btnLocal')).toBeVisible();
  await expect(page.locator('#btnLocal')).not.toHaveClass(/disabled/);
  await expect(page.locator('button[data-desktop-only]').first()).toHaveClass(/disabled/);
  await page.click('#btnLocal');
  await expect(page.locator('#settings.open')).toBeVisible();
  await expect(page.locator('#engKind')).toBeVisible();
  await expect(page.locator('#webgpuBadge')).toContainText(/WebGPU/);
  await page.selectOption('#engKind', 'local');
  await expect(page.locator('#localBlock')).toBeVisible();
  await expect(page.locator('#localModel option')).toHaveCount(5);
  // load with mock progress
  await page.click('#btnLoadLocal');
  await expect.poll(async () => page.locator('#localProg').innerText()).toMatch(/%|mock|Qwen|Gemma|Llama/i);
  // agent tools exposed
  const tools = await page.evaluate(() => window.__AIB_TOOLS__.listTools().map(t => t.name));
  expect(tools).toEqual(expect.arrayContaining(['local_models_list', 'local_model_load', 'local_model_unload', 'local_model_status', 'webgpu_detect']));
  const st = await page.evaluate(() => window.__AIB_TOOLS__.callTool('local_model_status'));
  expect(st.ready).toBeTruthy();
  const list = await page.evaluate(() => window.__AIB_TOOLS__.callTool('local_models_list'));
  expect(list.catalog.length).toBeGreaterThanOrEqual(4);
  // memory warning helper returns null on desktop viewport UA
  const warn = await page.evaluate(() => window.__AIB_TOOLS__.callTool('local_model_memory_warning', { modelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC' }));
  // may be null on desktop UA; on phone UA we check separately
  expect(warn === null || warn.level).toBeTruthy();
  await page.click('#btnUnloadLocal');
  const st2 = await page.evaluate(() => window.__AIB_TOOLS__.callTool('local_model_status'));
  expect(st2.ready).toBeFalsy();
});

test('WebGPU missing: local option grayed with clear reason', async ({ page }) => {
  await gotoMock(page, { ok: false, reason: 'no-navigator-gpu' });
  await page.click('#btnSettings');
  await expect(page.locator('#webgpuBadge')).toContainText(/WebGPU|GPU/);
  const disabled = await page.locator('#engKind option[value=local]').isDisabled();
  expect(disabled).toBeTruthy();
  await page.selectOption('#engKind', 'api'); // stay on api
  await page.locator('#engKind').selectOption('local').catch(() => {});
  // even if select attempted, load stays disabled
  await expect(page.locator('#btnLoadLocal')).toBeDisabled();
  await expect(page.locator('#localWarn')).toContainText(/WebGPU/);
});

test('phone UA: memory warning for 3B model', async ({ page }) => {
  await page.addInitScript(() => {
    window.__AIB_MOCK_WEBGPU__ = { ok: true };
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' });
  });
  await page.goto('http://127.0.0.1:8765/');
  await page.click('#btnLocal');
  await page.selectOption('#engKind', 'local');
  await page.selectOption('#localModel', 'Qwen2.5-3B-Instruct-q4f16_1-MLC');
  await expect(page.locator('#localWarn')).toBeVisible();
  await expect(page.locator('#localWarn')).toContainText(/GB|内存|memory|crash|崩溃/i);
});

test('EmbeddingGemma vector mode toggles via mock; chat uses local engine when ready', async ({ page }) => {
  await gotoMock(page, { ok: true, chat: async (msgs) => 'LOCAL:' + (msgs.at(-1)?.content || '') });
  await page.click('#btnLocal');
  await page.selectOption('#engKind', 'local');
  await page.click('#btnLoadLocal');
  await expect.poll(async () => page.evaluate(() => window.__AIB_TOOLS__.callTool('local_model_status').then(s => s.ready))).toBeTruthy();
  await page.selectOption('#kbEmbed', 'vector');
  await page.click('#btnSave');
  await page.fill('#q', 'hello local');
  await page.click('#btnSend');
  await expect.poll(async () => page.locator('#answer').innerText()).toMatch(/LOCAL:hello local/);
});
