import SwiftUI

struct RubidiumMailAddress: Codable, Hashable {
    let name: String
    let address: String
}

struct RubidiumThreadSummary: Codable, Identifiable, Hashable {
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
}

struct RubidiumAccountCapabilities: Codable, Hashable {
    let mail: Bool
    let calendar: Bool
}

struct RubidiumAccount: Codable, Identifiable, Hashable {
    let id: String
    let provider: String
    let email: String
    let displayName: String
    let authBackend: String
    let status: String
    let lastSyncAt: Double?
    let capabilities: RubidiumAccountCapabilities
}

struct RubidiumCalendarSource: Codable, Identifiable, Hashable {
    let id: String
    let accountId: String
    let provider: String
    let accountEmail: String
    let name: String
    let color: String
    let timeZone: String
    let accessRole: String
    let primary: Bool
    let selected: Bool
    let status: String
    let lastSyncAt: Double?
}

struct RubidiumCalendarEvent: Codable, Identifiable, Hashable {
    let id: String
    let sourceId: String
    let accountId: String
    let provider: String
    let accountEmail: String
    let calendarName: String
    let calendarColor: String
    let title: String
    let start: String
    let end: String
    let allDay: Bool
    let status: String
    let responseStatus: String
    let location: String
    let joinUrl: String?
    let conferenceProvider: String?
    let editable: Bool
}

struct RubidiumThreadsResponse: Decodable {
    let threads: [RubidiumThreadSummary]
}

private struct RubidiumAccountsResponse: Decodable {
    let accounts: [RubidiumAccount]
}

private struct RubidiumSourcesResponse: Decodable {
    let sources: [RubidiumCalendarSource]
}

private struct RubidiumEventsResponse: Decodable {
    let events: [RubidiumCalendarEvent]
}

private struct RubidiumSyncResponse: Decodable {
    let results: [RubidiumCalendarSyncResult]
}

private struct RubidiumCalendarSyncResult: Decodable {
    let sourceId: String
    let processed: Int
    let mode: String
}

@MainActor
final class RubidiumNativeStore: ObservableObject {
    @Published var threads: [RubidiumThreadSummary] = []
    @Published var searchThreads: [RubidiumThreadSummary] = []
    @Published var accounts: [RubidiumAccount] = []
    @Published var sources: [RubidiumCalendarSource] = []
    @Published var events: [RubidiumCalendarEvent] = []
    @Published var mailboxes: [RubidiumMailbox] = []
    @Published var activeThread: RubidiumThreadDetail?
    @Published var isRefreshingMail = false
    @Published var mailActionError: String?
    @Published var notificationPreferences = RubidiumNotificationPreferences.standard
    @Published var isLoading = false
    @Published var isSyncingCalendar = false
    @Published var errorMessage: String?
    @Published var accountsErrorMessage: String?
    @Published var calendarErrorMessage: String?

    weak var browser: RubidiumBrowserModel?
    private var hasLoaded = false
    private var lastCalendarRefreshAttempt: Date?

    func attach(_ browser: RubidiumBrowserModel) {
        self.browser = browser
        if threads.isEmpty {
            threads = RubidiumLocalCache.shared.load([RubidiumThreadSummary].self, key: "threads") ?? []
            accounts = RubidiumLocalCache.shared.load([RubidiumAccount].self, key: "accounts") ?? []
            sources = RubidiumLocalCache.shared.load([RubidiumCalendarSource].self, key: "calendar-sources") ?? []
            events = RubidiumLocalCache.shared.load([RubidiumCalendarEvent].self, key: "calendar-events") ?? []
            mailboxes = RubidiumLocalCache.shared.load([RubidiumMailbox].self, key: "mailboxes") ?? []
        }
    }

    func loadAll(force: Bool = false) async {
        guard let browser, force || !hasLoaded else { return }
        isLoading = true
        errorMessage = nil
        accountsErrorMessage = nil
        calendarErrorMessage = nil

        do {
            let payload: RubidiumAccountsResponse = try await browser.api("/api/accounts")
            accounts = payload.accounts
            RubidiumLocalCache.shared.save(accounts, key: "accounts")
        } catch {
            accountsErrorMessage = error.localizedDescription
        }

        do {
            let payload: RubidiumSourcesResponse = try await browser.api("/api/calendar/sources")
            sources = payload.sources
            RubidiumLocalCache.shared.save(sources, key: "calendar-sources")
            try await loadCalendarEvents()
        } catch {
            calendarErrorMessage = error.localizedDescription
        }

        // Calendar and account navigation should become usable before the
        // larger native search index is decoded.
        isLoading = false

        do {
            let payload: RubidiumThreadsResponse = try await browser.api("/api/threads?limit=120")
            threads = payload.threads
            RubidiumLocalCache.shared.save(threads, key: "threads")
        } catch {
            errorMessage = error.localizedDescription
        }
        hasLoaded = true
    }

