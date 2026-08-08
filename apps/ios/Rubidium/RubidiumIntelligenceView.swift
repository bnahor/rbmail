import SwiftUI
import UIKit

struct RubidiumIntelligenceView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var browser: RubidiumBrowserModel
    @ObservedObject var intelligence: RubidiumIntelligenceModel

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
                            .transition(.scale(scale: 0.96).combined(with: .opacity))
                    } else if !intelligence.result.isEmpty {
                        resultView
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }

                    if let error = intelligence.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .rubidiumGlass(cornerRadius: 16)
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
            .animation(.spring(response: 0.42, dampingFraction: 0.84), value: intelligence.isGenerating)
            .animation(.spring(response: 0.42, dampingFraction: 0.84), value: intelligence.result)
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
                Button("Check again") {
                    RubidiumHaptics.shared.play(.action)
                    intelligence.refreshAvailability()
                }
                .buttonStyle(.bordered)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .rubidiumGlass(cornerRadius: 18)
        }
    }

    private var actionGrid: some View {
        VStack(spacing: 10) {
            ForEach(RubidiumIntelligenceAction.allCases) { action in
                Button {
                    RubidiumHaptics.shared.play(.action)
                    Task {
                        let context = await browser.visibleMailContext()
                        await intelligence.perform(action, context: context)
                    }
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: action.symbol)
                            .font(.system(size: 17, weight: .semibold))
                            .frame(width: 34, height: 34)
                            .background(Color.red.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
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
                .buttonStyle(.plain)
                .rubidiumGlass(cornerRadius: 17, interactive: true)
                .disabled(intelligence.isGenerating)
            }
        }
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
        .rubidiumGlass(cornerRadius: 18, tint: .red.opacity(0.08))
    }

    private var resultView: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(intelligence.selectedAction?.title ?? "Result", systemImage: "sparkles")
                    .font(.headline)
                Spacer()
                Button {
                    UIPasteboard.general.string = intelligence.result
                    RubidiumHaptics.shared.play(.success)
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .accessibilityLabel("Copy result")
            }
            Text(intelligence.result)
                .font(.body)
                .textSelection(.enabled)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .rubidiumGlass(cornerRadius: 20, tint: .red.opacity(0.07))
    }
}
