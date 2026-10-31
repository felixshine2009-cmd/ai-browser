# AI 智能体搜索 / Agentic web search

`src/main/ai/agent.js` (loop) · `src/main/ai/search.js` (engines, parsing, relevance) · `src/main/ai/prompts.js` (`agent`, `planner`, `answer`)

## 中文

Chat 模式的“问题”走智能体搜索，**主工具是你在 设置 → 搜索引擎 里选中的默认引擎**（Bing / Google / 百度 / DuckDuckGo / 自定义 `%s`）。

| 路径 | 条件 | 流程 |
|---|---|---|
| 工具调用循环 | API 模型（OpenAI 兼容 tool calling / Anthropic tool_use） | 模型自己决定：`web_search(query, engine?)` → 看标题/摘要 → `open_page(url)` → 必要时再换词搜索 → 带 `[n]` 引用作答 |
| 固定流水线 | 本地模型（无工具调用）、API 不支持工具、或你编辑了改写查询后点「↻ 重新搜索」 | 规划查询（原问题始终排第一）→ 用所选引擎搜索 → 读取前 N 页 → 作答 |

* 限额：最多 4 次搜索、8 次打开网页、90 秒；超额后模型被要求立即作答。
* 引用：`open_page` 返回的 `n` 就是引用编号，**只有真正打开读过的页面才能被引用**。
* 进度：对话页显示 “用 百度 搜索：…”、“阅读：…”、“百度 不可用，已改用 Bing” 等行（保留在回答上方）；改写查询 chip 可编辑，改完会按固定流水线重跑。
* 自定义 `%s` 引擎：在隐藏窗口加载后做通用解析（取站外链接+标题，过滤引擎内部链接）；已知引擎有专用解析器（Bing `b_algo`、百度 `c-container` 并解析 `baidu.com/link` 跳转、DuckDuckGo `result__a`、Google `h3`）。
* 回退链：所选引擎 → （中文查询）百度 → Bing → DuckDuckGo → 百度（英文查询）。每个引擎的结果都会做**相关性过滤**（查询词的 CJK 二元组 / 拉丁词必须出现在标题、摘要或 URL 中；短查询如人名要求全部出现），无关结果（登录页、广告、与查询无关的页面）直接丢弃；全部失败时明确告诉模型“没有找到相关结果”，而不是喂不相关页面。
* 编码：查询只做一次 `encodeURIComponent`；Bing 中文查询加 `mkt=zh-CN&setlang=zh-Hans`，Google 加 `hl`，DuckDuckGo 加 `kl`。
* 提示词在 `prompts.js` 的 `agent()`，可直接编辑。

## English

The *question* path of Chat mode is an agentic search whose primary tool is the **search engine selected in Settings → Search** (Bing / Google / Baidu / DuckDuckGo / custom `%s`).

| Path | When | Flow |
|---|---|---|
| Tool-calling loop | API models (OpenAI-compatible tool calling / Anthropic tool_use) | The model drives: `web_search(query, engine?)` → read titles/snippets → `open_page(url)` → refine the query if needed → answer with `[n]` citations |
| Fixed pipeline | Local models (no tool calling), APIs without tool support, or after you edit the rewritten-query chips and press “↻ Search again” | Plan queries (the original question always first) → search with the selected engine → read top N pages → answer |

* Limits: 4 searches, 8 page opens, 90 s; afterwards the model is told to answer immediately.
* Citations: the `n` returned by `open_page` is the citation number — only pages that were actually opened can be cited.
* Progress lines (“Searching Baidu: …”, “Reading: …”, “Baidu unavailable; using Bing”) stay above the answer; the rewritten-query chips are editable and re-run through the fixed pipeline.
* Custom `%s` engines are parsed generically (outbound links with titles, engine-internal links filtered); known engines have dedicated parsers (Bing `b_algo`, Baidu `c-container` incl. `baidu.com/link` redirect resolution, DuckDuckGo `result__a`, Google `h3`).
* Fallback chain: selected engine → (Chinese query) Baidu → Bing → DuckDuckGo → Baidu (English query). Every engine's hits pass a **relevance filter** (CJK bigrams / Latin words of the query must appear in title, snippet or URL; short queries such as names need all terms). Irrelevant hits (login pages, ads, off-topic) are dropped; if nothing is left the model is told “no relevant results” instead of being fed junk.
* Encoding: the query is URL-encoded exactly once; Bing gets `mkt=zh-CN&setlang=zh-Hans` for CJK queries, Google `hl`, DuckDuckGo `kl`.
* The prompt is `agent()` in `prompts.js` — edit it freely.
