import Foundation
import UIKit

/// Client side of the loopback bridge to the embedded Node.js main process (see ipad/node/host.js).
///
/// Robustness (2.3.0): iPadOS suspends the app in the background and may reclaim its sockets (TN2277), which used to
/// leave every page showing "bridge error" after the app had been away for a while.
/// - The command stream sends `Last-Event-ID`, so Node replays what was missed; ids already seen are ignored.
/// - A watchdog reconnects a stream that has been silent for 45 s (Node sends a keep-alive every 15 s).
/// - Coming back to the foreground drops pooled connections, asks Node to reopen its listening socket (wake file) and
///   reconnects the stream at once.
/// - Requests that fail because the connection could not be made are retried for a few seconds instead of failing.
/// - Stream callbacks run on a serial queue (a concurrent queue could interleave chunks and lose commands).
final class Host: NSObject, URLSessionDataDelegate {
    static let shared = Host()
    private(set) var port = 0
    private(set) var token = ""
    private var base: URL { URL(string: "http://127.0.0.1:\(port)")! }
    private var session: URLSession = Host.makeSession()
    private static func makeSession() -> URLSession {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 24 * 3600
        c.timeoutIntervalForResource = 7 * 24 * 3600
        c.httpMaximumConnectionsPerHost = 64
        c.connectionProxyDictionary = [:]
        c.waitsForConnectivity = false
        return URLSession(configuration: c, delegate: nil, delegateQueue: nil)
    }
    private var streamSession: URLSession?
    private var streamTask: URLSessionDataTask?
    private let streamQueue: OperationQueue = { let q = OperationQueue(); q.maxConcurrentOperationCount = 1; q.name = "aib.host.stream"; return q }()
    private var streamBuf = Data()
    private var connected = false
    private var lastEventId = 0
    private var lastDataAt = Date()
    private var watchdog: Timer?
    private var reconnectPending = false
    var onCommand: (([String: Any]) -> Void)?
    var onConnected: (() -> Void)?
    /// called on every (re)connection of the stream, also after the first one
    var onReconnected: (() -> Void)?
    private var attempts = 0
    private var startedAt = Date()
    private(set) var reconnects = 0
    static var wakeFile: URL { Paths.tmp.appendingPathComponent("aib-wake") }

    func start() {
        port = NodeRuntime.freePort()
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        token = bytes.map { String(format: "%02x", $0) }.joined()
        startedAt = Date()
        NodeRuntime.start(port: port, token: token)
        StartupLog.log("连接 http://127.0.0.1:\(port)/host/events")
        connectStream()
        watchdog = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in self?.checkStream() }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // ---- lifecycle: back from the background
    private var backgroundedAt: Date?
    func didEnterBackground() { backgroundedAt = Date() }
    @objc private func willEnterForeground() { revive(reason: "回到前台") }
    @objc private func didBecomeActive() { if backgroundedAt != nil { backgroundedAt = nil; ping { ok in if !ok { self.revive(reason: "健康检查失败") } } } }
    /// Drop pooled connections, ask Node to reopen its listening socket and reconnect the command stream.
    func revive(reason: String) {
        guard port > 0, NodeRuntime.alive else { return }
        StartupLog.log("恢复内部连接：\(reason)")
        let old = session
        session = Host.makeSession()
        old.finishTasksAndInvalidate()
        // the wake file makes Node close and reopen its listening socket (it checks it every second)
        FileManager.default.createFile(atPath: Host.wakeFile.path, contents: Data("\(Date().timeIntervalSince1970)".utf8))
        streamQueue.addOperation { [weak self] in self?.streamTask?.cancel() }
    }
    /// GET /host/ping with a short timeout
    func ping(_ done: @escaping (Bool) -> Void) {
        var r = URLRequest(url: base.appendingPathComponent("host/ping"))
        r.setValue(token, forHTTPHeaderField: "X-AIB-Token")
        r.timeoutInterval = 4
        session.dataTask(with: r) { data, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200 && data != nil
            DispatchQueue.main.async { done(ok) }
        }.resume()
    }
    private func checkStream() {
        guard connected, NodeRuntime.alive, UIApplication.shared.applicationState != .background else { return }
        streamQueue.addOperation { [weak self] in
            guard let self = self else { return }
            if Date().timeIntervalSince(self.lastDataAt) > 45 {
                StartupLog.log("事件流 45 秒无数据，重新连接")
                self.streamTask?.cancel()
            }
        }
    }

