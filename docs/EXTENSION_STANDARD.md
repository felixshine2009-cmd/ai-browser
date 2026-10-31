# AI 浏览器「功能拓展」标准 `aib-feature/1`

功能拓展（Feature Extension）是 AI 浏览器**自有**的扩展格式，用来给 Chat 模式增加能力：
接管某类输入的处理（例如“单词 → 词典”）、给 LLM 提供**工具**（例如“画函数图像”）、
在页面侧边提供**面板**（例如 GeoGebra）。它与 Chrome 扩展（“普通浏览器拓展”）相互独立。

预装的 **词典**（`aib.dictionary`）和 **GeoGebra 作图**（`aib.geogebra`）就是按本标准写的，
源码在 `extensions/builtin/`，可直接当示例阅读。

## 1. 目录结构

```
my-extension/
  manifest.json      必需
  main.js            必需（manifest.entry 指定），在沙箱中运行
  panel.html         可选，面板页（manifest.contributes.panels）
  settings.html      可选，设置页（manifest.contributes.settingsPage）
  ...任意静态资源（相对路径，不允许 ..）
```

打包为 `.zip`（`manifest.json` 在根目录或唯一一级子目录下）即可分发和安装。

## 2. manifest.json

```json
{
  "standard": "aib-feature/1",
  "id": "user.my-ext",
  "name": "我的拓展",
  "version": "1.0.0",
  "description": "一句话说明",
  "update_url": "https://example.com/my-ext/update.json",
  "permissions": ["storage", "net", "ai", "tabs", "panels"],
  "entry": "main.js",
  "i18n": { "zh": { "name": "…", "description": "…" }, "en": { "name": "…", "description": "…" } },
  "contributes": {
    "inputHandlers": [ { "id": "lookup", "types": ["word"], "priority": 100 } ],
    "tools": [ { "name": "my_tool", "description": "给 LLM 看的说明", "parameters": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } } ],
    "panels": [ { "id": "canvas", "title": "画布", "page": "panel.html", "location": "side" } ],
    "settingsPage": "settings.html"
  }
}
```

| 字段 | 必需 | 规则 |
|---|---|---|
| `standard` | 是 | 固定为 `"aib-feature/1"` |
| `id` | 是 | `/^[a-z0-9][a-z0-9._-]{2,63}$/`，全局唯一；内置拓展用 `aib.` 前缀，用户拓展建议 `user.` |
| `name` / `version` | 是 | `version` 必须是 `x.y.z` |
| `entry` | 是 | 相对路径的 JS 文件 |
| `update_url` | 否 | 指向“更新描述 JSON”（见 §6） |
| `permissions` | 否 | 见 §3；写了未知权限则拒绝安装 |
| `i18n` | 否 | 按语言覆盖 name/description |
| `contributes.inputHandlers[]` | 否 | `id`、`types`（`word` `sentence` `article` `question` `any`）、`priority`（大者先执行） |
| `contributes.tools[]` | 否 | `name` 匹配 `/^[a-z][a-z0-9_]{1,40}$/`；`parameters` 为 JSON Schema（OpenAI function 格式） |
| `contributes.panels[]` | 否 | `id`、`title`、`page`（相对路径）、`location: "side"` |
| `contributes.settingsPage` | 否 | 在“设置/拓展”里显示的设置页 |

## 3. 权限

| 权限 | 提供的 API |
|---|---|
| `storage` | `aib.storage.get(key?)` / `aib.storage.set(key, value)`，每个拓展独立 JSON 存储 |
| `net` | `aib.net.fetchText(url, {timeoutMs})` → `{status, text}`；仅 http(s)，响应最多 1 MB |
| `ai` | `aib.ai.complete(promptOrMessages)` 调用用户配置的 LLM（走主进程，拓展拿不到 API Key） |
| `tabs` | `aib.tabs.open(url)` 打开新标签页 |
| `panels` | `aib.panels.call(ctx, panelId, method, args)` 调用面板页里的方法（返回 Promise） |
| `host.dictionary` / `host.geogebra` | **仅内置拓展**可用的宿主服务（词典引擎等），用户拓展声明会被拒绝使用 |

不需要权限的 API：`aib.id`、`aib.version`、`aib.log(...)`、`aib.settings.get()/set(v)`（拓展自己的设置）。

## 4. 运行时（`main.js`）

`main.js` 在 Node `vm` 沙箱中执行（**没有** `require` / `process` / `global` / `eval` / `new Function`；
同步代码 2 秒超时，每次调用 30 秒超时）。通过 `module.exports` 导出：

