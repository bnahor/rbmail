import SwiftUI
import WebKit
import PhotosUI
import Photos
import UniformTypeIdentifiers
import QuickLook
import ImageIO

struct RubidiumMailbox: Codable, Identifiable, Hashable {
    let id: String
    let accountId: String
    let provider: String
    let name: String
    let kind: String
    let unreadCount: Int
    let system: Bool
}

struct RubidiumNotificationPreferences: Codable, Hashable {
    var enabled: Bool
    var scope: String
    var accountIds: [String]
    var showSender: Bool
    var showSubject: Bool
    var showBody: Bool
    var sound: Bool
    var badge: Bool
    var calendarReminders: Bool

    static let standard = Self(
        enabled: true, scope: "all", accountIds: [], showSender: true,
        showSubject: true, showBody: false, sound: true, badge: true,
        calendarReminders: false
    )
}

struct RubidiumMailAttachment: Codable, Identifiable, Hashable {
    let id: String
    let providerAttachmentId: String
    let filename: String
    let mimeType: String
    let size: Int
    let contentId: String?
    let disposition: String
    let inline: Bool
    let contentBase64: String?
}

struct RubidiumMailHeaders: Codable, Hashable {
    let messageId: String?
    let inReplyTo: String?
    let references: [String]
    let replyTo: [RubidiumMailAddress]
    let listUnsubscribe: String?
}

struct RubidiumMailMessage: Codable, Identifiable, Hashable {
    let id: String
    let providerId: String
    let providerThreadId: String
    let subject: String
    let snippet: String
    let bodyText: String
    let bodyHtml: String?
    let from: RubidiumMailAddress
    let to: [RubidiumMailAddress]
    let cc: [RubidiumMailAddress]
    let bcc: [RubidiumMailAddress]
    let receivedAt: String
    let isRead: Bool
    let flagged: Bool
    let hasAttachments: Bool
    let attachments: [RubidiumMailAttachment]
    let headers: RubidiumMailHeaders
    let labels: [String]
    let folder: String?
}

struct RubidiumThreadDetail: Codable, Identifiable, Hashable {
    let id: String
    let accountId: String
    let provider: String
    let providerThreadId: String
    let email: String
    let displayName: String
    let subject: String
    let snippet: String
    let participants: [RubidiumMailAddress]
    let labels: [String]
    let lastMessageAt: String
    let unread: Bool
    let flagged: Bool
    let archived: Bool
    let snoozedUntil: String?
    let muted: Bool
    let vip: Bool
    let syncVersion: Int
    let attachmentCount: Int
    let messageCount: Int
    let messages: [RubidiumMailMessage]
}

struct RubidiumOutgoingAttachment: Identifiable, Hashable, Codable {
    let id: UUID
    var filename: String
    var mimeType: String
    var data: Data
    var inline: Bool

    init(filename: String, mimeType: String, data: Data, inline: Bool = false) {
        id = UUID()
        self.filename = filename
        self.mimeType = mimeType
        self.data = data
        self.inline = inline
    }
}

private struct RubidiumMailboxesResponse: Decodable { let mailboxes: [RubidiumMailbox] }
private struct RubidiumThreadResponse: Decodable { let thread: RubidiumThreadDetail }
private struct RubidiumThreadActionResponse: Decodable { let ok: Bool; let thread: RubidiumThreadDetail? }
private struct RubidiumSendResponse: Decodable { let sent: Bool?; let queued: Bool?; let draftId: String? }
private struct RubidiumRecipientSuggestionsResponse: Decodable { let suggestions: [RubidiumMailAddress] }
private struct RubidiumDraftEnvelope: Decodable {
    struct Value: Decodable { let id: String }
    let draft: Value
}
private struct RubidiumNotificationPreferencesEnvelope: Decodable { let preferences: RubidiumNotificationPreferences }
private struct RubidiumCalendarEventEnvelope: Decodable { let event: RubidiumCalendarEvent }

enum RubidiumMailAction: String {
    case read, unread, flag, unflag, archive, trash, restore, junk, notJunk = "not_junk"
    case mute, unmute, vip, unvip, snooze, unsnooze
}

extension RubidiumNativeStore {
    var intelligenceContext: String {
        guard let thread = activeThread else { return "" }
        return thread.messages.suffix(8).map { message in
            "From: \(message.from.name) <\(message.from.address)>\nDate: \(message.receivedAt)\nSubject: \(message.subject)\n\(message.bodyText.prefix(4_000))"
        }.joined(separator: "\n\n---\n\n")
    }

    func loadMailboxes() async {
        guard let browser else { return }
        do {
            let response: RubidiumMailboxesResponse = try await browser.api("/api/mailboxes")
            mailboxes = response.mailboxes
            RubidiumLocalCache.shared.save(mailboxes, key: "mailboxes")
        } catch {
            mailActionError = error.localizedDescription
        }
    }

    func loadNotificationPreferences() async {
        guard let browser else { return }
        do {
            let response: RubidiumNotificationPreferencesEnvelope = try await browser.api("/api/notification-preferences")
            notificationPreferences = response.preferences
        } catch {
            mailActionError = error.localizedDescription
        }
    }

    func loadRecipientSuggestions(query: String = "", limit: Int = 50) async -> [RubidiumMailAddress] {
        guard let browser else { return [] }
        var components = URLComponents()
        components.path = "/api/recipient-suggestions"
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(max(1, min(limit, 100))))
        ]
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            components.queryItems?.append(URLQueryItem(name: "q", value: query))
        }
        let path = components.string ?? "/api/recipient-suggestions?limit=50"
        let response: RubidiumRecipientSuggestionsResponse? = try? await browser.api(path)
        return response?.suggestions ?? []
    }

    func updateNotificationPreferences(_ preferences: RubidiumNotificationPreferences) async {
        guard let browser else { return }
        notificationPreferences = preferences
        do {
            let data = try JSONEncoder().encode(preferences)
            let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            let response: RubidiumNotificationPreferencesEnvelope = try await browser.api(
                "/api/notification-preferences", method: "PATCH", body: body
            )
            notificationPreferences = response.preferences
        } catch {
            mailActionError = error.localizedDescription
        }
    }

    func createCalendarEvent(_ body: [String: Any]) async throws {
        guard let browser else { return }
        let _: RubidiumCalendarEventEnvelope = try await browser.api(
            "/api/calendar/events",
            method: "POST",
            body: body,
            headers: ["Idempotency-Key": UUID().uuidString]
        )
        try await loadCalendarEvents()
    }

    func updateCalendarEvent(_ event: RubidiumCalendarEvent, body: [String: Any]) async throws {
        guard let browser else { return }
        let id = RubidiumURL.pathSegment(event.id)
        let _: RubidiumCalendarEventEnvelope = try await browser.api(
            "/api/calendar/events/\(id)",
            method: "PATCH",
            body: body,
            headers: ["Idempotency-Key": UUID().uuidString]
        )
        try await loadCalendarEvents()
    }

    func respond(to event: RubidiumCalendarEvent, response: String) async -> Bool {
        guard let browser else { return false }
        do {
            let id = RubidiumURL.pathSegment(event.id)
            let _: RubidiumCalendarEventEnvelope = try await browser.api(
                "/api/calendar/events/\(id)/rsvp",
                method: "POST",
                body: ["response": response],
                headers: ["Idempotency-Key": UUID().uuidString]
            )
            try await loadCalendarEvents()
            RubidiumHaptics.shared.play(.success)
            return true
        } catch {
            calendarErrorMessage = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
            return false
        }
    }

    func delete(event: RubidiumCalendarEvent) async -> Bool {
        guard let browser else { return false }
        do {
            let id = RubidiumURL.pathSegment(event.id)
            struct DeleteResponse: Decodable { let deleted: Bool }
            let _: DeleteResponse = try await browser.api(
                "/api/calendar/events/\(id)",
                method: "DELETE",
                headers: ["Idempotency-Key": UUID().uuidString]
            )
            events.removeAll { $0.id == event.id }
            RubidiumHaptics.shared.play(.success)
            return true
        } catch {
            calendarErrorMessage = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
            return false
        }
    }

    func downloadAttachment(
        message: RubidiumMailMessage,
        attachment: RubidiumMailAttachment
    ) async throws -> RubidiumOutgoingAttachment {
        guard let browser else { throw RubidiumAPIError(status: 0, message: "Rubidium is starting.", code: nil) }
        struct Payload: Decodable { let contentBase64: String; let mimeType: String; let filename: String }
        let encode: (String) -> String = { value in
            value.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? value
        }
        let payload: Payload = try await browser.api(
            "/api/messages/\(encode(message.id))/attachments/\(encode(attachment.id))?encoding=base64"
        )
        guard let data = Data(base64Encoded: payload.contentBase64) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return .init(filename: payload.filename, mimeType: payload.mimeType, data: data)
    }

    func refreshMail(view: String? = nil, accountId: String? = nil, query: String? = nil) async {
        guard let browser else { return }
        isRefreshingMail = true
        defer { isRefreshingMail = false }
        do {
            var components = URLComponents()
            components.path = "/api/threads"
            components.queryItems = [URLQueryItem(name: "limit", value: "160")]
            if let view { components.queryItems?.append(URLQueryItem(name: "view", value: view)) }
            if let accountId { components.queryItems?.append(URLQueryItem(name: "accountId", value: accountId)) }
            if let query, !query.isEmpty { components.queryItems?.append(URLQueryItem(name: "q", value: query)) }
            let response: RubidiumThreadsResponse = try await browser.api(components.string ?? "/api/threads?limit=160")
            threads = response.threads
            RubidiumLocalCache.shared.save(threads, key: "threads")
            mailActionError = nil
        } catch {
            mailActionError = error.localizedDescription
        }
    }

    func loadThread(_ id: String) async throws -> RubidiumThreadDetail {
        guard let browser else { throw RubidiumAPIError(status: 0, message: "Rubidium is starting.", code: nil) }
        let encoded = RubidiumURL.pathSegment(id)
        let response: RubidiumThreadResponse = try await browser.api("/api/threads/\(encoded)")
        activeThread = response.thread
        return response.thread
    }

    func perform(_ action: RubidiumMailAction, on thread: RubidiumThreadSummary, snoozedUntil: Date? = nil) async -> Bool {
        guard let browser else { return false }
        let snapshot = threads
        applyOptimistic(action, id: thread.id)
        do {
            let encoded = RubidiumURL.pathSegment(thread.id)
            var body: [String: Any] = ["action": action.rawValue, "expectedVersion": thread.syncVersion]
            if let snoozedUntil { body["snoozedUntil"] = ISO8601DateFormatter().string(from: snoozedUntil) }
            let response: RubidiumThreadActionResponse = try await browser.api(
                "/api/threads/\(encoded)/action",
                method: "POST",
                body: body,
                headers: ["Idempotency-Key": UUID().uuidString]
            )
            if let updated = response.thread {
                activeThread = updated
            }
            mailActionError = nil
            RubidiumHaptics.shared.play(action == .trash || action == .junk ? .warning : .action)
            return true
        } catch {
            threads = snapshot
            mailActionError = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
            return false
        }
    }

    private func applyOptimistic(_ action: RubidiumMailAction, id: String) {
        if action == .archive || action == .trash || action == .junk || action == .snooze {
            threads.removeAll { $0.id == id }
            return
        }
        guard let index = threads.firstIndex(where: { $0.id == id }) else { return }
        let thread = threads[index]
        threads[index] = RubidiumThreadSummary(
            id: thread.id,
            accountId: thread.accountId,
            provider: thread.provider,
            providerThreadId: thread.providerThreadId,
            email: thread.email,
            displayName: thread.displayName,
            subject: thread.subject,
            snippet: thread.snippet,
            participants: thread.participants,
            labels: thread.labels,
            lastMessageAt: thread.lastMessageAt,
            unread: action == .read ? false : action == .unread ? true : thread.unread,
            flagged: action == .flag ? true : action == .unflag ? false : thread.flagged,
            archived: thread.archived,
            snoozedUntil: thread.snoozedUntil,
            muted: action == .mute ? true : action == .unmute ? false : thread.muted,
            vip: action == .vip ? true : action == .unvip ? false : thread.vip,
            syncVersion: thread.syncVersion + 1,
            attachmentCount: thread.attachmentCount,
            messageCount: thread.messageCount
        )
    }

    func saveDraft(_ input: RubidiumComposerPayload, id: String?) async throws -> String {
        guard let browser else { throw RubidiumAPIError(status: 0, message: "Rubidium is starting.", code: nil) }
        let response: RubidiumDraftEnvelope = try await browser.api(
            id.map { "/api/drafts/\($0)" } ?? "/api/drafts",
            method: id == nil ? "POST" : "PATCH",
            body: input.dictionary
        )
        return response.draft.id
    }

    func deleteDraft(_ id: String) async {
        guard let browser else { return }
        let _: RubidiumEmptyResponse? = try? await browser.api("/api/drafts/\(id)", method: "DELETE")
    }

    func send(_ input: RubidiumComposerPayload) async throws {
        guard let browser else { throw RubidiumAPIError(status: 0, message: "Rubidium is starting.", code: nil) }
        let _: RubidiumSendResponse = try await browser.api(
            "/api/send",
            method: "POST",
            body: input.dictionary,
            headers: ["Idempotency-Key": UUID().uuidString]
        )
    }
}

