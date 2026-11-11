'use strict';
// Model lists per provider (desktop + web share this file; web/js/model-catalog.js is an exact copy).
// Builds the official list request for each provider, parses every response shape into one entry format,
// merges with the user's enable flags, and falls back to a curated built-in list when a provider has no
// list endpoint or the request fails. No DOM; the network call goes through the fetch function the caller passes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AIBModels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // kind: how the list is requested.  docs: official reference for the list endpoint.
  const LIST = {
    openai: { kind: 'openai', path: '/models', docs: 'https://platform.openai.com/docs/api-reference/models/list' },
    anthropic: { kind: 'anthropic', path: '/v1/models', docs: 'https://platform.claude.com/docs/en/api/models/list' },
    gemini: { kind: 'gemini', path: '/v1beta/models', docs: 'https://ai.google.dev/api/models#method:-models.list' },
    deepseek: { kind: 'openai', path: '/models', docs: 'https://api-docs.deepseek.com/api/list-models' },
    xai: { kind: 'xai', path: '/language-models', docs: 'https://docs.x.ai/developers/rest-api-reference/inference/models' },
    qwen: { kind: 'openai', path: '/models', docs: 'https://help.aliyun.com/zh/model-studio/list-models', note: 'compat' },
    moonshot: { kind: 'openai', path: '/models', docs: 'https://platform.kimi.ai/docs/api/list-models' },
    zhipu: { kind: 'openai', path: '/models', docs: 'https://docs.bigmodel.cn/api-reference' },
    doubao: { kind: 'openai', path: '/models', docs: 'https://ark.volcengine.com/region:cn-beijing/docs/models-api' },
    openrouter: { kind: 'openai', path: '/models', docs: 'https://openrouter.ai/docs/api-reference/list-available-models', keyless: true },
    mistral: { kind: 'openai', path: '/models', docs: 'https://docs.mistral.ai/api/#tag/models' },
    siliconflow: { kind: 'openai', path: '/models?type=text&sub_type=chat', docs: 'https://docs.siliconflow.cn/cn/api-reference/models/get-model-list' },
    ollama: { kind: 'ollama', path: '/api/tags', docs: 'https://github.com/ollama/ollama/blob/main/docs/api.md#list-local-models', keyless: true },
    groq: { kind: 'openai', path: '/models', docs: 'https://console.groq.com/docs/api-reference#models-list' },
    together: { kind: 'openai', path: '/models', docs: 'https://docs.together.ai/reference/models-1' },
    minimax: { kind: 'openai', path: '/models', docs: 'https://platform.minimax.io/docs/api-reference/models/openai/list-models' },
    stepfun: { kind: 'openai', path: '/models', docs: 'https://platform.stepfun.com/docs/zh/api-reference/models/list' },
    yi: { kind: 'openai', path: '/models', docs: 'https://platform.lingyiwanwu.com/docs/api-reference' },
    // GET /v1/models on Perplexity lists Agent API models (POST /v1/agent), not models for /chat/completions.
    perplexity: { kind: 'builtin', path: '', docs: 'https://docs.perplexity.ai/docs/sonar/models' },
    custom: { kind: 'openai', path: '/models', docs: 'https://platform.openai.com/docs/api-reference/models/list', keyless: true }
  };
  // Curated fallback lists (used only when the list endpoint is missing or the request fails; always labeled).
  const BUILTIN = {
    openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini'],
    anthropic: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest', 'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-sonnet-4-6'],
    gemini: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash'],
    xai: ['grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-3-mini'],
    qwen: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-flash', 'qwen-long', 'qwq-plus'],
    moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-turbo-preview'],
    zhipu: ['glm-4-flash', 'glm-4-plus', 'glm-4-air', 'glm-4.5', 'glm-4.5-air', 'glm-4.6'],
    doubao: ['doubao-pro-32k', 'doubao-lite-32k'],
    openrouter: ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat'],
    mistral: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'magistral-small-latest'],
    siliconflow: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen3-8B'],
    ollama: [],
    groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'qwen/qwen3-32b'],
    together: ['meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'openai/gpt-oss-120b'],
    minimax: ['MiniMax-Text-01', 'MiniMax-M1', 'abab6.5s-chat'],
    stepfun: ['step-1-8k', 'step-2-16k', 'step-1-32k'],
    yi: ['yi-lightning', 'yi-large'],
    perplexity: ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'],
    custom: []
  };
  // Not chat models: embeddings, speech, images, video, moderation, rerankers.
  const NON_CHAT = /(^|[\/_.:-])(text-)?embed|embedding|whisper|(^|[\/_-])tts|speech|transcri|dall-e|gpt-image|(^|[\/_-])image(?!n)|imagen|moderation|rerank|davinci|babbage|(^|[\/_-])sora|realtime|(^|[\/_-])audio|(^|[\/_-])ocr\b|(^|[\/_-])asr|cogview|cogvideo|(^|[\/_-])wanx?[\d.-]|paraformer|cosyvoice|sambert|seedream|seedance|step-1x|stable-diffusion|flux[.-]|kolors|veo-|lyria/i;

  function specOf(pid) { return LIST[pid] || LIST.custom; }
  function builtinOf(pid) { return (BUILTIN[pid] || []).slice(); }
  function trimBase(b) { return String(b || '').trim().replace(/\/+$/, '').replace(/\/(chat\/completions|models|messages|language-models)$/, '').replace(/\/+$/, ''); }
  function n(x) { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : undefined; }
  function has(arr, v) { return Array.isArray(arr) && arr.map(x => String(x).toLowerCase()).indexOf(v) >= 0; }
  function sup(o) { return !!(o && (o === true || o.supported === true)); }

  // The first request for a provider (pure; exported for tests).
  function listRequest(pid, cfg, key, opts) {
    opts = opts || {};
    const spec = specOf(pid);
    const base = trimBase(cfg && cfg.baseUrl);
    const fmt = (cfg && cfg.format) || '';
    const kind = (pid === 'custom' && fmt === 'anthropic') ? 'anthropic' : spec.kind;
    if (kind === 'builtin') return null;
    if (kind === 'anthropic') {
      const h = { 'x-api-key': key || '', 'anthropic-version': '2023-06-01' };
      if (opts.browser) h['anthropic-dangerous-direct-browser-access'] = 'true'; // required for direct browser (CORS) access
      return { kind, url: base.replace(/\/v1$/, '') + '/v1/models?limit=1000', headers: h };
    }
    if (kind === 'gemini') {
      const root = (base || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/openai$/, '').replace(/\/v1(beta)?$/, '') + '/v1beta';
      return { kind, url: root + '/models?pageSize=1000&key=' + encodeURIComponent(key || ''), headers: {} };
    }
    if (kind === 'ollama') {
      const root = (base || 'http://localhost:11434').replace(/\/v1$/, '');
      return { kind, url: root + '/api/tags', headers: {}, root };
    }
    const headers = key ? { Authorization: 'Bearer ' + key } : {};
    if (kind === 'xai') return { kind, url: base + '/language-models', headers, alt: base + '/models' };
    return { kind, url: base + spec.path, headers };
  }

  // Normalize one raw model object into { id, name?, ctx?, vision?, reasoning?, thinking? } or null (not a chat model).
  function entryOf(pid, m) {
    if (typeof m === 'string') m = { id: m };
    if (!m || typeof m !== 'object') return null;
    let id = String(m.id || m.model || m.name || '').trim();
    if (pid === 'gemini' || /^models\//.test(id)) {
      id = String(m.name || m.id || '').replace(/^models\//, '');
      if (Array.isArray(m.supportedGenerationMethods) && !has(m.supportedGenerationMethods, 'generatecontent')) return null;
    }
    if (pid === 'ollama') id = String(m.model || m.name || m.id || '');
    if (!id) return null;
    const caps = m.capabilities;
    // provider-declared "not a chat model" signals
    if (caps && typeof caps === 'object' && !Array.isArray(caps) && caps.completion_chat === false) return null; // Mistral
    if (m.domain && !/^(llm|vlm)$/i.test(String(m.domain))) return null; // Volcengine Ark
    if (/^retired$/i.test(String(m.status || m.lifecycle || ''))) return null;
    if (m.active === false) return null; // Groq
    if (m.type && /^(embedding|image|audio|rerank|moderation|transcribe|tts|stt|video)$/i.test(String(m.type))) return null; // Together etc.
    const arch = m.architecture || {};
    if (Array.isArray(arch.output_modalities) && arch.output_modalities.length && !has(arch.output_modalities, 'text')) return null;
    if (Array.isArray(m.output_modalities) && m.output_modalities.length && !has(m.output_modalities, 'text')) return null;
    if (NON_CHAT.test(id)) return null;
    const e = { id };
    const nm = m.display_name || m.displayName || (m.name && m.name !== id && !/^models\//.test(m.name) && pid !== 'ollama' ? m.name : '');
    if (nm && nm !== id) e.name = String(nm);
    const tl = m.token_limits || {};
    const ctx = n(m.context_length) || n(m.context_window) || n(m.max_context_length) || n(m.inputTokenLimit) || n(m.max_input_tokens) || n(tl.context_window) || n(m.top_provider && m.top_provider.context_length) || n(m.contextLength);
    if (ctx) e.ctx = ctx;
    const inMods = (m.modalities && m.modalities.input_modalities) || arch.input_modalities || m.input_modalities;
    let vision;
    if (typeof m.supports_image_in === 'boolean') vision = m.supports_image_in;
    else if (caps && typeof caps === 'object' && !Array.isArray(caps) && typeof caps.vision === 'boolean') vision = caps.vision;
    else if (caps && caps.image_input) vision = sup(caps.image_input);
    else if (Array.isArray(caps)) vision = has(caps, 'vision');
    else if (Array.isArray(inMods)) vision = has(inMods, 'image');
    if (vision !== undefined) e.vision = vision;
    let reasoning;
    if (typeof m.supports_reasoning === 'boolean') reasoning = m.supports_reasoning;
    else if (typeof m.thinking === 'boolean') reasoning = m.thinking; // Gemini
    else if (caps && caps.thinking && typeof caps.thinking === 'object') reasoning = sup(caps.thinking); // Anthropic
    else if (Array.isArray(caps)) reasoning = has(caps, 'thinking'); // Ollama /api/show
    else if (Array.isArray(m.supported_parameters)) reasoning = has(m.supported_parameters, 'reasoning') || has(m.supported_parameters, 'include_reasoning'); // OpenRouter
    else if (n(tl.max_reasoning_token_length) || (m.effort && Array.isArray(m.effort.supported_levels) && m.effort.supported_levels.length)) reasoning = true; // Ark
    if (reasoning !== undefined) e.reasoning = reasoning;
    if (caps && caps.thinking && caps.thinking.types) {
      const tt = caps.thinking.types;
      e.thinking = sup(tt.adaptive) ? 'adaptive' : sup(tt.enabled) ? 'enabled' : null;
    }
    return e;
  }
  function rawArray(j) {
    if (Array.isArray(j)) return j;
    if (!j || typeof j !== 'object') return null;
    if (Array.isArray(j.data)) return j.data;
    if (Array.isArray(j.models)) return j.models;
    if (j.output && Array.isArray(j.output.models)) return j.output.models;
    return null;
  }
  function parseList(pid, j) {
    const arr = rawArray(j);
    if (!arr) { const e = new Error('no model array'); e.apiCode = 'badformat'; e.snippet = JSON.stringify(j).slice(0, 120); throw e; }
    const seen = new Set(); const out = []; let filtered = 0;
    for (const m of arr) {
      const e = entryOf(pid, m);
      if (!e) { filtered++; continue; }
      if (seen.has(e.id)) continue;
      seen.add(e.id); out.push(e);
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return { models: out.slice(0, 2000), filtered };
  }

  function L(lang, zh, en) { return lang === 'en' ? en : zh; }
  function httpReason(status, body, lang) {
    const tail = body ? ' — ' + String(body).replace(/\s+/g, ' ').slice(0, 160) : '';
    if (status === 401 || status === 403) return L(lang, `HTTP ${status}：API Key 无效、已过期或没有权限`, `HTTP ${status}: the API key is invalid, expired or not authorized`) + tail;
    if (status === 404) return L(lang, 'HTTP 404：该服务未提供模型列表接口，或 Base URL 不正确', 'HTTP 404: this service has no model list endpoint, or the Base URL is wrong') + tail;
    if (status === 429) return L(lang, 'HTTP 429：请求过于频繁或额度已用尽', 'HTTP 429: rate limited or quota exhausted') + tail;
    if (status >= 500) return L(lang, `HTTP ${status}：服务器错误，请稍后重试`, `HTTP ${status}: server error, try again later`) + tail;
    return `HTTP ${status}` + tail;
  }
  async function getJson(fetchImpl, req, opts) {
    let res;
    try {
      const init = { method: req.method || 'GET', headers: req.headers || {} };
      if (req.body) init.body = req.body;
      if (opts.timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(opts.timeoutMs);
      res = await fetchImpl(req.url, init);
    } catch (e) {
      const msg = String((e && e.message) || e);
      const err = new Error(msg);
      if (opts.browser && (e && e.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed|CORS/i.test(msg))) {
        err.code = 'cors';
        err.message = L(opts.lang, '浏览器阻止了此跨域请求（CORS），网页版无法直接读取该服务商的模型列表', 'The browser blocked this cross-origin request (CORS), so the web version cannot read this provider\'s model list directly');
      } else if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        err.code = 'timeout'; err.message = L(opts.lang, '请求超时：服务器无响应', 'Request timed out: the server did not respond');
      } else { err.code = (e && (e.code || (e.cause && e.cause.code))) || 'network'; err.message = L(opts.lang, '网络请求失败：', 'Network request failed: ') + msg.slice(0, 160); }
      throw err;
    }
    if (!res.ok) {
      let body = ''; try { body = (await res.text()).slice(0, 300); } catch {}
      if (opts.mask) body = opts.mask(body);
      const err = new Error(httpReason(res.status, body, opts.lang)); err.status = res.status; throw err;
    }
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { const e = new Error(L(opts.lang, '返回内容不是 JSON，请确认 Base URL 指向 API 地址', 'The response is not JSON; check that the Base URL points to the API')); e.apiCode = 'badformat'; throw e; }
  }

  // fetchModelList(pid, {baseUrl, format}, key, fetchImpl, {lang, browser, timeoutMs, mask})
  // -> { source:'api'|'builtin', models:[entry], filtered, url, docs, error?, errorCode? }
  async function fetchModelList(pid, cfg, key, fetchImpl, opts) {
    opts = opts || {};
    const spec = specOf(pid);
    const req = listRequest(pid, cfg || {}, key, opts);
    const fallback = (error, code) => ({ source: 'builtin', models: builtinOf(pid).map(id => ({ id })), filtered: 0, url: req ? redact(req.url) : '', docs: spec.docs, error: error || '', errorCode: code || (req ? 'failed' : 'nolist') });
    if (!req) return fallback(L(opts.lang, '该服务商未提供适用于对话接口的模型列表接口', 'This provider has no model list endpoint for its chat API'), 'nolist');
    if (!trimBase(cfg && cfg.baseUrl) && pid !== 'gemini' && pid !== 'ollama') return fallback(L(opts.lang, '请先填写 Base URL', 'Fill in the Base URL first'), 'nobase');
    if (!key && !spec.keyless && pid !== 'custom') return fallback(L(opts.lang, '尚未填写 API Key，暂时显示内置推荐列表', 'No API key yet; showing the built-in list'), 'nokey');
    try {
      let all = [], filtered = 0, url = req.url;
      if (req.kind === 'anthropic') {
        let next = req.url, pages = 0;
        while (next && pages++ < 5) {
          const j = await getJson(fetchImpl, { url: next, headers: req.headers }, opts);
          const r = parseList(pid, j); all = all.concat(r.models); filtered += r.filtered;
          next = j && j.has_more && j.last_id ? req.url + '&after_id=' + encodeURIComponent(j.last_id) : '';
        }
      } else if (req.kind === 'gemini') {
        let next = req.url, pages = 0;
        while (next && pages++ < 5) {
          const j = await getJson(fetchImpl, { url: next, headers: req.headers }, opts);
          const r = parseList('gemini', j); all = all.concat(r.models); filtered += r.filtered;
          next = j && j.nextPageToken ? req.url + '&pageToken=' + encodeURIComponent(j.nextPageToken) : '';
        }
      } else if (req.kind === 'ollama') {
        const j = await getJson(fetchImpl, req, opts);
        const r = parseList('ollama', j); all = r.models; filtered = r.filtered;
        // capabilities (thinking / vision / context) come from /api/show, one request per local model
        await Promise.all(all.slice(0, 60).map(async (e) => {
          try {
            const s = await getJson(fetchImpl, { url: req.root + '/api/show', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: e.id }) }, opts);
            if (Array.isArray(s.capabilities)) { e.reasoning = has(s.capabilities, 'thinking'); e.vision = has(s.capabilities, 'vision'); }
            const mi = s.model_info || {};
            for (const k of Object.keys(mi)) if (/\.context_length$/.test(k) && n(mi[k])) e.ctx = n(mi[k]);
          } catch {}
        }));
      } else {
        let j;
        try { j = await getJson(fetchImpl, req, opts); }
        catch (e) {
          if (req.alt && (e.status === 404 || e.status === 405)) { url = req.alt; j = await getJson(fetchImpl, { url: req.alt, headers: req.headers }, opts); }
          else if (pid === 'custom' && (e.status === 404 || e.status === 405)) {
            const b = trimBase(cfg.baseUrl); const alt = /\/v\d+$/.test(b) ? b.replace(/\/v\d+$/, '') : b + '/v1';
            url = alt + '/models'; j = await getJson(fetchImpl, { url, headers: req.headers }, opts);
          } else throw e;
        }
        const r = parseList(pid, j); all = r.models; filtered = r.filtered;
      }
      const seen = new Set(); all = all.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)));
      if (!all.length && builtinOf(pid).length) return fallback(L(opts.lang, '服务商返回的模型列表为空', 'The provider returned an empty model list'), 'empty');
      return { source: 'api', models: all, filtered, url: redact(url), docs: spec.docs };
    } catch (e) {
      return fallback(e.message, e.code || (e.status ? 'http' : 'failed'));
    }
  }
  function redact(u) { return String(u || '').replace(/([?&]key=)[^&]*/i, '$1***'); }

  // Merge a fetched list with saved entries: keep enable flags and manual IDs; on the first fetch enable the
  // current model plus the built-in recommended ones that the provider actually offers.
  function mergeModels(prev, fetched, opts) {
    opts = opts || {};
    prev = Array.isArray(prev) ? prev : [];
    const byId = new Map(prev.map(m => [m.id, m]));
    const first = !!opts.first || !prev.length;
    const rec = new Set(builtinOf(opts.pid || 'custom'));
    const out = [];
    const seen = new Set();
    for (const f of fetched || []) {
      if (!f || !f.id || seen.has(f.id)) continue;
      seen.add(f.id);
      const p = byId.get(f.id);
      const enabled = p ? !!p.enabled : (first ? (f.id === opts.current || rec.has(f.id)) : false);
      const e = Object.assign({}, f, { enabled });
      if (p && p.manual) e.manual = true;
      if (opts.source === 'builtin') e.builtin = true; else delete e.builtin;
      out.push(e);
    }
    for (const p of prev) {
      if (seen.has(p.id)) continue;
      if (p.manual) { out.push(Object.assign({}, p)); seen.add(p.id); continue; }
      if (p.builtin && opts.source === 'api') continue; // a built-in placeholder the provider does not offer
      if (p.enabled) { out.push(Object.assign({}, p, { stale: opts.source === 'api' ? true : p.stale })); seen.add(p.id); }
    }
    if (opts.current && !seen.has(opts.current)) out.push({ id: opts.current, enabled: true, manual: true });
    return out;
  }
  function addManual(models, id) {
    id = String(id || '').trim();
    models = Array.isArray(models) ? models.slice() : [];
    if (!id) return models;
    const i = models.findIndex(m => m.id === id);
    if (i >= 0) models[i] = Object.assign({}, models[i], { enabled: true });
    else models.push({ id, enabled: true, manual: true });
    return models;
  }
  function removeModel(models, id) { return (models || []).filter(m => m.id !== id); }
  function setEnabled(models, ids, on) {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    return (models || []).map(m => (set.has(m.id) ? Object.assign({}, m, { enabled: !!on }) : m));
  }

  // Migration: one provider entry from the old single-provider config; its model stays enabled.
  function migrate(ai, providerIds) {
    ai = ai || {};
    const providers = Object.assign({}, ai.providers || {});
    const api = ai.api || {};
    const pid = (api.preset && (!providerIds || providerIds.indexOf(api.preset) >= 0)) ? api.preset : 'custom';
    if (!providers[pid] && (api.baseUrl || api.model)) {
      providers[pid] = { baseUrl: api.baseUrl || '', format: api.format || 'openai', apiKey: api.apiKey || '', models: api.model ? [{ id: api.model, enabled: true }] : [], fetchedAt: 0, listSource: '' };
    } else if (providers[pid] && api.model && !(providers[pid].models || []).some(m => m.id === api.model)) {
      providers[pid] = Object.assign({}, providers[pid], { models: (providers[pid].models || []).concat([{ id: api.model, enabled: true }]) });
    }
    return providers;
  }

  // Picker groups: configured providers only, enabled models only.  names: {pid: display name}
  function pickerGroups(providers, names, opts) {
    opts = opts || {};
    const groups = [];
    const order = Object.keys(names || {});
    for (const pid of Object.keys(providers || {})) if (order.indexOf(pid) < 0) order.push(pid);
    for (const pid of order) {
      const p = (providers || {})[pid];
      if (!p) continue;
      const usable = pid === opts.activeProvider || p.hasKey || !!p.apiKey || (specOf(pid).keyless && pid !== 'openrouter' && !!(p.baseUrl || pid === 'ollama'));
      if (!usable) continue;
      const models = (p.models || []).filter(m => m.enabled).map(m => ({ id: m.id, name: m.name || '', ctx: m.ctx, vision: m.vision, reasoning: m.reasoning }));
      if (models.length) groups.push({ id: pid, name: (names && names[pid]) || pid, models });
    }
    return groups;
  }
  function fmtCtx(v) {
    v = Number(v) || 0; if (!v) return '';
    if (v >= 1000000) return (v % 1000000 === 0 ? v / 1000000 : Math.round(v / 104857.6) / 10).toString().replace(/\.0$/, '') + 'M';
    if (v >= 1000) return (v % 1000 === 0 ? v / 1000 : Math.round(v / 1024)) + 'K';
    return String(v);
  }
  function capsOf(pid, model, providers) {
    const p = providers && providers[pid];
    const m = p && (p.models || []).find(x => x.id === model);
    if (!m) return null;
    const c = {};
    if (m.reasoning !== undefined) c.reasoning = m.reasoning;
    if (m.thinking !== undefined) c.thinking = m.thinking;
    if (m.vision !== undefined) c.vision = m.vision;
    return Object.keys(c).length ? c : null;
  }
  return { LIST, BUILTIN, NON_CHAT, specOf, builtinOf, listRequest, entryOf, parseList, fetchModelList, mergeModels, addManual, removeModel, setEnabled, migrate, pickerGroups, fmtCtx, capsOf, trimBase, redact };
});
