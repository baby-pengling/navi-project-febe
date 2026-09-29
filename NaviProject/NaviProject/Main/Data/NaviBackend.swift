import Foundation
import Supabase

// Supabase-backed data access for the main window (Notion "API 명세": TABLE / RPC / AUTH-SDK
// rows). Mail, calendar events, the assistant, and Google disconnect are Edge Function work
// that doesn't exist yet, so those screens still use mock data.

// MARK: - Todos

/// One `reorder_todos` item.
struct TodoOrderUpdate: Encodable, Equatable, Sendable {
    let id: UUID
    let orderIndex: Double

    enum CodingKeys: String, CodingKey {
        case id
        case orderIndex = "order_index"
    }
}

/// What the dashboard needs from the todo backend. `SupabaseTodoStore` is the real one;
/// previews and mock mode run without a store.
protocol TodoStore: Sendable {
    func todayTodos() async throws -> [DashboardTodo]
    /// Every top-level todo (`get_todos(filter => 'all')`); the todo tab groups them by deadline.
    func allTodos() async throws -> [DashboardTodo]
    func todoCategories() async throws -> [NaviCategory]
    func calendarCategories() async throws -> [NaviCategory]
    func createTodo(_ todo: DashboardTodo, on day: Date) async throws
    func createSubtask(_ subtask: TodoSubtask, parentID: UUID, on day: Date) async throws
    func updateTodo(_ id: UUID, title: String, dueAt: Date?, day: Date, categoryID: UUID?) async throws
    func setTodo(_ id: UUID, isDone: Bool) async throws
    func reorder(_ updates: [TodoOrderUpdate]) async throws
    func createTodoCategory(_ category: NaviCategory) async throws
    /// `calendar_categories` with `is_visible` (hidden categories are filtered out of the calendar).
    func calendarCategoryVisibility() async throws -> [(category: NaviCategory, isVisible: Bool)]
    func createCalendarCategory(_ category: NaviCategory) async throws
    func setCalendarCategory(_ id: UUID, isVisible: Bool) async throws
}

extension AppSessionStore {
    /// The signed-in user's todo store, or `nil` without a session (the dashboard then shows
    /// mock data).
    func makeTodoStore() -> TodoStore? {
        guard let client, let userID = session?.user.id else { return nil }
        return SupabaseTodoStore(client: client, userID: userID)
    }
}

struct SupabaseTodoStore: TodoStore {
    let client: SupabaseClient
    let userID: UUID

    /// `get_todos(filter => 'today')`: the caller's top-level todos for today (users.timezone),
    /// each with its category and children.
    func todayTodos() async throws -> [DashboardTodo] {
        struct Params: Encodable, Sendable {
            let filter: String
        }
        let rows: [TodoRow] = try await client
            .rpc("get_todos", params: Params(filter: "today"))
            .execute()
            .value
        return rows.map(\.dashboardTodo)
    }

    func allTodos() async throws -> [DashboardTodo] {
        struct Params: Encodable, Sendable {
            let filter: String
        }
        let rows: [TodoRow] = try await client
            .rpc("get_todos", params: Params(filter: "all"))
            .execute()
            .value
        return rows.map(\.dashboardTodo)
    }

    func todoCategories() async throws -> [NaviCategory] {
        try await categories(from: "todo_categories")
    }

    func calendarCategories() async throws -> [NaviCategory] {
        try await categories(from: "calendar_categories")
    }

    /// TABLE insert with the app-generated id (no Idempotency-Key, per the contract).
    func createTodo(_ todo: DashboardTodo, on day: Date) async throws {
        try await client
            .from("todos")
            .insert(NewTodoRow(todo: todo, userID: userID, day: day))
            .execute()
    }

    /// A child row (`source = 'subdivision'`, `parent_id`); the parent's status follows its
    /// children through the DB trigger.
    func createSubtask(_ subtask: TodoSubtask, parentID: UUID, on day: Date) async throws {
        struct Row: Encodable, Sendable {
            let id: UUID
            let user_id: UUID
            let parent_id: UUID
            let title: String
            let date: String
            let source = "subdivision"
        }
        try await client
            .from("todos")
            .insert(Row(id: subtask.id, user_id: userID, parent_id: parentID, title: subtask.title, date: Self.dayString(day)))
            .execute()
    }

