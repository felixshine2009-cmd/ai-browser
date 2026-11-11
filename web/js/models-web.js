// Web / iPad: per-provider model lists (fetched in the browser), enable flags, and the model switcher data.
// Shares model-catalog.js (window.AIBModels) and model-picker.js (window.AIBModelPicker) with the desktop app.
import { cleanKey, cleanBase } from './api.js';
import { CATALOG, listCachedModels } from './local-model.js';

const M = () => window.AIBModels;
const P = () => (window.AIB36 && window.AIB36.API_PROVIDERS) || {};
const zh = () => (document.documentElement.lang || 'zh').startsWith('zh');
const T = (a, b) => (zh() ? a : b);
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// old single-provider settings -> providers map (the configured model stays enabled)
export function migrate(settings) {
  if (!M()) return settings;
  settings.providers = M().migrate({ api: settings.api, providers: settings.providers || {} }, Object.keys(P()));
  return settings;
}
// the settings form was saved: mirror it into providers[preset]
export function syncFromApi(settings) {
  const a = settings.api || {}; const pid = a.preset || 'custom';
  settings.providers = settings.providers || {};
  const cur = settings.providers[pid] || { models: [], fetchedAt: 0, listSource: '' };
  const keyChanged = (cur.apiKey || '') !== (a.apiKey || '');
  const baseChanged = (cur.baseUrl || '') !== (a.baseUrl || '');
  let models = cur.models || [];
  if (a.model) models = models.some(m => m.id === a.model) ? models.map(m => (m.id === a.model ? { ...m, enabled: true } : m)) : models.concat([{ id: a.model, enabled: true, manual: true }]);
  settings.providers[pid] = { ...cur, baseUrl: a.baseUrl || '', format: a.format || (pid === 'anthropic' ? 'anthropic' : 'openai'), apiKey: a.apiKey || '', models };
  return { pid, keyChanged, baseChanged, needsFetch: keyChanged || baseChanged || !cur.fetchedAt };
}
export async function refresh(settings, pid, override) {
  override = override || {};
  settings.providers = settings.providers || {};
  const cur = settings.providers[pid] || {};
  const def = P()[pid] || P().custom || {};
  const act = (settings.api && settings.api.preset === pid) ? settings.api : {};
  const cfg = { baseUrl: cleanBase(override.baseUrl || cur.baseUrl || act.baseUrl || def.baseUrl || ''), format: override.format || cur.format || act.format || def.format || 'openai' };
  const key = cleanKey(override.apiKey || cur.apiKey || act.apiKey || '');
  const r = await M().fetchModelList(pid, cfg, key, (u, i) => fetch(u, i), { lang: zh() ? 'zh' : 'en', browser: true, timeoutMs: 15000, mask: (t) => (key && key.length > 4 ? String(t).split(key).join('***') : t) });
  const now = Date.now();
  if (r.source === 'builtin' && cur.listSource === 'api' && (cur.models || []).length) {
    settings.providers[pid] = { ...cur, listError: r.error, listErrorAt: now };
    return { ...r, keptCache: true, ok: false };
  }
  const current = act.model || '';
  const models = M().mergeModels(cur.models, r.models, { pid, current, source: r.source, first: !cur.fetchedAt });
  settings.providers[pid] = { baseUrl: cfg.baseUrl, format: cfg.format, apiKey: cur.apiKey || act.apiKey || '', ...cur, models, fetchedAt: now, listSource: r.source, listError: r.error || '', listUrl: r.url, filtered: r.filtered || 0 };
  return { ...r, ok: r.source === 'api' };
}
function names() { const o = {}; for (const [k, v] of Object.entries(P())) o[k] = v.name; return o; }
async function localItems(settings) {
  let cached = [];
  try { cached = (await listCachedModels()) || []; } catch {}
  const ids = new Set(cached.map(x => (typeof x === 'string' ? x : x && x.id)).filter(Boolean));
  if (settings.local && settings.local.modelId && settings.engine === 'local') ids.add(settings.local.modelId);
  return CATALOG.filter(m => ids.has(m.id)).map(m => ({ id: m.id, name: m.label || m.name || m.id }));
}
export async function pickerData(settings) {
  const provs = {};
  for (const [k, v] of Object.entries(settings.providers || {})) provs[k] = { ...v, hasKey: !!v.apiKey, apiKey: '' };
  const activeProvider = settings.engine === 'local' ? '' : ((settings.api && settings.api.preset) || 'custom');
  const groups = M().pickerGroups(provs, names(), { activeProvider });
  const loc = await localItems(settings);
  if (loc.length) groups.push({ id: 'local', name: T('本地模型（WebGPU）', 'Local models (WebGPU)'), models: loc });
  const current = settings.engine === 'local'
    ? { provider: 'local', model: settings.local.modelId, label: T('本地', 'Local') + ' · ' + settings.local.modelId }
    : { provider: activeProvider, model: settings.api.model, label: ((P()[activeProvider] || {}).name || activeProvider) + ' · ' + settings.api.model };
  const g = groups.find(x => x.id === current.provider);
  if (current.model && (!g || !g.models.some(m => m.id === current.model))) {
    if (g) g.models.unshift({ id: current.model }); else groups.unshift({ id: current.provider, name: current.provider === 'local' ? T('本地模型（WebGPU）', 'Local models (WebGPU)') : ((P()[current.provider] || {}).name || current.provider), models: [{ id: current.model }] });
  }
  return { current, groups };
}
// make a model current (persisted by the caller)
export function select(settings, ref) {
  if (ref.provider === 'local') { settings.engine = 'local'; settings.local = { ...(settings.local || {}), modelId: ref.model }; return settings; }
  const p = (settings.providers || {})[ref.provider] || {};
  const def = P()[ref.provider] || {};
  settings.engine = 'api';
  settings.api = { ...settings.api, preset: ref.provider, baseUrl: p.baseUrl || def.baseUrl || '', apiKey: p.apiKey || '', format: p.format || def.format || 'openai', model: ref.model };
  return settings;
}

