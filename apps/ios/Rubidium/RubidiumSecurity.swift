import LocalAuthentication
import SwiftUI

enum RubidiumAppearance: String, CaseIterable, Identifiable {
    static let storageKey = "rubidium.appearance"

    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

struct RubidiumBrandMark: View {
    var size: CGFloat
    var cornerRadius: CGFloat

    init(size: CGFloat = 52, cornerRadius: CGFloat = 15) {
        self.size = size
        self.cornerRadius = cornerRadius
    }

    var body: some View {
        Image("RubidiumMark")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .accessibilityHidden(true)
    }
}

@MainActor
final class RubidiumAppLockModel: ObservableObject {
    static let enabledKey = "rubidium.appLock.enabled"

    @Published private(set) var isEnabled: Bool
    @Published private(set) var isUnlocked: Bool
    @Published private(set) var isAuthenticating = false
    @Published var errorMessage: String?

    init(defaults: UserDefaults = .standard) {
        let enabled = defaults.bool(forKey: Self.enabledKey)
        isEnabled = enabled
        isUnlocked = !enabled
    }

    var authenticationLabel: String {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return "Device passcode"
        }
        switch context.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        case .none: return "Device passcode"
        @unknown default: return "Biometrics"
        }
    }

    func setEnabled(_ enabled: Bool) async {
        guard enabled != isEnabled else { return }
        if enabled {
            guard await authenticate(reason: "Enable privacy lock for Rubidium") else { return }
            UserDefaults.standard.set(true, forKey: Self.enabledKey)
            isEnabled = true
            isUnlocked = true
            RubidiumHaptics.shared.play(.success)
        } else {
            UserDefaults.standard.set(false, forKey: Self.enabledKey)
            isEnabled = false
            isUnlocked = true
            errorMessage = nil
            RubidiumHaptics.shared.play(.selection)
        }
    }

    func unlock() async {
        guard isEnabled, !isUnlocked, !isAuthenticating else { return }
        if await authenticate(reason: "Unlock your Rubidium inbox") {
            isUnlocked = true
            RubidiumHaptics.shared.play(.success)
        }
    }

    func lock() {
        guard isEnabled else { return }
        isUnlocked = false
        errorMessage = nil
    }

    func applicationDidBecomeActive() {
        guard isEnabled, !isUnlocked else { return }
        Task { await unlock() }
    }

    func applicationWillResignActive() {
        lock()
    }

    @discardableResult
    private func authenticate(reason: String) async -> Bool {
        guard !isAuthenticating else { return false }
        isAuthenticating = true
        errorMessage = nil
        defer { isAuthenticating = false }

        let context = LAContext()
        context.localizedCancelTitle = "Keep locked"
        context.localizedFallbackTitle = "Use device passcode"
        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            errorMessage = policyError?.localizedDescription ?? "Set a device passcode to protect Rubidium."
            RubidiumHaptics.shared.play(.error)
            return false
        }

        do {
            return try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: reason
            )
        } catch let error as LAError where error.code == .userCancel || error.code == .appCancel {
            return false
        } catch {
            errorMessage = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
            return false
        }
    }
}

struct RubidiumLockView: View {
    @ObservedObject var security: RubidiumAppLockModel

    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                RubidiumBrandMark(size: 76, cornerRadius: 21)

                VStack(spacing: 7) {
                    Text("Rubidium is locked")
                        .font(.system(.title, design: .serif, weight: .bold))
                    Text("Your inbox stays hidden whenever you leave the app.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                Button {
                    RubidiumHaptics.shared.play(.action)
                    Task { await security.unlock() }
                } label: {
                    HStack(spacing: 9) {
                        if security.isAuthenticating {
                            ProgressView()
                        } else {
                            Image(systemName: "faceid")
                        }
                        Text("Unlock with \(security.authenticationLabel)")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 16))
                .controlSize(.large)
                .disabled(security.isAuthenticating)
                .frame(maxWidth: 330)

                if let error = security.errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 330)
                }
            }
            .padding(28)
        }
        .accessibilityElement(children: .contain)
    }
}
