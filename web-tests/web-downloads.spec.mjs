import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });
const ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
const BASE = `https://mock.test/models/${ID}`;
const SHARDS = 5, SIZE = 200 * 1024;
const shardBytes = (i) => Buffer.alloc(SIZE, i + 1);

// mock hub: manifest + shards; `ctl` lets a test fail or hold specific shard requests
async function mockHub(page, ctl = {}) {
  const hits = {};
  await page.route('https://mock.test/**', async (route) => {
    const url = route.request().url(); const cors = { 'access-control-allow-origin': '*' };
    if (url.endsWith('/resolve/main/ndarray-cache.json')) {
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ records: Array.from({ length: SHARDS }, (_, i) => ({ dataPath: `params_shard_${i}.bin`, nbytes: SIZE })) }) });
    }
    const m = url.match(/params_shard_(\d+)\.bin$/); if (!m) return route.fulfill({ status: 404, headers: cors, body: '' });
    const i = Number(m[1]); hits[i] = (hits[i] || 0) + 1;
    if (ctl.dropOnce && ctl.dropOnce.includes(i) && hits[i] === 1) return route.abort('connectionreset');
    if (ctl.hold && ctl.hold.i === i && !ctl.hold.released) { await new Promise(r => { ctl.hold.release = () => { ctl.hold.released = true; r(); }; ctl.hold.reached && ctl.hold.reached(); }); }
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/octet-stream' }, body: shardBytes(i) });
  });
  return hits;
}
async function boot(page) {
  await page.addInitScript((base) => { window.__AIB_MOCK_WEBGPU__ = { ok: true, shardBase: base, backoffMs: 20, maxRetries: 5 }; window.__AIB_MOCK_EMBED__ = { ok: true }; }, BASE);
  await page.goto('http://127.0.0.1:8765/');
  await page.waitForFunction(() => !!window.__AIB_TOOLS__);
  await page.click('#btnLocal'); await page.selectOption('#engKind', 'local');
}
const cachedShards = (page) => page.evaluate(async () => { const c = await caches.open('webllm/model'); return (await c.keys()).filter(r => /params_shard_\d+\.bin$/.test(r.url)).map(r => Number(r.url.match(/shard_(\d+)/)[1])).sort(); });

test('network drop mid-shard: retries automatically, completed shards are not re-downloaded', async ({ page }) => {
  const hits = await mockHub(page, { dropOnce: [2] });
  await boot(page);
  await page.click('#btnLoadLocal');
  await expect.poll(async () => page.evaluate(async () => (await window.__AIB_TOOLS__.callTool('local_model_status')).ready), { timeout: 15000 }).toBeTruthy();
  expect(hits[2]).toBeGreaterThanOrEqual(2);                       // dropped once, then retried
  for (const i of [0, 1, 3, 4]) expect(hits[i]).toBe(1);           // finished shards never fetched twice
  expect(await cachedShards(page)).toEqual([0, 1, 2, 3, 4]);
});

test('pause keeps finished shards; resume continues from the next shard; status text shown', async ({ page }) => {
  const ctl = { hold: { i: 2 } }; let reached; const reachedP = new Promise(r => { reached = r; }); ctl.hold.reached = reached;
  const hits = await mockHub(page, ctl);
  await boot(page);
  await page.click('#btnLoadLocal');
  await reachedP;                                                   // shards 0,1 done, shard 2 in flight (held)
  await expect(page.locator('#btnPauseLocal')).toBeVisible();
  await expect(page.locator('#localProg')).toContainText(/2\/5/);
  await page.click('#btnPauseLocal');
  await expect(page.locator('#btnResumeLocal')).toBeVisible();
  await expect(page.locator('#localProg')).toContainText(/已暂停|Paused/);
  expect(await cachedShards(page)).toEqual([0, 1]);                 // completed shards survive
  ctl.hold.release();                                               // let the aborted request finish harmlessly
  await page.click('#btnResumeLocal');
  await expect.poll(async () => page.evaluate(async () => (await window.__AIB_TOOLS__.callTool('local_model_status')).ready), { timeout: 15000 }).toBeTruthy();
  expect(hits[0]).toBe(1); expect(hits[1]).toBe(1);                 // resume did NOT re-download shards 0/1
  expect(await cachedShards(page)).toEqual([0, 1, 2, 3, 4]);
});

