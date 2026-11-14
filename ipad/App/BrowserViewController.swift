import UIKit
import WebKit
import LocalAuthentication
import UserNotifications
import UniformTypeIdentifiers
import Security

/// The one iPad window. Implements every host command of the Electron shim (ipad/node/electron/index.js): web contents,
/// views and their layout (same coordinates as the desktop window), dialogs, menus, files, clipboard, cookies, theme,
/// downloads, notifications, biometrics and llama.cpp. ipad/sim/main.js is the JavaScript twin used on Linux CI.
final class BrowserViewController: UIViewController, UIGestureRecognizerDelegate, UIDocumentPickerDelegate, UIDocumentInteractionControllerDelegate {
    private var hosts = [Int: WebHost]()
    private var windowHostId = 0
    private let container = UIView()
    private let parking = UIView() // hidden helper web views (offscreen windows, Pyodide / VM hosts) live here
    private var lastSize = CGSize.zero
    private var keyboardUp = false
    private var initSent = false
    private var commands = [UIKeyCommand]()
    private var commandIds = [String: String]()
    private var focusedId = 0
    var contextPoint: (WebHost, CGPoint)?
    var activeDownloads = [String: WKDownload]()
    private var pickerReply: ((Bool, [String]) -> Void)?
    private var docController: UIDocumentInteractionController?
    // startup: overlay until the first window has loaded, diagnostics when that fails or takes too long
    private let overlay = StartupOverlay()
    private var stage = "启动运行时"
    private var windowShown = false
    private var startupTimer: Timer?
    private var nodeExitCode: Int?
    private static let startupTimeout: TimeInterval = 25

