# 测试结果

运行时间: 2026-10-31T11:19:23.343Z

通过 75 / 失败 0 / 跳过 0 / 共 75

| 分组 | 测试项 | 结果 | 耗时 |
|---|---|---|---|
| 核心：启动 / 标签页 / 搜索 / 设置 | 应用启动无错误（chrome 窗口 + 首页） | PASS | 337ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 首页只有问候语 + 药丸输入框（无推荐） | PASS | 6ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 模式分段控件：Chat/Search 切换并持久化到状态 | PASS | 120ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | Search 模式：地址栏输入 URL 打开真实网页，标签标题更新 | PASS | 338ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 新建标签页 / 切换 / 关闭 | PASS | 145ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 后退 / 前进 / 重新载入 | PASS | 381ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | Search 模式：自定义引擎模板 %s 用于搜索词 | PASS | 114ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | Search 模式：Bing(默认)/Google/百度/DuckDuckGo 预设使用正确的搜索 URL | PASS | 425ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 设置持久化：重启后保留 + API Key 不暴露给页面且磁盘上不是明文 | PASS | 1283ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 全新配置默认搜索引擎为 Bing，默认语言中文 | PASS | 768ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 界面语言切换 中文→English 立即生效并持久化（所有 UI 字符串走 i18n 表） | PASS | 2008ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 右上角四方格按钮打开溢出菜单，含全部 9 项（中文） | PASS | 263ms |
| Chat 模式：输入分类（单元） | 单个英文单词 → word；屈折形式 → word | PASS | 1ms |
| Chat 模式：输入分类（单元） | 一句英文 → sentence | PASS | 0ms |
| Chat 模式：输入分类（单元） | 多段/长文 → article；中文长文 → article(目标英文) | PASS | 0ms |
| Chat 模式：输入分类（单元） | 问题（中/英）→ question | PASS | 0ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 测试连接：成功返回 pong；错误 Key 返回错误且不回显密钥 | PASS | 77ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 单词（无词典）→ AI 生成词条，并明确标注“AI 生成 · 非词典” | PASS | 1491ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 句子 → 翻译 + 成分分析（主/谓/宾/定/状 着色 + 结构拆解） | PASS | 3494ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 长文 → 仅翻译（双栏：原文 / 译文逐段） | PASS | 1149ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 问题 → 智能体搜索：改写查询(可编辑) → SERP → 读取网页 → 流式作答带 [n] 引用 | PASS | 2626ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 点击引用 [n] 在新标签页打开来源网页 | PASS | 119ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 用户编辑改写查询后重新搜索（只用编辑后的查询） | PASS | 85ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 数学作图：LLM 工具调用 ggb_eval → GeoGebra 面板真实绘制（通过 GGB API 校验） | PASS | 2736ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | Anthropic 格式（/v1/messages 流式）可用 | PASS | 1459ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 未配置 API 时给出友好错误，应用不崩溃 | PASS | 365ms |
| 词典拓展：MDX/MDD | 内置“词典”拓展预装、默认启用，遵循功能拓展标准清单 | PASS | 8ms |
| 词典拓展：MDX/MDD | 设置页“词典”：通过文件选择导入 .mdx（同名 .mdd 自动加载） | PASS | 788ms |
| 词典拓展：MDX/MDD | 查词：Chat 输入英文单词 → 词典标签页 + 隔离 iframe 渲染词条 | PASS | 510ms |
| 词典拓展：MDX/MDD | 词典资源：MDD 中的 CSS 生效、图片加载、音频可取 | PASS | 46ms |
| 词典拓展：MDX/MDD | sound:// 链接点击播放 MDD 音频（解析到 aibdict 资源） | PASS | 70ms |
| 词典拓展：MDX/MDD | @@@LINK 重定向：abandoned → abandon 词条 | PASS | 388ms |
| 词典拓展：MDX/MDD | 词形还原：abandons / running→run 能查到 | PASS | 758ms |
| 词典拓展：MDX/MDD | entry:// 链接在词典框内跳转到 abandonment | PASS | 640ms |
| 词典拓展：MDX/MDD | 前缀联想：rpc suggest 与结果页“相近词” | PASS | 394ms |
| 词典拓展：MDX/MDD | 多词典：第二本词典出现为第二个标签；排序与启用/停用生效 | PASS | 748ms |
| 词典拓展：MDX/MDD | 网页划词/双击查词弹窗（选中单词后弹出词典浮层） | PASS | 624ms |
| 词典拓展：MDX/MDD | 关闭词典拓展后：单词回退为 AI 生成词条（带标注） | PASS | 1293ms |
| 词典拓展：MDX/MDD | 词典未命中的单词回退为 AI 词条 | PASS | 1291ms |
| 词典拓展：MDX/MDD | 重启后词典配置保留且仍可查词 | PASS | 2131ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | 清单校验：标准 v1 必填项 / 非法权限 / 非法 entry 被拒绝（单元） | PASS | 0ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | 拓展页：两个分类，预装 词典 / GeoGebra 绘图（内置，可开关，有检查更新） | PASS | 539ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | 从文件夹加载功能拓展（按标准）并生效：输入处理器 + AI 工具 | PASS | 563ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | LLM 工具调用经功能拓展提供的工具（sample_echo） | PASS | 350ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | 沙箱运行时：无 process/require、eval 被禁、未授权 net 被拒、存储隔离 | PASS | 2ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | 停用 / 启用功能拓展：停用后处理器与工具消失 | PASS | 1326ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | 独立升级：update_url → 检查更新 → 下载 zip → sha256 校验 → 版本升级到 1.1.0 | PASS | 1067ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | 从 .zip 加载功能拓展 | PASS | 388ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | AI 编写拓展：描述需求 → 生成 → 预览代码 → 确认安装 → 生效 | PASS | 3750ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | Chrome 拓展（MV3 解压文件夹）：内容脚本 + service worker + storage | PASS | 614ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | Chrome 拓展：重启后仍加载；停用后不再注入 | PASS | 3858ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | Chrome 拓展：.zip 与 .crx(含头部) 打包加载 | PASS | 789ms |
| 拓展：功能拓展标准 v1 / Chrome 拓展 / AI 编写 | AI 编写 Chrome 拓展：生成 → 预览 → 安装 → 内容脚本生效 | PASS | 2844ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 历史记录：访问的网页被记录，可搜索 / 删除 / 清除 | PASS | 2034ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 书签：加入 / 在书签页列出 / 删除 | PASS | 922ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 下载管理器：下载文件 → 列表显示完成 → 文件落盘 | PASS | 1285ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 在页面上查找：菜单 → 查找条 → 匹配计数 | PASS | 1228ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 缩放：菜单 +/−/重置 作用于当前页（devicePixelRatio 验证） | PASS | 269ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 菜单项导航：历史记录/下载内容/拓展/书签/设置 分别打开对应页面 | PASS | 1255ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 检查（DevTools）：菜单项为当前网页打开开发者工具 | PASS | 834ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | Chat 模式首页输入 URL 直接导航（不进入 AI） | PASS | 151ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 隐私：清除历史/下载记录/缓存/Cookie 不报错 | PASS | 612ms |
| 浏览器功能：历史 / 书签 / 下载 / 查找 / 缩放 / DevTools / 菜单 / 隐私 | 关闭最后一个标签页时自动新建首页（应用不退出） | PASS | 1111ms |
| 本地模型（node-llama-cpp）：缺失模型不影响启动 | 未选择模型时应用正常启动；提问给出清晰提示而不崩溃 | PASS | 360ms |
| 本地模型（node-llama-cpp）：缺失模型不影响启动 | 模型目录 + 引擎状态（引擎在本机可加载或给出可读错误） | PASS | 568ms |
| 本地模型（node-llama-cpp）：缺失模型不影响启动 | 选择无效的 .gguf 文件：报错但不崩溃 | PASS | 150ms |
| 本地模型（node-llama-cpp）：缺失模型不影响启动 | 设置页“本地模型”：模型列表 + 下载进度条 + 取消/完成（本地模拟 HF 服务） | PASS | 1851ms |
| 静态检查 | i18n：所有界面字符串键在 zh/en 中均存在 | PASS | 83ms |
| 静态检查 | v1 无动画 / 无自定义鼠标指针（使用系统光标），样式使用 CSS 变量 | PASS | 1ms |
| 静态检查 | SERP 解析器：Bing(含 /ck/a 跳转解码) / Google / 百度 / DuckDuckGo / 通用 | PASS | 136ms |
| 本地模型：真实推理（node-llama-cpp，Qwen2.5-0.5B 小模型） | 本地模型加载 + 流式生成文章翻译（无错误） | PASS | 32502ms |
| 截图：首页 / 设置 / 菜单 | 首页（中文）：只有问候语与输入框 | PASS | 952ms |
| 截图：首页 / 设置 / 菜单 | 首页（English）语言切换 | PASS | 2617ms |
| 截图：首页 / 设置 / 菜单 | 设置页：AI 后端 / 搜索 / 通用 截图 | PASS | 4342ms |
| 截图：首页 / 设置 / 菜单 | 右上角菜单截图 | PASS | 807ms |
