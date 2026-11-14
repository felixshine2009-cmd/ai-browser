import XCTest

/// iOS Simulator: every file import entry through the real Swift picker path (CI job ios-sim-test).
/// The app is launched with -AIBUITest (see App/UITest.swift); fixtures are in its Documents/uitest folder.
final class ImportTests: XCTestCase {
    private var app: XCUIApplication!
    private let shotsDir = ProcessInfo.processInfo.environment["AIB_UITEST_SHOTS"] ?? ""

    override func setUpWithError() throws { continueAfterFailure = true }

    private func launch(autofeed: Bool) {
        app = XCUIApplication()
        app.launchArguments = ["-AIBUITest", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        if autofeed { app.launchEnvironment["AIB_UITEST_AUTOFEED"] = "2.5" }
        if let f = ProcessInfo.processInfo.environment["AIB_UITEST_FIXTURES"] { app.launchEnvironment["AIB_UITEST_FIXTURES"] = f }
        app.launch()
        let st = app.staticTexts["uitest.status"]
        XCTAssertTrue(st.waitForExistence(timeout: 180), "test panel (main window) did not appear")
        waitLabel(st, timeout: 240) { $0 == "ready" }
        shot("00-ready")
    }
    // read through a snapshot: an element that disappears between the existence check and the read (a sheet or picker
    // presented over the panel) gives "" instead of recording a "Failed to get matching snapshot" failure
    private func label(_ e: XCUIElement) -> String {
        guard let s = try? e.snapshot() else { return "" }
        return (s.value as? String).flatMap { $0.isEmpty ? nil : $0 } ?? s.label
    }
    @discardableResult
    private func waitLabel(_ e: XCUIElement, timeout: TimeInterval, file: StaticString = #filePath, line: UInt = #line, _ ok: (String) -> Bool) -> String {
        let end = Date().addingTimeInterval(timeout)
        var last = ""
        while Date() < end {
            let v = label(e); if !v.isEmpty { last = v; if ok(v) { return v } }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTFail("timeout; last value: \(last)", file: file, line: line)
        return last
    }
    private func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s); a.name = name; a.lifetime = .keepAlways; add(a)
        if !shotsDir.isEmpty {
            try? FileManager.default.createDirectory(atPath: shotsDir, withIntermediateDirectories: true)
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: shotsDir).appendingPathComponent("\(name).png"))
        }
    }
    /// first element with this label or identifier (buttons, cells, texts …)
    private func find(_ text: String, timeout: TimeInterval) -> XCUIElement? {
        let p = NSPredicate(format: "label == %@ OR identifier == %@ OR label BEGINSWITH %@", text, text, text)
        let end = Date().addingTimeInterval(timeout)
        repeat {
            for q in [app.buttons, app.cells, app.staticTexts, app.otherElements] {
                let m = q.matching(p).firstMatch
                if m.exists && m.isHittable { return m }
            }
            Thread.sleep(forTimeInterval: 0.4)
        } while Date() < end
        return nil
    }

    /// Every import entry: the picker (or sheet, then picker) is presented, answered like the system does, and the Node
    /// core imports the file.
    func testEveryImportEntry() throws {
        launch(autofeed: true)
        let entries: [(String, String?, String)] = [
            ("dictFiles", "选择文件", "picker:files"),
            ("dictFolder", "选择整个文件夹", "picker:folder"),
            ("zim", nil, "picker:files"),
            ("image", nil, "picker:files"),
            ("model", nil, "picker:files"),
            ("kb", nil, "picker:files"),
            ("extzip", nil, "picker:files"),
            ("csv", nil, "picker:files"),
            ("photo", nil, "picker:photo"),
        ]
        let result = app.staticTexts["uitest.result"], events = app.staticTexts["uitest.events"]
        for (i, (id, sheet, kind)) in entries.enumerated() {
            let b = app.buttons["uitest.import.\(id)"]
            XCTAssertTrue(b.waitForExistence(timeout: 20), "button \(id)")
            b.tap()
            if let s = sheet {
                guard let c = find(s, timeout: 20) else { shot(String(format: "%02d-%@-nosheet", i + 1, id)); XCTFail("choice sheet for \(id) not shown"); continue }
                shot(String(format: "%02d-%@-sheet", i + 1, id))
                c.tap()
            }
            Thread.sleep(forTimeInterval: 1.2)
            shot(String(format: "%02d-%@-picker", i + 1, id))
            let v = waitLabel(result, timeout: 120) { $0.hasPrefix("PASS \(id)") || $0.hasPrefix("FAIL \(id)") }
            XCTAssertTrue(v.hasPrefix("PASS \(id)"), "\(id): \(v)")
            let ev = label(events)
            XCTAssertTrue(ev.contains(kind), "\(id): picker not presented (\(kind)); events: \(ev)")
            shot(String(format: "%02d-%@-done", i + 1, id))
        }
    }

    /// The real Files picker: browse to the app's folder and open a dictionary with the system Open button.
    func testRealFilesPickerOpensDictionary() throws {
        launch(autofeed: false)
        app.buttons["uitest.import.dictFiles"].tap()
        if let c = find("选择文件", timeout: 15) { c.tap() } else { shot("real-nosheet") }
        // the Files picker can take several seconds to appear on a cold simulator
        XCTAssertNotNil(find("Recents", timeout: 45) ?? find("Browse", timeout: 5) ?? find("Cancel", timeout: 5), "Files picker not presented")
        shot("real-01-picker")
        let br = app.buttons["Browse"].firstMatch
        if br.exists && br.isHittable { br.tap() }
        for step in ["On My iPad", "AI 浏览器", "uitest", "realdict"] {
            guard let e = find(step, timeout: 15) else { shot("real-missing-\(step)"); XCTFail("Files picker: \(step) not found"); return }
            e.tap(); Thread.sleep(forTimeInterval: 1.5)
        }
        shot("real-02-folder")
        guard let f = find("oald-test", timeout: 15) else { shot("real-missing-file"); XCTFail("file not listed"); return }
        f.tap(); Thread.sleep(forTimeInterval: 1)
        let open = app.buttons["Open"].firstMatch
        if open.exists && !open.isEnabled, let sel = find("Select", timeout: 3) { sel.tap(); Thread.sleep(forTimeInterval: 1); find("oald-test", timeout: 5)?.tap() }
        shot("real-03-selected")
        if open.waitForExistence(timeout: 5) && open.isEnabled { open.tap() } else if open.exists { XCTFail("Open stays disabled after selecting the file") }
        let v = waitLabel(app.staticTexts["uitest.result"], timeout: 120) { $0.hasPrefix("PASS dictFiles") || $0.hasPrefix("FAIL dictFiles") }
        shot("real-04-done")
        XCTAssertTrue(v.hasPrefix("PASS dictFiles"), v)
    }
}
