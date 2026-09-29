import Foundation
import Supabase
import Testing
@testable import NaviProject

/// Runs the app's Supabase data layer against a local Supabase stack (`supabase start` plus
/// the migrations in `supabase/migrations`). Skipped unless the stack is configured:
///
///     TEST_RUNNER_NAVI_TEST_SUPABASE_URL=http://127.0.0.1:54321 \
///     TEST_RUNNER_NAVI_TEST_SUPABASE_ANON_KEY=<anon key from `supabase status`> \
///     xcodebuild test -scheme NaviProject -only-testing:NaviProjectTests/BackendIntegrationTests
///
/// Each run signs up a throwaway `navi-it-…@test.dev` user.
@Suite(.enabled(if: LocalSupabase.configuration != nil), .serialized)
struct BackendIntegrationTests {
    private static let password = "Navi-test-1"

    /// A fresh client signed in as a new user.
    private func signUp() async throws -> (client: SupabaseClient, userID: UUID, email: String) {
        let configuration = try #require(LocalSupabase.configuration)
        let client = SupabaseClient(
            supabaseURL: configuration.url,
            supabaseKey: configuration.key,
            options: .init(auth: .init(storage: InMemoryAuthStorage()))
        )
        let email = "navi-it-\(UUID().uuidString.lowercased())@test.dev"
        let response = try await client.auth.signUp(email: email, password: Self.password)
        let session = try #require(response.session, "local auth must not require email confirmation")
        return (client, session.user.id, email)
    }

    private func insertCategory(_ client: SupabaseClient, userID: UUID, name: String, color: String) async throws -> UUID {
        struct Row: Encodable {
            let id: UUID
            let user_id: UUID
            let name: String
            let color: String
        }
        let id = UUID()
        try await client.from("todo_categories").insert(Row(id: id, user_id: userID, name: name, color: color)).execute()
        return id
    }

    private func todo(_ title: String, due: Date?, category: NaviCategory? = nil, order: Double) -> DashboardTodo {
        DashboardTodo(
            id: UUID(), title: title, isDone: false, category: category, dueAt: due,
            source: .manual, subtaskProgress: nil, orderIndex: order
        )
    }

    /// Until the Edge Functions are deployed, calls end in `EdgeError.unavailable` (the gateway's
    /// plain-text 404), which the tabs treat as "not connected yet".
    @Test func undeployedEdgeFunctionIsUnavailable() async throws {
        let (client, _, _) = try await signUp()
        let services = EdgeServices(
            mail: MailService(edge: EdgeClient(client: client)),
            calendar: CalendarService(edge: EdgeClient(client: client), client: client),
            assistant: AssistantService(edge: EdgeClient(client: client), client: client, userID: UUID()),
            todoAI: TodoAIService(edge: EdgeClient(client: client)),
            googleAuth: GoogleAuthService(edge: EdgeClient(client: client))
        )
        await #expect(throws: EdgeError.unavailable) { _ = try await services.mail.inbox() }
        await #expect(throws: EdgeError.unavailable) { _ = try await services.calendar.todayBriefing() }
        await #expect(throws: EdgeError.unavailable) { try await services.assistant.command("오늘 할 일 정리") }
        await #expect(throws: EdgeError.unavailable) { try await services.googleAuth.disconnect() }
    }

    @Test func todosRoundTripThroughGetTodos() async throws {
        let (client, userID, _) = try await signUp()
        let store = SupabaseTodoStore(client: client, userID: userID)

        let categoryID = try await insertCategory(client, userID: userID, name: "업무", color: "#7165FF")
        let categories = try await store.todoCategories()
        let work = try #require(categories.first)
        #expect(categories.count == 1 && work.id == categoryID && work.color == "#7165FF")

        let now = Date()
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: now)!
        let first = todo("발표 자료 검토", due: now.addingTimeInterval(3600), category: work, order: 1)
        let second = todo("회고 작성", due: nil, order: 2)
        let later = todo("내일 할 일", due: tomorrow, order: 3)
        try await store.createTodo(first, on: now)
        try await store.createTodo(second, on: now)
        try await store.createTodo(later, on: tomorrow)

        var today = try await store.todayTodos()
        #expect(today.map(\.id) == [first.id, second.id], "only today's todos, in order_index order")
        #expect(today.first?.category == work)
        #expect(today.first?.source == .manual)
        #expect(abs((today.first?.dueAt ?? .distantPast).timeIntervalSince(first.dueAt!)) < 1)

        try await store.setTodo(second.id, isDone: true)
        today = try await store.todayTodos()
        #expect(today.first(where: { $0.id == second.id })?.isDone == true)

