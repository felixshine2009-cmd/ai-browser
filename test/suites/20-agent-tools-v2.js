'use strict';
const fs = require('fs'), path = require('path');

module.exports = async ({ test, group, assert }) => {
  group('Agent 工具覆盖（v2）');
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/ai/tools.js'), 'utf8');
  await test('内置工具含书签/下载/查找/缩放/设置/Chrome拓展/KB删除/模型管理', () => {
    for (const n of ['bookmarks_list','bookmark_add','bookmark_remove','downloads_list','download_open','find_in_page','zoom_set','settings_set','chrome_ext_list','chrome_ext_install_store','kb_delete','models_list','model_select']) {
      assert(src.includes("name: '" + n + "'"), 'missing ' + n);
    }
  });
  await test('无密码相关 agent 工具；settings_set 拒绝密钥', () => {
    assert(!/name: '[^']*password[^']*'/.test(src), 'password tool');
    assert(/no allowed fields in patch/.test(src));
  });
  await test('GeoGebra / Physics manifest 工具齐全', () => {
    const g = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extensions/builtin/geogebra/manifest.json'), 'utf8'));
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extensions/builtin/physics/manifest.json'), 'utf8'));
    const gn = g.contributes.tools.map(t => t.name);
    const pn = p.contributes.tools.map(t => t.name);
    assert(gn.includes('ggb_eval') && gn.includes('ggb_keyboard') && gn.includes('ggb_set_app'));
    assert(pn.includes('phys_load') && pn.includes('phys_validate') && pn.includes('phys_list_examples'));
  });
};
