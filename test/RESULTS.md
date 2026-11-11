# 测试结果

运行时间: 2026-11-11T11:17:20.958Z

通过 24 / 失败 2 / 跳过 0 / 共 26

| 分组 | 测试项 | 结果 | 耗时 |
|---|---|---|---|
| Chat 模式：输入分类（单元） | 单个英文单词 → word；屈折形式 → word | PASS | 1ms |
| Chat 模式：输入分类（单元） | 一句英文 → sentence | PASS | 0ms |
| Chat 模式：输入分类（单元） | 多段/长文 → article；中文长文 → article(目标英文) | PASS | 0ms |
| Chat 模式：输入分类（单元） | 问题（中/英）→ question | PASS | 0ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 测试连接：成功返回 pong；错误 Key 返回错误且不回显密钥 | PASS | 54ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 单词（无词典）→ AI 生成词条，并明确标注“AI 生成 · 非词典” | PASS | 1479ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 句子 → 翻译 + 成分分析（主/谓/宾/定/状 着色 + 结构拆解） | FAIL — Error: timeout waiting for tokens /     at until (/workspace/wtPy/test/lib/runner.js:25:9) /     at async /workspace/wtP | 15364ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 长文 → 仅翻译（双栏：原文 / 译文逐段） | PASS | 4500ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 问题 → 智能体搜索：改写查询(可编辑) → SERP → 读取网页 → 流式作答带 [n] 引用 | PASS | 2865ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 点击引用 [n] 在新标签页打开来源网页 | PASS | 159ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 用户编辑改写查询后重新搜索（只用编辑后的查询） | PASS | 167ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 数学作图：LLM 工具调用 ggb_eval → GeoGebra 面板真实绘制（通过 GGB API 校验） | FAIL — Error: timeout waiting for ggb objects /     at until (/workspace/wtPy/test/lib/runner.js:25:9) /     at async test.time | 120513ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | Anthropic 格式（/v1/messages 流式）可用 | PASS | 3573ms |
| Chat 模式：AI 后端 / 流式 / 工具调用（本地 mock OpenAI 服务） | 未配置 API 时给出友好错误，应用不崩溃 | PASS | 2248ms |
| Python 与 Linux 虚拟机 | Python 会话：输出、表达式结果、变量持久 | PASS | 24ms |
| Python 与 Linux 虚拟机 | sympy / numpy 可导入并计算正确 | PASS | 272ms |
| Python 与 Linux 虚拟机 | matplotlib 图像被捕获为 PNG | PASS | 1130ms |
| Python 与 Linux 虚拟机 | 错误信息不含内部帧；超时会中断但保留会话 | PASS | 1526ms |
| Python 与 Linux 虚拟机 | 安装接口：包名校验与中文错误原因 | PASS | 1ms |
| Python 与 Linux 虚拟机 | 工具注册：python_run / python_install / vm_* 在工具列表与提示词中 | PASS | 13ms |
| Python 与 Linux 虚拟机 | 发送给模型的结果去掉图像数据，界面保留 | PASS | 2ms |
| Python 与 Linux 虚拟机 | 虚拟机镜像名称与发布资产一致；客体代理语法正确 | PASS | 60ms |
| Python 与 Linux 虚拟机 | 设置页包含“Python 与虚拟机” | PASS | 1ms |
| 网页版 / iPad：Pyodide 与虚拟机 | Service Worker 版本与缓存清单 | PASS | 1ms |
| 网页版 / iPad：Pyodide 与虚拟机 | 网页 API：流式 tool_calls 解析（OpenAI / Anthropic） | PASS | 2ms |
| 网页版 / iPad：Pyodide 与虚拟机 | iPad 虚拟机脚本：串口协议、9p 启动参数与持久化 | PASS | 1ms |
