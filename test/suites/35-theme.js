'use strict';
// Light / dark / follow-system appearance (Felix: theme switching was broken).
// Before v5.5 the desktop only set data-theme on <html>: no stylesheet used it, so all four palettes looked the same and
// "暖沙" (sand) only flipped color-scheme to light (light form controls on dark panels). The web app swapped text colours
// but not backgrounds, so sand gave dark-brown text on a near-black page (1.1:1). There was no light / dark / system mode.
// This suite checks, on desktop and web:
//  * switching applies immediately in every open page, overlay and embedded panel (no reload);
//  * it persists across a restart (desktop) / reload (web) and the first paint already uses it;
//  * "Follow system" follows prefers-color-scheme changes live;
//  * every page and overlay keeps text contrast >= 4.5:1 in every palette.
const { launch, sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer } = require('../lib/mock-server');
const { audit } = require('../lib/contrast');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..', '..');
const Theme = require(path.join(ROOT, 'src/renderer/static/theme.js'));

const lumHex = (h) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lumHex(a), y = lumHex(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function staticServer(dir) {
  const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json', wasm: 'application/wasm' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = path.join(dir, u === '/' ? 'index.html' : u);
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).slice(1)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

module.exports = async ({ test, group, assert, eq, until }) => {
  group('外观：浅色 / 深色 / 跟随系统（桌面 + 网页）');

  await test('theme.js：迁移旧设置、解析跟随系统、网页副本一致、调色板对比度', async () => {
    eq(Theme.normAppearance({ theme: 'sand' }), { mode: 'light', theme: 'aurora', light: 'sand' }, 'legacy sand → light');
    eq(Theme.normAppearance({ theme: 'night' }), { mode: 'dark', theme: 'night', light: 'sand' }, 'legacy night → dark');
    eq(Theme.normAppearance({}), { mode: 'dark', theme: 'aurora', light: 'sand' }, 'default');
    eq(Theme.normAppearance({ mode: 'bogus', theme: 'nope', light: 'night' }), { mode: 'dark', theme: 'aurora', light: 'sand' }, 'invalid values');
    eq(Theme.resolve({ mode: 'system', theme: 'ink', light: 'paper' }, true).id, 'ink');
    eq(Theme.resolve({ mode: 'system', theme: 'ink', light: 'paper' }, false).id, 'paper');
    eq(Theme.resolve({ mode: 'light', theme: 'ink', light: 'paper' }, true).id, 'paper', 'forced light ignores the OS');
    eq(fs.readFileSync(path.join(ROOT, 'web/js/theme.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'src/renderer/static/theme.js'), 'utf8'), 'web/js/theme.js must be a copy of src/renderer/static/theme.js');
    const probs = [];
    for (const t of Object.values(Theme.THEMES)) {
      const d = Object.assign({ '--text-primary': '#f7f7f9', '--text-tertiary': '#a9adb6', '--bg-base': '#050508' }, t.desktop);
      const bgs = [d['--bg-base'], t.desktop['--bg-solid'] || '#141b1d'].filter(x => /^#/.test(x));
      for (const bg of bgs) for (const k of ['--text-primary', '--text-secondary', '--text-tertiary', '--text-link', '--green-text']) {
        const fg = d[k]; if (!fg || !/^#/.test(fg)) continue;
        const r = ratio(fg, bg); if (r < 4.5) probs.push(`${t.id} desktop ${k} ${fg} on ${bg} = ${r.toFixed(2)}`);
      }
      if (t.scheme === 'light') { const r = ratio('#ffffff', t.desktop['--accent']); if (r < 4.5) probs.push(`${t.id} white on accent ${r.toFixed(2)}`); }
      const w = Object.assign({ '--bg': '#07100f', '--panel': '#0b1416', '--text': '#e8f0ea', '--muted': '#8aa096' }, t.web);
      for (const bg of [w['--bg'], w['--panel'], w['--panel2']].filter(Boolean)) for (const k of ['--text', '--muted']) { const r = ratio(w[k], bg); if (r < 4.5) probs.push(`${t.id} web ${k} on ${bg} = ${r.toFixed(2)}`); }
    }
    eq(probs, [], 'palette contrast');
  });

  // ---------------------------------------------------------------- desktop
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-theme-'));
  const llm = await createLlmServer(); seedSettings(ud, Object.assign(apiSettings(llm.port), { onboarding: { completed: true, skipped: false, completedAt: 1 } }));
  let app = await launch({ userData: ud });
  let ch = await app.chrome(); await sleep(600);
  const themeOf = (p) => p.evaluate(() => ({ id: document.documentElement.dataset.theme, scheme: document.documentElement.dataset.scheme, cs: getComputedStyle(document.documentElement).colorScheme, base: getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() }));
  const norm = (u) => String(u || '').replace(/^(aibrowser:\/\/[a-z]+)\/(?=\?|$)/, '$1');
  // one tab per page, kept open: reused (activated) for every palette, so already-open pages are what gets checked
  const tabsByUrl = new Map();
  const open = async (url) => {
    if (!tabsByUrl.has(url)) {
      const before = new Set(app.ctx.pages());
      await ch.evaluate((u) => window.aib.invoke('nav:openUrl', u), url);
      const p = await until(() => app.ctx.pages().find(x => !before.has(x) && norm(x.url()) === url), 15000, 'open ' + url);
      tabsByUrl.set(url, p);
    }
    const st = await ch.evaluate(() => window.aib.invoke('tabs:state'));
    const t = st.tabs.find(x => norm(x.url) === url);
    if (t && !t.active) { await ch.evaluate((id) => window.aib.invoke('tab:activate', id), t.id); await sleep(600); }
    return tabsByUrl.get(url);
  };

  // pages opened once, kept in tabs, so "applies immediately" is checked on pages that were already open
  const settings = await open('aibrowser://settings');
  await settings.click('[data-nav="general"]'); await sleep(400);
  await test('设置 → 通用：外观三档 + 深色 / 浅色主题网格', async () => {
    const modes = await settings.locator('#thmode [data-mode]').evaluateAll(a => a.map(x => x.dataset.mode));
    eq(modes, ['system', 'light', 'dark']);
    assert(await settings.locator('#thdark [data-theme]').count() >= 3, 'dark palettes');
    assert(await settings.locator('#thlight [data-light]').count() >= 2, 'light palettes');
  });
  const home = await open('aibrowser://home');
  await open('aibrowser://settings');

  await test('切换立即生效：已打开的设置页、主页、标签栏（不刷新）', async () => {
    await settings.click('#thmode [data-mode="light"]');
    await until(async () => (await themeOf(ch)).scheme === 'light', 5000, 'chrome light');
    for (const p of [ch, settings, home].filter(Boolean)) { const t = await themeOf(p); eq([t.id, t.scheme, t.cs], ['sand', 'light', 'light'], p.url()); }
    await settings.click('#thlight [data-light="paper"]');
    await until(async () => (await themeOf(ch)).id === 'paper', 5000, 'paper');
    await settings.click('#thdark [data-theme="night"]'); // picking a dark palette while in light mode switches to dark
    await until(async () => (await themeOf(ch)).id === 'night', 5000, 'night');
    eq((await themeOf(settings)).scheme, 'dark');
    const mode = await settings.evaluate(() => window.aib.invoke('settings:get').then(s => s.appearance));
    eq(mode, { theme: 'night', mode: 'dark', light: 'paper' }, 'stored appearance');
  });

  await test('跟随系统：系统外观变化时实时切换', async () => {
    await open('aibrowser://settings'); await settings.click('#thmode [data-mode="system"]'); await sleep(500);
    for (const scheme of ['light', 'dark', 'light']) {
      for (const p of [ch, settings]) await p.emulateMedia({ colorScheme: scheme });
      await until(async () => (await themeOf(settings)).scheme === scheme && (await themeOf(ch)).scheme === scheme, 5000, 'follow ' + scheme);
      eq((await themeOf(settings)).id, scheme === 'light' ? 'paper' : 'night');
    }
    for (const p of [ch, settings]) await p.emulateMedia({ colorScheme: null });
  });

  // contrast in every palette across pages and overlays
  const urls = ['aibrowser://home', 'aibrowser://tool?id=solve', 'aibrowser://tool?id=dict', 'aibrowser://tool?id=wiki', 'aibrowser://tool?id=physics', 'aibrowser://tool?id=geogebra',
    'aibrowser://history', 'aibrowser://downloads', 'aibrowser://bookmarks', 'aibrowser://extensions', 'aibrowser://selfmod', 'aibrowser://onboarding'];
  // a chat with an answer (markdown, code block, model tag)
  await ch.evaluate(() => window.aib.invoke('nav:openUrl', 'aibrowser://home')); await sleep(800);
  await app.setMode('chat'); await app.submit('什么是牛顿第一定律？'); const chatPage = await app.waitPage(u => u.startsWith('aibrowser://chat'), 10000); await sleep(2500);
  const chatUrl = norm(chatPage.url()); tabsByUrl.set(chatUrl, chatPage);
  for (const id of ['aurora', 'night', 'ink', 'sand', 'paper']) {
    await test(`对比度 ≥ 4.5:1：${id}（所有页面、覆盖层、设置各面板、物理面板）`, async () => {
      const t = Theme.THEMES[id];
      await ch.evaluate((a) => window.aib.invoke('settings:patch', { appearance: a }), t.scheme === 'light' ? { mode: 'light', light: id } : { mode: 'dark', theme: id });
      await sleep(400);
      const problems = []; let checked = 0;
      const check = async (name, p) => { const r = await audit(p); checked += r.checked; r.themes.filter(x => x && x !== id).forEach(x => problems.push(`${name}: frame theme ${x} != ${id}`)); r.bad.forEach(b => problems.push(name + ': ' + b)); };
      await check('chrome', ch);
      await open(chatUrl); await check('chat', chatPage);
      for (const u of urls) {
        const p = await open(u); await sleep(u.includes('physics') || u.includes('geogebra') ? 600 : 250);
        if (u.endsWith('physics') && !p.frames().find(f => f.url().includes('aib.physics/panel.html'))) { await p.click('#openBoard'); await until(() => p.frames().find(f => f.url().includes('aib.physics/panel.html')), 8000, 'physics frame'); await sleep(1500); }
        await check(u, p);
      }
      for (const nav of await settings.locator('.settings-nav .nav-item').evaluateAll(a => a.map(x => x.getAttribute('data-nav')))) {
        await open('aibrowser://settings'); await settings.click(`[data-nav="${nav}"]`); await sleep(nav === 'dict' || nav === 'ext' || nav === 'history' ? 1200 : 350);
        await check('settings/' + nav, settings);
      }
      // overlays: menu, find bar, confirm dialog
      await ch.evaluate(() => window.aib.invoke('menu:toggle')); const menu = await app.waitPage('aibrowser://menu', 5000); await sleep(400); await check('menu overlay', menu);
      await ch.evaluate(() => window.aib.invoke('menu:close')).catch(() => {});
      const hp = await open('aibrowser://history');
      await hp.evaluate(() => { window.AIBConfirm && window.AIBConfirm.ask({ title: '删除？', message: '确认删除这条记录', detail: '无法撤销', danger: true }); }); await sleep(300);
      await check('confirm dialog', hp); await hp.keyboard.press('Escape').catch(() => {});
      assert(checked > 300, 'checked text nodes: ' + checked);
      eq(problems, [], problems.length + ' contrast problems');
    });
  }

  await test('重启后保持：首帧即为所选外观（HTML 内联主题，无闪烁）', async () => {
    await ch.evaluate(() => window.aib.invoke('settings:patch', { appearance: { mode: 'light', light: 'sand' } }));
    await app.close(); await sleep(500);
    app = await launch({ userData: ud });
    ch = await app.chrome();
    // the attribute is in the served HTML, before any script ran
    const served = await ch.evaluate(async () => (await fetch('aibrowser://home')).text());
    assert(/<html[^>]*data-theme="sand"[^>]*data-scheme="light"/.test(served), 'served html: ' + served.slice(0, 200));
    assert(served.includes('id="aib-theme-vars"'), 'inline palette');
    eq((await themeOf(ch)).id, 'sand');
    const tab = await app.waitPage(u => norm(u) === 'aibrowser://home', 10000); eq((await themeOf(tab)).scheme, 'light');
  });
  await app.close(); llm.close && llm.close();

  // ---------------------------------------------------------------- web app (PWA / old iPad build)
  const { srv, port } = await staticServer(path.join(ROOT, 'web'));
  const wapp = await launch({});
  const wch = await wapp.chrome(); await sleep(500);
  await wapp.submit(`http://127.0.0.1:${port}/index.html`);
  const wp = await wapp.waitPage(u => u.startsWith(`http://127.0.0.1:${port}/`), 15000); await sleep(1500);
  const wtheme = () => wp.evaluate(() => ({ id: document.documentElement.dataset.theme, scheme: document.documentElement.dataset.scheme, bg: getComputedStyle(document.body).backgroundColor }));
  await test('网页版：外观切换立即生效 + 刷新后保持 + 跟随系统 + 对比度', async () => {
    eq((await wtheme()).id, 'aurora');
    await until(() => wp.evaluate(() => { document.getElementById('btnSettings').click(); return !!document.querySelector('#themeMode [data-mode="light"]'); }), 10000, 'web settings');

    await wp.evaluate(() => document.querySelector('#themeMode [data-mode="light"]').click()); await sleep(300);
    eq((await wtheme()).id, 'sand'); eq((await wtheme()).bg, 'rgb(244, 235, 224)');
    const r1 = await audit(wp); eq(r1.bad, [], 'web light contrast');
    await wp.evaluate(() => document.querySelector('#themeGridLight [data-light="paper"]').click()); await sleep(300);
    eq((await wtheme()).id, 'paper');
    const r2 = await audit(wp); eq(r2.bad, [], 'web paper contrast');
    await wp.reload(); await sleep(1200); eq((await wtheme()).id, 'paper', 'after reload');
    await until(() => wp.evaluate(() => { document.getElementById('btnSettings').click(); return !!document.querySelector('#themeMode [data-mode="system"]'); }), 10000, 'web settings 2');
    await wp.evaluate(() => document.querySelector('#themeMode [data-mode="system"]').click()); await sleep(200);
    await wp.emulateMedia({ colorScheme: 'dark' }); await until(async () => (await wtheme()).scheme === 'dark', 4000, 'web follow dark');
    await wp.emulateMedia({ colorScheme: 'light' }); await until(async () => (await wtheme()).scheme === 'light', 4000, 'web follow light');
    await wp.evaluate(() => document.querySelector('#themeMode [data-mode="dark"]').click()); await sleep(200);
    await wp.emulateMedia({ colorScheme: null });
    for (const id of ['night', 'ink']) { await wp.evaluate((i) => document.querySelector(`#themeGrid [data-theme="${i}"]`).click(), id); await sleep(250); eq((await wtheme()).id, id); const r = await audit(wp); eq(r.bad, [], 'web ' + id); }
  });
  await wapp.close(); srv.close();
};