struct RubidiumMailboxDestination: Identifiable, Hashable {
    enum Kind: String, Hashable { case current, today, needsAttention, flagged, vip, snoozed, drafts, sent, archive, junk, trash, search, accounts, provider }
    let id: String
    let title: String
    let symbol: String
    let kind: Kind
    var accountId: String? = nil
    var providerView: String? = nil

    static let current = Self(id: "current", title: "Current", symbol: "tray.full", kind: .current)
}

struct RubidiumMailAppShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @ObservedObject var browser: RubidiumBrowserModel
    @ObservedObject var store: RubidiumNativeStore
    @ObservedObject var security: RubidiumAppLockModel
    let isSignedIn: Bool
    let presentIntelligence: () -> Void
    @State private var selection: RubidiumMailboxDestination? = .current
    @State private var columnVisibility: NavigationSplitViewVisibility = .automatic
    @State private var composeRequest: RubidiumComposerRequest?
    @State private var deepLinkedThread: RubidiumThreadSummary?
    @State private var deepLinkedEvent: RubidiumCalendarEvent?
    @State private var compactSidebarOpen = false
    @State private var compactSettingsOpen = false
    @State private var compactTab: RubidiumPrimaryTab = .mail
    @State private var didApplyDebugLaunchState = false
    @State private var debugCalendarComposerOpen = false
    @ObservedObject private var notifications = RubidiumNotifications.shared
    @ObservedObject private var quickActions = RubidiumQuickActions.shared

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                TabView(selection: $compactTab) {
                    Tab("Mail", systemImage: "tray.full", value: RubidiumPrimaryTab.mail) {
                        destination(mailSelection, openMailboxes: openSidebar)
                    }

                    Tab("Today", systemImage: "calendar", value: RubidiumPrimaryTab.today) {
                        RubidiumNativeCalendarView(store: store, browser: browser)
                    }

                    Tab(
                        "Search",
                        systemImage: "sparkle.magnifyingglass",
                        value: RubidiumPrimaryTab.search,
                        role: .search
                    ) {
                        RubidiumNativeSearchView(
                            store: store,
                            openThread: { deepLinkedThread = $0 },
                            openEvent: { deepLinkedEvent = $0 },
                            showsDismissButton: false
                        )
                    }
                }
                .tabBarMinimizeBehavior(.onScrollDown)
                .onChange(of: compactTab) { _, _ in
                    RubidiumHaptics.shared.play(.selection)
                }
                .sheet(isPresented: $compactSidebarOpen) {
                    RubidiumMailboxSidebar(
                        store: store,
                        selection: $selection,
                        compose: {
                            closeSidebar()
                            composeRequest = .new
                        },
                        didSelect: closeSidebar,
                        openAccounts: {
                            closeSidebar()
                            compactSettingsOpen = true
                        },
                        showsTopLevelDestinations: false
                    )
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                }
                .sheet(isPresented: $compactSettingsOpen) {
                    RubidiumNativeAccountsView(
                        store: store,
                        browser: browser,
                        security: security,
                        dismiss: { compactSettingsOpen = false }
                    )
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
                }
                .sheet(isPresented: $debugCalendarComposerOpen) {
                    RubidiumCalendarComposer(store: store)
                }
            } else {
                NavigationSplitView(columnVisibility: $columnVisibility) {
                    RubidiumMailboxSidebar(
                        store: store,
                        selection: $selection,
                        compose: { composeRequest = .new }
                    )
                    .navigationSplitViewColumnWidth(min: 280, ideal: 320, max: 360)
                } detail: {
                    destination(selection ?? .current, openMailboxes: {})
                }
                .navigationSplitViewStyle(.balanced)
            }
        }
        .task {
            await store.loadAll()
            await store.loadMailboxes()
            await store.loadNotificationPreferences()
            openPendingNotification()
            applyDebugLaunchStateIfNeeded()
            applyQuickActionIfNeeded()
        }
        .fullScreenCover(item: $composeRequest) { request in
            RubidiumMailComposer(store: store, request: request)
        }
        .sheet(item: $deepLinkedThread) { thread in
            NavigationStack {
                RubidiumThreadDetailView(
                    store: store,
                    summary: thread,
                    composeRequest: $composeRequest
                )
            }
        }
        .sheet(item: $deepLinkedEvent) { event in
            NavigationStack {
                RubidiumCalendarEventDetailView(store: store, event: event)
            }
        }
        .onChange(of: notifications.pendingThreadId) { _, _ in
            openPendingNotification()
        }
        .onChange(of: quickActions.pendingAction) { _, _ in
            applyQuickActionIfNeeded()
        }
        .onChange(of: isSignedIn) { _, signedIn in
            if signedIn { applyQuickActionIfNeeded() }
        }
    }

    @ViewBuilder
    private func destination(
        _ destination: RubidiumMailboxDestination,
        openMailboxes: @escaping () -> Void
    ) -> some View {
        switch destination.kind {
        case .today:
            RubidiumNativeCalendarView(
                store: store,
                browser: browser,
                openMailboxes: openMailboxes
            )
        case .search:
            RubidiumNativeSearchView(store: store) { thread in
                deepLinkedThread = thread
            } openEvent: { event in
                deepLinkedEvent = event
            } openMailboxes: { openMailboxes() }
        case .accounts:
            RubidiumNativeAccountsView(
                store: store,
                browser: browser,
                security: security,
                openMailboxes: openMailboxes
            )
        default:
            RubidiumMailboxView(
                store: store,
                destination: destination,
                composeRequest: $composeRequest,
                presentIntelligence: presentIntelligence,
                openMailboxes: openMailboxes
            )
        }
    }

    private func openSidebar() {
        RubidiumHaptics.shared.play(.selection)
        compactSidebarOpen = true
    }

    private func closeSidebar() {
        compactSidebarOpen = false
    }

    private func openPendingNotification() {
        guard let id = notifications.pendingThreadId,
              let thread = store.threads.first(where: { $0.id == id }) else { return }
        selection = .current
        deepLinkedThread = thread
        notifications.pendingThreadId = nil
    }

    private func applyQuickActionIfNeeded() {
        guard isSignedIn, let action = quickActions.consume() else { return }
        RubidiumHaptics.shared.play(.selection)
        switch action {
        case .compose:
            composeRequest = .new
        case .search:
            if horizontalSizeClass == .compact {
                compactTab = .search
            } else {
                selection = .init(
                    id: "search",
                    title: "Search",
                    symbol: "sparkle.magnifyingglass",
                    kind: .search
                )
            }
        case .today:
            if horizontalSizeClass == .compact {
                compactTab = .today
            } else {
                selection = .init(
                    id: "today",
                    title: "Today",
                    symbol: "calendar",
                    kind: .today
                )
            }
        }
    }

    private var mailSelection: RubidiumMailboxDestination {
        guard let selection else { return .current }
        switch selection.kind {
        case .today, .search, .accounts:
            return .current
        default:
            return selection
        }
    }

    private func applyDebugLaunchStateIfNeeded() {
#if DEBUG
        guard !didApplyDebugLaunchState else { return }
        didApplyDebugLaunchState = true
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--rubidium-audit-calendar") {
            compactTab = .today
        } else if arguments.contains("--rubidium-audit-search") {
            compactTab = .search
        } else if arguments.contains("--rubidium-audit-menu") {
            compactSidebarOpen = true
        } else if arguments.contains("--rubidium-demo-sidebar") {
            compactSidebarOpen = true
        } else if arguments.contains("--rubidium-audit-settings") {
            compactSettingsOpen = true
        } else if arguments.contains("--rubidium-audit-compose") {
            composeRequest = .new
        } else if arguments.contains("--rubidium-audit-new-event") {
            compactTab = .today
            debugCalendarComposerOpen = true
        } else if arguments.contains("--rubidium-audit-event"), let event = store.events.first {
            compactTab = .today
            deepLinkedEvent = event
        } else if arguments.contains("--rubidium-audit-reply"), let thread = store.threads.first {
            Task {
                guard let detail = try? await store.loadThread(thread.id),
                      let message = detail.messages.last else { return }
                composeRequest = .reply(detail, message)
            }
        } else if arguments.contains("--rubidium-audit-thread"), let thread = store.threads.first {
            deepLinkedThread = thread
        }
#endif
    }
}

private enum RubidiumPrimaryTab: Hashable {
    case mail
    case today
    case search
}

private struct RubidiumMailboxSidebar: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var store: RubidiumNativeStore
    @Binding var selection: RubidiumMailboxDestination?
    let compose: () -> Void
    var didSelect: () -> Void = {}
    var openAccounts: (() -> Void)? = nil
    var showsTopLevelDestinations = true
    @State private var systemFoldersExpanded = false
    @State private var expandedAccountIds = Set<String>()
    @State private var preparedHierarchy = false

    private let main: [RubidiumMailboxDestination] = [
        .current,
        .init(id: "today", title: "Today", symbol: "calendar", kind: .today),
        .init(id: "attention", title: "Needs Attention", symbol: "bubble.left.and.exclamationmark.bubble.right", kind: .needsAttention),
        .init(id: "flagged", title: "Flagged", symbol: "flag", kind: .flagged),
        .init(id: "vip", title: "VIP", symbol: "star", kind: .vip),
        .init(id: "snoozed", title: "Snoozed", symbol: "clock.badge", kind: .snoozed),
    ]
    private let folders: [RubidiumMailboxDestination] = [
        .init(id: "drafts", title: "Drafts", symbol: "doc", kind: .drafts),
        .init(id: "sent", title: "Sent", symbol: "paperplane", kind: .sent),
        .init(id: "archive", title: "Archive", symbol: "archivebox", kind: .archive),
        .init(id: "junk", title: "Junk", symbol: "xmark.bin", kind: .junk),
        .init(id: "trash", title: "Trash", symbol: "trash", kind: .trash),
    ]

    var body: some View {
        ZStack {
            RubidiumTheme.sidebar.ignoresSafeArea()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 13) {
                        RubidiumBrandMark(size: 48, cornerRadius: 13)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Rubidium")
                                .font(.system(.title3, design: .serif, weight: .bold))
                                .foregroundStyle(.white)
                            if !dynamicTypeSize.isAccessibilitySize {
                                Text("EVERY INBOX · ONE PLACE")
                                    .font(.caption2.weight(.bold))
                                    .tracking(1.15)
                                    .foregroundStyle(.white.opacity(0.48))
                            }
                        }
                        Spacer()
                        Button(action: didSelect) {
                            Image(systemName: "xmark")
                                .font(.system(size: 18, weight: .semibold))
                                .frame(width: 44, height: 44)
                        }
                        .foregroundStyle(.white.opacity(0.68))
                        .accessibilityLabel("Close mailboxes")
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 22)

                    Button(action: compose) {
                        Label("New message", systemImage: "square.and.pencil")
                            .font(.headline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(
                                RubidiumTheme.sidebarSurface,
                                in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                            )
                            .overlay {
                                RoundedRectangle(cornerRadius: 13, style: .continuous)
                                    .stroke(.white.opacity(0.13), lineWidth: 0.75)
                            }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 28)

                    sidebarHeader("Your views")
                    ForEach(visibleMain) { destination in row(destination) }

                    sidebarHeader("Mailboxes")
                        .padding(.top, 22)
                    systemFolderGroup

                    if !store.accounts.isEmpty {
                        sidebarHeader("Accounts")
                            .padding(.top, 22)
                        ForEach(store.accounts) { account in
                            accountGroup(account, mailboxes: providerMailboxes(for: account))
                        }
                    }

                    sidebarHeader("Rubidium")
                        .padding(.top, 22)
                    if showsTopLevelDestinations {
                        row(.init(id: "search", title: "Search", symbol: "sparkle.magnifyingglass", kind: .search))
                    }
                    if let openAccounts {
                        Button(action: openAccounts) {
                            sidebarRowLabel(
                                title: "Accounts & Settings",
                                symbol: "gearshape",
                                selected: false,
                                count: 0
                            )
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 8)
                    } else {
                        row(.init(id: "settings", title: "Accounts & Settings", symbol: "gearshape", kind: .accounts))
                    }
                }
                .padding(.vertical, 12)
            }
        }
        .preferredColorScheme(.dark)
        .foregroundStyle(.white)
        .task(id: store.accounts.map(\.id)) {
            guard !preparedHierarchy, let firstAccount = store.accounts.first else { return }
            preparedHierarchy = true
            let initialId = selection?.accountId ?? firstAccount.id
            systemFoldersExpanded = selection.map(isSystemFolder) ?? false
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--rubidium-demo-sidebar") {
                try? await Task.sleep(for: .milliseconds(900))
            }
