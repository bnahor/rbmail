import SwiftUI

@main
struct RubidiumApp: App {
    @StateObject private var browser = RubidiumBrowserModel()

    var body: some Scene {
        WindowGroup {
            RubidiumRootView()
                .environmentObject(browser)
                .preferredColorScheme(.dark)
        }
    }
}
