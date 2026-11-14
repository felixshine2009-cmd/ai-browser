// Chat threads in the web app (v3.0.0): one scrolling conversation above the input. Each new question is appended
// under the last answer, earlier turns are kept in localStorage (they survive reloads) and are sent to the model
// within its context budget (thread.js). While an answer is generated the send button is a stop button (also Esc /
// Cmd+.); a stopped answer keeps what was written, is marked 已中止 and stays in the context of follow-ups.
import { handleAsk } from './chat.js';

const KEY = 'aib.threads', LAST = 'aib.lastThread', MAX_THREADS = 30;
const T = () => window.AIBThread;
const en = () => (document.documentElement.lang || '').startsWith('en');
const L = (zh, e) => (en() ? e : zh);

function loadAll() { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
function saveAll(rows) {
  rows.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  rows = rows.slice(0, MAX_THREADS);
  for (;;) {
    try { localStorage.setItem(KEY, JSON.stringify(rows)); return; }
    catch (e) { if (rows.length <= 1) return; rows.pop(); } // storage full: drop the oldest threads
  }
}

export function createThreadUI({ getSettings, onBusy }) {
  const q = (id) => document.getElementById(id);
  const askrow = q('askrow');
  const convo = document.createElement('section'); convo.id = 'convo'; convo.className = 'convo';
  convo.innerHTML = '<div id="thread" class="thread"></div><div id="liveturn" class="turn live" hidden><div class="user-row"><div class="user-bubble" id="liveq"></div></div></div>';
  askrow.parentNode.insertBefore(convo, askrow);
  const live = q('liveturn');
  for (const id of ['tools', 'status', 'thinkbox', 'answer']) { const n = q(id); if (n) live.appendChild(n); }
  const meta = document.createElement('div'); meta.className = 'turn-meta'; meta.id = 'turnmeta'; live.appendChild(meta);
  const threadEl = q('thread');

  let row = null, ac = null, busy = false;
  const setBusy = (b) => { busy = b; if (onBusy) onBusy(b); };

  function contextOpts() {
    const st = getSettings();
    if (st.engine === 'local') return { local: true, contextTokens: 4096 };
    let ctx = 0;
    try { const c = window.AIBModels && window.AIBModels.capsOf((st.api && st.api.preset) || 'custom', st.api && st.api.model, st.providers || {}); ctx = c && (c.ctx || c.context); } catch {}
    return { local: false, contextTokens: ctx || 32000 };
  }
  function metaText(t) {
    const parts = []; const line = T().statsLine(t, en() ? 'en' : 'zh'); if (line) parts.push(line);
    if (t.stopped) parts.push(L('已中止', 'Stopped'));
    return parts.join(' · ');
  }
  // v3.0.0: finished answers render as Markdown with formulas, tables and answer blocks (chem / graph / word)
  function paintAnswer(el, text, live) {
    if (window.MD && text) {
      try { el.innerHTML = window.MD.render(text); el.classList.add('md'); if (window.AnswerBlocks) window.AnswerBlocks.enhance(el, { live: !!live }); return; } catch (e) { console.error('answer render', e); }
    }
    el.textContent = text;
  }
  function frozenTurn(t, live) {
    const d = document.createElement('div'); d.className = 'turn frozen';
    const u = document.createElement('div'); u.className = 'user-row'; const b = document.createElement('div'); b.className = 'user-bubble'; b.textContent = t.input; u.appendChild(b); d.appendChild(u);
    if (t.thinking) {
      const det = document.createElement('details'); det.className = 'think-box';
      const sm = document.createElement('summary'); sm.textContent = L('思考过程 · 已思考 ', 'Thinking · thought for ') + Math.max(1, Math.round((t.thinkMs || 0) / 1000)) + L(' 秒', ' s');
      const body = document.createElement('div'); body.className = 'think-body'; body.textContent = t.thinking;
      det.append(sm, body); d.appendChild(det);
    }
    const a = document.createElement('div'); a.className = 'answer'; paintAnswer(a, t.answer || (t.error || ''), live); d.appendChild(a);
    const m = document.createElement('div'); m.className = 'turn-meta' + (t.stopped ? ' stopped' : ''); m.textContent = metaText(t); d.appendChild(m);
    return d;
  }
  function render(liveLast) {
    threadEl.innerHTML = '';
    const turns = row ? row.turns : [];
    turns.forEach((t, i) => threadEl.appendChild(frozenTurn(t, liveLast && i === turns.length - 1)));
    convo.hidden = !turns.length && live.hidden;
  }
  function persist(rec) {
    if (!row) row = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: T().title(rec.input), turns: [] };
    T().addTurn(row, rec);
    const rows = loadAll().filter(r => r.id !== row.id); rows.unshift(row); saveAll(rows);
    try { localStorage.setItem(LAST, row.id); } catch {}
  }

  async function ask(text, extra) {
    text = String(text || '').trim(); if (!text) return null;
    if (busy) await stop();
    const st = getSettings();
    const prior = row ? T().priorMessages(row.turns, contextOpts()) : [];
    convo.hidden = false; live.hidden = false; meta.textContent = ''; meta.classList.remove('stopped');
    live.querySelectorAll('.runs, .run-figs').forEach(n => { n.innerHTML = ''; });
    q('liveq').textContent = text;
    ac = new AbortController(); setBusy(true);
    const sid = 'w' + Date.now().toString(36);
    const els = { status: q('status'), answer: q('answer'), tools: q('tools'), thinking: q('thinking'), thinkbox: q('thinkbox'), thinksum: q('thinksum'), onStream: () => { const sc = document.scrollingElement; if (sc && sc.scrollHeight - sc.scrollTop - innerHeight < 200) sc.scrollTop = sc.scrollHeight; } };
    let rec = null;
    try { rec = await handleAsk(Object.assign({ q: text, settings: st, signal: ac.signal, prior, els }, extra || {})); }
    finally { setBusy(false); ac = null; }
    if (!rec) return null;
    const full = Object.assign(T().turnRecord(Object.assign({ sid }, rec)), { thinking: String(rec.thinking || '').slice(0, 20000), thinkMs: rec.thinkMs || (rec.thinking ? Math.max(0, (rec.firstAt || rec.endedAt) - rec.startedAt) : 0), stopped: !!rec.stopped });
    meta.textContent = metaText(full); meta.classList.toggle('stopped', full.stopped);
    persist(full);
    // the finished turn moves into the thread; the live area is ready for the next question
    render(!full.stopped); live.hidden = true;
    q('answer').textContent = ''; q('status').textContent = ''; q('tools').innerHTML = ''; q('thinkbox').hidden = true; q('thinking').textContent = '';
    live.querySelectorAll('.runs, .run-figs').forEach(n => { n.innerHTML = ''; });
    convo.hidden = false;
    return full;
  }
  async function stop() { if (ac) ac.abort(); }
  // ----- conversation list: open, search, rename, delete
  const panel = document.createElement('section'); panel.id = 'threadsPanel'; panel.className = 'threads-panel'; panel.hidden = true;
  panel.innerHTML = '<div class="tp-head"><b id="tpTitle"></b><button type="button" id="tpClose">✕</button></div><input type="search" id="tpQ" spellcheck="false"/><div id="tpList" class="tp-list"></div>';
  convo.parentNode.insertBefore(panel, convo);
  const fmt = (ms) => { const d = new Date(ms); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString(en() ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(en() ? 'en-US' : 'zh-CN'); };
  function renderPanel() {
    q('tpTitle').textContent = L('对话记录', 'Chats'); q('tpQ').placeholder = L('搜索对话', 'Search chats');
    const needle = q('tpQ').value.trim().toLowerCase();
    const rows = loadAll().filter(r => r.turns && r.turns.length).filter(r => !needle || String(r.title || '').toLowerCase().includes(needle) || r.turns.some(t => String(t.input || '').toLowerCase().includes(needle) || String(t.answer || '').toLowerCase().includes(needle)))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const list = q('tpList'); list.innerHTML = '';
    if (!rows.length) { const e = document.createElement('div'); e.className = 'hint'; e.textContent = needle ? L('没有匹配的对话', 'No matching chats') : L('还没有对话', 'No chats yet'); list.appendChild(e); return; }
    for (const r of rows) {
      const it = document.createElement('div'); it.className = 'tp-item' + (row && row.id === r.id ? ' current' : ''); it.dataset.id = r.id;
      const main = document.createElement('div'); main.className = 'tp-main';
      const tt = document.createElement('div'); tt.className = 'tp-t'; tt.textContent = r.title || L('对话', 'Chat');
      const sub = document.createElement('div'); sub.className = 'tp-s'; sub.textContent = r.turns.length + L(' 轮 · ', ' turns · ') + fmt(r.updated || Date.now()) + ' · ' + String(r.turns[r.turns.length - 1].input || '').slice(0, 60);
      main.append(tt, sub);
      const ren = document.createElement('button'); ren.type = 'button'; ren.className = 'tp-ren'; ren.textContent = '✎'; ren.title = L('重命名', 'Rename');
      const del = document.createElement('button'); del.type = 'button'; del.className = 'tp-del'; del.textContent = '✕'; del.title = L('删除', 'Delete');
      it.append(main, ren, del);
      main.onclick = () => openThread(r.id);
      ren.onclick = () => { const v = prompt(L('新的名称', 'New name'), r.title || ''); if (v && v.trim()) { const all = loadAll(); const x = all.find(y => y.id === r.id); if (x) { x.title = v.trim().slice(0, 60); saveAll(all); if (row && row.id === x.id) row.title = x.title; } renderPanel(); } };
      del.onclick = () => {
        if (!confirm(L('删除这段对话？此操作无法撤销。', 'Delete this chat? This cannot be undone.'))) return;
        saveAll(loadAll().filter(x => x.id !== r.id));
        if (row && row.id === r.id) newChat();
        renderPanel();
      };
      list.appendChild(it);
    }
  }
  function openThread(id) {
    if (busy) stop();
    row = loadAll().find(r => r.id === id) || null;
    try { localStorage.setItem(LAST, id); } catch {}
    render(); live.hidden = true; convo.hidden = !row; panel.hidden = true;
  }
  q('tpClose').onclick = () => { panel.hidden = true; };
  q('tpQ').oninput = renderPanel;
  function toggleList() { panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel(); }
  function newChat() { if (busy) stop(); row = null; try { localStorage.removeItem(LAST); } catch {} render(); live.hidden = true; convo.hidden = true; }
  // the last conversation is shown again after a reload
  try { const id = localStorage.getItem(LAST); if (id) row = loadAll().find(r => r.id === id) || null; } catch {}
  render();
  document.addEventListener('keydown', (e) => { if (busy && (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === '.'))) { e.preventDefault(); stop(); } });
  return { ask, stop, newChat, toggleList, openThread, busy: () => busy, thread: () => row };
}
