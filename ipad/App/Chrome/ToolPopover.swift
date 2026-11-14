import UIKit

/// One entry of the tool popover (sent by the chrome page: id, formal Chinese label, description, whether it is open).
struct ToolItem {
    let id: String
    let label: String
    let tip: String
    let active: Bool
    init?(_ d: [String: Any]) {
        guard let id = d["id"] as? String, !id.isEmpty else { return nil }
        self.id = id
        label = d["label"] as? String ?? id
        tip = d["tip"] as? String ?? ""
        active = (d["active"] as? Bool) == true
    }
}

/// The toolbar's tool strip as one Liquid Glass button: tapping it opens this popover, a glass panel that grows
/// downward from under the button (like the Safari downloads popover on iPadOS 26) with a grid of glass tiles.
/// The expand button turns it into a full-size panel over the content area with each tool's description.
/// Liquid Glass (UIGlassEffect) on iPadOS 26, translucent material on iPadOS 16–18 (see Glass.swift).
@MainActor
final class ToolPopoverController: UIViewController {
    private let items: [ToolItem]
    private let anchor: CGRect      // the glass tool button, in window coordinates
    private let area: CGRect        // the content area below the toolbar, in window coordinates
    private let done: (String?) -> Void
    private var finished = false
    private(set) var expanded = false

    private let catcher = UIControl()
    private let panel: UIVisualEffectView
    private let titleLabel = UILabel()
    private var expandButton: UIButton!
    private let scroll = UIScrollView()
    private var tiles = [ToolTile]()

    // compact grid (Safari-like popover) and expanded grid metrics
    private let pad: CGFloat = 16, header: CGFloat = 44, gap: CGFloat = 10
    private var tileSide: CGFloat { expanded ? 84 : 62 }
    private var cellW: CGFloat { expanded ? 150 : 86 }
    private var cellH: CGFloat { expanded ? 168 : 96 }

