import SwiftUI

extension View {
    @ViewBuilder
    func rubidiumGlass(
        cornerRadius: CGFloat = 20,
        interactive: Bool = false,
        tint: Color? = nil
    ) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(
                .regular.tint(tint).interactive(interactive),
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
        } else {
            self
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(.white.opacity(0.11), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.28), radius: 22, y: 10)
        }
    }

    func rubidiumContentPanel(cornerRadius: CGFloat = 20) -> some View {
        self
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(.primary.opacity(0.08), lineWidth: 0.75)
            }
    }
}

struct RubidiumIntelligenceButton: View {
    let isActive: Bool
    let namespace: Namespace.ID
    let action: () -> Void

    @ViewBuilder
    var body: some View {
        if #available(iOS 26.0, *) {
            button
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .tint(Color(red: 0.86, green: 0.05, blue: 0.11))
                .glassEffectID("rubidium-intelligence", in: namespace)
                .glassEffectTransition(.materialize)
        } else {
            button
                .buttonStyle(.plain)
                .rubidiumGlass(
                    cornerRadius: 22,
                    interactive: true,
                    tint: Color(red: 0.86, green: 0.05, blue: 0.11).opacity(0.44)
                )
        }
    }

    private var button: some View {
        Button(action: action) {
            Image(systemName: isActive ? "sparkles" : "diamond.fill")
                .contentTransition(.symbolEffect(.replace))
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .accessibilityLabel("Open Rubidium Intelligence")
        .accessibilityHint("Summarize, find next steps, or draft a reply using Apple’s on-device model")
    }
}
