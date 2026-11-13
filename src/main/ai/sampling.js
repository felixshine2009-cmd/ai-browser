'use strict';
// Sampling parameter rules per provider and model (temperature, top_p, output token field), following the providers'
// API documentation. Some current reasoning models fix their sampling parameters and answer HTTP 400 for any other
// value, for example Moonshot kimi-k2.5 / k2.6 / k3 ("invalid temperature: only 1 is allowed for this model") and the
// OpenAI o-series / GPT-5 models. Known models are handled up front; for any other model a 400 that names a sampling
// parameter is retried once without it, and the result is remembered for that endpoint and model.
const learned = new Map(); // baseUrl|model -> { omit: Set<string>, tokens: 'max_tokens' | 'max_completion_tokens' }
const SAMPLING = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'n'];

function providerOf(ctx) {
  try { return require('../v36/v36').detectProviderId(ctx); } catch { return String((ctx && (ctx.preset || ctx.provider)) || 'custom'); }
}
const keyOf = (ctx) => String((ctx && ctx.baseUrl) || '').replace(/\/+$/, '').toLowerCase() + '|' + String((ctx && ctx.model) || '').toLowerCase();

/** Built-in rules: { omit: [...params], tokens?: field } */
function rules(ctx) {
  const provider = providerOf(ctx);
  const model = String((ctx && ctx.model) || '').toLowerCase().replace(/^.*\//, '');
  if (provider === 'moonshot' || /^kimi-/.test(model)) {
    // platform.kimi.ai: kimi-k3 and kimi-k2.x pin temperature (1.0 with thinking), top_p, n and the penalties;
    // max_completion_tokens is the canonical output field. moonshot-v1-* accepts free sampling values.
    if (/^kimi-(k3|k2[.-][5-9]|k2-thinking|for-coding|latest)/.test(model)) return { omit: SAMPLING, tokens: 'max_completion_tokens' };
    return { omit: [] };
  }
  if (provider === 'openai' || provider === 'azure') {
    // OpenAI reasoning models (o-series, gpt-5 and later): only the default temperature; max_completion_tokens.
    if (/^(o[1-9]([.-]|$)|gpt-[5-9])/.test(model) && !/chat-latest/.test(model)) return { omit: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty'], tokens: 'max_completion_tokens' };
    return { omit: [] };
  }
  if (provider === 'deepseek' && /reasoner/.test(model)) return { omit: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty'] }; // ignored by the API
  if (provider === 'xai' && /grok-[4-9]/.test(model)) return { omit: ['presence_penalty', 'frequency_penalty'] }; // rejected by reasoning models
  if (provider === 'openrouter' && /(^|\/)(o[1-9]|gpt-[5-9])/.test(String((ctx && ctx.model) || '').toLowerCase())) return { omit: ['temperature', 'top_p'] };
  return { omit: [] };
}

/** Adjust an OpenAI-compatible request body in place. */
function apply(body, ctx) {
  const r = rules(ctx); const l = learned.get(keyOf(ctx));
  const omit = new Set([...(r.omit || []), ...((l && l.omit) || [])]);
  for (const p of omit) delete body[p];
  if (body.temperature == null) delete body.temperature;
  const tokens = (l && l.tokens) || r.tokens;
  if (tokens === 'max_completion_tokens' && body.max_tokens != null) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; }
  if (tokens === 'max_tokens' && body.max_completion_tokens != null) { body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; }
  return body;
}

/** For an HTTP 400 that names a sampling parameter: remember the rule and return true (caller retries once). */
function learn(ctx, err, body) {
  if (!err || err.status !== 400) return false;
  const msg = String(err.body || err.message || '').toLowerCase();
  const k = keyOf(ctx); const l = learned.get(k) || { omit: new Set() };
  let changed = false;
  const sampling = /temperature|top_p|top-p|presence_penalty|frequency_penalty|sampling|only 1 is allowed|unsupported (value|parameter)|not supported with this model|does not support/.test(msg);
  if (sampling) {
    for (const p of SAMPLING) if (body && body[p] !== undefined && !l.omit.has(p)) { l.omit.add(p); changed = true; }
  }
  if (/max_tokens/.test(msg) && /max_completion_tokens/.test(msg)) {
    const want = body && body.max_tokens != null ? 'max_completion_tokens' : 'max_tokens';
    if (l.tokens !== want) { l.tokens = want; changed = true; }
  }
  if (changed) learned.set(k, l);
  return changed;
}
function isSamplingError(err) { return !!(err && err.status === 400 && /temperature|top_p|sampling|only 1 is allowed/i.test(String(err.body || err.message || ''))); }
function _reset() { learned.clear(); }
module.exports = { rules, apply, learn, isSamplingError, _reset, SAMPLING };
