# Rubidium native production-loop audit

Audit date: 2026-08-09

Surface: Rubidium iOS 26+ native mail and calendar client

Capture: iPhone 17 Pro simulator, plus final build/install/launch on the attached physical iPhone

## Verdict

The revised information architecture is coherent and no longer depends on a clipping-prone custom drawer. Mail, Today, and Search are stable top-level destinations; Mailboxes and Settings are native sheets; response actions and scheduling are explicit; and the final screens passed dark, light, and accessibility-extra-large visual checks. The older Rubidium visual identity remains intact.

## Audited journey

1. **Unified inbox — Healthy**
   - Evidence: `05-revised-inbox.png`
   - The Rubidium header, account context, semantic-search entry point, grouped conversations, AI control, and system tab bar form one clear hierarchy.
   - The unexplained second bottom bar and desktop-only Command-K affordance are gone.

2. **Mailbox navigation — Healthy**
   - Evidence: `16-menu-final.png`, `29-menu-axxl-fixed.png`
   - The former side overlay is now a native, scrollable sheet with a drag indicator and close control; it cannot clip beyond the display edge.
   - Empty provider headings are suppressed. Counters use monospaced digits and reserve their own capsule space.
   - At accessibility-extra-large, decorative symbols stay stable, labels can wrap, and the nonessential tagline yields to the close control.

3. **Calendar agenda — Healthy**
   - Evidence: `31-calendar-final.png`
   - Today is a first-class tab. The agenda identifies date, time, location, provider/calendar account, and meeting availability.
   - Create and refresh are visible in the top toolbar; tab navigation stays visible and stable.

4. **Create event — Healthy**
   - Evidence: `18-event-composer-final.png`
   - Calendar selection, provider/account context, all-day state, timezone-safe start/end controls, attendees, location, video call, and notes are available in one native form.
   - The selected calendar no longer repeats the same provider/account string twice.

5. **Event detail and RSVP — Healthy**
   - Evidence: `19-event-detail-final.png`, `28-event-axxl.png`
   - Edit, join, calendar/account identity, current response, and provider are explicit.
   - Accept/Maybe/Decline use equal-width controls whose icon and label do not wrap into each other; the page remains scrollable at accessibility-extra-large.

6. **Read a rich email — Healthy with content boundary**
   - Evidence: `21-thread-final.png`
   - Native thread chrome surrounds the constrained HTML renderer. Remote images are blocked by default and exposed through a clear Load Images action.
   - Email CSS constrains tables and media to the viewport, wraps unbroken content, hides blocked-image holes, and prevents horizontal navigation.
   - Reply, Reply All, Forward, Schedule, and More are explicit; no response action is hidden behind an unexplained gesture.

7. **Reply composer — Healthy**
   - Evidence: `24-reply-restored-final.png`
   - From, To, CC/BCC, subject, editable body, quoted history, delivery options, attachments, formatting, AI, and send are separated into understandable planes.
   - Autosaved typed content and quoted history persist separately. Legacy drafts are migrated so the original message does not reappear inside the editable response.
   - Quoted history is collapsed by default and removable; provider/network failures retain the local draft.

8. **Unified search — Healthy**
   - Evidence: `23-search-compact-final.png`
   - Search covers mail and calendar in one native searchable route. The compact navigation title removes the previous large blank region.
   - Recent results remain useful before typing; calendar results appear for matching queries.

9. **Accounts and settings — Healthy**
   - Evidence: `26-settings-light.png`
   - Add Google/Microsoft, connected-account health, appearance, device lock, and notification settings render as native controls without the former JavaScript exception.
   - The light appearance retains contrast and the sheet respects the top and bottom safe areas.

10. **Large-text inbox — Healthy**
    - Evidence: `30-inbox-axxl.png`
    - Inbox content reflows at accessibility-extra-large and the system tab bar remains reachable. Long subjects wrap rather than drawing outside their row.

## Interaction checks

- Leading swipes expose Read/Unread and Flag/Unflag; trailing swipes expose Archive and Trash. Full-swipe actions are native and mailbox mutations roll back after provider failure.
- Tab changes, state changes, sends, destructive actions, AI generation, and failures use restrained semantic haptics.
- Native TabView, NavigationStack, sheets, menus, search, and toolbars own safe areas and Liquid Glass transitions. Custom glass remains limited to the floating Rubidium AI control.
- Microsoft thread identifiers are transported with authenticated URLSession requests rather than embedded JavaScript fetches, eliminating invalid-URL failures for Base64 provider IDs.

## Evidence limits

- Screenshots can establish layout, hierarchy, contrast, wrapping, and visible states; they cannot by themselves prove VoiceOver reading order, every animation frame, tactile haptic intensity, APNs delivery, or provider-side mutation correctness.
- The simulator was checked in dark, light, standard text, and accessibility-extra-large. The final app was built, signed, installed, and launched on the attached physical iPhone.
- The personal-team device profile does not permit the APNs entitlement. The local phone build therefore cannot validate remote push delivery; the project retains its release APNs entitlement for a paid/eligible development profile.
- Railway was intentionally not deployed or mutated during this UI audit.
