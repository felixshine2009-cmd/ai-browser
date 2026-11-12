import Foundation

/// Runs the embedded Node.js (nodejs-mobile) on its own thread. node_start() never returns while Node is alive.
enum NodeRuntime {
    private static var started = false
    /// false once node_start() has returned (Node can not be started twice in one process)
    static private(set) var alive = false

    static func start(port: Int, token: String) {
        guard !started else { return }
        started = true
        alive = true
        let script = Paths.nodeProject.appendingPathComponent("main-ipad.js").path
        StartupLog.log("资源目录：\(Paths.payload.path)")
        StartupLog.log("main-ipad.js \(FileManager.default.fileExists(atPath: script) ? "存在" : "缺失！")；userData：\(Paths.userData.path)")
        StartupLog.log("启动 Node.js（端口 \(port)）")
        let args = ["node", script,
                    "--port", String(port), "--token", token,
                    "--userdata", Paths.userData.path, "--documents", Paths.documents.path,
                    "--tmp", Paths.tmp.path, "--resources", Paths.payload.path]
        let t = Thread {
            // nodejs-mobile requires argv strings to be contiguous in memory
            let total = args.reduce(0) { $0 + $1.utf8.count + 1 }
            let buf = UnsafeMutablePointer<CChar>.allocate(capacity: total)
            var argv = [UnsafeMutablePointer<CChar>?]()
            var off = 0
            for a in args {
                let p = buf + off
                a.withCString { src in _ = strcpy(p, src) }
                argv.append(p)
                off += a.utf8.count + 1
            }
            argv.append(nil)
            let code = argv.withUnsafeMutableBufferPointer { ptr in node_start(Int32(args.count), ptr.baseAddress) }
            NodeRuntime.alive = false
            StartupLog.log("Node.js 已退出，退出码 \(code)")
            DispatchQueue.main.async { NotificationCenter.default.post(name: .aibNodeExited, object: nil, userInfo: ["code": Int(code)]) }
        }
        t.name = "nodejs"
        t.stackSize = 8 * 1024 * 1024
        t.start()
    }

    /// A free loopback TCP port.
    static func freePort() -> Int {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        addr.sin_port = 0
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) } }
        _ = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) } }
        return Int(UInt16(bigEndian: addr.sin_port))
    }
}

extension Notification.Name { static let aibNodeExited = Notification.Name("aibNodeExited") }
