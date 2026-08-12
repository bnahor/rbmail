import SwiftUI
import UIKit

struct RubidiumRootView: View {
    @EnvironmentObject private var browser: RubidiumBrowserModel
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(RubidiumAppearance.storageKey) private var appearanceRaw = RubidiumAppearance.system.rawValue
    @StateObject private var intelligence = RubidiumIntelligenceModel()
    @StateObject private var nativeStore = RubidiumNativeStore()
    @StateObject private var security = RubidiumAppLockModel()
    @State private var isShowingIntelligence = false

    var body: some View {
        ZStack(alignment: .top) {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()

            // The persistent web view owns the secure HTTP-only session cookie.
            // Native surfaces request data through that same authenticated origin.
            RubidiumMailAppShell(
                browser: browser,
                store: nativeStore,
                security: security,
                isSignedIn: isSignedIn,
                presentIntelligence: presentIntelligence
            )
            .opacity(isSignedIn ? 1 : 0)
            .allowsHitTesting(isSignedIn)

            // WebKit is retained only as a secure first-party session broker.
            // It never renders the mailbox, composer, search, or navigation.
            RubidiumWebView(model: browser)
                .frame(width: 1, height: 1)
                .opacity(0.001)
                .allowsHitTesting(false)
                .accessibilityHidden(true)

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

            if isSignedIn && security.isEnabled && !security.isUnlocked {
                RubidiumLockView(security: security)
                    .transition(.opacity)
                    .zIndex(100)
            }
        }
        .animation(.smooth(duration: 0.32), value: browser.sessionState)
        .animation(.smooth(duration: 0.24), value: security.isUnlocked)
        .preferredColorScheme(appearance.colorScheme)
        .sheet(isPresented: $isShowingIntelligence) {
            RubidiumIntelligenceView(
                intelligence: intelligence,
                context: nativeStore.intelligenceContext
            )
        }
        .onAppear {
            nativeStore.attach(browser)
            RubidiumNotifications.shared.attach(browser)
            RubidiumHaptics.shared.prepare()
        }
        .onChange(of: browser.contentRevision) { _, _ in
            guard isSignedIn else { return }
            Task { await nativeStore.loadAll(force: true) }
        }
        .onChange(of: browser.connectionRevision) { _, _ in
            Task { await nativeStore.reloadAfterConnection() }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                intelligence.refreshAvailability()
                security.applicationDidBecomeActive()
            case .inactive, .background:
                security.applicationWillResignActive()
            @unknown default:
                break
            }
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
            RubidiumBrandMark(size: 72, cornerRadius: 20)
            Text("Rubidium")
                .font(.system(.title, design: .serif, weight: .bold))
            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
    }

    private func presentIntelligence() {
        RubidiumHaptics.shared.play(.selection)
        intelligence.refreshAvailability()
        withAnimation(.smooth(duration: 0.28, extraBounce: 0.04)) {
            isShowingIntelligence = true
        }
    }

    private var appearance: RubidiumAppearance {
        RubidiumAppearance(rawValue: appearanceRaw) ?? .system
    }
}
