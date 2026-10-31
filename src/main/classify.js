'use strict';
// Chat-mode input classification: word | sentence | article | question
const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g;
const LATIN = /[A-Za-z]/g;
const WH = /^(what|why|how|when|where|who|whom|whose|which|is|are|am|was|were|do|does|did|can|could|will|would|should|shall|may|might|has|have|had|explain|tell|describe|compare|list|give|show|write|draw|plot|solve|calculate)\b/i;

function stats(text) {
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.match(LATIN) || []).length;
  return { cjk, latin };
}

function countSentences(text) {
  const m = text.match(/[.!?。！？]+(\s|$)/g);
  return m ? m.length : 0;
}

function classify(input) {
  const text = (input || '').trim();
  if (!text) return { kind: 'empty' };
  const { cjk, latin } = stats(text);
  const paras = text.split(/\n\s*\n/).filter(s => s.trim()).length;
  const lines = text.split(/\n/).filter(s => s.trim()).length;
  const tokens = text.split(/\s+/).filter(Boolean);
  const englishDominant = latin > 0 && cjk === 0;
  const cjkDominant = cjk > latin && cjk > 0;

  // Article: multi-paragraph or long text
  if ((englishDominant && (paras >= 2 || lines >= 3 || text.length > 500 || countSentences(text) > 4)) ||
      (cjkDominant && (paras >= 2 || lines >= 3 || text.length > 300))) {
    return { kind: 'article', target: cjkDominant ? 'en' : 'zh' };
  }
  if (englishDominant) {
    const isQuestion = /\?\s*$/.test(text) || (WH.test(text) && !/[.!]\s*$/.test(text) && tokens.length >= 4);
    // single token (letters, ' and -) => dictionary word
    if (tokens.length === 1 && /^[A-Za-z][A-Za-z'’\-]{0,40}$/.test(tokens[0])) return { kind: 'word', word: tokens[0] };
    // 2-3 tokens, no sentence punctuation => candidate phrase (checked against dictionary by caller)
    if (tokens.length <= 3 && !/[.!?,;:]/.test(text) && /^[A-Za-z][A-Za-z'’\- ]*$/.test(text)) {
      return { kind: 'word', word: text.replace(/\s+/g, ' '), phrase: true };
    }
    if (isQuestion) return { kind: 'question' };
    if (tokens.length >= 2 && tokens.length <= 120 && countSentences(text) <= 3) return { kind: 'sentence' };
    return { kind: 'question' };
  }
  return { kind: 'question' };
}

// Simple lemma candidates for inflected forms.
function lemmaCandidates(w) {
  const lower = w.toLowerCase();
  const out = new Set([w, lower]);
  const add = x => { if (x && x.length > 1) out.add(x); };
  if (/ies$/.test(lower)) add(lower.slice(0, -3) + 'y');
  if (/(ses|xes|zes|ches|shes)$/.test(lower)) add(lower.slice(0, -2));
  if (/s$/.test(lower) && !/ss$/.test(lower)) add(lower.slice(0, -1));
  if (/ied$/.test(lower)) add(lower.slice(0, -3) + 'y');
  if (/ed$/.test(lower)) { add(lower.slice(0, -2)); add(lower.slice(0, -1)); if (/(.)\1ed$/.test(lower)) add(lower.slice(0, -3)); }
  if (/ing$/.test(lower)) { const b = lower.slice(0, -3); add(b); add(b + 'e'); if (/(.)\1$/.test(b)) add(b.slice(0, -1)); }
  if (/ly$/.test(lower)) add(lower.slice(0, -2));
  if (/er$|est$/.test(lower)) { add(lower.replace(/(er|est)$/, '')); add(lower.replace(/(er|est)$/, 'e')); }
  if (/n['’]t$/.test(lower)) add(lower.replace(/n['’]t$/, ''));
  return [...out];
}

module.exports = { classify, lemmaCandidates };
