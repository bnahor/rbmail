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

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.backgroundColor = UIColor(
            red: 0.055,
            green: 0.055,
            blue: 0.05,
            alpha: 1
        )
        webView.isOpaque = false

        context.coordinator.observeProgress(of: webView)
        model.webView = webView
        webView.load(URLRequest(url: model.appURL, cachePolicy: .useProtocolCachePolicy))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        model.webView = webView
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
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
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
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
