import Combine
import Foundation

/// `{id,name,color}` category object returned with todos and calendar events. Colors are
/// chosen by the user (`todo_categories.color` / `calendar_categories.color`).
struct NaviCategory: Identifiable, Equatable, Hashable {
    let id: UUID
    var name: String
    /// `#RRGGBB`
    var color: String
}

/// Shape of a top-level row from `get_todos` (children are summarized as progress).
struct DashboardTodo: Identifiable, Equatable {
    enum Source: Equatable {
        case manual
        case mailSuggestion
        case calendarSuggestion
        case subdivision
    }

    let id: UUID
    var title: String
    var isDone: Bool
    var category: NaviCategory?
    var dueAt: Date?
    var source: Source
    /// Completed / total subtasks; `nil` when the todo has no children.
    var subtaskProgress: SubtaskProgress?
    /// `todos.order_index`: drag-and-drop order within the day.
    var orderIndex: Double
    /// Child rows (`todos.parent_id`), shown in the todo detail panel.
    var subtasks: [TodoSubtask] = []
    /// `todos.date`: the day the todo is listed under.
    var day: Date?
}

struct TodoSubtask: Identifiable, Equatable {
    let id: UUID
    var title: String
    var isDone: Bool
}

struct SubtaskProgress: Equatable {
    var done: Int
    var total: Int
}

/// Shape of an item from `GET /functions/v1/mail/messages?filter=important&limit=3`.
struct DashboardMail: Identifiable, Equatable {
    let id: UUID
    var sender: String
    var subject: String
    var snippet: String
    var receivedAt: Date
}

/// Shape of an `events[]` item from `GET /functions/v1/calendar/briefing/today`.
struct DashboardEvent: Identifiable, Equatable {
    let id: UUID
    var title: String
    var startAt: Date
    var endAt: Date
    var isAllDay: Bool
    var category: NaviCategory?
    var location: String?
}

/// Figma "10 - 할 일 > 새 할 일 추가" form.
struct NewTodoDraft: Equatable {
    var title = ""
    var dueAt: Date
    var category: NaviCategory?

    var isValid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Figma "09 - 일정 (주) > 새 일정" form.
struct NewEventDraft: Equatable {
    var title = ""
    var category: NaviCategory?
    var startAt: Date
    var endAt: Date
    var location = ""

    var isValid: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && endAt > startAt
    }
}

/// Dashboard data. Todos and categories come from Supabase through `store` (`get_todos` RPC,
/// `todos` / category TABLEs, `reorder_todos` RPC). Important mail, today's events, and the
/// command input go through the `mail` / `calendar` / `assistant` Edge Functions. Failures show
/// as `errorMessage`; nothing is filled in with sample data.
@MainActor
final class DashboardModel: ObservableObject {
    @Published private(set) var todos: [DashboardTodo]
    @Published private(set) var importantMails: [DashboardMail]
    @Published private(set) var todayEvents: [DashboardEvent]
    @Published private(set) var todoCategories: [NaviCategory]
    @Published private(set) var calendarCategories: [NaviCategory]
    @Published private(set) var isLoadingTodos = false
    /// Last failed load or save, shown under the todo list.
    @Published var errorMessage: String?

    private let store: TodoStore?
    private let services: EdgeServices?
    private let calendar: Calendar

    init(store: TodoStore? = nil, services: EdgeServices? = nil, calendar: Calendar = .current) {
        self.store = store
        self.services = services
        self.calendar = calendar
        todos = []
        importantMails = []
        todayEvents = []
        todoCategories = []
        calendarCategories = []
    }

    var completedTodoCount: Int {
        todos.filter(\.isDone).count
    }

    /// Loads today's todos, both category lists, important mail, and today's events.
    func load() async {
        errorMessage = nil
        async let briefing: Void = loadBriefing()
        await loadTodos()
        await briefing
    }

    /// `mail/briefing?date=today` and `calendar/briefing/today`.
    private func loadBriefing() async {
        guard let services else { return }
        async let mails = services.mail.importantMails(on: .now)
        async let events = services.calendar.todayBriefing()
        do {
            importantMails = try await mails
        } catch {
            importantMails = []
            report(error, "중요 메일을 불러오지 못했어요.")
        }
        do {
            todayEvents = try await events
        } catch {
            todayEvents = []
            report(error, "오늘 일정을 불러오지 못했어요.")
        }
    }

    /// Not having connected Google yet is shown by the connect cards, not as an error.
    private func report(_ error: Error, _ message: String) {
        if case .server("GOOGLE_NOT_CONNECTED", _) = error as? EdgeError { return }
        errorMessage = message
    }

    private func loadTodos() async {
        guard let store else { return }
        isLoadingTodos = true
        defer { isLoadingTodos = false }
        do {
            async let todos = store.todayTodos()
            async let todoCategories = store.todoCategories()
            async let calendarCategories = store.calendarCategories()
            self.todos = try await todos
            self.todoCategories = try await todoCategories
            self.calendarCategories = try await calendarCategories
        } catch {
            errorMessage = "할 일을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
        }
    }

