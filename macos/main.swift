// Mask Relay for macOS — a native window around the shared web UI.
// Networking, storage and clipboard go through a narrow JS bridge
// ("relay") that can only reach api.mail.tm.
import Cocoa
import WebKit

private let allowedHost = "api.mail.tm"
private let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    let storeURL: URL
    private let session: URLSession

    override init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Mask Relay", isDirectory: true)
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        storeURL = support.appendingPathComponent("masks.json")
        // Ephemeral: no cookies, cache or credentials written to disk.
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config)
        super.init()
        migrateLegacyStore()
    }

    /// Masks created with the earlier local-server version live in ~/.mask-relay.
    private func migrateLegacyStore() {
        let fm = FileManager.default
        let legacy = fm.homeDirectoryForCurrentUser.appendingPathComponent(".mask-relay/masks.json")
        guard !fm.fileExists(atPath: storeURL.path), fm.fileExists(atPath: legacy.path) else { return }
        try? fm.copyItem(at: legacy, to: storeURL)
        try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storeURL.path)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return replyHandler(nil, "Malformed bridge message")
        }
        switch op {
        case "http":
            http(body, reply: replyHandler)
        case "load":
            replyHandler((try? String(contentsOf: storeURL, encoding: .utf8)) ?? "[]", nil)
        case "save":
            guard let data = (body["data"] as? String)?.data(using: .utf8) else { return replyHandler(nil, "No data") }
            do {
                try data.write(to: storeURL, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storeURL.path)
                replyHandler(true, nil)
            } catch {
                replyHandler(nil, "Couldn't save masks: \(error.localizedDescription)")
            }
        case "copy":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(body["text"] as? String ?? "", forType: .string)
            replyHandler(true, nil)
        case "badge":
            let n = body["n"] as? Int ?? 0
            NSApp.dockTile.badgeLabel = n > 0 ? String(n) : nil
            replyHandler(true, nil)
        case "theme":
            let theme = body["theme"] as? String
            UserDefaults.standard.set(theme, forKey: "theme")
            applyTheme(theme)
            replyHandler(true, nil)
        default:
            replyHandler(nil, "Unknown op \(op)")
        }
    }

    private func http(_ body: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let raw = body["url"] as? String, let url = URL(string: raw),
              url.scheme == "https", url.host == allowedHost else {
            return reply(nil, "Blocked request to a host other than \(allowedHost)")
        }
        var req = URLRequest(url: url)
        req.httpMethod = body["method"] as? String ?? "GET"
        for (k, v) in body["headers"] as? [String: String] ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let payload = body["body"] as? String { req.httpBody = payload.data(using: .utf8) }
        session.dataTask(with: req) { data, response, error in
            DispatchQueue.main.async {
                if let error { return reply(nil, error.localizedDescription) }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                reply(["status": status, "text": String(data: data ?? Data(), encoding: .utf8) ?? ""], nil)
            }
        }.resume()
    }
}

func applyTheme(_ theme: String?) {
    switch theme {
    case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
    case "light": NSApp.appearance = NSAppearance(named: .aqua)
    default: NSApp.appearance = nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    let bridge = Bridge()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let theme = UserDefaults.standard.string(forKey: "theme")
        applyTheme(theme)
        buildMenu()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "relay")
        if let theme, theme == "dark" || theme == "light" {
            config.userContentController.addUserScript(WKUserScript(
                source: "document.documentElement.dataset.theme = '\(theme)';",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Mask Relay"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(srgbRed: 0.106, green: 0.098, blue: 0.141, alpha: 1)
                : NSColor(srgbRed: 0.98, green: 0.976, blue: 0.988, alpha: 1)
        }
        window.minSize = NSSize(width: 380, height: 520)
        window.contentView = web
        window.setFrameAutosaveName("MaskRelayMain")
        if !window.setFrameUsingName("MaskRelayMain") { window.center() }
        window.makeKeyAndOrderFront(nil)

        let webDir = Bundle.main.resourceURL!.appendingPathComponent("web")
        web.loadFileURL(webDir.appendingPathComponent("app.html"), allowingReadAccessTo: webDir)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Links inside emails open in the default browser, never inside the app.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        openExternally(navigationAction.request.url)
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        if url.isFileURL || url.scheme == "about" { return decisionHandler(.allow) }
        if navigationAction.navigationType == .linkActivated { openExternally(url) }
        decisionHandler(.cancel)
    }

    private func openExternally(_ url: URL?) {
        guard let url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return }
        NSWorkspace.shared.open(url)
    }

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Mask Relay", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Mask Relay", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Mask Relay", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.windowsMenu = win
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
