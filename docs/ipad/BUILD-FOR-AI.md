# Building the iPad app (ipad-v2+) — instructions for an AI agent or a developer

The iPad app is the **desktop app ported directly**: the desktop main process (`src/main`) runs unchanged inside
embedded Node.js (nodejs-mobile, Node 18) on an Electron API shim (`ipad/node/electron`), and every window, tab and
overlay is a native `WKWebView` placed by a small Swift host (`ipad/App`). Only MLX is removed (Apple-Silicon Mac only);
llama.cpp stays, as a native Metal library (`ipad/App/LlamaBridge.swift`).

CI (`.github/workflows/ipad-ipa.yml`) builds an unsigned IPA on every `ipad-v*` tag. If CI is unavailable, or a part
cannot be built there, build locally with the steps below.

## Requirements
- macOS with Xcode 16 (iOS 16+ SDK), Node.js 20, `brew install xcodegen`, `gh` (or download the assets by hand)
- iPad with iPadOS 16 or later (A12 or newer; M-series recommended for local models and the Linux VM)

## 1. Payload (JavaScript, pages, Python, Linux VM)
```bash
npm ci
node scripts/build-ipad-bundle.js ipad/build/aibapp          # desktop main process + pages + iPad layer
node scripts/fetch-ipad-pyodide.js ipad/build/aibapp          # Pyodide 314 (CPython 3.14 WASM) + numpy/scipy/sympy/pandas/matplotlib/Pillow
gh release download v5.6.0 -R felixshine2009-cmd/ai-browser -p linux-vm-x86-v86.tar.gz
tar -C ipad/build/aibapp -xzf linux-vm-x86-v86.tar.gz         # vm/ : v86 + Alpine image with the guest agent
```

The optional graphical image is not part of the payload. The app downloads `linux-vm-x86-gui.tar` from the v5.7.0
release on first use (only the files that differ from the built-in image, ~28 MB). To rebuild it:
`GUI=1 vm/build-guest.sh x86 <gui-out>` and `scripts/package-v86-gui.sh <built-in-image-dir> <gui-out> linux-vm-x86-gui.tar`
(the built-in image dir must be the exact image in the payload, because the delta refers to its files).

## 2. Native frameworks
```bash
mkdir -p ipad/Frameworks
gh release download v18.20.4 -R nodejs-mobile/nodejs-mobile -p nodejs-mobile-v18.20.4-ios.zip
unzip nodejs-mobile-v18.20.4-ios.zip 'NodeMobile.xcframework/*' -d ipad/Frameworks
gh release download b12314 -R ggml-org/llama.cpp -p llama-b12314-xcframework.zip
unzip llama-b12314-xcframework.zip -d /tmp/llama && cp -R /tmp/llama/build-apple/llama.xcframework ipad/Frameworks/
```

## 3. Xcode project and build
```bash
cd ipad && xcodegen generate                                   # -> ipad/AIBrowser.xcodeproj (from project.yml)
open AIBrowser.xcodeproj                                       # set your Team under Signing & Capabilities, choose your iPad, Run
```
Unsigned IPA (as CI does):
```bash
xcodebuild -project ipad/AIBrowser.xcodeproj -scheme AIBrowser -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/AIBrowser.xcarchive CODE_SIGNING_ALLOWED=NO archive
mkdir Payload && cp -R build/AIBrowser.xcarchive/Products/Applications/AIBrowser.app Payload/
zip -qry AI-Browser-iPad-unsigned.ipa Payload
```
Install the unsigned IPA with a signing tool (AltStore, Sideloadly, or re-sign with your own certificate).

## 4. Testing without a Mac
`ipad/sim` is a host simulator: an Electron implementation of the Swift host protocol. It runs the real payload under
Node 18 so the whole stack except Swift/WebKit is tested on Linux:
```bash
node scripts/build-ipad-bundle.js /tmp/ipad-bundle
node scripts/fetch-ipad-pyodide.js /tmp/ipad-bundle            # optional: Python test
tar -C /tmp/ipad-bundle -xzf linux-vm-x86-v86.tar.gz           # optional: Linux VM test
AIB_IPAD_BUNDLE=/tmp/ipad-bundle AIB_NODE=/path/to/node18/bin/node node scripts/run-tests.js 36-ipad-sim
```

## Layout
| Path | What |
|---|---|
| `ipad/App/*.swift` | Swift host: Node runtime, bridge (`Host.swift`), web views/tabs/downloads (`WebHost.swift`), schemes, UI (`BrowserViewController.swift`), llama.cpp (`LlamaBridge.swift`) |
| `ipad/node/` | `main-ipad.js` entry, `host.js` loopback HTTP+SSE bridge, Electron shim, node-llama-cpp shim, Python/VM overrides |
| `ipad/web/` | runtime injected into every page (preload equivalent), iPad touch CSS, find-in-page, Python kernel host, VM host |
| `ipad/sim/` | host simulator used by `test/suites/36-ipad-sim.js` |
| `ipad/project.yml` | XcodeGen spec (version = MARKETING_VERSION) |

## Startup problems on a device
- nodejs-mobile runs V8 without a JIT on iOS, so Node has no native WebAssembly. `ipad/node/wasm-shim.js` installs
  polywasm before anything else; without it Node's fetch / Headers / Response (undici) throw and no `aibrowser:` page
  loads. The simulator runs Node with `--jitless` (set `AIB_SIM_JIT=1` to turn the JIT back on) so tests see the same.
- nodejs-mobile is also built without ICU (`v8_enable_i18n_support=0`, like `configure --with-intl=none`): there is no
  `Intl`, `localeCompare` / `toLocaleString` ignore locales, and `TextDecoder` only knows utf-8 / utf-16le and rejects
  `fatal`. `ipad/node/encoding-shim.js` (loaded second) decodes every other encoding (big5, gb18030, gbk, shift_jis,
  euc-kr, utf-16be, windows-125x, iso-8859-x …) with iconv-lite; main-process code must not use `Intl`. CI builds a
  Node 18 `--with-intl=none` (job `node-noicu`, cached), runs `scripts/check-ipad-runtime.js` with it under
  `--jitless`, and runs the simulator on it. Locally: build Node 18.20.4 with `./configure --with-intl=none` and set
  `AIB_NODE` to it.
- The app writes `Documents/日志/startup.log` (native stages, bridge errors, Node exit code, first window shown) and
  `Documents/日志/node.log` (Node console). In the Files app: On My iPad › AI 浏览器 › 日志.
- If no window is shown within 25 s, Node exits, or main.js fails to load (Node sends `app.diag`), the startup overlay
  turns into a diagnostics panel with both log tails and 复制日志 / 重试.
