# iPad ↔ desktop parity (ipad-v2.0.0 / desktop v5.5.0)

The iPad app runs the desktop main process (`src/main`) and the desktop pages unchanged; only the host layer differs.
Verified = covered by `test/suites/36-ipad-sim.js` (iPad payload on the host simulator) and/or the CI device build.

| Area | Desktop (macOS) | iPad | Status |
|---|---|---|---|
| Main interface (home, greeting, input, model switcher, Chat/Search, tool icons, math keyboard) | ✔ | Same pages, touch sizing | Same · verified |
| Tabs, address bar, back/forward, new/switch/close | ✔ | Native WKWebView per tab | Same · verified |
| Chat / web-research agent, streaming, all AI providers | ✔ | Same code | Same · verified |
| Tool pages: solve, dictionary, wiki, physics, GeoGebra | ✔ | Same pages | Same · verified |
| History, downloads, bookmarks, settings, onboarding | ✔ | Same pages; downloads go to Files → AI浏览器/Downloads | Same · verified |
| Theme: light / dark / follow system, all palettes | ✔ | Same + native `overrideUserInterfaceStyle` | Same · verified |
| Context menus, dialogs, keyboard shortcuts | Right-click, native dialogs | Long-press, UIAlert / action sheet, hardware-keyboard shortcuts | Adapted · verified (sim) |
| Rotation, Split View, Stage Manager sizes | — | Relayout on resize | iPad-only · verified (sim) |
| Find in page | ✔ | `find.js` (CSS Highlight API) | Same |
| Local models: llama.cpp | node-llama-cpp (Metal) | Native llama.cpp b12314 xcframework (Metal) via `LlamaBridge.swift` | Kept · compiled in CI, not run on a device by CI |
| Local models: MLX | ✔ (Apple Silicon Mac) | — | **Removed** (not available on iPadOS) |
| Embedded Python | CPython 3.13 + pip | Pyodide 314 (CPython 3.14 WASM): numpy, scipy, sympy, mpmath, pandas, matplotlib, Pillow; micropip for pure-Python / Pyodide wheels | Adapted · verified (python_run in sim) |
| Linux VM + AI tools (vm_shell, vm_read/write_file, vm_upload/download, vm_status, vm_control) | Alpine arm64 VM | v86 (x86 emulation in WebAssembly) + Alpine, same guest agent | Adapted (slower) · verified (vm_shell in sim) |
| Built-in and AI-written extensions | ✔ | ✔ | Same |
| Chrome Web Store extensions (.crx) | ✔ | — | **Not possible** (WKWebView has no Chrome extension runtime) |
| Self-modification (code patches, safe mode) | ✔ | ✔ (payload in app container) | Same |
| Passwords (Keychain), Face ID / Touch ID | Keychain / Touch ID | Keychain / Face ID (LocalAuthentication) | Adapted |
| Notifications | ✔ | UserNotifications | Adapted |
| Codex-style VM tools (vm_view, vm_edit, vm_apply_patch, vm_search, vm_list, vm_bg, vm_pkg, vm_service, vm_git) | ✔ (network: apk/apt/pip/npm in the guest) | ✔ (no guest network: the app downloads Alpine packages / pip wheels and installs them offline; restored after restart) | Adapted · verified (all nine in sim, test 36) |
| Graphical VM image + computer use (vm_desktop, vm_screenshot, vm_click, vm_type, vm_key, vm_scroll, vm_drag) | Debian 13 arm64 + XFCE, ~1 GB first-use download | Alpine + JWM + xterm + Dillo + Xfe, 28 MB first-use download (delta over the built-in image) | Adapted (lighter desktop, slower) · verified (test 38 on QEMU, test 39 in sim) |
| Document tools (layout engine, PDF / HTML export, layout, slides, chart, exam, word-card and mind-map agents) | ✔ | Same code; measured in hidden web views, one PDF page per document page via PDFKit (`Services/PDFPages.swift`) | Same · verified (sim, `47-ipad-docs.js`) |
| Answer blocks (tables, chemical equations with balance check, function graphs, word cards) | ✔ | Same pages | Same |
| Linux VM image | Built in | Downloaded on first use (~121 MB), not in the IPA | Adapted · verified (sim, `46-ipad-vm-download.js`) |

## Not yet done (next milestones)
- On-device verification of the Swift host (CI compiles and packages it; it cannot run it on an iPad).
