'use strict';
// v3.0.0 item 5 on iPad (direct port): the layout engine measures and previews documents in hidden web views of the
// host and exports one PDF page per document page (Services/PDFPages.swift on the device, Chromium in the simulator).
const { launchIpad } = require('../lib/ipad-sim');
const fs = require('fs'), os = require('os'), path = require('path');

module.exports = async ({ test, group, assert, eq }) => {
  group('iPad：排版引擎与生成助手（隐藏视图测量、预览、分页 PDF）');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ipaddoc-'));
  const app = await launchIpad({ userData: ud });
  try {
    await test('iPad 试卷助手：生成、测量无重叠、预览图、导出分页 PDF（页数与文档一致）', async () => {
      const r = await app.tool('exam_agent', { title: '函数测验', showAnswers: 'end', sections: [{ title: '选择题', questions: Array.from({ length: 14 }, (_, i) => ({ stem: `第 ${i + 1} 题：函数 $y=x^${(i % 3) + 2}$ 的性质是`, options: ['单调递增', '单调递减', '奇函数', '偶函数'], answer: 'A', points: 5 })) }] });
      assert(r.doc && r.doc.pages >= 2, 'several pages: ' + JSON.stringify(r.doc));
      eq(r.check.overlaps, 0); eq(r.check.measured, true, 'measured in the host web view');
      assert(r.modelImages && /^data:image\/png;base64,/.test(r.modelImages[0]), 'preview image');
      const ex = await app.tool('doc_export', { doc: r.doc.id, format: 'pdf' });
      const buf = fs.readFileSync(ex.exported.path);
      eq(buf.slice(0, 5).toString(), '%PDF-');
      const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      eq(pages, r.doc.pages, 'one PDF page per document page');
    }, { timeout: 120000 });
    await test('iPad 思维导图与幻灯片助手：生成文档卡片数据', async () => {
      const m = await app.tool('mindmap_agent', { outline: '# 力学\n## 运动学\n- 位移\n- 速度\n## 动力学\n- 牛顿定律' });
      eq(m.doc.kind, 'mindmap'); eq(m.doc.pages, 1);
      const s = await app.tool('slides_agent', { title: '牛顿定律', slides: [{ title: '第一定律', bullets: ['惯性'] }, { title: '第二定律', math: 'F=ma' }] });
      eq(s.doc.pages, 3); eq(s.doc.size, 'slide16x9');
    }, { timeout: 120000 });
  } finally { await app.close().catch(() => {}); }
};
