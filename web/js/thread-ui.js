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
  function frozenTurn(t) {
    const d = document.createElement('div'); d.className = 'turn frozen';
    const u = document.createElement('div'); u.className = 'user-row'; const b = document.createElement('div'); b.className = 'user-bubble'; b.textContent = t.input; u.appendChild(b); d.appendChild(u);
    if (t.thinking) {
      const det = document.createElement('details'); det.className = 'think-box';
      const sm = document.createElement('summary'); sm.textContent = L('思考过程 · 已思考 ', 'Thinking · thought for ') + Math.max(1, Math.round((t.thinkMs || 0) / 1000)) + L(' 秒', ' s');
      const body = document.createElement('div'); body.className = 'think-body'; body.textContent = t.thinking;
      det.append(sm, body); d.appendChild(det);
    }
    const a = document.createElement('div'); a.className = 'answer'; a.textContent = t.answer || (t.error || ''); d.appendChild(a);
    const m = document.createElement('div'); m.className = 'turn-meta' + (t.stopped ? ' stopped' : ''); m.textContent = metaText(t); d.appendChild(m);
    return d;
  }
  function render() {
    threadEl.innerHTML = '';
    const turns = row ? row.turns : [];
    turns.forEach(t => threadEl.appendChild(frozenTurn(t)));
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
    render(); live.hidden = true;
    q('answer').textContent = ''; q('status').textContent = ''; q('tools').innerHTML = ''; q('thinkbox').hidden = true; q('thinking').textContent = '';
    live.querySelectorAll('.runs, .run-figs').forEach(n => { n.innerHTML = ''; });
    convo.hidden = false;
    return full;
  }
  async function stop() { if (ac) ac.abort(); }
  function newChat() { if (busy) stop(); row = null; try { localStorage.removeItem(LAST); } catch {} render(); live.hidden = true; convo.hidden = true; }
  // the last conversation is shown again after a reload
  try { const id = localStorage.getItem(LAST); if (id) row = loadAll().find(r => r.id === id) || null; } catch {}
  render();
  document.addEventListener('keydown', (e) => { if (busy && (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === '.'))) { e.preventDefault(); stop(); } });
  return { ask, stop, newChat, busy: () => busy, thread: () => row };
}
