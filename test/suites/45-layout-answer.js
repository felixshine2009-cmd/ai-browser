'use strict';
// v3.0.0 item 5: answer format (tables, quotes, LaTeX, ```chem / ```graph / ```word answer blocks), the layout engine
// (absolute positioning, flow with page breaks, enum styling, overlap fixing, preview, PDF / HTML export) and the
// generator agents (排版助手, 幻灯片, 表格与图表, 错题本 / 试卷, 单词卡, 思维导图).
const { launch, sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer } = require('../lib/mock-server');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('排版与答案格式：排版引擎 / 生成助手 / 答案格式块');

  await test('排版引擎（纯计算）：自动分页、锚点与旋转包围盒、枚举样式校验、重叠修正', async () => {
    const E = require(path.join(ROOT, 'src/main/doc/engine'));
    const { doc } = E.createDoc({ title: 't', size: 'A4' });
    for (let i = 0; i < 30; i++) E.addElement(doc, { type: 'text', text: '这是一段用于测试自动分页的正文内容。'.repeat(6) });
    assert(doc.pages >= 2, 'flow broke onto a new page: ' + doc.pages);
    const cb = E.contentBox(doc);
    for (const e of doc.elements) assert(e.y + E.heightOf(doc, e) <= cb.bottom + 0.6, 'flow element inside the text area');
    const r = E.addElement(doc, { type: 'text', text: '印章', x: 100, y: 100, w: 40, h: 20, anchor: 'center', rotation: 90, page: 1, style: { color: 'red', size: 'huge', font: 'comic' } });
    const b = E.box(doc, r.el);
    assert(Math.abs(b.w - 20) < 0.1 && Math.abs(b.h - 40) < 0.1 && Math.abs(b.x - 90) < 0.1 && Math.abs(b.y - 80) < 0.1, 'rotated box ' + JSON.stringify(b));
    eq(r.el.style.color, 'red'); assert(!r.el.style.size && !r.el.style.font, 'invalid enum values are dropped');
    assert(r.warnings.some(w => /size=huge/.test(w)) && r.warnings.some(w => /font=comic/.test(w)), 'warnings name the allowed values');
    assert(E.check(doc).overlaps.length > 0, 'absolute element overlaps the flow');
    const fx = E.fixOverlaps(doc, 'all');
    eq(fx.after, 0, 'no overlaps after fixing'); assert(fx.moved.length > 0, 'elements moved');
    const html = E.renderHtml(doc);
    assert(/@page\{size:210mm 297mm/.test(html) && /transform:rotate\(90deg\)/.test(html) && /transform-origin:50% 50%/.test(html), 'HTML keeps page size, rotation and anchor');
  });

  await test('化学方程式配平检查：原子守恒与电荷守恒（mhchem 记法）', async () => {
    const ctx = { window: {} }; vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/renderer/static/answer-blocks.js'), 'utf8'), ctx);
    const c = ctx.window.AnswerBlocks.checkEquation;
    eq(c('2H2 + O2 ->[点燃] 2H2O').ok, true);
    eq(c('H2 + O2 -> H2O').ok, false);
    eq(c('MnO4- + 8H+ + 5e- -> Mn^2+ + 4H2O').ok, true);
    eq(c('Cu + Ag+ -> Cu^2+ + Ag').ok, false, 'charge not balanced');
    eq(c('CuSO4·5H2O ->[\\Delta] CuSO4 + 5H2O').ok, true);
    eq(c('K4[Fe(CN)6] -> 4K+ + [Fe(CN)6]^4-').ok, true);
  });

  const llm = await createLlmServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-layout-'));
  seedSettings(ud, apiSettings(llm.port));
  const app = await launch({ userData: ud });
  const inv = async (ch, ...a) => (await app.chrome()).evaluate(([c, x]) => window.aib.invoke(c, ...x), [ch, a]);
  const chatWith = async (marker) => {
    let page = null;
    try { await until(async () => { for (const x of app.pages().filter(q => q.url().startsWith('aibrowser://chat'))) if ((await x.locator('#turns').innerText().catch(() => '')).includes(marker)) { page = x; return true; } return false; }, 60000, 'answer ' + marker); }
    catch (e) { const texts = []; for (const x of app.pages().filter(q => q.url().startsWith('aibrowser://chat'))) texts.push((await x.locator('#turns').innerText().catch(() => '')).slice(0, 300)); throw new Error(e.message + ' | pages: ' + texts.join(' || ') + ' | systems: ' + llm.requests.slice(-4).map(r => String(r.system || ((r.messages || [])[0] || {}).content || '').slice(0, 60)).join(' / ')); }
    return page;
  };
  try {
    await test('答案格式：表格 / 引用 / 公式渲染；chem 块排版并检查配平；graph 块自动在 GeoGebra 作图；word 块显示词典卡片', async () => {
      llm.state.script = ({ system, lastUser }) => {
        if (!/careful research assistant|web-research agent/.test(system) || !/FMTTEST/.test(lastUser)) return null;
        return { text: 'FMTDONE 二次函数与化学示例。\n\n| 性质 | 结论 |\n|---|---|\n| 开口 | $a>0$ 向上 |\n| 顶点 | $(1,-1)$ |\n\n> 注意配平。\n\n```chem\n2H2 + O2 ->[点燃] 2H2O\nH2 + O2 -> H2O\n```\n\n```graph\nf(x)=x^2-2x\nA=(1,-1)\n```\n\n```word\nparabola\nvertex\n```' };
      };
      await inv('settings:patch', { workMode: 'chat' });
      await app.submit('FMTTEST 讲讲二次函数');
      const p = await chatWith('FMTDONE');
      await until(async () => (await p.locator('.ab-chem-check').count()) === 2, 10000, 'chem rows');
      eq(await p.locator('.md-table th').allInnerTexts(), ['性质', '结论']);
      assert(await p.locator('.md-table .katex').count() >= 2, 'maths in table cells rendered');
      assert(await p.locator('.ai-answer blockquote').count() >= 1 || await p.locator('blockquote').count() >= 1, 'quote');
      eq(await p.locator('.ab-chem-check').evaluateAll(n => n.map(x => x.dataset.state)), ['ok', 'bad']);
      assert(/O 1≠2|O 2≠1/.test(await p.locator('.ab-chem-check').nth(1).innerText()), 'difference named');
      assert(await p.locator('.ab-chem-eq .katex').count() === 2, 'equations typeset');
      await until(async () => /已作图|条成功/.test(await p.locator('.ab-graph-state').innerText().catch(() => '')), 90000, 'graph drawn');
      eq(await p.locator('.ablock-graph').getAttribute('data-state'), 'ok');
      await until(async () => (await p.locator('.ab-word').count()) === 2, 5000, 'word cards');
      await until(async () => !/正在查询/.test((await p.locator('.ab-words').innerText())), 30000, 'meanings filled');
      await p.screenshot({ path: path.join(ROOT, 'shots', '45-answer-format.png') });
    }, { timeout: 150000 });

    await test('排版助手：Markdown（标题 / 公式 / 表格 / 化学式）排成文档；卡片显示缩略图；模型收到预览图；导出 PDF 与 HTML', async () => {
      const md = '# 一元二次方程\n\n## 求根公式\n对于 $ax^2+bx+c=0$：\n\n$$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$$\n\n## 判别式\n| $\\Delta$ | 根的情况 |\n|---|---|\n| $>0$ | 两个不等实根 |\n| $=0$ | 两个相等实根 |\n| $<0$ | 无实根 |\n\n```chem\n2H2 + O2 -> 2H2O\n```\n\n' + '练习：解方程 $x^2-5x+6=0$。\n\n'.repeat(30);
      llm.state.script = ({ system, toolMsgs }) => {
        if (!/task agent of an AI browser/.test(system)) return null;
        if (!toolMsgs.length) return { toolCalls: [{ name: 'layout_agent', args: { title: '一元二次方程讲义', content: md, template: 'handout' } }] };
        return { text: 'LAYOUTDONE 讲义已排好。' };
      };
      await inv('settings:patch', { workMode: 'task' });
      await app.submit('把这份讲义排版成 A4 文档');
      const p = await chatWith('LAYOUTDONE');
      const card = p.locator('.doc-card');
      await until(async () => (await card.count()) === 1, 10000, 'document card');
      eq(await p.locator('.tool-card .tc-name').first().innerText(), '排版助手');
      eq(await p.locator('.tool-card').first().getAttribute('data-status'), 'ok');
      assert(/共 [2-9] 页/.test(await card.locator('.dc-meta').innerText()), 'several pages: ' + await card.locator('.dc-meta').innerText());
      await until(async () => /katex/.test(await card.locator('iframe').getAttribute('srcdoc') || ''), 10000, 'thumbnail with maths');
      const toolMsg = llm.requests.flatMap(r => r.messages || []).find(m => m.role === 'tool' && /"doc"/.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
      assert(toolMsg, 'result returned to the model');
      const res = JSON.parse(typeof toolMsg.content === 'string' ? toolMsg.content : toolMsg.content.map(c => c.text || '').join(''));
      eq(res.check.overlaps, 0, 'no overlaps'); eq(res.check.measured, true, 'measured in a real view');
      const imgReq = llm.requests.find(r => JSON.stringify(r.messages || []).includes('data:image/png;base64'));
      assert(imgReq, 'page preview image went to the model');
      await card.locator('.dc-pdf').click();
      await until(async () => /已保存：.*\.pdf/.test(await card.locator('.dc-file').innerText().catch(() => '')), 30000, 'pdf saved');
      const pdf = fs.readdirSync(app.dlDir).find(f => f.endsWith('.pdf'));
      assert(pdf && fs.readFileSync(path.join(app.dlDir, pdf)).slice(0, 5).toString() === '%PDF-', 'real PDF file');
      await card.locator('.dc-html').click();
      await until(async () => fs.readdirSync(app.dlDir).some(f => f.endsWith('.html')), 20000, 'html saved');
      const html = fs.readFileSync(path.join(app.dlDir, fs.readdirSync(app.dlDir).find(f => f.endsWith('.html'))), 'utf8');
      assert(/class="page"/.test(html) && /font\/woff2;base64/.test(html) && /katex/.test(html), 'self-contained HTML with fonts');
      const dl = await inv('dl:list');
      assert((dl || []).some(d => /\.pdf$/.test(d.filename)), 'export listed in downloads');
      await p.screenshot({ path: path.join(ROOT, 'shots', '45-layout-card.png') });
    }, { timeout: 120000 });

    await test('排版工具：绝对定位 + 旋转 + 锚点，修正重叠后无重叠；预览给出检查结果', async () => {
      llm.state.script = ({ system, toolMsgs }) => {
        if (!/task agent of an AI browser/.test(system)) return null;
        const n = toolMsgs.length;
        if (n === 0) return { toolCalls: [{ name: 'doc_new', args: { title: '海报', size: 'A5', theme: 'warm' } }] };
        if (n === 1) return { toolCalls: [{ name: 'doc_add_text', args: { text: '春季运动会', role: 'title' } }, { name: 'doc_add_text', args: { text: '第一段说明文字。'.repeat(10), role: 'body' } }, { name: 'doc_add_text', args: { text: '报名截止', x: 74, y: 40, w: 50, anchor: 'top', rotation: -8, style: { color: 'red', border: 'medium', padding: 's' } } }, { name: 'doc_add_math', args: { tex: 'E=mc^2', x: 20, y: 42, w: 60 } }] };
        if (n === 5) return { toolCalls: [{ name: 'doc_fix_overlaps', args: {} }] };
        if (n === 6) return { toolCalls: [{ name: 'doc_preview', args: {} }] };
        return { text: 'POSTERDONE 完成。' };
      };
      await app.submit('做一张运动会海报');
      const p = await chatWith('POSTERDONE');
      const names = await p.locator('.tool-card .tc-name').allInnerTexts();
      eq(names, ['新建文档', '添加文字', '添加文字', '添加文字', '添加公式', '修正重叠', '预览文档']);
      eq(await p.locator('.tool-card').evaluateAll(cs => cs.map(c => c.dataset.status)), Array(7).fill('ok'));
      eq(await p.locator('.doc-card').count(), 1, 'one card per document (latest state)');
      const msgs = llm.requests.flatMap(r => r.messages || []).filter(m => m.role === 'tool').map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      const fix = JSON.parse(msgs.find(c => /"before"/.test(c)));
      assert(fix.before >= 1, 'overlap detected'); eq(fix.after, 0, 'fixed');
      const pv = JSON.parse(msgs.reverse().find(c => /"check"/.test(c)));
      eq(pv.check.overlaps.length, 0);
    }, { timeout: 90000 });

    await test('生成助手：幻灯片 / 表格与图表 / 试卷 / 错题本 / 单词卡 / 思维导图 均生成文档卡片', async () => {
      const calls = [
        { name: 'slides_agent', args: { title: '光合作用', subtitle: '高一生物', slides: [{ title: '概念', bullets: ['绿色植物利用光能', '把二氧化碳和水合成有机物'] }, { title: '方程式', math: '6CO_2+6H_2O\\xrightarrow{光照}C_6H_{12}O_6+6O_2', bullets: ['场所：叶绿体'] }, { layout: 'section', title: '影响因素' }, { title: '光照强度', chart: { type: 'line', labels: ['0', '1', '2', '3'], series: [{ name: '速率', values: [0, 4, 7, 8] }] }, bullets: ['先增后稳'] }] } },
        { name: 'table_chart_agent', args: { title: '月考成绩', columns: ['科目', '一班', '二班'], rows: [['语文', '92', '88'], ['数学', '85', '91'], ['英语', '90', '87']], chart: { type: 'bar', x: '科目', y: ['一班', '二班'], title: '平均分对比' } } },
        { name: 'exam_agent', args: { mode: 'exam', title: '函数单元测试', showAnswers: 'end', sections: [{ title: '选择题', questions: [{ stem: '函数 $y=x^2$ 的对称轴是', options: ['$x=0$', '$y=0$', '$x=1$', '$y=1$'], answer: 'A', points: 5 }] }, { title: '解答题', questions: [{ stem: '求 $f(x)=x^2-2x$ 的最小值。', type: 'calc', answer: '$-1$', points: 10 }] }] } },
        { name: 'exam_agent', args: { mode: 'mistakes', title: '错题本', sections: [{ title: '函数', questions: [{ stem: '求 $y=x^2-4x$ 的顶点', wrongAnswer: '(2,4)', reason: '符号错误', answer: '(2,-4)', explanation: '配方：$y=(x-2)^2-4$' }] }] } },
        { name: 'word_cards_agent', args: { title: '第一单元单词', words: [{ word: 'photosynthesis', phonetic: '/ˌfoʊtoʊˈsɪnθəsɪs/', pos: 'n.', meaning: '光合作用' }, { word: 'chlorophyll', meaning: '叶绿素' }], lookup: false } },
        { name: 'mindmap_agent', args: { outline: '# 细胞\n## 结构\n- 细胞膜\n- 细胞质\n- 细胞核\n## 功能\n- 物质交换\n- 遗传信息\n## 分裂\n- 有丝分裂\n- 减数分裂' } }
      ];
      llm.state.script = ({ system, toolMsgs }) => {
        if (!/task agent of an AI browser/.test(system)) return null;
        const n = toolMsgs.length;
        if (n < calls.length) return { toolCalls: [calls[n]] };
        return { text: 'GENDONE 全部生成。' };
      };
      await app.submit('生成一组学习材料');
      const p = await chatWith('GENDONE');
      eq(await p.locator('.tool-card .tc-name').allInnerTexts(), ['幻灯片助手', '表格与图表助手', '错题本 / 试卷助手', '错题本 / 试卷助手', '单词卡助手', '思维导图助手']);
      eq(await p.locator('.tool-card').evaluateAll(cs => cs.map(c => c.dataset.status)), Array(6).fill('ok'), await p.locator('.tool-card').last().innerText());
      const metas = await p.locator('.doc-card .dc-meta').allInnerTexts();
      eq(metas.length, 6);
      assert(/幻灯片 · 共 5 页 · 16:9/.test(metas[0]), metas[0]);
      assert(/表格与图表/.test(metas[1]) && /试卷 · 共 2 页/.test(metas[2]) && /错题本/.test(metas[3]) && /单词卡/.test(metas[4]) && /思维导图 · 共 1 页/.test(metas[5]), metas.join(' | '));
      const srcs = await p.locator('.doc-card iframe').evaluateAll(fs => fs.map(f => f.getAttribute('srcdoc') || ''));
      await until(async () => (await p.locator('.doc-card iframe').evaluateAll(fs => fs.filter(f => (f.getAttribute('srcdoc') || '').length > 100).length)) === 6, 10000, 'thumbnails');
      const html = await p.locator('.doc-card iframe').evaluateAll(fs => fs.map(f => f.getAttribute('srcdoc') || ''));
      assert(/<svg[^>]*viewBox/.test(html[1]) && /<rect/.test(html[1]), 'bar chart svg');
      assert(/姓名：/.test(html[2]) && /参考答案与解析/.test(html[2]), 'exam header and answers');
      assert(/错因分析/.test(html[3]) && /正确答案/.test(html[3]), 'mistake notebook fields');
      assert(/photosynthesis/.test(html[4]) && /光合作用/.test(html[4]), 'word cards');
      assert(/细胞膜/.test(html[5]) && /<path d="M/.test(html[5]), 'mind map');
      await p.screenshot({ path: path.join(ROOT, 'shots', '45-generators.png'), fullPage: false });
      void srcs;
    }, { timeout: 150000 });
  } finally { llm.state.script = null; await app.close().catch(() => {}); }
};