#endif
            _ = withAnimation(sidebarAnimation) {
                expandedAccountIds.insert(initialId)
            }
        }
        .onChange(of: selection?.accountId) { _, accountId in
            guard let accountId else { return }
            _ = withAnimation(sidebarAnimation) {
                expandedAccountIds.insert(accountId)
            }
        }
        .onChange(of: selection?.kind) { _, kind in
            guard let kind, folders.contains(where: { $0.kind == kind }) else { return }
            withAnimation(sidebarAnimation) {
                systemFoldersExpanded = true
            }
        }
    }

    private func sidebarHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .tracking(1.1)
            .foregroundStyle(.white.opacity(0.42))
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
    }

    private func row(
        _ destination: RubidiumMailboxDestination,
        count: Int = 0,
        nested: Bool = false
    ) -> some View {
        Button {
            selection = destination
            RubidiumHaptics.shared.play(.selection)
            didSelect()
        } label: {
            sidebarRowLabel(
                title: destination.title,
                symbol: destination.symbol,
                selected: selection == destination,
                count: count,
                nested: nested
            )
        }
        .buttonStyle(.plain)
        .padding(.leading, nested ? 28 : 8)
        .padding(.trailing, 8)
        .accessibilityAddTraits(selection == destination ? .isSelected : [])
    }

    private func accountGroup(
        _ account: RubidiumAccount,
        mailboxes: [RubidiumMailbox]
    ) -> some View {
        let expanded = expandedAccountIds.contains(account.id)
        let active = selection?.accountId == account.id

        return VStack(spacing: 0) {
            Button {
                withAnimation(sidebarAnimation) {
                    if expanded {
                        expandedAccountIds.remove(account.id)
                    } else {
                        expandedAccountIds.insert(account.id)
                    }
                }
                RubidiumHaptics.shared.play(.selection)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: account.provider == "google" ? "envelope.fill" : "square.grid.2x2.fill")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(active ? RubidiumTheme.accentSoft : .white.opacity(0.72))
                        .frame(width: 36, height: 36)
                        .background(.white.opacity(active ? 0.11 : 0.065), in: RoundedRectangle(cornerRadius: 10, style: .continuous))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(account.displayName.isEmpty ? account.email : account.displayName)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                        Text(accountSubtitle(account))
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.46))
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(active ? RubidiumTheme.accentSoft : .white.opacity(0.42))
                        .contentTransition(.symbolEffect(.replace))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(
                    active ? RubidiumTheme.sidebarSurface : Color.white.opacity(0.025),
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(account.displayName.isEmpty ? account.email : account.displayName) mailboxes")
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")

            if expanded {
                VStack(spacing: 0) {
                    if mailboxes.isEmpty {
                        Text("No provider folders")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.42))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.leading, 70)
                            .padding(.vertical, 10)
                    } else {
                        ForEach(mailboxes) { mailbox in
                            row(.init(
                                id: "provider:\(mailbox.id)",
                                title: mailboxTitle(mailbox.name),
                                symbol: mailboxSymbol(mailbox.kind),
                                kind: .provider,
                                accountId: account.id,
                                providerView: mailbox.kind == "label" ? "label:\(mailbox.id)" : mailbox.kind
                            ), count: mailbox.unreadCount, nested: true)
                        }
                    }
                }
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(active ? RubidiumTheme.accent.opacity(0.48) : Color.white.opacity(0.12))
                        .frame(width: 1)
                        .padding(.leading, 30)
                        .padding(.vertical, 7)
                }
                .clipped()
                .transition(nestedTransition)
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 4)
    }

    private var systemFolderGroup: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(sidebarAnimation) {
                    systemFoldersExpanded.toggle()
                }
                RubidiumHaptics.shared.play(.selection)
            } label: {
                HStack(spacing: 13) {
                    Image(systemName: "tray.2")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.7))
                        .frame(width: 28)
                    Text("System folders")
                        .font(.body.weight(.medium))
                    Spacer(minLength: 12)
                    Text(folders.count, format: .number)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.4))
                    Image(systemName: systemFoldersExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white.opacity(0.42))
                        .contentTransition(.symbolEffect(.replace))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityValue(systemFoldersExpanded ? "Expanded" : "Collapsed")

            if systemFoldersExpanded {
                VStack(spacing: 0) {
                    ForEach(folders) { destination in
                        row(destination, nested: true)
                    }
                }
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(.white.opacity(0.12))
                        .frame(width: 1)
                        .padding(.leading, 30)
                        .padding(.vertical, 7)
                }
                .clipped()
                .transition(nestedTransition)
            }
        }
        .padding(.horizontal, 8)
    }

    private var visibleMain: [RubidiumMailboxDestination] {
        showsTopLevelDestinations ? main : main.filter { $0.kind != .today }
    }

    private func sidebarRowLabel(
        title: String,
        symbol: String,
        selected: Bool,
        count: Int,
        nested: Bool = false
    ) -> some View {
        HStack(spacing: 13) {
            Image(systemName: symbol)
                .symbolVariant(selected ? .fill : .none)
                .font(.system(size: nested ? 16 : 18, weight: .semibold))
                .foregroundStyle(selected ? RubidiumTheme.accentSoft : .white.opacity(0.68))
                .frame(width: 28)
            Text(title)
                .font(.body.weight(selected ? .semibold : .medium))
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
            Spacer(minLength: 12)
            if count > 0 {
                Text(count, format: .number)
                    .font(.caption.weight(.bold))
                    .monospacedDigit()
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(
                        selected ? RubidiumTheme.accent : Color.white.opacity(0.12),
                        in: Capsule()
                    )
            }
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, nested ? 9 : 11)
        .background {
            if selected {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(RubidiumTheme.sidebarSurface)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(RubidiumTheme.accent)
                            .frame(width: 3)
                            .padding(.vertical, 8)
                    }
            }
        }
    }

    private func mailboxSymbol(_ kind: String) -> String {
        switch kind {
        case "sent": "paperplane"
        case "drafts": "doc"
        case "archive": "archivebox"
        case "junk": "xmark.bin"
        case "trash": "trash"
        case "label": "tag"
        case "inbox": "tray.full"
        default: "tray"
        }
    }

    private func providerMailboxes(for account: RubidiumAccount) -> [RubidiumMailbox] {
        store.mailboxes.filter {
            $0.accountId == account.id && ($0.provider == "google" || $0.kind != "folder")
        }
    }

    private func accountSubtitle(_ account: RubidiumAccount) -> String {
        let provider = account.provider == "google" ? "Gmail" : "Outlook"
        if account.displayName.isEmpty || account.displayName.caseInsensitiveCompare(account.email) == .orderedSame {
            return provider
        }
        return "\(provider) · \(account.email)"
    }

    private func mailboxTitle(_ value: String) -> String {
        let normalized = value.replacingOccurrences(of: "_", with: " ")
        return normalized == normalized.uppercased() ? normalized.localizedCapitalized : normalized
    }

    private func isSystemFolder(_ destination: RubidiumMailboxDestination) -> Bool {
        folders.contains(where: { $0.kind == destination.kind })
    }

    private var sidebarAnimation: Animation? {
        reduceMotion ? nil : .smooth(duration: 0.3, extraBounce: 0.03)
    }

    private var nestedTransition: AnyTransition {
        reduceMotion
            ? .opacity
            : .opacity.combined(with: .scale(scale: 0.985, anchor: .top))
    }
}

private enum RubidiumThreadFilter: String, CaseIterable, Identifiable {
    case all
    case unread
    case flagged
    case attachments

    var id: Self { self }

    var title: String {
        switch self {
        case .all: "All messages"
        case .unread: "Unread"
        case .flagged: "Flagged"
        case .attachments: "With attachments"
        }
    }

    var symbol: String {
        switch self {
        case .all: "tray.full"
        case .unread: "envelope.badge"
        case .flagged: "flag"
        case .attachments: "paperclip"
        }
    }

    func includes(_ thread: RubidiumThreadSummary) -> Bool {
        switch self {
        case .all: true
        case .unread: thread.unread
        case .flagged: thread.flagged
        case .attachments: thread.attachmentCount > 0
        }
    }
}

