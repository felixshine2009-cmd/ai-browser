import UIKit
import WebKit

/// WKWebView subclass: adds the AI Browser items to the text-selection menu (long-press on text).
final class AIBWebView: WKWebView {
    weak var host: WebHost?
    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard let h = host, h.isWebPage else { return }
        let lookup = UIAction(title: "查词 / 翻译", image: UIImage(systemName: "character.book.closed")) { [weak h] _ in h?.selectionAction(lookup: true) }
        let more = UIAction(title: "AI 浏览器…", image: UIImage(systemName: "sparkles")) { [weak h] _ in h?.selectionAction(lookup: false) }
        builder.insertChild(UIMenu(title: "", options: .displayInline, children: [lookup, more]), atStartOfMenu: .standardEdit)
    }
}

/// One Electron webContents (window, tab view, overlay or hidden helper) = one WKWebView.
final class WebHost: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, WKDownloadDelegate {
    let id: Int
    let kind: String          // window | view | hidden
    let partition: String
    let webView: AIBWebView
    var bounds = CGRect.zero
    var visible = true
    var attached = false
    private var observers = [NSKeyValueObservation]()
    private var lastURL = ""
    weak var controller: BrowserViewController?

    var isWebPage: Bool { let s = webView.url?.scheme ?? ""; return s == "http" || s == "https" }
    var isInternal: Bool { webView.url?.scheme == "aibrowser" }
    /// World for executeJavaScript / insertCSS / IPC dispatch: web pages (http/https) run the bridge in an isolated world,
    /// every app page (aibrowser:, and aibres: helper pages such as the Python and Linux VM hosts) in the page world.
    /// (2.2.2 used the isolated world for aibres: pages, so window.pyhost / window.vmhost were undefined there.)
    var scriptWorld: WKContentWorld { isWebPage ? .defaultClient : .page }

    static let pool = WKProcessPool()
    static var stores = [String: WKWebsiteDataStore]()
    static func store(_ partition: String, persistent: Bool) -> WKWebsiteDataStore {
        if persistent { return .default() }
        if let s = stores[partition] { return s }
        let s = WKWebsiteDataStore.nonPersistent(); stores[partition] = s; return s
    }
    static let runtimeJS: String = (try? String(contentsOf: Paths.payload.appendingPathComponent("web/inject/runtime.js"), encoding: .utf8)) ?? ""
    static let findJS: String = (try? String(contentsOf: Paths.payload.appendingPathComponent("web/inject/find.js"), encoding: .utf8)) ?? ""