    func loadCalendarEvents(query: String? = nil) async throws {
        guard let browser else { return }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end = calendar.date(byAdding: .month, value: 6, to: start) ?? start.addingTimeInterval(180 * 86_400)
        var components = URLComponents()
        components.path = "/api/calendar/events"
        components.queryItems = [
            URLQueryItem(name: "from", value: ISO8601DateFormatter().string(from: start)),
            URLQueryItem(name: "to", value: ISO8601DateFormatter().string(from: end)),
        ]
        if let query, !query.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "q", value: query))
        }
        let payload: RubidiumEventsResponse = try await browser.api(components.string ?? "/api/calendar/events")
        events = payload.events
        RubidiumLocalCache.shared.save(events, key: "calendar-events")
    }

    func searchMail(_ query: String) async {
        guard let browser else { return }
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            searchThreads = []
            return
        }
        do {
            var components = URLComponents()
            components.path = "/api/threads"
            components.queryItems = [
                URLQueryItem(name: "limit", value: "160"),
                URLQueryItem(name: "q", value: normalized),
            ]
            let payload: RubidiumThreadsResponse = try await browser.api(
                components.string ?? "/api/threads"
            )
            guard !Task.isCancelled else { return }
            searchThreads = payload.threads
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func syncCalendar() async {
        guard let browser else { return }
        isSyncingCalendar = true
        calendarErrorMessage = nil
        lastCalendarRefreshAttempt = Date()
        do {
            let _: RubidiumSyncResponse = try await browser.api(
                "/api/calendar/sync",
                method: "POST",
                body: [:]
            )
            let sourcePayload: RubidiumSourcesResponse = try await browser.api("/api/calendar/sources")
            let accountPayload: RubidiumAccountsResponse = try await browser.api("/api/accounts")
            sources = sourcePayload.sources
            accounts = accountPayload.accounts
            try await loadCalendarEvents()
            RubidiumHaptics.shared.play(.success)
        } catch {
            calendarErrorMessage = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
        }
        isSyncingCalendar = false
    }

    func reloadAfterConnection() async {
        hasLoaded = false
        await loadAll(force: true)
        await prepareCalendar()
    }

    func prepareCalendar() async {
        guard !isSyncingCalendar else { return }
        if let lastCalendarRefreshAttempt,
           Date().timeIntervalSince(lastCalendarRefreshAttempt) < 90 {
            return
        }
        let newestSync = sources.compactMap(\.lastSyncAt).max().map { Date(timeIntervalSince1970: $0 / 1_000) }
        let stale = newestSync.map { Date().timeIntervalSince($0) > 15 * 60 } ?? true
        if sources.isEmpty || events.isEmpty || stale {
            await syncCalendar()
        }
    }

    var accountsNeedingCalendarAccess: [RubidiumAccount] {
        accounts.filter { !$0.capabilities.calendar }
    }
}

enum RubidiumNativeTab: Hashable {
    case mail
    case today
    case search
    case accounts
}

struct RubidiumNativeShell: View {
    @ObservedObject var browser: RubidiumBrowserModel
    @ObservedObject var store: RubidiumNativeStore
    @ObservedObject var security: RubidiumAppLockModel
    @Binding var selection: RubidiumNativeTab
    let mail: AnyView
    let presentIntelligence: () -> Void

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
            // Keep the WebKit session alive while native destinations are
            // visible; it owns the secure first-party cookie used by the
            // provider-neutral native API client.
            mail
                // Let the mailbox surface paint behind the status bar and
                // Dynamic Island. The web header applies the measured top
                // inset once, so controls remain in the tappable safe area.
                .ignoresSafeArea(.container, edges: [.top, .bottom])
                .opacity(selection == .mail ? 1 : 0)
                .allowsHitTesting(selection == .mail)
                .accessibilityHidden(selection != .mail)

            RubidiumNativeCalendarView(store: store, browser: browser)
                .opacity(selection == .today ? 1 : 0)
                .allowsHitTesting(selection == .today)
                .accessibilityHidden(selection != .today)

