// GeoGebra Math Apps — full offline bundle (graphing / geometry / 3D / CAS / scientific / suite).
// Tools are forwarded to the panel (panel.html) which hosts the HTML5 applet + WEB math keyboard.
function call(ctx, method, args) { return aib.panels.call(ctx, 'canvas', method, args); }
module.exports = {
  tools: {
    ggb_eval: function (args, ctx) {
      var cmds = (args && args.commands) || [];
      if (typeof cmds === 'string') cmds = [cmds];
      return call(ctx, 'eval', { commands: cmds });
    },
    ggb_clear: function (args, ctx) { return call(ctx, 'clear', {}); },
    ggb_export_png: function (args, ctx) { return call(ctx, 'exportPng', {}); },
    ggb_set_app: function (args, ctx) { return call(ctx, 'setApp', { app: (args && args.app) || 'graphing' }); },
    ggb_save: function (args, ctx) { return call(ctx, 'getBase64', {}); },
    ggb_load: function (args, ctx) { return call(ctx, 'setBase64', { ggb: (args && (args.ggb || args.base64)) || '' }); },
    ggb_keyboard: function (args, ctx) { return call(ctx, 'showKeyboard', {}); },
    ggb_state: function (args, ctx) { return call(ctx, 'state', {}); }
  }
};
