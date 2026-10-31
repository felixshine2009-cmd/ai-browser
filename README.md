[**English**](README.md) | [中文](README_zh.md)

# AI Browser v1.0.1

An Electron (Chromium) desktop browser with an AI **Chat mode**: dictionary lookup (MDX/MDD), sentence structure analysis, long-text translation, **agentic web search** with cited answers, and GeoGebra plotting.

Targets **Apple Silicon (M1/M2/M3) macOS 12+**. The repo is end-to-end tested on Linux with xvfb + Playwright (see *Tests*); the Metal GPU path for local models has not been run on a real Mac by the test suite.

## Install (recommended)

Release assets:

| File | Description |
|---|---|
| `AI-Browser-mac-arm64.zip` | Unsigned `AI Browser.app` (macOS arm64 Electron + Metal local-model binaries) |
| `install.command` / `install.sh` | Unzip → copy to `/Applications` → `xattr -cr` → launch |
| `AI-Browser-source.zip` | Source (no `node_modules`) |
| `README.md` / `README-zh.md` | English README / Chinese README |

1. Put `AI-Browser-mac-arm64.zip` and `install.command` in the same folder.
2. Double-click `install.command` (or run `bash install.sh`).
3. If macOS says the developer cannot be verified: System Settings → Privacy & Security → Open Anyway, or run `xattr -cr "/Applications/AI Browser.app" && open "/Applications/AI Browser.app"`.

## First run

1. The home page greets you with “Felix, what would you like to do today?”. **Settings → General** lets you change the display name and the greeting (supports `{name}`; empty = default) and switch 中文 / English.
2. **Settings → AI Model**: *Custom API* (preset or Base URL / key / model / temperature; OpenAI or Anthropic format; **Test connection** fetches the model list and fills a model dropdown, and shows specific reasons for failures — DNS, refused, timeout, TLS, 401/403, 404, 429, 5xx, bad response) or *Local model* (download a GGUF with resume, or pick a file; translation-specialised models are tagged). Keys are stored encrypted on this machine and only used by the main process.
3. **Search engine**: Bing / Google / Baidu / DuckDuckGo / custom `%s`. The AI uses the selected engine as its search tool.
4. **Dictionaries (MDX/MDD)**, **Extensions**, **History** and **Privacy** are sections inside the same Settings page (URL hash, e.g. `aibrowser://settings#extensions`; back/forward works).
5. The Chat / Search segmented control sits left of the address bar. Switching from Chat to Search with a query present searches immediately with the default engine.

Without a configured model, asking gives a friendly error — the app does not crash.

## Chat mode

| Input | Behaviour |
|---|---|
| Single word | Dictionary extension (MDX) first; otherwise an AI-generated entry marked “AI generated” (IPA from a bundled CMU dictionary, placeholder/hallucination guards) |
| Sentence | Translation + subject/predicate/object/attributive/adverbial colouring and structure breakdown |
| Long text | Translation only (source / translation columns); optional dedicated translation model |
| Question | **Agentic search**: API models run a tool-calling loop (`web_search` with the selected engine → `open_page` → refine if needed → answer with `[n]` citations, only for pages actually opened; ≤ 4 searches / 8 pages / 90 s). Local models use a fixed pipeline (rewrite → search → read → answer). Rewritten queries are editable; GeoGebra tool available |

If the selected engine is unreachable or returns irrelevant hits, the chain falls back Baidu → Bing → DuckDuckGo (shown in the status lines) and results are relevance-filtered. See [`docs/AGENT_SEARCH.md`](docs/AGENT_SEARCH.md), [`docs/PROMPTS.md`](docs/PROMPTS.md), [`docs/LOCAL_MODELS.md`](docs/LOCAL_MODELS.md).

## Extensions

* **Feature extensions** (`aib-feature/1`, see [`docs/EXTENSION_STANDARD.md`](docs/EXTENSION_STANDARD.md)): Dictionary and GeoGebra are pre-installed and independently upgradable; “AI-written extension” previews before install.
* **Chrome extensions** (MV3): best effort (content scripts, service workers, `chrome.storage` tested); toolbar popup UI is limited.

## From source

```bash
unzip AI-Browser-source.zip && cd ai-browser
npm ci
# first time may need: node node_modules/electron/install.js
npm start
npm run dist:mac   # build the darwin-arm64 app (dist/)
```

## Tests

```bash
xvfb-run -a node test/run-all.js          # all suites
xvfb-run -a node test/run-all.js 08       # the button-by-button audit -> test/BUTTON_AUDIT.md
```

## Known limitations

1. Not run on a real Mac by the test suite; local inference was verified on CPU on Linux, Metal must be confirmed on Apple Silicon.
2. The app is unsigned / not notarised.
3. Local models have no tool calling (the agent tool loop is API-only; local models use the fixed pipeline).
4. Chrome-extension API coverage is limited by Electron; no full toolbar popups.
5. Search engines may show captchas to scripted requests (Baidu especially); the fallback chain and relevance filter mitigate this.
6. Transitions are subtle (120–220 ms) and switched off under the system “reduce motion” setting.

License: MIT. Author: Felix.

*Created by Grok.*
