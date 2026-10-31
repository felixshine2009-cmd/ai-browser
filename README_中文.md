# AI 浏览器（AI Browser）v1.0

Electron（Chromium）桌面浏览器 + Chat 模式 AI 能力：查词（MDX/MDD）、句子成分分析、长文翻译、智能体搜索作答、GeoGebra 作图；支持 OpenAI 兼容 / Anthropic API，以及内嵌本地 GGUF 模型（Apple Silicon Metal）。

面向 **Apple Silicon（M1/M2/M3）macOS 12+**。本仓库在 Linux 上用 xvfb + Playwright 做过端到端自动化测试；**尚未在真实 Mac 上实测**，请以本机运行为准。

---

## 一键安装（推荐）

发行物在 `dist/`：

| 文件 | 说明 |
|---|---|
| `AI-Browser-mac-arm64.zip` | 未签名的 `AI Browser.app`（含 macOS arm64 Electron + Metal 本地模型二进制） |
| `install.command` / `install.sh` | 解压 → 复制到 `/Applications` → `xattr -cr` 清隔离 → 启动 |
| `AI-Browser-source.zip` | 源码（不含 `node_modules`） |
| `README_中文.md` | 本文 |

### 步骤

1. 把 `AI-Browser-mac-arm64.zip` 与 `install.command` 放在同一目录。
2. **双击 `install.command`**（或终端执行 `bash install.sh`）。
3. 若 macOS 提示「无法验证开发者」：
   - 系统设置 → 隐私与安全性 → 仍要打开；或
   - 终端：`xattr -cr "/Applications/AI Browser.app" && open "/Applications/AI Browser.app"`

仅想手动安装：

```bash
unzip AI-Browser-mac-arm64.zip
xattr -cr "AI Browser.app"
cp -R "AI Browser.app" /Applications/
open "/Applications/AI Browser.app"
```

---

## 首次运行与配置

1. 打开后首页问候为「Felix，今天想做什么？」（通用 → 语言可切 English）。
2. **右上角四格菜单 → 设置 → AI 模型**：
   - **自定义 API**：选预设或填 Base URL / Key / 模型 / 温度；格式可选 OpenAI 或 Anthropic；点「测试连接」。
   - **本地模型**：从列表下载 GGUF（支持断点续传），或「选择本地文件」。Key **只存本机、加密**，主进程调用，页面与日志看不到明文。
3. **搜索引擎**：Bing / Google / 百度 / DuckDuckGo / 自定义 `%s`。
4. **词典 MDX/MDD**：设置 → 词典 → 导入；支持多词典排序与禁用。
5. Chat / Search 分段控件在地址栏左侧。

未配置模型时提问会给出友好错误，**不会崩溃**。

---

## 从源码运行（备选，免包装）

适合不想用未签名 `.app`、或要改代码的情况：

```bash
unzip AI-Browser-source.zip && cd ai-browser
npm ci
# 首次可能需：node node_modules/electron/install.js
npm start
```

打 Mac arm64 包（需能下载 Electron darwin-arm64；可在任意 OS 交叉打包）：

```bash
npm ci
npm run dist:mac
# 产物：dist/AI-Browser-mac-arm64.zip、install.*、源码 zip
```

`dist:mac` 会：`stage`（按 `--os=darwin --cpu=arm64` 安装依赖并只保留 `@node-llama-cpp/mac-arm64-metal`）→ `@electron/packager`（`asar:false`）→ zip。

---

## Chat 模式行为摘要

| 输入类型 | 行为 |
|---|---|
| 单词 | 词典拓展（MDX）优先；否则 AI 生成词条并标注「AI 生成」 |
| 句子 | 翻译 + 主谓宾定状着色与结构拆解 |
| 长文 / 多段 | 仅翻译（原文 / 译文双栏） |
| 问题 | LLM 改写查询（可编辑）→ 搜索 → Readability 抽正文 → 流式作答带 `[n]` 引用；可调用 GeoGebra 工具 |

默认搜索失败时会回退 DuckDuckGo HTML。

---

## 拓展

- **功能拓展**（自有标准 `aib-feature/1`）：见 [`docs/EXTENSION_STANDARD.md`](docs/EXTENSION_STANDARD.md)。预装 **词典**、**GeoGebra**，可独立升级；支持「AI 编写插件」预览后安装。
- **普通浏览器拓展**：Chrome MV3，尽力支持（内容脚本、service worker、`chrome.storage` 已测）；工具栏弹窗 UI 有限，popup/options 多在标签页打开。

---

## 自动化测试（本仓库）

```bash
# Linux + xvfb；可选真实本地推理：
export AIB_TEST_GGUF=/path/to/qwen2.5-0.5b-instruct-q4_k_m.gguf
npm test                 # 或：xvfb-run -a node test/run-all.js
```

截图在 `shots/`。结果写入 `test/RESULTS.md`。

---

## 已知限制（请务必阅读）

1. **未在真实 Mac 上实测**；打包与 Metal 二进制在 Linux 交叉构建，本地推理路径在 Linux 用 CPU 验证过，Metal GPU 路径需你在 M 系列上确认。
2. 应用**未签名 / 未公证**，首次打开需清隔离或「仍要打开」。
3. 本地模型：**无工具调用**（Chat 的 GeoGebra / 搜索工具环仅 API 后端完整）；首启下载体积大。
4. Chrome 扩展 API 覆盖受 Electron 限制；无完整工具栏 popup。
5. GeoGebra 面板为浅色主题；打印、原生右键「查词」菜单未做 UI 自动化。
6. v1 **无动画**、**使用系统鼠标指针**（自定义蓝光标已取消）。

---

## 目录速览

```
src/main/          Electron 主进程（LLM、词典、拓展、标签页）
src/preload/       contextBridge → window.aib
src/renderer/      chrome / home / chat / settings / …
extensions/builtin/dictionary|geogebra
docs/EXTENSION_STANDARD.md
test/              Playwright + mock OpenAI/SERP
shots/             自动化截图
scripts/           stage-mac / pack-mac / i18n
dist/              发行 zip 与安装脚本
```

许可证：MIT。作者：Felix。
