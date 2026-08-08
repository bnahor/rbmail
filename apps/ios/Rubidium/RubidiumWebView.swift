import SwiftUI
import UIKit
import WebKit

@MainActor
final class RubidiumBrowserModel: ObservableObject {
    @Published var isLoading = true
    @Published var progress = 0.08
    @Published var errorMessage: String?

    weak var webView: WKWebView?

    var appURL: URL {
        let configured = Bundle.main.object(forInfoDictionaryKey: "RBMailAppURL") as? String
        return URL(string: configured ?? "https://rbmail-production.up.railway.app")!
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
          const root = document.querySelector('main') || document.body;
          return (root?.innerText || '').slice(0, 12000);
        })()
        """
        do {
            return try await webView.evaluateJavaScript(script) as? String ?? ""
        } catch {
            return ""
        }
    }
}

struct RubidiumWebView: UIViewRepresentable {
    @ObservedObject var model: RubidiumBrowserModel

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
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.backgroundColor = UIColor(
            red: 0.949,
            green: 0.937,
            blue: 0.91,
            alpha: 1
        )
        webView.underPageBackgroundColor = webView.scrollView.backgroundColor
        webView.isOpaque = false

        context.coordinator.observeProgress(of: webView)
        model.webView = webView
        webView.load(URLRequest(url: model.appURL, cachePolicy: .useProtocolCachePolicy))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        model.webView = webView
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
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private let model: RubidiumBrowserModel
        private var progressObservation: NSKeyValueObservation?

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
            model.progress = 1
            model.isLoading = false
            model.errorMessage = nil
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
            guard message.frameInfo.securityOrigin.host == "rbmail-production.up.railway.app",
                  let cue = message.body as? String else { return }
            switch cue {
            case "selection": RubidiumHaptics.shared.play(.selection)
            case "action": RubidiumHaptics.shared.play(.action)
            case "destructive": RubidiumHaptics.shared.play(.destructive)
            case "success": RubidiumHaptics.shared.play(.success)
            case "error": RubidiumHaptics.shared.play(.error)
            default: break
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
