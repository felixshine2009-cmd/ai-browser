'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { launch, seedSettings, apiSettings, sleep } = require('../lib/app');
const until = async (fn, ms, msg) => { const t0=Date.now(); while(Date.now()-t0<ms){ const v=await fn(); if(v) return v; await sleep(100);} throw new Error(msg||'until'); };

module.exports = async ({ test, group, assert }) => {
  group('首次安装向导（v3.0.0）');

  await test('全新用户数据：启动打开 onboarding；跳过后面进 home 且 completed=true', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ob-'));
    // empty settings → defaults (onboarding.completed=false)
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({}));
    const app = await launch({ userData: ud });
    try {
      const p = await app.waitPage(u => /aibrowser:\/\/onboarding/.test(u), 15000);
      assert(p, 'onboarding page');
      await sleep(800);
      const title = await p.evaluate(() => document.getElementById('title') && document.getElementById('title').textContent);
      assert(/语言|language|Choose/i.test(title || ''), 'lang step title: ' + title);
      await p.click('#btnSkip');
      await sleep(1200);
      const home = await app.waitPage(u => /aibrowser:\/\/home/.test(u), 10000);
      assert(home, 'home after skip');
      const s = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
      assert(s.onboarding && s.onboarding.completed === true, JSON.stringify(s.onboarding));
      assert(s.onboarding.skipped === true, 'skipped flag');
    } finally { await app.close(); }
  });

  await test('走完向导：语言/名称/搜索写入；设置 → 通用可重新打开', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ob2-'));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({}));
    const app = await launch({ userData: ud });
    try {
      const p = await app.waitPage(u => /onboarding/.test(u), 15000);
      await sleep(600);
      // lang → English
      await p.click('.seg[data-l="en"]'); await sleep(200);
      await p.click('#btnNext'); await sleep(300);
      // name
      await p.fill('#dname', 'Ada');
      await p.click('#btnNext'); await sleep(300);
      // ai — leave API defaults
      await p.click('#btnNext'); await sleep(300);
      // search baidu
      await p.selectOption('#eng', 'baidu');
      await p.click('#btnNext'); await sleep(300);
      // dict skip next
      await p.click('#btnNext'); await sleep(300);
      // done
      await p.click('#btnNext'); await sleep(1200);
      const home = await app.waitPage(u => /aibrowser:\/\/home/.test(u), 10000);
      assert(home, 'home');
      const s = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
      assert(s.onboarding.completed && !s.onboarding.skipped, JSON.stringify(s.onboarding));
      assert(s.lang === 'en', 'lang');
      assert(s.displayName === 'Ada', 'name');
      assert(s.search && s.search.engine === 'baidu', 'search');
      // reopen from settings
      await app.submit('aibrowser://settings');
      const st = await app.waitPage(u => u.startsWith('aibrowser://settings'));
      await sleep(600);
      await st.evaluate(() => { location.hash = 'general'; });
      await until(async () => st.locator('#obreopen').count().then(c => c > 0), 5000, 'obreopen');
      await st.click('#obreopen');
      await sleep(1000);
      const ob2 = await app.waitPage(u => /onboarding/.test(u), 10000);
      assert(ob2, 'reopened');
      const s2 = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
      assert(s2.onboarding.completed === false, 'marked incomplete for reopen');
    } finally { await app.close(); }
  });

  await test('browser_open_page 支持 onboarding；已完成用户启动进 home', async () => {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ob3-'));
    seedSettings(ud, { lang:'zh', displayName:'Felix', ai:{ source:'api', api:{ preset:'openai', format:'openai', baseUrl:'http://127.0.0.1:9/v1', apiKey:'b64:eA==', model:'x' } }, onboarding:{ completed:true, skipped:false, completedAt:1 } });
    const app = await launch({ userData: ud });
    try {
      const home = await app.waitPage(u => /aibrowser:\/\/home/.test(u), 15000);
      assert(home, 'home for completed');
      const src = fs.readFileSync(path.join(__dirname, '../../src/main/ai/tools.js'), 'utf8');
      assert(src.includes("'onboarding'"), 'tool enum');
    } finally { await app.close(); }
  });
};