const ago = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return T('刚刚', 'just now');
  if (s < 3600) return T(`${Math.round(s / 60)} 分钟前`, `${Math.round(s / 60)} min ago`);
  if (s < 86400) return T(`${Math.round(s / 3600)} 小时前`, `${Math.round(s / 3600)} h ago`);
  return new Date(ts).toLocaleString();
};
let filter = '';
// settings sheet: the model list of one provider. opts: { save(), formValues(), auto, fetch, onChange() }
export async function renderList(box, settings, pid, opts) {
  opts = opts || {};
  if (!box || !M()) return;
  const name = (P()[pid] || {}).name || pid;
  let p = (settings.providers || {})[pid] || {};
  const stale = !p.fetchedAt || (Date.now() - p.fetchedAt > 24 * 3600e3);
  if (opts.fetch || (opts.auto && !opts._done && (!(p.models || []).length || (stale && (p.apiKey || ['ollama', 'openrouter', 'custom'].includes(pid)))))) {
    box.innerHTML = `<div class="pm-status">${esc(T('正在从服务商获取模型列表…', 'Fetching the model list from the provider…'))}</div>`;
    let r; try { r = await refresh(settings, pid, opts.formValues ? opts.formValues() : {}); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    opts.save && opts.save();
    return renderList(box, settings, pid, { ...opts, fetch: false, _done: true, result: r });
  }
  p = (settings.providers || {})[pid] || {};
  const list = p.models || [];
  const on = list.filter(m => m.enabled).length;
  let status;
  if (p.listSource === 'api') status = T(`已从服务商接口获取 · ${ago(p.fetchedAt)}`, `Fetched from the provider · ${ago(p.fetchedAt)}`) + (p.filtered ? T(` · 已隐藏 ${p.filtered} 个非对话模型`, ` · ${p.filtered} non-chat models hidden`) : '') + (p.listError ? T(`。最近一次更新未成功：${p.listError}`, `. The last refresh failed: ${p.listError}`) : '');
  else if (p.listSource === 'builtin') status = T('内置推荐列表', 'Built-in list') + (p.listError ? T(`（${p.listError}）`, ` (${p.listError})`) : '') + T('。您仍可手动添加模型 ID。', '. You can still add model IDs manually.');
  else status = T('尚未获取模型列表。', 'The model list has not been fetched yet.');
  const f = filter.trim().toLowerCase();
  const shown = list.filter(m => !f || (m.id + ' ' + (m.name || '')).toLowerCase().includes(f));
  const chip = (txt, cls, title) => `<span class="pm-chip${cls ? ' ' + cls : ''}"${title ? ` title="${esc(title)}"` : ''}>${esc(txt)}</span>`;
  const rows = shown.map(m => {
    let tk = [];
    try { tk = Object.keys(window.AIB36.reasoningFields('medium', { provider: pid, preset: pid, model: m.id, baseUrl: p.baseUrl, format: p.format, caps: M().capsOf(pid, m.id, settings.providers) }) || {}).filter(k => k !== 'max_tokens'); } catch {}
    const chips = [m.vision ? chip(T('视觉', 'Vision')) : '', m.reasoning ? chip(T('思考', 'Thinking')) : '', m.ctx ? chip(M().fmtCtx(m.ctx), '', T('上下文长度', 'Context length')) : '',
      tk.length ? chip(T('思考参数', 'Thinking params'), 'pm-think', tk.join(', ')) : '', m.manual ? chip(T('手动添加', 'Manual'), 'pm-manual') : '', m.builtin ? chip(T('内置', 'Built-in'), 'pm-manual') : '', m.stale ? chip(T('服务商列表中已不存在', 'No longer listed'), 'pm-warn') : ''].join('');
    const rm = m.manual || m.stale ? `<button type="button" class="pm-rm" data-rm="${esc(m.id)}" aria-label="${esc(T('移除', 'Remove'))} ${esc(m.id)}">×</button>` : '';
    return `<label class="pm-row"><input type="checkbox" data-mid="${esc(m.id)}" ${m.enabled ? 'checked' : ''}><span class="pm-id">${esc(m.name || m.id)}${m.name && m.name !== m.id ? `<small>${esc(m.id)}</small>` : ''}</span><span class="pm-chips">${chips}</span>${rm}</label>`;
  }).join('');
  box.innerHTML = `<div class="pm-head"><b>${esc(name)}</b><button type="button" id="pmFetch">${esc(T('自动获取模型', 'Fetch models'))}</button></div>
    <div class="pm-status${p.listSource === 'builtin' && p.listError ? ' warn' : ''}" id="pmStatus">${esc(status)}</div>
    <div class="pm-tools"><input id="pmQ" type="search" placeholder="${esc(T('搜索模型', 'Search models'))}" value="${esc(filter)}" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" id="pmAll">${esc(T('全选', 'Select all'))}</button><button type="button" id="pmNone">${esc(T('全不选', 'Select none'))}</button><span class="pm-count">${esc(T(`已启用 ${on} / 共 ${list.length}`, `${on} of ${list.length} enabled`))}</span></div>
    <div class="pm-list">${rows || `<div class="pm-empty">${esc(list.length ? T('未找到匹配的模型', 'No matching models') : T('暂无模型。', 'No models yet.'))}</div>`}</div>
    <div class="pm-add"><input id="pmAdd" placeholder="${esc(T('手动添加模型 ID', 'Add a model ID manually'))}" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" id="pmAddBtn">${esc(T('添加', 'Add'))}</button></div>
    <p class="hint">${esc(T('仅勾选的模型会出现在输入框旁的模型切换器中。', 'Only checked models appear in the model switcher next to the input box.'))}</p>`;
  const $ = (id) => box.querySelector('#' + id);
  const again = () => renderList(box, settings, pid, { ...opts, auto: false, fetch: false, result: null });
  const changed = () => { opts.save && opts.save(); opts.onChange && opts.onChange(); again(); };
  const ensure = () => { settings.providers = settings.providers || {}; if (!settings.providers[pid]) settings.providers[pid] = { baseUrl: (P()[pid] || {}).baseUrl || '', format: (P()[pid] || {}).format || 'openai', apiKey: '', models: [], fetchedAt: 0, listSource: '' }; return settings.providers[pid]; };
  $('pmFetch').onclick = () => renderList(box, settings, pid, { ...opts, fetch: true, _done: false });
  $('pmQ').oninput = (e) => { filter = e.target.value; const pos = e.target.selectionStart; again().then(() => { const q = box.querySelector('#pmQ'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch {} } }); };
  const setEn = (ids, v) => { if (!ids.length) return; const e = ensure(); e.models = M().setEnabled(e.models, ids, v); changed(); };
  $('pmAll').onclick = () => setEn(shown.filter(m => !m.enabled).map(m => m.id), true);
  $('pmNone').onclick = () => setEn(shown.filter(m => m.enabled).map(m => m.id), false);
  box.querySelectorAll('[data-mid]').forEach(cb => cb.onchange = () => setEn([cb.dataset.mid], cb.checked));
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = (e) => { e.preventDefault(); const x = ensure(); x.models = M().removeModel(x.models, b.dataset.rm); changed(); });
  const add = () => { const v = $('pmAdd').value.trim(); if (!v) return; const x = ensure(); x.models = M().addManual(x.models, v); changed(); };
  $('pmAddBtn').onclick = add; $('pmAdd').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  if (opts.result && !opts.result.ok && opts.result.error) {
    const st = $('pmStatus'); st.classList.add('warn');
    st.textContent = T('获取失败：', 'Fetch failed: ') + opts.result.error + (opts.result.keptCache ? T('。已保留上次获取的列表。', '. The previous list is kept.') : T('。已改用内置推荐列表，您仍可手动添加模型 ID。', '. Showing the built-in list; you can still add model IDs manually.'));
  }
}
