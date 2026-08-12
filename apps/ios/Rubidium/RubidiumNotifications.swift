import UIKit
import UserNotifications

@MainActor
final class RubidiumQuickActions: ObservableObject {
    enum Action: String, Hashable {
        case compose = "dev.bnahor.rubidium.compose"
        case search = "dev.bnahor.rubidium.search"
        case today = "dev.bnahor.rubidium.today"
    }

    static let shared = RubidiumQuickActions()

    @Published private(set) var pendingAction: Action?

    @discardableResult
    func enqueue(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
        guard let action = Action(rawValue: shortcutItem.type) else { return false }
        pendingAction = action
        return true
    }

    func consume() -> Action? {
        defer { pendingAction = nil }
        return pendingAction
    }
}

@MainActor
final class RubidiumSceneDelegate: NSObject, UIWindowSceneDelegate {
    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        if let shortcutItem = connectionOptions.shortcutItem {
            RubidiumQuickActions.shared.enqueue(shortcutItem)
        }
    }

    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem
    ) async -> Bool {
        RubidiumQuickActions.shared.enqueue(shortcutItem)
    }
}

@MainActor
final class RubidiumNotifications: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = RubidiumNotifications()

    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published var pendingThreadId: String?
    @Published var errorMessage: String?

    private weak var browser: RubidiumBrowserModel?

    func attach(_ browser: RubidiumBrowserModel) {
        self.browser = browser
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        registerCategories(center)
        Task { await refreshStatus() }
    }

    func requestAuthorization() async {
        do {
            let accepted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await refreshStatus()
            if accepted { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            errorMessage = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
        }
    }

    func refreshStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
        if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func register(token data: Data) {
        guard let browser else { return }
        let token = data.map { String(format: "%02x", $0) }.joined()
        Task {
            do {
                struct DeviceResponse: Decodable { let deviceId: String }
                #if DEBUG
                let environment = "sandbox"
                #else
                let environment = "production"
                #endif
                let _: DeviceResponse = try await browser.api(
                    "/api/native/devices",
                    method: "POST",
                    body: ["token": token, "environment": environment]
                )
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    func registrationFailed(_ error: Error) {
        errorMessage = error.localizedDescription
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        // The native inbox refreshes in place while foregrounded; avoid a
        // duplicate banner and retain badge delivery only.
        return [.badge]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        let threadId = (info["route"] as? [String: Any])?["threadId"] as? String
        let actionIdentifier = response.actionIdentifier
        await MainActor.run {
            pendingThreadId = threadId
            if actionIdentifier != UNNotificationDefaultActionIdentifier,
               actionIdentifier != UNNotificationDismissActionIdentifier,
               let threadId {
                Task { await perform(actionIdentifier, threadId: threadId) }
            }
        }
    }

    private func perform(_ identifier: String, threadId: String) async {
        guard let browser else { return }
        let action: String
        switch identifier {
        case "RUBIDIUM_READ": action = "read"
        case "RUBIDIUM_ARCHIVE": action = "archive"
        case "RUBIDIUM_FLAG": action = "flag"
        default: return
        }
        let encoded = RubidiumURL.pathSegment(threadId)
        do {
            struct ActionResponse: Decodable { let ok: Bool }
            let _: ActionResponse = try await browser.api(
                "/api/threads/\(encoded)/action",
                method: "POST",
                body: ["action": action],
                headers: ["Idempotency-Key": UUID().uuidString]
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func registerCategories(_ center: UNUserNotificationCenter) {
        let actions = [
            UNNotificationAction(identifier: "RUBIDIUM_READ", title: "Mark Read", options: []),
            UNNotificationAction(identifier: "RUBIDIUM_ARCHIVE", title: "Archive", options: []),
            UNNotificationAction(identifier: "RUBIDIUM_FLAG", title: "Flag", options: []),
        ]
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: "RUBIDIUM_NEW_MAIL",
                actions: actions,
                intentIdentifiers: [],
                options: [.customDismissAction]
            )
        ])
    }
}

final class RubidiumAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(
            name: nil,
            sessionRole: connectingSceneSession.role
        )
        if connectingSceneSession.role == .windowApplication {
            configuration.delegateClass = RubidiumSceneDelegate.self
        }
        return configuration
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in RubidiumNotifications.shared.register(token: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in RubidiumNotifications.shared.registrationFailed(error) }
    }
}
