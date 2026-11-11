'use strict';
// Shared v3.6 logic (desktop + web). No network, no model inference.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AIB36 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // API providers the user can pick. `custom` leaves the endpoint blank.
  const API_PROVIDERS = {
    openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', format: 'openai', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'] },
    deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', format: 'openai', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash'] },
    qwen: { name: '通义千问 (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', format: 'openai', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
    zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', format: 'openai', models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'] },
    moonshot: { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', format: 'openai', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
    siliconflow: { name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct', format: 'openai', models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'] },
    openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', format: 'openai', models: ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001'] },
    gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', format: 'openai', models: ['gemini-2.0-flash', 'gemini-2.5-flash'] },
    groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', format: 'openai', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
    mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', format: 'openai', models: ['mistral-small-latest', 'mistral-large-latest'] },
    together: { name: 'Together', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', format: 'openai', models: ['meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo'] },
    minimax: { name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-Text-01', format: 'openai', models: ['MiniMax-Text-01', 'abab6.5s-chat'] },
    doubao: { name: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k', format: 'openai', models: ['doubao-pro-32k', 'doubao-lite-32k'] },
    stepfun: { name: '阶跃星辰', baseUrl: 'https://api.stepfun.com/v1', model: 'step-1-8k', format: 'openai', models: ['step-1-8k', 'step-2-16k'] },
    yi: { name: '零一万物', baseUrl: 'https://api.lingyiwanwu.com/v1', model: 'yi-lightning', format: 'openai', models: ['yi-lightning', 'yi-large'] },
    perplexity: { name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', model: 'sonar', format: 'openai', models: ['sonar', 'sonar-pro'] },
    ollama: { name: 'Ollama (本机)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', format: 'openai', models: ['qwen2.5:7b', 'llama3.1'] },
    anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', format: 'anthropic', models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'] },
    xai: { name: 'xAI', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.7', format: 'openai', models: ['grok-4.7', 'grok-4.6', 'grok-4.5'] },
    custom: { name: '自定义', baseUrl: '', model: '', format: 'openai', models: [] }
  };
  function providerById(id) { return API_PROVIDERS[id] || API_PROVIDERS.custom; }

  const THEMES = {
    aurora: { id: 'aurora', zh: '极光', en: 'Aurora', scheme: 'dark', colors: { bg: '#07111f', paper: '#0c1a2e', text: '#e8f1ff', muted: '#93a6c2', accent: '#3ee0c3', accent2: '#7aa2ff', warm: '#ffb86b' } },
    sand: { id: 'sand', zh: '暖沙', en: 'Warm sand', scheme: 'light', colors: { bg: '#f4ebe0', paper: '#efe2d2', text: '#3a2a1c', muted: '#8a6f58', accent: '#c45c26', accent2: '#b08968', warm: '#d4923a' } },
    night: { id: 'night', zh: '夜色', en: 'Night', scheme: 'dark', colors: { bg: '#120818', paper: '#1a0d28', text: '#f3e9ff', muted: '#a894c4', accent: '#c9a6ff', accent2: '#7ec8ff', warm: '#ffc48a' } },
    ink: { id: 'ink', zh: '墨黑', en: 'Ink', scheme: 'dark', colors: { bg: '#111214', paper: '#181a1e', text: '#f4f4f5', muted: '#9aa0a8', accent: '#d7dbe2', accent2: '#8b939e', warm: '#e8c27a' } }
  };
  function themeOf(id) { return THEMES[id] || THEMES.aurora; }
  function dictScheme(id) { return themeOf(id).scheme; }
  function themeCss(id) {
    const c = themeOf(id).colors;
    return `--bg0:${c.bg};--bg1:${c.paper};--text:${c.text};--muted:${c.muted};--accent:${c.accent};--accent2:${c.accent2};--warm:${c.warm};color-scheme:${themeOf(id).scheme};`;
  }

  const STYLES = ['concise', 'detailed', 'steps'];
  function normStyle(s) {
    const x = String(s || 'detailed').toLowerCase();
    if (x === '简洁' || x === 'concise') return 'concise';
    if (x === '步骤' || x === 'steps') return 'steps';
    return 'detailed';
  }
  function styleBlock(style) {
    const id = normStyle(style);
    const base = 'Every answer stays detailed and clearly structured: open with the conclusion, then sections or numbered steps, the key formulas or facts, and a short check. Write fluent prose.';
    if (id === 'concise') return base + ' 简洁: drop decoration and transitional filler only. Do not turn this into a short or shallow answer.';
    if (id === 'steps') return base + ' 步骤: keep the same depth, with explicit numbered steps.';
    return base + ' 详细: keep the full structure. Short transitions are fine when they help the reader follow.';
  }
  function answerAddendum(style) {
    return [
      styleBlock(style),
      'When a caller asks for a specific format such as JSON, reply with only that JSON object (no markdown fence) so a program can parse it.',
      'Do not name or describe which tools you called inside the answer. The interface lists tool use above the answer.'
    ].join('\n');
  }

  const THINKING = ['low', 'medium', 'high', 'max'];
  function normThinking(level) {
    const x = String(level || 'medium').toLowerCase();
    return THINKING.includes(x) ? x : 'medium';
  }
  function detectProviderId(ctx) {
    ctx = ctx || {};
    const preset = String(ctx.provider || ctx.preset || '').toLowerCase();
    if (preset && preset !== 'custom' && API_PROVIDERS[preset]) return preset;
    if (ctx.format === 'anthropic') return 'anthropic';
    const base = String(ctx.baseUrl || '').toLowerCase();
    const model = String(ctx.model || '').toLowerCase();
    if (/anthropic\.com/.test(base)) return 'anthropic';
    if (/api\.openai\.com/.test(base)) return 'openai';
    if (/deepseek\.com/.test(base)) return 'deepseek';
    if (/dashscope|compatible-mode\/v1|aliyuncs\.com/.test(base)) return 'qwen';
    if (/bigmodel\.cn|open\.bigmodel|api\.z\.ai/.test(base)) return 'zhipu';
    if (/moonshot\.(cn|ai)|api\.kimi\.ai/.test(base)) return 'moonshot';
    if (/siliconflow/.test(base)) return 'siliconflow';
    if (/openrouter\.ai/.test(base)) return 'openrouter';
    if (/generativelanguage\.googleapis|aiplatform\.googleapis/.test(base)) return 'gemini';
    if (/(^|\/\/)api\.x\.ai|[.]x\.ai\//.test(base)) return 'xai';
    if (/api\.groq\.com/.test(base)) return 'groq';
    if (/api\.mistral\.ai/.test(base)) return 'mistral';
    if (/together\.(xyz|ai)/.test(base)) return 'together';
    if (/minimax/.test(base)) return 'minimax';
    if (/volces\.com|volcengine|\bark\./.test(base)) return 'doubao';
    if (/stepfun/.test(base)) return 'stepfun';
    if (/lingyiwanwu/.test(base)) return 'yi';
    if (/perplexity\.ai/.test(base)) return 'perplexity';
    if (/:11434\b/.test(base) || /ollama/.test(base)) return 'ollama';
    if (/(^|\/)grok-/.test(model) || /x-ai\//.test(model)) return 'xai';
    return preset || 'custom';
  }
  function modelOf(ctx) { return String((ctx && ctx.model) || '').toLowerCase(); }
  function tokenBudget(id) {
    return ({ low: 1024, medium: 4096, high: 10000, max: 32000 })[id] || 4096;
  }
  function qwenBudget(id) {
    return ({ low: 1024, medium: 4096, high: 8192, max: 16384 })[id] || 4096;
  }
  function openaiIsReasoningModel(model) {
    if (!model) return false;
    if (/gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-3\.5|chatgpt-4o|gpt-4($|[^0-9])/.test(model) && !/gpt-4[05]/.test(model)) return false;
    return /(^|\/)(o[1-9]([.-]|$)|gpt-5|gpt-6)/.test(model);
  }
  function openaiEffort(id, model) {
    if (/(^|\/)o[1-4]([.-]|$)/.test(model)) return id === 'max' ? 'high' : id;
    if (/gpt-5($|[^0-9.])/.test(model) && !/gpt-5\.[1-9]/.test(model)) return id === 'max' ? 'high' : id;
    return id;
  }
  function claudeThinkingMode(model) {
    if (!model || !/claude/.test(model)) return null;
    if (/3-5|3\.5/.test(model)) return null;
    if (/4-7|4\.7/.test(model)) return 'adaptive';
    if (/4-6|4\.6/.test(model)) return 'adaptive';
    if (/sonnet-5|opus-5|haiku-5|fable|mythos|claude-5/.test(model)) return 'adaptive';
    if (/4-5|4\.5/.test(model)) return 'enabled';
    if (/3-7|3\.7/.test(model)) return 'enabled';
    if (/sonnet-4|opus-4|haiku-4|claude-4/.test(model)) return 'enabled';
    return null;
  }
  function deepseekEffort(id) {
    if (id === 'low') return 'low';
    if (id === 'max') return 'max';
    return 'high';
  }
  function reasoningFields(level, ctx) {
    const id = normThinking(level);
    ctx = ctx || {};
    const provider = detectProviderId(ctx);
    const model = modelOf(ctx);
    // Capabilities reported by the provider's model list (when known) take precedence over name-based detection.
    const caps = ctx.caps || null;
    if (caps && caps.reasoning === false) return {};
    if (provider === 'openai') {
      if (!openaiIsReasoningModel(model)) return {};
      return { reasoning_effort: openaiEffort(id, model) };
    }
    if (provider === 'anthropic') {
      const mode = (caps && caps.thinking !== undefined) ? caps.thinking : claudeThinkingMode(model);
      if (mode === 'adaptive') {
        return { thinking: { type: 'adaptive' }, output_config: { effort: id }, max_tokens: 16000 };
      }
      if (mode === 'enabled') {
        const b = tokenBudget(id);
        return { thinking: { type: 'enabled', budget_tokens: b }, max_tokens: b + 4096 };
      }
      return {};
    }
    if (provider === 'gemini') {
      if (/gemini-2\.5|gemini-2-5|gemini-3/.test(model)) {
        return { reasoning_effort: id === 'max' ? 'high' : id };
      }
      return {};
    }
    if (provider === 'deepseek') {
      if (/deepseek-chat(?!-|v)|deepseek-chat$/.test(model)) return {};
      if (/deepseek-reasoner/.test(model)) return {};
      if (/deepseek-flash|deepseek-v[34]|deepseek-r1/.test(model)) {
        return { thinking: { type: 'enabled' }, reasoning_effort: deepseekEffort(id) };
      }
      return {};
    }
    if (provider === 'xai') {
      if (/grok-3-mini/.test(model)) return { reasoning_effort: id === 'low' ? 'low' : 'high' };
      if (/grok-4\.[6-9]|grok-4-[6-9]|grok-4\.7|grok-4-7/.test(model)) {
        return { reasoning_effort: id === 'max' ? 'xhigh' : id };
      }
      if (/grok-4/.test(model)) return { reasoning_effort: id === 'max' ? 'high' : id };
      return {};
    }
    if (provider === 'qwen') {
      if (/qwen2\.5|qwen2-5/.test(model) && !/thinking|qwq/.test(model)) return {};
      if (/qwen3|qwq|qwen-plus|qwen-turbo|qwen-max|qwen-flash|qwen-long/.test(model)) {
        return { enable_thinking: true, thinking_budget: qwenBudget(id) };
      }
      return {};
    }
    if (provider === 'moonshot') {
      if (/kimi-k3/.test(model)) return { reasoning_effort: deepseekEffort(id) };
      if (/kimi-k2\.7|kimi-k2-7/.test(model)) return {};
      if (/kimi-k2/.test(model)) return { thinking: { type: 'enabled' } };
      return {};
    }
    if (provider === 'zhipu') {
      if (/glm-4\.[5-9]|glm-4-[6-9]|glm-5/.test(model)) {
        const out = { thinking: { type: 'enabled' } };
        if (/glm-5/.test(model)) out.reasoning_effort = id === 'medium' ? 'high' : id;
        return out;
      }
      return {};
    }
    if (provider === 'doubao') {
      if (/seed|thinking|1\.5|1-5|doubao-1/.test(model)) return { thinking: { type: 'enabled' } };
      return {};
    }
    if (provider === 'openrouter') {
      return { reasoning: { effort: id } };
    }
    if (provider === 'mistral') {
      if (/magistral|mistral-small-26|mistral-medium-3|ministral|reasoning/.test(model)) {
        return { reasoning_effort: id === 'max' ? 'high' : id };
      }
      return {};
    }
    if (provider === 'siliconflow') {
      if (/deepseek-r1|deepseek-v[34]|qwq|qwen3|glm-4\.[5-9]|glm-5|reasoner|thinking/.test(model)) {
        const out = { enable_thinking: true };
        if (/deepseek-v4|glm-5/.test(model)) out.reasoning_effort = deepseekEffort(id);
        else out.thinking_budget = qwenBudget(id);
        return out;
      }
      return {};
    }
    if (provider === 'ollama') {
      return { think: id === 'max' ? 'high' : id };
    }
    if (provider === 'groq') {
      if (/gpt-oss|qwen3|qwen\/|deepseek-r1|owl|reasoning/.test(model)) {
        return { reasoning_effort: id === 'max' ? 'high' : id, reasoning_format: 'parsed' };
      }
      return {};
    }
    if (provider === 'together') {
      if (/gpt-oss/.test(model)) return { reasoning_effort: id === 'max' ? 'high' : id };
      return {};
    }
    if (provider === 'minimax') {
      if (/minimax-m|abab7/.test(model)) return { reasoning_effort: id === 'max' ? 'max' : id };
      return {};
    }
    if (provider === 'stepfun') {
      if (/step-r|step-3|step-2x/.test(model)) return { reasoning_effort: id === 'max' ? 'high' : id };
      return {};
    }
    if (provider === 'perplexity') {
      if (/sonar-reasoning|sonar-deep|r1/.test(model)) return { reasoning_effort: id === 'max' ? 'high' : id };
      return {};
    }
    return {};
  }
  function thinkingPolicy() { return { interrupt: false, maxWaitMs: null }; }
  function extractThinkingDelta(piece) {
    if (!piece) return '';
    if (typeof piece === 'string') return piece;
    if (piece.type === 'content_block_delta' && piece.delta) {
      if (piece.delta.type === 'thinking_delta') return piece.delta.thinking || piece.delta.text || '';
      return '';
    }
    if (piece.delta && piece.delta.type === 'thinking_delta') return piece.delta.thinking || '';
    const d = piece.choices ? (piece.choices[0] && (piece.choices[0].delta || piece.choices[0].message)) : piece;
    if (!d) return '';
    if (typeof d.reasoning_content === 'string' && d.reasoning_content) return d.reasoning_content;
    if (typeof d.reasoning === 'string' && d.reasoning) return d.reasoning;
    if (d.reasoning && typeof d.reasoning.content === 'string') return d.reasoning.content;
    if (d.reasoning && typeof d.reasoning.text === 'string') return d.reasoning.text;
    if (Array.isArray(d.reasoning_details)) {
      return d.reasoning_details.map(function (x) {
        return (x && (x.text || x.summary || '')) || '';
      }).join('');
    }
    return '';
  }

  function route(text) {
    const q = String(text || '');
    const rules = [
      ['draw', /画|绘|作图|函数图|几何图|geogebra|\bplot\b|\bgraph\b/i],
      ['physics', /物理|受力|单摆|抛体|电路|折射|仿真|模拟实验/i],
      ['solve', /解题|求解|证明题|计算题|这道题/],
      ['wiki', /百科|离线维基|offline wiki|\bwiki\b/i],
      ['dict', /查词|词典|什么意思|dictionary/i],
      ['translate', /翻译这|帮我翻译|translate this/i]
    ];
    for (const [kind, re] of rules) if (re.test(q)) return { kind, web: false };
    return { kind: 'search', web: true };
  }

  function selectionKind(text) {
    const t = String(text || '').trim();
    if (!t || t.length > 500) return null;
    if (/^[A-Za-z][A-Za-z'’-]{1,40}$/.test(t)) return 'word';
    if (t.split(/\s+/).filter(Boolean).length >= 2 || /[。！？!?，,;；]/.test(t)) return 'sentence';
    return null;
  }

  function statusLabel(phase, extra) {
    extra = extra || {};
    if (phase === 'thinking') return extra.solve ? ('正在处理 · 解题' + (extra.step ? ' · 第 ' + extra.step + ' 步' : '')) : '正在处理';
    if (phase === 'tool') return '工具调用中';
    if (phase === 'search') return '搜索中';
    if (phase === 'write') return '正在整理回答';
    return extra.text || '正在处理';
  }

  function cmpVer(a, b) {
    const pa = String(a || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
    return 0;
  }
  function kernelPlan(cur, latest) {
    cur = cur || {}; latest = latest || {};
    const chromeNewer = !!(latest.chrome && cur.chrome && cmpVer(latest.chrome, cur.chrome) > 0);
    const electronNewer = !!(latest.electron && cur.electron && cmpVer(latest.electron, cur.electron) > 0);
    return { updateAvailable: chromeNewer || electronNewer, chromeNewer, electronNewer, inApp: true };
  }

  const BLOCKED = /apiKey|password|safeStorage|vault/i;
  function sanitizePluginPatch(patch) {
    const src = patch && typeof patch === 'object' ? patch : {};
    const allow = ['lang', 'mode', 'workMode', 'answerStyle', 'thinkingLevel', 'appearance', 'home', 'search', 'toolsCollapsed', 'displayName', 'greeting', 'selectionLookup'];
    const out = {};
    for (const k of allow) if (k in src) out[k] = src[k];
    if (out.appearance && out.appearance.theme && !THEMES[out.appearance.theme]) delete out.appearance.theme;
    if (out.answerStyle) out.answerStyle = normStyle(out.answerStyle);
    if (out.thinkingLevel) out.thinkingLevel = normThinking(out.thinkingLevel);
    if (out.workMode && out.workMode !== 'task' && out.workMode !== 'chat') delete out.workMode;
    const bad = JSON.stringify(src);
    return { patch: out, rejectedSecrets: BLOCKED.test(bad) };
  }

  function createChats(rows) {
    const data = Array.isArray(rows) ? rows : [];
    return {
      all: () => data,
      list: () => data.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)),
      get: (id) => data.find(x => x.id === id) || null,
      upsert(rec) {
        rec = rec || {};
        if (!rec.id) throw new Error('id required');
        const i = data.findIndex(x => x.id === rec.id);
        const row = Object.assign({ messages: [], updated: Date.now() }, i >= 0 ? data[i] : {}, rec);
        if (i >= 0) data[i] = row; else data.unshift(row);
        return row;
      }
    };
  }
  function fallbackTitle(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return (s.slice(0, 18) || '新对话');
  }
  function cleanTitle(text) {
    return String(text || '').replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  function titlePrompt() { return 'Write a short Simplified Chinese title for this chat. Output the title only, with no quotes and no explanation.'; }

  function collabOpen(toolId) { return { toolId: String(toolId || 'tool'), notes: [] }; }
  function collabNote(session, who, text) {
    const s = session || collabOpen('tool');
    s.notes.push({ who: who === 'ai' ? 'ai' : 'human', text: String(text || '').slice(0, 4000), at: Date.now() });
    return s;
  }

  function solverSession() { return { id: Math.random().toString(36).slice(2, 10), turns: [], refs: [], images: [] }; }
  function solverAddRef(s, ref) { s.refs.push({ title: String((ref && ref.title) || '参考').slice(0, 120), text: String((ref && ref.text) || '').slice(0, 8000) }); return s; }
  function solverAddTurn(s, role, text) { s.turns.push({ role: role === 'assistant' ? 'assistant' : 'user', text: String(text || '') }); return s; }
  function solverContext(s) {
    const refs = (s.refs || []).map((r, i) => '[' + (i + 1) + '] ' + r.title + '\n' + r.text).join('\n\n');
    const turns = (s.turns || []).map(t => (t.role === 'assistant' ? '助手' : '用户') + ': ' + t.text).join('\n');
    return (refs ? '参考资料:\n' + refs + '\n\n' : '') + (turns ? '已有对话:\n' + turns : '');
  }
  const PUBLIC_SOLVER = 'https://felixshine2009-cmd.github.io/ai-browser/#solve';
  function phoneLink({ desktop, lanUrl }) { return desktop ? String(lanUrl || '') : PUBLIC_SOLVER; }
  function phonePage() {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>拍照上传题目</title>
<style>body{margin:0;font:16px/1.5 "PingFang SC",sans-serif;background:#0e1726;color:#e8f1ff;padding:24px}main{max-width:420px;margin:0 auto}h1{font-size:22px;margin:0 0 8px}p{color:#9eb0c8}button,label.cam{display:block;margin-top:16px;background:#3ee0c3;color:#06241d;text-align:center;padding:14px;border-radius:12px;font-weight:700}input{display:none}</style></head>
<body><main><h1>上传题目照片</h1><p>请拍摄清晰、完整的题目。照片只会发回你自己的浏览器，用于解题。</p>
<form id="f" method="post" enctype="multipart/form-data"><label class="cam">用相机拍摄<input type="file" name="photo" accept="image/*" capture="environment" required></label><button type="submit">发送到电脑</button></form>
<p id="m"></p></main>
<script>document.getElementById('f').addEventListener('submit',async function(e){e.preventDefault();const fd=new FormData(e.target);const r=await fetch(location.pathname,{method:'POST',body:fd});document.getElementById('m').textContent=r.ok?'已发送，可以回到电脑继续':'发送失败';});</script>
</body></html>`;
  }

  function hscalc(op, args) {
    args = args || {};
    const n = (k, d = 0) => { const v = Number(args[k]); return Number.isFinite(v) ? v : d; };
    const R = 8.314;
    switch (op) {
      case 'quad': {
        const a = n('a'), b = n('b'), c = n('c');
        const d = b * b - 4 * a * c;
        if (!a) return { error: 'a=0' };
        if (d < 0) return { d, roots: [] };
        const s = Math.sqrt(d);
        return { d, roots: [(-b + s) / (2 * a), (-b - s) / (2 * a)] };
      }
      case 'kinematics': {
        const v0 = n('v0'), a = n('a'), t = n('t');
        return { v: v0 + a * t, s: v0 * t + 0.5 * a * t * t };
      }
      case 'newton': return { F: n('m') * n('a') };
      case 'ohm': {
        if (args.V != null && args.I != null) return { R: n('V') / n('I') };
        if (args.I != null && args.R != null) return { V: n('I') * n('R') };
        if (args.V != null && args.R != null) return { I: n('V') / n('R') };
        return { error: 'need two of V,I,R' };
      }
      case 'kinetic': return { Ek: 0.5 * n('m') * n('v') * n('v') };
      case 'potential': return { Ep: n('m') * n('g', 9.8) * n('h') };
      case 'wave': return { v: n('f') * n('lambda') };
      case 'lens': { const f = n('f'), u = n('u'); return { v: 1 / (1 / f - 1 / u) }; }
      case 'ph': { const h = n('h'); return { pH: -Math.log10(h) }; }
      case 'gas': {
        const p = args.P != null ? n('P') : null, V = args.V != null ? n('V') : null, nn = args.n != null ? n('n') : null, T = args.T != null ? n('T') : null;
        if (p == null) return { P: nn * R * T / V };
        if (V == null) return { V: nn * R * T / p };
        if (nn == null) return { n: p * V / (R * T) };
        return { T: p * V / (nn * R) };
      }
      case 'arith': { const a1 = n('a1'), d = n('d'), k = n('n'); return { an: a1 + (k - 1) * d, sum: k * (2 * a1 + (k - 1) * d) / 2 }; }
      case 'geo': { const a1 = n('a1'), r = n('r'), k = n('n'); return { an: a1 * Math.pow(r, k - 1), sum: r === 1 ? a1 * k : a1 * (1 - Math.pow(r, k)) / (1 - r) }; }
      case 'trig': { const rad = n('deg') * Math.PI / 180; return { sin: Math.sin(rad), cos: Math.cos(rad), tan: Math.tan(rad) }; }
      case 'log': return { log: Math.log(n('x')) / Math.log(n('base', 10)) };
      case 'deriv': {
        const c = Array.isArray(args.coef) ? args.coef.map(Number) : [];
        const d = c.slice(0, -1).map((v, i) => v * (c.length - 1 - i));
        return { coef: d };
      }
      default: return { error: 'unknown op' };
    }
  }

  const WIKI_SEED = [
    { title: '二次函数', text: '二次函数写作 y=ax^2+bx+c（a≠0）。对称轴 x=-b/(2a)。判别式 Δ=b^2-4ac 决定与 x 轴交点个数。开口方向由 a 的符号决定。' },
    { title: '牛顿第二定律', text: '物体加速度与合外力成正比，与质量成反比：F=ma。力、质量、加速度分别用牛顿、千克、米每二次方秒。' },
    { title: '欧姆定律', text: '在温度不变时，导体两端电压与电流成正比：U=IR。电阻单位是欧姆。' },
    { title: '光的折射', text: '光从一种介质进入另一种介质时传播方向改变。斯涅尔定律 n1 sin i = n2 sin r。折射率越大，光在该介质中越慢。' },
    { title: '酸碱与pH', text: 'pH = -lg[H+]。25°C 时中性溶液 pH 约为 7，酸性小于 7，碱性大于 7。强酸强碱中和生成盐和水。' },
    { title: '等差数列', text: '等差数列从首项 a1 起，每项比前一项多公差 d。通项 an=a1+(n-1)d，前 n 项和 Sn=n(a1+an)/2。' },
    { title: '理想气体', text: '理想气体状态方程 PV=nRT。R 约等于 8.314 J/(mol·K)。使用国际单位时温度用开尔文。' },
    { title: '简谐运动', text: '弹簧振子回复力 F=-kx。周期 T=2π√(m/k)。单摆小角度周期 T=2π√(L/g)，与振幅无关。' }
  ];
  function wikiSearch(pages, q) {
    const query = String(q || '').trim().toLowerCase();
    if (!query) return [];
    const terms = query.split(/[\s,，]+/).filter(t => t.length >= 1);
    return (pages || []).map(p => {
      const hay = (p.title + '\n' + p.text).toLowerCase();
      let score = 0;
      for (const t of terms) if (hay.includes(t)) score += t.length > 1 ? 2 : 1;
      if (p.title.toLowerCase().includes(query)) score += 5;
      return { title: p.title, text: p.text, score };
    }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);
  }
  function parseWikiJsonl(text) {
    const out = [];
    for (const line of String(text || '').split(/\n/)) {
      const s = line.trim(); if (!s) continue;
      try { const j = JSON.parse(s); if (j && j.title && j.text) out.push({ title: String(j.title).slice(0, 200), text: String(j.text).slice(0, 20000) }); } catch {}
    }
    return out;
  }

  function downloadPlan(probe) {
    const status = probe && probe.status;
    const ar = String((probe && (probe.acceptRanges || probe.contentRange)) || '');
    const ok = status === 206 || /bytes/i.test(ar);
    if (!ok) return { multithread: false, cancelMultithread: true, keepNormal: true };
    return { multithread: true, cancelMultithread: false, keepNormal: true, parts: Math.max(2, Math.min(8, (probe && probe.parts) || 4)) };
  }

  function mtpProbeConfig(json) {
    const j = json && typeof json === 'object' ? json : {};
    const heads = Number(j.mtp_num_heads || j.num_nextn_predict_layers || (j.multi_token_prediction && j.multi_token_prediction.num_heads) || 0);
    const mtp = !!(j.mtp || j.multi_token_prediction || heads > 0);
    return { mtp, heads: heads || 0 };
  }
  function mtpExtraArgs(probe) {
    if (!probe || !probe.mtp) return [];
    return ['--trust-remote-code'];
  }

  function redactToolTalk(text) {
    return String(text || '')
      .replace(/(^|\n).*((调用了|使用了).{0,12}工具|I used the \w+ tool).*(?=\n|$)/gi, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ---- QR (byte mode, ECC-L, versions 1–6, mask chosen by a simple score) ----
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;
  const VERSIONS = {
    1: { data: 19, ecc: 7, align: [] },
    2: { data: 34, ecc: 10, align: [6, 18] },
    3: { data: 55, ecc: 15, align: [6, 22] },
    4: { data: 80, ecc: 20, align: [6, 26] },
    5: { data: 108, ecc: 26, align: [6, 30] },
    6: { data: 136, ecc: 36, align: [6, 34] }
  };
  function rsEncode(data, nsym) {
    let gen = [1];
    for (let i = 0; i < nsym; i++) {
      const ng = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) { ng[j] ^= gen[j]; ng[j + 1] ^= gmul(gen[j], EXP[i]); }
      gen = ng;
    }
    const res = new Uint8Array(data.length + nsym);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const coef = res[i];
      if (!coef) continue;
      for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], coef);
    }
    const out = new Uint8Array(data.length + nsym);
    out.set(data); out.set(res.slice(data.length), data.length);
    return out;
  }
  function formatBits(mask) {
    const data = (1 << 3) | (mask & 7);
    let d = data << 10;
    const g = 0x537;
    for (let i = 4; i >= 0; i--) if ((d >>> (i + 10)) & 1) d ^= g << i;
    return ((data << 10) | (d & 0x3ff)) ^ 0x5412;
  }
  function qrMatrix(text) {
    const bytes = new TextEncoder().encode(String(text));
    let ver = 0, spec = null;
    for (const v of [1, 2, 3, 4, 5, 6]) {
      if (bytes.length <= VERSIONS[v].data - 2) { ver = v; spec = VERSIONS[v]; break; }
    }
    if (!ver) throw new Error('QR payload too long');
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(0b0100, 4); put(bytes.length, 8);
    for (const b of bytes) put(b, 8);
    const cap = spec.data * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let n = 0; for (let k = 0; k < 8; k++) n = (n << 1) | bits[i + k]; data.push(n); }
    const pads = [0xec, 0x11]; let p = 0;
    while (data.length < spec.data) data.push(pads[p++ % 2]);
    const cw = rsEncode(Uint8Array.from(data), spec.ecc);
    const all = [];
    for (const b of cw) for (let i = 7; i >= 0; i--) all.push((b >>> i) & 1);
    const rem = [0, 0, 7, 7, 7, 7, 7][ver];
    for (let i = 0; i < rem; i++) all.push(0);
    const n = 17 + 4 * ver;
    const dark = Array.from({ length: n }, () => Array(n).fill(false));
    const reserved = Array.from({ length: n }, () => Array(n).fill(false));
    const set = (r, c, val, res) => { if (r < 0 || c < 0 || r >= n || c >= n) return; dark[r][c] = !!val; if (res) reserved[r][c] = true; };
    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(rr, cc, on, true);
      }
    };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0, true); set(i, 6, i % 2 === 0, true); }
    const al = spec.align;
    for (const r of al) for (const c of al) {
      if ((r < 9 && c < 9) || (r < 9 && c > n - 10) || (c < 9 && r > n - 10)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1, true);
    }
    set(4 * ver + 9, 8, true, true);
    for (let i = 0; i < 9; i++) { if (!reserved[8][i]) reserved[8][i] = true; if (!reserved[i][8]) reserved[i][8] = true; }
    for (let i = 0; i < 8; i++) { reserved[8][n - 1 - i] = true; reserved[n - 1 - i][8] = true; }
    let bi = 0, upward = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let i = 0; i < n; i++) {
        const row = upward ? n - 1 - i : i;
        for (let k = 0; k < 2; k++) {
          const c = col - k;
          if (reserved[row][c]) continue;
          dark[row][c] = bi < all.length ? all[bi] === 1 : false;
          bi++;
        }
      }
      upward = !upward;
    }
    function masked(mask) {
      const m = dark.map(row => row.slice());
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (reserved[r][c]) continue;
        let flip = false;
        if (mask === 0) flip = (r + c) % 2 === 0;
        else if (mask === 1) flip = r % 2 === 0;
        else if (mask === 2) flip = c % 3 === 0;
        else if (mask === 3) flip = (r + c) % 3 === 0;
        else if (mask === 4) flip = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        else if (mask === 5) flip = (r * c) % 2 + (r * c) % 3 === 0;
        else if (mask === 6) flip = ((r * c) % 2 + (r * c) % 3) % 2 === 0;
        else flip = ((r + c) % 2 + (r * c) % 3) % 2 === 0;
        if (flip) m[r][c] = !m[r][c];
      }
      const fb = formatBits(mask);
      const putF = (r, c, bit) => { m[r][c] = !!bit; };
      for (let i = 0; i < 15; i++) {
        const bit = (fb >>> (14 - i)) & 1;
        if (i < 6) putF(i, 8, bit); else if (i < 8) putF(i + 1, 8, bit); else putF(n - 15 + i, 8, bit);
        if (i < 8) putF(8, n - 1 - i, bit); else if (i < 9) putF(8, 15 - i, bit); else putF(8, 15 - i - 1, bit);
      }
      m[n - 8][8] = true;
      return m;
    }
    let best = null, bestScore = 1e12;
    for (let mask = 0; mask < 8; mask++) {
      const m = masked(mask);
      let darkCount = 0, run = 0;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (m[r][c]) darkCount++;
        if (c > 0 && m[r][c] === m[r][c - 1]) run++;
      }
      const score = Math.abs(darkCount / (n * n) - 0.5) * 1000 + run;
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return { version: ver, size: n, modules: best };
  }
  function qrSvg(text) {
    const { size, modules } = qrMatrix(text);
    const qz = 4, s = size + qz * 2;
    let d = '';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) d += `<rect x="${c + qz}" y="${r + qz}" width="1" height="1"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/>${d.replace('<rect ', '<g fill="#000"><rect ').replace(/$/,'</g>')}</svg>`.replace('<g fill="#000"><rect ', '<g fill="#000"><rect ');
  }

  async function runTask({ goal, ask, act, onStatus, maxSteps }) {
    const steps = [];
    const cap = maxSteps || 6;
    if (onStatus) onStatus({ phase: 'thinking', label: statusLabel('thinking') });
    let context = '';
    for (let i = 0; i < cap; i++) {
      const step = await ask({ goal, context, steps });
      if (!step || step.done || step.action === 'done') return { summary: (step && (step.summary || step.text)) || '', steps };
      if (onStatus) onStatus({ phase: 'tool', label: statusLabel('tool'), step: i + 1 });
      const result = await act(step);
      steps.push({ action: step.action, args: step.args || {}, result });
      context += '\n' + JSON.stringify(result).slice(0, 800);
    }
    return { summary: '', steps, limited: true };
  }

  return {
    API_PROVIDERS, providerById, THEMES, themeOf, themeCss, dictScheme, STYLES, normStyle, styleBlock, answerAddendum,
    THINKING, normThinking, detectProviderId, reasoningFields, thinkingPolicy, extractThinkingDelta, route, selectionKind, statusLabel,
    cmpVer, kernelPlan, sanitizePluginPatch, createChats, fallbackTitle, cleanTitle, titlePrompt,
    collabOpen, collabNote, solverSession, solverAddRef, solverAddTurn, solverContext, PUBLIC_SOLVER, phoneLink, phonePage,
    hscalc, WIKI_SEED, wikiSearch, parseWikiJsonl, downloadPlan, mtpProbeConfig, mtpExtraArgs, redactToolTalk, qrMatrix, qrSvg, runTask
  };
});
