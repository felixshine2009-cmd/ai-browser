// Lightweight web agent tool registry. Chat can call these; Settings UI uses the same handlers.
import { tools as localTools, CATALOG, detectWebGPU, memoryWarning } from './local-model.js';
import { getMode, currentEmbedModel } from './embed.js';

const handlers = {
  ...localTools,
  async kb_embed_status(){ return { mode: getMode(), model: currentEmbedModel() }; },
  async webgpu_detect(){ return detectWebGPU(); },
  async local_model_memory_warning({ modelId }){ return memoryWarning(modelId || CATALOG[0].id); },
};

export function listTools(){
  return Object.keys(handlers).map(name => ({ name, description: name }));
}

export async function callTool(name, args){
  if (!handlers[name]) throw new Error('unknown tool: ' + name);
  return handlers[name](args || {});
}

export { handlers };
