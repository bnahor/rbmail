import SwiftUI

struct RubidiumMailAddress: Codable, Hashable {
    let name: String
    let address: String
}

struct RubidiumThreadSummary: Codable, Identifiable, Hashable {
    let id: String
    let accountId: String
    let provider: String
    let email: String
    let displayName: String
    let subject: String
    let snippet: String
    let participants: [RubidiumMailAddress]
    let labels: [String]
    let lastMessageAt: String
    let unread: Bool
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

private struct RubidiumThreadsResponse: Decodable {
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
    @Published var accounts: [RubidiumAccount] = []
    @Published var sources: [RubidiumCalendarSource] = []
    @Published var events: [RubidiumCalendarEvent] = []
    @Published var isLoading = false
    @Published var isSyncingCalendar = false
    @Published var errorMessage: String?
    @Published var accountsErrorMessage: String?
    @Published var calendarErrorMessage: String?

    private weak var browser: RubidiumBrowserModel?
    private var hasLoaded = false
    private var lastCalendarRefreshAttempt: Date?

    func attach(_ browser: RubidiumBrowserModel) {
        self.browser = browser
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
        } catch {
            accountsErrorMessage = error.localizedDescription
        }

        do {
            let payload: RubidiumSourcesResponse = try await browser.api("/api/calendar/sources")
            sources = payload.sources
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
    let intelligence: AnyView

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
            // Keep the WebKit session alive while native destinations are
            // visible; it owns the secure first-party cookie used by the
            // provider-neutral native API client.
            mail
                .ignoresSafeArea(.container, edges: .bottom)
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
                intelligence: intelligence
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
    let intelligence: AnyView
    @Namespace private var navigationNamespace

    var body: some View {
        HStack(spacing: 2) {
            destination(.mail, title: "Mail", symbol: "tray", selectedSymbol: "tray.full.fill")
            destination(.today, title: "Today", symbol: "calendar", selectedSymbol: "calendar")

            VStack(spacing: 1) {
                intelligence
                    .frame(width: 44, height: 34)
                Text("AI")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 52)

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
        .accessibilityElement(children: .contain)
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
    @State private var query = ""

    private var matchingThreads: [RubidiumThreadSummary] {
        let terms = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !terms.isEmpty else { return Array(store.threads.prefix(24)) }
        return store.threads.filter { thread in
            [thread.subject, thread.snippet, thread.displayName, thread.email]
                .joined(separator: " ")
                .lowercased()
                .contains(terms) ||
            thread.participants.contains {
                "\($0.name) \($0.address)".lowercased().contains(terms)
            }
        }
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
                                    RubidiumCalendarEventRow(event: event)
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
        }
    }
}

struct RubidiumThreadRow: View {
    let thread: RubidiumThreadSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(thread.provider == "google" ? Color.red.opacity(0.14) : Color.blue.opacity(0.14))
                .frame(width: 42, height: 42)
                .overlay {
                    Text(initials)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.primary)
                }

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(thread.displayName.isEmpty ? thread.email : thread.displayName)
                        .font(.subheadline.weight(thread.unread ? .bold : .semibold))
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(RubidiumDate.short(thread.lastMessageAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(thread.subject)
                    .font(.subheadline.weight(thread.unread ? .semibold : .regular))
                    .lineLimit(1)
                Text(thread.snippet)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
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
                                        RubidiumCalendarEventDetailView(event: event)
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
    let event: RubidiumCalendarEvent

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
        }
        .navigationTitle("Event")
        .navigationBarTitleDisplayMode(.inline)
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
}

struct RubidiumNativeAccountsView: View {
    @ObservedObject var store: RubidiumNativeStore
    @ObservedObject var browser: RubidiumBrowserModel
    @ObservedObject var security: RubidiumAppLockModel
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
