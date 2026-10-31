[English](README.md) | [**中文**](README_zh.md)

# AI 浏览器 v2.1.0

一个内置 AI **聊天模式**的桌面浏览器（Electron / Chromium）：词典查询（MDX/MDD）、长难句分析、翻译、带引用的**智能搜索**、本地知识库和 GeoGebra 画图。AI 通过统一的工具注册表，可以直接操作浏览器。

**网页版（PWA）：** https://felixshine2009-cmd.github.io/ai-browser/ ——使用你自己的 API Key 聊天，含 GeoGebra 与物理仿真；仅桌面版功能显示为灰色。iPhone 可在 Safari 中“添加到主屏幕”。

面向 **Apple 芯片（M1/M2/M3）macOS 12+**。应用在 Linux 上用 xvfb + Playwright 做了端到端测试；需要真机验证的部分见“已知限制”。

## 2.1.0 新内容

* **高中物理可视化**：确定性 2D 引擎，覆盖力学、振动与波、电磁学、光学、热学、近代物理；场景 JSON 加载前校验（出错时 AI 重试）；播放 / 暂停 / 单步 / 调速、矢量、轨迹、实时曲线；15 个示例场景；Agent 工具 `phys_validate`、`phys_load`、`phys_play`、`phys_pause`、`phys_step`、`phys_reset`、`phys_set_speed`、`phys_state`、`phys_list_examples`、`phys_load_example`。
* **更多 Agent 工具**：书签、下载、页内查找、缩放、安全设置修改、Chrome 拓展管理、知识库删除 / 清空、本地模型管理（不含密码）。
* 隐身标签页读取页面使用私有会话。
* 翻译模型下载失败时在聊天界面显示明确原因。

## 2.0.0 新内容

* **完整 GeoGebra 数学应用**（离线）：绘图 / 几何 / 3D / CAS / 科学计算器 / 套件，屏幕数学键盘（123 / f(x) / ABC / 符号），保存/打开 `.ggb`，导出 PNG，AI 通过 `ggb_*` 工具控制。
* **新应用图标**（圆环 + 极光）。
* 移除问候语前的装饰符号。

## 1.1.0 新内容

* **隐身标签页** — 右上角四方格菜单第一项“新建隐身标签页”（⇧⌘N）。使用独立的内存会话：不共享 Cookie、存储、历史和已保存密码；深紫色标签带“隐身”徽标；关闭最后一个隐身标签后全部清除。
* **Agent 工具注册表** — 统一的函数调用工具（兼容 OpenAI / Anthropic；本地模型走语法约束的 JSON 回退）：浏览器操作（标签页、隐身、导航、历史、拓展）、搜索 / 读网页、词典、翻译与语法分析、知识库、设置（只读，不含密钥）、打印 / 另存 PDF，以及各 功能拓展 声明的工具（新拓展自动注册）。聊天里会简要显示工具步骤，步数上限可调。
* **知识库** — 内置 **EmbeddingGemma-300M**（离线，使用 `task: search result | query: …` 提示），分块 + 本地向量库，可添加文件 / 网页 / 文本，检索测试，也可改用自定义嵌入 API。
* **混元翻译** — **HY-MT1.5-1.8B**（1.1.1 起不再内置，约 1.1 GB，第一次翻译时从 hf-mirror 下载，有进度、可续传），仅在翻译时加载（句子 / 文章 / 网页 / `translate_text` 工具），空闲约 2.5 分钟后卸载；不会用于聊天和词典。可用自定义 API 或“翻译”角色模型替换。
* **本地模型重做** — 引擎选择（llama.cpp GGUF / Apple 芯片上的 MLX）；下载默认走 **hf-mirror.com**（可切换 huggingface.co 或自定义地址，失败自动回退）；可**搜索 Hugging Face** 或粘贴 repo，支持断点续传和 sha256 校验；自定义模型可担任 聊天 / 词典 / 翻译 / 嵌入 角色；模型按**家族折叠分组**（Qwen3、Qwen2.5、Gemma 4、Gemma 3n、Gemma 3、Hunyuan-MT、EmbeddingGemma …）。
* **本地框架** — 自动探测 **LM Studio**（:1234）、**Ollama**（:11434，原生 API）、**oMLX**（:8000）、MLX-LM / llama.cpp server（:8080）、vLLM、Jan、LocalAI 或任意 OpenAI 兼容服务；可自定义主机 / 端口，连接测试给出具体原因，支持流式输出，原生工具调用 + JSON 回退。
* **MLX 引擎**（Apple 芯片）— 启动本地 OpenAI 兼容的 `mlx_lm.server`，按需启动 / 空闲停止，失败时回退到 llama.cpp 并显示原因。需要 `pip3 install mlx-lm`（未内置）。
* **密码** — 内置密码管理器（四方格菜单 → 设置 → 密码）：登录时询问保存、自动填充、搜索；查看 / 导出需 Touch ID 或 macOS 密码；编辑 / 删除；CSV 导入导出；使用 Electron `safeStorage`（钥匙串）加密保存；隐身模式永不保存；**AI 工具无法读取密码**。
* **打印…（⌘P）和另存为 PDF** 在菜单里；AI 只能弹出打印对话框。
* **词典导入时整体复制**到应用数据目录（mdx、所有同名 `.mdd`、css / js / 字体 / 图片），显示进度和占用空间；删除词典会删除副本（带确认）；已有的路径引用词典启动时自动迁移（原文件不存在则提示“源文件缺失”）。
* **Chrome 拓展直接从 Chrome 应用商店安装** — 打开拓展页面点“添加”即可；“加载已解压的拓展”仅作高级备用。
* **设置页可读性修复** — 词典面板不再出现白底；所有设置面板都有自动化的 ≥ 4.5:1 对比度测试。

