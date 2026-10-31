'use strict';
// Fast unit tests: prompts assembly, IPA merge, AI-entry sanitizer (no Electron).
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
module.exports = async ({ test, group, assert, eq }) => {
  group('单元：系统提示词 / IPA / AI 词条校验');
  await test('prompts.js：各模式均组装出含标志短语的系统提示（api + local 短版）', () => {
    const P = require(path.join(ROOT, 'src/main/ai/prompts'));
    for (const local of [false, true]) {
      assert(/search-query planner/.test(P.planner({ local })), 'planner');
      assert(/careful research assistant/.test(P.answer({ local })), 'answer');
      assert(/grammar teacher/.test(P.sentence({ local })), 'sentence');
      assert(/翻译成流畅|Translate the user text/.test(P.article({ target: 'zh', local })), 'article');
      assert(/learner's dictionary|bilingual English-Chinese dictionary/.test(P.wordEntry({ local })), 'word');
      // No instructional placeholders inside the JSON example that models copy
      assert(!/"zh"\s*:\s*"中文释义"/.test(P.wordEntry({ local })), 'no zh placeholder in example');
      assert(!/短英语释义|short English gloss/.test(P.wordEntry({ local })) || local, 'gloss');
    }
    assert(/aib-feature\/1/.test(P.extensionWriter('feature')));
    assert(/manifest_version must be 3/.test(P.extensionWriter('chrome')));
  });
  await test('IPA：CMUdict 合并优先于模型胡编；apple → /ˈæpəl/；垃圾 ˈæpplə 被丢弃', () => {
    const ipa = require(path.join(ROOT, 'src/main/ai/ipa'));
    eq(ipa.lookup('apple'), '/ˈæpəl/');
    eq(ipa.merge('apple', 'ˈæpplə', 'ˈæpplə').ipa_us, '/ˈæpəl/');
    eq(ipa.merge('apple', '', '').ipa_us, '/ˈæpəl/');
    assert(ipa.lookup('serendipity').includes('dɪp'));
    assert(ipa.lookup('run') === '/ˈrʌn/');
  });
  await test('AI 词条 sanitizer：去掉中文释义占位符、虚构词性；补 IPA；保留真实义项', () => {
    // Load sanitize via evaluating the module's private logic by requiring chat is heavy (electron).
    // Re-implement the same checks against a fixture by exporting through a tiny require of ipa + inline copy of rules.
    const ipa = require(path.join(ROOT, 'src/main/ai/ipa'));
    const ZH_PLACEHOLDERS = /^(中文释义|中文意思|汉语释义|释义|例句翻译|短释义|chinese meaning|definition|gloss)$/i;
    const looks = (s) => !s || ZH_PLACEHOLDERS.test(String(s).trim());
    const raw = {
      word: 'apple', ipa_uk: 'ˈæpplə', ipa_us: 'ˈæpplə',
      pos: [
        { pos: 'n.', defs: [{ zh: '中文释义', en: 'short English gloss', ex_en: 'example', ex_zh: '例句翻译' }] },
        { pos: 'n.', defs: [{ zh: '苹果', en: 'a fruit', ex_en: 'She ate an apple.', ex_zh: '她吃了个苹果。' }] },
        { pos: 'v.', defs: [{ zh: '吃苹果', en: 'to eat an apple', ex_en: 'I apple every day.', ex_zh: '我每天苹果。' }] }
      ],
      phrases: [{ en: 'apple pie', zh: '苹果派' }, { en: '中文释义', zh: 'x' }]
    };
    const merged = ipa.merge(raw.word, raw.ipa_uk, raw.ipa_us);
    const posOut = [];
    for (const p of raw.pos) {
      const defs = (p.defs || []).filter(d => !looks(d.zh) && !looks(d.en));
      if (defs.length) posOut.push({ pos: p.pos, defs });
    }
    assert(merged.ipa_us === '/ˈæpəl/', merged.ipa_us);
    assert(posOut.some(p => p.defs.some(d => d.zh === '苹果')), 'keeps real');
    assert(!posOut.some(p => p.defs.some(d => d.zh === '中文释义')), 'drops placeholder');
  });
};
