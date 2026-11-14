# 拓展框架开发指南

本文档说明 AI 浏览器的拓展框架（清单标准 `aib-feature/1`，框架级别 2）。桌面版与 iPad 版使用同一套框架与同一种拓展格式，同一个拓展包可以在两个平台上安装和运行。

## 一、总体结构

浏览器分为“内核”和“拓展”两部分。

内核只保留以下基础能力：

- 标签页与网页视图；
- AI 对话引擎与回答格式规范；
- 设置与数据存储；
- 工具注册表（AI 与任务模式可调用的工具）；
- 拓展宿主（加载、校验、启用、停用、更新拓展）。

其余功能均以拓展形式提供。解题、拍题、GeoGebra、物理、百科、词典、代码、稍后读、扫码以及本开发文档，都是随应用附带的第一方拓展，源代码位于应用目录的 `extensions/builtin/` 中，可作为编写拓展的示例。

拓展通过“贡献点”声明自己向浏览器添加的内容，例如工具面板中的一个工具、主页上的一个入口、回答中的一种内容块、设置中的一个页面或一种可导入的文件类型。停用某个拓展后，它贡献的全部内容会同时从界面中移除；重新启用后即恢复。

## 二、目录结构

```text
my-extension/
  manifest.json      必需：拓展清单
  main.js            必需：入口脚本（由 manifest.entry 指定），在沙箱中运行
  panel.html         可选：面板页面
  settings.html      可选：设置页面
  其他静态资源        可选：图片、样式表、脚本等，只能使用相对路径
```

将上述目录打包为 `.zip`（`manifest.json` 位于压缩包根目录或唯一的一级子目录中）即可分发。

## 三、清单 manifest.json

```json
{
  "standard": "aib-feature/1",
  "id": "user.unit-converter",
  "name": "单位换算",
  "version": "1.0.0",
  "description": "长度、质量、温度等常用单位换算。",
  "engines": { "framework": ">=2" },
  "platforms": ["desktop", "ipad"],
  "permissions": ["storage"],
  "entry": "main.js",
  "update_url": "https://example.com/unit-converter/update.json",
  "i18n": {
    "zh": { "name": "单位换算", "description": "长度、质量、温度等常用单位换算。" },
    "en": { "name": "Unit Converter", "description": "Convert common units of length, mass and temperature." }
  },
  "contributes": {
    "toolPanel": [
      { "id": "convert", "label": { "zh": "换算", "en": "Convert" }, "tip": "单位换算",
        "icon": { "svg": "<circle cx=\"8\" cy=\"8\" r=\"6\"/><path d=\"M5 8h6M9 6l2 2-2 2\"/>" },
        "order": 120, "action": { "type": "page", "page": "convert.html" } }
    ],
    "homepage": [ { "tool": "convert", "order": 120 } ],
    "tools": [
      { "name": "unit_convert", "description": "Convert a value between units.",
        "parameters": { "type": "object", "properties": { "value": { "type": "number" }, "from": { "type": "string" }, "to": { "type": "string" } }, "required": ["value", "from", "to"] } }
    ]
  }
}
```

| 字段 | 必需 | 说明 |
|---|---|---|
| `standard` | 是 | 固定为 `"aib-feature/1"` |
| `id` | 是 | 全局唯一，格式为小写字母、数字、点、下划线或连字符（3–64 个字符）。`aib.` 前缀保留给内置拓展，用户拓展建议使用 `user.` 前缀 |
| `name`、`version` | 是 | `version` 采用 `主版本.次版本.修订号` 格式 |
| `entry` | 是 | 入口脚本的相对路径 |
| `engines.framework` | 否 | 所需的框架级别，例如 `">=2"`。当前框架级别高于或等于该值时才能安装 |
| `platforms` | 否 | 可运行的平台：`desktop`、`ipad`。省略时两个平台均可运行 |
| `permissions` | 否 | 所需权限，见第四节。声明未知权限的拓展将被拒绝安装 |
| `update_url` | 否 | 更新描述文件的地址，见第七节 |
| `i18n` | 否 | 按语言覆盖名称与说明 |
| `contributes` | 否 | 贡献点，详见《贡献点参考》 |

## 四、权限

