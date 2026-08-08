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
}

struct RubidiumIntelligenceButton: View {
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Rubidium Intelligence", systemImage: isActive ? "sparkles" : "diamond.fill")
                .labelStyle(.iconOnly)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .rubidiumGlass(
            cornerRadius: 22,
            interactive: true,
            tint: Color(red: 0.86, green: 0.05, blue: 0.11).opacity(0.44)
        )
        .scaleEffect(isActive ? 1.045 : 1)
        .animation(.spring(response: 0.34, dampingFraction: 0.72), value: isActive)
        .accessibilityLabel("Open Rubidium Intelligence")
        .accessibilityHint("Summarize, find next steps, or draft a reply using Apple’s on-device model")
    }
}
