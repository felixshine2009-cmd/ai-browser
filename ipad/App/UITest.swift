import UIKit
import WebKit

/// iOS Simulator test hooks (CI job "ios-sim-test", ipad/UITests). Active only when the app is launched with -AIBUITest.
///
/// A small panel of buttons starts every file import entry of the Node core through the same native path the pages use
/// (ipc invoke -> Node -> dialog.open -> UIDocumentPickerViewController -> documentPicker(_:didPickDocumentsAt:)).
/// With AIB_UITEST_AUTOFEED=<seconds> the presented picker is answered with fixture files after that delay, the way the
/// system answers it (files as local copies, a folder as an opened-in-place URL), so the real Swift copy code and the Node
/// import run. Without it the UI test selects the files in the real Files picker.
@MainActor
enum UITest {
    static let enabled = ProcessInfo.processInfo.arguments.contains("-AIBUITest")
    static var autoFeed: Double? { ProcessInfo.processInfo.environment["AIB_UITEST_AUTOFEED"].flatMap(Double.init) }
    static var fixtures: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("uitest", isDirectory: true) }
    private static weak var host: BrowserViewController?
    private static let status = UILabel(), events = UILabel(), result = UILabel()
    private static var eventList = [String]()

    struct Entry { let id: String; let title: String; let channel: String; let args: [Any] }
    static let entries: [Entry] = [
        Entry(id: "dictFiles", title: "词典文件", channel: "ext:rpc", args: ["aib.dictionary", "pickAndAdd", [String: Any]()]),
        Entry(id: "dictFolder", title: "词典文件夹", channel: "ext:rpc", args: ["aib.dictionary", "pickAndAdd", [String: Any]()]),
        Entry(id: "zim", title: "ZIM", channel: "wiki:openZim", args: []),
        Entry(id: "image", title: "系统镜像", channel: "vmimg:import", args: []),
        Entry(id: "model", title: "模型", channel: "lm:pick", args: []),
        Entry(id: "kb", title: "资料文件", channel: "kb:addFiles", args: []),
        Entry(id: "extzip", title: "拓展 zip", channel: "ext:installZip", args: []),
        Entry(id: "csv", title: "密码 CSV", channel: "pw:import", args: []),
        Entry(id: "photo", title: "照片", channel: "camera:capture", args: [["source": "library"]]),
    ]

    static func event(_ e: String) {
        eventList.append(e)
        events.text = eventList.suffix(12).joined(separator: " ")
        events.accessibilityValue = events.text
        NSLog("[aib-uitest] event \(e)")
    }

    /// The main window exists: seed fixtures (fallback when CI did not put them into Documents) and show the panel.
    static func windowReady(_ vc: BrowserViewController) {
        guard host == nil else { return }
        host = vc
        let fm = FileManager.default
        if !fm.fileExists(atPath: fixtures.path), let src = ProcessInfo.processInfo.environment["AIB_UITEST_FIXTURES"], fm.fileExists(atPath: src) {
            try? fm.copyItem(at: URL(fileURLWithPath: src), to: fixtures)
        }
        let panel = UIStackView()
        panel.axis = .vertical; panel.spacing = 4; panel.alignment = .trailing
        panel.translatesAutoresizingMaskIntoConstraints = false
        panel.accessibilityIdentifier = "uitest.panel"
        for (l, id) in [(status, "uitest.status"), (events, "uitest.events"), (result, "uitest.result")] {
            l.font = .monospacedSystemFont(ofSize: 10, weight: .regular); l.numberOfLines = 3; l.textColor = .label
            l.backgroundColor = UIColor.systemBackground.withAlphaComponent(0.85)
            l.accessibilityIdentifier = id; l.isAccessibilityElement = true
            panel.addArrangedSubview(l)
        }
        for e in entries {
            var c = UIButton.Configuration.filled(); c.title = e.title; c.buttonSize = .mini
            let b = UIButton(configuration: c, primaryAction: UIAction { _ in run(e) })
            b.accessibilityIdentifier = "uitest.import.\(e.id)"
            panel.addArrangedSubview(b)
        }
        // glass tool popover (v3.0.1): open it through the chrome page's own button, and read which tool is open
        for (title, id, act) in [("工具面板", "uitest.tools.open", { openTools() }), ("工具状态", "uitest.tools.state", { toolState() })] as [(String, String, () -> Void)] {
            var c = UIButton.Configuration.filled(); c.title = title; c.buttonSize = .mini
            let b = UIButton(configuration: c, primaryAction: UIAction { _ in act() })
            b.accessibilityIdentifier = id
            panel.addArrangedSubview(b)
        }
        vc.view.addSubview(panel)
        NSLayoutConstraint.activate([
            panel.trailingAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.trailingAnchor, constant: -8),
            panel.bottomAnchor.constraint(equalTo: vc.view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            panel.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
        ])
        // ready once the Node core answers an invoke
        func probe(_ n: Int) {
            Host.shared.invoke(["wcId": vc.windowHostId, "channel": "tabs:state", "args": [Any](), "url": "aibrowser://chrome/"]) { r in
                if ((r as? [String: Any])?["ok"] as? Bool) == true { setStatus("ready") }
                else if n < 120 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { probe(n + 1) } }
                else { setStatus("node-unavailable") }
            }
        }
        setStatus("starting")
        probe(0)
    }
    private static func setStatus(_ s: String) { status.text = s; status.accessibilityValue = s; NSLog("[aib-uitest] status \(s)") }

    static func run(_ e: Entry) {
        guard let vc = host else { return }
        current = e.id
        result.text = "running \(e.id)"; result.accessibilityValue = result.text
        event("start:\(e.id)")
        Host.shared.invoke(["wcId": vc.windowHostId, "channel": e.channel, "args": e.args.map { Host.jsonSafe($0) }, "url": "aibrowser://settings/"]) { r in
            let d = r as? [String: Any] ?? [:]
            let ok = (d["ok"] as? Bool) == true
            let v = d["result"]
            let pass = ok && verdict(e.id, v)
            var json = (v.flatMap { try? JSONSerialization.data(withJSONObject: Host.jsonSafe($0), options: [.fragmentsAllowed]) }).flatMap { String(data: $0, encoding: .utf8) } ?? String(describing: d["error"] ?? "nil")
            if json.count > 240 { json = String(json.prefix(240)) + "…" }
            let text = "\(pass ? "PASS" : "FAIL") \(e.id) \(json)"
            result.text = text; result.accessibilityValue = text
            event("done:\(e.id):\(pass ? "pass" : "fail")")
            NSLog("[aib-uitest] result \(text)")
        }
    }
    private static var current = ""

    /// Clicks the toolbar's glass tool button in the chrome page (the same JavaScript path as a tap on it).
    static func openTools() {
        guard let vc = host, let w = vc.windowWebView else { return }
        event("open:tools")
        w.evaluateJavaScript("(() => { const b = document.getElementById('toolglass'); if (!b) return 'missing'; b.click(); return 'clicked'; })()", in: nil, in: .page) { r in
            if case .success(let v) = r { event("toolglass:\(v ?? "nil")") } else { event("toolglass:error") }
        }
    }
    /// result = "tool:<active tool id or none>" from the Node core's tab state.
    static func toolState() {
        guard let vc = host else { return }
        Host.shared.invoke(["wcId": vc.windowHostId, "channel": "tabs:state", "args": [Any](), "url": "aibrowser://chrome/"]) { r in
            let st = (r as? [String: Any])?["result"] as? [String: Any]
            let t = (st?["activeTool"] as? String) ?? "none"
            result.text = "tool:\(t)"; result.accessibilityValue = result.text
        }
    }
    private static func verdict(_ id: String, _ v: Any?) -> Bool {
        let d = v as? [String: Any]
        switch id {
        case "dictFiles", "dictFolder": return ((d?["added"] as? [Any])?.count ?? 0) > 0
        case "zim": return d != nil && (d?["cancelled"] as? Bool) != true
        case "image": return (d?["ok"] as? Bool) == true
        case "model": return ((v as? String) ?? "").hasSuffix(".gguf")
        case "kb": return (((d?["results"] as? [[String: Any]])?.first?["file"] as? String) ?? "").hasSuffix("notes.txt") // the file reached the knowledge base (embedding may be unavailable)
        case "extzip": return d != nil
        case "csv": return v != nil && !(v is NSNull)
        case "photo": return ((d?["dataUrl"] as? String) ?? "").hasPrefix("data:image")
        default: return false
        }
    }

    /// The Files picker is on screen.
    static func pickerPresented(_ vc: BrowserViewController, picker: UIDocumentPickerViewController, folder: Bool, filters: [[String: Any]]) {
        event(folder ? "picker:folder" : "picker:files")
        guard let delay = autoFeed else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard picker.presentingViewController != nil else { return } // answered or cancelled meanwhile
            let urls = feed(folder: folder, filters: filters)
            event("feed:\(urls.count)")
            picker.dismiss(animated: true) {
                if urls.isEmpty { vc.documentPickerWasCancelled(picker) } else { vc.documentPicker(picker, didPickDocumentsAt: urls) }
            }
        }
    }
    /// What the system would hand over: a folder opened in place, or local copies of the matching files.
    private static func feed(folder: Bool, filters: [[String: Any]]) -> [URL] {
        let fm = FileManager.default
        if folder { let u = fixtures.appendingPathComponent("dictfolder", isDirectory: true); return fm.fileExists(atPath: u.path) ? [u] : [] }
        var exts = Set<String>()
        for f in filters { for e in (f["extensions"] as? [String]) ?? [] { exts.insert(e.lowercased()) } }
        let dir = fixtures.appendingPathComponent("files", isDirectory: true)
        let names = ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? []).sorted()
        // a dictionary pick takes the .mdx with its resources; other entries take one file of their type
        var chosen = names.filter { exts.contains(($0 as NSString).pathExtension.lowercased()) }
        if !exts.contains("mdx") { chosen = Array(chosen.prefix(1)) }
        let inbox = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("uitest-inbox/\(UUID().uuidString.prefix(8))", isDirectory: true)
        try? fm.createDirectory(at: inbox, withIntermediateDirectories: true)
        return chosen.compactMap { n in
            let d = inbox.appendingPathComponent(n)
            return (try? fm.copyItem(at: dir.appendingPathComponent(n), to: d)) != nil ? d : nil
        }
    }

    /// The photo library picker is on screen (camera:capture with source "library").
    static func imagePickerPresented(_ answer: @escaping (UIImage?) -> Void) {
        event("picker:photo")
        guard let delay = autoFeed else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            let img = UIImage(contentsOfFile: fixtures.appendingPathComponent("files/photo.png").path)
            event("feed:\(img == nil ? 0 : 1)")
            answer(img)
        }
    }
}
