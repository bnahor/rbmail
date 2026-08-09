import SwiftUI

enum RubidiumTheme {
    static let accent = Color(red: 0.94, green: 0.18, blue: 0.12)
    static let accentSoft = Color(red: 0.96, green: 0.38, blue: 0.31)
    static let canvas = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.035, green: 0.039, blue: 0.043, alpha: 1)
            : UIColor(red: 0.965, green: 0.955, blue: 0.925, alpha: 1)
    })
    static let surface = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.075, green: 0.082, blue: 0.087, alpha: 1)
            : UIColor(red: 0.995, green: 0.988, blue: 0.965, alpha: 1)
    })
    static let elevated = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.105, green: 0.115, blue: 0.12, alpha: 1)
            : UIColor(red: 1, green: 0.998, blue: 0.985, alpha: 1)
    })
    static let sidebar = Color(red: 0.055, green: 0.061, blue: 0.061)
    static let sidebarSurface = Color(red: 0.095, green: 0.105, blue: 0.103)
    static let rule = Color.primary.opacity(0.11)
}

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

    func rubidiumPlane(cornerRadius: CGFloat = 14) -> some View {
        self
            .background(
                RubidiumTheme.surface,
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(.primary.opacity(0.1), lineWidth: 0.75)
            }
            .shadow(color: .black.opacity(0.08), radius: 12, y: 5)
    }
}
