import XCTest

/// v3.0.1: the glass tool popover. Opens it through the chrome page's tool button, taps every tile with a real touch and
/// checks that the tool opened (tool views: the Node core's active tool; scan / snap: the camera or QR command reached
/// the native host), and checks the expand button. CI runs it on iPadOS 18 and iPadOS 26.
final class ToolPopoverTests: XCTestCase {
    private var app: XCUIApplication!
    private let shotsDir = ProcessInfo.processInfo.environment["AIB_UITEST_SHOTS"] ?? ""

    override func setUpWithError() throws { continueAfterFailure = true }

    private func value(_ e: XCUIElement) -> String { guard e.exists else { return "" }; return (e.value as? String).flatMap { $0.isEmpty ? nil : $0 } ?? e.label }
    @discardableResult
    private func wait(_ e: XCUIElement, _ timeout: TimeInterval, file: StaticString = #filePath, line: UInt = #line, _ ok: (String) -> Bool) -> String {
        let end = Date().addingTimeInterval(timeout); var last = ""
        while Date() < end { if e.exists { last = value(e); if ok(last) { return last } }; Thread.sleep(forTimeInterval: 0.4) }
        XCTFail("timeout; last value: \(last)", file: file, line: line); return last
    }
    private func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s); a.name = name; a.lifetime = .keepAlways; add(a)
        if !shotsDir.isEmpty {
            try? FileManager.default.createDirectory(atPath: shotsDir, withIntermediateDirectories: true)
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: shotsDir).appendingPathComponent("tools-\(name).png"))
        }
    }
    /// dismisses system alerts and sheets left by the camera / scanner (no camera in the Simulator)
    private func clearModals() {
        for _ in 0..<3 {
            let alert = app.alerts.firstMatch
            if alert.exists { (alert.buttons.allElementsBoundByIndex.last ?? alert.buttons.firstMatch).tap(); Thread.sleep(forTimeInterval: 0.6); continue }
            let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel", "关闭", "Close", "完成", "Done"])).firstMatch
            if cancel.exists && cancel.isHittable { cancel.tap(); Thread.sleep(forTimeInterval: 0.6); continue }
            break
        }
    }
    private func openPopover() -> Bool {
        let open = app.buttons["uitest.tools.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        open.tap()
        return app.otherElements["tools.popover"].waitForExistence(timeout: 15) || app.buttons["tools.expand"].waitForExistence(timeout: 5)
    }

    func testEveryToolTileOpensItsTool() throws {
        app = XCUIApplication()
        app.launchArguments = ["-AIBUITest"]
        app.launch()
        let status = app.staticTexts["uitest.status"], events = app.staticTexts["uitest.events"]
        XCTAssertTrue(status.waitForExistence(timeout: 180), "test panel did not appear")
        wait(status, 240) { $0 == "ready" }
        Thread.sleep(forTimeInterval: 2)

        // expand button: compact -> whole area -> compact
        XCTAssertTrue(openPopover(), "popover did not open")
        shot("00-popover")
        let expand = app.buttons["tools.expand"]
        XCTAssertTrue(expand.waitForExistence(timeout: 5), "expand button")
        expand.tap(); wait(events, 10) { $0.contains("tools:expanded") }
        shot("01-expanded")
        expand.tap(); wait(events, 10) { $0.contains("tools:compact") }

        // every tile, with a real tap
        let tiles = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'tool.'"))
        let ids = tiles.allElementsBoundByIndex.map { $0.identifier }.filter { !$0.isEmpty }
        XCTAssertGreaterThanOrEqual(ids.count, 9, "tiles: \(ids)")
        // close the popover again (tap outside) before the per-tile loop
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)).tap()
        Thread.sleep(forTimeInterval: 1)

        for (i, full) in ids.enumerated() {
            let id = String(full.dropFirst("tool.".count))
            XCTAssertTrue(openPopover(), "popover did not open for \(id)")
            let tile = app.descendants(matching: .any)[full]
            XCTAssertTrue(tile.waitForExistence(timeout: 5) && tile.isHittable, "tile \(id) not hittable")
            tile.tap()
            wait(events, 10) { $0.contains("tile:\(id)") }
            switch id {
            case "scan": wait(events, 15) { $0.contains("cmd:native.qrscan") }
            case "snap": wait(events, 15) { $0.contains("cmd:native.camera") || $0.contains("cmd:native.caps") }
            default:
                wait(app.staticTexts["uitest.tool"], 20) { $0 == "tool:\(id)" }
            }
            shot(String(format: "%02d-%@", i + 2, id))
            clearModals()
        }
    }
}