private struct RubidiumMailboxView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var store: RubidiumNativeStore
    let destination: RubidiumMailboxDestination
    @Binding var composeRequest: RubidiumComposerRequest?
    let presentIntelligence: () -> Void
    let openMailboxes: () -> Void
    @State private var filter: RubidiumThreadFilter = .all
    @State private var editMode: EditMode = .inactive
    @State private var selected = Set<String>()
    @State private var showSearch = false
    @State private var navigationPath = NavigationPath()

    private var visibleThreads: [RubidiumThreadSummary] {
        store.threads.filter(filter.includes)
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ZStack(alignment: .bottomTrailing) {
                RubidiumTheme.canvas.ignoresSafeArea()
                VStack(spacing: 0) {
                    RubidiumInboxHeader(
                        title: destination.title,
                        subtitle: headerSubtitle,
                        count: visibleThreads.count,
                        filter: $filter,
                        selecting: editMode == .active,
                        selectionCount: selected.count,
                        allSelected: !visibleThreads.isEmpty && selected.count == visibleThreads.count,
                        openMailboxes: openMailboxes,
                        openSearch: { showSearch = true },
                        compose: { composeRequest = .new },
                        toggleSelectAll: toggleSelectAll,
                        toggleSelection: toggleSelection
                    )

                    if store.isLoading && store.threads.isEmpty {
                        Spacer()
                        ProgressView("Loading mail…")
                        Spacer()
                    } else if visibleThreads.isEmpty {
                        Spacer()
                        ContentUnavailableView(
                            "No messages",
                            systemImage: destination.symbol,
                            description: Text(store.mailActionError ?? emptyDescription)
                        )
                        Spacer()
                    } else {
                        List {
                            ForEach(threadGroups) { group in
                                Section {
                                    ForEach(group.threads) { thread in
                                        RubidiumThreadRow(
                                            thread: thread,
                                            selectionState: editMode == .active ? selected.contains(thread.id) : nil,
                                            primaryAction: {
                                                if editMode == .active {
                                                    toggleSelected(thread)
                                                } else {
                                                    navigationPath.append(thread)
                                                }
                                            },
                                            selectionAction: {
                                                if editMode == .active {
                                                    toggleSelected(thread)
                                                } else {
                                                    beginSelection(with: thread)
                                                }
                                            }
                                        )
                                        .accessibilityAddTraits(selected.contains(thread.id) ? .isSelected : [])
                                        .listRowInsets(EdgeInsets())
                                        .listRowBackground(Color.clear)
                                        .listRowSeparator(.hidden)
                                        .swipeActions(edge: .leading, allowsFullSwipe: editMode != .active) {
                                            if editMode != .active {
                                                Button {
                                                    Task { _ = await store.perform(thread.unread ? .read : .unread, on: thread) }
                                                } label: {
                                                    Label(thread.unread ? "Read" : "Unread", systemImage: thread.unread ? "envelope.open" : "envelope.badge")
                                                }
                                                .tint(.blue)
                                                Button {
                                                    Task { _ = await store.perform(thread.flagged ? .unflag : .flag, on: thread) }
                                                } label: {
                                                    Label(thread.flagged ? "Unflag" : "Flag", systemImage: thread.flagged ? "flag.slash" : "flag")
                                                }
                                                .tint(.orange)
                                            }
                                        }
                                        .swipeActions(edge: .trailing, allowsFullSwipe: editMode != .active) {
                                            if editMode != .active {
                                                Button {
                                                    Task { _ = await store.perform(.archive, on: thread) }
                                                } label: { Label("Archive", systemImage: "archivebox") }
                                                .tint(.green)
                                                Button(role: .destructive) {
                                                    Task { _ = await store.perform(.trash, on: thread) }
                                                } label: { Label("Trash", systemImage: "trash") }
                                            }
                                        }
                                    }
                                } header: {
                                    HStack {
                                        Text(group.title.uppercased())
                                        Spacer()
                                        Text(group.threads.count, format: .number)
                                            .monospacedDigit()
                                    }
                                    .font(.caption.weight(.bold))
                                    .tracking(0.9)
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 17)
                                    .padding(.top, 8)
                                    .padding(.bottom, 5)
                                }
                            }
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                        .contentMargins(.top, 0, for: .scrollContent)
                        .contentMargins(.bottom, editMode == .active ? 80 : 60, for: .scrollContent)
                        .refreshable { await syncAndRefresh() }
                        .animation(.smooth(duration: 0.24), value: visibleThreads.map(\.id))
                    }
                }

                if editMode == .active {
                    RubidiumBulkActionBar(
                        selectionCount: selected.count,
                        markRead: { bulk(.read) },
                        flag: { bulk(.flag) },
                        archive: { bulk(.archive) },
                        trash: { bulk(.trash) }
                    )
                    .padding(.horizontal, 12)
                    .padding(.bottom, 8)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                } else {
                    Button(action: presentIntelligence) {
                        RubidiumBrandMark(size: 54, cornerRadius: 17)
                            .overlay {
                                RoundedRectangle(cornerRadius: 17, style: .continuous)
                                    .stroke(.white.opacity(0.2), lineWidth: 0.75)
                            }
                            .shadow(color: RubidiumTheme.accent.opacity(0.23), radius: 22, y: 10)
                    }
                    .buttonStyle(.plain)
                    .rubidiumGlass(cornerRadius: 19, interactive: true, tint: RubidiumTheme.accent.opacity(0.08))
                    .padding(.trailing, 17)
                    .padding(.bottom, 12)
                    .accessibilityLabel("Rubidium Intelligence")
                    .accessibilityHint("Search, summarize, or draft with the on-device model")
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .toolbar(editMode == .active ? .hidden : .visible, for: .tabBar)
            .navigationDestination(for: RubidiumThreadSummary.self) { thread in
                RubidiumThreadDetailView(store: store, summary: thread, composeRequest: $composeRequest)
            }
            .fullScreenCover(isPresented: $showSearch) {
                RubidiumNativeSearchView(
                    store: store,
                    openThread: { thread in
                        showSearch = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                            navigationPath.append(thread)
                        }
                    },
                    openEvent: { _ in showSearch = false },
                    openMailboxes: nil
                )
            }
            .task(id: destination.id) {
#if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--rubidium-audit-filter") {
                    filter = .unread
                }
#endif
                await refresh()
#if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--rubidium-audit-selection") {
                    editMode = .active
                    selected = Set(visibleThreads.prefix(3).map(\.id))
                } else if ProcessInfo.processInfo.arguments.contains("--rubidium-demo-selection") {
                    await runSelectionDemo()
                }
#endif
            }
            .onChange(of: destination.id) { _, _ in
                navigationPath = NavigationPath()
                filter = .all
                selected.removeAll()
                editMode = .inactive
            }
            .onChange(of: filter) { _, _ in
                selected.removeAll()
                RubidiumHaptics.shared.play(.selection)
            }
        }
    }

    private var headerSubtitle: String {
        if let accountId = destination.accountId,
           let account = store.accounts.first(where: { $0.id == accountId }) {
            return account.email
        }
        return "All connected accounts"
    }

    private struct ThreadGroup: Identifiable {
        let id: String
        let title: String
        let threads: [RubidiumThreadSummary]
    }

    private var threadGroups: [ThreadGroup] {
        let calendar = Calendar.autoupdatingCurrent
        let startOfToday = calendar.startOfDay(for: Date())
        let startOfWeek = calendar.date(byAdding: .day, value: -6, to: startOfToday) ?? startOfToday
        var today: [RubidiumThreadSummary] = []
        var recent: [RubidiumThreadSummary] = []
        var earlier: [RubidiumThreadSummary] = []

        for thread in visibleThreads {
            guard let date = RubidiumDate.parse(thread.lastMessageAt) else {
                earlier.append(thread)
                continue
            }
            if date >= startOfToday {
                today.append(thread)
            } else if date >= startOfWeek {
                recent.append(thread)
            } else {
                earlier.append(thread)
            }
        }
        return [
            ThreadGroup(id: "today", title: "Today", threads: today),
            ThreadGroup(id: "recent", title: "This week", threads: recent),
            ThreadGroup(id: "earlier", title: "Earlier", threads: earlier),
        ].filter { !$0.threads.isEmpty }
    }

    private func toggleSelection() {
        withAnimation(selectionAnimation(duration: 0.24)) {
            if editMode == .active {
                editMode = .inactive
                selected.removeAll()
            } else {
                editMode = .active
            }
        }
    }

    private func beginSelection(with thread: RubidiumThreadSummary) {
        withAnimation(selectionAnimation(duration: 0.24)) {
            editMode = .active
            selected = [thread.id]
        }
        RubidiumHaptics.shared.play(.selection)
    }

    private func toggleSelected(_ thread: RubidiumThreadSummary) {
        withAnimation(selectionAnimation(duration: 0.18)) {
            if selected.contains(thread.id) {
                selected.remove(thread.id)
            } else {
                selected.insert(thread.id)
            }
        }
        RubidiumHaptics.shared.play(.selection)
    }

    private func toggleSelectAll() {
        withAnimation(selectionAnimation(duration: 0.22)) {
            if !visibleThreads.isEmpty && selected.count == visibleThreads.count {
                selected.removeAll()
            } else {
                selected = Set(visibleThreads.map(\.id))
            }
        }
        RubidiumHaptics.shared.play(.selection)
    }

    private func selectionAnimation(duration: TimeInterval) -> Animation? {
        reduceMotion ? nil : .smooth(duration: duration, extraBounce: 0.04)
    }

#if DEBUG
    private func runSelectionDemo() async {
        let samples = Array(visibleThreads.prefix(3))
        guard samples.count == 3 else { return }
        try? await Task.sleep(for: .milliseconds(900))
        guard !Task.isCancelled else { return }
        beginSelection(with: samples[0])
        try? await Task.sleep(for: .milliseconds(650))
        guard !Task.isCancelled else { return }
        toggleSelected(samples[1])
        try? await Task.sleep(for: .milliseconds(560))
        guard !Task.isCancelled else { return }
        toggleSelected(samples[2])
        try? await Task.sleep(for: .milliseconds(900))
        guard !Task.isCancelled else { return }
        toggleSelected(samples[1])
        try? await Task.sleep(for: .milliseconds(480))
        guard !Task.isCancelled else { return }
        toggleSelected(samples[1])
    }
#endif

    private var emptyDescription: String {
        switch filter {
        case .all: "New messages will appear here."
        case .unread: "There are no unread conversations here."
        case .flagged: "There are no flagged conversations here."
        case .attachments: "There are no conversations with attachments here."
        }
    }

    private func apiView() -> String? {
        switch destination.kind {
        case .needsAttention: "attention"
        case .flagged: "flagged"
        case .vip: "vip"
        case .snoozed: "snoozed"
        case .drafts: "drafts"
        case .sent: "sent"
        case .archive: "archive"
        case .junk: "junk"
        case .trash: "trash"
        case .provider: destination.providerView
        default: nil
        }
    }

    private func refresh() async {
        await store.refreshMail(view: apiView(), accountId: destination.accountId, query: "")
    }

    private func syncAndRefresh() async {
        if let browser = store.browser {
            let _: RubidiumEmptyResponse? = try? await browser.api("/api/sync", method: "POST", body: ["accountId": destination.accountId as Any, "pages": 1])
        }
        await refresh()
    }

    private func bulk(_ action: RubidiumMailAction) {
        let targets = store.threads.filter { selected.contains($0.id) }
        editMode = .inactive
        selected.removeAll()
        Task {
            for thread in targets { _ = await store.perform(action, on: thread) }
        }
    }
}

