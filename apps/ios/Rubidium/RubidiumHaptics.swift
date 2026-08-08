import CoreHaptics
import UIKit

@MainActor
final class RubidiumHaptics {
    static let shared = RubidiumHaptics()

    enum Cue {
        case selection
        case action
        case destructive
        case success
        case warning
        case error
        case intelligenceStart
        case intelligenceComplete
    }

    private var engine: CHHapticEngine?
    private let supportsCustomHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics

    private init() {
        prepare()
    }

    func prepare() {
        guard supportsCustomHaptics, engine == nil else { return }
        do {
            let engine = try CHHapticEngine()
            engine.isAutoShutdownEnabled = true
            engine.resetHandler = { [weak self] in
                Task { @MainActor in
                    try? self?.engine?.start()
                }
            }
            try engine.start()
            self.engine = engine
        } catch {
            engine = nil
        }
    }

    func play(_ cue: Cue) {
        switch cue {
        case .selection:
            let generator = UISelectionFeedbackGenerator()
            generator.prepare()
            generator.selectionChanged()
        case .action:
            impact(style: .light, intensity: 0.72)
        case .destructive:
            impact(style: .rigid, intensity: 0.82)
        case .success:
            notification(.success)
        case .warning:
            notification(.warning)
        case .error:
            notification(.error)
        case .intelligenceStart:
            playIntelligencePattern(completing: false)
        case .intelligenceComplete:
            playIntelligencePattern(completing: true)
        }
    }

    private func impact(style: UIImpactFeedbackGenerator.FeedbackStyle, intensity: CGFloat) {
        let generator = UIImpactFeedbackGenerator(style: style)
        generator.prepare()
        generator.impactOccurred(intensity: intensity)
    }

    private func notification(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(type)
    }

    private func playIntelligencePattern(completing: Bool) {
        guard supportsCustomHaptics else {
            completing ? notification(.success) : impact(style: .soft, intensity: 0.7)
            return
        }

        prepare()
        let events: [CHHapticEvent]
        if completing {
            events = [
                transient(intensity: 0.38, sharpness: 0.42, at: 0),
                transient(intensity: 0.72, sharpness: 0.7, at: 0.11),
            ]
        } else {
            events = [
                transient(intensity: 0.62, sharpness: 0.28, at: 0),
                transient(intensity: 0.28, sharpness: 0.58, at: 0.09),
            ]
        }

        do {
            let pattern = try CHHapticPattern(events: events, parameters: [])
            let player = try engine?.makePlayer(with: pattern)
            try engine?.start()
            try player?.start(atTime: CHHapticTimeImmediate)
        } catch {
            completing ? notification(.success) : impact(style: .soft, intensity: 0.7)
        }
    }

    private func transient(
        intensity: Float,
        sharpness: Float,
        at time: TimeInterval
    ) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: time
        )
    }
}