    /// Column-limited UPDATE (title, date, due_at, category_id).
    func updateTodo(_ id: UUID, title: String, dueAt: Date?, day: Date, categoryID: UUID?) async throws {
        struct Row: Encodable, Sendable {
            let title: String
            let date: String
            let dueAt: Date?
            let categoryID: UUID?

            enum CodingKeys: String, CodingKey {
                case title, date
                case dueAt = "due_at"
                case categoryID = "category_id"
            }

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(title, forKey: .title)
                try container.encode(date, forKey: .date)
                try container.encode(dueAt, forKey: .dueAt)
                try container.encode(categoryID, forKey: .categoryID)
            }
        }
        try await client
            .from("todos")
            .update(Row(title: title, date: Self.dayString(day), dueAt: dueAt, categoryID: categoryID))
            .eq("id", value: id)
            .execute()
    }

    /// TABLE insert with the app-generated id; name/color rules are DB CHECKs.
    func createTodoCategory(_ category: NaviCategory) async throws {
        struct Row: Encodable, Sendable {
            let id: UUID
            let user_id: UUID
            let name: String
            let color: String
        }
        try await client
            .from("todo_categories")
            .insert(Row(id: category.id, user_id: userID, name: category.name, color: category.color))
            .execute()
    }

    func calendarCategoryVisibility() async throws -> [(category: NaviCategory, isVisible: Bool)] {
        struct Row: Decodable, Sendable {
            let id: UUID
            let name: String
            let color: String
            let is_visible: Bool
        }
        let rows: [Row] = try await client
            .from("calendar_categories")
            .select("id,name,color,is_visible")
            .order("created_at")
            .execute()
            .value
        return rows.map { (NaviCategory(id: $0.id, name: $0.name, color: $0.color), $0.is_visible) }
    }

    func createCalendarCategory(_ category: NaviCategory) async throws {
        struct Row: Encodable, Sendable {
            let id: UUID
            let user_id: UUID
            let name: String
            let color: String
        }
        try await client
            .from("calendar_categories")
            .insert(Row(id: category.id, user_id: userID, name: category.name, color: category.color))
            .execute()
    }

    func setCalendarCategory(_ id: UUID, isVisible: Bool) async throws {
        try await client
            .from("calendar_categories")
            .update(["is_visible": isVisible])
            .eq("id", value: id)
            .execute()
    }

    /// `todos.date` value ("yyyy-MM-dd" in the device time zone).
    static func dayString(_ day: Date) -> String {
        NewTodoRow.dayFormatter.string(from: day)
    }

    /// Parent auto-complete / reopen is a DB trigger; the app only flips this row.
    func setTodo(_ id: UUID, isDone: Bool) async throws {
        try await client
            .from("todos")
            .update(["status": isDone ? "done" : "active"])
            .eq("id", value: id)
            .execute()
    }

    func reorder(_ updates: [TodoOrderUpdate]) async throws {
        struct Params: Encodable, Sendable {
            let items: [TodoOrderUpdate]
        }
        try await client.rpc("reorder_todos", params: Params(items: updates)).execute()
    }

    private func categories(from table: String) async throws -> [NaviCategory] {
        let rows: [CategoryRow] = try await client
            .from(table)
            .select("id,name,color")
            .order("created_at")
            .execute()
            .value
        return rows.map(\.category)
    }
}

/// One item of the `get_todos` JSON array.
struct TodoRow: Decodable, Sendable {
    struct Child: Decodable, Sendable {
        let id: UUID
        let title: String
        let status: String
    }

    let id: UUID
    let title: String
    let status: String
    let date: String
    let dueAt: Date?
    let source: String
    let orderIndex: Double
    let category: CategoryRow?
    let children: [Child]

    enum CodingKeys: String, CodingKey {
        case id, title, status, date, source, category, children
        case dueAt = "due_at"
        case orderIndex = "order_index"
    }

    var dashboardTodo: DashboardTodo {
        DashboardTodo(
            id: id,
            title: title,
            isDone: status == "done",
            category: category?.category,
            dueAt: dueAt,
            source: DashboardTodo.Source(databaseValue: source),
            subtaskProgress: children.isEmpty
                ? nil
                : SubtaskProgress(done: children.filter { $0.status == "done" }.count, total: children.count),
            orderIndex: orderIndex,
            subtasks: children.map { TodoSubtask(id: $0.id, title: $0.title, isDone: $0.status == "done") },
            day: NewTodoRow.dayFormatter.date(from: date)
        )
    }
}

struct CategoryRow: Decodable, Sendable {
    let id: UUID
    let name: String
    let color: String

    var category: NaviCategory {
        NaviCategory(id: id, name: name, color: color)
    }
}

private struct NewTodoRow: Encodable, Sendable {
    let id: UUID
    let userID: UUID
    let title: String
    /// `todos.date`: the day the todo is listed under.
    let date: String
    let dueAt: Date?
    let categoryID: UUID?
    let orderIndex: Double
    let source: String

    enum CodingKeys: String, CodingKey {
        case id, title, date, source
        case userID = "user_id"
        case dueAt = "due_at"
        case categoryID = "category_id"
        case orderIndex = "order_index"
    }