| 权限 | 提供的接口 |
|---|---|
| `storage` | `aib.storage.get(key)`、`aib.storage.set(key, value)`：每个拓展独立的 JSON 存储 |
| `net` | `aib.net.fetchText(url, { timeoutMs })`：仅限 http(s)，响应最多 1 MB |
| `ai` | `aib.ai.complete(提示或消息数组)`：调用用户配置的模型，拓展无法读取 API 密钥 |
| `tabs` | `aib.tabs.open(url)`：打开新标签页 |
| `panels` | `aib.panels.call(ctx, 面板 id, 方法, 参数)`：调用面板页面中的方法 |
| `browser` | `aib.browser.get()`、`aib.browser.patch(补丁)`：读取或修改允许拓展修改的浏览器设置 |
| `host.dictionary`、`host.geogebra`、`host.physics` | 仅内置拓展可用的宿主服务 |

无需权限即可使用：`aib.id`、`aib.version`、`aib.log(...)`、`aib.settings.get()`、`aib.settings.set(值)`（拓展自身的设置）。

## 五、运行时（main.js）

入口脚本在独立沙箱中运行：没有 `require`、`process`、`global`、`eval` 与 `new Function`；脚本加载时的同步代码限时 2 秒，每次调用限时 30 秒（打开文件选择器的调用不限时，依赖面板的工具限时 120 秒）。

入口脚本通过 `module.exports` 导出以下对象，各项均为可选：

```js
module.exports = {
  // 输入处理器：返回 null 表示不处理，由下一个处理器或默认 AI 流程接手
  inputHandlers: { lookup: async (input, ctx) => null },
  // 工具：名称与 contributes.tools 中声明的一致，AI 与任务模式均可调用
  tools: { unit_convert: async (args, ctx) => ({ result: 0 }) },
  // 回答内容块：键为 contributes.answerBlocks 中的 handler
  answerBlocks: { myblock: async (payload, ctx) => ({ ok: true }) },
  // 供设置页、面板页与导入器调用的方法
  rpc: { importFiles: async ({ paths }) => ({ added: [] }) }
};
```

`ctx` 中的 `wcId` 标识发起调用的页面，调用面板方法时需原样传入。

## 六、页面（面板、设置页、工具页）

拓展中的 HTML 页面通过 `aibext://<拓展 id>/<相对路径>` 加载，运行在沙箱框架中，不能访问浏览器内部接口。页面可加载 `aibext://<拓展 id>/__sdk.js`，然后通过 `aibExt.call(方法名, 参数)` 调用本拓展 `rpc` 中的方法。

## 七、安装、启用与更新

- **安装**：在“设置 → 拓展”中选择“从文件夹安装”或“从 .zip 安装”。安装时会校验清单、权限与框架级别；不符合要求的拓展不会被安装，并会给出具体原因。
- **启用与停用**：每个拓展（包括内置拓展）都可以单独启用或停用，停用后其贡献的全部内容立即从界面中移除。
- **更新**：每个拓展可单独检查更新。`update_url` 指向如下格式的 JSON：

```json
{ "version": "1.1.0", "zip_url": "unit-converter-1.1.0.zip", "sha256": "可选的十六进制校验值" }
```

新版本号高于当前版本时，下载并校验后替换安装；更新包的 `id` 必须与原拓展一致。

- **卸载**：用户安装的拓展可以卸载；内置拓展只能停用。

## 八、平台差异

- 同一拓展包在桌面版与 iPad 版上的加载方式相同。
- 通过 `platforms` 可限定拓展或单个贡献项只在某一平台出现，例如“扫码”只在 iPad 上提供。
- iPad 版可通过 `nativeViews` 使用原生界面（仅内置拓展），桌面版使用其中声明的网页替代页面。
- 导入器按扩展名匹配文件；`utTypes` 供 iPad 版识别文件类型。

## 九、安全规则

- 用户拓展不能声明 `aibrowser://` 地址（`urlSchemes`）、原生视图（`nativeViews`）或直接运行浏览器命令的工具动作（`toolView`、`command`），也不能使用 `aib.` 前缀。
- 工具图标中的 SVG 只保留基本图形元素与几何属性，其他内容会被移除。
- 拓展无法读取 API 密钥、密码或其他拓展的数据。

更多内容请参阅《贡献点参考》与《内置功能与迁移记录》。
