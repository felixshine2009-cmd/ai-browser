export const STR = {
  zh: {
    appName:'AI 浏览器（网页版）', chat:'聊天', search:'搜索', settings:'设置', send:'发送',
    greetingDefault:'{name}，您好', displayName:'显示名称', greeting:'问候语', save:'保存', saved:'已保存',
    lang:'语言', provider:'服务商', apiBase:'API Base URL', apiKey:'API Key', apiModel:'模型', testConn:'测试连接',
    corsHint:'若浏览器拦截跨域请求，请换用支持浏览器 CORS 的提供商，或自建反向代理。',
    deskOnly:'仅桌面版可用', deskNote:'以下功能仅在桌面应用中可用，网页版显示为灰色：多标签 / 隐身、桌面本地模型（llama.cpp / MLX / MTP）、Chrome 拓展、密码管理、打印、Siri 侧栏、Task 浏览器控制、内核升级、多线程下载。网页版可用 WebGPU 本地模型。',
    solve:'解题', wiki:'百科', siri:'Siri', task:'Task', kernel:'内核', mt:'多线程下载', phone:'拍照上传', theme:'主题', appearance:'外观', appearanceHint:'「跟随系统」时随系统的浅色 / 深色外观自动切换下面两套主题。', darkTheme:'深色主题', lightTheme:'浅色主题', answerStyle:'回答风格', thinking:'思考等级',
    newIncog:'新建隐身标签页', passwords:'密码', print:'打印', extensions:'拓展', localModels:'本地模型（WebGPU）', localModelsDesk:'本地模型（桌面）', localHint:'在浏览器中用 WebGPU 运行量化本地模型（WebLLM：Qwen2.5 / Gemma 2，约 0.5–3B）。首次会下载并缓存到浏览器。手机请优先选 0.5B / 1.5B。', localLoad:'加载模型', localUnload:'卸载', localNotLoaded:'本地模型尚未加载。请先在设置中加载。', localProgress:'下载 / 编译中…', localCached:'已缓存', engineKind:'对话引擎', engineApi:'自定义 API', engineLocal:'本地 WebGPU', kbEmbed:'知识库检索', kbEmbedText:'文本匹配', kbEmbedVector:'向量检索（EmbeddingGemma）', webgpuOk:'WebGPU 可用', webgpuNo:'无 WebGPU — 本地模型不可用', webgpuDisabled:'当前浏览器没有可用的 WebGPU，本地模型已禁用。',
    bookmarks:'书签', downloads:'下载', find:'页内查找', zoom:'缩放',
    engBing:'Bing', engBaidu:'百度', engGoogle:'Google', engCustom:'自定义',
    searchEngine:'搜索引擎', askPlaceholder:'请输入问题，或输入需要翻译的文本',
    tools:'工具', ggb:'GeoGebra', phys:'物理仿真', kb:'知识库', dict:'词典',
    kbAdd:'添加文本', kbSearch:'检索', kbEmpty:'知识库为空',
    offline:'离线可用（应用外壳）', addHome:'可在 Safari 中“添加到主屏幕”以全屏使用。',
    copy:'复制', clear:'清空', error:'出现错误', thinking:'正在处理…',
    panelGgb:'GeoGebra', panelPhys:'物理', sources:'来源', close:'关闭', show:'显示',
    localPause:'暂停', localResume:'继续', diskTitle:'存储占用', diskFiles:'模型文件', diskCache:'缓存', diskClearCache:'清理缓存', diskDelete:'删除模型', diskEstimate:'浏览器存储', diskEmpty:'暂无已下载的模型', kbClearTitle:'清空知识库？', kbClearMsg:'将删除知识库中的 {n} 条内容。', cleared:'已清除 {n} 条',
  },
  en: {
    appName:'AI Browser (Web)', chat:'Chat', search:'Search', settings:'Settings', send:'Send',
    greetingDefault:'Hello, {name}', displayName:'Display name', greeting:'Greeting', save:'Save', saved:'Saved',
    lang:'Language', provider:'Provider', apiBase:'API Base URL', apiKey:'API Key', apiModel:'Model', testConn:'Test connection',
    corsHint:'If the browser blocks cross-origin requests, switch to a provider that allows browser CORS, or use your own reverse proxy.',
    deskOnly:'Desktop only', deskNote:'These features are desktop-only and shown grayed out on the web: tabs / incognito, desktop local models (llama.cpp / MLX / MTP), Chrome extensions, passwords, print, the Siri sidebar, Task browser control, kernel upgrade, multithreaded downloads. The web build supports WebGPU local models.',
    solve:'Solve', wiki:'Wiki', siri:'Siri', task:'Task', kernel:'Kernel', mt:'Multithread download', phone:'Upload a photo', theme:'Theme', appearance:'Appearance', appearanceHint:'Follow system switches between the light and dark theme with the system appearance.', darkTheme:'Dark theme', lightTheme:'Light theme', answerStyle:'Answer style', thinking:'Thinking level',
    newIncog:'New incognito tab', passwords:'Passwords', print:'Print', extensions:'Extensions', localModels:'Local models (WebGPU)', localModelsDesk:'Local models (desktop)', localHint:'Run a quantized local model in the browser via WebGPU (WebLLM: Qwen2.5 / Gemma 2, ~0.5–3B). First load downloads into the browser cache. On phones prefer 0.5B / 1.5B.', localLoad:'Load model', localUnload:'Unload', localNotLoaded:'Local model not loaded. Load one in Settings first.', localProgress:'Downloading / compiling…', localCached:'Cached', engineKind:'Chat engine', engineApi:'Custom API', engineLocal:'Local WebGPU', kbEmbed:'Knowledge-base search', kbEmbedText:'Text match', kbEmbedVector:'Vector search (EmbeddingGemma)', webgpuOk:'WebGPU available', webgpuNo:'No WebGPU — local models unavailable', webgpuDisabled:'This browser has no usable WebGPU; local models are disabled.',
    bookmarks:'Bookmarks', downloads:'Downloads', find:'Find in page', zoom:'Zoom',
    engBing:'Bing', engBaidu:'Baidu', engGoogle:'Google', engCustom:'Custom',
    searchEngine:'Search engine', askPlaceholder:'Enter a question, or text to translate',
    tools:'Tools', ggb:'GeoGebra', phys:'Physics', kb:'Knowledge base', dict:'Dictionary',
    kbAdd:'Add text', kbSearch:'Search', kbEmpty:'Knowledge base empty',
    offline:'Offline-capable app shell', addHome:'On iPhone Safari: Share → Add to Home Screen for fullscreen use.',
    copy:'Copy', clear:'Clear', error:'An error occurred', thinking:'Processing…',
    panelGgb:'GeoGebra', panelPhys:'Physics', sources:'Sources', close:'Close', show:'Show',
    localPause:'Pause', localResume:'Resume', diskTitle:'Storage', diskFiles:'Model files', diskCache:'Cache', diskClearCache:'Clear cache', diskDelete:'Delete model', diskEstimate:'Browser storage', diskEmpty:'No downloaded models', kbClearTitle:'Clear knowledge base?', kbClearMsg:'This will delete {n} item(s) from the knowledge base.', cleared:'Cleared {n} item(s)',
  }
};
let lang = localStorage.getItem('aib.lang') || (navigator.language||'').startsWith('zh') ? 'zh' : 'en';
if (!STR[lang]) lang = 'en';
export function t(k){ return (STR[lang]&&STR[lang][k]) || (STR.en[k]) || k; }
export function getLang(){ return lang; }
export function setLang(l){ lang = STR[l]?l:'en'; localStorage.setItem('aib.lang', lang); document.documentElement.lang = lang==='zh'?'zh-CN':'en'; }
export function applyI18n(root=document){
  root.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title = t(el.dataset.i18nTitle); });
}
