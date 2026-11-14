# iPad: moving the host from Node/JavaScript to Swift, phase by phase

The iPad app runs the desktop main process (`src/main`) in embedded Node.js and draws every page in `WKWebView`s placed
by the Swift host (`ipad/App`). Native code replaces JavaScript one piece at a time, only where Swift is clearly better
(system look, hardware, file and PDF APIs, speed), and never by removing a feature.

## Contract
Node calls the host with `host.request({ cmd, ... })` (`ipad/node/electron`). Each native capability is a
`NativeService` (`ipad/App/Services/ServiceRegistry.swift`) that owns one or more `native.*` commands. A module moves to
Swift by adding a service with the same command contract, so the JavaScript callers do not change, and by keeping a
JavaScript fallback for the host simulator (`ipad/sim`), which runs the test suites on Linux and macOS.

## Done
| Phase | Swift | Replaces |
|---|---|---|
| Host | `BrowserViewController`, `WebHost`, `SchemeHandler`, `NodeRuntime` | Electron windows, views and protocols |
| Local models | `LlamaBridge` (llama.cpp xcframework, Metal) | node-llama-cpp |
| Hardware and system | `Native.swift`: camera, Vision OCR, QR scanning and QR images, PDF text; haptics, share sheet, capabilities | Web APIs and JS libraries |
| Chrome (v3.0.0) | `Chrome/Glass.swift` (Liquid Glass on iPadOS 26 with `UIGlassEffect`, `UIGlassContainerEffect` and glass button configurations, material fallback on iPadOS 16–18), `Chrome/ToolPopover.swift`, `Chrome/ToolIcons.swift` (icons drawn in code) | HTML tool strip and overlay |
| Documents (v3.0.0) | `Services/PDFPages.swift`: one PDF page per document page and page previews via `WKPDFConfiguration.rect` and PDFKit | single tall `createPDF` page, on-screen-only snapshots |

## Next
1. Downloads: `URLSession` background sessions for model and VM image downloads (continue while the app is suspended),
   keeping the segmented download logic and progress events of `src/main/downloads`.
2. Tabs: native tab overview and tab bar (glass), driven by the existing tab state from Node.
3. Settings shell: native navigation with the existing settings pages as content.
4. Search and history storage: SQLite through Swift, same IPC names.
