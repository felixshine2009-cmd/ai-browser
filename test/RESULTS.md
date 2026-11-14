# 测试结果

运行时间: 2026-11-14T05:11:51.688Z

通过 70 / 失败 1 / 跳过 1 / 共 72

| 分组 | 测试项 | 结果 | 耗时 |
|---|---|---|---|
| 2.3.0 单元检查：采样参数规则、思考等级、公式渲染 | 采样参数规则（B4）：Kimi K3 / K2.5+ 与 OpenAI 推理模型不发送 temperature，max_tokens 改为 max_completion_tokens | PASS | 2ms |
| 2.3.0 单元检查：采样参数规则、思考等级、公式渲染 | HTTP 400“invalid temperature: only 1 is allowed”时去掉采样参数重试一次，并记住该模型 | PASS | 53ms |
| 2.3.0 单元检查：采样参数规则、思考等级、公式渲染 | 公式渲染（B7）：离线 KaTeX + mhchem 渲染 $…$、$$…$$、\(…\)、\[…\]，代码与价格不误判 | PASS | 24ms |
| 2.3.0 单元检查：采样参数规则、思考等级、公式渲染 | 自定义镜像（F6）：识别 ISO / QCOW2 / IMG；QCOW2（v2、v3、压缩簇）转换为原始格式后逐字节一致 | PASS | 100ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 启动：Node 18 主进程 + 原生视图；chrome / 首页是桌面版页面（aib 桥、触控样式） | PASS | 273ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 首页布局与桌面版相同（同一 home.html：问候语、输入框、模型选择、Chat/Task、工具图标、数学键盘） | PASS | 36ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 标签页：网页加载、标题、后退/前进、新建/切换/关闭（原生视图按桌面布局摆放） | PASS | 772ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | Chat：提问 → 流式回答（与桌面版同一 chat 页面与 AI 后端） | PASS | 1374ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | Python（内置 Pyodide，隐藏 web 视图内核）：AI 调用 python_run → sympy / numpy 结果 | PASS | 1ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | Linux 虚拟机（内置 v86 + Alpine，隐藏 web 视图）：AI 调用 vm_shell → root shell 输出 | PASS | 0ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 工具页（解题 / 词典 / 维基 / 物理 / GeoGebra）、历史、下载、书签、拓展、设置都能打开 | PASS | 8569ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 外观：浅色 / 深色 / 跟随系统 → 原生 overrideUserInterfaceStyle（theme.set）+ 所有页面立即切换 + 对比度 | PASS | 6168ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 旋转 / 分屏：窗口尺寸变化后 chrome 与标签视图重新布局 | PASS | 1916ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 下载：网页附件保存到“文件”App 的 AI浏览器/Downloads，下载页列出 | PASS | 313ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 本地模型：llama.cpp 保留（原生 Metal），只有 MLX 被移除 | PASS | 602ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 原生对话框 / 菜单走宿主（dialog.message、menu.popup、快捷键 menu.app） | PASS | 3ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 桥接自恢复（B1）：SSE 断线后按 Last-Event-ID 补发命令、唤醒后重新监听端口、页面仍可操作 | PASS | 642ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 长时间运行（B1 soak）：数百次 IPC 与标签开关后，待答命令、缓冲与内存保持有界 | PASS | 4095ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 启动诊断：Node 无 JIT 运行（与 iPad 相同），日志写入 Documents/日志，主窗口显示后通知原生层 | PASS | 1ms |
| iPad 版（桌面版直接移植）：模拟宿主上运行整个 iPad 负载 | 启动诊断：main.js 加载失败时立即报告原生层（诊断面板），日志可在“文件”App 中查看 | PASS | 1020ms |
| 词典拓展：MDX/MDD | 内置“词典”拓展预装、默认启用，遵循功能拓展标准清单 | PASS | 39ms |
| 词典拓展：MDX/MDD | 设置页“词典”：通过文件选择导入 .mdx（同名 .mdd 自动加载） | PASS | 697ms |
| 词典拓展：MDX/MDD | 查词：Chat 输入英文单词 → 词典标签页 + 隔离 iframe 渲染词条 | PASS | 463ms |
| 词典拓展：MDX/MDD | 词典资源：MDD 中的 CSS 生效、图片加载、音频可取 | PASS | 36ms |
| 词典拓展：MDX/MDD | sound:// 链接点击播放 MDD 音频（解析到 aibdict 资源） | PASS | 194ms |
| 词典拓展：MDX/MDD | @@@LINK 重定向：abandoned → abandon 词条 | PASS | 373ms |
| 词典拓展：MDX/MDD | 词形还原：abandons / running→run 能查到 | PASS | 721ms |
| 词典拓展：MDX/MDD | entry:// 链接在词典框内跳转到 abandonment | PASS | 622ms |
| 词典拓展：MDX/MDD | 前缀联想：rpc suggest 与结果页“相近词” | PASS | 365ms |
| 词典拓展：MDX/MDD | 多词典：第二本词典出现为第二个标签；排序与启用/停用生效 | PASS | 722ms |
| 词典拓展：MDX/MDD | 网页划词/双击查词弹窗（选中单词后弹出词典浮层） | PASS | 593ms |
| 词典拓展：MDX/MDD | 关闭词典拓展后：单词回退为 AI 生成词条（带标注） | PASS | 1359ms |
| 词典拓展：MDX/MDD | 词典未命中的单词回退为 AI 词条 | PASS | 1260ms |
| 词典拓展：MDX/MDD | 重启后词典配置保留且仍可查词 | PASS | 2173ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | U1：打开工具直接显示工具界面，不新建标题为“tool”的网页标签 | PASS | 513ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | U9：工具栏与首页标签均为正式中文（无 Chat / Search / Task / tool） | PASS | 5ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | U5：思考等级随模型提供；可设置并在各页面共用 | PASS | 17ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | F2：分屏两个标签并排显示，可调比例与交换；空间按学科分组 | PASS | 1079ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | B6：扫码使用原生相机扫描；网址直接打开 | PASS | 33ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | F1：拍题即解：相机拍摄 → 文字识别 → 解题工具自动提交，回答以对话样式显示 | PASS | 483ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | F4：稍后阅读：保存离线副本（网页归档），列表与检索，离线打开 | PASS | 1478ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | F3：页面助手一键摘要，回答附原文段落编号 | PASS | 1061ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | F5：代码编辑器：新建、写入、读取、重命名、删除文件，路径限制在根目录内 | PASS | 424ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | 2.3.1：每个导入入口都经过原生“文件”选择流程（词典文件与文件夹、ZIM、系统镜像、模型、资料、拓展、密码 CSV、照片），临时副本导入后清理 | PASS | 36774ms |
| iPad 2.3.0：工具视图、分屏与空间、扫码、拍题、稍后阅读、页面助手、代码编辑器、自定义镜像 | F6：自定义系统镜像：导入 IMG（原始格式）与 QCOW2（转换），iPad 以 v86 启动 | PASS | 457ms |
| 41-ipad-v230.js | suite crashed | FAIL — Error: page not found: u => u.startsWith('aibrowser://home') have: 
    at Object.waitPage (/workspace/ipadport/repo/tes | 0ms |
| Python 与 Linux 虚拟机 | Python 会话：输出、表达式结果、变量持久 | PASS | 24ms |
| Python 与 Linux 虚拟机 | sympy / numpy 可导入并计算正确 | PASS | 258ms |
| Python 与 Linux 虚拟机 | matplotlib 图像被捕获为 PNG | PASS | 988ms |
| Python 与 Linux 虚拟机 | 错误信息不含内部帧；超时会中断但保留会话 | PASS | 1525ms |
| Python 与 Linux 虚拟机 | 安装接口：包名校验与中文错误原因 | PASS | 1ms |
| Python 与 Linux 虚拟机 | 工具注册：python_run / python_install / vm_* 在工具列表与提示词中 | PASS | 14ms |
| Python 与 Linux 虚拟机 | 发送给模型的结果去掉图像数据，界面保留 | PASS | 2ms |
| Python 与 Linux 虚拟机 | 虚拟机镜像名称与发布资产一致；客体代理语法正确 | PASS | 52ms |
| Python 与 Linux 虚拟机 | 渲染进程脚本语法正确 | PASS | 642ms |
| Python 与 Linux 虚拟机 | 设置页包含“Python 与虚拟机” | PASS | 1ms |
| 网页版 / iPad：Pyodide 与虚拟机 | Service Worker 版本与缓存清单 | PASS | 1ms |
| 网页版 / iPad：Pyodide 与虚拟机 | 网页 API：流式 tool_calls 解析（OpenAI / Anthropic） | PASS | 2ms |
| 网页版 / iPad：Pyodide 与虚拟机 | iPad 虚拟机脚本：串口协议、9p 启动参数与持久化 | PASS | 0ms |
| iPad 图形镜像（Alpine + JWM，v86）：首次下载、电脑操作工具、桌面查看器、速度 | iPad 图形镜像 | SKIP — 需要 AIB_IPAD_BUNDLE（含 vm/）与 AIB_VM_GUI_TAR | 0ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 应用启动无错误（chrome 窗口 + 首页） | PASS | 2475ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 首页只有问候语 + 药丸输入框（无推荐） | PASS | 7ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 模式分段控件：Chat/Search 切换并持久化到状态 | PASS | 126ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | Search 模式：地址栏输入 URL 打开真实网页，标签标题更新 | PASS | 328ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 新建标签页 / 切换 / 关闭 | PASS | 174ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 后退 / 前进 / 重新载入 | PASS | 547ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | Search 模式：自定义引擎模板 %s 用于搜索词 | PASS | 110ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | Search 模式：Bing(默认)/Google/百度/DuckDuckGo 预设使用正确的搜索 URL | PASS | 417ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 设置持久化：重启后保留 + API Key 不暴露给页面且磁盘上不是明文 | PASS | 1303ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 全新配置默认搜索引擎为 Bing，默认语言中文 | PASS | 787ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 界面语言切换 中文→English 立即生效并持久化（所有 UI 字符串走 i18n 表） | PASS | 2317ms |
| 核心：启动 / 标签页 / 搜索 / 设置 | 右上角四方格按钮打开溢出菜单，含全部 11 项（中文） | PASS | 575ms |
