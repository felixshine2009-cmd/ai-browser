import json
orig=json.load(open('/workspace/ai-browser-mockups/strings.json'))
add = {
"nav.back":("后退","Back"),"nav.forward":("前进","Forward"),"nav.reload":("重新载入","Reload"),"nav.bookmark":("加入书签","Bookmark this page"),
"chat.answer":("AI 回答","AI answer"),"chat.pagesRead":("已阅读的网页","Pages read"),"chat.sources":("引用来源","Sources"),
"chat.queries":("已改写的搜索查询（可编辑）","Rewritten search queries (editable)"),"chat.rerun":("↻ 重新搜索","↻ Search again"),
"chat.thinking":("正在处理…","Working…"),"chat.searching":("正在检索网页…","Searching the web…"),"chat.reading":("正在阅读网页…","Reading pages…"),
"chat.generating":("正在生成回答…","Generating answer…"),"chat.error":("出现错误：","Error:"),"chat.gotoSettings":("前往设置","Open Settings"),
"chat.copy":("复制","Copy"),"chat.toolsUsed":("已调用工具：","Tools used:"),"chat.expired":("此会话已失效，请重新提问。","This session expired. Please ask again."),
"plot.area":("图形区","Graph area"),"plot.byAi":("由 AI 驱动","Driven by AI"),
"dict.aiTab":("AI 释义","AI entry"),"dict.manage":("管理词典…","Manage dictionaries…"),"dict.related":("相近词：","Related:"),
"dict.aiLabel":("AI 生成词条","AI-generated entry"),"dict.aiNote":("AI 生成 · 非词典释义，仅供参考","AI-generated · not a dictionary entry"),
"dict.aiGenerating":("AI 正在生成词条…","AI is generating an entry…"),"dict.uk":("英","UK"),"dict.us":("美","US"),"dict.phrases":("常用短语","Phrases"),
"dict.settings.title":("词典 MDX/MDD","Dictionaries MDX/MDD"),"dict.settings.sub":("导入 MDict 词典，用于 Chat 模式查词与网页划词。","Import MDict dictionaries for Chat-mode lookups and selection lookup on web pages."),
"dict.settings.disabled":("词典拓展已停用，请在“拓展”页启用。","The dictionary extension is disabled. Enable it on the Extensions page."),
"dict.selLookup":("在网页上划词/双击查词","Look up words on double-click / selection in web pages"),
"lookup.notfound":("词典中未找到该词。","Not found in the dictionaries."),
"find.placeholder":("在页面上查找","Find on page"),"find.none":("无结果","No results"),
"sent.orig":("原文 · 成分标注","Original · components"),"sent.breakdown":("结构拆解","Structure"),"sent.translation":("中文翻译","Translation"),
"role.subj":("主语","Subject"),"role.pred":("谓语","Predicate"),"role.obj":("宾语","Object"),"role.attr":("定语","Attributive"),"role.adv":("状语","Adverbial"),"role.comp":("补语","Complement"),
"article.title":("全文翻译","Article translation"),"article.copy":("复制译文","Copy translation"),"article.src":("原文","Original"),"article.dst":("译文","Translation"),
"settings.nav.dict":("词典 MDX/MDD","Dictionaries"),"settings.nav.general":("通用","General"),"settings.nav.privacy":("隐私","Privacy"),
"ai.active":("当前使用","Active"),"ai.api.format":("接口格式","API format"),"ai.api.keySaved":("•••••••• 已保存（留空保持不变）","•••••••• saved (leave blank to keep)"),
"ai.api.keyHint":("密钥仅保存在本机（系统钥匙串加密），只在主进程发起请求，不会写入日志。","The key is stored locally only (encrypted by the OS keychain), used from the main process, never logged."),
"ai.api.temp":("温度 temperature","Temperature"),"ai.api.testing":("测试中…","Testing…"),"ai.api.testOk":("连接成功","Connected"),"ai.api.testFail":("连接失败","Failed"),
"common.saved":("已保存","Saved"),"common.delete":("删除","Delete"),"common.cancel":("取消","Cancel"),
"ai.local.pick":("选择本地 .gguf 文件…","Choose a local .gguf file…"),"ai.local.mirror":("使用 HF 镜像 (hf-mirror.com) 下载","Download via HF mirror (hf-mirror.com)"),
"ai.local.use":("使用本地模型","Use local model"),"ai.local.resume":("继续下载","Resume"),"ai.local.current":("当前模型文件","Current model file"),"ai.local.none":("尚未选择模型。","No model selected."),
"ai.local.engineOk":("推理引擎 node-llama-cpp 可用","Inference engine node-llama-cpp is available"),"ai.local.engineErr":("推理引擎不可用","Inference engine unavailable"),
"se.template.bad":("模板必须包含 %s","Template must contain %s"),
"general.title":("通用","General"),
"privacy.title":("隐私","Privacy"),"privacy.sub":("清除本机保存的浏览数据。","Clear browsing data stored on this device."),"privacy.history":("历史记录","History"),"privacy.downloads":("下载记录","Download list"),
"privacy.cache":("缓存","Cache"),"privacy.cookies":("Cookie 与网站数据","Cookies and site data"),"privacy.clear":("清除所选数据","Clear selected data"),"privacy.done":("已清除","Cleared"),
"ext.loadChrome":("加载拓展…","Load extension…"),"ext.settings":("设置","Settings"),"ext.checking":("检查中…","Checking…"),"ext.upToDate":("已是最新版本","Up to date"),
"ext.newVersion":("发现新版本 {v}","New version {v}"),"ext.update":("更新","Update"),"ext.updateFail":("检查失败","Check failed"),
"ext.chrome.empty":("尚未加载 Chrome 拓展。支持解压文件夹、.crx、.zip（Manifest V3，尽力兼容）。","No Chrome extensions loaded. Supports unpacked folders, .crx, .zip (Manifest V3, best effort)."),
"ext.popup":("打开弹窗页","Open popup"),"ext.options":("选项","Options"),
"ext.ai.placeholder":("例如：在网页右下角显示字数统计，点击可复制标题和 URL。","e.g. Show a word count in the bottom-right corner of pages; click to copy title and URL."),
"ext.ai.generating":("AI 正在生成…","AI is generating…"),"ext.preview.title":("预览 AI 生成的拓展","Preview of AI-generated extension"),
"ext.preview.warn":("请先阅读代码再安装；拓展将获得其清单中声明的权限。","Read the code before installing; the extension gets the permissions declared in its manifest."),
"ext.preview.install":("确认安装","Confirm install"),
"list.search":("搜索","Search"),"history.clear":("清除历史记录","Clear history"),"history.empty":("没有历史记录。","No history yet."),"bookmarks.empty":("还没有书签。点击地址栏右侧的书签按钮添加。","No bookmarks yet. Use the bookmark button in the toolbar."),
"downloads.clear":("清空列表","Clear list"),"downloads.empty":("没有下载记录。","No downloads yet."),
"dl.state.progressing":("下载中","Downloading"),"dl.state.completed":("已完成","Completed"),"dl.state.cancelled":("已取消","Cancelled"),"dl.state.interrupted":("已中断","Interrupted"),"dl.state.paused":("已暂停","Paused"),
"dl.open":("打开","Open"),"dl.show":("在访达中显示","Show in Finder"),
}
for k,(z,e) in add.items():
    orig['zh'][k]=z; orig['en'][k]=e
