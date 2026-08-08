import SwiftUI
import UIKit

struct RubidiumRootView: View {
    @EnvironmentObject private var browser: RubidiumBrowserModel
    @StateObject private var intelligence = RubidiumIntelligenceModel()
    @StateObject private var nativeStore = RubidiumNativeStore()
    @State private var selectedTab: RubidiumNativeTab = .mail
    @State private var isShowingIntelligence = false
    @Namespace private var intelligenceNamespace

    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.949, green: 0.937, blue: 0.91)
                .ignoresSafeArea()

            // The persistent web view owns the secure HTTP-only session cookie.
            // Native surfaces request data through that same authenticated origin.
            RubidiumNativeShell(
                browser: browser,
                store: nativeStore,
                selection: $selectedTab,
                mail: AnyView(RubidiumWebView(model: browser)),
                intelligence: AnyView(intelligenceButton)
            )
            .opacity(isSignedIn ? 1 : 0)
            .allowsHitTesting(isSignedIn)

            switch browser.sessionState {
            case .loading:
                launchState
            case .signedOut:
                RubidiumNativeSignInView(browser: browser)
                    .transition(.opacity.combined(with: .scale(scale: 0.985)))
            case .signedIn:
                EmptyView()
            }

            if browser.isLoading && isSignedIn {
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
        }
        .animation(.smooth(duration: 0.32), value: browser.sessionState)
        .preferredColorScheme(.light)
        .sheet(isPresented: $isShowingIntelligence) {
            RubidiumIntelligenceView(intelligence: intelligence)
                .environmentObject(browser)
                .preferredColorScheme(.dark)
        }
        .onAppear {
            nativeStore.attach(browser)
            RubidiumHaptics.shared.prepare()
        }
        .onChange(of: browser.sessionState) { _, state in
            guard case .signedIn = state else { return }
            Task { await nativeStore.loadAll(force: true) }
        }
        .onChange(of: selectedTab) { _, _ in
            RubidiumHaptics.shared.play(.selection)
        }
        .onChange(of: browser.errorMessage) { _, error in
            if error != nil { RubidiumHaptics.shared.play(.error) }
        }
    }

    private var isSignedIn: Bool {
        if case .signedIn = browser.sessionState { return true }
        return false
    }

    private var launchState: some View {
        VStack(spacing: 18) {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 0.93, green: 0.13, blue: 0.12))
                .frame(width: 64, height: 64)
                .overlay {
                    Image(systemName: "diamond.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                }
            Text("Rubidium")
                .font(.system(.title, design: .serif, weight: .bold))
                .foregroundStyle(Color(red: 0.08, green: 0.08, blue: 0.07))
            ProgressView()
                .tint(Color(red: 0.08, green: 0.08, blue: 0.07))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.949, green: 0.937, blue: 0.91))
    }

    @ViewBuilder
    private var intelligenceButton: some View {
        if #available(iOS 26.0, *) {
            RubidiumIntelligenceButton(
                isActive: isShowingIntelligence,
                namespace: intelligenceNamespace
            ) {
                presentIntelligence()
            }
        } else {
            Button(action: presentIntelligence) {
                Image(systemName: "diamond.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
            }
            .buttonStyle(.plain)
            .rubidiumGlass(
                cornerRadius: 23,
                interactive: true,
                tint: Color(red: 0.86, green: 0.05, blue: 0.11).opacity(0.44)
            )
            .accessibilityLabel("Open Rubidium Intelligence")
        }
    }

    private func presentIntelligence() {
        RubidiumHaptics.shared.play(.selection)
        intelligence.refreshAvailability()
        withAnimation(.smooth(duration: 0.28, extraBounce: 0.04)) {
            isShowingIntelligence = true
        }
    }
}