            RubidiumNativeSearchView(store: store) { thread in
                RubidiumHaptics.shared.play(.selection)
                selection = .mail
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
                    browser.openThread(thread.id)
                }
            }
            .opacity(selection == .search ? 1 : 0)
            .allowsHitTesting(selection == .search)
            .accessibilityHidden(selection != .search)

            RubidiumNativeAccountsView(store: store, browser: browser, security: security)
                .opacity(selection == .accounts ? 1 : 0)
                .allowsHitTesting(selection == .accounts)
                .accessibilityHidden(selection != .accounts)

            RubidiumNativeNavigationBar(
                selection: $selection,
                presentIntelligence: presentIntelligence
            )
            .padding(.horizontal, 12)
            .padding(.bottom, geometry.safeAreaInsets.bottom + 6)
            .zIndex(50)
            }
        }
        // Let mail and native lists visually continue behind the home
        // indicator. The control plane keeps its own measured safe padding.
        .ignoresSafeArea(.container, edges: .bottom)
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
    }
}

private struct RubidiumNativeNavigationBar: View {
    @Binding var selection: RubidiumNativeTab
    let presentIntelligence: () -> Void
    @Namespace private var navigationNamespace

    var body: some View {
        HStack(spacing: 2) {
            destination(.mail, title: "Mail", symbol: "envelope", selectedSymbol: "envelope.fill")
            destination(.today, title: "Today", symbol: "calendar", selectedSymbol: "calendar")
            intelligenceAction

            destination(
                .search,
                title: "Search",
                symbol: "magnifyingglass",
                selectedSymbol: "magnifyingglass.circle.fill"
            )
            destination(
                .accounts,
                title: "Settings",
                symbol: "gearshape",
                selectedSymbol: "gearshape.fill"
            )
        }
        .padding(5)
        .frame(maxWidth: 460)
        .rubidiumGlass(cornerRadius: 27, interactive: true)
        .dynamicTypeSize(.xSmall ... .accessibility1)
        .accessibilityElement(children: .contain)
    }

