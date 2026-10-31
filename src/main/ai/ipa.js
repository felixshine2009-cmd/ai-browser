'use strict';
// Compact CMUdict→IPA (US) lookup. Bundled as gzip JSON so we never show model-invented garbage for common words.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let table = null;
function load() {
  if (table) return table;
  try {
    const buf = fs.readFileSync(path.join(__dirname, 'data', 'ipa-us.json.gz'));
    table = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  } catch (e) { console.error('ipa table load failed', e.message); table = {}; }
  return table;
}

function lookup(word) {
  if (!word) return '';
  const w = String(word).toLowerCase().trim();
  const t = load();
  if (t[w]) return '/' + t[w] + '/';
  // simple inflection fallbacks
  for (const sfx of ["'s", 's', 'es', 'ed', 'ing', 'ly', 'er', 'est', 'ness', 'ment']) {
    if (w.length > sfx.length + 2 && w.endsWith(sfx) && t[w.slice(0, -sfx.length)]) return '/' + t[w.slice(0, -sfx.length)] + '/';
  }
  if (w.endsWith('ies') && t[w.slice(0, -3) + 'y']) return '/' + t[w.slice(0, -3) + 'y'] + '/';
  return '';
}

// Prefer dictionary IPA; only keep a model-provided value when we have nothing better AND it looks like real IPA.
function merge(word, modelUk, modelUs) {
  const dict = lookup(word);
  const clean = (s) => {
    s = String(s || '').trim();
    if (!s) return '';
    if (!/^[/\[]?[ˈˌa-zA-Zəɚɝɪʊɔæɑʌɛθðʃʒŋɡʧʤː.ˈˌ\u02c8\u02cc\u02d0\s\-]+[/ \]]?$/.test(s)) return '';
    if (!s.startsWith('/') && !s.startsWith('[')) s = '/' + s;
    if (!s.endsWith('/') && !s.endsWith(']')) s = s + '/';
    s = s.replace(/^\[/, '/').replace(/\]$/, '/');
    // reject obvious garbage / placeholders / doubled-consonant nonsense like ˈæpplə
    if (/中文|ipa_|ˈæppl|placeholder|xxx|ˈˈ/i.test(s)) return '';
    if (s.length < 3 || s.length > 40) return '';
    return s;
  };
  const uk = clean(modelUk), us = clean(modelUs);
  return {
    ipa_us: dict || us || uk || '',
    // We only ship US CMUdict; keep model UK only when it differs from US and looks valid
    ipa_uk: (uk && uk !== (dict || us)) ? uk : (dict || us || uk || '')
  };
}

module.exports = { lookup, merge, load };
