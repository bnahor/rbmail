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