private struct RubidiumInboxHeader: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let title: String
    let subtitle: String
    let count: Int
    @Binding var filter: RubidiumThreadFilter
    let selecting: Bool
    let selectionCount: Int
    let allSelected: Bool
    let openMailboxes: () -> Void
    let openSearch: () -> Void
    let compose: () -> Void
    let toggleSelectAll: () -> Void
    let toggleSelection: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            if dynamicTypeSize.isAccessibilitySize {
                HStack(spacing: 10) {
                    mailboxButton
                    Spacer()
                    actionButtons
                }
                titleBlock
            } else {
                HStack(alignment: .center, spacing: 12) {
                    mailboxButton
                    titleBlock
                    Spacer(minLength: 8)
                    actionButtons
                }
            }

            if !selecting {
                Button(action: openSearch) {
                    HStack(spacing: 11) {
                        Image(systemName: "sparkle.magnifyingglass")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(RubidiumTheme.accent)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(dynamicTypeSize.isAccessibilitySize ? "Search" : "Ask anything about your mail")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                                .lineLimit(1)
                            if !dynamicTypeSize.isAccessibilitySize {
                                Text("People, intent, attachments, and events")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .rubidiumPlane(cornerRadius: 13)
                }
                .buttonStyle(.plain)
                .dynamicTypeSize(.small ... .accessibility1)
                .accessibilityHint("Search mail and calendar with natural language")
                .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
            }

            HStack(spacing: 7) {
                if selecting {
                    Image(systemName: "hand.tap")
                    Text("Tap conversations to add or remove")
                } else {
                    Text(count, format: .number)
                        .monospacedDigit()
                    Text(count == 1 ? "conversation" : "conversations")
                    if filter != .all {
                        Text("·")
                        Label(filter.title, systemImage: filter.symbol)
                            .labelStyle(.titleOnly)
                            .foregroundStyle(RubidiumTheme.accent)
                    }
                }
                Spacer()
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .dynamicTypeSize(.small ... .accessibility1)
            .padding(.horizontal, 2)
        }
        .padding(.horizontal, 16)
        .padding(.top, 2)
        .padding(.bottom, 8)
        .background(RubidiumTheme.canvas)
        .overlay(alignment: .bottom) {
            Rectangle().fill(RubidiumTheme.rule).frame(height: 0.5)
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.26, extraBounce: 0.02), value: selecting)
        .animation(reduceMotion ? nil : .smooth(duration: 0.18), value: selectionCount)
    }

    private var mailboxButton: some View {
        Button(action: openMailboxes) {
            RubidiumBrandMark(size: 42, cornerRadius: 12)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 8, weight: .heavy))
                        .foregroundStyle(.white)
                        .padding(4)
                        .background(RubidiumTheme.accent, in: Circle())
                        .offset(x: 3, y: 3)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open mailboxes")
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 1) {
            if !dynamicTypeSize.isAccessibilitySize {
                Text(selecting ? "SELECTION" : subtitle.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Text(selecting ? "\(selectionCount) selected" : title)
                .font(.title.weight(.bold))
                .tracking(-0.7)
                .lineLimit(1)
                .contentTransition(.numericText(value: Double(selectionCount)))
        }
    }

    private var actionButtons: some View {
        HStack(spacing: 5) {
            if selecting {
                Button(action: toggleSelectAll) {
                    Image(systemName: allSelected ? "checkmark.circle.fill" : "checklist")
                        .frame(width: 42, height: 42)
                }
                .accessibilityLabel(allSelected ? "Deselect all conversations" : "Select all visible conversations")

                Button(action: toggleSelection) {
                    Image(systemName: "xmark")
                        .frame(width: 42, height: 42)
                }
                .accessibilityLabel("Finish selecting")
            } else {
                Menu {
                    Picker("Show", selection: $filter) {
                        ForEach(RubidiumThreadFilter.allCases) { option in
                            Label(option.title, systemImage: option.symbol)
                                .tag(option)
                        }
                    }

                    Divider()

                    Button("Select messages", systemImage: "checkmark.circle") {
                        toggleSelection()
                    }
                } label: {
                    Image(systemName: filter == .all ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                        .frame(width: 42, height: 42)
                }
                .accessibilityLabel(filter == .all ? "Filter and select" : "Filtered by \(filter.title)")

                Button(action: compose) {
                    Image(systemName: "square.and.pencil")
                        .frame(width: 42, height: 42)
                }
                .accessibilityLabel("New message")
            }
        }
        .font(.body.weight(.semibold))
        .foregroundStyle(.primary)
        .dynamicTypeSize(.small ... .xxxLarge)
    }
}

private struct RubidiumBulkActionBar: View {
    let selectionCount: Int
    let markRead: () -> Void
    let flag: () -> Void
    let archive: () -> Void
    let trash: () -> Void

    var body: some View {
        HStack(spacing: 3) {
            VStack(spacing: 0) {
                Text(selectionCount, format: .number)
                    .font(.headline.weight(.bold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(selectionCount)))
                Text("Selected")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(width: 54)
            .frame(minHeight: 48)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(selectionCount) selected")

            Divider()
                .frame(height: 32)
                .padding(.horizontal, 1)

            action("Read", "envelope.open", markRead)
            action("Flag", "flag", flag)
            action("Archive", "archivebox", archive)
            action("Trash", "trash", trash, destructive: true)
        }
        .padding(6)
        .rubidiumGlass(cornerRadius: 24, interactive: true)
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.white.opacity(0.12), lineWidth: 0.75)
        }
        .shadow(color: .black.opacity(0.24), radius: 22, y: 10)
    }

    private func action(
        _ title: String,
        _ symbol: String,
        _ action: @escaping () -> Void,
        destructive: Bool = false
    ) -> some View {
        Button {
            RubidiumHaptics.shared.play(destructive ? .destructive : .action)
            action()
        } label: {
            VStack(spacing: 2) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                Text(title)
                    .font(.system(size: 9, weight: .semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(destructive ? RubidiumTheme.accentSoft : .primary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .disabled(selectionCount == 0)
    }
}

private struct RubidiumThreadDetailView: View {
    @ObservedObject var store: RubidiumNativeStore
    let summary: RubidiumThreadSummary
    @Binding var composeRequest: RubidiumComposerRequest?
    @State private var detail: RubidiumThreadDetail?
    @State private var error: String?
    @State private var expanded = Set<String>()
    @State private var isScheduling = false

    var body: some View {
        ZStack {
            RubidiumTheme.canvas.ignoresSafeArea()
            Group {
                if let detail {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 9) {
                                Text(summary.subject.isEmpty ? "No subject" : summary.subject)
                                    .font(.title2.weight(.bold))
                                    .tracking(-0.45)
                                HStack(spacing: 8) {
                                    Label(summary.email, systemImage: summary.provider == "google" ? "envelope.fill" : "square.grid.2x2.fill")
                                    Text("·")
                                    Text("\(summary.messageCount) \(summary.messageCount == 1 ? "message" : "messages")")
                                }
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 2)
                            .padding(.bottom, 4)

                            ForEach(detail.messages) { message in
                                RubidiumMessageCard(
                                    threadId: detail.id,
                                    message: message,
                                    expanded: expanded.contains(message.id),
                                    toggle: { toggle(message.id) }
                                )
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.top, 12)
                        .padding(.bottom, 96)
                    }
                } else if let error {
                    ContentUnavailableView("Message unavailable", systemImage: "exclamationmark.triangle", description: Text(error))
                } else {
                    ProgressView("Opening conversation…")
                }
            }
        }
        .navigationTitle("Conversation")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 6) {
                responseButton("Reply", symbol: "arrowshape.turn.up.left.fill", emphasized: true) {
                    reply(all: false)
                }
                responseButton("Reply All", symbol: "arrowshape.turn.up.left.2") {
                    reply(all: true)
                }
                responseButton("Forward", symbol: "arrowshape.turn.up.right") {
                    forward()
                }

                Menu {
                    Button(summary.flagged ? "Unflag" : "Flag", systemImage: "flag") { action(summary.flagged ? .unflag : .flag) }
                    Button("Mark Unread", systemImage: "envelope.badge") { action(.unread) }
                    Button("Archive", systemImage: "archivebox") { action(.archive) }
                    Button("Move to Junk", systemImage: "xmark.bin") { action(.junk) }
                    Button("Delete", systemImage: "trash", role: .destructive) { action(.trash) }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.bold))
                        .frame(width: 44, height: 48)
                }
                .accessibilityLabel("More conversation actions")
            }
            .padding(6)
            .rubidiumGlass(cornerRadius: 20, interactive: true)
            .padding(.horizontal, 14)
            .padding(.top, 5)
        }
        .task {
            do {
                let value = try await store.loadThread(summary.id)
                detail = value
                expanded = Set(value.messages.suffix(1).map(\.id))
                if summary.unread { _ = await store.perform(.read, on: summary) }
            } catch { self.error = error.localizedDescription }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Schedule", systemImage: "calendar.badge.plus") {
                    isScheduling = true
                }
                .accessibilityHint("Create a calendar event with this conversation's people")
            }
        }
        .sheet(isPresented: $isScheduling) {
            RubidiumCalendarComposer(
                store: store,
                prefillTitle: summary.subject,
                prefillAttendees: scheduleAttendees
            )
        }
    }

    private func toggle(_ id: String) {
        withAnimation(.snappy) {
            if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
        }
    }

    private func reply(all: Bool) {
        guard let detail, let message = detail.messages.last else { return }
        composeRequest = all ? .replyAll(detail, message) : .reply(detail, message)
    }

    private func forward() {
        guard let detail, let message = detail.messages.last else { return }
        composeRequest = .forward(detail, message)
    }

    private func action(_ value: RubidiumMailAction) {
        Task { _ = await store.perform(value, on: summary) }
    }

    private var scheduleAttendees: [String] {
        guard let message = detail?.messages.last else { return [] }
        let ownAddresses = Set(store.accounts.map { $0.email.lowercased() })
        return ([message.from] + message.to + message.cc)
            .map(\.address)
            .filter { !ownAddresses.contains($0.lowercased()) }
            .uniqued()
    }

    private func responseButton(
        _ title: String,
        symbol: String,
        emphasized: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ViewThatFits(in: .horizontal) {
                Label(title, systemImage: symbol)
                    .font(.subheadline.weight(.semibold))
                Image(systemName: symbol)
                    .font(.body.weight(.semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(
                emphasized ? RubidiumTheme.accent : Color.clear,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .foregroundStyle(emphasized ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

private struct RubidiumMessageCard: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let threadId: String
    let message: RubidiumMailMessage
    let expanded: Bool
    let toggle: () -> Void
    @State private var loadRemoteImages = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack(alignment: .top, spacing: 11) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(RubidiumTheme.accent.opacity(0.13))
                        .frame(width: 38, height: 38)
                        .overlay {
                            Text(dynamicTypeSize.isAccessibilitySize ? String(initials.prefix(1)) : initials)
                                .font(.caption.bold())
                                .dynamicTypeSize(.small ... .large)
                                .lineLimit(1)
                        }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(message.from.name.isEmpty ? message.from.address : message.from.name)
                            .font(.subheadline.weight(.semibold))
                        Text("to \(recipientSummary)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Text(RubidiumDate.short(message.receivedAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.down")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                Divider().opacity(0.65)
                if message.bodyHtml?.contains("data-remote-src") == true && !loadRemoteImages {
                    Button("Load Images", systemImage: "photo.badge.arrow.down") {
                        loadRemoteImages = true
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(RubidiumTheme.accent)
                    .padding(.horizontal, 14)
                    .padding(.top, 12)
                }
                RubidiumResolvedMailBodyView(
                    message: message,
                    loadRemoteImages: loadRemoteImages
                )
                .padding(14)
                if !message.attachments.filter({ !$0.inline }).isEmpty {
                    Divider().opacity(0.65)
                    RubidiumAttachmentStrip(threadId: threadId, message: message)
                        .padding(12)
                }
            } else if !message.snippet.isEmpty {
                Text(message.snippet)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 12)
            }
        }
        .background(RubidiumTheme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(RubidiumTheme.rule, lineWidth: 0.7)
        }
    }

    private var initials: String {
        let value = message.from.name.isEmpty ? message.from.address : message.from.name
        return value.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }

    private var recipientSummary: String {
        message.to.prefix(3).map { $0.name.isEmpty ? $0.address : $0.name }.joined(separator: ", ")
    }
}

private struct RubidiumResolvedMailBodyView: View {
    let message: RubidiumMailMessage
    let loadRemoteImages: Bool
    @EnvironmentObject private var browser: RubidiumBrowserModel
    @State private var resolvedHTML: String?
    @State private var height: CGFloat = 80
    @State private var gallery: RubidiumMailImageGalleryPayload?

    var body: some View {
        RubidiumMailBodyView(
            html: resolvedHTML ?? message.bodyHtml,
            plainText: message.bodyText,
            height: $height,
            openImages: { images, index in
                gallery = .init(images: images, initialIndex: index)
            }
        )
        .frame(height: max(80, height))
        .task(id: "\(message.id):\(loadRemoteImages)") {
            await resolveContent()
        }
        .fullScreenCover(item: $gallery) { payload in
            RubidiumMailImageGallery(payload: payload)
        }
    }

    private func resolveContent() async {
        guard var html = message.bodyHtml else { return }
        for attachment in message.attachments where attachment.inline && attachment.contentId != nil {
            guard let contentId = attachment.contentId else { continue }
            do {
                let payload = try await loadAttachment(attachment)
                html = html.replacingOccurrences(
                    of: "cid:\(contentId)",
                    with: "data:\(payload.mimeType);base64,\(payload.contentBase64)",
                    options: .caseInsensitive
                )
            } catch {
                continue
            }
        }
        if loadRemoteImages {
            let pattern = #"data-remote-src\s*=\s*([\"'])(.*?)\1"#
            if let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
                let matches = expression.matches(in: html, range: NSRange(html.startIndex..., in: html)).reversed()
                for match in matches {
                    guard let valueRange = Range(match.range(at: 2), in: html),
                          let fullRange = Range(match.range(at: 0), in: html) else { continue }
                    let value = String(html[valueRange]).replacingOccurrences(of: "&amp;", with: "&")
                    do {
                        struct ImagePayload: Decodable { let contentBase64: String; let mimeType: String }
                        var components = URLComponents()
                        components.path = "/api/images/proxy"
                        components.queryItems = [
                            URLQueryItem(name: "url", value: value),
                            URLQueryItem(name: "encoding", value: "base64"),
                        ]
                        let payload: ImagePayload = try await browser.api(components.string ?? "")
                        html.replaceSubrange(fullRange, with: "src=\"data:\(payload.mimeType);base64,\(payload.contentBase64)\"")
                    } catch {
                        continue
                    }
                }
            }
        }
        resolvedHTML = html
    }

    private struct AttachmentPayload: Decodable {
        let contentBase64: String
        let mimeType: String
    }

    private func loadAttachment(_ attachment: RubidiumMailAttachment) async throws -> AttachmentPayload {
        if let content = attachment.contentBase64 {
            return .init(contentBase64: content, mimeType: attachment.mimeType)
        }
        let messageId = pathComponent(message.id)
        let attachmentId = pathComponent(attachment.id)
        return try await browser.api("/api/messages/\(messageId)/attachments/\(attachmentId)?encoding=base64")
    }

    private func pathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? value
    }
}

