import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.isElementFullscreenEnabled = true

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsMagnification = true

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1380, height: 890),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "rb/mail"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = false
        window.minSize = NSSize(width: 760, height: 620)
        window.center()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        installMenu()
        loadApp()
    }

    private func loadApp() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "RBMailAppURL") as? String
        let rawURL = configured?.isEmpty == false ? configured! : "http://localhost:3000"
        guard let url = URL(string: rawURL) else {
            showLoadError("The configured app URL is invalid: \(rawURL)")
            return
        }
        webView.load(URLRequest(url: url))
    }

    private func installMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "About rb/mail",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "Quit rb/mail",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appItem.submenu = appMenu
        NSApp.mainMenu = mainMenu
    }

    private func showLoadError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "rb/mail could not open"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        let html = """
        <!doctype html>
        <meta name="viewport" content="width=device-width">
        <style>
          body { margin: 0; min-height: 100vh; display: grid; place-items: center;
            background: #f2efe8; color: #191916; font: 14px -apple-system; }
          main { width: min(420px, calc(100% - 48px)); }
          b { font: 42px Georgia; letter-spacing: -2px; }
          p { color: #68665f; line-height: 1.6; }
          button { border: 0; border-radius: 10px; background: #191916; color: white;
            padding: 11px 16px; font-weight: 650; }
        </style>
        <main><b>rb/mail is almost here.</b>
        <p>Start the rb/mail server, or rebuild the desktop app with
        <code>RBMAIL_APP_URL</code> set to your hosted address.</p>
        <button onclick="location.reload()">Try again</button></main>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
