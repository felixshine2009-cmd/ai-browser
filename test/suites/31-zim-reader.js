'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async ({ test, group, assert }) => {
  group('离线百科：ZIM 阅读器');
  const zimPath = '/tmp/aib-small.zim';
  if (!fs.existsSync(zimPath)) {
    return;
  }
  await test('打开测试 ZIM，读取首页与词条，并按标题前缀检索', async () => {
    const zim = require(path.join(ROOT, 'src/main/wiki/zim'));
    const st = await zim.open(zimPath);
    assert(st.open, 'open status');
    assert(st.articleCount === 3, 'entry count ' + st.articleCount);
    const home = await zim.mainEntry();
    assert(home && home.title === 'Main Page', 'main title ' + (home && home.title));
    const html = Buffer.from(home.data).toString('utf8');
    assert(/Welcome to the archive/.test(html), 'main html');
    const phy = await zim.getByPath('A/Physics');
    assert(phy && /Force and motion/.test(Buffer.from(phy.data).toString('utf8')), 'physics body');
    const hits = await zim.search('Phy', 10);
    assert(hits.some(h => h.title === 'Physics'), 'search Physics: ' + hits.map(h => h.title).join(','));
    const apple = await zim.search('App', 10);
    assert(apple.some(h => h.title === 'Apple'), 'search Apple');
    await zim.close();
  });
  await test('将 ZIM 复制到应用程序目录后再打开', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-zim-app-'));
    process.env.AIB_USER_DATA = tmp;
    const zim = require(path.join(ROOT, 'src/main/wiki/zim'));
    const dest = await zim.copyIntoApp(zimPath);
    assert(dest.startsWith(tmp), 'copied under userData ' + dest);
    assert(fs.existsSync(dest), 'copy exists');
    assert(zim.insideRoot(dest), 'inside app zim root');
    assert(fs.existsSync(zimPath), 'original kept');
    const again = await zim.copyIntoApp(zimPath);
    assert(again === dest, 'reuse existing copy');
    const st = await zim.open(dest);
    assert(st.open && st.copied, JSON.stringify(st));
    const home = await zim.mainEntry();
    assert(home && /Welcome to the archive/.test(Buffer.from(home.data).toString('utf8')), 'copied file readable');
    await zim.close();
  });
  await test('读取官方 small.zim 首页并检索词条', async () => {
    const official = '/tmp/zim-samples/try.zim';
    if (!fs.existsSync(official)) return;
    const zim = require(path.join(ROOT, 'src/main/wiki/zim'));
    const st = await zim.open(official);
    assert(st.open, 'open official');
    assert(st.articleCount > 0, 'has entries');
    const home = await zim.mainEntry();
    assert(home && home.data && /Test ZIM file/.test(Buffer.from(home.data).toString('utf8')), 'official homepage');
    const hits = await zim.search('Test', 8);
    assert(hits.some(h => /Test ZIM/.test(h.title)), 'official search ' + hits.map(h => h.title).join(','));
    await zim.close();
  });
  await test('桌面与网页界面提供打开 ZIM 与阅读器', () => {
    const tool = fs.readFileSync(path.join(ROOT, 'src/renderer/static/tool.js'), 'utf8');
    const main = fs.readFileSync(path.join(ROOT, 'src/main/main.js'), 'utf8');
    assert(tool.includes('wiki:openZim'), 'desktop open');
    assert(tool.includes('wikiFrame'), 'desktop frame');
    assert(main.includes('aibzim://zim/'), 'desktop protocol url');
    assert(main.includes("scheme: 'aibzim'"), 'register scheme');
    assert(main.includes("proto.handle('aibzim'"), 'handle protocol');
    assert(main.includes('importFile'), 'desktop import copies');
    assert(fs.readFileSync(path.join(ROOT, 'src/main/wiki/zim.js'), 'utf8').includes('copyIntoApp'), 'copy helper');
    const csp = fs.readFileSync(path.join(ROOT, 'src/renderer/pages/tool.html'), 'utf8');
    assert(csp.includes('aibzim:'), 'csp frame-src');
    const web = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
    assert(web.includes('zimFile'), 'web file input');
    assert(web.includes('zim-reader.js'), 'web reader script');
    const app = fs.readFileSync(path.join(ROOT, 'web/js/app.js'), 'utf8');
    assert(app.includes('AibZim'), 'web open helper');
  });
};