private struct RubidiumMailBodyView: UIViewRepresentable {
    let html: String?
    let plainText: String
    @Binding var height: CGFloat
    let openImages: ([RubidiumMailImageAsset], Int) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(height: $height, openImages: openImages)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.allowsLinkPreview = false
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let body: String
        if let html, !html.isEmpty {
            body = html
        } else {
            body = "<pre>\(escape(plainText))</pre>"
        }
        let prepared = Self.wrapImages(in: body)
        context.coordinator.images = prepared.images
        context.coordinator.openImages = openImages
        let page = """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'">
        <style>
        :root{color-scheme:light dark}
        *{box-sizing:border-box}
        html,body{margin:0;padding:0;width:100%!important;max-width:100%!important;overflow-x:hidden;background:transparent;color:CanvasText;font:-apple-system-body;-webkit-text-size-adjust:100%}
        body *{max-width:100%!important}
        div,p,span,a,td,th{overflow-wrap:anywhere;word-break:break-word;white-space:normal!important}
        img,video{max-width:100%!important;height:auto!important}
        img[data-remote-src]:not([src]){display:none!important}
        table{width:100%!important;max-width:100%!important;table-layout:auto;border-collapse:collapse}
        td,th{min-width:0!important;width:auto!important}
        pre{white-space:pre-wrap!important;font:inherit;margin:0}
        blockquote{border-inline-start:3px solid GrayText;margin-inline:0;padding-inline-start:12px;color:GrayText}
        a{color:LinkText}
        </style>
        </head><body>\(prepared.html)</body></html>
        """
        if context.coordinator.lastPage != page {
            context.coordinator.lastPage = page
            view.loadHTMLString(page, baseURL: nil)
        }
    }

    private func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    private static func wrapImages(in html: String) -> (html: String, images: [RubidiumMailImageAsset]) {
        let pattern = #"<img\b[^>]*\bsrc\s*=\s*([\"'])(data:[^\"']+)\1[^>]*>"#
        guard let expression = try? NSRegularExpression(
            pattern: pattern,
            options: [.caseInsensitive]
        ) else { return (html, []) }
        let matches = expression.matches(in: html, range: NSRange(html.startIndex..., in: html))
        var replacements: [(Range<String.Index>, String)] = []
        var images: [RubidiumMailImageAsset] = []
        for match in matches {
            guard let tagRange = Range(match.range(at: 0), in: html),
                  let sourceRange = Range(match.range(at: 2), in: html),
                  let image = RubidiumMailImageAsset(
                    id: images.count,
                    dataURL: String(html[sourceRange]),
                    label: altText(in: String(html[tagRange]))
                  ) else { continue }
            let index = images.count
            images.append(image)
            replacements.append((
                tagRange,
                "<a href=\"rubidium-image://open/\(index)\" aria-label=\"Open image\" style=\"display:inline-block;max-width:100%\">\(html[tagRange])</a>"
            ))
        }
        var output = html
        for (range, replacement) in replacements.reversed() {
            output.replaceSubrange(range, with: replacement)
        }
        return (output, images)
    }

    private static func altText(in tag: String) -> String {
        guard let expression = try? NSRegularExpression(
            pattern: #"\balt\s*=\s*([\"'])(.*?)\1"#,
            options: [.caseInsensitive]
        ), let match = expression.firstMatch(in: tag, range: NSRange(tag.startIndex..., in: tag)),
              let range = Range(match.range(at: 2), in: tag) else { return "Email image" }
        let value = String(tag[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "Email image" : value
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var lastPage = ""
        var height: Binding<CGFloat>
        var images: [RubidiumMailImageAsset] = []
        var openImages: ([RubidiumMailImageAsset], Int) -> Void

        init(
            height: Binding<CGFloat>,
            openImages: @escaping ([RubidiumMailImageAsset], Int) -> Void
        ) {
            self.height = height
            self.openImages = openImages
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            webView.evaluateJavaScript("Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)") { [weak self] result, _ in
                guard let value = result as? NSNumber else { return }
                DispatchQueue.main.async {
                    self?.height.wrappedValue = max(80, value.doubleValue.rounded(.up))
                }
            }
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            if navigationAction.navigationType == .linkActivated,
               let url = navigationAction.request.url,
               url.scheme == "rubidium-image",
               let index = Int(url.lastPathComponent),
               images.indices.contains(index) {
                await MainActor.run { openImages(images, index) }
                return .cancel
            }
            guard navigationAction.navigationType == .linkActivated,
                  let url = navigationAction.request.url,
                  ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") else {
                return navigationAction.navigationType == .other ? .allow : .cancel
            }
            await UIApplication.shared.open(url)
            return .cancel
        }
    }
}

private struct RubidiumMailImageAsset: Identifiable, Hashable {
    let id: Int
    let data: Data
    let mimeType: String
    let label: String

    init?(id: Int, dataURL: String, label: String) {
        guard dataURL.hasPrefix("data:"),
              let separator = dataURL.firstIndex(of: ",") else { return nil }
        let metadata = String(dataURL[dataURL.index(dataURL.startIndex, offsetBy: 5)..<separator])
        let encoded = String(dataURL[dataURL.index(after: separator)...])
        let parts = metadata.split(separator: ";").map(String.init)
        let mimeType = parts.first?.isEmpty == false ? parts[0] : "image/jpeg"
        let data = parts.contains(where: { $0.lowercased() == "base64" })
            ? Data(base64Encoded: encoded)
            : encoded.removingPercentEncoding?.data(using: .utf8)
        guard let data, !data.isEmpty else { return nil }
        self.id = id
        self.data = data
        self.mimeType = mimeType
        self.label = label
    }

    var fileExtension: String {
        UTType(mimeType: mimeType)?.preferredFilenameExtension ?? "jpg"
    }
}

private struct RubidiumMailImageGalleryPayload: Identifiable {
    let id = UUID()
    let images: [RubidiumMailImageAsset]
    let initialIndex: Int
}

private struct RubidiumShareFile: Identifiable {
    let id = UUID()
    let url: URL
}

private struct RubidiumMailImageGallery: View {
    let payload: RubidiumMailImageGalleryPayload
    @Environment(\.dismiss) private var dismiss
    @State private var selectedIndex: Int
    @State private var shareFile: RubidiumShareFile?
    @State private var error: String?

    init(payload: RubidiumMailImageGalleryPayload) {
        self.payload = payload
        _selectedIndex = State(initialValue: payload.initialIndex)
    }

    var body: some View {
        NavigationStack {
            TabView(selection: $selectedIndex) {
                ForEach(payload.images) { image in
                    RubidiumZoomableImage(asset: image)
                        .tag(image.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: payload.images.count > 1 ? .automatic : .never))
            .background(.black)
            .ignoresSafeArea()
            .navigationTitle(payload.images.count > 1 ? "\(selectedIndex + 1) of \(payload.images.count)" : "Image")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu("Image actions", systemImage: "square.and.arrow.up") {
                        Button("Copy", systemImage: "doc.on.doc") { copyImage() }
                        Button("Save to Photos", systemImage: "square.and.arrow.down") {
                            Task { await saveImage() }
                        }
                        Button("Share", systemImage: "square.and.arrow.up") { prepareShare() }
                    }
                }
            }
        }
        .sheet(item: $shareFile) { file in
            RubidiumActivityView(items: [file.url])
                .presentationDetents([.medium, .large])
        }
        .alert("Image unavailable", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "")
        }
    }

    private var selected: RubidiumMailImageAsset? {
        payload.images.first(where: { $0.id == selectedIndex })
    }

    private func copyImage() {
        guard let selected, let image = UIImage(data: selected.data) else { return }
        UIPasteboard.general.image = image
        RubidiumHaptics.shared.play(.success)
    }

    private func prepareShare() {
        guard let selected else { return }
        do {
            let directory = FileManager.default.temporaryDirectory
                .appending(path: "Rubidium-Images", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let target = directory
                .appending(path: UUID().uuidString)
                .appendingPathExtension(selected.fileExtension)
            try selected.data.write(to: target, options: [.atomic, .completeFileProtection])
            shareFile = .init(url: target)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveImage() async {
        guard let selected else { return }
        let authorization = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard authorization == .authorized || authorization == .limited else {
            error = "Allow Rubidium to add photos in Settings to save this image."
            RubidiumHaptics.shared.play(.warning)
            return
        }
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                request.addResource(with: .photo, data: selected.data, options: nil)
            }
            RubidiumHaptics.shared.play(.success)
        } catch {
            self.error = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
        }
    }
}

private struct RubidiumZoomableImage: View {
    let asset: RubidiumMailImageAsset
    @State private var scale: CGFloat = 1
    @State private var settledScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var settledOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geometry in
            Group {
                if let image = downsample(asset.data, maxPixels: max(2_048, geometry.size.width * 3)) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .accessibilityLabel(asset.label)
                } else {
                    ContentUnavailableView("Image unavailable", systemImage: "photo.badge.exclamationmark")
                        .foregroundStyle(.white)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .scaleEffect(scale)
            .offset(offset)
            .contentShape(Rectangle())
            .gesture(
                MagnifyGesture()
                    .onChanged { value in
                        scale = min(6, max(1, settledScale * value.magnification))
                    }
                    .onEnded { _ in
                        settledScale = scale
                        if scale == 1 { offset = .zero; settledOffset = .zero }
                    }
            )
            .simultaneousGesture(
                DragGesture()
                    .onChanged { value in
                        guard scale > 1 else { return }
                        offset = CGSize(
                            width: settledOffset.width + value.translation.width,
                            height: settledOffset.height + value.translation.height
                        )
                    }
                    .onEnded { _ in settledOffset = offset }
            )
            .onTapGesture(count: 2) {
                withAnimation(.snappy) {
                    scale = scale > 1 ? 1 : 2.5
                    settledScale = scale
                    if scale == 1 { offset = .zero; settledOffset = .zero }
                }
            }
        }
        .background(.black)
    }

    private func downsample(_ data: Data, maxPixels: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: Int(maxPixels),
              ] as CFDictionary) else { return UIImage(data: data) }
        return UIImage(cgImage: image)
    }
}

private struct RubidiumActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

private struct RubidiumAttachmentStrip: View {
    let threadId: String
    let message: RubidiumMailMessage
    @EnvironmentObject private var browser: RubidiumBrowserModel
    @State private var previewURL: URL?
    @State private var error: String?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(message.attachments.filter { !$0.inline }) { attachment in
                    Button {
                        Task { await open(attachment) }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: icon(attachment.mimeType))
                                .font(.title3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(attachment.filename).font(.caption.weight(.semibold)).lineLimit(1)
                                Text(ByteCountFormatter.string(fromByteCount: Int64(attachment.size), countStyle: .file))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .padding(10)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .quickLookPreview($previewURL)
        .alert("Attachment unavailable", isPresented: .constant(error != nil)) {
            Button("OK") { error = nil }
        } message: { Text(error ?? "") }
    }

    private func open(_ attachment: RubidiumMailAttachment) async {
        struct Payload: Decodable { let contentBase64: String; let filename: String }
        do {
            let encode: (String) -> String = { value in
                value.addingPercentEncoding(
                    withAllowedCharacters: CharacterSet.alphanumerics.union(
                        CharacterSet(charactersIn: "-._~")
                    )
                ) ?? value
            }
            let path = "/api/messages/\(encode(message.id))/attachments/\(encode(attachment.id))?encoding=base64"
            let payload: Payload = try await browser.api(path)
            guard let data = Data(base64Encoded: payload.contentBase64) else { throw CocoaError(.fileReadCorruptFile) }
            let target = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension((payload.filename as NSString).pathExtension)
            try data.write(to: target, options: [.atomic, .completeFileProtection])
            previewURL = target
        } catch { self.error = error.localizedDescription }
    }

    private func icon(_ mime: String) -> String {
        if mime.hasPrefix("image/") { return "photo" }
        if mime == "application/pdf" { return "doc.richtext" }
        if mime.hasPrefix("video/") { return "film" }
        if mime.hasPrefix("audio/") { return "waveform" }
        return "doc"
    }
}

enum RubidiumComposerRequest: Identifiable {
    case new
    case reply(RubidiumThreadDetail, RubidiumMailMessage)
    case replyAll(RubidiumThreadDetail, RubidiumMailMessage)
    case forward(RubidiumThreadDetail, RubidiumMailMessage)