        try await store.reorder([TodoOrderUpdate(id: second.id, orderIndex: 0.5)])
        today = try await store.todayTodos()
        #expect(today.map(\.id) == [second.id, first.id])
    }

    @Test func subtasksDriveParentStatusAndProgress() async throws {
        let (client, userID, _) = try await signUp()
        let store = SupabaseTodoStore(client: client, userID: userID)
        let parent = todo("상위 할 일", due: nil, order: 1)
        try await store.createTodo(parent, on: Date())

        struct Child: Encodable {
            let id: UUID
            let user_id: UUID
            let parent_id: UUID
            let title: String
            let date: String
            let source = "subdivision"
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let day = formatter.string(from: Date())
        let children = [UUID(), UUID()]
        try await client.from("todos").insert(children.enumerated().map {
            Child(id: $1, user_id: userID, parent_id: parent.id, title: "하위 \($0)", date: day)
        }).execute()

        var row = try #require(try await store.todayTodos().first)
        #expect(row.subtaskProgress == SubtaskProgress(done: 0, total: 2))
        #expect(row.isDone == false)

        for child in children { try await store.setTodo(child, isDone: true) }
        row = try #require(try await store.todayTodos().first)
        #expect(row.subtaskProgress == SubtaskProgress(done: 2, total: 2))
        #expect(row.isDone, "parent auto-completes when every child is done")

        try await store.setTodo(children[0], isDone: false)
        row = try #require(try await store.todayTodos().first)
        #expect(!row.isDone, "parent reopens when a child reopens")
    }

    @Test func usersCannotSeeOrReorderEachOthersTodos() async throws {
        let owner = try await signUp()
        let other = try await signUp()
        let ownerStore = SupabaseTodoStore(client: owner.client, userID: owner.userID)
        let otherStore = SupabaseTodoStore(client: other.client, userID: other.userID)

        let secret = todo("남의 할 일", due: nil, order: 1)
        try await ownerStore.createTodo(secret, on: Date())

        #expect(try await otherStore.todayTodos().isEmpty)
        await #expect(throws: (any Error).self) {
            try await otherStore.reorder([TodoOrderUpdate(id: secret.id, orderIndex: 9)])
        }
        await #expect(throws: (any Error).self) {
            // Inserting into someone else's account is blocked by RLS.
            try await otherStore.createTodo(secret, on: Date())
        }
        #expect(try await ownerStore.todayTodos().first?.orderIndex == 1)
    }

    @Test func notificationSettingsLoadAndSave() async throws {
        let (client, userID, _) = try await signUp()
        let store = NotificationSettingsStore(client: client, userID: userID)

        #expect(try await store.load() == NotificationPreferences(), "bootstrap trigger creates defaults")

        var updated = NotificationPreferences()
        updated.newMail = false
        updated.snoozeMinutes = 15
        try await store.save(updated)
        #expect(try await store.load() == updated)

        updated.snoozeMinutes = 0
        await #expect(throws: (any Error).self, "DB CHECK keeps snooze within 1…1440") {
            try await store.save(updated)
        }
    }

    @Test func accountNameAndPasswordChange() async throws {
        let (client, _, email) = try await signUp()
        let account = AccountService(client: client)

        let user = try await account.updateDisplayName("테스트 사용자")
        #expect(user.userMetadata["navi_name"]?.stringValue == "테스트 사용자")

        await #expect(throws: AccountError.wrongCurrentPassword) {
            try await account.changePassword(email: email, current: "wrong-password", new: "Navi-test-2")
        }
        try await account.changePassword(email: email, current: Self.password, new: "Navi-test-2")

        _ = try await client.auth.signIn(email: email, password: "Navi-test-2")
        await #expect(throws: (any Error).self) {
            _ = try await client.auth.signIn(email: email, password: Self.password)
        }
    }
}

private enum LocalSupabase {
    static var configuration: (url: URL, key: String)? {
        let environment = ProcessInfo.processInfo.environment
        guard let url = environment["NAVI_TEST_SUPABASE_URL"].flatMap(URL.init(string:)),
              let key = environment["NAVI_TEST_SUPABASE_ANON_KEY"], !key.isEmpty
        else { return nil }
        return (url, key)
    }
}

/// Keeps test sessions out of the keychain.
private final class InMemoryAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private var values: [String: Data] = [:]
    private let lock = NSLock()

    func store(key: String, value: Data) throws {
        lock.withLock { values[key] = value }
    }

    func retrieve(key: String) throws -> Data? {
        lock.withLock { values[key] }
    }

    func remove(key: String) throws {
        lock.withLock { _ = values.removeValue(forKey: key) }
    }
}
