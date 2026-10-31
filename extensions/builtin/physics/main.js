function call(ctx, method, args) { return aib.panels.call(ctx, 'canvas', method, args); }
module.exports = {
  tools: {
    phys_validate: function (args, ctx) { return call(ctx, 'validate', { scene: args && args.scene }); },
    phys_load: function (args, ctx) { return call(ctx, 'load', { scene: args && args.scene }); },
    phys_play: function (args, ctx) { return call(ctx, 'play', {}); },
    phys_pause: function (args, ctx) { return call(ctx, 'pause', {}); },
    phys_step: function (args, ctx) { return call(ctx, 'step', { n: args && args.n }); },
    phys_reset: function (args, ctx) { return call(ctx, 'reset', {}); },
    phys_set_speed: function (args, ctx) { return call(ctx, 'setSpeed', { speed: args && args.speed }); },
    phys_state: function (args, ctx) { return call(ctx, 'state', {}); },
    phys_list_examples: function (args, ctx) { return call(ctx, 'listExamples', {}); },
    phys_load_example: function (args, ctx) { return call(ctx, 'loadExample', { id: args && (args.id || args.example) }); },
    phys_set_param: function (args, ctx) { return call(ctx, 'setParam', args || {}); },
    phys_update: function (args, ctx) { return call(ctx, 'update', args || {}); },
    phys_list_params: function (args, ctx) { return call(ctx, 'listParams', {}); }
  }
};
