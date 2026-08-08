import SwiftUI
import UIKit

struct RubidiumIntelligenceView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var browser: RubidiumBrowserModel
    @ObservedObject var intelligence: RubidiumIntelligenceModel
    @Namespace private var intelligenceGlassNamespace

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    modelStatus

                    if case .ready = intelligence.availability {
                        actionGrid
                    }

                    if intelligence.isGenerating {
                        generatingView
                            .transition(.blurReplace)
                    } else if !intelligence.result.isEmpty {
                        resultView
                            .transition(.blurReplace)
                    }

                    if let error = intelligence.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .rubidiumContentPanel(cornerRadius: 16)
                    }
                }
                .padding(20)
            }
            .background {
                ZStack {
                    Color(red: 0.045, green: 0.045, blue: 0.043)
                    RadialGradient(
                        colors: [Color.red.opacity(0.17), .clear],
                        center: .topTrailing,
                        startRadius: 0,
                        endRadius: 420
                    )
                }
                .ignoresSafeArea()
            }
            .navigationTitle("Intelligence")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        RubidiumHaptics.shared.play(.selection)
                        dismiss()
                    }
                }
            }
            .animation(.smooth(duration: 0.4, extraBounce: 0.03), value: intelligence.isGenerating)
            .animation(.smooth(duration: 0.4, extraBounce: 0.03), value: intelligence.result)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var modelStatus: some View {
        switch intelligence.availability {
        case .checking:
            Label("Checking Apple Intelligence…", systemImage: "sparkles")
                .foregroundStyle(.secondary)
        case .ready:
            VStack(alignment: .leading, spacing: 6) {
                Label("On-device and private", systemImage: "checkmark.shield.fill")
                    .font(.headline)
                    .foregroundStyle(Color(red: 0.94, green: 0.16, blue: 0.2))
                Text("Only the text visible in the current Rubidium view is passed to Apple’s on-device model. Nothing is sent automatically.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .unavailable(let reason):
            VStack(alignment: .leading, spacing: 8) {
                Label("On-device model unavailable", systemImage: "sparkles")
                    .font(.headline)
                Text(reason)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                checkAgainButton
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .rubidiumContentPanel(cornerRadius: 18)
        }
    }

    @ViewBuilder
    private var checkAgainButton: some View {
        if #available(iOS 26.0, *) {
            Button("Check again", action: checkAvailability)
                .buttonStyle(.glass)
        } else {
            Button("Check again", action: checkAvailability)
                .buttonStyle(.bordered)
        }
    }

    private func checkAvailability() {
        RubidiumHaptics.shared.play(.action)
        intelligence.refreshAvailability()
    }

    @ViewBuilder
    private var actionGrid: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 10) {
                actionButtons
            }
        } else {
            actionButtons
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 10) {
            ForEach(RubidiumIntelligenceAction.allCases) { action in
                actionButton(action)
            }
        }
    }

    @ViewBuilder
    private func actionButton(_ action: RubidiumIntelligenceAction) -> some View {
        if #available(iOS 26.0, *) {
            actionButtonBase(action)
                .buttonStyle(.glass)
                .buttonBorderShape(.roundedRectangle(radius: 17))
                .glassEffectID(action.id, in: intelligenceGlassNamespace)
                .glassEffectTransition(.matchedGeometry)
        } else {
            actionButtonBase(action)
                .buttonStyle(.plain)
                .rubidiumGlass(cornerRadius: 17, interactive: true)
        }
    }

    private func actionButtonBase(_ action: RubidiumIntelligenceAction) -> some View {
        Button {
            RubidiumHaptics.shared.play(.action)
            Task {
                let context = await browser.visibleMailContext()
                await intelligence.perform(action, context: context)
            }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: action.symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.red)
                    .frame(width: 30, height: 30)
                    .symbolEffect(.bounce, value: intelligence.selectedAction == action)
                VStack(alignment: .leading, spacing: 2) {
                    Text(action.title)
                        .font(.headline)
                    Text(action.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .contentShape(Rectangle())
        }
        .disabled(intelligence.isGenerating)
    }

    private var generatingView: some View {
        HStack(spacing: 12) {
            ProgressView()
                .tint(.red)
            VStack(alignment: .leading, spacing: 2) {
                Text(intelligence.selectedAction?.title ?? "Thinking")
                    .font(.headline)
                Text("Running privately on this device")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .rubidiumContentPanel(cornerRadius: 18)
    }

    private var resultView: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(intelligence.selectedAction?.title ?? "Result", systemImage: "sparkles")
                    .font(.headline)
                Spacer()
                copyButton
            }
            Text(intelligence.result)
                .font(.body)
                .textSelection(.enabled)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .rubidiumContentPanel(cornerRadius: 20)
    }

    @ViewBuilder
    private var copyButton: some View {
        if #available(iOS 26.0, *) {
            copyButtonBase
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
        } else {
            copyButtonBase
                .buttonStyle(.plain)
        }
    }

    private var copyButtonBase: some View {
        Button {
            UIPasteboard.general.string = intelligence.result
            RubidiumHaptics.shared.play(.success)
        } label: {
            Image(systemName: "doc.on.doc")
                .contentTransition(.symbolEffect(.replace))
        }
        .accessibilityLabel("Copy result")
    }
}