    var id: String {
        switch self {
        case .new: "new"
        case .reply(let thread, _): "reply:\(thread.id)"
        case .replyAll(let thread, _): "reply-all:\(thread.id)"
        case .forward(let thread, _): "forward:\(thread.id)"
        }
    }
}

struct RubidiumComposerPayload: Hashable, Codable {
    var accountId: String
    var to: [String]
    var cc: [String]
    var bcc: [String]
    var subject: String
    var bodyText: String
    var bodyHtml: String?
    var attachments: [RubidiumOutgoingAttachment]
    var threadId: String?
    var replyToMessageId: String?
    var inReplyTo: String?
    var references: [String]
    var replyMode: String?
    var sendAt: Date?
    var quotedHistory: String? = nil

    var dictionary: [String: Any] {
        func addresses(_ values: [String]) -> [[String: String]] {
            values.map { ["name": $0, "address": $0.lowercased()] }
        }
        return [
            "accountId": accountId,
            "recipients": ["to": addresses(to), "cc": addresses(cc), "bcc": addresses(bcc)],
            "subject": subject,
            "bodyText": bodyText,
            "bodyHtml": bodyHtml as Any,
            "attachments": attachments.map {
                ["filename": $0.filename, "mimeType": $0.mimeType, "contentBase64": $0.data.base64EncodedString(), "inline": $0.inline] as [String: Any]
            },
            "threadId": threadId as Any,
            "replyToMessageId": replyToMessageId as Any,
            "inReplyTo": inReplyTo as Any,
            "references": references,
            "replyMode": replyMode as Any,
            "sendAt": sendAt.map { ISO8601DateFormatter().string(from: $0) } as Any,
        ]
    }
}

private struct RubidiumRecipientSuggestion: Identifiable, Hashable {
    let name: String
    let address: String

    var id: String { address.lowercased() }
    var displayName: String { name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? address : name }
}

private struct RubidiumMailComposer: View {
    @ObservedObject var store: RubidiumNativeStore
    let request: RubidiumComposerRequest
    @Environment(\.dismiss) private var dismiss
    @State private var accountId = ""
    @State private var to = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var mailboxRecipients: [RubidiumMailAddress] = []
    @State private var subject = ""
    @State private var richBody = AttributedString()
    @State private var textSelection = AttributedTextSelection()
    @State private var quotedHistory: String?
    @State private var quotedHistoryExpanded = false
    @State private var attachments: [RubidiumOutgoingAttachment] = []
    @State private var showDetails = false
    @State private var showFilePicker = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var draftId: String?
    @State private var isSending = false
    @State private var deliveryLabel = ""
    @State private var error: String?
    @State private var showDiscard = false
    @State private var sendLater = false
    @State private var sendDate = Date().addingTimeInterval(3600)
    @State private var showIntelligence = false
    @StateObject private var intelligence = RubidiumIntelligenceModel()
    @FocusState private var focused: Field?

