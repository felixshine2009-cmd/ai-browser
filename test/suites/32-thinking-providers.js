'use strict';
// Lean checks: request fields match current official provider docs. No network.
const v36 = require('../../src/main/v36/v36');

function fields(provider, model, level) {
  return v36.reasoningFields(level, { provider, model });
}

module.exports = async ({ test, group, assert, eq }) => {
  group('各服务商思考参数映射');

  await test('从不自动打断，也不把 interrupt 写进请求体', () => {
    eq(v36.thinkingPolicy(), { interrupt: false, maxWaitMs: null });
    const body = fields('openai', 'o4-mini', 'high');
    assert(!('interrupt' in body));
    assert(!('maxWaitMs' in body));
  });

  await test('OpenAI：仅推理模型发送 reasoning_effort；o 系列 max→high', () => {
    eq(fields('openai', 'gpt-4o-mini', 'high'), {});
    eq(fields('openai', 'o4-mini', 'low').reasoning_effort, 'low');
    eq(fields('openai', 'o4-mini', 'medium').reasoning_effort, 'medium');
    eq(fields('openai', 'o4-mini', 'high').reasoning_effort, 'high');
    eq(fields('openai', 'o4-mini', 'max').reasoning_effort, 'high');
    eq(fields('openai', 'gpt-5', 'max').reasoning_effort, 'high');
    eq(fields('openai', 'gpt-6-astra', 'max').reasoning_effort, 'max');
  });

  await test('Anthropic：3.5 省略；3.7/4.5 用 budget_tokens；4.6+ 用 adaptive', () => {
    eq(fields('anthropic', 'claude-3-5-sonnet-latest', 'high'), {});
    const e = fields('anthropic', 'claude-3-7-sonnet-latest', 'high');
    eq(e.thinking, { type: 'enabled', budget_tokens: 10000 });
    assert(e.max_tokens > e.thinking.budget_tokens);
    const a = fields('anthropic', 'claude-sonnet-4-6', 'max');
    eq(a.thinking, { type: 'adaptive' });
    eq(a.output_config, { effort: 'max' });
    const low = fields('anthropic', 'claude-sonnet-4-5', 'low');
    eq(low.thinking.budget_tokens, 1024);
  });

  await test('Gemini OpenAI 兼容：2.0 省略；2.5/3 发送 reasoning_effort', () => {
    eq(fields('gemini', 'gemini-2.0-flash', 'medium'), {});
    eq(fields('gemini', 'gemini-2.5-flash', 'high').reasoning_effort, 'high');
    eq(fields('gemini', 'gemini-3-flash', 'max').reasoning_effort, 'high');
  });

  await test('DeepSeek：旧 chat/reasoner 不发送 thinking，避免 422；flash 发送 type+effort', () => {
    eq(fields('deepseek', 'deepseek-chat', 'medium'), {});
    eq(fields('deepseek', 'deepseek-reasoner', 'high'), {});
    const mid = fields('deepseek', 'deepseek-flash', 'medium');
    eq(mid.thinking, { type: 'enabled' });
    eq(mid.reasoning_effort, 'high'); // docs map medium → high
    eq(fields('deepseek', 'deepseek-flash', 'low').reasoning_effort, 'low');
    eq(fields('deepseek', 'deepseek-flash', 'max').reasoning_effort, 'max');
    assert(!('level' in (mid.thinking || {})));
  });

  await test('xAI Grok：仅受支持模型发送 reasoning_effort', () => {
    eq(fields('xai', 'grok-4.7', 'max').reasoning_effort, 'xhigh');
    eq(fields('xai', 'grok-4.5', 'max').reasoning_effort, 'high');
    eq(fields('xai', 'grok-3-mini', 'medium').reasoning_effort, 'high');
    eq(fields('xai', 'grok-2', 'high'), {});
  });

  await test('通义千问：enable_thinking + thinking_budget；旧 Qwen2.5 省略', () => {
    eq(fields('qwen', 'qwen-plus', 'medium'), { enable_thinking: true, thinking_budget: 4096 });
    eq(fields('qwen', 'qwen-max', 'max'), { enable_thinking: true, thinking_budget: 16384 });
    eq(fields('qwen', 'qwen2.5-7b-instruct', 'high'), {});
  });

  await test('Moonshot / Kimi：按模型族发送 thinking 或 reasoning_effort', () => {
    eq(fields('moonshot', 'moonshot-v1-8k', 'medium'), {});
    eq(fields('moonshot', 'kimi-k2.6', 'medium').thinking, { type: 'enabled' });
    eq(fields('moonshot', 'kimi-k2.7-code', 'high'), {});
    eq(fields('moonshot', 'kimi-k3.1-pro', 'medium').reasoning_effort, 'high');
  });

  await test('智谱 GLM：旧 glm-4-flash 省略；4.6+ 发送 thinking.type', () => {
    eq(fields('zhipu', 'glm-4-flash', 'medium'), {});
    eq(fields('zhipu', 'glm-4.6', 'medium').thinking, { type: 'enabled' });
    eq(fields('zhipu', 'glm-5.3', 'max').reasoning_effort, 'max');
  });

  await test('豆包、OpenRouter、Ollama 及其他服务商', () => {
    eq(fields('doubao', 'doubao-pro-32k', 'medium'), {});
    eq(fields('doubao', 'doubao-seed-1-6', 'high').thinking, { type: 'enabled' });
    eq(fields('openrouter', 'openai/gpt-4o-mini', 'high'), { reasoning: { effort: 'high' } });
    eq(fields('mistral', 'mistral-small-latest', 'medium'), {});
    eq(fields('mistral', 'magistral-medium', 'high').reasoning_effort, 'high');
    eq(fields('siliconflow', 'Qwen/Qwen2.5-7B-Instruct', 'medium'), {});
    assert(fields('siliconflow', 'deepseek-ai/DeepSeek-V3', 'medium').enable_thinking === true);
    eq(fields('ollama', 'qwen2.5:7b', 'max'), { think: 'high' });
    eq(fields('groq', 'llama-3.3-70b-versatile', 'medium'), {});
    eq(fields('groq', 'openai/gpt-oss-120b', 'high').reasoning_effort, 'high');
    eq(fields('together', 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'medium'), {});
    eq(fields('minimax', 'MiniMax-Text-01', 'medium'), {});
    eq(fields('minimax', 'MiniMax-M3.1-Flash', 'max').reasoning_effort, 'max');
    eq(fields('stepfun', 'step-1-8k', 'medium'), {});
    eq(fields('yi', 'yi-lightning', 'medium'), {});
    eq(fields('perplexity', 'sonar', 'medium'), {});
    eq(fields('custom', 'anything', 'high'), {});
  });

  await test('可通过 Base URL 识别服务商；流式思考字段可解析', () => {
    eq(v36.detectProviderId({ baseUrl: 'https://api.deepseek.com/v1' }), 'deepseek');
    eq(v36.detectProviderId({ baseUrl: 'https://api.x.ai/v1' }), 'xai');
    eq(v36.extractThinkingDelta({ reasoning_content: 'abc' }), 'abc');
    eq(v36.extractThinkingDelta({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'xyz' } }), 'xyz');
    eq(v36.extractThinkingDelta({ choices: [{ delta: { content: 'hi' } }] }), '');
  });
};
