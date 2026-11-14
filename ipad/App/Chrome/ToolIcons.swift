import UIKit

/// The toolbar tool icons, drawn in code (approved set, 2.3.0 line style redrawn for glass tiles): white strokes with
/// one green or blue accent per icon, on a 200 × 200 grid where the glyph spans roughly 46…154.
@MainActor
enum ToolIcons {
    static let ids = ["solve", "snap", "geogebra", "physics", "wiki", "dict", "code", "readlater", "scan"]

    static var green: UIColor { UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.498, green: 0.820, blue: 0.706, alpha: 1) : UIColor(red: 0.137, green: 0.502, blue: 0.373, alpha: 1) } }
    static var blue: UIColor { UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.498, green: 0.690, blue: 1, alpha: 1) : UIColor(red: 0.145, green: 0.388, blue: 0.922, alpha: 1) } }

    /// One stroke (or fill) of an icon.
    private struct Part { let path: UIBezierPath; var accent: UIColor? = nil; var width: CGFloat = 10; var fill = false }

    /// Renders the icon at `side` points for the given traits (colors resolve to light / dark).
    static func image(_ id: String, side: CGFloat, traits: UITraitCollection) -> UIImage {
        let parts = self.parts(id)
        if parts.isEmpty {
            let cfg = UIImage.SymbolConfiguration(pointSize: side * 0.42, weight: .medium)
            return (UIImage(systemName: "square.grid.2x2", withConfiguration: cfg) ?? UIImage()).withTintColor(UIColor.label.resolvedColor(with: traits), renderingMode: .alwaysOriginal)
        }
        let fmt = UIGraphicsImageRendererFormat(for: traits)
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { ctx in
            let c = ctx.cgContext
            c.scaleBy(x: side / 200, y: side / 200)
            c.setLineCap(.round); c.setLineJoin(.round)
            for p in parts {
                let col = (p.accent ?? UIColor.label).resolvedColor(with: traits)
                if p.fill { col.setFill(); p.path.fill() } else { col.setStroke(); p.path.lineWidth = p.width; p.path.lineCapStyle = .round; p.path.lineJoinStyle = .round; p.path.stroke() }
            }
        }
    }

    private static func P(_ build: (UIBezierPath) -> Void) -> UIBezierPath { let b = UIBezierPath(); build(b); return b }
    private static func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
    private static let right: CGFloat = 0, down = CGFloat.pi / 2, left = CGFloat.pi, up = CGFloat.pi * 1.5
    /// clockwise (on screen) quarter arc
    private static func arc(_ b: UIBezierPath, _ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat, _ from: CGFloat, _ to: CGFloat) {
        b.addArc(withCenter: pt(cx, cy), radius: r, startAngle: from, endAngle: to, clockwise: true)
    }
    private static func line(_ a: CGPoint, _ b: CGPoint) -> UIBezierPath { P { $0.move(to: a); $0.addLine(to: b) } }
    private static func ellipse(rx: CGFloat, ry: CGFloat, rotate deg: CGFloat) -> UIBezierPath {
        let e = UIBezierPath(ovalIn: CGRect(x: -rx, y: -ry, width: rx * 2, height: ry * 2))
        e.apply(CGAffineTransform(rotationAngle: deg * .pi / 180))
        e.apply(CGAffineTransform(translationX: 100, y: 100))
        return e
    }

    private static func parts(_ id: String) -> [Part] {
        switch id {
        case "solve": // sheet with a folded corner and a green tick
            let sheet = P { b in
                b.move(to: pt(68, 46)); b.addLine(to: pt(118, 46)); b.addLine(to: pt(140, 68)); b.addLine(to: pt(140, 150))
                arc(b, 132, 150, 8, right, down); b.addLine(to: pt(68, 158)); arc(b, 68, 150, 8, down, left)
                b.addLine(to: pt(60, 54)); arc(b, 68, 54, 8, left, up); b.close()
            }
            let fold = P { b in b.move(to: pt(118, 46)); b.addLine(to: pt(118, 68)); b.addLine(to: pt(140, 68)) }
            let tick = P { b in b.move(to: pt(78, 110)); b.addLine(to: pt(95, 126)); b.addLine(to: pt(124, 94)) }
            return [Part(path: sheet), Part(path: fold), Part(path: tick, accent: green)]
        case "snap": // camera
            let body = P { b in
                b.move(to: pt(52, 76)); arc(b, 62, 76, 10, left, up); b.addLine(to: pt(80, 66)); b.addLine(to: pt(90, 52))
                b.addLine(to: pt(110, 52)); b.addLine(to: pt(120, 66)); b.addLine(to: pt(138, 66)); arc(b, 138, 76, 10, up, 2 * .pi)
                b.addLine(to: pt(148, 140)); arc(b, 138, 140, 10, right, down); b.addLine(to: pt(62, 150)); arc(b, 62, 140, 10, down, left); b.close()
            }
            return [Part(path: body), Part(path: UIBezierPath(ovalIn: CGRect(x: 76, y: 82, width: 48, height: 48)))]
        case "geogebra": // axes, a blue curve and a point on it
            let axes = P { b in b.move(to: pt(150, 150)); b.addLine(to: pt(56, 150)); b.addLine(to: pt(56, 50)) }
            let curve = P { b in b.move(to: pt(66, 140)); b.addCurve(to: pt(140, 112), controlPoint1: pt(90, 60), controlPoint2: pt(118, 60)) }
            return [Part(path: axes), Part(path: curve, accent: blue), Part(path: UIBezierPath(ovalIn: CGRect(x: 98, y: 68, width: 12, height: 12)), fill: true)]
        case "physics": // atom
            return [Part(path: ellipse(rx: 56, ry: 22, rotate: 0), width: 8), Part(path: ellipse(rx: 56, ry: 22, rotate: 60), width: 8),
                    Part(path: ellipse(rx: 56, ry: 22, rotate: -60), width: 8),
                    Part(path: UIBezierPath(ovalIn: CGRect(x: 91, y: 91, width: 18, height: 18)), accent: green, fill: true)]
        case "wiki": // globe
            return [Part(path: UIBezierPath(ovalIn: CGRect(x: 48, y: 48, width: 104, height: 104)), width: 8),
                    Part(path: UIBezierPath(ovalIn: CGRect(x: 78, y: 48, width: 44, height: 104)), width: 8),
                    Part(path: line(pt(50, 84), pt(150, 84)), width: 8), Part(path: line(pt(50, 116), pt(150, 116)), width: 8)]
        case "dict": // open book
            let book = P { b in
                b.move(to: pt(100, 66)); b.addCurve(to: pt(50, 58), controlPoint1: pt(84, 56), controlPoint2: pt(66, 54)); b.addLine(to: pt(50, 142))
                b.addCurve(to: pt(100, 150), controlPoint1: pt(66, 138), controlPoint2: pt(84, 140))
                b.addCurve(to: pt(150, 142), controlPoint1: pt(116, 140), controlPoint2: pt(134, 138)); b.addLine(to: pt(150, 58))
                b.addCurve(to: pt(100, 66), controlPoint1: pt(134, 54), controlPoint2: pt(116, 56)); b.close()
            }
            return [Part(path: book), Part(path: line(pt(100, 66), pt(100, 150)))]
        case "code": // </>
            let l = P { b in b.move(to: pt(76, 70)); b.addLine(to: pt(46, 100)); b.addLine(to: pt(76, 130)) }
            let r = P { b in b.move(to: pt(124, 70)); b.addLine(to: pt(154, 100)); b.addLine(to: pt(124, 130)) }
            return [Part(path: l), Part(path: r), Part(path: line(pt(110, 60), pt(90, 140)), accent: blue)]
        case "readlater": // bookmark
            let mark = P { b in
                b.move(to: pt(72, 50)); b.addLine(to: pt(128, 50)); arc(b, 128, 56, 6, up, 2 * .pi); b.addLine(to: pt(134, 152))
                b.addLine(to: pt(100, 128)); b.addLine(to: pt(66, 152)); b.addLine(to: pt(66, 56)); arc(b, 72, 56, 6, left, up); b.close()
            }
            return [Part(path: mark)]
        case "scan": // viewfinder corners and a green scan line
            let corners = P { b in
                b.move(to: pt(50, 74)); b.addLine(to: pt(50, 58)); arc(b, 58, 58, 8, left, up); b.addLine(to: pt(74, 50))
                b.move(to: pt(126, 50)); b.addLine(to: pt(142, 50)); arc(b, 142, 58, 8, up, 2 * .pi); b.addLine(to: pt(150, 74))
                b.move(to: pt(150, 126)); b.addLine(to: pt(150, 142)); arc(b, 142, 142, 8, right, down); b.addLine(to: pt(126, 150))
                b.move(to: pt(74, 150)); b.addLine(to: pt(58, 150)); arc(b, 58, 142, 8, down, left); b.addLine(to: pt(50, 126))
            }
            return [Part(path: corners), Part(path: line(pt(64, 100), pt(136, 100)), accent: green)]
        default:
            return []
        }
    }
}
