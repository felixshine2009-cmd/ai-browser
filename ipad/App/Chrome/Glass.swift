import UIKit

/// Liquid Glass (iPadOS 26) with a material fallback for iPadOS 16–18.
/// Built with Xcode 26 (Swift 6.2) the real UIGlassEffect is used on iPadOS 26; older SDKs compile the fallback only.
@MainActor
enum Glass {
    static var isLiquidGlass: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    /// A glass surface. `interactive` makes it react to touches (iPadOS 26).
    static func surface(cornerRadius: CGFloat? = nil, interactive: Bool = false, tint: UIColor? = nil) -> UIVisualEffectView {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let e = UIGlassEffect(style: .regular)
            e.isInteractive = interactive
            if let t = tint { e.tintColor = t }
            let v = UIVisualEffectView(effect: e)
            if let r = cornerRadius { v.layer.cornerRadius = r; v.layer.cornerCurve = .continuous } else { v.cornerConfiguration = .capsule() }
            return v
        }
        #endif
        let v = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterial))
        v.clipsToBounds = true
        v.layer.cornerCurve = .continuous
        v.layer.cornerRadius = cornerRadius ?? 18
        v.layer.borderWidth = 0.5
        v.layer.borderColor = UIColor.white.withAlphaComponent(0.22).cgColor
        if let t = tint { v.contentView.backgroundColor = t.withAlphaComponent(0.18) }
        return v
    }
    /// Groups neighbouring glass shapes so they blend when close (iPadOS 26); a plain view otherwise.
    static func container(spacing: CGFloat = 8) -> UIView {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let e = UIGlassContainerEffect()
            e.spacing = spacing
            return UIVisualEffectView(effect: e)
        }
        #endif
        return UIView()
    }
    static func contentView(of v: UIView) -> UIView { (v as? UIVisualEffectView)?.contentView ?? v }

    /// Button styled as glass (iPadOS 26) or a translucent capsule.
    static func button(symbol: String, title: String? = nil, prominent: Bool = false, accessibility: String, action: UIAction) -> UIButton {
        var c: UIButton.Configuration
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { c = prominent ? .prominentGlass() : .glass() } else { c = Glass.fallbackConfig(prominent) }
        #else
        c = Glass.fallbackConfig(prominent)
        #endif
        c.image = Glass.symbol(symbol)
        c.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 15, weight: .medium)
        if let t = title { c.title = t; c.imagePadding = 5; c.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in var o = a; o.font = .systemFont(ofSize: 13, weight: .medium); return o } }
        c.cornerStyle = .capsule
        c.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: title == nil ? 9 : 12, bottom: 7, trailing: title == nil ? 9 : 12)
        let b = UIButton(configuration: c, primaryAction: action)
        b.accessibilityLabel = accessibility
        b.toolTip = accessibility
        return b
    }
    /// Plain icon button for use inside a glass group.
    static func plainButton(symbol: String, accessibility: String, action: UIAction) -> UIButton {
        var c = UIButton.Configuration.borderless()
        c.image = Glass.symbol(symbol)
        c.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 15, weight: .medium)
        c.baseForegroundColor = .label
        c.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 9, bottom: 7, trailing: 9)
        let b = UIButton(configuration: c, primaryAction: action)
        b.accessibilityLabel = accessibility
        b.toolTip = accessibility
        return b
    }
    private static func fallbackConfig(_ prominent: Bool) -> UIButton.Configuration {
        var c = prominent ? UIButton.Configuration.filled() : UIButton.Configuration.gray()
        if !prominent {
            c.background.visualEffect = UIBlurEffect(style: .systemThinMaterial)
            c.background.backgroundColor = UIColor.white.withAlphaComponent(0.08)
            c.background.strokeColor = UIColor.white.withAlphaComponent(0.22)
            c.background.strokeWidth = 0.5
            c.baseForegroundColor = .label
        }
        return c
    }
    /// SF Symbol with fallbacks for older iPadOS versions that lack newer symbols.
    static func symbol(_ names: String) -> UIImage? {
        for n in names.split(separator: "|") { if let i = UIImage(systemName: String(n)) { return i } }
        return UIImage(systemName: "circle")
    }
}