test('storage list: files vs cache, estimate, clear cache / delete via confirm dialog (default focus Cancel)', async ({ page }) => {
  const ctl = { hold: { i: 3 } }; let reached; const reachedP = new Promise(r => { reached = r; }); ctl.hold.reached = reached;
  await mockHub(page, ctl);
  await boot(page);
  await page.click('#btnLoadLocal'); await reachedP; await page.click('#btnPauseLocal'); ctl.hold.release();
  await expect(page.locator('#btnResumeLocal')).toBeVisible();
  await page.evaluate(() => window.__AIB_TOOLS__.callTool('local_models_disk_usage'));
  // partial model: its bytes are CACHE; clear-cache enabled
  const rep = await page.evaluate(() => window.__AIB_TOOLS__.callTool('local_models_disk_usage'));
  const row = rep.models.find(m => m.id.startsWith('Qwen2.5-0.5B')); expect(row.complete).toBe(false); expect(row.cacheBytes).toBeGreaterThan(SIZE * 2); expect(row.filesBytes).toBe(0);
  expect(rep.estimate && rep.estimate.quota > 0).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // (refresh hook)
  await page.click('#btnResumeLocal');
  await expect.poll(async () => page.evaluate(async () => (await window.__AIB_TOOLS__.callTool('local_model_status')).ready), { timeout: 15000 }).toBeTruthy();
  // now complete: files bucket, no cache
  const rep2 = await page.evaluate(() => window.__AIB_TOOLS__.callTool('local_models_disk_usage'));
  const r2 = rep2.models.find(m => m.id.startsWith('Qwen2.5-0.5B')); expect(r2.complete).toBe(true); expect(r2.filesBytes).toBeGreaterThan(SIZE * 5 - 1); expect(r2.cacheBytes).toBe(0);
  await expect(page.locator('#localDisk .mrow')).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('#localDisk')).toContainText(/存储占用|Storage/);
  // delete -> confirm dialog; Esc cancels; focus on Cancel
  await page.click('#localDisk [data-dact="del"]');
  await expect(page.locator('#cfDialog')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement.id)).toBe('cfCancel');
  await page.keyboard.press('Escape'); await expect(page.locator('#cfDialog')).toHaveCount(0);
  expect((await cachedShards(page)).length).toBe(5);
  await page.click('#localDisk [data-dact="del"]'); await page.click('#cfOk');
  await expect(page.locator('#cfDone')).toContainText(/已释放|Freed/);
  expect((await cachedShards(page)).length).toBe(0);
});

test('agent tools: delete goes through the confirmation dialog; declining deletes nothing', async ({ page }) => {
  await mockHub(page, {});
  await boot(page);
  await page.click('#btnLoadLocal');
  await expect.poll(async () => page.evaluate(async () => (await window.__AIB_TOOLS__.callTool('local_model_status')).ready), { timeout: 15000 }).toBeTruthy();
  const names = await page.evaluate(() => window.__AIB_TOOLS__.listTools().map(t => t.name));
  for (const n of ['local_models_download', 'local_models_pause', 'local_models_resume', 'local_models_disk_usage', 'local_models_clear_cache', 'local_models_delete']) expect(names).toContain(n);
  const p = page.evaluate(() => window.__AIB_TOOLS__.callTool('local_models_delete', { modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' }));
  await expect(page.locator('#cfDialog')).toContainText(/AI/);
  await page.click('#cfCancel');
  const r = await p; expect(r.declined).toBe(true);
  expect((await cachedShards(page)).length).toBe(5);
  const p2 = page.evaluate(() => window.__AIB_TOOLS__.callTool('local_models_delete', { modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' }));
  await page.click('#cfOk'); const r2 = await p2; expect(r2.freed).toBeGreaterThan(0);
  expect((await cachedShards(page)).length).toBe(0);
});

test('KB clear asks for confirmation (count, danger button, focus on Cancel) and shows 已清除 N', async ({ page }) => {
  await page.addInitScript(() => { window.__AIB_MOCK_WEBGPU__ = { ok: false }; });
  await page.goto('http://127.0.0.1:8765/'); await page.waitForFunction(() => !!window.__AIB_TOOLS__);
  const addNote = async (txt) => { await page.evaluate((x) => { document.getElementById('kbText').value = x; document.getElementById('kbAdd').click(); }, txt); };
  const count = () => page.evaluate(() => document.querySelectorAll('#kbList > *').length);
  await addNote('alpha note about physics'); await addNote('beta note about chemistry');
  await expect.poll(count, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const n = await count();
  await page.evaluate(() => document.getElementById('kbClear').click());
  await expect(page.locator('#cfDialog')).toContainText(new RegExp(String(n)));
  expect(await page.evaluate(() => document.activeElement.id)).toBe('cfCancel');
  await page.click('#cfCancel');
  expect(await count()).toBe(n);
  await page.evaluate(() => document.getElementById('kbClear').click()); await page.click('#cfOk');
  await expect(page.locator('#cfDone')).toContainText(/已清除|Cleared/);
  await expect.poll(count).toBe(0);
});
