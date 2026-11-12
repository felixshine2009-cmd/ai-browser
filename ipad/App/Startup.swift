import UIKit

/// Startup log: Documents/日志/startup.log, readable in the Files app (On My iPad → AI 浏览器 → 日志).
/// Node writes Documents/日志/node.log next to it (ipad/node/main-ipad.js).
enum StartupLog {
    private static let q = DispatchQueue(label: "aib.startuplog")
    private static let t0 = Date()
    static var dir: URL {
        let d = Paths.documents.appendingPathComponent("日志", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    static var file: URL { dir.appendingPathComponent("startup.log") }
    static var nodeFile: URL { dir.appendingPathComponent("node.log") }
    private static let fmt: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()

    /// Starts a new section for this launch; keeps the previous launches up to ~1 MB.
    static func begin() {
        q.sync {
            let f = file
            if let a = try? FileManager.default.attributesOfItem(atPath: f.path), let s = a[.size] as? Int, s > 1_000_000 {
                try? FileManager.default.removeItem(at: f.appendingPathExtension("1"))
                try? FileManager.default.moveItem(at: f, to: f.appendingPathExtension("1"))
            }
        }
        let info = Bundle.main.infoDictionary ?? [:]
        log("==== 启动 AI 浏览器 \(info["CFBundleShortVersionString"] ?? "?") (\(info["CFBundleVersion"] ?? "?")) · iPadOS \(UIDevice.current.systemVersion) · \(UIDevice.current.model)")
    }
    static func log(_ s: String) {
        let line = "[\(fmt.string(from: Date()))] +\(String(format: "%.2f", Date().timeIntervalSince(t0)))s \(s)\n"
        NSLog("[aib] %@", s)
        q.async {
            let f = file
            if let h = try? FileHandle(forWritingTo: f) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() }
            else { try? Data(line.utf8).write(to: f) }
        }
    }
    /// The last `n` lines of a log file.
    static func tail(_ url: URL, _ n: Int) -> String {
        q.sync {}
        guard let d = try? Data(contentsOf: url) else { return "（没有日志文件：\(url.lastPathComponent)）" }
        let s = String(decoding: d.suffix(256 * 1024), as: UTF8.self)
        return s.split(separator: "\n", omittingEmptySubsequences: false).suffix(n).joined(separator: "\n")
    }
}

/// Shown from launch until the first window has loaded: a spinner and the current stage. Replaced by a diagnostics
/// panel (stage, the last lines of both logs, “复制日志” and “重试”) when startup fails or takes too long.
final class StartupOverlay: UIView {
    private let spinner = UIActivityIndicatorView(style: .large)
    private let title = UILabel()
    private let stageLabel = UILabel()
    private let diag = UIStackView()
    private let diagTitle = UILabel()
    private let diagText = UITextView()
    private let copyButton = UIButton(type: .system)
    private let retryButton = UIButton(type: .system)
    var onRetry: (() -> Void)?
    private(set) var showingDiagnostics = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.027, green: 0.063, blue: 0.059, alpha: 1)
        spinner.color = .white
        spinner.startAnimating()
        title.text = "AI 浏览器"
        title.font = .systemFont(ofSize: 28, weight: .semibold)
        title.textColor = .white
        stageLabel.font = .systemFont(ofSize: 16)
        stageLabel.textColor = UIColor(white: 0.8, alpha: 1)
        stageLabel.numberOfLines = 0
        stageLabel.textAlignment = .center
        let center = UIStackView(arrangedSubviews: [title, spinner, stageLabel])
        center.axis = .vertical; center.alignment = .center; center.spacing = 18
        center.translatesAutoresizingMaskIntoConstraints = false
        addSubview(center)

        diagTitle.font = .systemFont(ofSize: 20, weight: .semibold)
        diagTitle.textColor = .white
        diagTitle.numberOfLines = 0
        diagText.isEditable = false
        diagText.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        diagText.textColor = UIColor(white: 0.9, alpha: 1)
        diagText.backgroundColor = UIColor(white: 0, alpha: 0.35)
        diagText.layer.cornerRadius = 8
        for (b, t) in [(copyButton, "复制日志"), (retryButton, "重试")] {
            b.setTitle(t, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
            b.backgroundColor = UIColor(white: 1, alpha: 0.12)
            b.layer.cornerRadius = 8
            b.contentEdgeInsets = UIEdgeInsets(top: 10, left: 22, bottom: 10, right: 22)
        }
        copyButton.addTarget(self, action: #selector(copyLogs), for: .touchUpInside)
        retryButton.addTarget(self, action: #selector(retry), for: .touchUpInside)
        let buttons = UIStackView(arrangedSubviews: [copyButton, retryButton])
        buttons.spacing = 12
        diag.addArrangedSubview(diagTitle); diag.addArrangedSubview(diagText); diag.addArrangedSubview(buttons)
        diag.axis = .vertical; diag.spacing = 12; diag.alignment = .fill
        buttons.setContentHuggingPriority(.required, for: .vertical)
        diag.translatesAutoresizingMaskIntoConstraints = false
        diag.isHidden = true
        addSubview(diag)
        let g = safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            center.centerXAnchor.constraint(equalTo: centerXAnchor), center.centerYAnchor.constraint(equalTo: centerYAnchor),
            center.leadingAnchor.constraint(greaterThanOrEqualTo: g.leadingAnchor, constant: 24),
            diag.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 24), diag.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -24),
            diag.topAnchor.constraint(equalTo: g.topAnchor, constant: 24), diag.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -24)
        ])
        center.tag = 1
    }
    required init?(coder: NSCoder) { fatalError() }

    func setStage(_ s: String) { stageLabel.text = s }

    func showDiagnostics(stage: String, reason: String) {
        showingDiagnostics = true
        viewWithTag(1)?.isHidden = true
        diag.isHidden = false
        diagTitle.text = "启动未完成\n阶段：\(stage)\n原因：\(reason)\n日志位于“文件”App：我的 iPad › AI 浏览器 › 日志"
        diagText.text = report(stage: stage, reason: reason)
        DispatchQueue.main.async { let n = self.diagText.text.utf16.count; if n > 0 { self.diagText.scrollRangeToVisible(NSRange(location: n - 1, length: 1)) } }
    }
    func showProgress() {
        showingDiagnostics = false
        diag.isHidden = true
        viewWithTag(1)?.isHidden = false
    }
    private func report(stage: String, reason: String) -> String {
        let info = Bundle.main.infoDictionary ?? [:]
        return "AI 浏览器 \(info["CFBundleShortVersionString"] ?? "?") (\(info["CFBundleVersion"] ?? "?")) · iPadOS \(UIDevice.current.systemVersion)\n阶段：\(stage)\n原因：\(reason)\n\n—— startup.log（最后 60 行）——\n"
            + StartupLog.tail(StartupLog.file, 60) + "\n\n—— node.log（最后 60 行）——\n" + StartupLog.tail(StartupLog.nodeFile, 60)
    }
    @objc private func copyLogs() {
        UIPasteboard.general.string = diagText.text
        copyButton.setTitle("已复制", for: .normal)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.copyButton.setTitle("复制日志", for: .normal) }
    }
    @objc private func retry() { onRetry?() }
}