    init(items: [ToolItem], anchor: CGRect, area: CGRect, done: @escaping (String?) -> Void) {
        self.items = items; self.anchor = anchor; self.area = area; self.done = done
        panel = Glass.surface(cornerRadius: 26)
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override var keyCommands: [UIKeyCommand]? {
        let esc = UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(escape))
        let full = UIKeyCommand(title: "展开工具面板", action: #selector(toggleExpanded), input: "\r", modifierFlags: .command)
        return [esc, full]
    }
    override var canBecomeFirstResponder: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        catcher.frame = view.bounds; catcher.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        catcher.addTarget(self, action: #selector(escape), for: .touchUpInside)
        catcher.accessibilityLabel = "关闭工具面板"
        view.addSubview(catcher)

        panel.layer.shadowColor = UIColor.black.cgColor
        panel.layer.shadowOpacity = 0.28; panel.layer.shadowRadius = 24; panel.layer.shadowOffset = CGSize(width: 0, height: 12)
        panel.accessibilityViewIsModal = true
        panel.accessibilityIdentifier = "tools.popover"
        view.addSubview(panel)
        let content = Glass.contentView(of: panel)

        titleLabel.text = "工具"
        titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        titleLabel.textColor = .label
        titleLabel.accessibilityTraits = .header
        content.addSubview(titleLabel)

        expandButton = Glass.plainButton(symbol: "arrow.up.left.and.arrow.down.right", accessibility: "展开到整个区域",
                                         action: UIAction { [weak self] _ in self?.toggleExpanded() })
        expandButton.accessibilityIdentifier = "tools.expand"
        content.addSubview(expandButton)

        scroll.showsHorizontalScrollIndicator = false
        scroll.alwaysBounceVertical = false
        scroll.backgroundColor = .clear
        content.addSubview(scroll)
        for it in items {
            let t = ToolTile(item: it)
            // v3.0.1: a plain UIControl only sends touch events; .primaryActionTriggered (3.0.0) never fired on a tap
            t.addAction(UIAction { [weak self] _ in Haptics.play("select"); self?.finish(it.id) }, for: .touchUpInside)
            tiles.append(t); scroll.addSubview(t)
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        layout()
        // grow downward from the button: start squashed against the panel's top edge
        let h = panel.bounds.height
        panel.alpha = 0
        panel.transform = CGAffineTransform(translationX: 0, y: -h * 0.22).scaledBy(x: 0.92, y: 0.56)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
        UIView.animate(withDuration: 0.42, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.4, options: [.allowUserInteraction, .beginFromCurrentState]) {
            self.panel.alpha = 1; self.panel.transform = .identity
        }
        UIAccessibility.post(notification: .screenChanged, argument: tiles.first)
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if panel.transform == .identity { layout() }
    }
    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        tiles.forEach { $0.redraw() }
    }

    /// Frames for the current mode (compact popover under the button, or the whole content area).
    private func layout() {
        let bounds = view.bounds
        let a = view.convert(anchor, from: nil), ar = view.convert(area, from: nil)
        let n = max(1, items.count)
        var frame: CGRect, cols: Int
        if expanded {
            frame = CGRect(x: ar.minX + 16, y: a.maxY + 8, width: ar.width - 32, height: ar.maxY - a.maxY - 24)
            cols = max(1, Int((frame.width - pad * 2 + gap) / (cellW + gap)))
        } else {
            cols = n <= 4 ? n : (n <= 9 ? 3 : 4)
            let rows = Int(ceil(Double(n) / Double(cols)))
            let w = CGFloat(cols) * cellW + CGFloat(cols - 1) * gap + pad * 2
            let h = header + CGFloat(rows) * cellH + CGFloat(rows - 1) * gap + pad
            let x = min(max(12, a.midX - w / 2), bounds.width - w - 12)
            frame = CGRect(x: x, y: a.maxY + 8, width: w, height: min(h, bounds.height - a.maxY - 24))
        }
        panel.frame = frame
        titleLabel.frame = CGRect(x: pad + 2, y: 12, width: frame.width - 120, height: 22)
        expandButton.frame = CGRect(x: frame.width - pad - 34, y: 6, width: 36, height: 34)
        scroll.frame = CGRect(x: 0, y: header, width: frame.width, height: frame.height - header)
        let used = CGFloat(cols) * cellW + CGFloat(cols - 1) * gap
        let x0 = expanded ? max(pad, (frame.width - used) / 2) : pad
        for (i, t) in tiles.enumerated() {
            let r = i / cols, c = i % cols
            t.expanded = expanded
            t.frame = CGRect(x: x0 + CGFloat(c) * (cellW + gap), y: CGFloat(r) * (cellH + gap), width: cellW, height: cellH)
            t.tileSide = tileSide
        }
        let rows = Int(ceil(Double(tiles.count) / Double(cols)))
        scroll.contentSize = CGSize(width: frame.width, height: CGFloat(rows) * (cellH + gap) - gap + pad)
    }

    @objc func toggleExpanded() {
        expanded.toggle()
        if UITest.enabled { UITest.event(expanded ? "tools:expanded" : "tools:compact") }
        var c = expandButton.configuration
        c?.image = Glass.symbol(expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
        expandButton.configuration = c
        expandButton.accessibilityLabel = expanded ? "收起为弹出面板" : "展开到整个区域"
        UIView.animate(withDuration: 0.45, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0.3, options: [.beginFromCurrentState, .allowUserInteraction]) {
            self.layout(); self.tiles.forEach { $0.layoutIfNeeded() }
        }
    }
    @objc private func escape() { finish(nil) }

    private func finish(_ id: String?) {
        guard !finished else { return }
        finished = true
        if UITest.enabled { UITest.event("tile:\(id ?? "none")") }
        UIView.animate(withDuration: 0.18, delay: 0, options: [.curveEaseIn, .beginFromCurrentState], animations: {
            self.panel.alpha = 0
            self.panel.transform = CGAffineTransform(translationX: 0, y: -self.panel.bounds.height * 0.12).scaledBy(x: 0.96, y: 0.8)
        }) { _ in
            self.dismiss(animated: false) { self.done(id) }
        }
    }
}

/// A glass tile with the tool icon, its Chinese name and (expanded) its description.
@MainActor
final class ToolTile: UIControl {
    let item: ToolItem
    private let glass: UIVisualEffectView
    private let icon = UIImageView()
    private let label = UILabel()
    private let tip = UILabel()
    private let ring = CAShapeLayer()
    var expanded = false { didSet { tip.alpha = expanded ? 1 : 0; setNeedsLayout() } }
    var tileSide: CGFloat = 62 { didSet { if oldValue != tileSide { redraw() }; setNeedsLayout() } }

    init(item: ToolItem) {
        self.item = item
        glass = Glass.surface(cornerRadius: 16, interactive: true)
        super.init(frame: .zero)
        glass.isUserInteractionEnabled = false
        addSubview(glass)
        icon.contentMode = .scaleAspectFit
        Glass.contentView(of: glass).addSubview(icon)
        label.text = item.label
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.textColor = .label
        label.textAlignment = .center
        label.adjustsFontSizeToFitWidth = true; label.minimumScaleFactor = 0.8
        addSubview(label)
        tip.text = item.tip
        tip.font = .systemFont(ofSize: 11)
        tip.textColor = .secondaryLabel
        tip.textAlignment = .center
        tip.numberOfLines = 3
        tip.alpha = 0
        addSubview(tip)
        ring.fillColor = UIColor.clear.cgColor
        ring.lineWidth = 2
        ring.isHidden = !item.active
        layer.addSublayer(ring)
        isAccessibilityElement = true
        accessibilityIdentifier = "tool.\(item.id)"
        accessibilityLabel = item.label
        accessibilityHint = item.tip
        accessibilityTraits = item.active ? [.button, .selected] : .button
        largeContentTitle = item.label
        showsLargeContentViewer = true
        addInteraction(UILargeContentViewerInteraction())
        if #available(iOS 13.4, *) { addInteraction(UIPointerInteraction(delegate: nil)) }
        redraw()
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    func redraw() {
        icon.image = ToolIcons.image(item.id, side: tileSide, traits: traitCollection)
        largeContentImage = icon.image
        ring.strokeColor = ToolIcons.green.resolvedColor(with: traitCollection).cgColor
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        let s = tileSide
        let g = CGRect(x: (bounds.width - s) / 2, y: 2, width: s, height: s)
        glass.frame = g
        glass.layer.cornerRadius = s * 0.26
        icon.frame = Glass.contentView(of: glass).bounds
        ring.frame = bounds
        ring.path = UIBezierPath(roundedRect: g.insetBy(dx: -3, dy: -3), cornerRadius: s * 0.26 + 3).cgPath
        label.frame = CGRect(x: 0, y: g.maxY + 6, width: bounds.width, height: 18)
        tip.frame = CGRect(x: 4, y: label.frame.maxY + 3, width: bounds.width - 8, height: 44)
    }
    // VoiceOver / Full Keyboard Access activation sends the same event as a tap
    override func accessibilityActivate() -> Bool { sendActions(for: .touchUpInside); return true }
    override var isHighlighted: Bool {
        didSet {
            UIView.animate(withDuration: 0.16, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction]) {
                self.glass.transform = self.isHighlighted ? CGAffineTransform(scaleX: 0.93, y: 0.93) : .identity
            }
        }
    }
}

/// `native.toolsPopover`: { items: [{id,label,tip,active}], rect: {x,y,w,h} in the window page's CSS px } -> { id | null }
@MainActor
final class ToolPopoverService: NativeService {
    let commands = ["native.toolsPopover"]
    private weak var current: ToolPopoverController?
    func handle(_ cmd: String, _ m: [String: Any], ctx: ServiceContext, ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void) {
        let items = (m["items"] as? [[String: Any]] ?? []).compactMap(ToolItem.init)
        guard !items.isEmpty else { fail("没有可显示的工具"); return }
        if current != nil { ok(["id": NSNull()]); return } // a second tap on the button closes the open popover
        let num: (Any?) -> CGFloat = { v in CGFloat((v as? Double) ?? Double((v as? Int) ?? 0)) }
        let r = m["rect"] as? [String: Any] ?? [:]
        let src = ctx.sourceView
        let local = CGRect(x: num(r["x"]), y: num(r["y"]), width: max(1, num(r["w"])), height: max(1, num(r["h"])))
        let anchor = src.convert(local, to: nil)
        let toolbarBottom = src.convert(CGPoint(x: 0, y: num(m["toolbarBottom"]) > 0 ? num(m["toolbarBottom"]) : local.maxY), to: nil).y
        let full = src.convert(src.bounds, to: nil)
        let area = CGRect(x: full.minX, y: toolbarBottom, width: full.width, height: full.maxY - toolbarBottom)
        let vc = ToolPopoverController(items: items, anchor: anchor, area: area) { [weak self] id in
            self?.current = nil // closed: the next tap on the button opens a new popover
            ok(["id": (id.map { $0 as Any }) ?? NSNull()])
        }
        vc.overrideUserInterfaceStyle = src.overrideUserInterfaceStyle
        current = vc
        ctx.top.present(vc, animated: false)
    }
}
