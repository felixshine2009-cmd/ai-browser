import UIKit
import WebKit
import PDFKit

/// v3.0.0 documents (layout engine): exact page geometry on iPad.
/// WKWebView.createPDF without a rect produces one tall page; documents need one PDF page per fixed-size section, so
/// each page rectangle (CSS px of the rendered document) is captured separately and the pages are merged with PDFKit.
/// The same per-rect capture renders page previews (also for hidden helper web views, which are not on screen).
@MainActor
enum PDFPages {
    static func rects(_ list: Any?) -> [CGRect] {
        guard let a = list as? [[String: Any]] else { return [] }
        return a.compactMap { d in
            let n = { (k: String) -> CGFloat in CGFloat((d[k] as? NSNumber)?.doubleValue ?? 0) }
            let r = CGRect(x: n("x"), y: n("y"), width: n("width"), height: n("height"))
            return r.width > 0 && r.height > 0 ? r : nil
        }
    }

    static func render(_ web: WKWebView, rects: [CGRect], done: @escaping (Result<Data, Error>) -> Void) {
        let out = PDFDocument()
        func step(_ i: Int) {
            if i >= rects.count {
                if let d = out.dataRepresentation() { done(.success(d)) }
                else { done(.failure(NSError(domain: "AIB", code: 1, userInfo: [NSLocalizedDescriptionKey: "PDF 合并失败"]))) }
                return
            }
            let cfg = WKPDFConfiguration(); cfg.rect = rects[i]
            web.createPDF(configuration: cfg) { r in
                switch r {
                case .success(let d):
                    if let doc = PDFDocument(data: d) {
                        for p in 0..<doc.pageCount { if let pg = doc.page(at: p) { out.insert(pg, at: out.pageCount) } }
                    }
                    step(i + 1)
                case .failure(let e): done(.failure(e))
                }
            }
        }
        step(0)
    }

    /// PNG of one rectangle of the page, at most `maxWidth` pixels wide.
    static func snapshot(_ web: WKWebView, rect: CGRect, maxWidth: CGFloat = 900, done: @escaping (Result<Data, Error>) -> Void) {
        let cfg = WKPDFConfiguration(); cfg.rect = rect
        web.createPDF(configuration: cfg) { r in
            switch r {
            case .success(let d):
                guard let page = PDFDocument(data: d)?.page(at: 0) else {
                    done(.failure(NSError(domain: "AIB", code: 2, userInfo: [NSLocalizedDescriptionKey: "预览生成失败"]))); return
                }
                let box = page.bounds(for: .mediaBox)
                let scale = min(2, maxWidth / max(1, box.width))
                let img = page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
                if let png = img.pngData() { done(.success(png)) }
                else { done(.failure(NSError(domain: "AIB", code: 3, userInfo: [NSLocalizedDescriptionKey: "预览编码失败"]))) }
            case .failure(let e): done(.failure(e))
            }
        }
    }
}
