'use strict';
// v3.1 extension framework checks shared by the desktop suite (52) and the iPad simulator suite (53): every built-in
// feature is a bundled first-party aib-feature/1 extension; the toolbar / iPad popover / home page come from the
// extensions' toolPanel + homepage contributions; turning an extension off removes its parts and turning it on
// restores them (no feature loss); answer blocks, importers, urlSchemes (aibrowser://docs) and the safety rules.
const path = require('path');
const BUILTIN = ['aib.code', 'aib.dictionary', 'aib.docs', 'aib.geogebra', 'aib.physics', 'aib.readlater', 'aib.scan', 'aib.snap', 'aib.solve', 'aib.wiki'];
const DESKTOP_TOOLS = ['solve', 'snap', 'geogebra', 'physics', 'wiki', 'dict', 'code', 'readlater'];
const LABELS = { solve: '解题', snap: '拍题', geogebra: 'GeoGebra', physics: '物理', wiki: '百科', dict: '词典', code: '代码', readlater: '稍后读', scan: '扫码' };
const HOME = ['solve', 'geogebra', 'physics', 'wiki', 'dict', 'code', 'readlater'];
const FIX = path.join(__dirname, '..', 'fixtures', 'dict-oald');

function expected(platform) { return platform === 'ipad' ? DESKTOP_TOOLS.concat('scan') : DESKTOP_TOOLS; }

async function checkBuiltins({ invoke, platform, assert, eq }) {
  const fw = await invoke('ext:framework');
  eq(fw.level, 2, 'framework level'); eq(fw.platform, platform, 'platform');
  const list = await invoke('ext:list');
  for (const id of BUILTIN) {
    const e = list.find(x => x.id === id);
    assert(e, 'built-in extension missing: ' + id);
    assert(e.builtin && e.enabled && !e.error, id + ': ' + JSON.stringify({ builtin: e.builtin, enabled: e.enabled, error: e.error }));
    eq(e.engines && e.engines.framework, '>=2', id + ' engines');
  }
  const tp = await invoke('ext:toolPanel');
  eq(tp.map(t => t.key).join(','), expected(platform).join(','), 'tool panel order');
  for (const t of tp) { eq(t.label, LABELS[t.key], 'label ' + t.key); assert(t.tip && t.tip.length > 2, 'tip ' + t.key); assert(t.builtin, 'first-party ' + t.key); }
  eq(tp.filter(t => t.home).map(t => t.key).join(','), HOME.join(','), 'home entries');
  eq(fw.answerBlocks.slice().sort().join(','), 'graph,word', 'answer block languages');
  return tp;
}

// every tool-view tile still opens its tool (no feature loss); command tiles name the same host commands as before
async function checkToolsOpen({ invoke, until, eq, assert }) {
  const tp = await invoke('ext:toolPanel');
  for (const t of tp) {
    if (t.action.type === 'command') { assert(['snap:solve', 'scan:qr'].includes(t.action.command), t.key + ' command'); continue; }
    eq(t.action.type, 'toolView', t.key + ' action');
    await invoke('tool:open', t.id);
    await until(async () => (await invoke('tabs:state')).activeTool === t.id, 15000, 'tool opened: ' + t.id);
  }
  await invoke('tool:hide');
}

async function homeKeys(home) { return home.evaluate(() => [...document.querySelectorAll('#hometools .ticon')].map(b => b.dataset.tool).join(',')); }