    private var intelligenceAction: some View {
        Button(action: presentIntelligence) {
            VStack(spacing: 2) {
                Image(systemName: "sparkles")
                    .contentTransition(.symbolEffect(.replace))
                    .font(.system(size: 17, weight: .semibold))
                Text("AI")
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .foregroundStyle(Color.secondary)
            .frame(maxWidth: .infinity, minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Rubidium Intelligence")
        .accessibilityHint("Summarize, find next steps, or draft a reply using Apple's on-device model")
    }

    private func destination(
        _ tab: RubidiumNativeTab,
        title: String,
        symbol: String,
        selectedSymbol: String
    ) -> some View {
        Button {
            guard selection != tab else { return }
            withAnimation(.smooth(duration: 0.24, extraBounce: 0.02)) {
                selection = tab
            }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: selection == tab ? selectedSymbol : symbol)
                    .contentTransition(.symbolEffect(.replace))
                    .font(.system(size: 17, weight: .semibold))
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .foregroundStyle(selection == tab ? Color.primary : Color.secondary)
            .frame(maxWidth: .infinity, minHeight: 52)
            .contentShape(Rectangle())
            .background {
                if selection == tab {
                    Capsule(style: .continuous)
                        .fill(.primary.opacity(0.1))
                        .matchedGeometryEffect(
                            id: "native-navigation-selection",
                            in: navigationNamespace
                        )
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selection == tab ? .isSelected : [])
    }
}

struct RubidiumNativeSearchView: View {
    @ObservedObject var store: RubidiumNativeStore
    let openThread: (RubidiumThreadSummary) -> Void
    let openEvent: (RubidiumCalendarEvent) -> Void
    @State private var query = ""

    init(
        store: RubidiumNativeStore,
        openThread: @escaping (RubidiumThreadSummary) -> Void,
        openEvent: @escaping (RubidiumCalendarEvent) -> Void = { _ in }
    ) {
        self.store = store
        self.openThread = openThread
        self.openEvent = openEvent
    }

    private var matchingThreads: [RubidiumThreadSummary] {
        let terms = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !terms.isEmpty else { return Array(store.threads.prefix(24)) }
        let local = store.threads.filter { thread in
            [thread.subject, thread.snippet, thread.displayName, thread.email]
                .joined(separator: " ")
                .lowercased()
                .contains(terms) ||
            thread.participants.contains {
                "\($0.name) \($0.address)".lowercased().contains(terms)
            }
        }
        var seen = Set<String>()
        return (local + store.searchThreads).filter { seen.insert($0.id).inserted }
    }

    private var matchingEvents: [RubidiumCalendarEvent] {
        let terms = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !terms.isEmpty else { return [] }
        return store.events.filter {
            "\($0.title) \($0.location) \($0.calendarName) \($0.accountEmail)"
                .lowercased()
                .contains(terms)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if matchingThreads.isEmpty && matchingEvents.isEmpty {
                    ContentUnavailableView(
                        "Nothing found",
                        systemImage: "magnifyingglass",
                        description: Text("Try a person, subject, place, or calendar event.")
                    )
                } else {
                    List {
                        if !matchingEvents.isEmpty {
                            Section("Calendar") {
                                ForEach(matchingEvents.prefix(8)) { event in
                                    Button {
                                        openEvent(event)
                                    } label: {
                                        RubidiumCalendarEventRow(event: event)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        Section(query.isEmpty ? "Recent conversations" : "Mail") {
                            ForEach(matchingThreads.prefix(80)) { thread in
                                Button {
                                    openThread(thread)
                                } label: {
                                    RubidiumThreadRow(thread: thread)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Search")
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Mail and calendar"
            )
            .textInputAutocapitalization(.never)
            .task(id: query) {
                guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    store.searchThreads = []
                    return
                }
                try? await Task.sleep(for: .milliseconds(280))
                guard !Task.isCancelled else { return }
                await store.searchMail(query)
            }
        }
    }
}

struct RubidiumThreadRow: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let thread: RubidiumThreadSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(thread.provider == "google" ? Color.red.opacity(0.14) : Color.blue.opacity(0.14))
                .frame(width: 42, height: 42)
                .overlay {
                    Text(dynamicTypeSize.isAccessibilitySize ? String(initials.prefix(1)) : initials)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.primary)
                        .dynamicTypeSize(.small ... .large)
                        .lineLimit(1)
                }

            VStack(alignment: .leading, spacing: 3) {
                if dynamicTypeSize.isAccessibilitySize {
                    Text(thread.displayName.isEmpty ? thread.email : thread.displayName)
                        .font(.subheadline.weight(thread.unread ? .bold : .semibold))
                        .lineLimit(2)
                    Text(RubidiumDate.short(thread.lastMessageAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    HStack {
                        Text(thread.displayName.isEmpty ? thread.email : thread.displayName)
                            .font(.subheadline.weight(thread.unread ? .bold : .semibold))
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(RubidiumDate.short(thread.lastMessageAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Text(thread.subject)
                    .font(.subheadline.weight(thread.unread ? .semibold : .regular))
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                Text(thread.snippet)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 2)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private var initials: String {
        let value = thread.displayName.isEmpty ? thread.email : thread.displayName
        return value.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
    }
}

struct RubidiumNativeCalendarView: View {
    @ObservedObject var store: RubidiumNativeStore
    @ObservedObject var browser: RubidiumBrowserModel
    @State private var isCreatingEvent = false

    private var groupedEvents: [(String, [RubidiumCalendarEvent])] {
        let groups = Dictionary(grouping: store.events) { RubidiumDate.day($0.start) }
        return groups.sorted {
            let left = RubidiumDate.parse($0.value.first?.start ?? "") ?? .distantFuture
            let right = RubidiumDate.parse($1.value.first?.start ?? "") ?? .distantFuture
            return left < right
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if store.isLoading && store.events.isEmpty {
                    ProgressView("Loading your calendars…")
                } else if store.events.isEmpty {
                    ScrollView {
                        VStack(spacing: 18) {
                            ContentUnavailableView(
                                "Your time is clear",
                                systemImage: "calendar",
                                description: Text(emptyDescription)
                            )
                            reconnectCards
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 72)
                    }
                    .refreshable { await store.syncCalendar() }
                } else {
                    List {
                        if let error = store.calendarErrorMessage {
                            Section {
                                Label(error, systemImage: "exclamationmark.triangle")
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                            }
                        }
                        ForEach(groupedEvents, id: \.0) { day, events in
                            Section(day) {
                                ForEach(events) { event in
                                    NavigationLink {
                                        RubidiumCalendarEventDetailView(store: store, event: event)
                                    } label: {
                                        RubidiumCalendarEventRow(event: event)
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .refreshable { await store.syncCalendar() }
                }
            }
            .navigationTitle("Today")
            .task {
                await store.prepareCalendar()
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        isCreatingEvent = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("New event")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        RubidiumHaptics.shared.play(.action)
                        Task { await store.syncCalendar() }
                    } label: {
                        if store.isSyncingCalendar {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(store.isSyncingCalendar)
                    .accessibilityLabel("Sync calendars")
                }
            }
            .sheet(isPresented: $isCreatingEvent) {
                RubidiumCalendarComposer(store: store)
            }
        }
    }

    private var emptyDescription: String {
        if !store.accountsNeedingCalendarAccess.isEmpty {
            return "Reconnect the accounts below once to grant Calendar access."
        }
        return store.calendarErrorMessage ?? "No upcoming events in your connected calendars."
    }

    @ViewBuilder
    private var reconnectCards: some View {
        ForEach(store.accountsNeedingCalendarAccess) { account in
            Button {
                RubidiumHaptics.shared.play(.action)
                Task { await browser.connect(account.provider) }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: account.provider == "google" ? "g.circle.fill" : "envelope.circle.fill")
                        .font(.title2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Reconnect \(account.provider == "google" ? "Google" : "Microsoft")")
                            .font(.subheadline.weight(.semibold))
                        Text(account.email)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .foregroundStyle(.secondary)
                }
                .padding(15)
                .rubidiumContentPanel(cornerRadius: 18)
            }
            .buttonStyle(.plain)
        }
    }
}

struct RubidiumCalendarEventRow: View {
    let event: RubidiumCalendarEvent

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 3)
                .fill(Color(hex: event.calendarColor) ?? providerColor)
                .frame(width: 4, height: 48)
            VStack(alignment: .leading, spacing: 4) {
                Text(event.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                Label(timeLabel, systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !event.location.isEmpty {
                    Label(event.location, systemImage: "mappin.and.ellipse")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Text("\(event.calendarName) · \(event.accountEmail)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if event.joinUrl != nil {
                Image(systemName: "video.fill")
                    .foregroundStyle(providerColor)
                    .accessibilityLabel("Video meeting")
            }
        }
        .padding(.vertical, 4)
    }

    private var providerColor: Color {
        event.provider == "google" ? .red : .blue
    }

    private var timeLabel: String {
        if event.allDay { return "All day" }
        guard let start = RubidiumDate.parse(event.start),
              let end = RubidiumDate.parse(event.end) else { return "" }
        return "\(start.formatted(date: .omitted, time: .shortened))–\(end.formatted(date: .omitted, time: .shortened))"
    }
}

struct RubidiumCalendarEventDetailView: View {
    @ObservedObject var store: RubidiumNativeStore
    let event: RubidiumCalendarEvent
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false
    @State private var isEditing = false

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text(event.title)
                        .font(.title2.weight(.bold))
                    Label(dateLabel, systemImage: "calendar")
                        .foregroundStyle(.secondary)
                    Label(timeLabel, systemImage: "clock")
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 6)
            }

            if !event.location.isEmpty || event.joinUrl != nil {
                Section("Where") {
                    if !event.location.isEmpty {
                        Label(event.location, systemImage: "mappin.and.ellipse")
                    }
                    if let value = event.joinUrl, let url = URL(string: value) {
                        Link(destination: url) {
                            Label(
                                event.provider == "google" ? "Join Google Meet" : "Join Microsoft Teams",
                                systemImage: "video.fill"
                            )
                        }
                    }
                }
            }

            Section("Calendar") {
                LabeledContent("Calendar", value: event.calendarName)
                LabeledContent("Account", value: event.accountEmail)
                LabeledContent("Response", value: responseLabel)
                LabeledContent("Provider", value: event.provider == "google" ? "Google" : "Microsoft")
            }
            Section("Response") {
                HStack {
                    Button("Accept", systemImage: "checkmark") { rsvp("accepted") }
                    Spacer()
                    Button("Maybe", systemImage: "questionmark") { rsvp("tentative") }
                    Spacer()
                    Button("Decline", systemImage: "xmark") { rsvp("declined") }
                }
                .buttonStyle(.bordered)
            }
            if event.editable {
                Section {
                    Button("Delete Event", systemImage: "trash", role: .destructive) {
                        confirmDelete = true
                    }
                }
            }
        }
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if event.editable {
                ToolbarItem(placement: .topBarTrailing) { Button("Edit") { isEditing = true } }
            }
        }
        .sheet(isPresented: $isEditing) {
            RubidiumCalendarComposer(store: store, event: event)
        }
        .confirmationDialog("Delete this event?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Event", role: .destructive) {
                Task { if await store.delete(event: event) { dismiss() } }
            }
        }
    }

    private var dateLabel: String {
        guard let start = RubidiumDate.parse(event.start) else { return event.start }
        return start.formatted(date: .complete, time: .omitted)
    }

    private var timeLabel: String {
        if event.allDay { return "All day" }
        guard let start = RubidiumDate.parse(event.start),
              let end = RubidiumDate.parse(event.end) else { return "" }
        return "\(start.formatted(date: .omitted, time: .shortened))–\(end.formatted(date: .omitted, time: .shortened))"
    }

    private var responseLabel: String {
        switch event.responseStatus.lowercased() {
        case "accepted": "Accepted"
        case "declined": "Declined"
        case "tentative": "Maybe"
        case "needsaction", "none", "notresponded": "Awaiting response"
        default: event.responseStatus.capitalized
        }
    }

    private func rsvp(_ response: String) {
        Task { _ = await store.respond(to: event, response: response) }
    }
}

struct RubidiumCalendarComposer: View {
    @ObservedObject var store: RubidiumNativeStore
    var event: RubidiumCalendarEvent? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var sourceId = ""
    @State private var title = ""
    @State private var start = Date().addingTimeInterval(3600)
    @State private var end = Date().addingTimeInterval(5400)
    @State private var allDay = false
    @State private var attendees = ""
    @State private var location = ""
    @State private var notes = ""
    @State private var videoCall = true
    @State private var isSaving = false
    @State private var error: String?

    private var writableSources: [RubidiumCalendarSource] {
        store.sources.filter { $0.accessRole == "writer" || $0.accessRole == "owner" }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Event title", text: $title)
                    Picker("Calendar", selection: $sourceId) {
                        ForEach(writableSources) { source in
                            Text("\(source.name) · \(source.accountEmail)").tag(source.id)
                        }
                    }
                }
                Section("Time") {
                    Toggle("All-day", isOn: $allDay)
                    DatePicker("Starts", selection: $start, displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                    DatePicker("Ends", selection: $end, in: start..., displayedComponents: allDay ? [.date] : [.date, .hourAndMinute])
                }
                Section("People and place") {
                    TextField("Attendees", text: $attendees, prompt: Text("email@example.com"))
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                    TextField("Location", text: $location)
                    Toggle("Add video call", isOn: $videoCall)
                }
                Section("Notes") {
                    TextEditor(text: $notes).frame(minHeight: 120)
                }
                if let error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) } }
            }
            .navigationTitle(event == nil ? "New Event" : "Edit Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(event == nil ? "Add" : "Save") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sourceId.isEmpty || end <= start || isSaving)
                }
            }
            .onAppear {
                if let event {
                    sourceId = event.sourceId
                    title = event.title
                    start = RubidiumDate.parse(event.start) ?? start
                    end = RubidiumDate.parse(event.end) ?? end
                    allDay = event.allDay
                    location = event.location
                    videoCall = event.joinUrl != nil
                } else {
                    sourceId = writableSources.first(where: { $0.primary })?.id ?? writableSources.first?.id ?? ""
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let formatter = ISO8601DateFormatter()
        let emails = attendees.split(whereSeparator: { $0 == "," || $0 == ";" || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { $0.contains("@") }
        do {
            var body: [String: Any] = [
                "sourceId": sourceId,
                "title": title,
                "start": formatter.string(from: start),
                "end": formatter.string(from: end),
                "allDay": allDay,
                "timeZone": TimeZone.current.identifier,
                "attendeeEmails": emails,
                "description": notes,
                "location": location,
                "onlineMeeting": videoCall,
            ]
            if let event {
                body.removeValue(forKey: "sourceId")
                try await store.updateCalendarEvent(event, body: body)
            } else {
                try await store.createCalendarEvent(body)
            }
            RubidiumHaptics.shared.play(.success)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
        }
    }
}

struct RubidiumNativeAccountsView: View {
    @ObservedObject var store: RubidiumNativeStore
    @ObservedObject var browser: RubidiumBrowserModel
    @ObservedObject var security: RubidiumAppLockModel
    @ObservedObject private var notifications = RubidiumNotifications.shared
    @AppStorage(RubidiumAppearance.storageKey) private var appearanceRaw = RubidiumAppearance.system.rawValue

    var body: some View {
        NavigationStack {
            List {
                Section("Add an inbox") {
                    providerButton("google", title: "Google", subtitle: "Gmail and Google Calendar")
                    providerButton("microsoft", title: "Microsoft", subtitle: "Outlook, Calendar, and Teams")
                }

                Section("Connected") {
                    if store.accounts.isEmpty {
                        Text("No inboxes connected yet.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(store.accounts) { account in
                        RubidiumAccountRow(account: account)
                    }
                }

                Section("Appearance") {
                    Picker("Theme", selection: $appearanceRaw) {
                        ForEach(RubidiumAppearance.allCases) { appearance in
                            Text(appearance.title).tag(appearance.rawValue)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Privacy") {
                    Toggle(
                        "Require \(security.authenticationLabel)",
                        isOn: Binding(
                            get: { security.isEnabled },
                            set: { enabled in
                                Task { await security.setEnabled(enabled) }
                            }
                        )
                    )
                    .disabled(security.isAuthenticating)

                    if security.isEnabled {
                        Button("Lock now", systemImage: "lock.fill") {
                            security.lock()
                        }
                    }

                    if let error = security.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section("Notifications") {
                    Button {
                        Task { await notifications.requestAuthorization() }
                    } label: {
                        LabeledContent(
                            "New mail notifications",
                            value: notificationStatus
                        )
                    }
                    Toggle("Enable new mail", isOn: preferenceBinding(\.enabled))
                    Picker("Notify me for", selection: Binding(
                        get: { store.notificationPreferences.scope },
                        set: { value in updatePreference { $0.scope = value } }
                    )) {
                        Text("All inboxes").tag("all")
                        Text("Priority only").tag("priority")
                        Text("Selected accounts").tag("custom")
                    }
                    if store.notificationPreferences.scope == "custom" {
                        ForEach(store.accounts) { account in
                            Toggle(account.email, isOn: Binding(
                                get: { store.notificationPreferences.accountIds.contains(account.id) },
                                set: { enabled in
                                    updatePreference { preferences in
                                        if enabled {
                                            if !preferences.accountIds.contains(account.id) { preferences.accountIds.append(account.id) }
                                        } else {
                                            preferences.accountIds.removeAll { $0 == account.id }
                                        }
                                    }
                                }
                            ))
                        }
                    }
                    Toggle("Show sender", isOn: preferenceBinding(\.showSender))
                    Toggle("Show subject", isOn: preferenceBinding(\.showSubject))
                    Toggle("Show message preview", isOn: preferenceBinding(\.showBody))
                    Toggle("Sound", isOn: preferenceBinding(\.sound))
                    Toggle("Badge", isOn: preferenceBinding(\.badge))
                    if let error = notifications.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                if let error = store.accountsErrorMessage ?? browser.errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Settings")
            .refreshable { await store.reloadAfterConnection() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sign out", role: .destructive) {
                        RubidiumHaptics.shared.play(.destructive)
                        Task { await browser.signOut() }
                    }
                }
            }
        }
    }

    private var notificationStatus: String {
        switch notifications.authorizationStatus {
        case .authorized, .provisional, .ephemeral: "On"
        case .denied: "Off in Settings"
        case .notDetermined: "Set Up"
        @unknown default: "Unknown"
        }
    }

    private func preferenceBinding(_ keyPath: WritableKeyPath<RubidiumNotificationPreferences, Bool>) -> Binding<Bool> {
        Binding(
            get: { store.notificationPreferences[keyPath: keyPath] },
            set: { value in updatePreference { $0[keyPath: keyPath] = value } }
        )
    }

    private func updatePreference(_ change: (inout RubidiumNotificationPreferences) -> Void) {
        var preferences = store.notificationPreferences
        change(&preferences)
        Task { await store.updateNotificationPreferences(preferences) }
    }

    private func providerButton(_ provider: String, title: String, subtitle: String) -> some View {
        Button {
            RubidiumHaptics.shared.play(.action)
            Task { await browser.connect(provider) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: provider == "google" ? "g.circle.fill" : "square.grid.2x2.fill")
                    .font(.title2)
                    .frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "plus")
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct RubidiumAccountRow: View {
    let account: RubidiumAccount

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "envelope.fill")
                .frame(width: 30, height: 30)
                .foregroundStyle(providerColor)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(account.email)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(capabilityLabel)
                    .font(.caption2)
                    .foregroundStyle(capabilityColor)
            }
            Spacer()
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
                .accessibilityLabel(account.status)
        }
        .padding(.vertical, 3)
    }

    private var title: String {
        account.displayName.isEmpty ? account.email : account.displayName
    }

    private var providerColor: Color {
        account.provider == "google" ? .red : .blue
    }

    private var capabilityLabel: String {
        account.capabilities.calendar ? "Mail + Calendar" : "Mail · Calendar needs reconnect"
    }

    private var capabilityColor: Color {
        account.capabilities.calendar ? .secondary : .orange
    }

    private var statusColor: Color {
        account.status == "connected" ? .green : .orange
    }
}

struct RubidiumNativeSignInView: View {
    @ObservedObject var browser: RubidiumBrowserModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var email = ""
    @State private var password = ""
    @State private var createAccount = false
    @State private var showPassword = false
    @State private var isBusy = false
    @State private var localError: String?

    var body: some View {
        ZStack {
            LinearGradient(
                colors: backgroundColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    Spacer(minLength: 26)
                    HStack(spacing: 12) {
                        RubidiumBrandMark(size: 52, cornerRadius: 14)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Rubidium")
                                .font(.title3.weight(.bold))
                            Text("One account. Every inbox.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Your email is your account")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                        Text("Enter Rubidium")
                            .font(.system(.largeTitle, design: .serif, weight: .bold))
                        Text("Sign in with the inbox you already use. Mail and calendar connect in the same secure flow.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }

                    VStack(spacing: 12) {
                        if browser.googleIdentityAvailable {
                            providerSignIn("google", title: "Continue with Google", symbol: "g.circle.fill")
                        }
                        if browser.microsoftIdentityAvailable {
                            providerSignIn("microsoft", title: "Continue with Microsoft", symbol: "square.grid.2x2.fill")
                        } else {
                            HStack(spacing: 13) {
                                Image(systemName: "square.grid.2x2.fill")
                                    .font(.title2)
                                    .frame(width: 32)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Microsoft sign-in")
                                        .font(.headline)
                                    Text("Use password for now; Outlook can connect in Accounts.")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                            .padding(17)
                            .rubidiumContentPanel(cornerRadius: 18)
                            .opacity(0.86)
                        }
                    }

                    DisclosureGroup("Use email and password", isExpanded: $showPassword) {
                        VStack(spacing: 14) {
                            Picker("Account mode", selection: $createAccount) {
                                Text("Sign in").tag(false)
                                Text("Create account").tag(true)
                            }
                            .pickerStyle(.segmented)

                            TextField("Email", text: $email)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .textContentType(.username)
                                .submitLabel(.next)
                                .padding(14)
                                .rubidiumContentPanel(cornerRadius: 14)

                            SecureField(createAccount ? "Create a password" : "Password", text: $password)
                                .textContentType(createAccount ? .newPassword : .password)
                                .submitLabel(.go)
                                .onSubmit { authenticateWithPassword() }
                                .padding(14)
                                .rubidiumContentPanel(cornerRadius: 14)

                            Button {
                                authenticateWithPassword()
                            } label: {
                                if isBusy {
                                    ProgressView()
                                        .tint(.white)
                                        .frame(maxWidth: .infinity)
                                } else {
                                    Text(createAccount ? "Create account" : "Sign in")
                                        .frame(maxWidth: .infinity)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.black)
                            .controlSize(.large)
                            .disabled(email.isEmpty || password.count < 8 || isBusy)
                        }
                        .padding(.top, 14)
                    }
                    .font(.subheadline.weight(.semibold))
                    .tint(.primary)

                    if let error = localError ?? browser.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .padding(13)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .rubidiumContentPanel(cornerRadius: 14)
                    }

                    Text("Rubidium uses Apple’s secure system sign-in sheet. Your provider password is never visible to the app.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                    Spacer(minLength: 30)
                }
                .padding(.horizontal, 22)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private func providerSignIn(_ provider: String, title: String, symbol: String) -> some View {
        Button {
            localError = nil
            RubidiumHaptics.shared.play(.action)
            browser.signIn(with: provider)
        } label: {
            HStack(spacing: 13) {
                Image(systemName: symbol)
                    .font(.title2)
                    .frame(width: 32)
                Text(title)
                    .font(.headline)
                Spacer()
                Image(systemName: "arrow.right")
                    .foregroundStyle(.secondary)
            }
            .padding(17)
            .rubidiumContentPanel(cornerRadius: 18)
        }
        .buttonStyle(.plain)
    }

    private var backgroundColors: [Color] {
        if colorScheme == .dark {
            return [
                Color(red: 0.055, green: 0.058, blue: 0.052),
                Color(red: 0.085, green: 0.075, blue: 0.067),
                Color.red.opacity(0.12),
            ]
        }
        return [
            Color(red: 0.95, green: 0.94, blue: 0.91),
            Color(red: 0.97, green: 0.94, blue: 0.91),
            Color.red.opacity(0.08),
        ]
    }

    private func authenticateWithPassword() {
        guard !isBusy else { return }
        isBusy = true
        localError = nil
        RubidiumHaptics.shared.play(.action)
        Task {
            do {
                try await browser.passwordAuthentication(
                    email: email,
                    password: password,
                    createAccount: createAccount
                )
                RubidiumHaptics.shared.play(.success)
            } catch {
                localError = error.localizedDescription
                RubidiumHaptics.shared.play(.error)
            }
            isBusy = false
        }
    }
}

@MainActor
enum RubidiumDate {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let standard = ISO8601DateFormatter()

    private static let dateOnly: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func parse(_ value: String) -> Date? {
        fractional.date(from: value) ?? standard.date(from: value) ?? dateOnly.date(from: value)
    }

    static func short(_ value: String) -> String {
        guard let date = parse(value) else { return "" }
        if Calendar.current.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.weekday(.abbreviated))
    }

    static func day(_ value: String) -> String {
        guard let date = parse(value) else { return "Upcoming" }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInTomorrow(date) { return "Tomorrow" }
        return date.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }
}

private extension Color {
    init?(hex: String) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard value.count == 6, let number = Int(value, radix: 16) else { return nil }
        self.init(
            red: Double((number >> 16) & 0xff) / 255,
            green: Double((number >> 8) & 0xff) / 255,
            blue: Double(number & 0xff) / 255
        )
    }
}
