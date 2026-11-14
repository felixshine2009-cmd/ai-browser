import XCTest

/// v3.0.1: the glass tool popover. Opens it through the chrome page's tool button, taps every tile with a real touch and
/// checks that the tool opened (tool views: the Node core's active tool; scan / snap: the camera or QR command reached
/// the native host), and checks the expand button. CI runs it on iPadOS 18 and iPadOS 26.
final class ToolPopoverTests: XCTestCase {
    private var app: XCUIApplication!
    private let shotsDir = ProcessInfo.processInfo.environment["AIB_UITEST_SHOTS"] ?? ""

    override func setUpWithError() throws { continueAfterFailure = true }

    private func value(_ e: XCUIElement) -> String {
        guard let s = try? e.snapshot() else { return "" }
        return (s.value as? String).flatMap { $0.isEmpty ? nil : $0 } ?? s.label
    }
    @discardableResult
    private func wait(_ e: XCUIElement, _ timeout: TimeInterval, file: StaticString = #filePath, line: UInt = #line, _ ok: (String) -> Bool) -> String {
        let end = Date().addingTimeInterval(timeout); var last = ""
        while Date() < end { let v = value(e); if !v.isEmpty { last = v; if ok(v) { return v } }; Thread.sleep(forTimeInterval: 0.4) }
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
    /// dismisses system alerts, sheets and the photo picker left by the camera / scanner (no camera in the Simulator),
    /// until the test controls are reachable again
    private func clearModals() {
        let open = app.buttons["uitest.tools.open"]
        let end = Date().addingTimeInterval(20)
        while Date() < end {
            let alert = app.alerts.firstMatch
            if alert.exists { (alert.buttons.allElementsBoundByIndex.last ?? alert.buttons.firstMatch).tap(); Thread.sleep(forTimeInterval: 0.8); continue }
            if open.exists && open.isHittable { return }
            let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel", "关闭", "Close", "完成", "Done"])).firstMatch
            if cancel.exists && cancel.isHittable { cancel.tap(); Thread.sleep(forTimeInterval: 0.8); continue }
            Thread.sleep(forTimeInterval: 0.5)
        }
    }
    private func openPopover() -> Bool {
        let open = app.buttons["uitest.tools.open"]
        XCTAssertTrue(open.waitForExistence(timeout: 20))
        // the test controls are brought to the front every 0.7 s; wait until the button can take a real tap
        let end = Date().addingTimeInterval(10)
        while !open.isHittable && Date() < end { Thread.sleep(forTimeInterval: 0.4) }
        if open.isHittable { open.tap() } else { open.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
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
            let opened = openPopover()
            if !opened { shot(String(format: "%02d-%@-noopen", i + 2, id)) }
            XCTAssertTrue(opened, "popover did not open for \(id); events: \(value(events))")
            let tile = app.descendants(matching: .any)[full]
            XCTAssertTrue(tile.waitForExistence(timeout: 5) && tile.isHittable, "tile \(id) not hittable")
            tile.tap()
            wait(events, 10) { $0.contains("tile:\(id)") }
            switch id {
            case "scan": wait(events, 15) { $0.contains("cmd:native.qrscan") }
            case "snap":
                wait(events, 15) { $0.contains("cmd:native.camera") || $0.contains("cmd:native.caps") }
                // no camera in the Simulator: the photo picker comes up instead; wait for it so clearModals can close it
                _ = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel"])).firstMatch.waitForExistence(timeout: 10)
            default:
                wait(app.staticTexts["uitest.tool"], 20) { $0 == "tool:\(id)" }
            }
            shot(String(format: "%02d-%@", i + 2, id))
            clearModals()
        }
    }
}