    // ---- Node -> Swift command stream (Server-Sent Events)
    private func connectStream() {
        streamQueue.addOperation { [weak self] in
            guard let self = self else { return }
            self.reconnectPending = false
            let c = URLSessionConfiguration.ephemeral
            c.timeoutIntervalForRequest = 7 * 24 * 3600
            c.timeoutIntervalForResource = 365 * 24 * 3600
            c.connectionProxyDictionary = [:]
            self.streamSession?.invalidateAndCancel()
            let s = URLSession(configuration: c, delegate: self, delegateQueue: self.streamQueue)
            self.streamSession = s
            var r = URLRequest(url: self.base.appendingPathComponent("host/events"))
            r.setValue(self.token, forHTTPHeaderField: "X-AIB-Token")
            if self.lastEventId > 0 { r.setValue(String(self.lastEventId), forHTTPHeaderField: "Last-Event-ID") }
            self.streamBuf = Data()
            self.attempts += 1
            self.lastDataAt = Date()
            let t = s.dataTask(with: r)
            self.streamTask = t
            t.resume()
        }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let ok = code == 200
        if !ok { StartupLog.log("事件流响应异常：HTTP \(code)") }
        if ok {
            lastDataAt = Date()
            if !connected {
                connected = true
                StartupLog.log("已连接 Node.js（第 \(attempts) 次尝试，\(String(format: "%.1f", Date().timeIntervalSince(startedAt))) 秒）")
                DispatchQueue.main.async { self.onConnected?() }
            } else {
                reconnects += 1
                StartupLog.log("事件流已重新连接（第 \(reconnects) 次，从事件 \(lastEventId) 之后继续）")
                DispatchQueue.main.async { self.onReconnected?() }
            }
        }
        completionHandler(ok ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard session === streamSession else { return }
        lastDataAt = Date()
        streamBuf.append(data)
        let sep = Data("\n\n".utf8)
        var start = streamBuf.startIndex
        var cmds = [[String: Any]]()
        while let r = streamBuf.range(of: sep, in: start..<streamBuf.endIndex) {
            let chunk = streamBuf.subdata(in: start..<r.lowerBound)
            start = r.upperBound
            guard let s = String(data: chunk, encoding: .utf8) else { continue }
            var payload = ""
            var id = 0
            for line in s.split(separator: "\n", omittingEmptySubsequences: false) {
                if line.hasPrefix("data: ") { payload += line.dropFirst(6) }
                else if line.hasPrefix("id: ") { id = Int(line.dropFirst(4)) ?? 0 }
            }
            if payload.isEmpty { continue }
            if id > 0 { if id <= lastEventId { continue } ; lastEventId = id }
            if let obj = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] { cmds.append(obj) }
            else { StartupLog.log("无法解析的命令（事件 \(id)，\(payload.utf8.count) 字节）") }
        }
        if start > streamBuf.startIndex { streamBuf.removeSubrange(streamBuf.startIndex..<start) }
        if !cmds.isEmpty { DispatchQueue.main.async { for c in cmds { self.onCommand?(c) } } }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard session === streamSession else { session.invalidateAndCancel(); return }
        // Node not listening yet (startup) or connection dropped: retry
        session.invalidateAndCancel()
        streamSession = nil
        if let e = error as NSError? {
            // log the first failures, then every 50th, and every drop of an established stream
            if connected || attempts <= 3 || attempts % 50 == 0 { StartupLog.log("事件流\(connected ? "断开" : "连接失败")（第 \(attempts) 次）：\(e.domain) \(e.code) \(e.localizedDescription)") }
        } else if connected { StartupLog.log("事件流已结束，重新连接") }
        guard NodeRuntime.alive, !reconnectPending else { return }
        reconnectPending = true
        let delay: Double = connected ? (attempts % 20 == 0 ? 2 : 0.3) : 0.15
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.connectStream() }
    }

    // ---- Swift -> Node
    private func request(_ path: String, json: Any?, body: Data? = nil, headers: [String: String] = [:]) -> URLRequest {
        var r = URLRequest(url: base.appendingPathComponent(path))
        r.httpMethod = "POST"
        r.setValue(token, forHTTPHeaderField: "X-AIB-Token")
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        if let j = json { r.httpBody = try? JSONSerialization.data(withJSONObject: Host.jsonSafe(j)); r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        else if let b = body { r.httpBody = b }
        return r
    }
    /// Transport errors where the request never reached Node (safe to send again).
    private static func notDelivered(_ e: Error?) -> Bool {
        guard let e = e as NSError?, e.domain == NSURLErrorDomain else { return false }
        return [NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost, NSURLErrorNotConnectedToInternet, NSURLErrorDNSLookupFailed].contains(e.code)
    }
    /// Errors after which an idempotent request may be sent again (stale pooled connection, timeout).
    private static func retryable(_ e: Error?) -> Bool {
        guard let e = e as NSError?, e.domain == NSURLErrorDomain else { return false }
        return notDelivered(e) || [NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut, NSURLErrorBadServerResponse, NSURLErrorZeroByteResource].contains(e.code)
    }
    private static let backoff: [Double] = [0.15, 0.3, 0.6, 1, 1.5, 2, 2, 2]
    /// Sends a request, retrying while the connection can not be made (and on any transport error when idempotent).
    @discardableResult
    private func send(_ r: URLRequest, idempotent: Bool, attempt: Int = 0, onTask: ((URLSessionDataTask) -> Void)? = nil, completion: @escaping (Data?, URLResponse?, Error?) -> Void) -> URLSessionDataTask {
        let t = session.dataTask(with: r) { [weak self] data, resp, err in
            guard let self = self else { return }
            if err != nil, (err as NSError?)?.code != NSURLErrorCancelled, attempt < Host.backoff.count, NodeRuntime.alive,
               Host.notDelivered(err) || (idempotent && Host.retryable(err)) {
                if attempt == 1 { DispatchQueue.main.async { self.revive(reason: "请求失败：\((err as NSError?)?.code ?? 0)") } }
                DispatchQueue.global().asyncAfter(deadline: .now() + Host.backoff[attempt]) {
                    let nt = self.send(r, idempotent: idempotent, attempt: attempt + 1, onTask: onTask, completion: completion)
                    onTask?(nt)
                }
                return
            }
            completion(data, resp, err)
        }
        t.resume()
        return t
    }
    func post(_ path: String, _ json: Any, idempotent: Bool = false, completion: ((Any?) -> Void)? = nil) {
        send(request(path, json: json), idempotent: idempotent) { data, _, _ in
            let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0, options: [.fragmentsAllowed]) }
            if let c = completion { DispatchQueue.main.async { c(obj) } }
        }
    }
    /// Event to Node. `answer` receives the synchronous reply some events need (new-window, will-download, key).
    func event(_ m: [String: Any], answer: ((Any?) -> Void)? = nil) {
        // state notifications (navstate, title, progress …) can be sent twice safely
        let name = m["name"] as? String ?? ""
        let idem = ["navstate", "title", "start", "stop", "favicon", "focus", "blur", "found"].contains(name) || (m["type"] as? String) == "window" || (m["phase"] as? String) == "progress"
        post("host/event", m, idempotent: idem) { r in answer?((r as? [String: Any])?["answer"]) }
    }
    func reply(_ seq: Int, ok: Bool = true, result: Any? = nil, error: String? = nil) {
        guard seq > 0 else { return }
        var m: [String: Any] = ["seq": seq, "ok": ok]
        if let r = result { m["result"] = r }
        if let e = error { m["error"] = e }
        post("host/reply", m, idempotent: true) // Node ignores a reply for a seq it no longer waits for
    }
    func partial(_ seq: Int, _ p: [String: Any]) { post("host/reply", ["seq": seq, "partial": p]) }
    func invoke(_ m: [String: Any], completion: @escaping (Any?) -> Void) { post("ipc/invoke", m, completion: completion) }
    func send(_ m: [String: Any]) { post("ipc/send", m) }

    /// Custom-scheme request served by the Node protocol handlers (aibrowser:, aibdict:, aibext:, aibzim:)
    final class SchemeRequest { var task: URLSessionDataTask?; var cancelled = false; func cancel() { cancelled = true; task?.cancel() } }
    func scheme(url: String, method: String, headers: [String: String], body: Data?, mainDocument: Bool = false, completion: @escaping (Int, [String: String], Data) -> Void) -> SchemeRequest {
        let meta = (try? JSONSerialization.data(withJSONObject: ["url": url, "method": method, "headers": headers])).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let r = request("scheme", json: nil, body: body ?? Data(), headers: ["X-AIB-Meta": meta])
        let handle = SchemeRequest()
        let idem = method == "GET" || method == "HEAD"
        handle.task = send(r, idempotent: idem, onTask: { [weak handle] t in if handle?.cancelled == true { t.cancel() } else { handle?.task = t } }) { data, resp, err in
            guard let h = resp as? HTTPURLResponse, err == nil else {
                if (err as NSError?)?.code != NSURLErrorCancelled { StartupLog.log("页面请求失败 \(url)：\(err.map { String(describing: $0) } ?? "无响应")") }
                if mainDocument {
                    completion(503, ["Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"], Data(Host.reconnectPage.utf8))
                } else {
                    completion(502, ["Content-Type": "text/plain; charset=utf-8"], Data("内部服务暂时无法连接".utf8))
                }
                return
            }
            var hdrs = [String: String]()
            for (k, v) in h.allHeaderFields { if let ks = k as? String, let vs = v as? String, ks.lowercased() != "x-aib-status", ks.lowercased() != "content-length", ks.lowercased() != "connection", ks.lowercased() != "keep-alive", ks.lowercased() != "transfer-encoding" { hdrs[ks] = vs } }
            let st = Int(h.value(forHTTPHeaderField: "X-AIB-Status") ?? "200") ?? 200
            completion(st, hdrs, data ?? Data())
        }
        return handle
    }
    /// Shown instead of a page while the internal service can not be reached; it reloads itself when it is back.
    static let reconnectPage = """
    <!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font:16px -apple-system,sans-serif;color:#9aa6a2;background:transparent}
    .b{text-align:center}.s{width:28px;height:28px;margin:0 auto 14px;border:3px solid rgba(127,127,127,.3);border-top-color:#5fb99a;border-radius:50%;animation:r 1s linear infinite}
    @keyframes r{to{transform:rotate(360deg)}}button{margin-top:14px;font:inherit;padding:8px 18px;border-radius:8px;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit}</style></head>
    <body><div class="b"><div class="s"></div><div>正在重新连接内部服务……</div><button onclick="location.reload()">立即重试</button></div>
    <script>var n=0;setInterval(function(){n++;if(n<=40)location.reload()},1500)</script></body></html>
    """

    /// JSONSerialization rejects some Foundation values; make results JSON-safe.
    static func jsonSafe(_ v: Any) -> Any {
        switch v {
        case let d as [String: Any]: return d.mapValues { jsonSafe($0) }
        case let a as [Any]: return a.map { jsonSafe($0) }
        case let s as String: return s
        case let n as NSNumber: return n.doubleValue.isFinite ? n : NSNull()
        case let d as Date: return ISO8601DateFormatter().string(from: d)
        case let u as URL: return u.absoluteString
        case let d as Data: return ["__aibBytes": d.base64EncodedString()]
        case is NSNull: return NSNull()
        default: return String(describing: v)
        }
    }
}