// off → its tool leaves the tool panel, the toolbar (desktop) and the home page; on → back in the same place
async function checkToggle({ invoke, chrome, home, platform, until, eq, assert }) {
  const toolbar = () => chrome.evaluate(() => [...document.querySelectorAll('#toolicons .ticon')].map(b => b.dataset.tool).join(','));
  await invoke('ext:setEnabled', 'aib.wiki', false);
  const off = (await invoke('ext:toolPanel')).map(t => t.key);
  assert(!off.includes('wiki') && off.length === expected(platform).length - 1, 'wiki removed: ' + off);
  await until(async () => !(await homeKeys(home)).split(',').includes('wiki'), 8000, 'home without wiki');
  if (platform === 'desktop') await until(async () => !(await toolbar()).split(',').includes('wiki'), 8000, 'toolbar without wiki');
  await invoke('ext:setEnabled', 'aib.wiki', true);
  eq((await invoke('ext:toolPanel')).map(t => t.key).join(','), expected(platform).join(','), 'wiki restored in place');
  await until(async () => (await homeKeys(home)) === HOME.join(','), 8000, 'home restored');
  if (platform === 'desktop') await until(async () => (await toolbar()) === DESKTOP_TOOLS.join(','), 8000, 'toolbar restored');
}

// ```graph is handled by aib.geogebra: with the extension on the block reaches its handler (an empty block is
// refused by the handler), with it off the core answers null and the language is no longer offered
async function checkAnswerBlocks({ invoke, eq, assert }) {
  const r = await invoke('answer:block', 'graph', { commands: [] });
  eq(r && r.error, 'no commands', 'graph handled by aib.geogebra');
  eq(await invoke('answer:block', 'word', { word: '12 not a word' }), null, 'word handler validates the word');
  await invoke('ext:setEnabled', 'aib.geogebra', false);
  try {
    eq(await invoke('answer:block', 'graph', { commands: ['f(x)=x'] }), null, 'graph off');
    assert(!(await invoke('ext:framework')).answerBlocks.includes('graph'), 'graph not offered when off');
  } finally { await invoke('ext:setEnabled', 'aib.geogebra', true); }
  assert((await invoke('ext:framework')).answerBlocks.includes('graph'), 'graph back');
}

// importers: aib.dictionary contributes .mdx / .mdd; ext:import goes through it
async function checkImporter({ invoke, eq, assert, tmp }) {
  const imps = await invoke('ext:contributions', 'importers');
  const d = imps.find(i => i.extId === 'aib.dictionary');
  assert(d && d.extensions.join(',') === 'mdx,mdd' && d.utTypes.includes('com.aibrowser.mdict-mdd'), JSON.stringify(imps));
  const fs = require('fs');
  const dir = path.join(tmp, 'import-oald'); fs.mkdirSync(dir, { recursive: true });
  for (const f of ['oald.mdx', 'oald.mdd']) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  const before = (await invoke('settings:get')).dicts.length;
  const r = await invoke('ext:import', 'aib.dictionary:mdict', [path.join(dir, 'oald.mdx')]);
  assert(r && r.added && r.added.length === 1 && !r.errors.length, JSON.stringify(r));
  const s = await invoke('settings:get');
  eq(s.dicts.length, before + 1, 'dictionary imported'); eq(s.dicts[s.dicts.length - 1].mdd.length, 1, '.mdd linked');
}

