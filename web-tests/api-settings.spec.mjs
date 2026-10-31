import { test, expect } from '@playwright/test';
const URL_ = 'http://127.0.0.1:8765/';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const reply = (route, status, body) => route.request().method() === 'OPTIONS'
  ? route.fulfill({ status: 204, headers: CORS })
  : route.fulfill({ status, contentType: 'application/json', headers: CORS, body });
const API = 'https://api.deepseek.com/v1/chat/completions';

async function openSettings(page){ await page.goto(URL_); await page.click('#btnSettings'); await expect(page.locator('#settings.open .sheet')).toBeVisible(); }

test.describe('API settings', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Test uses the values typed in the form (trimmed), exact URL + Authorization header', async ({ page }) => {
    let seen = null;
    await page.route(API, async route => { if (route.request().method() === 'POST') seen = { url: route.request().url(), h: route.request().headers(), body: route.request().postDataJSON() };
      await reply(route, 200, JSON.stringify({ choices: [{ message: { content: 'pong' } }] })); });
    await openSettings(page);
    await page.fill('#apiBase', '  https://api.deepseek.com/v1/  \n');
    await page.fill('#apiKey', '  sk-abc123\n ');
    await page.fill('#apiModel', ' deepseek-chat \n');
    await page.click('#btnTest'); // NOT saved first
    await expect(page.locator('#toast')).toContainText('OK');
    expect(seen.url).toBe(API);
    expect(seen.h['authorization']).toBe('Bearer sk-abc123');
    expect(seen.h['content-type']).toContain('application/json');
    expect(seen.body.model).toBe('deepseek-chat');
    // form shows the cleaned values and they were persisted
    await expect(page.locator('#apiKey')).toHaveValue('sk-abc123');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aib.settings.v1')).api);
    expect(stored).toMatchObject({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-abc123', model: 'deepseek-chat' });
  });

  test('base URL that already ends with /chat/completions or has no /v1 is not doubled', async ({ page }) => {
    const urls = [];
    await page.route('https://example.test/**', async route => { if (route.request().method() === 'POST') urls.push(route.request().url()); await reply(route, 200, '{"choices":[{"message":{"content":"ok"}}]}'); });
    await openSettings(page);
    await page.fill('#apiKey', 'k'); await page.fill('#apiModel', 'm');
    await page.fill('#apiBase', 'https://example.test/v1/chat/completions/'); await page.click('#btnTest'); await expect(page.locator('#toast')).toContainText('OK');
    await page.fill('#apiBase', 'https://example.test///'); await page.click('#btnTest');
    await expect.poll(() => urls.length).toBe(2);
    expect(urls[0]).toBe('https://example.test/v1/chat/completions');
    expect(urls[1]).toBe('https://example.test/chat/completions');
  });

  test('401 maps to a clear Chinese/English reason; toast never covers the action row', async ({ page }) => {
    await page.route(API, route => reply(route, 401, '{"error":{"message":"Authentication Fails (governor)"}}'));
    await openSettings(page);
    await page.fill('#apiBase', 'https://api.deepseek.com/v1'); await page.fill('#apiKey', 'sk-bad'); await page.fill('#apiModel', 'deepseek-chat');
    await page.click('#btnTest');
    const toast = page.locator('#toast');
    await expect(toast).toContainText('API Key 无效或已失效');
    await expect(toast).toContainText('Invalid API key');
    const tb = await toast.boundingBox();
    for (const id of ['#btnSave', '#btnTest', '#btnCloseSettings']) {
      await page.locator(id).scrollIntoViewIfNeeded();
      const bb = await page.locator(id).boundingBox();
      const overlap = !(tb.y + tb.height <= bb.y || bb.y + bb.height <= tb.y || tb.x + tb.width <= bb.x || bb.x + bb.width <= tb.x);
      expect(overlap, id + ' overlapped by toast').toBeFalsy();
    }
    expect(tb.y).toBeLessThan(120);
  });

  test('key input is autofill-hardened and masked-dot values are rejected clearly', async ({ page }) => {
    await openSettings(page);
    const attrs = await page.locator('#apiKey').evaluate(e => ({ t: e.type, ac: e.autocomplete, sp: e.spellcheck, cap: e.getAttribute('autocapitalize') }));
    expect(attrs.t).toBe('password');
    expect(['new-password','off']).toContain(attrs.ac);
    expect(attrs.sp).toBe(false);
    expect(attrs.cap).toBe('off');
    await page.fill('#apiBase', 'https://api.deepseek.com/v1'); await page.fill('#apiModel', 'deepseek-chat');
    await page.evaluate(() => { document.getElementById('apiKey').value = '••••••••'; });
    await page.click('#btnTest');
    await expect(page.locator('#toast')).toContainText('非法字符');
  });
});
