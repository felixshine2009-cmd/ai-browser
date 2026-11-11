'use strict';
// Lean checks for per-provider model lists: list request per provider, parsing, merge/enable,
// migration, and that the switcher only offers enabled models (desktop IPC + web data).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { launch, sleep } = require('../lib/app');

module.exports = async ({ test, group, assert, eq }) => {
  group('模型列表与快速切换');
  const C = require('../../src/main/ai/model-catalog');
  const mock = (body, status) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); const b = typeof body === 'function' ? body(url, init) : body; return { ok: (status || 200) < 400, status: status || 200, json: async () => b, text: async () => JSON.stringify(b) }; }; f.calls = calls; return f; };

  await test('各服务商请求地址与鉴权头', async () => {
    const cases = [
      ['openai', 'https://api.openai.com/v1', 'https://api.openai.com/v1/models', 'authorization'],
      ['anthropic', 'https://api.anthropic.com', 'https://api.anthropic.com/v1/models?limit=1000', 'x-api-key'],
      ['deepseek', 'https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/models', 'authorization'],
      ['moonshot', 'https://api.moonshot.cn/v1', 'https://api.moonshot.cn/v1/models', 'authorization'],
      ['zhipu', 'https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4/models', 'authorization'],
      ['openrouter', 'https://openrouter.ai/api/v1', 'https://openrouter.ai/api/v1/models', null],
      ['siliconflow', 'https://api.siliconflow.cn/v1', 'https://api.siliconflow.cn/v1/models?type=text&sub_type=chat', 'authorization'],
      ['groq', 'https://api.groq.com/openai/v1', 'https://api.groq.com/openai/v1/models', 'authorization'],
    ];
    for (const [pid, baseUrl, url, h] of cases) {
      const r = C.listRequest(pid, { baseUrl, format: pid === 'anthropic' ? 'anthropic' : 'openai' }, 'sk-x');
      eq(r.url, url, pid);
      const hs = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      if (h === 'authorization') eq(hs.authorization, 'Bearer sk-x', pid);
      if (h === 'x-api-key') { eq(hs['x-api-key'], 'sk-x'); eq(hs['anthropic-version'], '2023-06-01'); }
    }
    const g = C.listRequest('gemini', { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }, 'AIza');
    assert(/\/v1beta\/models\?/.test(g.url) && /pageSize=1000/.test(g.url) && /key=AIza/.test(g.url), g.url);
    const ab = C.listRequest('anthropic', { baseUrl: 'https://api.anthropic.com' }, 'k', { browser: true });
    eq(ab.headers['anthropic-dangerous-direct-browser-access'], 'true');
    const f = mock({ data: [{ id: 'grok-4', input_modalities: ['text', 'image'] }] });
    const x = await C.fetchModelList('xai', { baseUrl: 'https://api.x.ai/v1' }, 'k', f);
    assert(/language-models$/.test(f.calls[0].url), f.calls[0].url); eq(x.source, 'api');
    const o = mock((u) => (/\/api\/tags$/.test(u) ? { models: [{ name: 'qwen3:8b' }] } : { capabilities: ['completion', 'thinking'], model_info: { 'qwen3.context_length': 40960 } }));
    const ol = await C.fetchModelList('ollama', { baseUrl: 'http://127.0.0.1:11434/v1' }, '', o);
    eq(o.calls[0].url, 'http://127.0.0.1:11434/api/tags'); eq(ol.models[0].id, 'qwen3:8b'); eq(ol.models[0].reasoning, true);
  });

  await test('解析各种返回格式并过滤非对话模型', () => {
    const a = C.parseList('openai', { data: [{ id: 'gpt-5' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'dall-e-3' }] });
    eq(a.models.map(m => m.id), ['gpt-5']); assert(a.filtered >= 3);
    const an = C.parseList('anthropic', { data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', type: 'model' }] });
    eq(an.models[0].name, 'Claude Sonnet 4.5');
    const ge = C.parseList('gemini', { models: [{ name: 'models/gemini-2.5-pro', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent'], thinking: true }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }] });
    eq(ge.models.map(m => m.id), ['gemini-2.5-pro']); eq(ge.models[0].ctx, 1048576);
    const mo = C.parseList('moonshot', { data: [{ id: 'kimi-k2.6', context_length: 262144, supports_image_in: true, supports_reasoning: true }] });
    eq([mo.models[0].vision, mo.models[0].reasoning, mo.models[0].ctx], [true, true, 262144]);
    const arr = C.parseList('custom', ['m1', { id: 'm2' }]); eq(arr.models.map(m => m.id), ['m1', 'm2']);
    eq([C.fmtCtx(128000), C.fmtCtx(131072), C.fmtCtx(1048576)], ['128K', '128K', '1M']);
  });

  await test('获取失败时改用标注清楚的内置列表；网页端 CORS 有正式提示', async () => {
    const r = await C.fetchModelList('deepseek', { baseUrl: 'https://api.deepseek.com/v1' }, 'k', mock({ error: { message: 'bad key' } }, 401));
    eq(r.source, 'builtin'); assert(r.models.length > 0 && r.error, JSON.stringify(r));
    const cors = await C.fetchModelList('deepseek', { baseUrl: 'https://api.deepseek.com/v1' }, 'k', async () => { throw new TypeError('Failed to fetch'); }, { browser: true });
    eq(cors.source, 'builtin'); assert(/跨域|CORS/.test(cors.error), cors.error);
    const pp = await C.fetchModelList('perplexity', { baseUrl: 'https://api.perplexity.ai' }, 'k', mock({}));
    eq(pp.source, 'builtin'); assert(pp.models.some(m => m.id === 'sonar'));
    const gk = await C.fetchModelList('gemini', { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }, 'SECRET', mock({ models: [] }));
    assert(!String(gk.url || '').includes('SECRET'), 'gemini key redacted');
  });

  await test('合并保留启用状态；消失的已启用模型标记为不存在；迁移旧配置为启用', () => {
    const first = C.mergeModels([], [{ id: 'a' }, { id: 'b' }, { id: 'c' }], { pid: 'custom', current: 'b', source: 'api', first: true });
    eq(first.filter(m => m.enabled).map(m => m.id), ['b']);
    const on = C.setEnabled(first, ['c'], true);
    const next = C.mergeModels(on, [{ id: 'a' }, { id: 'b' }], { pid: 'custom', source: 'api' });
    const c = next.find(m => m.id === 'c'); assert(c && c.enabled && c.stale, JSON.stringify(next));
    const man = C.addManual(next, 'my-model'); assert(man.find(m => m.id === 'my-model').manual);
    eq(C.removeModel(man, 'my-model').some(m => m.id === 'my-model'), false);
    const ai = C.migrate({ api: { preset: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'enc', model: 'kimi-k2.6' }, providers: {} }, ['moonshot', 'custom']);
    eq(ai.moonshot.models, [{ id: 'kimi-k2.6', enabled: true }]);
    const groups = C.pickerGroups({ moonshot: { hasKey: true, models: [{ id: 'kimi-k2.6', enabled: true }, { id: 'moonshot-v1-8k', enabled: false }] }, openai: { hasKey: false, models: [{ id: 'gpt-5', enabled: true }] } }, { moonshot: 'Moonshot' }, { activeProvider: 'moonshot' });
    eq(groups.map(g => [g.id, g.models.map(m => m.id)]), [['moonshot', ['kimi-k2.6']]]);
  });

  await test('桌面与网页共用同一份目录与切换器代码', () => {
    eq(read('web/js/model-catalog.js'), read('src/main/ai/model-catalog.js'));
    eq(read('web/js/model-picker.js'), read('src/renderer/static/model-picker.js'));
    const sw = read('web/sw.js');
    for (const f of ['model-catalog.js', 'model-picker.js', 'models-web.js']) assert(sw.includes('./js/' + f), f);
  });

  await test('桌面：刷新、启用、切换器仅显示已启用模型、本对话覆盖', async () => {
    const seen = [];
    const srv = http.createServer((req, res) => { seen.push(req.method + ' ' + req.url + ' ' + (req.headers.authorization || '')); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'deepseek-v4-pro' }, { id: 'text-embedding-x' }] })); });
    await new Promise(r => srv.listen(0, r));
    const base = `http://127.0.0.1:${srv.address().port}/v1`;
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'aib-ml-'));
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ onboarding: { completed: true }, ai: { source: 'api', api: { preset: 'deepseek', format: 'openai', baseUrl: base, apiKey: 'b64:' + Buffer.from('sk-test').toString('base64'), model: 'deepseek-chat' } } }));
    const app = await launch({ userData: ud });
    try {
      const ch = await app.chrome();
      const inv = (c, ...a) => ch.evaluate(([c, a]) => window.aib.invoke(c, ...a), [c, a]);
      const s0 = await inv('settings:get');
      eq(s0.ai.providers.deepseek.models, [{ id: 'deepseek-chat', enabled: true }]);
      assert(!JSON.stringify(s0).includes('sk-test'), 'key not exposed');
      const r = await inv('models:refresh', 'deepseek');
      assert(r && r.ok !== false, JSON.stringify(r));
      assert(seen.some(x => /GET \/v1\/models Bearer sk-test/.test(x)), JSON.stringify(seen));
      await inv('models:setEnabled', 'deepseek', ['deepseek-reasoner'], false);
      await inv('models:setEnabled', 'deepseek', ['deepseek-v4-pro'], true);
      const pk = await inv('models:picker');
      const ids = pk.groups.find(g => g.id === 'deepseek').models.map(m => m.id);
      assert(ids.includes('deepseek-v4-pro') && ids.includes('deepseek-chat') && !ids.includes('deepseek-reasoner') && !ids.includes('text-embedding-x'), JSON.stringify(ids));
      await inv('models:select', { provider: 'deepseek', model: 'deepseek-v4-pro' }, 'thread-1');
      const pt = await inv('models:picker', 'thread-1'); eq(pt.current.model, 'deepseek-v4-pro');
      const s1 = await inv('settings:get'); eq(s1.ai.api.model, 'deepseek-chat');
      await inv('models:select', { provider: 'deepseek', model: 'deepseek-v4-pro' });
      await sleep(200);
      const s2 = await inv('settings:get'); eq(s2.ai.api.model, 'deepseek-v4-pro');
      eq(s2.ai.providers.deepseek.models.find(m => m.id === 'deepseek-reasoner').enabled, false);
      eq(s2.ai.providers.deepseek.listSource, 'api');
    } finally { await app.close(); srv.close(); }
  });
};
