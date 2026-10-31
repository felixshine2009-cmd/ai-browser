'use strict';
const { launch, sleep } = require('../lib/app');
const os = require('os'), fs = require('fs'), path = require('path');
const { PNG } = require('playwright-core/lib/utilsBundle');

// Felix bug (Mac, v1.0.1): the 词典 MDX/MDD list rendered on a WHITE canvas (iframe without color-scheme) with
// light-gray text. Every settings panel (incl. embedded extension iframes) must have: text contrast >= 4.5:1 against
// its effective background, no light surfaces, and a dark painted frame area.
const EVAL = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = (el) => {
    const layers = []; let e = el;
    while (e && e.nodeType === 1) { const cs = getComputedStyle(e); const c = parse(cs.backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 0.999) break; e = e.parentElement; }
    let base = [10, 10, 15, 1]; // window background (#0a0a0f) behind transparent roots
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };
  const bad = []; let checked = 0;
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const all = document.body ? Array.from(document.body.querySelectorAll('*')) : [];
  for (const el of all) {
    if (['SCRIPT', 'STYLE', 'IFRAME', 'SVG', 'PATH', 'CANVAS'].includes(el.tagName.toUpperCase())) continue;
    const own = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    const form = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !['checkbox', 'radio', 'hidden'].includes(el.type);
    if (!own && !form) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el); const bg = bgOf(el);
    const fg = over(parse(cs.color), bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    checked++;
    if (ratio < 4.5) bad.push({ el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''), text: (el.textContent || el.value || '').trim().slice(0, 30), ratio: Math.round(ratio * 100) / 100, fg: cs.color, bg: 'rgb(' + bg.slice(0, 3).map(Math.round) + ')' });
  }
  // light surfaces
  const light = [];
  for (const el of [document.documentElement, ...all]) {
    if (!visible(el) && el !== document.documentElement) continue;
    const c = parse(getComputedStyle(el).backgroundColor); if (c[3] < 0.5) continue;
    const bg = over(c, [10, 10, 15, 1]);
    const r = el.getBoundingClientRect();
    if (lum(bg) > 0.35 && r.width * r.height > 400 && !['INPUT', 'BUTTON'].includes(el.tagName) && !/^(tg|sw|knob|dot|radio|toggle)/.test(String(el.className))) light.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' ' + getComputedStyle(el).backgroundColor);
  }
  return { checked, bad, light };
};
const lumPng = (buf) => { const p = PNG.sync.read(buf); let s = 0, n = 0; for (let i = 0; i < p.data.length; i += 4 * 7) { s += (0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]) / 255; n++; } return s / n; };

module.exports = async ({ test, group, assert, eq, until }) => {
  group('设置页对比度：每个面板文字对比度 ≥ 4.5:1、无浅色底、iframe 画布为深色');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-contrast-'));
  const app = await launch({ userData: ud });
  const ch = await app.chrome();
  await app.submit('aibrowser://settings'); const sp = await app.waitPage(u => u.startsWith('aibrowser://settings')); await sleep(500);
  // seed a dictionary with a long Mac path (Felix's screenshot)
  await sp.evaluate(() => window.aib.invoke('settings:patch', { dicts: [{ id: 'oald', name: 'OALDPE – Oxford Advanced Learner\'s Dictionary of Current English', mdx: '/Users/user/Library/Application Support/AI-Browser/dictionaries/Oxford Advanced Learners Dictionary/oaldpe.mdx', mdd: ['/x/oaldpe.mdd'], enabled: true }, { id: 'b', name: 'Second', mdx: '/Users/user/b.mdx', mdd: [], enabled: false }] }));
  const ids = await sp.locator('.settings-nav .nav-item').evaluateAll(a => a.map(x => x.getAttribute('data-nav')));
  assert(ids.length >= 7, 'sections: ' + ids.join(','));
  for (const id of ids) {
    await test(`面板 ${id}：对比度 / 浅色底`, async () => {
      await sp.click(`[data-nav="${id}"]`); await sleep(id === 'ext' || id === 'dict' || id === 'history' ? 1500 : 500);
      const frames = sp.frames();
      let total = 0; const problems = [];
      for (const f of frames) {
        let r; try { r = await f.evaluate(EVAL); } catch { continue; }
        total += r.checked;
        r.bad.forEach(b => problems.push((f === sp.mainFrame() ? '' : '[iframe] ') + JSON.stringify(b)));
        r.light.forEach(l => problems.push((f === sp.mainFrame() ? '' : '[iframe] ') + 'LIGHT SURFACE ' + l));
      }
      assert(total > 3, 'checked text nodes: ' + total);
      eq(problems.length, 0, problems.slice(0, 6).join('\n'));
      // painted pixels of every iframe must be dark
      for (const h of await sp.locator('#pane iframe').elementHandles()) {
        const box = await h.boundingBox(); if (!box || box.height < 20) continue;
        const buf = await sp.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 300) } });
        const l = lumPng(buf); assert(l < 0.3, 'iframe paints a light canvas (mean luminance ' + l.toFixed(2) + ')');
      }
    });
  }
  await test('词典：长路径省略号 + 完整路径悬停提示 + 控件可见', async () => {
    await sp.click('[data-nav="dict"]'); await sleep(1200);
    const f = sp.frames().find(x => x.url().includes('aib.dictionary'));
    assert(f, 'dictionary frame');
    await until(async () => (await f.locator('.row').count()) >= 2, 5000, 'rows');
    const info = await f.evaluate(() => { const s = document.querySelector('.row small'); const cs = getComputedStyle(s); return { title: s.title, ell: cs.textOverflow, nowrap: cs.whiteSpace, over: s.scrollWidth > s.clientWidth, btns: Array.from(document.querySelectorAll('.row button.s')).every(b => b.getBoundingClientRect().width >= 24 && getComputedStyle(b).borderTopWidth !== '0px'), fw: getComputedStyle(document.querySelector('.row b')).fontWeight }; });
    assert(info.title.endsWith('oaldpe.mdx  + 1 mdd') || info.title.includes('oaldpe.mdx'), 'full path in title: ' + info.title);
    eq(info.ell, 'ellipsis'); assert(info.over, 'long path truncated'); assert(info.btns, 'buttons visible'); assert(Number(info.fw) >= 600, 'bold name');
  });
  await test('侧边栏当前项高亮清晰（对比度 ≥ 4.5 且背景明显）', async () => {
    const r = await sp.evaluate(() => { const a = document.querySelector('.settings-nav .nav-item.active'); const cs = getComputedStyle(a); return { bg: cs.backgroundColor, fw: cs.fontWeight, shadow: cs.boxShadow }; });
    assert(Number(r.fw) >= 600 && r.shadow !== 'none', JSON.stringify(r));
  });
  await app.close();
};