    init(todo: DashboardTodo, userID: UUID, day: Date) {
        id = todo.id
        self.userID = userID
        title = todo.title
        date = Self.dayFormatter.string(from: day)
        dueAt = todo.dueAt
        categoryID = todo.category?.id
        orderIndex = todo.orderIndex
        source = todo.source.databaseValue
    }

    static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    // Explicit so `due_at` / `category_id` are sent as JSON null rather than omitted.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(userID, forKey: .userID)
        try container.encode(title, forKey: .title)
        try container.encode(date, forKey: .date)
        try container.encode(dueAt, forKey: .dueAt)
        try container.encode(categoryID, forKey: .categoryID)
        try container.encode(orderIndex, forKey: .orderIndex)
        try container.encode(source, forKey: .source)
    }
}

extension DashboardTodo.Source {
    var databaseValue: String {
        switch self {
        case .manual: return "manual"
        case .mailSuggestion: return "mail_suggestion"
        case .calendarSuggestion: return "calendar_suggestion"
        case .subdivision: return "subdivision"
        }
    }

    init(databaseValue: String) {
        switch databaseValue {
        case "mail_suggestion": self = .mailSuggestion
        case "calendar_suggestion": self = .calendarSuggestion
        case "subdivision": self = .subdivision
        default: self = .manual
        }
    }
}

// MARK: - Notification settings

/// `notification_settings` TABLE: SELECT and column-limited UPDATE of the caller's row
/// (the row is created by the account bootstrap trigger).
struct NotificationSettingsStore: Sendable {
    let client: SupabaseClient
    let userID: UUID

    func load() async throws -> NotificationPreferences {
        let row: NotificationSettingsRow = try await client
            .from("notification_settings")
            .select(NotificationSettingsRow.columns)
            .eq("user_id", value: userID)
            .single()
            .execute()
            .value
        return row.preferences
    }

    func save(_ preferences: NotificationPreferences) async throws {
        try await client
            .from("notification_settings")
            .update(NotificationSettingsRow(preferences))
            .eq("user_id", value: userID)
            .execute()
    }
}

private struct NotificationSettingsRow: Codable, Sendable {
    static let columns = "new_mail_enabled,calendar_reminder_enabled,mail_send_confirmation_enabled,calendar_approval_enabled,alert_snooze_minutes"

    let newMailEnabled: Bool
    let calendarReminderEnabled: Bool
    let mailSendConfirmationEnabled: Bool
    let calendarApprovalEnabled: Bool
    let alertSnoozeMinutes: Int

    enum CodingKeys: String, CodingKey {
        case newMailEnabled = "new_mail_enabled"
        case calendarReminderEnabled = "calendar_reminder_enabled"
        case mailSendConfirmationEnabled = "mail_send_confirmation_enabled"
        case calendarApprovalEnabled = "calendar_approval_enabled"
        case alertSnoozeMinutes = "alert_snooze_minutes"
    }

    init(_ preferences: NotificationPreferences) {
        newMailEnabled = preferences.newMail
        calendarReminderEnabled = preferences.calendarReminder
        mailSendConfirmationEnabled = preferences.mailSendConfirmation
        calendarApprovalEnabled = preferences.calendarApproval
        alertSnoozeMinutes = preferences.snoozeMinutes
    }

    var preferences: NotificationPreferences {
        NotificationPreferences(
            newMail: newMailEnabled,
            calendarReminder: calendarReminderEnabled,
            mailSendConfirmation: mailSendConfirmationEnabled,
            calendarApproval: calendarApprovalEnabled,
            snoozeMinutes: alertSnoozeMinutes
        )
    }
}

// MARK: - Account (Auth SDK)

enum AccountError: LocalizedError, Equatable {
    case wrongCurrentPassword
    case missingEmail

    var errorDescription: String? {
        switch self {
        case .wrongCurrentPassword: return "현재 비밀번호가 올바르지 않아요."
        case .missingEmail: return "이메일 로그인 계정에서만 비밀번호를 바꿀 수 있어요."
        }
    }
}

/// Profile name and password changes. No HTTP endpoints: both are Supabase Auth SDK calls.
struct AccountService: Sendable {
    let client: SupabaseClient

    /// `auth.updateUser({data: {navi_name}})`
    func updateDisplayName(_ name: String) async throws -> User {
        try await client.auth.update(user: UserAttributes(data: ["navi_name": .string(name)]))
    }

    /// Re-checks the current password with `signInWithPassword`, then `updateUser(password:)`.
    func changePassword(email: String, current: String, new: String) async throws {
        guard !email.isEmpty else { throw AccountError.missingEmail }
        do {
            _ = try await client.auth.signIn(email: email, password: current)
        } catch let error as AuthError where error.errorCode == .invalidCredentials {
            throw AccountError.wrongCurrentPassword
        }
        _ = try await client.auth.update(user: UserAttributes(password: new))
    }
}
