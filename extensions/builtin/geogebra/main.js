// GeoGebra 绘图 — feature extension "aib.geogebra". Tools are forwarded to the GeoGebra panel (panel.html).
function call(ctx, method, args) { return aib.panels.call(ctx, 'canvas', method, args); }
module.exports = {
  tools: {
    ggb_eval: function (args, ctx) {
      var cmds = (args && args.commands) || [];
      if (typeof cmds === 'string') cmds = [cmds];
      return call(ctx, 'eval', { commands: cmds });
    },
    ggb_clear: function (args, ctx) { return call(ctx, 'clear', {}); },
    ggb_export_png: function (args, ctx) { return call(ctx, 'exportPng', {}); }
  }
};