    override var keyCommands: [UIKeyCommand]? { commands }
    override var canBecomeFirstResponder: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.027, green: 0.063, blue: 0.059, alpha: 1)
        parking.frame = CGRect(x: 0, y: 0, width: 1024, height: 768); parking.alpha = 0.01; parking.isUserInteractionEnabled = false
        view.addSubview(parking)
        container.backgroundColor = .clear
        view.addSubview(container)
        overlay.frame = view.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.onRetry = { [weak self] in self?.retryStartup() }
        view.addSubview(overlay)
        StartupLog.begin()
        setStage("启动运行时", "正在启动内部运行时……")
        Host.shared.onCommand = { [weak self] m in self?.handle(m) }
        Host.shared.onConnected = { [weak self] in
            self?.setStage("连接", "已连接内部运行时，正在初始化……")
            self?.sendInit()
        }
        Host.shared.start()
        armStartupTimer()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(keyboard(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        nc.addObserver(self, selector: #selector(keyboard(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        nc.addObserver(self, selector: #selector(foreground), name: UIApplication.willEnterForegroundNotification, object: nil)
        nc.addObserver(forName: .aibNodeExited, object: nil, queue: .main) { [weak self] n in
            guard let self = self else { return }
            let code = n.userInfo?["code"] as? Int ?? -1
            self.nodeExitCode = code
            if self.windowShown {
                // nodejs-mobile can not be started twice in one process: show the diagnostics panel (logs, close app)
                self.windowShown = false
                self.overlay.alpha = 1
                if self.overlay.superview == nil { self.overlay.frame = self.view.bounds; self.view.addSubview(self.overlay) }
                self.showDiagnostics("内部运行时意外退出（退出码 \(code)）。请关闭应用后重新打开；已打开的页面与设置均已保存。")
            } else {
                self.showDiagnostics("内部运行时已退出（退出码 \(code)）")
            }
        }
    }

    // ------------------------------------------------------------------ startup overlay / diagnostics
    private func setStage(_ name: String, _ text: String) {
        stage = name
        StartupLog.log("阶段：\(name)")
        if !overlay.showingDiagnostics { overlay.setStage(text) }
    }
    private func armStartupTimer() {
        startupTimer?.invalidate()
        startupTimer = Timer.scheduledTimer(withTimeInterval: BrowserViewController.startupTimeout, repeats: false) { [weak self] _ in
            guard let self = self, !self.windowShown else { return }
            self.showDiagnostics("\(Int(BrowserViewController.startupTimeout)) 秒内未能显示界面")
        }
    }
    private func showDiagnostics(_ reason: String) {
        guard !windowShown else { return }
        StartupLog.log("显示诊断面板：阶段 \(stage)，\(reason)")
        startupTimer?.invalidate()
        view.bringSubviewToFront(overlay)
        overlay.isHidden = false
        // give the log writers a moment so that the panel includes the latest lines
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self, !self.windowShown else { return }
            self.overlay.showDiagnostics(stage: self.stage, reason: reason)
        }
    }
    private func retryStartup() {
        StartupLog.log("用户点击“重试”")
        if !NodeRuntime.alive {
            // nodejs-mobile can only start once per process: the app has to be opened again
            alert(title: "AI 浏览器", message: "内部运行时已退出，无法在本次运行中重新启动。应用将关闭，请从主屏幕重新打开。", buttons: ["关闭应用"]) { _ in exit(0) }
            return
        }
        overlay.showProgress()
        setStage(stage, "正在重试……")
        if let w = hosts[windowHostId] { w.webView.reload() }
        armStartupTimer()
    }
    /// The first load of the window page finished: the interface is visible.
    func windowDidLoad(_ h: WebHost) {
        guard !windowShown else { return }
        windowShown = true
        startupTimer?.invalidate()
        StartupLog.log("主窗口已显示：\(h.webView.url?.absoluteString ?? "")")
        Host.shared.event(["type": "app", "name": "windowShown"])
        UIView.animate(withDuration: 0.25, animations: { self.overlay.alpha = 0 }) { _ in self.overlay.removeFromSuperview() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let top = view.safeAreaInsets.top
        container.frame = CGRect(x: 0, y: top, width: view.bounds.width, height: view.bounds.height - top)
        let size = container.bounds.size
        if size != lastSize {
            lastSize = size
            if let w = hosts[windowHostId] { w.webView.frame = container.bounds }
            if initSent { Host.shared.event(["type": "window", "w": Double(size.width), "h": Double(size.height), "keyboard": keyboardUp]) }
        }
    }
    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        sendSystemTheme()
    }
    /// the OS appearance (not the app override): drives "follow system"
    private var systemDark: Bool { traitCollection.userInterfaceStyle == .dark }
    private var lastSystemDark: Bool?
    private func sendSystemTheme() {
        let d = systemDark
        if d == lastSystemDark { return }
        lastSystemDark = d
        if initSent { Host.shared.event(["type": "theme", "dark": d]) }
    }

    private func sendInit() {
        guard !initSent else { return }
        initSent = true
        view.layoutIfNeeded()
        let size = container.bounds.size
        lastSystemDark = systemDark
        let ctx = LAContext(); var e: NSError?
        let bio = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &e)
        setStage("加载界面", "正在加载界面……")
        Host.shared.event(["type": "init", "w": Double(size.width), "h": Double(size.height), "dark": systemDark, "biometry": bio,
                           "safeKey": Keychain.safeStorageKey().base64EncodedString(), "locale": Locale.preferredLanguages.first ?? "zh-CN",
                           "os": UIDevice.current.systemVersion, "model": UIDevice.current.model])
    }
    @objc private func foreground() {
        sendSystemTheme()
        if let s = UIPasteboard.general.hasStrings ? UIPasteboard.general.string : nil { Host.shared.event(["type": "clipboard", "text": s]) }
    }
    @objc private func keyboard(_ n: Notification) {
        let end = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect) ?? .zero
        let up = n.name != UIResponder.keyboardWillHideNotification && end.height > 80 && end.minY < view.bounds.height
        if up != keyboardUp { keyboardUp = up; Host.shared.event(["type": "window", "w": Double(container.bounds.width), "h": Double(container.bounds.height), "keyboard": up]) }
    }

    func focus(_ h: WebHost) {
        guard focusedId != h.id else { return }
        if let old = hosts[focusedId] { old.emit("blur") }
        focusedId = h.id
        h.emit("focus")
    }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    // ------------------------------------------------------------------ host commands
    private func handle(_ m: [String: Any]) {
        let cmd = m["cmd"] as? String ?? ""
        let seq = m["seq"] as? Int ?? 0
        let id = m["id"] as? Int ?? 0
        let h = hosts[id]
        let ok: (Any?) -> Void = { r in Host.shared.reply(seq, ok: true, result: r ?? (NSNull() as Any)) }
        let fail: (String) -> Void = { e in Host.shared.reply(seq, ok: false, error: e) }
        switch cmd {
        case "wc.create":
            let w = WebHost(id: id, kind: m["kind"] as? String ?? "view", partition: m["partition"] as? String ?? "", persistent: (m["persistent"] as? Bool) ?? true, controller: self)
            hosts[id] = w
            if w.kind == "hidden" { w.webView.frame = parking.bounds; parking.addSubview(w.webView) }
        case "view.create": break
        case "app.diag":
            let st = m["stage"] as? String ?? "", err = m["error"] as? String ?? ""
            StartupLog.log("Node 报告（\(st)）：\(err)")
            if (m["fatal"] as? Bool) == true { showDiagnostics(st == "main" ? "主程序（main.js）加载失败：\(err.split(separator: "\n").first.map(String.init) ?? err)" : err) }
        case "window.attach":
            guard let w = h else { break }
            windowHostId = id
            w.webView.frame = container.bounds
            container.insertSubview(w.webView, at: 0)
            StartupLog.log("主窗口已创建（web contents \(id)）")
        case "view.attach":
            guard let v = h else { break }
            v.attached = true
            container.addSubview(v.webView) // add = top of the z-order, like contentView.addChildView
            v.webView.frame = v.bounds; v.webView.isHidden = !v.visible
        case "view.detach": h?.attached = false; h?.webView.removeFromSuperview()
        case "view.bounds":
            guard let v = h else { break }
            v.bounds = CGRect(x: num(m["x"]), y: num(m["y"]), width: num(m["width"]), height: num(m["height"]))
            if v.attached { v.webView.frame = v.bounds }
        case "view.visible": h?.visible = (m["on"] as? Bool) ?? true; h?.webView.isHidden = !((m["on"] as? Bool) ?? true)
        case "view.bg": if let c = UIColor(hex: m["color"] as? String ?? "") { h?.webView.backgroundColor = c; h?.webView.isOpaque = c.cgColor.alpha >= 1 }
        case "wc.load": h?.load(m["url"] as? String ?? "", ua: m["ua"] as? String ?? "")
        case "wc.nav":
            guard let wv = h?.webView else { break }
            switch m["op"] as? String ?? "" {
            case "back": wv.goBack()
            case "forward": wv.goForward()
            case "reload": wv.reload()
            case "stop": wv.stopLoading()
            case "offset": let o = m["offset"] as? Int ?? 0; if let it = wv.backForwardList.item(at: o) { wv.go(to: it) }
            default: break
            }
        case "wc.send": h?.dispatch(channel: m["channel"] as? String ?? "", args: m["args"] ?? [])
        case "wc.exec":
            guard let w = h else { fail("no such web contents"); break }
            w.exec(m["code"] as? String ?? "") { success, value, err in success ? ok(value) : fail(err ?? "error") }
        case "wc.css":
            guard let w = h else { fail("no such web contents"); break }
            let css = (try? JSONSerialization.data(withJSONObject: [m["css"] as? String ?? ""])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
            w.webView.evaluateJavaScript("(function(c){var s=document.createElement('style');s.textContent=c[0];(document.head||document.documentElement).appendChild(s);return true})(\(css))", in: nil, in: w.scriptWorld) { _ in ok(true) }
        case "wc.focus": if let w = h { _ = w.webView.becomeFirstResponder(); focus(w) }
        case "wc.close":
            if let w = hosts.removeValue(forKey: id) { w.close(); Host.shared.event(["type": "wc", "id": id, "name": "closed"]) }
        case "wc.ua": h?.webView.customUserAgent = (m["ua"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        case "wc.zoom": h?.webView.pageZoom = CGFloat((m["factor"] as? Double) ?? 1)
        case "wc.mute":
            let muted = (m["muted"] as? Bool) ?? false
            h?.webView.evaluateJavaScript("document.querySelectorAll('video,audio').forEach(function(e){e.muted=\(muted)})", in: nil, in: .defaultClient) { _ in }
        case "wc.find":
            guard let w = h else { break }
            let args: [String: Any] = ["text": m["text"] as? String ?? "", "forward": (m["forward"] as? Bool) ?? true, "next": (m["findNext"] as? Bool) ?? false, "matchCase": (m["matchCase"] as? Bool) ?? false]
            w.webView.callAsyncJavaScript("return window.__aibFind ? window.__aibFind(a) : {active:0,matches:0}", arguments: ["a": args], in: nil, in: .defaultClient) { r in
                let v = (try? r.get()) as? [String: Any] ?? [:]
                w.emit("found", ["requestId": m["requestId"] ?? 0, "active": v["active"] ?? 0, "matches": v["matches"] ?? 0])
            }
        case "wc.stopFind": h?.webView.evaluateJavaScript("window.__aibFindClear && window.__aibFindClear()", in: nil, in: .defaultClient) { _ in }
        case "wc.edit":
            let op = m["op"] as? String ?? ""
            if op == "paste", let s = UIPasteboard.general.string, let w = h {
                let j = (try? JSONSerialization.data(withJSONObject: [s])).flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
                w.webView.evaluateJavaScript("document.execCommand('insertText',false,\(j)[0])", in: nil, in: w.scriptWorld) { _ in }
            } else if let w = h {
                w.webView.evaluateJavaScript("document.execCommand('\(op)')", in: nil, in: w.scriptWorld) { _ in }
            }
        case "wc.snapshot":
            guard let w = h else { fail("no such web contents"); break }
            w.webView.takeSnapshot(with: nil) { img, err in
                if let d = img?.pngData() { ok(["b64": d.base64EncodedString()]) } else { fail(err?.localizedDescription ?? "snapshot failed") }
            }
        case "wc.pdf":
            guard let w = h else { fail("no such web contents"); break }
            w.webView.createPDF(configuration: WKPDFConfiguration()) { r in
                switch r { case .success(let d): ok(["b64": d.base64EncodedString()]); case .failure(let e): fail(e.localizedDescription) }
            }
        case "wc.print":
            guard let w = h else { fail("no such web contents"); break }
            let pc = UIPrintInteractionController.shared
            let info = UIPrintInfo(dictionary: nil); info.jobName = w.webView.title ?? "AI 浏览器"; info.outputType = .general
            pc.printInfo = info; pc.printFormatter = w.webView.viewPrintFormatter()
            pc.present(animated: true) { _, done, err in ok(["ok": done, "error": err?.localizedDescription ?? ""]) }
        case "wc.devtools": break // Safari ▸ Develop (web views are inspectable)
        case "theme.set":
            let src = m["source"] as? String ?? "system"
            let style: UIUserInterfaceStyle = src == "dark" ? .dark : src == "light" ? .light : .unspecified
            // only the web content (and so prefers-color-scheme, the keyboard, form controls) is overridden; this controller
            // keeps the OS appearance so "follow system" still sees OS changes (traitCollectionDidChange)
            container.overrideUserInterfaceStyle = style; parking.overrideUserInterfaceStyle = style
        case "menu.app": setAppMenu(m["keys"] as? [[String: Any]] ?? [])
        case "menu.popup": popupMenu(m["items"] as? [[String: Any]] ?? [], x: num(m["x"]), y: num(m["y"]), wcId: m["wcId"] as? Int ?? 0) { id in ok(["id": (id.map { $0 as Any }) ?? NSNull()]) }
        case "dialog.message":
            let buttons = (m["buttons"] as? [String]) ?? ["确定"]
            let title = m["title"] as? String ?? "", msg = [m["message"] as? String ?? "", m["detail"] as? String ?? ""].filter { !$0.isEmpty }.joined(separator: "\n\n")
            alert(title: title.isEmpty ? "AI 浏览器" : title, message: msg, buttons: buttons, cancelIndex: m["cancelId"] as? Int ?? -1) { i in ok(["response": i]) }
        case "dialog.open": openPicker(m) { cancelled, paths in ok(["paths": cancelled ? [] : paths]) }
        case "auth.biometric":
            let c = LAContext()
            c.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: (m["reason"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "验证身份以继续") { success, err in
                DispatchQueue.main.async { ok(["ok": success, "error": err?.localizedDescription ?? ""]) }
            }
        case "clipboard.write": UIPasteboard.general.string = m["text"] as? String ?? ""
        case "clipboard.image": if let d = Data(base64Encoded: m["b64"] as? String ?? ""), let img = UIImage(data: d) { UIPasteboard.general.image = img }
        case "session.cookies": cookies(m, ok)
        case "session.clear":
            let what = (m["what"] as? [String]) ?? ["all"]
            let types: Set<String> = what.contains("cache") && what.count == 1 ? [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache] : WKWebsiteDataStore.allWebsiteDataTypes()
            store(m["partition"] as? String ?? "").removeData(ofTypes: types, modifiedSince: .distantPast) { ok(true) }
        case "session.ua":
            let p = m["partition"] as? String ?? ""
            for w in hosts.values where w.partition == p { w.webView.customUserAgent = (m["ua"] as? String).flatMap { $0.isEmpty ? nil : $0 } }
        case "dl.pause", "dl.resume", "dl.cancel":
            let dlId = m["dlId"] as? String ?? ""
            guard let w = hosts.values.first(where: { $0.owns(dlId) }) else { break }
            if cmd == "dl.pause" { w.pauseDownload(dlId) } else if cmd == "dl.resume" { w.resumeDownload(dlId) } else { w.cancelDownload(dlId) }
        case "shell.open", "shell.show": preview(URL(fileURLWithPath: m["path"] as? String ?? ""))
        case "shell.export":
            let u = URL(fileURLWithPath: m["path"] as? String ?? "")
            guard FileManager.default.fileExists(atPath: u.path) else { break }
            let picker = UIDocumentPickerViewController(forExporting: [u], asCopy: true)
            present(picker, animated: true)
        case "shell.external": if let u = URL(string: m["url"] as? String ?? "") { UIApplication.shared.open(u) }
        case "notify":
            let c = UNUserNotificationCenter.current()
            c.requestAuthorization(options: [.alert, .sound]) { granted, _ in
                guard granted else { return }
                let content = UNMutableNotificationContent(); content.title = m["title"] as? String ?? ""; content.body = m["body"] as? String ?? ""
                c.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
            }
        case "idle": UIApplication.shared.isIdleTimerDisabled = (m["off"] as? Bool) ?? false
        case "ext.load": ok(["ok": false, "error": "iPad 上的 WebKit 不能运行 Chrome 扩展（.crx）；内置拓展与 AI 编写的拓展可用。"])
        case "ext.remove": break
        case "wc.archive":
            guard let w = h else { fail("no such web contents"); break }
            let dest = URL(fileURLWithPath: m["path"] as? String ?? "")
            w.webView.createWebArchiveData { r in
                switch r {
                case .success(let d):
                    do { try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true); try d.write(to: dest); ok(["bytes": d.count]) }
                    catch { fail(error.localizedDescription) }
                case .failure(let e): fail(e.localizedDescription)
                }
            }
        default:
            if cmd.hasPrefix("native.") {
                let ctx = ServiceContext(controller: self, top: topController, sourceView: container)
                if !ServiceRegistry.shared.handle(cmd, m, ctx: ctx, ok: ok, fail: fail), seq > 0 { fail("unsupported command \(cmd)") }
            } else if cmd.hasPrefix("llama.") {
                LlamaBridge.shared.handle(m, reply: { success, result, err in
                    DispatchQueue.main.async { success ? ok(result) : fail(err ?? "llama.cpp error") }
                }, partial: { p in Host.shared.partial(seq, p) })
            } else if seq > 0 { fail("unsupported command \(cmd)") }
        }
    }
    private func num(_ v: Any?) -> CGFloat { CGFloat((v as? Double) ?? Double((v as? Int) ?? 0)) }
    private func store(_ partition: String) -> WKWebsiteDataStore { WebHost.store(partition, persistent: partition.isEmpty || partition.hasPrefix("persist:")) }

    // ------------------------------------------------------------------ cookies (Electron Cookie objects)
    private func cookies(_ m: [String: Any], _ ok: @escaping (Any?) -> Void) {
        let cs = store(m["partition"] as? String ?? "").httpCookieStore
        switch m["op"] as? String ?? "get" {
        case "set":
            let c = m["cookie"] as? [String: Any] ?? [:]
            let u = URL(string: c["url"] as? String ?? "")
            var p: [HTTPCookiePropertyKey: Any] = [.name: c["name"] as? String ?? "", .value: c["value"] as? String ?? "", .path: c["path"] as? String ?? "/",
                                                   .domain: (c["domain"] as? String) ?? u?.host ?? ""]
            if (c["secure"] as? Bool) == true { p[.secure] = "TRUE" }
            if let exp = c["expirationDate"] as? Double { p[.expires] = Date(timeIntervalSince1970: exp) }
            if let ck = HTTPCookie(properties: p) { cs.setCookie(ck) { ok(true) } } else { ok(false) }
        case "remove":
            let u = URL(string: m["url"] as? String ?? ""), name = m["name"] as? String ?? ""
            cs.getAllCookies { all in
                let g = DispatchGroup()
                for c in all where c.name == name && (u?.host.map { $0.hasSuffix(c.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) } ?? true) { g.enter(); cs.delete(c) { g.leave() } }
                g.notify(queue: .main) { ok(true) }
            }
        default:
            let f = m["filter"] as? [String: Any] ?? [:]
            let host = URL(string: f["url"] as? String ?? "")?.host, name = f["name"] as? String, domain = f["domain"] as? String
            cs.getAllCookies { all in
                let list = all.filter { c in
                    let d = c.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
                    return (name == nil || c.name == name) && (host == nil || host!.hasSuffix(d)) && (domain == nil || d.hasSuffix(domain!.trimmingCharacters(in: CharacterSet(charactersIn: "."))))
                }.map { c -> [String: Any] in
                    var o: [String: Any] = ["name": c.name, "value": c.value, "domain": c.domain, "path": c.path, "secure": c.isSecure, "httpOnly": c.isHTTPOnly, "session": c.isSessionOnly, "hostOnly": !c.domain.hasPrefix(".")]
                    if let e = c.expiresDate { o["expirationDate"] = e.timeIntervalSince1970 }
                    return o
                }
                ok(list)
            }
        }
    }

    // ------------------------------------------------------------------ menus
    /// Application menu accelerators -> hardware keyboard shortcuts (shown in the iPadOS shortcut overlay)
    private func setAppMenu(_ keys: [[String: Any]]) {
        commands = []; commandIds = [:]
        for k in keys {
            guard let acc = k["accelerator"] as? String, let id = k["id"] as? String else { continue }
            var flags: UIKeyModifierFlags = []; var input = ""
            for part in acc.split(separator: "+").map({ String($0).trimmingCharacters(in: .whitespaces) }) {
                switch part.lowercased() {
                case "cmdorctrl", "commandorcontrol", "cmd", "command", "super", "meta": flags.insert(.command)
                case "ctrl", "control": flags.insert(.control)
                case "alt", "option": flags.insert(.alternate)
                case "shift": flags.insert(.shift)
                case "left": input = UIKeyCommand.inputLeftArrow
                case "right": input = UIKeyCommand.inputRightArrow
                case "up": input = UIKeyCommand.inputUpArrow
                case "down": input = UIKeyCommand.inputDownArrow
                case "esc", "escape": input = UIKeyCommand.inputEscape
                case "tab": input = "\t"
                case "enter", "return": input = "\r"
                case "plus": input = "+"
                case "space": input = " "
                case "backspace", "delete": input = "\u{8}"
                default: input = part.count == 1 ? part.lowercased() : part.lowercased().hasPrefix("f") ? "" : part.lowercased()
                }
            }
            if input.isEmpty { continue }
            let kc = UIKeyCommand(title: k["label"] as? String ?? "", action: #selector(keyCommand(_:)), input: input, modifierFlags: flags)
            kc.wantsPriorityOverSystemBehavior = true
            commands.append(kc); commandIds["\(input)|\(flags.rawValue)"] = id
        }
        becomeFirstResponder()
    }
    @objc private func keyCommand(_ k: UIKeyCommand) {
        if let id = commandIds["\(k.input ?? "")|\(k.modifierFlags.rawValue)"] { Host.shared.event(["type": "menu", "itemId": id]) }
    }

    /// Menu.popup(): the desktop context menus as an action sheet anchored where the user long-pressed / tapped
    private func popupMenu(_ items: [[String: Any]], x: CGFloat, y: CGFloat, wcId: Int, done: @escaping (String?) -> Void) {
        var flat = [(String, String, Bool)]()
        func walk(_ list: [[String: Any]], _ prefix: String) {
            for it in list {
                let type = it["type"] as? String ?? "normal"
                if type == "separator" { continue }
                let label = (it["label"] as? String ?? "").replacingOccurrences(of: "&", with: "")
                if let sub = it["submenu"] as? [[String: Any]] { walk(sub, prefix + label + " ▸ "); continue }
                let checked = (it["checked"] as? Bool) == true && (type == "checkbox" || type == "radio")
                flat.append((it["id"] as? String ?? "", prefix + (checked ? "✓ " : "") + label, (it["enabled"] as? Bool) ?? true))
            }
        }
        walk(items, "")
        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        sheet.overrideUserInterfaceStyle = container.overrideUserInterfaceStyle
        for (id, label, enabled) in flat {
            let a = UIAlertAction(title: label, style: .default) { _ in done(id) }
            a.isEnabled = enabled
            sheet.addAction(a)
        }
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in done(nil) })
        var anchor = CGPoint(x: x, y: y), src: UIView = container
        if let (h, p) = contextPoint, h.id == wcId || wcId == 0 { anchor = p; src = h.webView }
        else if let h = hosts[wcId] { src = h.webView }
        contextPoint = nil
        if let pop = sheet.popoverPresentationController { pop.sourceView = src; pop.sourceRect = CGRect(origin: anchor, size: CGSize(width: 1, height: 1)) }
        topController.present(sheet, animated: true)
    }

    // ------------------------------------------------------------------ dialogs
    private var topController: UIViewController { var c: UIViewController = self; while let p = c.presentedViewController { c = p }; return c }
    func alert(title: String, message: String, buttons: [String], cancelIndex: Int = -1, completion: @escaping (Int) -> Void) {
        let a = UIAlertController(title: title, message: message.isEmpty ? nil : message, preferredStyle: .alert)
        a.overrideUserInterfaceStyle = container.overrideUserInterfaceStyle
        for (i, b) in buttons.enumerated() {
            let destructive = ["删除", "清除", "移除", "Delete", "Remove"].contains(where: { b.contains($0) })
            a.addAction(UIAlertAction(title: b, style: i == cancelIndex ? .cancel : destructive ? .destructive : .default) { _ in completion(i) })
        }
        topController.present(a, animated: true)
    }
    func prompt(title: String, text: String, completion: @escaping (String?) -> Void) {
        let a = UIAlertController(title: title, message: nil, preferredStyle: .alert)
        a.addTextField { $0.text = text }
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completion(nil) })
        a.addAction(UIAlertAction(title: "确定", style: .default) { [weak a] _ in completion(a?.textFields?.first?.text ?? "") })
        topController.present(a, animated: true)
    }
    /// dialog.showOpenDialog: Files picker; picked files are copied into the app (tmp/picked) so Node can read them
    private func openPicker(_ m: [String: Any], completion: @escaping (Bool, [String]) -> Void) {
        let props = (m["properties"] as? [String]) ?? ["openFile"]
        let dirs = props.contains("openDirectory")
        var types = [UTType]()
        if dirs && !props.contains("openFile") { types = [.folder] }
        else {
            for f in (m["filters"] as? [[String: Any]]) ?? [] {
                for e in (f["extensions"] as? [String]) ?? [] where e != "*" { if let t = UTType(filenameExtension: e) { types.append(t) } }
            }
            if types.isEmpty { types = [.item] }
            if dirs { types.append(.folder) } // files and folders (e.g. a dictionary folder with .mdx, .mdd and styles)
        }
        // opened in place (security-scoped) and copied below: one folder per pick keeps companion files together
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
        picker.allowsMultipleSelection = props.contains("multiSelections")
        picker.delegate = self
        pickerReply = completion
        topController.present(picker, animated: true)
    }
    func documentPicker(_ c: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let fm = FileManager.default
        let base = Paths.tmp.appendingPathComponent("picked/\(UUID().uuidString.prefix(8))", isDirectory: true)
        try? fm.createDirectory(at: base, withIntermediateDirectories: true)
        let reply = pickerReply; pickerReply = nil
        // copied off the main thread: system images and dictionaries can be several GB
        DispatchQueue.global(qos: .userInitiated).async {
            var out = [String]()
            for u in urls {
                let scoped = u.startAccessingSecurityScopedResource()
                defer { if scoped { u.stopAccessingSecurityScopedResource() } }
                let dest = base.appendingPathComponent(u.lastPathComponent)
                do { try fm.copyItem(at: u, to: dest); out.append(dest.path) } catch { NSLog("[aib] pick copy failed: \(error)") }
            }
            DispatchQueue.main.async { reply?(false, out) }
        }
    }
    func documentPickerWasCancelled(_ c: UIDocumentPickerViewController) { pickerReply?(true, []); pickerReply = nil }

    /// shell.openPath / showItemInFolder: Quick Look preview with the system share / "open in" actions
    private func preview(_ u: URL) {
        guard FileManager.default.fileExists(atPath: u.path) else { return }
        let d = UIDocumentInteractionController(url: u); d.delegate = self; docController = d
        if !d.presentPreview(animated: true) { d.presentOptionsMenu(from: CGRect(x: container.bounds.midX, y: 60, width: 1, height: 1), in: container, animated: true) }
    }
    func documentInteractionControllerViewControllerForPreview(_ c: UIDocumentInteractionController) -> UIViewController { topController }
}