    enum Field { case to, cc, bcc, subject, body }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("From", selection: $accountId) {
                        ForEach(store.accounts) { Text($0.email).tag($0.id) }
                    }
                    recipientField("To", text: $to, field: .to)
                    if showDetails || !cc.isEmpty || !bcc.isEmpty {
                        recipientField("Cc", text: $cc, field: .cc)
                        recipientField("Bcc", text: $bcc, field: .bcc)
                    } else {
                        Button("Add Cc/Bcc") { showDetails = true }
                    }
                    TextField("Subject", text: $subject)
                        .focused($focused, equals: .subject)
                        .keyboardType(.default)
                        .textInputAutocapitalization(.sentences)
                        .autocorrectionDisabled(false)
                        .submitLabel(.next)
                        .onSubmit { focused = .body }
                }
                Section {
                    TextEditor(text: $richBody, selection: $textSelection)
                        .focused($focused, equals: .body)
                        .keyboardType(.default)
                        .textInputAutocapitalization(.sentences)
                        .autocorrectionDisabled(false)
                        .frame(minHeight: 260)
                        .scrollDismissesKeyboard(.interactively)
                        .accessibilityLabel("Message")
                        .overlay(alignment: .topLeading) {
                            if plainBody.isEmpty {
                                Text("Write a message…")
                                    .foregroundStyle(.tertiary)
                                    .padding(.top, 8)
                                    .padding(.leading, 5)
                                    .allowsHitTesting(false)
                            }
                        }
                }
                if let quotedHistory {
                    Section {
                        DisclosureGroup("Quoted message", isExpanded: $quotedHistoryExpanded) {
                            Text(quotedHistory)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                                .padding(.vertical, 6)

                            Button("Remove quoted message", systemImage: "xmark.circle", role: .destructive) {
                                self.quotedHistory = nil
                                quotedHistoryExpanded = false
                            }
                        }
                    } footer: {
                        Text("The original conversation will be included below your response.")
                    }
                }
                if !attachments.isEmpty {
                    Section("Attachments") {
                        ForEach(attachments) { attachment in
                            HStack {
                                Image(systemName: attachment.mimeType.hasPrefix("image/") ? "photo" : "doc")
                                VStack(alignment: .leading) {
                                    Text(attachment.filename).lineLimit(1)
                                    Text(ByteCountFormatter.string(fromByteCount: Int64(attachment.data.count), countStyle: .file))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button(role: .destructive) { attachments.removeAll { $0.id == attachment.id } } label: { Image(systemName: "xmark.circle.fill") }
                            }
                        }
                    }
                }
                if sendLater {
                    Section("Send Later") { DatePicker("Delivery", selection: $sendDate, in: Date()...) }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(hasContent)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { hasContent ? (showDiscard = true) : dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await send() } } label: {
                        if isSending { ProgressView() } else { Image(systemName: sendLater ? "clock.arrow.circlepath" : "arrow.up.circle.fill") }
                    }
                    .disabled(!canSend || isSending)
                    .accessibilityLabel(sendLater ? "Schedule message" : "Send message")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button(
                            sendLater ? "Send Now" : "Send Later",
                            systemImage: sendLater ? "paperplane" : "clock"
                        ) {
                            sendLater.toggle()
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                    }
                    .accessibilityLabel("Delivery options")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Menu {
                        PhotosPicker(
                            selection: $photos,
                            maxSelectionCount: 20,
                            matching: .any(of: [.images, .videos])
                        ) {
                            Label("Photo or Video", systemImage: "photo")
                        }
                        Button("Choose File", systemImage: "doc") {
                            showFilePicker = true
                        }
                    } label: {
                        Image(systemName: "paperclip")
                    }
                    .accessibilityLabel("Add attachment")

                    Menu {
                        Button("Bold", systemImage: "bold") { applyFont(.bold) }
                        Button("Italic", systemImage: "italic") { applyFont(.italic) }
                        Button("Underline", systemImage: "underline") { applyUnderline() }
                    } label: {
                        Image(systemName: "textformat")
                    }
                    .accessibilityLabel("Formatting")

                    Button { showIntelligence = true } label: {
                        Image(systemName: "sparkles")
                    }
                    .accessibilityLabel("Write with Rubidium")
                    Spacer()
                    Button { focused = nil } label: {
                        Image(systemName: "keyboard.chevron.compact.down")
                    }
                    .accessibilityLabel("Hide keyboard")
                }
            }
            .fileImporter(isPresented: $showFilePicker, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { addFiles(urls) }
            }
            .onChange(of: photos) { _, values in Task { await addPhotos(values) } }
            .sheet(isPresented: $showIntelligence) {
                RubidiumIntelligenceView(
                    intelligence: intelligence,
                    context: "Conversation:\n\(store.intelligenceContext)\n\nUser draft:\n\(plainBody)",
                    insertResult: { suggestion in
                        richBody.append(AttributedString(plainBody.isEmpty ? suggestion : "\n\n\(suggestion)"))
                    },
                    replaceResult: { suggestion in
                        richBody = AttributedString(suggestion)
                    }
                )
            }
            .alert("Keep this draft?", isPresented: $showDiscard) {
                Button("Keep Draft") { Task { try? await saveDraft(); dismiss() } }
                Button("Discard", role: .destructive) {
                    RubidiumLocalCache.shared.remove(key: localDraftKey)
                    if let draftId { Task { await store.deleteDraft(draftId) } }
                    dismiss()
                }
                Button("Cancel", role: .cancel) {}
            }
            .alert("Couldn’t send", isPresented: .constant(error != nil)) {
                Button("OK") { error = nil }
            } message: { Text(error ?? "") }
            .task {
                configure()
                await prepareForwardAttachments()
            }
            .task {
                mailboxRecipients = mergeRecipients(
                    await store.loadRecipientSuggestions(limit: 60),
                    mailboxRecipients
                )
            }
            .task(id: recipientLookupKey) {
                let query = recipientLookupQuery
                guard query.count >= 2 else { return }
                try? await Task.sleep(for: .milliseconds(240))
                guard !Task.isCancelled else { return }
                let matches = await store.loadRecipientSuggestions(query: query, limit: 30)
                guard !Task.isCancelled else { return }
                mailboxRecipients = mergeRecipients(matches, mailboxRecipients)
            }
            .task(id: autosaveKey) {
                guard hasContent else { return }
                try? await Task.sleep(for: .seconds(1.2))
                RubidiumLocalCache.shared.save(cachePayload, key: localDraftKey)
                try? await saveDraft()
            }
        }
    }

    private var title: String {
        switch request { case .new: "New Message"; case .reply: "Reply"; case .replyAll: "Reply All"; case .forward: "Forward" }
    }

    private var plainBody: String { String(richBody.characters) }
    private var composedBody: String {
        guard let quotedHistory else { return plainBody }
        let separator = plainBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : "\n\n"
        return plainBody + separator + quotedHistory
    }
    private var hasContent: Bool {
        !to.isEmpty || !subject.isEmpty || !plainBody.isEmpty || quotedHistory != nil || !attachments.isEmpty
    }
    private var canSend: Bool {
        let hasWritableBody = !plainBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || (isForward && quotedHistory != nil)
        return !accountId.isEmpty && !parse(to).isEmpty && hasWritableBody
    }
    private var isForward: Bool {
        if case .forward = request { return true }
        return false
    }
    private var autosaveKey: String {
        "\(accountId)|\(to)|\(cc)|\(bcc)|\(subject)|\(plainBody.hashValue)|\(quotedHistory?.hashValue ?? 0)|\(attachments.hashValue)"
    }
    private var localDraftKey: String { "composer:\(request.id)" }

    private var knownRecipients: [RubidiumRecipientSuggestion] {
        let ownAddresses = Set(store.accounts.map { $0.email.lowercased() })
        let activeParticipants = store.activeThread?.participants ?? []
        var seen = Set<String>()

        return (mailboxRecipients + activeParticipants + store.threads.flatMap(\.participants)).compactMap { participant in
            let address = participant.address.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = address.lowercased()
            guard address.contains("@"), !ownAddresses.contains(key), seen.insert(key).inserted else {
                return nil
            }
            return RubidiumRecipientSuggestion(name: participant.name, address: address)
        }
    }

    private var recipientLookupQuery: String {
        switch focused {
        case .to: currentRecipientToken(in: to)
        case .cc: currentRecipientToken(in: cc)
        case .bcc: currentRecipientToken(in: bcc)
        default: ""
        }
    }

    private var recipientLookupKey: String {
        let field: String
        switch focused {
        case .to: field = "to"
        case .cc: field = "cc"
        case .bcc: field = "bcc"
        default: field = "none"
        }
        return "\(field):\(recipientLookupQuery.lowercased())"
    }

    private func mergeRecipients(
        _ preferred: [RubidiumMailAddress],
        _ existing: [RubidiumMailAddress]
    ) -> [RubidiumMailAddress] {
        var seen = Set<String>()
        return (preferred + existing).filter {
            seen.insert($0.address.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()).inserted
        }
    }

    private func recipientField(_ label: String, text: Binding<String>, field: Field) -> some View {
        let suggestions = recipientSuggestions(for: text.wrappedValue, field: field)

        return VStack(alignment: .leading, spacing: suggestions.isEmpty ? 0 : 9) {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .foregroundStyle(.secondary)
                    .frame(width: 34, alignment: .leading)
                TextField("name@example.com", text: text)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .keyboardType(.emailAddress)
                    .submitLabel(.next)
                    .focused($focused, equals: field)
                    .onSubmit { advance(from: field) }
            }

            if !suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(suggestions.prefix(3).enumerated()), id: \.element.id) { index, suggestion in
                        if index > 0 {
                            Divider()
                                .padding(.leading, 34)
                        }

                        Button {
                            completeRecipient(suggestion, in: text, field: field)
                        } label: {
                            HStack(spacing: 9) {
                                Text(String(suggestion.displayName.prefix(1)).uppercased())
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(RubidiumTheme.accent)
                                    .frame(width: 27, height: 27)
                                    .background(RubidiumTheme.accent.opacity(0.12), in: Circle())

                                VStack(alignment: .leading, spacing: 1) {
                                    Text(suggestion.displayName)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                    if suggestion.displayName != suggestion.address {
                                        Text(suggestion.address)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .lineLimit(1)

                                Spacer(minLength: 8)
                                Image(systemName: "plus.circle.fill")
                                    .font(.body)
                                    .foregroundStyle(RubidiumTheme.accent)
                            }
                            .padding(.vertical, 7)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Add \(suggestion.displayName), \(suggestion.address)")
                    }
                }
                .padding(.leading, 42)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.smooth(duration: 0.18), value: suggestions.map(\.id))
    }

    private func recipientSuggestions(for value: String, field: Field) -> [RubidiumRecipientSuggestion] {
        guard focused == field else { return [] }
        let token = currentRecipientToken(in: value)
        let completed = Set(parse(value).map { $0.lowercased() })

        return Array(
            knownRecipients
                .filter { suggestion in
                    guard !completed.contains(suggestion.address.lowercased()) else { return false }
                    return token.isEmpty
                        || suggestion.address.localizedCaseInsensitiveContains(token)
                        || suggestion.displayName.localizedCaseInsensitiveContains(token)
                }
                .prefix(token.isEmpty ? 4 : 6)
        )
    }

    private func currentRecipientToken(in value: String) -> String {
        value.split(
            omittingEmptySubsequences: false,
            whereSeparator: { $0 == "," || $0 == ";" || $0 == "\n" }
        )
        .last?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func completeRecipient(
        _ suggestion: RubidiumRecipientSuggestion,
        in text: Binding<String>,
        field: Field
    ) {
        let value = text.wrappedValue
        if let separator = value.lastIndex(where: { $0 == "," || $0 == ";" || $0 == "\n" }) {
            text.wrappedValue = String(value[...separator]) + " " + suggestion.address + ", "
        } else {
            text.wrappedValue = suggestion.address + ", "
        }
        focused = field
        RubidiumHaptics.shared.play(.selection)
    }

    private func advance(from field: Field) {
        switch field {
        case .to: focused = showDetails ? .cc : .subject
        case .cc: focused = .bcc
        case .bcc, .subject: focused = .body
        case .body: focused = nil
        }
    }

    private func configure() {
        if let cached = RubidiumLocalCache.shared.load(RubidiumComposerPayload.self, key: localDraftKey) {
            accountId = cached.accountId
            to = cached.to.joined(separator: ", ")
            cc = cached.cc.joined(separator: ", ")
            bcc = cached.bcc.joined(separator: ", ")
            subject = cached.subject
            let restored = restoredDraft(cached)
            richBody = AttributedString(restored.body)
            quotedHistory = restored.quote
            attachments = cached.attachments
            if let date = cached.sendAt { sendLater = true; sendDate = date }
            focused = .body
            return
        }
        accountId = store.accounts.first?.id ?? ""
        switch request {
        case .new:
            focused = .to
        case .reply(let thread, let message):
            accountId = thread.accountId
            to = (message.headers.replyTo.first ?? message.from).address
            subject = normalized("Re:", message.subject)
            quotedHistory = quote(for: message)
            focused = .body
        case .replyAll(let thread, let message):
            accountId = thread.accountId
            let own = Set(store.accounts.map { $0.email.lowercased() })
            let values = [message.from] + message.to + message.cc
            to = values.map(\.address).filter { !own.contains($0.lowercased()) }.uniqued().joined(separator: ", ")
            subject = normalized("Re:", message.subject)
            quotedHistory = quote(for: message)
            focused = .body
        case .forward(let thread, let message):
            accountId = thread.accountId
            subject = normalized("Fwd:", message.subject)
            quotedHistory = "---------- Forwarded message ----------\nFrom: \(message.from.address)\nDate: \(displayDate(message.receivedAt))\nSubject: \(message.subject)\n\n\(message.bodyText)"
            focused = .to
        }
    }

    private func quote(for message: RubidiumMailMessage) -> String {
        let sender = message.from.name.isEmpty ? message.from.address : message.from.name
        return "On \(displayDate(message.receivedAt)), \(sender) wrote:\n> \(message.bodyText.replacingOccurrences(of: "\n", with: "\n> "))"
    }

    private func displayDate(_ value: String) -> String {
        guard let date = RubidiumDate.parse(value) else { return value }
        return date.formatted(.dateTime.weekday(.wide).month(.wide).day().year().hour().minute())
    }

    private func restoredDraft(_ cached: RubidiumComposerPayload) -> (body: String, quote: String?) {
        if let quote = cached.quotedHistory {
            return (cached.bodyText, quote)
        }

        let markers = ["\n\nOn ", "\n\n---------- Forwarded message ----------"]
        for marker in markers {
            if let range = cached.bodyText.range(of: marker) {
                return (
                    String(cached.bodyText[..<range.lowerBound]),
                    String(cached.bodyText[range.upperBound...]).isEmpty
                        ? nil
                        : String(cached.bodyText[range.lowerBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                )
            }
        }
        if cached.bodyText.hasPrefix("On ") || cached.bodyText.hasPrefix("---------- Forwarded message ----------") {
            return ("", cached.bodyText)
        }
        return (cached.bodyText, nil)
    }

    private func prepareForwardAttachments() async {
        guard case .forward(let thread, let message) = request,
              thread.provider != "microsoft",
              attachments.isEmpty else { return }
        for attachment in message.attachments where !attachment.inline {
            guard attachment.size <= 25 * 1_024 * 1_024 else { continue }
            if let outgoing = try? await store.downloadAttachment(message: message, attachment: attachment) {
                attachments.append(outgoing)
            }
        }
    }

    private func normalized(_ prefix: String, _ value: String) -> String {
        value.range(of: "^(?i)(re|fwd|fw):", options: .regularExpression) == nil ? "\(prefix) \(value)" : value
    }

    private func parse(_ value: String) -> [String] {
        value.split(whereSeparator: { $0 == "," || $0 == ";" || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { $0.contains("@") && $0.contains(".") }
            .uniqued()
    }

    private var payload: RubidiumComposerPayload {
        let context: (String?, String?, String?, String?, [String]) = {
            switch request {
            case .new: (nil, nil, nil, nil, [])
            case .reply(let thread, let message):
                (thread.providerThreadId, "reply", message.providerId, message.headers.messageId, message.headers.references + [message.headers.messageId].compactMap { $0 })
            case .replyAll(let thread, let message):
                (thread.providerThreadId, "replyAll", message.providerId, message.headers.messageId, message.headers.references + [message.headers.messageId].compactMap { $0 })
            case .forward(let thread, let message):
                (thread.providerThreadId, "forward", message.providerId, nil, [])
            }
        }()
        return .init(
            accountId: accountId,
            to: parse(to), cc: parse(cc), bcc: parse(bcc),
            subject: subject, bodyText: composedBody, bodyHtml: htmlBody,
            attachments: attachments, threadId: context.0,
            replyToMessageId: context.2, inReplyTo: context.3, references: context.4,
            replyMode: context.1, sendAt: sendLater ? sendDate : nil
        )
    }

    private var cachePayload: RubidiumComposerPayload {
        var cached = payload
        cached.bodyText = plainBody
        cached.bodyHtml = attributedHTML
        cached.quotedHistory = quotedHistory
        return cached
    }

    private var htmlBody: String? {
        guard var html = attributedHTML else { return nil }
        guard let quotedHistory else { return html }
        let escapedQuote = quotedHistory
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\n", with: "<br>")
        let quoteHTML = "<blockquote style=\"margin:16px 0 0;padding-left:12px;border-left:2px solid #999;color:#666\">\(escapedQuote)</blockquote>"
        if let closingBody = html.range(of: "</body>", options: [.backwards, .caseInsensitive]) {
            html.insert(contentsOf: quoteHTML, at: closingBody.lowerBound)
        } else {
            html.append(quoteHTML)
        }
        return html
    }

    private var attributedHTML: String? {
        let attributed = NSAttributedString(richBody)
        guard let data = try? attributed.data(
            from: NSRange(location: 0, length: attributed.length),
            documentAttributes: [.documentType: NSAttributedString.DocumentType.html]
        ) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private enum FontTreatment { case bold, italic }

    private func applyFont(_ treatment: FontTreatment) {
        richBody.transformAttributes(in: &textSelection) { attributes in
            attributes.font = treatment == .bold ? .body.bold() : .body.italic()
        }
    }

    private func applyUnderline() {
        richBody.transformAttributes(in: &textSelection) { attributes in
            attributes.underlineStyle = .single
        }
    }

    private func saveDraft() async throws {
        RubidiumLocalCache.shared.save(cachePayload, key: localDraftKey)
        draftId = try await store.saveDraft(payload, id: draftId)
        deliveryLabel = "Draft saved"
    }

    private func send() async {
        isSending = true
        deliveryLabel = sendLater ? "Queuing…" : attachments.isEmpty ? "Sending…" : "Uploading…"
        do {
            try await store.send(payload)
            RubidiumLocalCache.shared.remove(key: localDraftKey)
            if let draftId { await store.deleteDraft(draftId) }
            deliveryLabel = sendLater ? "Scheduled" : "Sent"
            RubidiumHaptics.shared.play(.success)
            try? await Task.sleep(for: .milliseconds(500))
            dismiss()
        } catch {
            self.error = error.localizedDescription
            deliveryLabel = "Failed — your draft is safe"
            try? await saveDraft()
            RubidiumHaptics.shared.play(.error)
        }
        isSending = false
    }

    private func addFiles(_ urls: [URL]) {
        for url in urls.prefix(20) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url), data.count <= 25 * 1_024 * 1_024 {
                attachments.append(.init(filename: url.lastPathComponent, mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream", data: data))
            }
        }
    }

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self), data.count <= 25 * 1_024 * 1_024 else { continue }
            let type = item.supportedContentTypes.first ?? .image
            attachments.append(.init(filename: "Photo-\(attachments.count + 1).\(type.preferredFilenameExtension ?? "jpg")", mimeType: type.preferredMIMEType ?? "image/jpeg", data: data))
        }
        photos = []
    }
}

private extension Array where Element == String {
    func uniqued() -> [String] {
        var seen = Set<String>()
        return filter { seen.insert($0.lowercased()).inserted }
    }
}
