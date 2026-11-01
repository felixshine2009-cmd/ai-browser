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
    phys_list_params: function (args, ctx) { return call(ctx, 'listParams', {}); },
    phys_add_element: function (args, ctx) { return call(ctx, 'addElement', args || {}); },
    phys_update_element: function (args, ctx) { return call(ctx, 'updateElement', args || {}); },
    phys_remove_element: function (args, ctx) { return call(ctx, 'removeElement', args || {}); },
    phys_list_element_types: function (args, ctx) { return call(ctx, 'listElementTypes', args || {}); },
    phys_define_custom_element: function (args, ctx) { return call(ctx, 'defineCustomElement', args || {}); },
    phys_new_scene: function (args, ctx) { return call(ctx, 'newScene', args || {}); },
    phys_get_elements: function (args, ctx) { return call(ctx, 'getElements', {}); }
  }
};
