'use strict';
// v3.0.0 item 4: task mode drives the unified tool registry (every browser capability is a tool); each call is shown
// in the chat as a card with its formal Chinese name, argument, state, time and details.
const { launch, sleep, seedSettings, apiSettings } = require('../lib/app');
const { createLlmServer, createWebServer } = require('../lib/mock-server');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');

module.exports = async ({ test, group, assert, eq, until }) => {
  group('任务模式：统一工具注册表（浏览器全部能力均为工具，每次调用在对话中显示）');
  const llm = await createLlmServer(); const web = await createWebServer();
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-task-'));
  seedSettings(ud, apiSettings(llm.port));
  const app = await launch({ userData: ud });
  const inv = async (ch, ...a) => (await app.chrome()).evaluate(([c, x]) => window.aib.invoke(c, ...x), [ch, a]);
  try {
    await test('工具目录：新增浏览器工具均已注册，且每个工具都有正式中文名称', async () => {
      const cat = await inv('tools:catalog');
      const names = cat.map(x => x.name);
      for (const n of ['tool_open', 'tool_close', 'split_view', 'spaces', 'readlater', 'page_assistant', 'page_screenshot', 'appearance_set', 'snap_solve', 'scan_qr', 'browser_click', 'browser_type', 'web_search', 'open_page', 'ggb_eval', 'python_run'])
        assert(names.includes(n), 'missing ' + n);
      const unnamed = cat.filter(x => x.label === x.name || !/[\u4e00-\u9fa5]/.test(x.label)).map(x => x.name);
      eq(unnamed, [], 'tools without a Chinese name');
    });

    await test('任务模式：智能体依次调用 打开工具（词典）→ 空间 → 页面截图，每次调用显示为卡片，状态为完成，可展开查看参数与结果', async () => {
      llm.state.script = ({ system, toolMsgs, tools }) => {
        if (!/task agent of an AI browser/.test(system)) return null;
        assert(tools.includes('tool_open') && tools.includes('web_search'), 'all tools offered: ' + tools.length);
        const n = toolMsgs.length;
        if (n === 0) return { toolCalls: [{ name: 'tool_open', args: { tool: 'dict' } }] };
        if (n === 1) return { toolCalls: [{ name: 'spaces', args: { action: 'list' } }, { name: 'page_screenshot', args: {} }] };
        return { text: 'TASKDONE 已打开词典并查看了空间与当前页面。' };
      };
      await inv('settings:patch', { workMode: 'task' });
      await app.submit(`http://127.0.0.1:${web.port}/page/a`); await sleep(800);
      await app.submit('打开词典，并告诉我有哪些空间');
      const p = await app.waitPage(u => u.startsWith('aibrowser://chat'), 15000);
      await until(async () => /TASKDONE/.test(await p.locator('#turns').innerText().catch(() => '')), 30000, 'task answer');
      const cards = p.locator('.tool-card');
      await until(async () => (await cards.count()) === 3, 5000, 'three cards');
      const names = await cards.locator('.tc-name').allInnerTexts();
      eq(names, ['打开工具', '空间', '页面截图']);
      eq(await cards.evaluateAll(cs => cs.map(c => c.dataset.status)), ['ok', 'ok', 'ok'], await cards.nth(2).evaluate(c => c.textContent.replace(/\s+/g, ' ').slice(0, 300)));
      eq(await cards.nth(0).locator('.tc-arg').innerText(), 'dict', 'argument shown');
      assert(/秒/.test(await cards.nth(0).locator('.tc-time').innerText()), 'time shown');
      await cards.nth(1).locator('summary').click();
      assert(/结果[\s\S]*main/.test(await cards.nth(1).locator('.tc-detail').innerText()), 'result details');
      eq((await inv('tabs:state')).activeTool, 'dict', 'the dictionary tool really opened');
      const shotReq = llm.requests.find(r => (r.messages || []).some(m => m.role === 'tool' && /screenshot/.test(String(m.content))));
      assert(shotReq, 'screenshot result went back to the model');
      await p.screenshot({ path: path.join(ROOT, 'shots', '44-task-tools.png') });
      await inv('tool:hide');
    }, { timeout: 60000 });

    await test('任务模式：工具出错时卡片标记为失败，智能体继续并给出总结', async () => {
      llm.state.script = ({ system, toolMsgs }) => {
        if (!/task agent of an AI browser/.test(system)) return null;
        if (!toolMsgs.length) return { toolCalls: [{ name: 'tool_open', args: { tool: 'nosuch' } }] };
        return { text: 'TASKFAIL 未能打开该工具。' };
      };
      await app.submit('打开一个不存在的工具');
      const p = await app.waitPage(u => u.startsWith('aibrowser://chat'), 15000);
      await until(async () => { for (const x of app.pages().filter(q => q.url().startsWith('aibrowser://chat'))) if (/TASKFAIL/.test(await x.locator('#turns').innerText().catch(() => ''))) return true; return false; }, 30000, 'answer');
      let card = null;
      for (const x of app.pages().filter(q => q.url().startsWith('aibrowser://chat'))) if (/TASKFAIL/.test(await x.locator('#turns').innerText().catch(() => ''))) card = x.locator('.tool-card').first();
      eq(await card.getAttribute('data-status'), 'error');
      assert(/失败/.test(await card.locator('.tc-time').innerText()), 'failure shown');
    }, { timeout: 60000 });
  } finally { llm.state.script = null; await app.close().catch(() => {}); }
};
