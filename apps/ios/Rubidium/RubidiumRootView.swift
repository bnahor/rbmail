import SwiftUI
import UIKit

struct RubidiumRootView: View {
    @EnvironmentObject private var browser: RubidiumBrowserModel
    @StateObject private var intelligence = RubidiumIntelligenceModel()
    @State private var isShowingIntelligence = false
    @State private var isKeyboardVisible = false
    @Namespace private var controlPlaneNamespace

    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.949, green: 0.937, blue: 0.91)
                .ignoresSafeArea()

            RubidiumWebView(model: browser)
                .ignoresSafeArea()

            if !isKeyboardVisible && browser.isMailWorkspace {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        controlPlane
                    }
                    .padding(.trailing, 12)
                    .padding(.bottom, 14)
                }
                .transition(.blurReplace)
            }

            if browser.isLoading {
                GeometryReader { geometry in
                    Rectangle()
                        .fill(Color(red: 0.94, green: 0.12, blue: 0.16))
                        .frame(
                            width: max(18, geometry.size.width * browser.progress),
                            height: 2
                        )
                        .animation(.easeOut(duration: 0.18), value: browser.progress)
                }
                .frame(height: 2)
                .accessibilityLabel("Loading Rubidium")
            }

            if let error = browser.errorMessage {
                errorCard(error)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
            }
        }
        .animation(.smooth(duration: 0.34), value: browser.errorMessage)
        .background(Color(red: 0.949, green: 0.937, blue: 0.91))
        .preferredColorScheme(.light)
        .sheet(isPresented: $isShowingIntelligence) {
            RubidiumIntelligenceView(intelligence: intelligence)
                .environmentObject(browser)
                .preferredColorScheme(.dark)
        }
        .onChange(of: browser.errorMessage) { _, error in
            if error != nil {
                RubidiumHaptics.shared.play(.error)
            }
        }
        .onAppear {
            RubidiumHaptics.shared.prepare()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { notification in
            withAnimation(.easeOut(duration: 0.16)) {
                isKeyboardVisible = true
            }
            let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
            let overlap = keyboardFrame.map {
                max(0, UIScreen.main.bounds.height - $0.minY)
            } ?? 0
            browser.stabilizeViewportAfterKeyboardChange(overlap: overlap)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            withAnimation(.smooth(duration: 0.3, extraBounce: 0.04)) {
                isKeyboardVisible = false
            }
            browser.stabilizeViewportAfterKeyboardChange(overlap: 0)
        }
    }

    @ViewBuilder
    private var controlPlane: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 10) {
                HStack(spacing: 8) {
                    webCommandButton(.search, symbol: "magnifyingglass", label: "Search mail")
                    webCommandButton(.compose, symbol: "square.and.pencil", label: "New message")
                    intelligenceButton
                }
            }
        } else {
            HStack(spacing: 8) {
                webCommandButton(.search, symbol: "magnifyingglass", label: "Search mail")
                webCommandButton(.compose, symbol: "square.and.pencil", label: "New message")
                intelligenceButton
            }
            .padding(6)
            .rubidiumGlass(cornerRadius: 28)
        }
    }

    @ViewBuilder
    private func webCommandButton(
        _ command: RubidiumWebCommand,
        symbol: String,
        label: String
    ) -> some View {
        let button = Button {
            RubidiumHaptics.shared.play(.selection)
            browser.performWebCommand(command)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .semibold))
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .accessibilityLabel(label)

        if #available(iOS 26.0, *) {
            button
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
        } else {
            button.buttonStyle(.plain)
        }
    }

    private var intelligenceButton: some View {
        RubidiumIntelligenceButton(
            isActive: isShowingIntelligence,
            namespace: controlPlaneNamespace
        ) {
            RubidiumHaptics.shared.play(.selection)
            intelligence.refreshAvailability()
            withAnimation(.smooth(duration: 0.28, extraBounce: 0.04)) {
                isShowingIntelligence = true
            }
        }
    }

    private func errorCard(_ message: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color(red: 0.94, green: 0.12, blue: 0.16))

            VStack(alignment: .leading, spacing: 2) {
                Text("Rubidium is offline")
                    .font(.system(size: 14, weight: .semibold))
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 8)

            Button("Retry") {
                RubidiumHaptics.shared.play(.action)
                browser.reload()
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.94, green: 0.12, blue: 0.16))
            .controlSize(.small)
        }
        .padding(14)
        .rubidiumContentPanel(cornerRadius: 14)
        .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
    }
}
