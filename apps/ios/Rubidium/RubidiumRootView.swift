import SwiftUI

struct RubidiumRootView: View {
    @EnvironmentObject private var browser: RubidiumBrowserModel
    @StateObject private var intelligence = RubidiumIntelligenceModel()
    @State private var isShowingIntelligence = false

    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.055, green: 0.055, blue: 0.05)
                .ignoresSafeArea()

            RubidiumWebView(model: browser)
                .ignoresSafeArea(.container, edges: .bottom)

            VStack {
                Spacer()
                HStack {
                    Spacer()
                    RubidiumIntelligenceButton(isActive: isShowingIntelligence) {
                        RubidiumHaptics.shared.play(.selection)
                        intelligence.refreshAvailability()
                        isShowingIntelligence = true
                    }
                }
                .padding(.trailing, 16)
                .padding(.bottom, 18)
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
        .animation(.spring(response: 0.38, dampingFraction: 0.86), value: browser.errorMessage)
        .background(Color(red: 0.055, green: 0.055, blue: 0.05))
        .sheet(isPresented: $isShowingIntelligence) {
            RubidiumIntelligenceView(intelligence: intelligence)
                .environmentObject(browser)
        }
        .onChange(of: browser.errorMessage) { _, error in
            if error != nil {
                RubidiumHaptics.shared.play(.error)
            }
        }
        .onAppear {
            RubidiumHaptics.shared.prepare()
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
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(.white.opacity(0.09), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.32), radius: 24, y: 10)
    }
}