// ------------------------------------------------------------------ helpers
enum Keychain {
    /// 32-byte key for Electron safeStorage (API keys, passwords), kept in the iPad Keychain (this device only)
    static func safeStorageKey() -> Data {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "AIBrowser.safeStorage", kSecAttrAccount as String: "key", kSecReturnData as String: true]
        var out: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data, d.count == 32 { return d }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, 32, &bytes)
        let d = Data(bytes)
        let add: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "AIBrowser.safeStorage", kSecAttrAccount as String: "key",
                                  kSecValueData as String: d, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemDelete(add as CFDictionary)
        let st = SecItemAdd(add as CFDictionary, nil)
        // re-signed builds may lack keychain access: saved secrets then can not be decrypted after a restart
        StartupLog.log(st == errSecSuccess ? "已在钥匙串中创建加密密钥" : "钥匙串写入失败（OSStatus \(st)），已保存的密码与密钥在重新打开应用后将无法解密")
        return d
    }
}
extension UIColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        guard s.hasPrefix("#") else { return nil }
        s.removeFirst()
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
        // Electron colour strings: #RRGGBB or #AARRGGBB
        let a = s.count == 8 ? CGFloat((v >> 24) & 0xff) / 255 : 1
        let rgb = v & 0xffffff
        self.init(red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: a)
    }
}
