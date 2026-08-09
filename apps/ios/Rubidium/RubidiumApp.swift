import SwiftUI

@main
struct RubidiumApp: App {
    @UIApplicationDelegateAdaptor(RubidiumAppDelegate.self) private var appDelegate
    @StateObject private var browser = RubidiumBrowserModel()

    var body: some Scene {
        WindowGroup {
            RubidiumRootView()
                .environmentObject(browser)
        }
    }
}
