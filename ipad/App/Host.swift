import Foundation

/// Client side of the loopback bridge to the embedded Node.js main process (see ipad/node/host.js).
final class Host: NSObject, URLSessionDataDelegate {
    static let shared = Host()
    private(set) var port = 0
    private(set) var token = ""
    private var base: URL { URL(string: "http://127.0.0.1:\(port)")! }
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 24 * 3600
        c.timeoutIntervalForResource = 7 * 24 * 3600
        c.httpMaximumConnectionsPerHost = 64
        c.connectionProxyDictionary = [:]
        return URLSession(configuration: c, delegate: nil, delegateQueue: nil)
    }()
    private var streamSession: URLSession?
    private var streamBuf = Data()
    private var connected = false
    var onCommand: (([String: Any]) -> Void)?
    var onConnected: (() -> Void)?

    func start() {
        port = NodeRuntime.freePort()
        var bytes = [UInt8](repeating: 0, count: 24)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        token = bytes.map { String(format: "%02x", $0) }.joined()
        NodeRuntime.start(port: port, token: token)
        connectStream()
    }

    // ---- Node -> Swift command stream (Server-Sent Events)
    private func connectStream() {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 7 * 24 * 3600
        c.timeoutIntervalForResource = 365 * 24 * 3600
        c.connectionProxyDictionary = [:]
        streamSession = URLSession(configuration: c, delegate: self, delegateQueue: OperationQueue())
        var r = URLRequest(url: base.appendingPathComponent("host/events"))
        r.setValue(token, forHTTPHeaderField: "X-AIB-Token")
        streamBuf = Data()
        streamSession!.dataTask(with: r).resume()
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let ok = (response as? HTTPURLResponse)?.statusCode == 200
        if ok && !connected { connected = true; DispatchQueue.main.async { self.onConnected?() } }
        completionHandler(ok ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        streamBuf.append(data)
        let sep = Data("\n\n".utf8)
        while let r = streamBuf.range(of: sep) {
            let chunk = streamBuf.subdata(in: streamBuf.startIndex..<r.lowerBound)
            streamBuf.removeSubrange(streamBuf.startIndex..<r.upperBound)
            guard let s = String(data: chunk, encoding: .utf8) else { continue }
            var payload = ""
            for line in s.split(separator: "\n", omittingEmptySubsequences: false) where line.hasPrefix("data: ") { payload += line.dropFirst(6) }
            if payload.isEmpty { continue }
            if let obj = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] {
                DispatchQueue.main.async { self.onCommand?(obj) }
            }
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Node not listening yet (startup) or connection dropped: retry
        session.invalidateAndCancel()
        DispatchQueue.main.asyncAfter(deadline: .now() + (connected ? 0.5 : 0.15)) { self.connectStream() }
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
    func post(_ path: String, _ json: Any, completion: ((Any?) -> Void)? = nil) {
        session.dataTask(with: request(path, json: json)) { data, _, _ in
            let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0, options: [.fragmentsAllowed]) }
            if let c = completion { DispatchQueue.main.async { c(obj) } }
        }.resume()
    }
    /// Event to Node. `answer` receives the synchronous reply some events need (new-window, will-download, key).
    func event(_ m: [String: Any], answer: ((Any?) -> Void)? = nil) {
        post("host/event", m) { r in answer?((r as? [String: Any])?["answer"]) }
    }
    func reply(_ seq: Int, ok: Bool = true, result: Any? = nil, error: String? = nil) {
        guard seq > 0 else { return }
        var m: [String: Any] = ["seq": seq, "ok": ok]
        if let r = result { m["result"] = r }
        if let e = error { m["error"] = e }
        post("host/reply", m)
    }
    func partial(_ seq: Int, _ p: [String: Any]) { post("host/reply", ["seq": seq, "partial": p]) }
    func invoke(_ m: [String: Any], completion: @escaping (Any?) -> Void) { post("ipc/invoke", m, completion: completion) }
    func send(_ m: [String: Any]) { post("ipc/send", m) }

    /// Custom-scheme request served by the Node protocol handlers (aibrowser:, aibdict:, aibext:, aibzim:)
    func scheme(url: String, method: String, headers: [String: String], body: Data?, completion: @escaping (Int, [String: String], Data) -> Void) -> URLSessionDataTask {
        let meta = (try? JSONSerialization.data(withJSONObject: ["url": url, "method": method, "headers": headers])).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let r = request("scheme", json: nil, body: body ?? Data(), headers: ["X-AIB-Meta": meta])
        let t = session.dataTask(with: r) { data, resp, err in
            guard let h = resp as? HTTPURLResponse, err == nil else { completion(502, ["Content-Type": "text/plain"], Data("bridge error".utf8)); return }
            var hdrs = [String: String]()
            for (k, v) in h.allHeaderFields { if let ks = k as? String, let vs = v as? String, ks.lowercased() != "x-aib-status", ks.lowercased() != "content-length", ks.lowercased() != "connection", ks.lowercased() != "keep-alive", ks.lowercased() != "transfer-encoding" { hdrs[ks] = vs } }
            let st = Int(h.value(forHTTPHeaderField: "X-AIB-Status") ?? "200") ?? 200
            completion(st, hdrs, data ?? Data())
        }
        t.resume()
        return t
    }

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
