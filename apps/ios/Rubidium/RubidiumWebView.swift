import SwiftUI
import AuthenticationServices
import UIKit
import WebKit

enum RubidiumSessionState: Equatable {
    case loading
    case signedOut
    case signedIn(email: String)
}

struct RubidiumAPIError: LocalizedError {
    let status: Int
    let message: String
    let code: String?

    var errorDescription: String? { message }
}

private struct RubidiumAPIEnvelope: Decodable {
    let ok: Bool
    let status: Int
    let body: String
}

private struct RubidiumSessionEnvelope: Decodable {
    struct User: Decodable {
        let email: String
    }

    let authenticated: Bool
    let user: User?
}

private struct RubidiumOneTimeTokenEnvelope: Decodable {
    let token: String
}

private struct RubidiumConfigurationEnvelope: Decodable {
    struct Providers: Decodable {
        let google: Bool
        let microsoft: Bool
    }

    let providers: Providers
}

private struct RubidiumEmptyResponse: Decodable {}

@MainActor
final class RubidiumBrowserModel: ObservableObject {
    @Published var isLoading = true
    @Published var progress = 0.08
    @Published var errorMessage: String?
    @Published var isMailWorkspace = false
    @Published var sessionState: RubidiumSessionState = .loading
    @Published var googleIdentityAvailable = false
    @Published var microsoftIdentityAvailable = false
    @Published var connectionRevision = 0
    @Published var contentRevision = 0

    weak var webView: WKWebView?
    fileprivate var nativeAuthAction: ((String, String, String?) -> Void)?

    var appURL: URL {
        let configured = Bundle.main.object(forInfoDictionaryKey: "RBMailAppURL") as? String
        return URL(string: configured ?? "https://rbmail-production.up.railway.app")!
    }

    var bootstrapURL: URL {
        appURL.appendingPathComponent("api/session")
    }

    func reload() {
        errorMessage = nil
        if let webView {
            webView.reload()
        } else {
            isLoading = true
        }
    }

