import Foundation

enum Paths {
    static let fm = FileManager.default
    /// Electron userData (settings, history, models, dictionaries, ZIM files, VM state). Not shown in the Files app.
    static var userData: URL {
        let u = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("AIBrowser", isDirectory: true)
        try? fm.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }
    /// Documents: downloads, exports and the Linux shared folder (visible in the Files app).
    static var documents: URL { fm.urls(for: .documentDirectory, in: .userDomainMask)[0] }
    static var tmp: URL { URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true) }
    /// Payload assembled by scripts/build-ipad-bundle.js (nodejs-project, web, pyodide, vm)
    static var payload: URL { Bundle.main.resourceURL!.appendingPathComponent("aibapp", isDirectory: true) }
    static var nodeProject: URL { payload.appendingPathComponent("nodejs-project", isDirectory: true) }
}
