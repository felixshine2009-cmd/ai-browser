const KEY='aib.settings.v1';
const DEF={ displayName:'Felix', greeting:'', lang:'zh', api:{baseUrl:'https://api.deepseek.com/v1', apiKey:'', model:'deepseek-chat'}, search:{engine:'baidu', custom:''} };
export function load(){ try{ return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY)||'{}'), {api:Object.assign({},DEF.api, JSON.parse(localStorage.getItem(KEY)||'{}').api||{})}); }catch{ return structuredClone(DEF);} }
export function save(s){ localStorage.setItem(KEY, JSON.stringify(s)); }
export function engines(){
  return {
    baidu: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
    bing: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    custom: (q,u) => (u||'').replace('%s', encodeURIComponent(q)),
  };
}
