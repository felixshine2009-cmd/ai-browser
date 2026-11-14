# 内置功能与迁移记录

框架级别 2 将浏览器的内置功能逐项改写为随应用附带的第一方拓展。每项迁移都配有自动化测试，确认迁移前后功能一致，且停用拓展后相应内容会从界面中移除、重新启用后恢复。

## 内置拓展一览

| 拓展 id | 名称 | 贡献内容 | 平台 |
|---|---|---|---|
| `aib.solve` | 解题 | 工具面板、主页入口 | 桌面版、iPad 版 |
| `aib.snap` | 拍题 | 工具面板（运行拍题命令） | 桌面版、iPad 版 |
| `aib.geogebra` | GeoGebra 数学应用 | 工具面板、主页入口、AI 工具（ggb_*）、面板、`graph` 回答内容块 | 桌面版、iPad 版 |
| `aib.physics` | 物理 | 工具面板、主页入口、AI 工具、面板 | 桌面版、iPad 版 |
| `aib.wiki` | 百科 | 工具面板、主页入口 | 桌面版、iPad 版 |
| `aib.dictionary` | 词典 | 工具面板、主页入口、输入处理器（单词查询）、`word` 回答内容块、MDX/MDD 导入器、设置页面 | 桌面版、iPad 版 |
| `aib.code` | 代码 | 工具面板、主页入口 | 桌面版、iPad 版 |
| `aib.readlater` | 稍后读 | 工具面板、主页入口 | 桌面版、iPad 版 |
| `aib.scan` | 扫码 | 工具面板（运行扫码命令） | 仅 iPad 版 |
| `aib.docs` | 开发文档 | `aibrowser://docs` 页面 | 桌面版、iPad 版 |

## 迁移顺序与状态

1. **工具面板与主页入口**：工具栏、iPad 玻璃工具面板与主页入口改为读取各拓展的 `toolPanel` 与 `homepage` 贡献，不再使用内核中的固定列表。已完成。
2. **回答内容块**：`graph`（GeoGebra 作图）与 `word`（单词卡片）改由 `aib.geogebra`、`aib.dictionary` 处理。已完成。
3. **文件导入**：MDX/MDD 词典导入通过 `aib.dictionary` 的 `importers` 贡献提供。已完成。
4. **开发文档**：以 `aib.docs` 拓展提供，通过 `urlSchemes` 注册 `aibrowser://docs`。已完成。
5. **后续计划**：百科（ZIM 导入）、代码编辑器与稍后读的设置页面、iPad 原生视图将依次改为通过 `importers`、`settingsPages` 与 `nativeViews` 贡献提供，每一步均附带功能一致性测试。

## 兼容性

- 框架级别 1 的拓展无需修改即可继续使用。
- 内置拓展的设置与数据在迁移前后保持不变。
