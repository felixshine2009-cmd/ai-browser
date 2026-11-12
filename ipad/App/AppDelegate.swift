import UIKit

// AI Browser for iPad — a port of the desktop (Electron) app. The desktop main process runs unchanged in an embedded
// Node.js runtime (nodejs-mobile); every Electron window / view is a native WKWebView managed by BrowserViewController.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.backgroundColor = UIColor(red: 0.027, green: 0.063, blue: 0.059, alpha: 1)
        w.rootViewController = BrowserViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }

    func applicationWillTerminate(_ application: UIApplication) { Host.shared.event(["type": "app", "name": "quit"]) }
    func applicationDidEnterBackground(_ application: UIApplication) { Host.shared.event(["type": "app", "name": "background"]) }
}