    func stabilizeViewportAfterKeyboardChange(overlap: CGFloat) {
        let delays = [0.0, 0.08, 0.24, 0.42]
        for delay in delays {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let webView = self?.webView else { return }
                webView.scrollView.setContentOffset(.zero, animated: false)
                let clampedOverlap = max(0, overlap)
                webView.evaluateJavaScript(
                    "document.documentElement.style.setProperty('--rubidium-keyboard-overlap', '\(clampedOverlap)px'); window.scrollTo(0, 0)"
                )
            }
        }
    }

    func visibleMailContext() async -> String {
        guard let webView else { return "" }
        let script = """
        (() => {
          const root = document.querySelector('.mail-app.mobile-thread-open .thread-panel')
            || (window.innerWidth >= 700 ? document.querySelector('.thread-panel') : null);
          if (!root) return '';
          const copy = root.cloneNode(true);
          copy.querySelectorAll('button, textarea, input, .reply-dock, .message-action-rail').forEach(node => node.remove());
          return (copy.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 7000);
        })()
        """
        do {
            return try await webView.evaluateJavaScript(script) as? String ?? ""
        } catch {
            return ""
        }
    }

    func insertReplyDraft(_ draft: String) {
        guard let webView,
              let draftJSON = try? Self.javascriptString(draft) else { return }
        webView.evaluateJavaScript(
            """
            (() => {
              const field = document.querySelector('.reply-box textarea');
              if (!field) return false;
              const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              setter?.call(field, \(draftJSON));
              field.dispatchEvent(new Event('input', { bubbles: true }));
              field.focus();
              return true;
            })()
            """
        )
    }

    func performWebCommand(_ command: RubidiumWebCommand) {
        guard let webView else { return }
        let selector: String
        switch command {
        case .search: selector = ".search-trigger"
        case .compose: selector = ".compose-button"
        }
        webView.evaluateJavaScript(
            "document.querySelector('\(selector)')?.click()"
        )
    }

    func openThread(_ id: String) {
        guard let webView,
              let idJSON = try? Self.javascriptString(id) else { return }
        webView.evaluateJavaScript(
            "document.querySelector(`[data-thread-id=\"${CSS.escape(\(idJSON))}\"]`)?.click()"
        )
    }

    func signIn(with provider: String) {
        errorMessage = nil
        nativeAuthAction?("identity", provider, nil)
    }

    func connect(_ provider: String) async {
        do {
            let payload: RubidiumOneTimeTokenEnvelope = try await api(
                "/api/auth/one-time-token/generate"
            )
            nativeAuthAction?("connect", provider, payload.token)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func passwordAuthentication(
        email: String,
        password: String,
        createAccount: Bool
    ) async throws {
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var body: [String: Any] = [
            "email": normalizedEmail,
            "password": password,
        ]
        if createAccount {
            body["name"] = normalizedEmail.split(separator: "@").first.map(String.init) ?? "Rubidium user"
        }
        let path = createAccount
            ? "/api/auth/sign-up/email"
            : "/api/auth/sign-in/email"
        let _: RubidiumEmptyResponse = try await api(path, method: "POST", body: body)
        webView?.load(URLRequest(url: appURL))
        await refreshSession()
    }

    func signOut() async {
        do {
            let _: RubidiumEmptyResponse = try await api(
                "/api/auth/sign-out",
                method: "POST",
                body: [:]
            )
        } catch {
            // Clear the native state even when the network disappears; the
            // server session will be checked again on the next launch.
        }
        sessionState = .signedOut
        webView?.load(URLRequest(url: appURL.appendingPathComponent("settings")))
    }

    func refreshSession() async {
        guard webView != nil else { return }
        do {
            let payload: RubidiumSessionEnvelope = try await api("/api/session")
            if payload.authenticated, let email = payload.user?.email {
                sessionState = .signedIn(email: email)
            } else {
                sessionState = .signedOut
            }
        } catch {
            if sessionState == .loading {
                errorMessage = error.localizedDescription
                // Never strand the user behind the launch screen. The web
                // session may be unavailable or still warming up, but the
                // native sign-in surface remains usable and can retry.
                sessionState = .signedOut
            }
        }
    }

    func refreshConfiguration() async {
        do {
            let payload: RubidiumConfigurationEnvelope = try await api("/api/config")
            googleIdentityAvailable = payload.providers.google
            microsoftIdentityAvailable = payload.providers.microsoft
        } catch {
            googleIdentityAvailable = false
            microsoftIdentityAvailable = false
        }
    }

    func api<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: [String: Any]? = nil
    ) async throws -> T {
        guard let webView else {
            throw RubidiumAPIError(status: 0, message: "Rubidium is still starting.", code: nil)
        }
        let bodyText: String
        let hasBody: Bool
        if let body {
            let data = try JSONSerialization.data(withJSONObject: body)
            bodyText = String(decoding: data, as: UTF8.self)
            hasBody = true
        } else {
            bodyText = ""
            hasBody = false
        }
        // evaluateJavaScript cannot bridge a JavaScript Promise back to Swift
        // and reports "unsupported type". callAsyncJavaScript awaits the
        // fetch inside WebKit while preserving the WKWebView's HTTP-only
        // Better Auth session cookie.
        let script = """
        try {
          const response = await fetch(path, {
            method,
            credentials: 'include',
            headers: hasBody ? {'content-type': 'application/json'} : undefined,
            body: hasBody ? bodyText : undefined
          });
          const text = await response.text();
          return JSON.stringify({ok: response.ok, status: response.status, body: text});
        } catch (error) {
          const message = error instanceof Error ? error.message : 'The request could not be completed.';
          return JSON.stringify({
            ok: false,
            status: 0,
            body: JSON.stringify({error: message})
          });
        }
        """
        let result = try await webView.callAsyncJavaScript(
            script,
            arguments: [
                "path": path,
                "method": method,
                "hasBody": hasBody,
                "bodyText": bodyText,
            ],
            in: nil,
            contentWorld: .page
        )
        guard let raw = result as? String,
              let rawData = raw.data(using: .utf8) else {
            throw RubidiumAPIError(status: 0, message: "Rubidium returned an unreadable response.", code: nil)
        }
        let envelope = try JSONDecoder().decode(RubidiumAPIEnvelope.self, from: rawData)
        let data = Data(envelope.body.utf8)
        if !envelope.ok {
            let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw RubidiumAPIError(
                status: envelope.status,
                message: payload?["error"] as? String ?? "Request failed (\(envelope.status)).",
                code: payload?["code"] as? String
            )
        }
        if data.isEmpty, let empty = "{}".data(using: .utf8) {
            return try JSONDecoder().decode(T.self, from: empty)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func javascriptString(_ value: String) throws -> String {
        // JSONSerialization rejects scalar top-level values unless fragment
        // options are explicitly enabled. JSONEncoder produces the exact
        // JavaScript string literal we need and is safe for arbitrary OAuth
        // tokens, thread identifiers, and paths.
        let data = try JSONEncoder().encode(value)
        return String(decoding: data, as: UTF8.self)
    }
}

enum RubidiumWebCommand {
    case search
    case compose
}

struct RubidiumWebView: UIViewRepresentable {
    @ObservedObject var model: RubidiumBrowserModel
    @Environment(\.colorScheme) private var colorScheme

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(context.coordinator, name: "rubidiumHaptics")
        configuration.userContentController.add(context.coordinator, name: "rubidiumAuth")
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: "document.documentElement.dataset.rubidiumNative = 'true'",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: Self.hapticBridgeScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true
            )
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        // Horizontal gestures belong to Rubidium's mail actions, not browser history.
        webView.allowsBackForwardNavigationGestures = false
        // SwiftUI already places this representable inside the top and side
        // safe areas. Asking UIScrollView to adjust again creates a second
        // status-bar inset and visibly pushes the mailbox down.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.backgroundColor = UIColor.systemBackground
        webView.underPageBackgroundColor = webView.scrollView.backgroundColor
        webView.isOpaque = false

        context.coordinator.observeProgress(of: webView)
        model.nativeAuthAction = { [weak coordinator = context.coordinator] action, provider, token in
            coordinator?.beginAuthentication(action: action, provider: provider, token: token)
        }
        model.webView = webView
        // Establish the first-party WKWebView origin with a tiny JSON route.
        // Loading the complete Next.js inbox just to discover that a new user
        // is signed out can add several seconds to cold launch.
        webView.load(URLRequest(url: model.bootstrapURL, cachePolicy: .reloadIgnoringLocalCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        model.webView = webView
        let theme = colorScheme == .dark ? "dark" : "light"
        webView.evaluateJavaScript(
            "document.documentElement.dataset.rubidiumTheme = '\(theme)'; document.documentElement.dataset.rubidiumNative = 'true'"
        )
        context.coordinator.refreshNativeSafeArea(in: webView)
        webView.scrollView.backgroundColor = .systemBackground
        webView.underPageBackgroundColor = .systemBackground
    }

    private static let hapticBridgeScript = """
    (() => {
      if (window.__rubidiumHapticsInstalled) return;
      window.__rubidiumHapticsInstalled = true;
      const send = kind => window.webkit?.messageHandlers?.rubidiumHaptics?.postMessage(kind);
      const value = element => `${element?.innerText || ''} ${element?.getAttribute?.('aria-label') || ''} ${element?.title || ''}`.toLowerCase();
      document.addEventListener('click', event => {
        const target = event.target?.closest?.('button, a, [role="button"]');
        if (!target) return;
        const text = value(target);
        if (/delete|disconnect|remove/.test(text)) send('destructive');
        else if (/send|reply|archive|sync|connect|schedule|join|rsvp|save|create/.test(text)) send('action');
        else if (/inbox|current|today|accounts|settings|calendar/.test(text)) send('selection');
      }, true);
      document.addEventListener('focusin', event => {
        if (!event.target?.matches?.('input, textarea, select')) return;
        const restoreViewport = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        requestAnimationFrame(restoreViewport);
        setTimeout(restoreViewport, 80);
        setTimeout(restoreViewport, 260);
      }, true);
      const seen = new WeakSet();
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element) || seen.has(node)) continue;
            const alert = node.matches?.('[role="alert"], .settings-success, .settings-error')
              ? node
              : node.querySelector?.('[role="alert"], .settings-success, .settings-error');
            if (!alert) continue;
            seen.add(node);
            send(/error|failed|invalid|unable/.test(value(alert)) ? 'error' : 'success');
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    })();
    """

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
        private let model: RubidiumBrowserModel
        private var progressObservation: NSKeyValueObservation?
        private var authenticationSession: ASWebAuthenticationSession?
        private var lastConnectedURL: String?

        init(model: RubidiumBrowserModel) {
            self.model = model
        }

        deinit {
            progressObservation?.invalidate()
        }

        func observeProgress(of webView: WKWebView) {
            progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
                Task { @MainActor in
                    self?.model.progress = max(0.04, webView.estimatedProgress)
                }
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            model.isLoading = true
            model.errorMessage = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            refreshNativeSafeArea(in: webView)
            applyNativeAppearance(to: webView)
            refreshPageContext(in: webView)
            model.progress = 1
            model.isLoading = false
            model.errorMessage = nil
            if webView.url?.path == "/login" {
                model.sessionState = .signedOut
            }
            if let url = webView.url,
               URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "connected" }) == true,
               lastConnectedURL != url.absoluteString {
                lastConnectedURL = url.absoluteString
                model.connectionRevision += 1
            }
            if webView.url?.path != "/api/session" {
                model.contentRevision += 1
            }
            Task {
                await model.refreshConfiguration()
                await model.refreshSession()
                if webView.url?.path == "/api/session",
                   case .signedIn = model.sessionState {
                    webView.load(URLRequest(url: model.appURL))
                }
            }
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            show(error)
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.frameInfo.securityOrigin.host == "rbmail-production.up.railway.app" else {
                return
            }
            if message.name == "rubidiumAuth" {
                guard let body = message.body as? [String: Any],
                      let action = body["action"] as? String,
                      let provider = body["provider"] as? String else { return }
                beginAuthentication(
                    action: action,
                    provider: provider,
                    token: body["token"] as? String
                )
                return
            }
            guard let cue = message.body as? String else { return }
            switch cue {
            case "selection": RubidiumHaptics.shared.play(.selection)
            case "action": RubidiumHaptics.shared.play(.action)
            case "destructive": RubidiumHaptics.shared.play(.destructive)
            case "success": RubidiumHaptics.shared.play(.success)
            case "error": RubidiumHaptics.shared.play(.error)
            default: break
            }
        }

        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            if let window = model.webView?.window { return window }
            return UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }

        fileprivate func beginAuthentication(action: String, provider: String, token: String?) {
            guard ["google", "microsoft"].contains(provider) else { return }
            let path: String
            var queryItems: [URLQueryItem] = []
            if action == "identity" {
                path = "/api/auth/native/start/\(provider)"
            } else if action == "connect", let token, !token.isEmpty {
                path = "/api/auth/native/resume"
                queryItems = [
                    URLQueryItem(name: "provider", value: provider),
                    URLQueryItem(name: "token", value: token),
                ]
            } else {
                return
            }
            guard var components = URLComponents(
                url: model.appURL.appendingPathComponent(path),
                resolvingAgainstBaseURL: false
            ) else { return }
            components.queryItems = queryItems.isEmpty ? nil : queryItems
            guard let url = components.url else { return }

            let completion: ASWebAuthenticationSession.CompletionHandler = { [weak self] callbackURL, error in
                Task { @MainActor in
                    guard let self else { return }
                    self.authenticationSession = nil
                    if let error = error as? ASWebAuthenticationSessionError,
                       error.code == .canceledLogin {
                        self.model.isLoading = false
                        return
                    }
                    guard let callbackURL else {
                        self.model.errorMessage = error?.localizedDescription ?? "Authentication did not complete."
                        self.model.isLoading = false
                        RubidiumHaptics.shared.play(.error)
                        return
                    }
                    self.handleAuthenticationCallback(callbackURL)
                }
            }

            if #available(iOS 17.4, *) {
                authenticationSession = ASWebAuthenticationSession(
                    url: url,
                    callback: .customScheme("rubidium"),
                    completionHandler: completion
                )
            } else {
                authenticationSession = ASWebAuthenticationSession(
                    url: url,
                    callbackURLScheme: "rubidium",
                    completionHandler: completion
                )
            }
            authenticationSession?.presentationContextProvider = self
            authenticationSession?.prefersEphemeralWebBrowserSession = false
            model.isLoading = true
            if authenticationSession?.start() != true {
                authenticationSession = nil
                model.isLoading = false
                model.errorMessage = "The secure sign-in window could not open."
                RubidiumHaptics.shared.play(.error)
            }
        }

        private func handleAuthenticationCallback(_ url: URL) {
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let values = Dictionary(
                uniqueKeysWithValues: (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") }
            )
            if url.path == "/error" || url.host == "error" {
                model.errorMessage = values["message"] ?? "Authentication failed."
                model.isLoading = false
                RubidiumHaptics.shared.play(.error)
                return
            }
            guard let token = values["token"], !token.isEmpty,
                  let webView = model.webView else {
                model.errorMessage = "Rubidium received an invalid authentication response."
                model.isLoading = false
                RubidiumHaptics.shared.play(.error)
                return
            }
            let destination = values["destination"]?.isEmpty == false
                ? values["destination"]!
                : "/"
            guard let tokenData = try? JSONEncoder().encode(token),
                  let destinationData = try? JSONEncoder().encode(destination),
                  let tokenJSON = String(data: tokenData, encoding: .utf8),
                  let destinationJSON = String(data: destinationData, encoding: .utf8) else { return }
            let script = """
            (async () => {
              const response = await fetch('/api/auth/one-time-token/verify', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                credentials: 'include',
                body: JSON.stringify({token: \(tokenJSON)})
              });
              if (!response.ok) throw new Error('Session handoff failed');
              location.assign(\(destinationJSON));
            })().catch(error => location.assign('/settings?error=' + encodeURIComponent(error.message)));
            """
            webView.evaluateJavaScript(script)
            RubidiumHaptics.shared.play(.success)
        }

        func refreshNativeSafeArea(in webView: WKWebView) {
            // didFinish can arrive before SwiftUI has attached and laid out
            // the representable. Re-measure across the first few layout passes
            // so an initial zero never places controls under the Dynamic Island.
            for delay in [0.0, 0.06, 0.22, 0.5] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self, weak webView] in
                    guard let self, let webView else { return }
                    self.applyNativeSafeArea(to: webView)
                }
            }
        }

        private func applyNativeSafeArea(to webView: WKWebView) {
            let keyWindow = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)
            let candidates = [
                webView.window?.safeAreaInsets,
                keyWindow?.safeAreaInsets,
                webView.safeAreaInsets,
            ].compactMap { $0 }
            let insets = candidates.reduce(UIEdgeInsets.zero) { current, candidate in
                UIEdgeInsets(
                    top: max(current.top, candidate.top),
                    left: max(current.left, candidate.left),
                    bottom: max(current.bottom, candidate.bottom),
                    right: max(current.right, candidate.right)
                )
            }
            webView.evaluateJavaScript(
                """
                // The mailbox paints edge-to-edge at the top and bottom. Its
                // controls consume these measured insets exactly once.
                document.documentElement.style.setProperty('--rubidium-native-safe-top', '\(insets.top)px');
                document.documentElement.style.setProperty('--rubidium-native-safe-right', '0px');
                document.documentElement.style.setProperty('--rubidium-native-safe-bottom', '\(insets.bottom)px');
                document.documentElement.style.setProperty('--rubidium-native-safe-left', '0px');
                """
            )
        }

        private func applyNativeAppearance(to webView: WKWebView) {
            let theme = webView.traitCollection.userInterfaceStyle == .dark ? "dark" : "light"
            webView.evaluateJavaScript(
                "document.documentElement.dataset.rubidiumTheme = '\(theme)'; document.documentElement.dataset.rubidiumNative = 'true'"
            )
            webView.scrollView.backgroundColor = .systemBackground
            webView.underPageBackgroundColor = .systemBackground
        }

        private func refreshPageContext(in webView: WKWebView) {
            webView.evaluateJavaScript("Boolean(document.querySelector('.mail-stage'))") { [weak self] value, _ in
                Task { @MainActor in
                    self?.model.isMailWorkspace = value as? Bool ?? false
                }
            }
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            show(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            model.errorMessage = "The mail view stopped unexpectedly."
            model.isLoading = false
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if let scheme = url.scheme?.lowercased(), ["mailto", "tel", "sms"].contains(scheme) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }

        private func show(_ error: Error) {
            let nsError = error as NSError
            if nsError.code == NSURLErrorCancelled { return }
            model.isLoading = false
            model.errorMessage = nsError.localizedDescription
        }
    }
}
