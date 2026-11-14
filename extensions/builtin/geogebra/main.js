// GeoGebra Math Apps — full offline bundle (graphing / geometry / 3D / CAS / scientific / suite).
// Tools are forwarded to the panel (panel.html) which hosts the HTML5 applet + WEB math keyboard.
// The panel itself fails after 30 s (page) + 60 s (applet) with a specific message; this is the last guard.
var TIMEOUT_MS = 100000;
function call(ctx, method, args) {
  return aib.panels.call(ctx, 'canvas', method, args, {
    timeoutMs: TIMEOUT_MS,
    timeoutMsg: 'GeoGebra 执行超时（' + (TIMEOUT_MS / 1000) + ' 秒）：面板未能在规定时间内完成“' + method + '”。请检查 GeoGebra 面板是否已显示，稍后重试；也可以改用文字说明作答。'
  });
}
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
