# Design QA — Conversation Current

Reference: `design/selected-option-2-conversation-current.png`  
Implementation: `design/implementation-final.png`  
Combined comparison: `design/design-qa-final-comparison.png`  
Comparison viewport: 1280 × 720

## Visual comparison

- The three-pane hierarchy, graphite navigation, compact grouped thread list,
  flat document conversation, participant chips, vermilion selection accent,
  and docked composer match the selected direction.
- Typography, row density, spacing, separators, and provider identity remain
  legible at the tested desktop viewport.
- Intentional deviations remove unsupported Drafts, Snooze, cross-account reply
  selection, and dead toolbar actions. The implemented controls are truthful to
  current backend capabilities.
- Rich email content remains isolated in a sandboxed iframe and is not placed
  beneath transform or opacity animation.

## Interaction and accessibility checks

- Semantic search opens, receives focus, and closes with Escape.
- New-message composer opens, receives focus, and closes with Escape.
- Dialog focus is trapped and restored.
- Reply sends optimistically and reconciles its pending state.
- Archive collapses in 160 ms, offers a five-second Undo, and restores correctly.
- Thread list uses native list markup with complete labels and `aria-current`.
- Text is at least 12 px, pinch zoom is allowed, and reduced-motion behavior is
  respected.
- Responsive tiers are defined for icon-rail tablet layouts and a phone
  conversation sheet; stale mobile state is cleared after resizing.

## Severity review

- P0 blockers: none
- P1 major issues: none
- P2 visible polish issues: none

final result: passed