    init(id: Int, kind: String, partition: String, persistent: Bool, controller: BrowserViewController) {
        self.id = id; self.kind = kind; self.partition = partition; self.controller = controller
        let cfg = WKWebViewConfiguration()
        cfg.processPool = WebHost.pool
        cfg.websiteDataStore = WebHost.store(partition, persistent: persistent)
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
        cfg.defaultWebpagePreferences.preferredContentMode = .desktop
        if #available(iOS 15.4, *) { cfg.preferences.isElementFullscreenEnabled = true }
        // private WKPreferences key: only set it when this WebKit still has it (an unknown key would raise and crash)
        if cfg.preferences.responds(to: NSSelectorFromString("_setAllowFileAccessFromFileURLs:")) || cfg.preferences.responds(to: NSSelectorFromString("setAllowFileAccessFromFileURLs:")) {
            cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        }
        for s in SchemeHandler.nodeSchemes + ["aibres"] { cfg.setURLSchemeHandler(SchemeHandler.shared, forURLScheme: s) }
        let ucc = cfg.userContentController
        // preload: page world for internal pages, isolated world for web pages (the page itself never sees the bridge)
        let pageGuard = "if (location.protocol === 'aibrowser:') {\n" + WebHost.runtimeJS + "\n}"
        let webGuard = "if (/^https?:$/.test(location.protocol)) {\n" + WebHost.runtimeJS + "\n}"
        ucc.addUserScript(WKUserScript(source: pageGuard, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        ucc.addUserScript(WKUserScript(source: webGuard, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
        ucc.addUserScript(WKUserScript(source: WebHost.findJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
        webView = AIBWebView(frame: .zero, configuration: cfg)
        super.init()
        ucc.addScriptMessageHandler(self, contentWorld: .page, name: "aib")
        ucc.addScriptMessageHandler(self, contentWorld: .defaultClient, name: "aib")
        webView.host = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = kind == "view"
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if kind == "window" { webView.scrollView.isScrollEnabled = false; webView.scrollView.bounces = false }
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        observers.append(webView.observe(\.title, options: [.new]) { [weak self] wv, _ in self?.emit("title", ["title": wv.title ?? ""]); self?.navState() })
        observers.append(webView.observe(\.url, options: [.new]) { [weak self] wv, _ in self?.urlChanged() })
        observers.append(webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in self?.navState() })
        observers.append(webView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in self?.navState() })
        observers.append(webView.observe(\.isLoading, options: [.new]) { [weak self] wv, _ in self?.emit(wv.isLoading ? "start" : "stop", ["url": wv.url?.absoluteString ?? ""]); self?.navState() })
        let tap = UITapGestureRecognizer(target: self, action: #selector(touched))
        tap.cancelsTouchesInView = false; tap.delegate = controller
        webView.addGestureRecognizer(tap)
        let lp = UILongPressGestureRecognizer(target: self, action: #selector(longPressed(_:)))
        lp.cancelsTouchesInView = false; lp.delegate = controller; lp.minimumPressDuration = 0.55
        webView.addGestureRecognizer(lp)
    }

    func emit(_ name: String, _ extra: [String: Any] = [:], answer: ((Any?) -> Void)? = nil) {
        var m: [String: Any] = ["type": "wc", "id": id, "name": name]
        for (k, v) in extra { m[k] = v }
        Host.shared.event(m, answer: answer)
    }
    private func navState() {
        emit("navstate", ["url": webView.url?.absoluteString ?? "", "title": webView.title ?? "", "canBack": webView.canGoBack, "canForward": webView.canGoForward, "loading": webView.isLoading])
    }
    private func urlChanged() {
        let u = webView.url?.absoluteString ?? ""
        guard u != lastURL, !u.isEmpty else { return }
        let prev = lastURL; lastURL = u
        // same document (hash / pushState) when only the fragment / path changed without a load
        let inPage = !webView.isLoading && !prev.isEmpty
        emit("navigate", ["url": u, "inPage": inPage])
        navState()
    }
    @objc private func touched() { controller?.focus(self) }
    @objc private func longPressed(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, isWebPage else { return }
        let p = g.location(in: webView)
        let js = """
        (function(x,y){var el=document.elementFromPoint(x,y);if(!el)return null;var a=el.closest('a[href]');var img=el.closest('img');
        var sel=String(getSelection()||'');var ed=!!el.closest('input,textarea,[contenteditable=""],[contenteditable="true"]');
        return {linkURL:a?a.href:'',srcURL:img?img.currentSrc||img.src:'',mediaType:img?'image':'none',selectionText:sel,isEditable:ed};})(\(p.x),\(p.y))
        """
        webView.evaluateJavaScript(js, in: nil, in: .defaultClient) { [weak self] r in
            guard let self = self, case .success(let v) = r, var params = v as? [String: Any] else { return }
            if (params["linkURL"] as? String ?? "").isEmpty && (params["srcURL"] as? String ?? "").isEmpty { return } // plain text: the system selection menu handles it
            params["x"] = Double(p.x); params["y"] = Double(p.y)
            self.controller?.contextPoint = (self, p)
            self.emit("context", ["params": params])
        }
    }
    func selectionAction(lookup: Bool) {
        let js = "(function(){var s=getSelection();var t=String(s||'').trim();if(!t||!s.rangeCount)return null;var r=s.getRangeAt(0).getBoundingClientRect();return {text:t.slice(0,500),x:r.left,y:r.bottom};})()"
        webView.evaluateJavaScript(js, in: nil, in: .defaultClient) { [weak self] r in
            guard let self = self, case .success(let v) = r, let m = v as? [String: Any], let text = m["text"] as? String else { return }
            let x = (m["x"] as? Double) ?? 40, y = (m["y"] as? Double) ?? 40
            if lookup {
                let word = text.range(of: "^[A-Za-z][A-Za-z'’-]{1,40}$", options: .regularExpression) != nil
                Host.shared.send(["wcId": self.id, "url": self.webView.url?.absoluteString ?? "", "channel": "sel:lookup", "args": [["text": text, "kind": word ? "word" : "sentence", "x": x, "y": y]]])
            } else {
                self.controller?.contextPoint = (self, CGPoint(x: x, y: y))
                self.emit("context", ["params": ["x": x, "y": y, "selectionText": text, "linkURL": "", "srcURL": "", "mediaType": "none", "isEditable": false]])
            }
        }
    }

    // ---- renderer IPC (window.aib / ipcRenderer)
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let t = body["t"] as? String, let ch = body["channel"] as? String else { replyHandler(nil, "bad message"); return }
        let url = message.frameInfo.request.url?.absoluteString ?? webView.url?.absoluteString ?? ""
        // internal channels only from internal pages; web pages may only use the preload's password / lookup channels
        let scheme = URL(string: url)?.scheme ?? ""
        if scheme != "aibrowser" && !(["pw:creds", "pw:fill", "pw:submit", "pw:ready", "pw:answer", "sel:lookup"].contains(ch)) { replyHandler(["ok": false, "error": "forbidden"], nil); return }
        let m: [String: Any] = ["wcId": id, "url": url, "channel": ch, "args": body["args"] ?? []]
        if t == "invoke" { Host.shared.invoke(m) { r in replyHandler(r ?? ["ok": false, "error": "no reply"], nil) } }
        else { Host.shared.send(m); replyHandler(["ok": true], nil) }
    }
    /// webContents.send(channel, ...args)
    func dispatch(channel: String, args: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["c": channel, "a": args]), let json = String(data: data, encoding: .utf8) else { return }
        let js = "(function(m){ if (window.__aibDispatch) window.__aibDispatch(m.c, m.a); })(\(json))"
        webView.evaluateJavaScript(js, in: nil, in: scriptWorld) { _ in }
    }

    /// executeJavaScript: expression first (awaits promises), statement list as fallback
    func exec(_ code: String, completion: @escaping (Bool, Any?, String?) -> Void) {
        let world = scriptWorld
        let wrapped = "return await (async () => (\n" + code + "\n))()"
        webView.callAsyncJavaScript(wrapped, arguments: [:], in: nil, in: world) { [weak self] r in
            switch r {
            case .success(let v): completion(true, WebHost.plain(v), nil)
            case .failure(let e):
                let msg = (e as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? e.localizedDescription
                if msg.contains("SyntaxError") || msg.contains("Unexpected") {
                    self?.webView.evaluateJavaScript(code, in: nil, in: world) { r2 in
                        switch r2 { case .success(let v2): completion(true, WebHost.plain(v2), nil)
                        case .failure(let e2): completion(false, nil, (e2 as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? e2.localizedDescription) }
                    }
                } else { completion(false, nil, msg) }
            }
        }
    }
    static func plain(_ v: Any?) -> Any { guard let v = v else { return NSNull() }; return Host.jsonSafe(v) }

    // ---- navigation
    func load(_ s: String, ua: String) {
        guard let u = URL(string: s) else { return }
        if !ua.isEmpty { webView.customUserAgent = ua }
        if kind == "window" { StartupLog.log("主窗口加载 \(s)") }
        lastURL = ""
        if u.isFileURL {
            // offline copies (read later): web archives load as data, other files with read access to their folder
            if u.pathExtension.lowercased() == "webarchive", let d = try? Data(contentsOf: u) {
                webView.load(d, mimeType: "application/x-webarchive", characterEncodingName: "utf-8", baseURL: u)
            } else {
                webView.loadFileURL(u, allowingReadAccessTo: u.deletingLastPathComponent())
            }
            return
        }
        webView.load(URLRequest(url: u))
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { lastURL = webView.url?.absoluteString ?? ""; emit("navigate", ["url": lastURL, "inPage": false]); navState() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        emit("domready"); emit("finish"); navState()
        if kind == "window" { controller?.windowDidLoad(self) }
        if isWebPage {
            webView.evaluateJavaScript("(function(){var l=document.querySelector('link[rel~=\"icon\"]');return l?l.href:(location.origin+'/favicon.ico')})()", in: nil, in: .defaultClient) { [weak self] r in
                if case .success(let v) = r, let s = v as? String { self?.emit("favicon", ["url": s]) }
            }
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
    private func fail(_ error: Error) {
        let e = error as NSError
        if kind == "window" { StartupLog.log("主窗口加载失败：\(e.domain) \(e.code) \(e.localizedDescription)") }
        if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) { emit("fail", ["code": -3, "desc": "ERR_ABORTED", "url": webView.url?.absoluteString ?? ""]); return }
        emit("fail", ["code": -(abs(e.code)), "desc": e.localizedDescription, "url": (e.userInfo[NSURLErrorFailingURLStringErrorKey] as? String) ?? webView.url?.absoluteString ?? ""])
    }
    private var terminations = [Date]()
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // WebKit ends a page's content process under memory pressure: reload it (at most 3 times a minute)
        terminations = terminations.filter { Date().timeIntervalSince($0) < 60 } + [Date()]
        StartupLog.log("网页进程已终止（\(kind) \(id)，\(webView.url?.absoluteString ?? "")），\(terminations.count <= 3 ? "重新加载" : "暂停自动重新加载")")
        emit("gone")
        guard terminations.count <= 3 else { return }
        if webView.url == nil, !lastURL.isEmpty, let u = URL(string: lastURL) { webView.load(URLRequest(url: u)) } else { webView.reload() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let u = action.request.url
        let scheme = u?.scheme?.lowercased() ?? ""
        if action.shouldPerformDownload { decisionHandler(.download); return }
        if ["tel", "mailto", "sms", "facetime", "maps", "itms-apps"].contains(scheme) { if let u = u { UIApplication.shared.open(u) }; decisionHandler(.cancel); return }
        // target=_blank / middle-click equivalent
        if action.targetFrame == nil, let u = u {
            emit("newwin", ["url": u.absoluteString, "disposition": "foreground-tab"]); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let h = response.response as? HTTPURLResponse, let cd = h.value(forHTTPHeaderField: "Content-Disposition"), cd.lowercased().hasPrefix("attachment") { decisionHandler(.download); return }
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url { emit("newwin", ["url": u.absoluteString, "disposition": "foreground-tab"]) }
        return nil
    }
    func webViewDidClose(_ webView: WKWebView) {}

    // JS dialogs
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        controller?.alert(title: frame.request.url?.host ?? "", message: message, buttons: ["确定"]) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        controller?.alert(title: frame.request.url?.host ?? "", message: message, buttons: ["确定", "取消"]) { i in completionHandler(i == 0) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        controller?.prompt(title: prompt, text: defaultText ?? "", completion: completionHandler)
    }
    func webView(_ webView: WKWebView, contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo, completionHandler: @escaping (UIContextMenuConfiguration?) -> Void) {
        completionHandler(nil) // the desktop context menu (built in Node) is shown instead, see longPressed
    }
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.prompt) }

    // ---- downloads (Electron session 'will-download' / DownloadItem)
    private var downloads = [ObjectIdentifier: (id: String, dest: URL, obs: NSKeyValueObservation?)]()
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dlId = "dl" + UUID().uuidString.prefix(8)
        let m: [String: Any] = ["type": "dl", "phase": "start", "dlId": dlId, "wcId": id, "partition": partition, "url": response.url?.absoluteString ?? "",
                                "filename": suggestedFilename, "total": response.expectedContentLength, "mime": response.mimeType ?? ""]
        Host.shared.event(m) { [weak self] a in
            guard let self = self, let ans = a as? [String: Any], let p = ans["path"] as? String, (ans["cancel"] as? Bool) != true else { completionHandler(nil); return }
            let dest = URL(fileURLWithPath: p)
            try? FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: dest)
            let obs = download.progress.observe(\.completedUnitCount) { pr, _ in
                Host.shared.event(["type": "dl", "phase": "progress", "dlId": dlId, "received": pr.completedUnitCount, "total": pr.totalUnitCount])
            }
            self.downloads[ObjectIdentifier(download)] = (dlId, dest, obs)
            self.controller?.activeDownloads[dlId] = download
            completionHandler(dest)
        }
    }
    func downloadDidFinish(_ download: WKDownload) { finishDownload(download, state: "completed") }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) { finishDownload(download, state: (error as NSError).code == NSURLErrorCancelled ? "cancelled" : "interrupted") }
    private func finishDownload(_ d: WKDownload, state: String) {
        guard let r = downloads.removeValue(forKey: ObjectIdentifier(d)) else { return }
        r.obs?.invalidate(); controller?.activeDownloads.removeValue(forKey: r.id)
        if pausedIds.contains(r.id) { pausedDest[r.id] = r.dest; return } // paused: cancelled with resume data, not finished
        Host.shared.event(["type": "dl", "phase": "done", "dlId": r.id, "state": state, "received": d.progress.completedUnitCount])
    }
    // DownloadItem.pause() / resume(): cancel keeping the resume data, then WKWebView.resumeDownload(fromResumeData:)
    private var pausedIds = Set<String>()
    private var pausedDest = [String: URL]()
    private var resumeData = [String: Data]()
    func pauseDownload(_ dlId: String) {
        guard let d = controller?.activeDownloads[dlId] else { return }
        pausedIds.insert(dlId)
        d.cancel { [weak self] data in if let data = data { self?.resumeData[dlId] = data } }
    }
    func resumeDownload(_ dlId: String) {
        guard pausedIds.contains(dlId) else { return }
        pausedIds.remove(dlId)
        guard let data = resumeData.removeValue(forKey: dlId) else {
            Host.shared.event(["type": "dl", "phase": "done", "dlId": dlId, "state": "interrupted", "received": 0]); return
        }
        webView.resumeDownload(fromResumeData: data) { [weak self] d in
            guard let self = self else { return }
            d.delegate = self
            let dest = self.pausedDest.removeValue(forKey: dlId) ?? Paths.documents.appendingPathComponent("Downloads")
            let obs = d.progress.observe(\.completedUnitCount) { pr, _ in
                Host.shared.event(["type": "dl", "phase": "progress", "dlId": dlId, "received": pr.completedUnitCount, "total": pr.totalUnitCount])
            }
            self.downloads[ObjectIdentifier(d)] = (dlId, dest, obs)
            self.controller?.activeDownloads[dlId] = d
        }
    }
    func owns(_ dlId: String) -> Bool { pausedIds.contains(dlId) || downloads.values.contains { $0.id == dlId } }
    func cancelDownload(_ dlId: String) {
        if pausedIds.remove(dlId) != nil { resumeData.removeValue(forKey: dlId); pausedDest.removeValue(forKey: dlId); Host.shared.event(["type": "dl", "phase": "done", "dlId": dlId, "state": "cancelled", "received": 0]); return }
        controller?.activeDownloads[dlId]?.cancel(nil)
    }

    func close() {
        observers.forEach { $0.invalidate() }; observers.removeAll()
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        webView.stopLoading()
        webView.navigationDelegate = nil; webView.uiDelegate = nil
        webView.removeFromSuperview()
    }
}
