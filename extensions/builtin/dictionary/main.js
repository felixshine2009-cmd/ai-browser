// 词典 — feature extension "aib.dictionary" (standard aib-feature/1). Runs in the extension sandbox.
module.exports = {
  inputHandlers: {
    // input: { kind:'word', word, phrase? } -> result rendered by the browser as a dictionary page
    lookup: async function (input) {
      const dict = aib.host.dictionary;
      const hits = dict.lookup(input.word);
      if (!hits.length) return null; // let the next handler / AI fallback take over
      return {
        type: 'dictionary',
        word: input.word,
        results: hits.map(function (h) {
          return { dictId: h.dictId, name: h.name, key: h.key, url: 'aibdict://' + h.dictId + '/__entry__?key=' + encodeURIComponent(h.key) };
        }),
        suggestions: dict.suggest(input.word, 10)
      };
    }
  },
  rpc: {
    list: function () { return aib.host.dictionary.list(); },
    progress: function () { return aib.host.dictionary.progress(); },
    pickAndAdd: function () { return aib.host.dictionary.pickAndAdd(); },
    remove: function (a) { return aib.host.dictionary.remove(a.id); },
    setEnabled: function (a) { return aib.host.dictionary.setEnabled(a.id, a.enabled); },
    move: function (a) { return aib.host.dictionary.move(a.id, a.delta); },
    suggest: function (a) { return aib.host.dictionary.suggest(a.prefix, 12); },
    lookup: function (a) { return aib.host.dictionary.lookup(a.word); }
  }
};
