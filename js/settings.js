const KEY='aib.settings.v1';
const DEF={
  displayName:'Felix', greeting:'', lang:'zh',
  engine:'api', // 'api' | 'local'
  api:{baseUrl:'https://api.deepseek.com/v1', apiKey:'', model:'deepseek-chat'},
  local:{ modelId:'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' },
  kb:{ embed:'text' }, // 'text' | 'vector'
  search:{engine:'baidu', custom:''}
};
export function load(){
  try{
    const raw = JSON.parse(localStorage.getItem(KEY)||'{}');
    return Object.assign({}, DEF, raw, {
      api: Object.assign({}, DEF.api, raw.api||{}),
      local: Object.assign({}, DEF.local, raw.local||{}),
      kb: Object.assign({}, DEF.kb, raw.kb||{}),
      search: Object.assign({}, DEF.search, raw.search||{}),
    });
  } catch { return structuredClone(DEF); }
}
export function save(s){ localStorage.setItem(KEY, JSON.stringify(s)); }
export function engines(){
  return {
    baidu: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
    bing: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    custom: (q,u) => (u||'').replace('%s', encodeURIComponent(q)),
  };
}