## 安装（推荐）

| 文件 | 说明 |
|---|---|
| `AI-Browser-mac-arm64.zip` | 未签名的 `AI Browser.app`（macOS arm64）— 已含 EmbeddingGemma（知识库）；HY-MT 翻译模型在第一次使用时下载 |
| `install.command` / `install.sh` | 解压 → 拷贝到 `/Applications` → `xattr -cr` → 启动 |
| `AI-Browser-source.zip` | 源码（不含 `node_modules` 和模型文件） |
| `README.md` / `README-zh.md` | 英文 / 中文说明 |

**macOS：**

1. 把 `AI-Browser-mac-arm64.zip` 和 `install.command` 放在同一文件夹。
2. 双击 `install.command`（或运行 `bash install.sh`）。
3. 若 macOS 提示无法验证开发者：系统设置 → 隐私与安全性 → 仍要打开；或运行 `xattr -cr "/Applications/AI Browser.app" && open "/Applications/AI Browser.app"`。

**Windows：** 暂停——v1.1.1 之后没有 Windows 构建（最后一版 Windows 安装包见 [v1.1.1](https://github.com/felixshine2009-cmd/ai-browser/releases/tag/v1.1.1)），后续版本会恢复。

## 首次使用

1. **设置 → 通用**：显示名称、问候语、中文 / English。
2. **设置 → AI 模型**：*自定义 API*（预设、OpenAI / Anthropic 格式、带具体失败原因的“测试连接”）、*本地模型*（内置目录、Hugging Face 搜索、引擎与下载源、模型角色）或 *本地框架*（LM Studio、Ollama、oMLX …）。
3. **搜索引擎**：Bing / Google / 百度 / DuckDuckGo / 自定义 `%s`；Agent 使用所选引擎。
4. **词典**、**知识库**、**拓展**、**历史**、**密码**、**隐私** 都是设置页内的分区（`aibrowser://settings#passwords` 等）。

未配置模型时提问会给出友好提示，不会崩溃。

## 聊天模式

| 输入 | 行为 |
|---|---|
| 单词 | 优先词典拓展（MDX）；否则生成标注“AI 生成”的词条 |
| 句子 | 翻译（HY-MT）+ 主谓宾等成分着色与结构拆解 |
| 长文本 | 仅翻译，原文 / 译文分栏 |
| 问题 | 带 `[n]` 引用的**智能搜索**，或调用其他已注册工具（知识库、浏览器操作 …） |

## 模型与许可

* 内置目录（llama.cpp 用 GGUF，另有 `mlx-community` 的 MLX 版本）：**Qwen3**、**Qwen2.5**、**Gemma 4**（E2B / E4B / 12B / 26B-A4B / 31B，Apache-2.0）、**Gemma 3n**、**Gemma 3**、**Hunyuan-MT**、Seed-X、**EmbeddingGemma**。每项都显示体积和预估内存。
* **Gemma 3 / 3n / EmbeddingGemma** 适用 [Gemma 使用条款](https://ai.google.dev/gemma/terms)及禁止用途政策；**Gemma 4** 为 Apache-2.0。内置的 EmbeddingGemma 文件按 Gemma 条款分发。
* **HY-MT1.5** 使用腾讯混元社区许可（**不适用于欧盟、英国和韩国**），再分发前请自行确认。
* Qwen 系列多为 Apache-2.0（以各模型卡为准）。

## 拓展

* **功能拓展**（`aib-feature/1`，见 [`docs/EXTENSION_STANDARD.md`](docs/EXTENSION_STANDARD.md)）：预装词典、GeoGebra 和物理仿真；拓展可在 `manifest.contributes.tools` 中声明 Agent 工具。
* **Chrome 拓展**（MV3）：在浏览器内直接从 Chrome 应用商店安装。覆盖范围受 Electron 扩展 API 限制（已测试内容脚本、service worker、`chrome.storage`；工具栏弹窗有限）。
* GeoGebra 仅限**非商业**使用，遵循 [GeoGebra 许可](https://www.geogebra.org/license)。

## 从源码运行

```bash
unzip AI-Browser-source.zip && cd ai-browser
npm ci
npm start
npm run dist:mac   # 构建 darwin-arm64 应用（dist/）；先把两个 .gguf 放进 ./models 才会内置
```

## 测试

```bash
xvfb-run -a node test/run-all.js          # 全部测试（默认关闭真实模型推理：AIB_REAL_INFERENCE=1 开启）
xvfb-run -a node test/run-all.js 16       # 单个测试，例如 密码 + 打印
```

## 已知限制

1. **需要在真机 Mac 上验证：** node-llama-cpp 的 Metal 推理（Gemma 4 GGUF 加载未测）、MLX 引擎（仅用模拟 `mlx_lm.server` 测试）、Touch ID 弹窗、系统打印对话框。
2. 应用未签名 / 未公证。
3. Chrome 拓展 API 覆盖受 Electron 限制。
4. 搜索引擎可能对脚本请求出验证码；已有回退链和相关性过滤。
5. 未内置 `mlx-lm`（`pip3 install mlx-lm`），也可通过“本地框架”使用 oMLX。

## 路线图

* **网页版（PWA）**已上线（GitHub Pages）——下一批加入 WebGPU 本地模型（WebLLM / transformers.js）。
* **v3**：首次安装的引导设置界面。
* Windows 构建将在后续版本恢复。
* 英文 GitHub Wiki（源文件在 `docs/wiki`）。
* v3 设想：AI 修改浏览器自身代码来增加功能。

许可：MIT。作者：Felix。

*Created by Grok.*
