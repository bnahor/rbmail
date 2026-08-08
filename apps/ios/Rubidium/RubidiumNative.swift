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

    private weak var browser: RubidiumBrowserModel?
    private var hasLoaded = false

    func attach(_ browser: RubidiumBrowserModel) {
        self.browser = browser
    }

    func loadAll(force: Bool = false) async {
        guard let browser, force || !hasLoaded else { return }
        isLoading = true
        errorMessage = nil
        do {
            async let threadsResponse: RubidiumThreadsResponse = browser.api("/api/threads?limit=250")
            async let accountsResponse: RubidiumAccountsResponse = browser.api("/api/accounts")
            async let sourcesResponse: RubidiumSourcesResponse = browser.api("/api/calendar/sources")
            let (threadPayload, accountPayload, sourcePayload) = try await (
                threadsResponse,
                accountsResponse,
                sourcesResponse
            )
            threads = threadPayload.threads
            accounts = accountPayload.accounts
            sources = sourcePayload.sources
            try await loadCalendarEvents()
            hasLoaded = true
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
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
        errorMessage = nil
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
            errorMessage = error.localizedDescription
            RubidiumHaptics.shared.play(.error)
        }
        isSyncingCalendar = false
    }

    func reloadAfterConnection() async {
        hasLoaded = false
        await loadAll(force: true)
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
    @Binding var selection: RubidiumNativeTab
    let mail: AnyView
    let intelligence: AnyView

    var body: some View {
        TabView(selection: $selection) {
            ZStack(alignment: .bottomTrailing) {
                mail
                    // WKWebView does not automatically adopt SwiftUI's
                    // scroll-edge underlap. Extend only the mail surface
                    // behind the glass bar; accessory controls remain above.
                    .ignoresSafeArea(.container, edges: .bottom)
                intelligence
                    .padding(.trailing, 14)
                    .padding(.bottom, 12)
            }
            .tag(RubidiumNativeTab.mail)
            .tabItem { Label("Mail", systemImage: "tray") }

            RubidiumNativeCalendarView(store: store, browser: browser)
                .tag(RubidiumNativeTab.today)
                .tabItem { Label("Today", systemImage: "calendar") }

            RubidiumNativeSearchView(store: store) { thread in
                RubidiumHaptics.shared.play(.selection)
                selection = .mail
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
                    browser.openThread(thread.id)
                }
            }
            .tag(RubidiumNativeTab.search)
            .tabItem { Label("Search", systemImage: "magnifyingglass") }

            RubidiumNativeAccountsView(store: store, browser: browser)
                .tag(RubidiumNativeTab.accounts)
                .tabItem { Label("Accounts", systemImage: "person.crop.circle") }
        }
        .tint(.primary)
        // iOS 26's floating Liquid Glass tab bar should sit over the app
        // surface. Hiding the legacy toolbar backing prevents a second,
        // opaque strip from appearing below the glass plane.
        .toolbarBackground(.hidden, for: .tabBar)
        .background(
            Color(red: 0.949, green: 0.937, blue: 0.91)
                .ignoresSafeArea()
        )
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
                        if let error = store.errorMessage {
                            Section {
                                Label(error, systemImage: "exclamationmark.triangle")
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                            }
                        }
                        ForEach(groupedEvents, id: \.0) { day, events in
                            Section(day) {
                                ForEach(events) { event in
                                    RubidiumCalendarEventRow(event: event)
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .refreshable { await store.syncCalendar() }
                }
            }
            .navigationTitle("Today")
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
        return store.errorMessage ?? "No upcoming events in your connected calendars."
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

struct RubidiumNativeAccountsView: View {
    @ObservedObject var store: RubidiumNativeStore
    @ObservedObject var browser: RubidiumBrowserModel

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

                if let error = store.errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Accounts")
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
    @State private var email = ""
    @State private var password = ""
    @State private var createAccount = false
    @State private var showPassword = false
    @State private var isBusy = false
    @State private var localError: String?

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.94, blue: 0.91),
                    Color(red: 0.97, green: 0.94, blue: 0.91),
                    Color.red.opacity(0.08),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    Spacer(minLength: 26)
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color(red: 0.93, green: 0.13, blue: 0.12))
                            .frame(width: 52, height: 52)
                            .overlay {
                                Image(systemName: "diamond.fill")
                                    .foregroundStyle(.white)
                            }
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
