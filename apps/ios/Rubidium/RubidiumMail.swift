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
        let id = event.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? event.id
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
            let id = event.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? event.id
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
            let id = event.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? event.id
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
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let response: RubidiumThreadResponse = try await browser.api("/api/threads/\(encoded)")
        activeThread = response.thread
        return response.thread
    }

    func perform(_ action: RubidiumMailAction, on thread: RubidiumThreadSummary, snoozedUntil: Date? = nil) async -> Bool {
        guard let browser else { return false }
        let snapshot = threads
        applyOptimistic(action, id: thread.id)
        do {
            let encoded = thread.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? thread.id
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
    let presentIntelligence: () -> Void
    @State private var selection: RubidiumMailboxDestination? = .current
    @State private var columnVisibility: NavigationSplitViewVisibility = .automatic
    @State private var composeRequest: RubidiumComposerRequest?
    @State private var deepLinkedThread: RubidiumThreadSummary?
    @State private var deepLinkedEvent: RubidiumCalendarEvent?
    @State private var compactSidebarOpen = false
    @ObservedObject private var notifications = RubidiumNotifications.shared

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                ZStack(alignment: .leading) {
                    destination(selection ?? .current, openMailboxes: openSidebar)
                        .disabled(compactSidebarOpen)

                    if compactSidebarOpen {
                        Color.black.opacity(0.48)
                            .ignoresSafeArea()
                            .onTapGesture { closeSidebar() }
                            .transition(.opacity)

                        GeometryReader { geometry in
                            HStack(spacing: 0) {
                                RubidiumMailboxSidebar(
                                    store: store,
                                    selection: $selection,
                                    compose: {
                                        closeSidebar()
                                        composeRequest = .new
                                    },
                                    didSelect: closeSidebar
                                )
                                .frame(width: min(geometry.size.width * 0.88, 370))
                                .shadow(color: .black.opacity(0.45), radius: 30, x: 14)
                                Spacer(minLength: 0)
                            }
                        }
                        .ignoresSafeArea()
                        .transition(.move(edge: .leading))
                        .zIndex(2)
                    }
                }
                .animation(.smooth(duration: 0.28, extraBounce: 0.02), value: compactSidebarOpen)
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
}

private struct RubidiumMailboxSidebar: View {
    @ObservedObject var store: RubidiumNativeStore
    @Binding var selection: RubidiumMailboxDestination?
    let compose: () -> Void
    var didSelect: () -> Void = {}

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
                            Text("EVERY INBOX · ONE PLACE")
                                .font(.caption2.weight(.bold))
                                .tracking(1.15)
                                .foregroundStyle(.white.opacity(0.48))
                        }
                        Spacer()
                        Button(action: didSelect) {
                            Image(systemName: "xmark")
                                .font(.body.weight(.semibold))
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
                    ForEach(main) { destination in row(destination) }

                    sidebarHeader("Mailboxes")
                        .padding(.top, 22)
                    ForEach(folders) { destination in row(destination) }

                    ForEach(store.accounts) { account in
                        sidebarHeader(account.displayName.isEmpty ? account.email : account.displayName)
                            .padding(.top, 22)
                        let accountBoxes = store.mailboxes.filter { $0.accountId == account.id }
                        ForEach(accountBoxes) { mailbox in
                            row(.init(
                                id: "provider:\(mailbox.id)",
                                title: mailbox.name,
                                symbol: mailboxSymbol(mailbox.kind),
                                kind: .provider,
                                accountId: account.id,
                                providerView: mailbox.kind
                            ), count: mailbox.unreadCount)
                        }
                    }

                    sidebarHeader("Rubidium")
                        .padding(.top, 22)
                    row(.init(id: "search", title: "Search", symbol: "sparkle.magnifyingglass", kind: .search))
                    row(.init(id: "settings", title: "Accounts & Settings", symbol: "gearshape", kind: .accounts))
                }
                .padding(.vertical, 12)
            }
        }
        .preferredColorScheme(.dark)
        .foregroundStyle(.white)
    }

    private func sidebarHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .tracking(1.1)
            .foregroundStyle(.white.opacity(0.42))
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
    }

    private func row(_ destination: RubidiumMailboxDestination, count: Int = 0) -> some View {
        Button {
            selection = destination
            RubidiumHaptics.shared.play(.selection)
            didSelect()
        } label: {
            HStack(spacing: 13) {
                Image(systemName: destination.symbol)
                    .symbolVariant(selection == destination ? .fill : .none)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(selection == destination ? RubidiumTheme.accentSoft : .white.opacity(0.68))
                    .frame(width: 24)
                Text(destination.title)
                    .font(.body.weight(selection == destination ? .semibold : .medium))
                    .lineLimit(1)
                Spacer(minLength: 12)
                if count > 0 {
                    Text(count, format: .number)
                        .font(.caption.weight(.bold))
                        .monospacedDigit()
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(
                            selection == destination
                                ? RubidiumTheme.accent
                                : Color.white.opacity(0.12),
                            in: Capsule()
                        )
                }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background {
                if selection == destination {
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
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .accessibilityAddTraits(selection == destination ? .isSelected : [])
    }

    private func mailboxSymbol(_ kind: String) -> String {
        switch kind {
        case "sent": "paperplane"
        case "drafts": "doc"
        case "archive": "archivebox"
        case "junk": "xmark.bin"
        case "trash": "trash"
        default: "tray"
        }
    }
}

private struct RubidiumMailboxView: View {
    @ObservedObject var store: RubidiumNativeStore
    let destination: RubidiumMailboxDestination
    @Binding var composeRequest: RubidiumComposerRequest?
    let presentIntelligence: () -> Void
    let openMailboxes: () -> Void
    @State private var filterUnread = false
    @State private var editMode: EditMode = .inactive
    @State private var selected = Set<String>()
    @State private var showSearch = false
    @State private var navigationPath = NavigationPath()

    private var visibleThreads: [RubidiumThreadSummary] {
        store.threads.filter { !filterUnread || $0.unread }
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
                        unreadOnly: filterUnread,
                        selecting: editMode == .active,
                        openMailboxes: openMailboxes,
                        openSearch: { showSearch = true },
                        compose: { composeRequest = .new },
                        toggleUnread: { withAnimation(.smooth) { filterUnread.toggle() } },
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
                        List(selection: $selected) {
                            ForEach(threadGroups) { group in
                                Section {
                                    ForEach(group.threads) { thread in
                                        Button {
                                            if editMode == .active {
                                                if selected.contains(thread.id) {
                                                    selected.remove(thread.id)
                                                } else {
                                                    selected.insert(thread.id)
                                                }
                                            } else {
                                                navigationPath.append(thread)
                                            }
                                        } label: {
                                            RubidiumThreadRow(thread: thread)
                                        }
                                        .buttonStyle(.plain)
                                        .accessibilityAddTraits(selected.contains(thread.id) ? .isSelected : [])
                                        .listRowInsets(EdgeInsets())
                                        .listRowBackground(Color.clear)
                                        .listRowSeparator(.hidden)
                                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
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
                                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                            Button {
                                                Task { _ = await store.perform(.archive, on: thread) }
                                            } label: { Label("Archive", systemImage: "archivebox") }
                                            .tint(.green)
                                            Button(role: .destructive) {
                                                Task { _ = await store.perform(.trash, on: thread) }
                                            } label: { Label("Trash", systemImage: "trash") }
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
                        .safeAreaInset(edge: .bottom) {
                            Color.clear.frame(height: editMode == .active ? 76 : 64)
                        }
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
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
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
            .environment(\.editMode, $editMode)
            .toolbar(.hidden, for: .navigationBar)
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
            .task(id: destination.id) { await refresh() }
            .onChange(of: destination.id) { _, _ in
                navigationPath = NavigationPath()
                selected.removeAll()
                editMode = .inactive
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
        withAnimation(.smooth(duration: 0.22)) {
            if editMode == .active {
                editMode = .inactive
                selected.removeAll()
            } else {
                editMode = .active
            }
        }
    }

    private var emptyDescription: String {
        filterUnread ? "There are no unread conversations here." : "New messages will appear here."
    }

    private func apiView() -> String? {
        switch destination.kind {
        case .flagged: "flagged"
        case .vip: "vip"
        case .snoozed: "snoozed"
        case .archive: "archive"
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
    let title: String
    let subtitle: String
    let count: Int
    let unreadOnly: Bool
    let selecting: Bool
    let openMailboxes: () -> Void
    let openSearch: () -> Void
    let compose: () -> Void
    let toggleUnread: () -> Void
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

            HStack(spacing: 7) {
                Text(count, format: .number)
                    .monospacedDigit()
                Text(count == 1 ? "conversation" : "conversations")
                if unreadOnly {
                    Text("·")
                    Text("Unread only")
                        .foregroundStyle(RubidiumTheme.accent)
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
                Text(subtitle.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Text(title)
                .font(.title.weight(.bold))
                .tracking(-0.7)
                .lineLimit(1)
        }
    }

    private var actionButtons: some View {
        HStack(spacing: 5) {
            Menu {
                Button(unreadOnly ? "Show all" : "Unread only", systemImage: unreadOnly ? "tray.full" : "envelope.badge") {
                    toggleUnread()
                }
                Button(selecting ? "Done selecting" : "Select messages", systemImage: selecting ? "checkmark" : "checkmark.circle") {
                    toggleSelection()
                }
            } label: {
                Image(systemName: unreadOnly ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
                    .frame(width: 42, height: 42)
            }
            .accessibilityLabel("Filter and select")

            Button(action: compose) {
                Image(systemName: "square.and.pencil")
                    .frame(width: 42, height: 42)
            }
            .accessibilityLabel("New message")
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
        HStack(spacing: 4) {
            Text(selectionCount, format: .number)
                .font(.caption.weight(.bold))
                .monospacedDigit()
                .frame(minWidth: 34)
                .accessibilityLabel("\(selectionCount) selected")
            action("Read", "envelope.open", markRead)
            action("Flag", "flag", flag)
            action("Archive", "archivebox", archive)
            action("Trash", "trash", trash, destructive: true)
        }
        .padding(5)
        .rubidiumGlass(cornerRadius: 20, interactive: true)
    }

    private func action(
        _ title: String,
        _ symbol: String,
        _ action: @escaping () -> Void,
        destructive: Bool = false
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(maxWidth: .infinity, minHeight: 44)
                .foregroundStyle(destructive ? RubidiumTheme.accent : .primary)
        }
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
            HStack(spacing: 7) {
                Button { reply(all: false) } label: {
                    Label("Reply", systemImage: "arrowshape.turn.up.left.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(RubidiumTheme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)

                Menu {
                    Button("Reply All", systemImage: "arrowshape.turn.up.left.2") { reply(all: true) }
                    Button("Forward", systemImage: "arrowshape.turn.up.right") { forward() }
                    Divider()
                    Button(summary.flagged ? "Unflag" : "Flag", systemImage: "flag") { action(summary.flagged ? .unflag : .flag) }
                    Button("Mark Unread", systemImage: "envelope.badge") { action(.unread) }
                    Button("Archive", systemImage: "archivebox") { action(.archive) }
                    Button("Move to Junk", systemImage: "xmark.bin") { action(.junk) }
                    Button("Delete", systemImage: "trash", role: .destructive) { action(.trash) }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.bold))
                        .frame(width: 50, height: 48)
                }
                .accessibilityLabel("Conversation actions")
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
        <style>:root{color-scheme:light dark}*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent;color:CanvasText;font:-apple-system-body}img,video,table{max-width:100%!important;height:auto!important}table{display:block;overflow-x:auto}pre{white-space:pre-wrap;font:inherit;margin:0}blockquote{border-inline-start:3px solid GrayText;margin-inline:0;padding-inline-start:12px;color:GrayText}a{color:LinkText}</style>
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

private struct RubidiumMailComposer: View {
    @ObservedObject var store: RubidiumNativeStore
    let request: RubidiumComposerRequest
    @Environment(\.dismiss) private var dismiss
    @State private var accountId = ""
    @State private var to = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var subject = ""
    @State private var richBody = AttributedString()
    @State private var textSelection = AttributedTextSelection()
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
                }
                Section {
                    TextEditor(text: $richBody, selection: $textSelection)
                        .focused($focused, equals: .body)
                        .frame(minHeight: 260)
                        .scrollDismissesKeyboard(.interactively)
                        .accessibilityLabel("Message")
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
                if !deliveryLabel.isEmpty { Section { Label(deliveryLabel, systemImage: "paperplane") } }
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
                ToolbarItemGroup(placement: .keyboard) {
                    PhotosPicker(selection: $photos, maxSelectionCount: 20, matching: .any(of: [.images, .videos])) {
                        Image(systemName: "photo")
                    }
                    Button { showFilePicker = true } label: { Image(systemName: "paperclip") }
                    Button { applyFont(.bold) } label: { Image(systemName: "bold") }
                    Button { applyFont(.italic) } label: { Image(systemName: "italic") }
                    Button { applyUnderline() } label: { Image(systemName: "underline") }
                    Menu {
                        Button(sendLater ? "Send Now" : "Send Later", systemImage: "clock") { sendLater.toggle() }
                    } label: { Image(systemName: "ellipsis.circle") }
                    Button { showIntelligence = true } label: { Image(systemName: "sparkles") }
                    Spacer()
                    Button { focused = nil } label: { Image(systemName: "keyboard.chevron.compact.down") }
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
            .task(id: autosaveKey) {
                guard hasContent else { return }
                try? await Task.sleep(for: .seconds(1.2))
                RubidiumLocalCache.shared.save(payload, key: localDraftKey)
                try? await saveDraft()
            }
        }
    }

    private var title: String {
        switch request { case .new: "New Message"; case .reply: "Reply"; case .replyAll: "Reply All"; case .forward: "Forward" }
    }

    private var plainBody: String { String(richBody.characters) }
    private var hasContent: Bool { !to.isEmpty || !subject.isEmpty || !plainBody.isEmpty || !attachments.isEmpty }
    private var canSend: Bool { !accountId.isEmpty && !parse(to).isEmpty && !plainBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var autosaveKey: String { "\(accountId)|\(to)|\(cc)|\(bcc)|\(subject)|\(plainBody.hashValue)|\(attachments.hashValue)" }
    private var localDraftKey: String { "composer:\(request.id)" }

    private func recipientField(_ label: String, text: Binding<String>, field: Field) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary).frame(width: 34, alignment: .leading)
            TextField("name@example.com", text: text)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                .focused($focused, equals: field)
        }
    }

    private func configure() {
        if let cached = RubidiumLocalCache.shared.load(RubidiumComposerPayload.self, key: localDraftKey) {
            accountId = cached.accountId
            to = cached.to.joined(separator: ", ")
            cc = cached.cc.joined(separator: ", ")
            bcc = cached.bcc.joined(separator: ", ")
            subject = cached.subject
            richBody = AttributedString(cached.bodyText)
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
            richBody = AttributedString("\n\nOn \(message.receivedAt), \(message.from.name) wrote:\n> \(message.bodyText.replacingOccurrences(of: "\n", with: "\n> "))")
            focused = .body
        case .replyAll(let thread, let message):
            accountId = thread.accountId
            let own = Set(store.accounts.map { $0.email.lowercased() })
            let values = [message.from] + message.to + message.cc
            to = values.map(\.address).filter { !own.contains($0.lowercased()) }.uniqued().joined(separator: ", ")
            subject = normalized("Re:", message.subject)
            richBody = AttributedString("\n\nOn \(message.receivedAt), \(message.from.name) wrote:\n> \(message.bodyText.replacingOccurrences(of: "\n", with: "\n> "))")
            focused = .body
        case .forward(let thread, let message):
            accountId = thread.accountId
            subject = normalized("Fwd:", message.subject)
            richBody = AttributedString("\n\n---------- Forwarded message ----------\nFrom: \(message.from.address)\nDate: \(message.receivedAt)\nSubject: \(message.subject)\n\n\(message.bodyText)")
            focused = .to
        }
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
            subject: subject, bodyText: plainBody, bodyHtml: htmlBody,
            attachments: attachments, threadId: context.0,
            replyToMessageId: context.2, inReplyTo: context.3, references: context.4,
            replyMode: context.1, sendAt: sendLater ? sendDate : nil
        )
    }

    private var htmlBody: String? {
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
        RubidiumLocalCache.shared.save(payload, key: localDraftKey)
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
