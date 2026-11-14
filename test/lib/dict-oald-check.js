'use strict';
// Shared checks for the OALD-style MDX fixture (test/fixtures/dict-oald): the dictionary's own CSS / JS / fonts load
// from the .mdd, its script expands the senses, the entry frame is sized to the whole entry (not clipped to the first
// screen), the result area scrolls to the last line, @@@LINK / entry:// / sound:// resolve, and a reload of the tool view
// stays on the result.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function entryFrame(p, until, match = '__entry__') {
  return until(async () => { const fr = p.frames().filter(f => f.url().startsWith('aibdict://') && f.url().includes(match)); return fr.length ? fr[fr.length - 1] : null; }, 15000, 'dict entry frame');
}

async function checkOald({ page: p, until, assert, eq, word = 'apple', shot }) {
  await until(async () => (await p.locator('.dict-frame').count()) === 1, 15000, 'dict frame');
  const f = await entryFrame(p, until);
  // the dictionary's own script ran (jQuery-style helper + entry script, localStorage settings) and expanded the senses
  await until(async () => f.evaluate(() => document.body.classList.contains('oald-ready')), 10000, 'entry script ran');
  eq(await f.evaluate(() => document.body.dataset.oaldMode), 'full', 'localStorage settings');
  eq(await f.locator('.sense').count(), 3, 'senses');
  eq(await f.locator('.sensenum').count(), 3, 'senses numbered by the entry script');
  const css = await f.locator('.headword').evaluate(e => getComputedStyle(e).color + '|' + getComputedStyle(e).fontSize);
  eq(css, 'rgb(0, 40, 120)|26px', 'dictionary CSS from the .mdd (href OALDPE.css, stored as oaldpe.css)');
  assert(await f.locator('.senses_multiple').evaluate(e => getComputedStyle(e).display !== 'none'), 'senses visible');
  const font = await f.evaluate(async () => { await document.fonts.load('16px "OALD Icons"'); return document.fonts.check('16px "OALD Icons"') && [...document.fonts].some(x => x.family.replace(/"/g, '') === 'OALD Icons' && x.status === 'loaded'); });
  assert(font, 'dictionary font from the .mdd');
  eq(await f.locator('.aib-dict-missing').count(), 0, 'no missing-resource note');
  eq(await f.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)', 'white background unchanged');
  // frame sized to the whole entry; the result area scrolls to the last line
  const m = await until(async () => {
    const r = await p.evaluate(() => {
      const fr = document.querySelector('iframe.dict-frame'); const wrap = fr.closest('.dict-frame-wrap');
      return { fh: fr.getBoundingClientRect().height, wh: wrap.clientHeight, auto: wrap.classList.contains('autosize'), sh: wrap.scrollHeight };
    });
    const ch = await f.evaluate(() => document.body.scrollHeight);
    return r.auto && r.fh >= ch - 4 ? { ...r, ch } : null;
  }, 10000, 'frame sized to content');
  assert(m.ch > m.wh, `entry taller than the visible area (content ${m.ch}, area ${m.wh}) so the test covers clipping`);
  await p.evaluate(() => { const w = document.querySelector('.dict-frame-wrap'); w.scrollTop = w.scrollHeight; });
  await sleep(200);
  const vis = await p.evaluate(() => { const w = document.querySelector('.dict-frame-wrap').getBoundingClientRect(); const fr = document.querySelector('iframe.dict-frame').getBoundingClientRect(); return { top: w.top, bottom: w.bottom, frTop: fr.top }; });
  const last = await f.locator('#lastline').evaluate(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  const lastTop = vis.frTop + last.top, lastBottom = vis.frTop + last.bottom;
  assert(lastTop >= vis.top - 1 && lastBottom <= vis.bottom + 1, `last line reachable: ${JSON.stringify({ vis, last })}`);
  if (shot) await shot('dict-oald-end');
  // collapsible box opens with the dictionary's own handler and the frame grows with it
  const h0 = await p.evaluate(() => document.querySelector('iframe.dict-frame').getBoundingClientRect().height);
  await f.locator('.unbox .heading').first().click();
  await until(async () => f.evaluate(() => document.querySelector('.unbox').classList.contains('is-open')), 5000, 'box opened by the entry script');
  await until(async () => (await p.evaluate(() => document.querySelector('iframe.dict-frame').getBoundingClientRect().height)) > h0 + 20, 5000, 'frame grew after expanding');
  // sound:// from a subfolder of the .mdd
  await f.locator('a.sound').click();
  const src = await until(async () => f.evaluate(() => window.__aud && window.__aud.src), 5000, 'audio');
  assert(/\/uk_pron\/apple__gb_1\.mp3$/.test(src), src);
  const au = await f.evaluate(async () => { const r = await fetch(new URL('uk_pron/apple__gb_1.mp3', document.baseURI)); return r.status; });
  eq(au, 200, 'sound resource');
  // entry:// link (with a space in the key) and re-measuring on the shorter entry
  const big = await p.evaluate(() => document.querySelector('iframe.dict-frame').getBoundingClientRect().height);
  await f.locator('a.xr').click();
  const f2 = await entryFrame(p, until, 'apple%20tree');
  await until(async () => (await f2.locator('.headword').innerText().catch(() => '')) === 'apple tree', 8000, 'entry:// navigation');
  await until(async () => (await p.evaluate(() => document.querySelector('iframe.dict-frame').getBoundingClientRect().height)) < big - 100, 8000, 'frame re-measured for the shorter entry');
}

module.exports = { checkOald, entryFrame };
