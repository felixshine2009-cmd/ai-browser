module.exports = {
  inputHandlers: {
    zz: async function (input) {
      if (input.word.toLowerCase() !== 'zzyzx') return null;
      return { type: 'markdown', text: '**sample-echo v1.0.0** handled ' + input.word };
    }
  },
  tools: { sample_echo: async function (args) { return { echoed: args.text, ext: 'user.sample-echo' }; } },
  rpc: {
    probe: async function () {
      var out = { process: typeof process, require: typeof require, fn: typeof Function };
      try { out.net = await aib.net.fetchText('http://127.0.0.1:1/'); } catch (e) { out.netError = String(e.message); }
      try { out.evalBlocked = (function () { try { return eval('1+1'); } catch (e) { return 'blocked'; } })(); } catch (e) { out.evalBlocked = 'blocked'; }
      return out;
    },
    store: async function (a) { aib.storage.set('k', a.v); return aib.storage.get('k'); },
    read: async function () { return aib.storage.get('k'); }
  }
};
