/* Chat threads (v3.0.0): one conversation = a list of turns shown in one continuous page, like other AI chat apps.
   Shared by the desktop / iPad main process (src/main/ai/thread.js) and the web app (web/js/thread.js, same file).
   - turnRecord: what is kept of a finished turn (question, answer, sources, model, timing)
   - priorMessages: the earlier turns as chat messages for the model, trimmed to the context budget
   - stats / statsLine: the time and speed line under each answer */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIBThread = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var LIMITS = { turnsPerThread: 200, answerChars: 24000, threads: 300 };

  // rough token estimate: CJK characters are about one token each, other text about four characters per token
  function estTokens(s) {
    s = String(s || '');
    var cjk = (s.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g) || []).length;
    return Math.ceil(cjk + (s.length - cjk) / 4);
  }
  function msgTokens(m) {
    var c = m && m.content;
    if (Array.isArray(c)) return c.reduce(function (a, p) { return a + (p && p.text ? estTokens(p.text) : 800); }, 4);
    return estTokens(c) + 4;
  }

  /** Context budget (tokens) for earlier turns: a share of the model context, leaving room for tools, pages and the answer. */
  function budgetFor(opts) {
    opts = opts || {};
    var ctx = Number(opts.contextTokens) || (opts.local ? 4096 : 32000);
    var share = opts.local ? 0.35 : 0.4;
    return Math.max(300, Math.floor(ctx * share));
  }

  function shorten(text, max) {
    text = String(text || '');
    if (text.length <= max) return text;
    var head = text.slice(0, Math.floor(max * 0.7)), tail = text.slice(-Math.floor(max * 0.2));
    return head + '\n…（中间部分已省略）…\n' + tail;
  }

  /**
   * Earlier turns -> [{role, content}] within `budget` tokens. The newest turns are kept whole when possible; older
   * answers are shortened first, then the oldest turns are dropped and replaced by one note listing their questions.
   */
  function trimPrior(messages, budget) {
    var pairs = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'user') pairs.push([m]);
      else if (pairs.length) pairs[pairs.length - 1].push(m);
      else pairs.push([m]);
    }
    var total = function (ps) { return ps.reduce(function (a, p) { return a + p.reduce(function (b, x) { return b + msgTokens(x); }, 0); }, 0); };
    if (total(pairs) <= budget) return { messages: messages.slice(), trimmed: false, dropped: 0 };
    // 1) shorten answers of all but the newest turn
    var cut = pairs.map(function (p, idx) {
      return p.map(function (x) { return (x.role === 'assistant' && idx < pairs.length - 1) ? { role: x.role, content: shorten(x.content, 600) } : x; });
    });
    var dropped = [];
    var note = function () { return dropped.length ? 30 + dropped.reduce(function (a, p) { return a + estTokens(String(p[0].content || '').slice(0, 60)) + 2; }, 0) : 0; };
    // 2) drop the oldest turns until it fits (the newest turn is always kept, shortened if it must be)
    while (cut.length > 1 && total(cut) + note() > budget) dropped.push(cut.shift());
    if (total(cut) + note() > budget) {
      var room = Math.max(120, budget - note());
      var q = cut[0][0], qMax = Math.max(60, Math.floor(room * 0.4));
      var qMsg = { role: q.role, content: shorten(q.content, qMax) };
      var aRoom = Math.max(60, room - msgTokens(qMsg) - 8);
      cut = [[qMsg].concat(cut[0].slice(1).map(function (x) { return { role: x.role, content: shorten(x.content, aRoom) }; }))];
    }
    var out = [];
    if (dropped.length) {
      var qs = dropped.map(function (p) { return '· ' + String(p[0].content || '').replace(/\s+/g, ' ').slice(0, 60); }).join('\n');
      out.push({ role: 'user', content: '（较早的 ' + dropped.length + ' 轮对话因长度限制已省略，当时的问题是：\n' + qs + '）' });
      out.push({ role: 'assistant', content: '好的，我会结合这些背景继续回答。' });
    }
    cut.forEach(function (p) { p.forEach(function (x) { out.push(x); }); });
    return { messages: out, trimmed: true, dropped: dropped.length };
  }

  /** chat messages for the earlier turns of a thread */
  function priorMessages(turns, opts) {
    var msgs = [];
    (turns || []).forEach(function (t) {
      if (!t || !t.input) return;
      msgs.push({ role: 'user', content: String(t.input) });
      msgs.push({ role: 'assistant', content: String(t.answer || '（未完成）') });
    });
    return trimPrior(msgs, budgetFor(opts)).messages;
  }

  function stats(t) {
    if (!t || !t.startedAt) return null;
    var end = t.endedAt || Date.now();
    var total = Math.max(0, end - t.startedAt);
    var first = t.firstAt ? Math.max(0, t.firstAt - t.startedAt) : null;
    var gen = t.firstAt ? Math.max(1, end - t.firstAt) : null;
    var tokens = t.tokens || estTokens(t.answer || '');
    var speed = gen && tokens ? tokens / (gen / 1000) : null;
    return { totalMs: total, firstMs: first, tokens: tokens, tokensPerSec: speed };
  }
  function secs(ms) { return ms < 10000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000)); }
  /** 用时 8.2 秒 · 首字 1.1 秒 · 约 42 token/秒 */
  function statsLine(t, lang) {
    var s = stats(t); if (!s) return '';
    var en = lang === 'en', parts = [];
    parts.push((en ? 'Time ' : '用时 ') + secs(s.totalMs) + (en ? ' s' : ' 秒'));
    if (s.firstMs != null) parts.push((en ? 'first token ' : '首字 ') + secs(s.firstMs) + (en ? ' s' : ' 秒'));
    if (s.tokensPerSec) parts.push((en ? '≈' : '约 ') + (s.tokensPerSec >= 10 ? Math.round(s.tokensPerSec) : s.tokensPerSec.toFixed(1)) + (en ? ' tokens/s' : ' token/秒'));
    return parts.join(' · ');
  }

  /** What is stored of a finished turn. */
  function turnRecord(s) {
    return {
      sid: s.sid, input: String(s.input || '').slice(0, 8000), kind: s.kind || 'question',
      answer: String(s.answer || '').slice(0, LIMITS.answerChars), sources: (s.sources || []).slice(0, 30).map(function (x) { return { n: x.n, title: x.title, url: x.url, site: x.site }; }),
      tools: (s.tools || []).slice(0, 30), model: s.model || '', error: s.error || '',
      startedAt: s.startedAt || 0, firstAt: s.firstAt || 0, endedAt: s.endedAt || 0, tokens: s.tokens || 0, at: s.endedAt || Date.now()
    };
  }
  /** Adds or replaces a turn in a thread row (kept to the limits). */
  function addTurn(row, turn) {
    row.turns = Array.isArray(row.turns) ? row.turns : [];
    var i = row.turns.findIndex(function (x) { return x.sid === turn.sid; });
    if (i >= 0) row.turns[i] = turn; else row.turns.push(turn);
    if (row.turns.length > LIMITS.turnsPerThread) row.turns.splice(0, row.turns.length - LIMITS.turnsPerThread);
    row.updated = Date.now();
    row.preview = String(turn.input || '').slice(0, 80);
    return row;
  }
  function title(text) { var s = String(text || '').replace(/\s+/g, ' ').trim(); return s.slice(0, 24) || '新对话'; }

  return { LIMITS: LIMITS, estTokens: estTokens, budgetFor: budgetFor, trimPrior: trimPrior, priorMessages: priorMessages, stats: stats, statsLine: statsLine, turnRecord: turnRecord, addTurn: addTurn, title: title };
});
