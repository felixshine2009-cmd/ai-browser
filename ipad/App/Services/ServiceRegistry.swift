import UIKit

/// Swift service layer (v3). Every native capability the Node core can call is a `NativeService` that owns one command
/// prefix (`native.<name>`). Services are registered once; BrowserViewController routes `native.*` commands here.
/// Later versions move Node modules to Swift one at a time by adding a service with the same command contract
/// (see docs/ipad-swift-migration.md), so the JavaScript callers do not change.
@MainActor
protocol NativeService: AnyObject {
    /// command names handled, e.g. ["native.haptic"]
    var commands: [String] { get }
    func handle(_ cmd: String, _ m: [String: Any], ctx: ServiceContext, ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void)
}

/// What a service may use from the host: the presenting controller and the source view for popovers.
@MainActor
struct ServiceContext {
    let controller: UIViewController
    let top: UIViewController
    let sourceView: UIView
}

@MainActor
final class ServiceRegistry {
    static let shared = ServiceRegistry()
    private var byCommand = [String: NativeService]()
    private var services = [NativeService]()

    private init() {
        register(NativeServices.shared) // camera, Vision OCR, QR, PDF text (2.3.0)
        register(HapticsService())
        register(ShareService())
        register(CapabilitiesService())
    }
    func register(_ s: NativeService) {
        services.append(s)
        for c in s.commands { byCommand[c] = s }
    }
    var commandList: [String] { Array(byCommand.keys).sorted() }
    /// false when no service owns the command
    func handle(_ cmd: String, _ m: [String: Any], ctx: ServiceContext, ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void) -> Bool {
        guard let s = byCommand[cmd] else { return false }
        s.handle(cmd, m, ctx: ctx, ok: ok, fail: fail)
        return true
    }
}

/// Typed access to the Node core from Swift: calls the same IPC handlers the pages use (ipcMain.handle channels),
/// with the window as the sender. This is the bridge native UI (the glass toolbar) is built on.
@MainActor
final class NodeBridge {
    static let shared = NodeBridge()
    var senderId: () -> Int = { 0 }
    func invoke(_ channel: String, _ args: [Any] = [], completion: ((Any?) -> Void)? = nil) {
        let m: [String: Any] = ["wcId": senderId(), "channel": channel, "args": args.map { Host.jsonSafe($0) }, "url": "aibrowser://chrome/"]
        Host.shared.invoke(m) { r in
            let d = r as? [String: Any]
            completion?((d?["ok"] as? Bool) == true ? d?["result"] : nil)
        }
    }
}

// ---------------------------------------------------------------- small services
@MainActor
final class HapticsService: NativeService {
    let commands = ["native.haptic"]
    func handle(_ cmd: String, _ m: [String: Any], ctx: ServiceContext, ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void) {
        Haptics.play(m["kind"] as? String ?? "light"); ok(true)
    }
}
@MainActor
enum Haptics {
    static func play(_ kind: String) {
        switch kind {
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "select": UISelectionFeedbackGenerator().selectionChanged()
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }
}

@MainActor
final class ShareService: NativeService {
    let commands = ["native.share"]
    func handle(_ cmd: String, _ m: [String: Any], ctx: ServiceContext, ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void) {
        var items = [Any]()
        if let t = m["text"] as? String, !t.isEmpty { items.append(t) }
        if let u = m["url"] as? String, let url = URL(string: u) { items.append(url) }
        if let p = m["path"] as? String, FileManager.default.fileExists(atPath: p) { items.append(URL(fileURLWithPath: p)) }
        guard !items.isEmpty else { fail("没有可分享的内容"); return }
        ShareService.present(items, from: ctx, rect: nil) { done in ok(["completed": done]) }
    }
    static func present(_ items: [Any], from ctx: ServiceContext, rect: CGRect?, done: ((Bool) -> Void)? = nil) {
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        vc.completionWithItemsHandler = { _, completed, _, _ in done?(completed) }
        if let pop = vc.popoverPresentationController {
            pop.sourceView = ctx.sourceView
            pop.sourceRect = rect ?? CGRect(x: ctx.sourceView.bounds.midX, y: 60, width: 1, height: 1)
        }
        ctx.top.present(vc, animated: true)
    }
}

/// Which native services and design features this build has (for the pages and the Node core).
@MainActor
final class CapabilitiesService: NativeService {
    let commands = ["native.capabilities"]
    func handle(_ cmd: String, _ m: [String: Any], ctx: ServiceContext, ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void) {
        ok(["services": ServiceRegistry.shared.commandList, "liquidGlass": Glass.isLiquidGlass, "nativeChrome": true, "os": UIDevice.current.systemVersion])
    }
}
