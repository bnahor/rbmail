# Rubidium native visual QA

## Intent

Restore Rubidium's earlier product language rather than reproduce Apple Mail: dense grouped conversations, warm neutral surfaces, dark charcoal navigation, ruby status accents, sender identities, semantic search, and one distinctive Rubidium intelligence control. Keep native iOS behavior for safe areas, swipes, sheets, Dynamic Type, and accessibility.

## Reference evidence

- Earlier Rubidium inbox: `/var/folders/wg/dfvp2c8s4k94qnsy6hccxhpm0000gn/T/TemporaryItems/NSIRD_screencaptureui_fQKXyZ/Screenshot 2026-08-08 at 20.33.54.png`
- Earlier Rubidium sidebar: `/var/folders/wg/dfvp2c8s4k94qnsy6hccxhpm0000gn/T/TemporaryItems/NSIRD_screencaptureui_OGyjYa/Screenshot 2026-08-08 at 21.10.38.png`
- Derivative pre-correction native inbox: `/tmp/rubidium-current-dark.png`

## Implementation evidence

- Dark, standard Dynamic Type: `/tmp/rubidium-redesign-dark-final.png`
- Light, standard Dynamic Type: `/tmp/rubidium-redesign-light-final.png`
- Dark, Accessibility XXXL after correction: `/tmp/rubidium-redesign-accessibility-fixed.png`
- Simulator viewport: iPhone 17 Pro, portrait, 402 × 874 points

## Comparison and corrections

| Severity | Finding | Correction | Result |
| --- | --- | --- | --- |
| P1 | Generic navigation and three-button bottom toolbar read as an Apple Mail imitation. | Replaced them with Rubidium's branded header, compact drawer, and one floating intelligence control. | Fixed |
| P1 | The new rows lost the earlier identity and information rhythm. | Restored sender color tiles, provider badge, ruby unread rail, subject/snippet hierarchy, date groups, and the separate conversation count line. | Fixed |
| P1 | Compact navigation and sidebar exposed competing routes and unsafe bottom geometry. | Replaced the bottom navigation with one animated leading drawer; retained `NavigationSplitView` only for regular-width layouts. | Fixed |
| P2 | The first accessibility render enlarged chrome until controls collided and labels clipped. | Capped navigation-control scaling, removed the nonessential account subtitle at accessibility sizes, and allowed subjects to expand vertically. | Fixed |
| P2 | Conversation detail retained generic system-card and toolbar styling. | Applied Rubidium surfaces and a single native reply plane with secondary actions in a menu. | Fixed |
| P2 | Search, Calendar, and Settings lacked a consistent compact entry into navigation. | Added the same Rubidium mailbox affordance and adaptive canvas treatment to every destination. | Fixed |

## Interaction review

- Leading and trailing native swipe actions remain attached to conversation rows.
- The compact drawer animates from the leading edge and dismisses by destination choice or scrim tap.
- Search and compose use full-screen native presentation; conversation navigation uses a native stack.
- Liquid Glass is limited to the genuinely floating intelligence and reply controls.
- VoiceOver labels exist for navigation, compose, filtering, AI, and conversation actions.
- Light, dark, and Accessibility XXXL renders show no overlapping or clipped controls.

## Final result

`passed`

No P0, P1, or P2 visual defects remain in the verified inbox states. Physical-device installation follows the signed build; Railway is intentionally unchanged.
