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
node scripts/build-ipad-bundle.js ipad/build/payload          # desktop main process + pages + iPad layer
node scripts/fetch-ipad-pyodide.js ipad/build/payload          # Pyodide 314 (CPython 3.14 WASM) + numpy/scipy/sympy/pandas/matplotlib/Pillow
gh release download v5.6.0 -R felixshine2009-cmd/ai-browser -p linux-vm-x86-v86.tar.gz
tar -C ipad/build/payload -xzf linux-vm-x86-v86.tar.gz         # vm/ : v86 + Alpine image with the guest agent
```

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