// a user extension: page tile with its own (sanitized) icon on the tool panel and the home page; first-party-only
// parts, the aib. prefix and a newer framework level are refused
async function checkUserExtension({ invoke, home, until, eq, assert, waitPage }) {
  const manifest = {
    standard: 'aib-feature/1', id: 'user.hello', name: '问候', version: '1.0.0', entry: 'main.js', engines: { framework: '>=2' },
    contributes: {
      toolPanel: [{ id: 'hello', label: { zh: '问候', en: 'Hello' }, tip: '示例工具', order: 120, action: { type: 'page', page: 'hello.html' },
        icon: { svg: '<circle cx="8" cy="8" r="6"/><script>alert(1)</script><path d="M5 8h6" onclick="x()"/><image href="javascript:alert(1)"/>' } }],
      homepage: [{ tool: 'hello', order: 120 }]
    }
  };
  const files = { 'manifest.json': JSON.stringify(manifest), 'main.js': 'module.exports = {};', 'hello.html': '<!doctype html><title>问候</title><p id="hi">你好</p>' };
  await invoke('ext:aiInstall', 'feature', files);
  try {
    const tp = await invoke('ext:toolPanel');
    const t = tp.find(x => x.key === 'user.hello:hello');
    assert(t && !t.builtin && t.url === 'aibext://user.hello/hello.html' && t.home, JSON.stringify(t));
    eq(t.icon.svg, '<circle cx="8" cy="8" r="6"/><path d="M5 8h6"/>', 'icon sanitized');
    eq(tp[tp.length - 1].key, 'user.hello:hello', 'ordered after the built-in tools');
    await until(async () => (await homeKeys(home)).split(',').includes('user.hello:hello'), 8000, 'home shows the user tool');
    await home.evaluate(() => document.querySelector('#hometools [data-tool="user.hello:hello"]').click());
    const p = await waitPage(u => u.startsWith('aibext://user.hello/hello.html'));
    await p.waitForSelector('#hi', { timeout: 8000 });
    // refused manifests
    const refuse = async (patch, re) => {
      const m = Object.assign({}, manifest, { id: 'user.bad' }, patch);
      let err = '';
      try { await invoke('ext:aiInstall', 'feature', { 'manifest.json': JSON.stringify(m), 'main.js': 'module.exports = {};', 'p.html': 'x' }); } catch (e) { err = String(e.message || e); }
      assert(re.test(err), 'expected refusal ' + re + ', got: ' + err);
    };
    await refuse({ contributes: { urlSchemes: [{ scheme: 'aibrowser', host: 'settings', page: 'p.html' }] } }, /仅内置拓展/);
    await refuse({ contributes: { toolPanel: [{ id: 'qr', label: '扫码', action: { type: 'command', command: 'scan:qr' } }] } }, /仅内置拓展/);
    await refuse({ id: 'aib.fake' }, /aib\.” 前缀/);
    await refuse({ engines: { framework: '>=9' } }, /框架 9 级/);
    await refuse({ contributes: { homepage: [{ tool: 'nope' }] } }, /homepage/);
    assert(!(await invoke('ext:list')).some(e => e.id === 'user.bad' || e.id === 'aib.fake'), 'refused extensions not installed');
  } finally {
    await invoke('ext:uninstall', 'user.hello');
  }
  assert(!(await invoke('ext:toolPanel')).some(x => x.extId === 'user.hello'), 'uninstalled tool removed');
  await until(async () => !(await homeKeys(home)).includes('user.hello'), 8000, 'home without the uninstalled tool');
}

// the framework docs are bundled (aib.docs → aibrowser://docs) and reachable from Settings → Extensions
async function checkDocs({ invoke, waitPage, assert, eq, settingsPage }) {
  for (const [name, min] of [['extensions', 8], ['contributions', 8], ['migration', 3]]) {
    await invoke('nav:openUrl', 'aibrowser://docs/' + name);
    const p = await waitPage(u => u.startsWith('aibrowser://docs/' + name));
    await p.waitForSelector('body[data-ready]', { timeout: 10000 });
    const r = await p.evaluate(() => ({ ready: document.body.dataset.ready, h2: document.querySelectorAll('h4.md-h2').length, nav: document.querySelectorAll('#nav > a').length, text: document.body.innerText }));
    eq(r.ready, name, 'doc ' + name); assert(r.h2 >= min, name + ' sections: ' + r.h2); eq(r.nav, 3, 'doc nav');
  }
  if (settingsPage) {
    const s = await settingsPage();
    await s.waitForSelector('#extdocs', { timeout: 10000 });
    eq((await s.textContent('#extdocs')).trim(), '开发文档', 'docs button');
    const line = await s.evaluate(() => { const c = document.querySelector('.ext-card[data-ext="aib.dictionary"] .ext-contrib'); return c ? c.textContent : ''; });
    assert(/工具面板/.test(line) && /文件导入/.test(line) && /回答内容块/.test(line), 'contribution line: ' + line);
    await s.click('#extdocs');
    await waitPage(u => u.startsWith('aibrowser://docs/extensions'));
  }
}

module.exports = { BUILTIN, DESKTOP_TOOLS, HOME, checkBuiltins, checkToolsOpen, checkToggle, checkAnswerBlocks, checkImporter, checkUserExtension, checkDocs };