```js
module.exports = {
  // 输入处理器：返回 null 表示“我不处理”，由下一个处理器或默认 AI 流程接手
  inputHandlers: {
    lookup: async function (input, ctx) {
      // input: { kind: 'word', word: 'abandon', phrase?: bool }  (其他类型为 { kind, text })
      return { type: 'markdown', text: '**hello** ' + input.word };
    }
  },
  // 工具：LLM 通过 function calling 调用；返回值会被 JSON 序列化后回传给模型
  tools: {
    my_tool: async function (args, ctx) { return { ok: true, echoed: args.text }; }
  },
  // RPC：面板页 / 设置页通过 aibExt.call(name, args) 调用
  rpc: {
    ping: async function (args, ctx) { return 'pong'; }
  }
};
```

`ctx` 里携带发起请求的页面信息（用于 `aib.panels.call`，务必原样传入）。

### 输入处理器的返回类型

| `type` | 字段 | 渲染 |
|---|---|---|
| `markdown` | `text` | 以 Markdown 显示 |
| `html` | `html` | 放入完全沙箱的 iframe（无脚本） |
| `dictionary` | `word, results[{dictId,name,key,url}], suggestions[]` | 词典标签页视图（内置词典用） |
| 其他 | — | 以 JSON 文本显示 |

## 5. 面板页与设置页

页面通过 `aibext://<id>/<path>` 加载在 Chat/设置页内的 iframe 中。在页面里引入 SDK：

```html
<script src="aibext://user.my-ext/__sdk.js"></script>
<script>
  aibExt.ready.then(info => { /* info.lang = 'zh' | 'en' */ });
  aibExt.call('ping', {}).then(console.log);     // 调用 main.js 的 rpc.ping
</script>
```

面板要响应来自 `main.js` 的 `aib.panels.call(ctx, 'canvas', 'eval', args)` 时，监听 `postMessage`：

```js
window.addEventListener('message', function (ev) {
  var m = ev.data;
  if (ev.source !== parent || !m || !m.aibPanelCall) return;
  Promise.resolve(methods[m.method](m.args || {}))
    .then(function (r) { parent.postMessage({ aibPanelReply: m.aibPanelCall, result: r }, '*'); },
          function (e) { parent.postMessage({ aibPanelReply: m.aibPanelCall, error: String(e) }, '*'); });
});
```

完整例子见 `extensions/builtin/geogebra/panel.html`。页面的 CSP 只允许 `aibrowser:` / `aibext:` 来源的脚本。

## 6. 独立升级（`update_url`）

`update_url` 返回如下 JSON：

```json
{ "version": "1.1.0", "zip_url": "my-ext-1.1.0.zip", "sha256": "<zip 的 sha256，可选但建议填写>" }
```

`zip_url` 可以是相对 `update_url` 的路径。在“拓展”页点击“检查更新”：版本比本地新则提示，确认后下载、校验 sha256、
按 `id` 覆盖安装并重新加载；`id` 不一致或校验失败则拒绝。内置拓展同样可以用这个机制独立于浏览器升级
（升级后的用户目录版本优先于内置版本）。

## 7. 安装方式

* **拓展页 → 安装功能拓展**：选择文件夹或 `.zip`。
* **AI 编写插件**：用自然语言描述需求，AI 生成 `manifest.json` + `main.js`（+ 面板页），先**预览代码与权限**，
  确认后才会安装；生成物同样经过 `validateManifest` 校验并在沙箱中运行。
* 手动：把目录放进 `<用户数据目录>/feature-extensions/<id>/`，重启浏览器。

用户数据目录：macOS 为 `~/Library/Application Support/AI浏览器/`。

## 8. 安全模型

* 沙箱无文件/进程访问；网络、AI、标签页能力都需要显式权限，安装前的预览会列出权限。
* API Key 只存在于主进程，拓展无法读取。
* `host.*` 权限只对内置拓展开放。
* zip 安装会拒绝包含 `..` 或绝对路径的条目。
* 损坏或不合规的拓展只会在列表中显示错误，不会影响浏览器启动。

## 9. 与 Chrome 拓展的区别

“普通浏览器拓展”使用 Chrome 的 `manifest.json`（MV3 为主），由 Electron 内置的扩展支持加载（内容脚本、
service worker、`chrome.storage` 等已验证可用，其余 API 覆盖有限，见 README 已知限制）。两种拓展在“拓展”页并列管理。
