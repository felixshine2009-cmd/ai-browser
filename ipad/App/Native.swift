import UIKit
import WebKit
import Vision
import VisionKit
import AVFoundation
import PDFKit

/// Native services used by the 2.3.0 features: camera photos (拍题即解 and every image input), Apple Vision text
/// recognition, QR code scanning (VisionKit DataScanner, AVFoundation fallback), PDF text for page summaries (PDFKit)
/// and offline web archives (read later). Commands are `native.*` from ipad/node/electron (electron.__ipad.native()).
final class NativeServices: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    static let shared = NativeServices()
    private var cameraDone: ((UIImage?) -> Void)?
    private var scanner: QRScanSession?

    /// Returns false when the command is not a native service command.
    func handle(_ cmd: String, _ m: [String: Any], vc: BrowserViewController, top: UIViewController, ok: @escaping (Any?) -> Void, fail: @escaping (String) -> Void) -> Bool {
        switch cmd {
        case "native.caps":
            var dataScanner = false
            if #available(iOS 16.0, *) { dataScanner = DataScannerViewController.isSupported }
            ok(["camera": UIImagePickerController.isSourceTypeAvailable(.camera), "dataScanner": dataScanner, "ocr": true, "pdf": true])
        case "native.camera":
            let maxDim = CGFloat((m["maxDim"] as? Double) ?? 2048)
            let quality = CGFloat((m["quality"] as? Double) ?? 0.85)
            let wantOcr = (m["ocr"] as? Bool) ?? false
            let library = (m["source"] as? String) == "library" || !UIImagePickerController.isSourceTypeAvailable(.camera)
            capture(from: top, library: library) { img in
                guard let img = img else { ok(["cancelled": true]); return }
                let scaled = NativeServices.scale(img, maxDim: maxDim)
                guard let jpeg = scaled.jpegData(compressionQuality: quality) else { fail("无法编码图片"); return }
                var out: [String: Any] = ["b64": jpeg.base64EncodedString(), "w": Double(scaled.size.width), "h": Double(scaled.size.height), "mime": "image/jpeg"]
                if wantOcr {
                    NativeServices.ocr(scaled) { text, lines in out["text"] = text; out["lines"] = lines; ok(out) }
                } else { ok(out) }
            }
        case "native.ocr":
            guard let d = Data(base64Encoded: (m["b64"] as? String) ?? ""), let img = UIImage(data: d) else { fail("图片数据无效"); return true }
            NativeServices.ocr(img) { text, lines in ok(["text": text, "lines": lines]) }
        case "native.qrscan":
            let s = QRScanSession()
            scanner = s
            s.start(from: top) { [weak self] text in
                self?.scanner = nil
                if let t = text { ok(["text": t]) } else { ok(["cancelled": true]) }
            }
        case "native.qrimage":
            guard let d = Data(base64Encoded: (m["b64"] as? String) ?? ""), let img = UIImage(data: d), let cg = img.cgImage else { fail("图片数据无效"); return true }
            let req = VNDetectBarcodesRequest { r, _ in
                let codes = (r.results as? [VNBarcodeObservation] ?? []).compactMap { $0.payloadStringValue }
                DispatchQueue.main.async { ok(["codes": codes]) }
            }
            DispatchQueue.global(qos: .userInitiated).async {
                do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]) } catch { DispatchQueue.main.async { fail(error.localizedDescription) } }
            }
        case "native.pdftext":
            let path = m["path"] as? String ?? ""
            DispatchQueue.global(qos: .userInitiated).async {
                guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { DispatchQueue.main.async { fail("无法打开 PDF 文件") }; return }
                var pages = [String]()
                let n = min(doc.pageCount, Int((m["maxPages"] as? Double) ?? 300))
                for i in 0..<n { pages.append(doc.page(at: i)?.string ?? "") }
                let title = (doc.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String) ?? ""
                DispatchQueue.main.async { ok(["pages": pages, "pageCount": doc.pageCount, "title": title]) }
            }
        default:
            return false
        }
        return true
    }

    // ---- camera / photo library
    private func capture(from top: UIViewController, library: Bool, done: @escaping (UIImage?) -> Void) {
        let p = UIImagePickerController()
        p.sourceType = library ? .photoLibrary : .camera
        p.mediaTypes = ["public.image"]
        p.delegate = self
        p.modalPresentationStyle = .fullScreen
        cameraDone = done
        top.present(p, animated: true)
    }
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let img = (info[.editedImage] as? UIImage) ?? (info[.originalImage] as? UIImage)
        picker.dismiss(animated: true) { [weak self] in let d = self?.cameraDone; self?.cameraDone = nil; d?(img) }
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) { [weak self] in let d = self?.cameraDone; self?.cameraDone = nil; d?(nil) }
    }
    static func scale(_ img: UIImage, maxDim: CGFloat) -> UIImage {
        let s = img.size
        let f = min(1, maxDim / max(s.width, s.height, 1))
        let size = CGSize(width: floor(s.width * f), height: floor(s.height * f))
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }

    // ---- Apple Vision text recognition (Chinese + English; formulas are left to a vision-capable model)
    static func ocr(_ img: UIImage, done: @escaping (String, [[String: Any]]) -> Void) {
        guard let cg = img.cgImage else { done("", []); return }
        let req = VNRecognizeTextRequest { r, _ in
            let obs = (r.results as? [VNRecognizedTextObservation]) ?? []
            // reading order: top to bottom, then left to right
            let sorted = obs.sorted { a, b in abs(a.boundingBox.midY - b.boundingBox.midY) > 0.01 ? a.boundingBox.midY > b.boundingBox.midY : a.boundingBox.minX < b.boundingBox.minX }
            var lines = [[String: Any]]()
            for o in sorted {
                guard let c = o.topCandidates(1).first else { continue }
                let b = o.boundingBox
                lines.append(["text": c.string, "conf": Double(c.confidence), "x": Double(b.minX), "y": Double(1 - b.maxY), "w": Double(b.width), "h": Double(b.height)])
            }
            let text = lines.compactMap { $0["text"] as? String }.joined(separator: "\n")
            DispatchQueue.main.async { done(text, lines) }
        }
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = true
        let wanted = ["zh-Hans", "zh-Hant", "en-US"]
        if let supported = try? req.supportedRecognitionLanguages() { req.recognitionLanguages = wanted.filter { supported.contains($0) } }
        else { req.recognitionLanguages = ["zh-Hans", "en-US"] }
        DispatchQueue.global(qos: .userInitiated).async {
            do { try VNImageRequestHandler(cgImage: cg, orientation: NativeServices.orientation(img), options: [:]).perform([req]) }
            catch { DispatchQueue.main.async { done("", []) } }
        }
    }
    static func orientation(_ img: UIImage) -> CGImagePropertyOrientation {
        switch img.imageOrientation {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}

/// QR code scanner: VisionKit DataScannerViewController (iPadOS 16, A12 or newer) with an AVFoundation fallback.
final class QRScanSession: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    private var done: ((String?) -> Void)?
    private var presented: UIViewController?
    private var session: AVCaptureSession?
    private var finished = false

    func start(from top: UIViewController, done: @escaping (String?) -> Void) {
        self.done = done
        if #available(iOS 16.0, *), DataScannerViewController.isSupported, DataScannerViewController.isAvailable {
            let s = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr, .microQR, .aztec, .dataMatrix, .pdf417, .ean13, .code128])],
                                              qualityLevel: .balanced, recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false, isPinchToZoomEnabled: true, isGuidanceEnabled: true, isHighlightingEnabled: true)
            s.delegate = self
            let nav = wrap(s)
            presented = nav
            top.present(nav, animated: true) { try? s.startScanning() }
            return
        }
        startAV(from: top)
    }
    private func wrap(_ content: UIViewController) -> UINavigationController {
        content.navigationItem.title = "扫描二维码"
        content.navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(cancel))
        let nav = UINavigationController(rootViewController: content)
        nav.modalPresentationStyle = .fullScreen
        return nav
    }
    @objc private func cancel() { finish(nil) }
    func finish(_ text: String?) {
        guard !finished else { return }
        finished = true
        session?.stopRunning()
        let d = done; done = nil
        if let p = presented { p.dismiss(animated: true) { d?(text) } } else { d?(text) }
    }

    // AVFoundation fallback
    private func startAV(from top: UIViewController) {
        let vc = UIViewController()
        vc.view.backgroundColor = .black
        let nav = wrap(vc)
        presented = nav
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
                guard granted, let dev = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: dev) else {
                    top.present(nav, animated: true) {
                        let l = UILabel(); l.text = "无法使用相机。请在“设置 › AI 浏览器”中允许访问相机。"; l.textColor = .white; l.numberOfLines = 0; l.textAlignment = .center
                        l.frame = vc.view.bounds.insetBy(dx: 40, dy: 40); l.autoresizingMask = [.flexibleWidth, .flexibleHeight]; vc.view.addSubview(l)
                    }
                    return
                }
                let s = AVCaptureSession()
                if s.canAddInput(input) { s.addInput(input) }
                let out = AVCaptureMetadataOutput()
                if s.canAddOutput(out) { s.addOutput(out); out.setMetadataObjectsDelegate(self, queue: .main); out.metadataObjectTypes = out.availableMetadataObjectTypes.filter { [.qr, .aztec, .dataMatrix, .pdf417, .ean13, .code128].contains($0) } }
                let layer = AVCaptureVideoPreviewLayer(session: s)
                layer.videoGravity = .resizeAspectFill
                layer.frame = vc.view.bounds
                vc.view.layer.addSublayer(layer)
                self.session = s
                top.present(nav, animated: true) { layer.frame = vc.view.bounds; DispatchQueue.global(qos: .userInitiated).async { s.startRunning() } }
            }
        }
    }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        if let o = metadataObjects.first as? AVMetadataMachineReadableCodeObject, let s = o.stringValue { finish(s) }
    }
}

@available(iOS 16.0, *)
extension QRScanSession: DataScannerViewControllerDelegate {
    func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
        for item in addedItems { if case .barcode(let b) = item, let s = b.payloadStringValue { finish(s); return } }
    }
    func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
        if case .barcode(let b) = item, let s = b.payloadStringValue { finish(s) }
    }
}
