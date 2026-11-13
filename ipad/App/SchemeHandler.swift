import WebKit
import UniformTypeIdentifiers

/// aibrowser:, aibdict:, aibext:, aibzim: — served by the desktop protocol handlers in Node (src/main/main.js)
/// aibres:  — static payload served directly from the app bundle (aibres://app/...) or app data (aibres://data/...)
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    static let nodeSchemes = ["aibrowser", "aibdict", "aibext", "aibzim"]
    static let shared = SchemeHandler()
    private var live = Set<ObjectIdentifier>()
    private var tasks = [ObjectIdentifier: Host.SchemeRequest]()
    private let lock = NSLock()

    private func isLive(_ t: WKURLSchemeTask) -> Bool { lock.lock(); defer { lock.unlock() }; return live.contains(ObjectIdentifier(t)) }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else { return }
        let id = ObjectIdentifier(urlSchemeTask)
        lock.lock(); live.insert(id); lock.unlock()
        if url.scheme == "aibres" { serveStatic(url, urlSchemeTask); return }
        var hdrs = [String: String]()
        for (k, v) in urlSchemeTask.request.allHTTPHeaderFields ?? [:] { hdrs[k] = v }
        let isMain = urlSchemeTask.request.mainDocumentURL == url
        let task = Host.shared.scheme(url: url.absoluteString, method: urlSchemeTask.request.httpMethod ?? "GET", headers: hdrs, body: SchemeHandler.body(urlSchemeTask.request), mainDocument: isMain) { [weak self] status, headers, data in
            DispatchQueue.main.async {
                guard let self = self, self.isLive(urlSchemeTask) else { return }
                var h = headers
                if h["Content-Type"] == nil && h["content-type"] == nil { h["Content-Type"] = SchemeHandler.mime(url.path) }
                h["Content-Length"] = String(data.count)
                let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: h)!
                urlSchemeTask.didReceive(resp)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
                self.finish(urlSchemeTask)
            }
        }
        lock.lock(); tasks[id] = task; lock.unlock()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let id = ObjectIdentifier(urlSchemeTask)
        lock.lock(); live.remove(id); let t = tasks.removeValue(forKey: id); lock.unlock()
        t?.cancel()
    }
    /// WebKit hands POST bodies of fetch() / XHR to scheme handlers as a stream, not as httpBody
    static func body(_ r: URLRequest) -> Data? {
        if let b = r.httpBody { return b }
        guard let s = r.httpBodyStream else { return nil }
        s.open(); defer { s.close() }
        var out = Data(); var buf = [UInt8](repeating: 0, count: 64 * 1024)
        while s.hasBytesAvailable { let n = s.read(&buf, maxLength: buf.count); if n <= 0 { break }; out.append(buf, count: n) }
        return out
    }
    private func finish(_ t: WKURLSchemeTask) { let id = ObjectIdentifier(t); lock.lock(); live.remove(id); tasks.removeValue(forKey: id); lock.unlock() }

    private func serveStatic(_ url: URL, _ task: WKURLSchemeTask) {
        let rel = url.path.removingPercentEncoding ?? url.path
        let root: URL = url.host == "data" ? Paths.userData : Paths.payload.appendingPathComponent(url.host == "app" ? "web" : "web", isDirectory: true)
        // aibres://app/pyodide/... and aibres://app/vm/... live next to web/ in the payload
        var file = root.appendingPathComponent(String(rel.drop(while: { $0 == "/" })))
        if url.host == "app" {
            let first = rel.split(separator: "/").first.map(String.init) ?? ""
            if ["pyodide", "vm"].contains(first) { file = Paths.payload.appendingPathComponent(String(rel.drop(while: { $0 == "/" }))) }
        }
        var std = file.standardizedFileURL.path
        var okRoot = url.host == "data" ? Paths.userData.standardizedFileURL.path : Paths.payload.standardizedFileURL.path
        // graphical VM image: blobs that are not in the bundled base image were downloaded to userData/vm-gui/fs/
        if url.host == "app", rel.hasPrefix("/vm/fs/"), !FileManager.default.fileExists(atPath: std) {
            let alt = Paths.userData.appendingPathComponent("vm-gui/fs").appendingPathComponent(file.lastPathComponent).standardizedFileURL.path
            if FileManager.default.fileExists(atPath: alt) { std = alt; okRoot = Paths.userData.standardizedFileURL.path }
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let data = std.hasPrefix(okRoot) ? (try? Data(contentsOf: URL(fileURLWithPath: std), options: .alwaysMapped)) : nil
            DispatchQueue.main.async {
                guard self.isLive(task) else { return }
                let code = data == nil ? 404 : 200
                let body = data ?? Data("Not found".utf8)
                let resp = HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: [
                    "Content-Type": data == nil ? "text/plain" : SchemeHandler.mime(std), "Content-Length": String(body.count),
                    "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache",
                    "Cross-Origin-Resource-Policy": "cross-origin"])!
                task.didReceive(resp); task.didReceive(body); task.didFinish()
                self.finish(task)
            }
        }
    }

    static func mime(_ path: String) -> String {
        let ext = (path as NSString).pathExtension.lowercased()
        let table: [String: String] = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
                                       "json": "application/json", "wasm": "application/wasm", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                                       "gif": "image/gif", "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "txt": "text/plain; charset=utf-8", "zip": "application/zip",
                                       "whl": "application/zip", "tar": "application/x-tar", "data": "application/octet-stream", "bin": "application/octet-stream", "mp3": "audio/mpeg", "ogg": "audio/ogg"]
        if let m = table[ext] { return m }
        if let t = UTType(filenameExtension: ext), let m = t.preferredMIMEType { return m }
        return "application/octet-stream"
    }
}