    /// Optimistic toggle; reverted if the update fails. Parent auto-complete of subtasks is a
    /// DB trigger, and the dashboard only lists top-level todos.
    func toggleTodo(_ id: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == id }) else { return }
        todos[index].isDone.toggle()
        let isDone = todos[index].isDone
        guard let store else { return }
        Task {
            do {
                try await store.setTodo(id, isDone: isDone)
            } catch {
                if let index = todos.firstIndex(where: { $0.id == id }) {
                    todos[index].isDone = !isDone
                }
                errorMessage = "할 일 상태를 저장하지 못했어요."
            }
        }
    }

    // MARK: - Reorder

    /// Drag-and-drop reorder: the dragged todo takes the drop target's position. Only the moved
    /// row gets a new `order_index` (midway between its neighbors); the whole list is renumbered
    /// when the gap gets too small to split.
    func moveTodo(_ id: UUID, to targetID: UUID) {
        guard id != targetID,
              let from = todos.firstIndex(where: { $0.id == id }),
              let to = todos.firstIndex(where: { $0.id == targetID })
        else { return }

        let previous = todos
        var reordered = todos
        let todo = reordered.remove(at: from)
        reordered.insert(todo, at: to)

        let before = to > 0 ? reordered[to - 1].orderIndex : nil
        let after = to < reordered.count - 1 ? reordered[to + 1].orderIndex : nil
        let updates: [TodoOrderUpdate]
        switch (before, after) {
        case let (before?, after?) where after - before > 1e-6:
            reordered[to].orderIndex = (before + after) / 2
            updates = [TodoOrderUpdate(id: id, orderIndex: reordered[to].orderIndex)]
        case let (before?, nil):
            reordered[to].orderIndex = before + 1
            updates = [TodoOrderUpdate(id: id, orderIndex: reordered[to].orderIndex)]
        case let (nil, after?):
            reordered[to].orderIndex = after - 1
            updates = [TodoOrderUpdate(id: id, orderIndex: reordered[to].orderIndex)]
        default:
            for index in reordered.indices {
                reordered[index].orderIndex = Double(index + 1)
            }
            updates = reordered.map { TodoOrderUpdate(id: $0.id, orderIndex: $0.orderIndex) }
        }
        todos = reordered

        guard let store else { return }
        Task {
            do {
                try await store.reorder(updates)
            } catch {
                todos = previous
                errorMessage = "순서를 저장하지 못했어요. 다시 시도해 주세요."
            }
        }
    }

    // MARK: - Add

    func makeTodoDraft(now: Date = .now) -> NewTodoDraft {
        NewTodoDraft(dueAt: nextHour(after: now), category: nil)
    }

    func makeEventDraft(now: Date = .now) -> NewEventDraft {
        let start = nextHour(after: now)
        return NewEventDraft(
            category: calendarCategories.first,
            startAt: start,
            endAt: calendar.date(byAdding: .hour, value: 1, to: start) ?? start
        )
    }

    /// Saves a manual todo and returns it. It's listed under its due day (`todos.date`), so it
    /// joins "오늘 할 일" only when due today.
    func addTodo(_ draft: NewTodoDraft) async throws -> DashboardTodo {
        let todo = DashboardTodo(
            id: UUID(),
            title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            isDone: false,
            category: draft.category,
            dueAt: draft.dueAt,
            source: .manual,
            subtaskProgress: nil,
            orderIndex: (todos.map(\.orderIndex).max() ?? 0) + 1
        )
        try await store?.createTodo(todo, on: draft.dueAt)
        if calendar.isDateInToday(draft.dueAt) {
            todos.append(todo)
        }
        return todo
    }

    /// Adds an event (`POST calendar/events`, which writes Google Calendar and the cache) and
    /// returns it. It joins "오늘 일정" only when it starts today.
    func addEvent(_ draft: NewEventDraft) async throws -> DashboardEvent {
        let event: DashboardEvent
        if let services {
            event = try await services.calendar.create(draft)
        } else {
            let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
            event = DashboardEvent(
                id: UUID(),
                title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
                startAt: draft.startAt,
                endAt: draft.endAt,
                isAllDay: false,
                category: draft.category,
                location: location.isEmpty ? nil : location
            )
        }
        if calendar.isDateInToday(draft.startAt) {
            todayEvents.append(event)
            todayEvents.sort { $0.startAt < $1.startAt }
        }
        return event
    }

    /// `POST assistant/command` (202; results arrive on `assistant_commands`).
    private func nextHour(after date: Date) -> Date {
        let hourStart = calendar.dateInterval(of: .hour, for: date)?.start ?? date
        return calendar.date(byAdding: .hour, value: 1, to: hourStart) ?? date
    }
}
