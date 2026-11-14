import UIKit

/// Copies a picked folder out of the Files app. Every file is read with NSFileCoordinator, which makes file providers
/// (iCloud Drive and others) download items that are not on the device yet. Returns the names that could not be read.
enum FolderCopier {
    static func copy(_ src: URL, to dest: URL, progress: @escaping (Int64, Int64, String) -> Void) -> [String] {
        let fm = FileManager.default
        var failed = [String]()
        let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey, .totalFileSizeKey]
        guard let en = fm.enumerator(at: src, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) else {
            return [src.lastPathComponent]
        }
        var items = [(URL, Bool, Int64)]()
        for case let u as URL in en {
            let v = try? u.resourceValues(forKeys: Set(keys))
            items.append((u, v?.isDirectory ?? false, Int64(v?.totalFileSize ?? v?.fileSize ?? 0)))
        }
        let total = max(1, items.reduce(Int64(0)) { $0 + ($1.1 ? 0 : $1.2) })
        var done: Int64 = 0
        try? fm.createDirectory(at: dest, withIntermediateDirectories: true)
        let basePath = src.standardizedFileURL.path
        for (u, isDir, size) in items {
            var rel = u.standardizedFileURL.path
            if rel.hasPrefix(basePath) { rel = String(rel.dropFirst(basePath.count)) }
            rel = rel.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let target = dest.appendingPathComponent(rel)
            if isDir { try? fm.createDirectory(at: target, withIntermediateDirectories: true); continue }
            try? fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            var cerr: NSError?
            var ok = false
            NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: u, options: [], error: &cerr) { readURL in
                do { if fm.fileExists(atPath: target.path) { try fm.removeItem(at: target) }; try fm.copyItem(at: readURL, to: target); ok = true }
                catch { NSLog("[aib] folder copy failed \(rel): \(error)") }
            }
            if !ok { failed.append(rel) }
            done += size
            progress(done, total, u.lastPathComponent)
        }
        return failed
    }
}

/// Small progress panel shown while picked files are read out of the Files app.
final class PickProgressView: UIView {
    private let label = UILabel()
    private let detail = UILabel()
    private let bar = UIProgressView(progressViewStyle: .default)
    static func show(in host: UIView, title: String) -> PickProgressView {
        let v = PickProgressView(frame: host.bounds)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.backgroundColor = UIColor.black.withAlphaComponent(0.25)
        let card = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        card.layer.cornerRadius = 18; card.layer.cornerCurve = .continuous; card.clipsToBounds = true
        card.frame = CGRect(x: 0, y: 0, width: 340, height: 120)
        card.center = CGPoint(x: host.bounds.midX, y: host.bounds.midY)
        card.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin]
        v.label.text = title; v.label.font = .systemFont(ofSize: 15, weight: .semibold); v.label.textAlignment = .center
        v.detail.font = .systemFont(ofSize: 12); v.detail.textColor = .secondaryLabel; v.detail.textAlignment = .center; v.detail.lineBreakMode = .byTruncatingMiddle
        v.label.frame = CGRect(x: 16, y: 20, width: 308, height: 22)
        v.bar.frame = CGRect(x: 24, y: 58, width: 292, height: 4)
        v.detail.frame = CGRect(x: 16, y: 76, width: 308, height: 18)
        v.bar.progress = 0
        card.contentView.addSubview(v.label); card.contentView.addSubview(v.bar); card.contentView.addSubview(v.detail)
        v.addSubview(card)
        v.alpha = 0
        host.addSubview(v)
        // short reads finish before the panel would only flash
        UIView.animate(withDuration: 0.2, delay: 0.35, options: [], animations: { v.alpha = 1 })
        return v
    }
    func update(done: Int64, total: Int64, name: String) {
        bar.setProgress(Float(Double(done) / Double(max(total, 1))), animated: true)
        let f = ByteCountFormatter()
        detail.text = "\(f.string(fromByteCount: done)) / \(f.string(fromByteCount: total)) · \(name)"
    }
    func dismiss() {
        layer.removeAllAnimations()
        UIView.animate(withDuration: 0.15, animations: { self.alpha = 0 }) { _ in self.removeFromSuperview() }
    }
}