orig['zh']['ai.local.note']="内嵌推理引擎（llama.cpp / Metal），在 Apple M1 上离线运行，数据不出本机。"
orig['en']['ai.local.note']="Built-in inference engine (llama.cpp / Metal). Runs offline on Apple M1; data stays on device."
orig['zh']['ext.ai.hint']="用自然语言描述需求，由 AI 生成拓展包，预览代码后确认安装。"
orig['en']['ext.ai.hint']="Describe what you need; AI generates an extension package. Review the code, then confirm install."
orig['zh']['ext.ai.load']="从 .zip / 文件夹加载"; 
orig['zh']['ext.std.note']="功能拓展标准 v1：清单声明 id、version、update_url、permissions、entry、contributes。词典与 GeoGebra 按此标准预装并可独立升级。"
orig['en']['ext.std.note']="Feature Extension Standard v1: the manifest declares id, version, update_url, permissions, entry, contributes. Dictionary and GeoGebra ship pre-installed and update independently."
orig['zh']['ext.pageSub']="功能拓展使用自有标准；普通浏览器拓展兼容 Chrome。"
orig['zh']['ext.load']="加载功能拓展…"
orig['zh'].pop('_note',None); 
out={'zh':orig['zh'],'en':orig['en']}
json.dump(out,open('src/renderer/static/strings.json','w'),ensure_ascii=False,indent=1)
print(len(out['zh']),len(out['en']))
