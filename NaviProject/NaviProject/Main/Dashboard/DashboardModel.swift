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
/// command input go through the `mail` / `calendar` / `assistant` Edge Functions; until those
/// are deployed, DEBUG builds keep sample mail and events. Without a store (previews)
/// everything is sample data.
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
    private var sampleMails: [DashboardMail] = []
    private var sampleEvents: [DashboardEvent] = []

    init(store: TodoStore? = nil, services: EdgeServices? = nil, now: Date = .now, calendar: Calendar = .current) {
        self.store = store
        self.services = services
        self.calendar = calendar
        let work = NaviCategory(id: UUID(), name: "업무", color: "#7165FF")
        let research = NaviCategory(id: UUID(), name: "리서치", color: "#E5404F")
        let personal = NaviCategory(id: UUID(), name: "개인", color: "#2EA366")
        let navi = NaviCategory(id: UUID(), name: "navi", color: "#7165FF")
        let team = NaviCategory(id: UUID(), name: "팀", color: "#E5404F")
        let startOfToday = calendar.startOfDay(for: now)
        func today(_ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(bySettingHour: hour, minute: minute, second: 0, of: startOfToday) ?? now
        }
        func tomorrow(_ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(byAdding: .day, value: 1, to: today(hour, minute)) ?? now
        }

        todoCategories = [work, research, personal]
        calendarCategories = [navi, team]

        todos = [
            DashboardTodo(
                id: UUID(), title: "Navi 회의록 초안 공유", isDone: false,
                category: work, dueAt: nil, source: .mailSuggestion, subtaskProgress: nil, orderIndex: 1
            ),
            DashboardTodo(
                id: UUID(), title: "디자인 리뷰 자료 정리", isDone: true,
                category: work, dueAt: today(12), source: .manual,
                subtaskProgress: SubtaskProgress(done: 3, total: 3), orderIndex: 2
            ),
            DashboardTodo(
                id: UUID(), title: "사용자 인터뷰 질문지 작성", isDone: true,
                category: research, dueAt: tomorrow(11), source: .calendarSuggestion,
                subtaskProgress: SubtaskProgress(done: 3, total: 3), orderIndex: 3
            ),
            DashboardTodo(
                id: UUID(), title: "주간 회고 작성", isDone: true,
                category: nil, dueAt: tomorrow(12, 30), source: .manual,
                subtaskProgress: SubtaskProgress(done: 3, total: 3), orderIndex: 4
            ),
        ]

        if store != nil {
            // Real rows arrive in `load()`.
            todos = []
            todoCategories = []
            calendarCategories = []
        }

        importantMails = [
            DashboardMail(
                id: UUID(), sender: "Korean Air",
                subject: "대한항공과 아시아나항공의 마일리지 통합 방안 안내",
                snippet: "대한항공과 아시아나항공의 마일리지 통합 방안을 안내드립니다.",
                receivedAt: today(8, 18)
            ),
            DashboardMail(
                id: UUID(), sender: "김지민",
                subject: "프로젝트 일정 변경 안내",
                snippet: "안녕하세요. 이번 주 디자인 리뷰가 목요일 오후 4시로 변경되었습니다.",
                receivedAt: today(8, 5)
            ),
            DashboardMail(
                id: UUID(), sender: "GitHub",
                subject: "[navi-project-febe] Pull request #3 review requested",
                snippet: "sy-luvia12 requested your review on feat: implement app onboarding.",
                receivedAt: today(7, 42)
            ),
        ]

        todayEvents = [
            DashboardEvent(
                id: UUID(), title: "팀 스탠드업",
                startAt: today(9), endAt: today(10), isAllDay: false, category: navi,
                location: "우정정보관 205호"
            ),
            DashboardEvent(
                id: UUID(), title: "사용자 인터뷰",
                startAt: today(10, 30), endAt: today(11), isAllDay: false, category: team,
                location: "Zoom"
            ),
        ]

        if services != nil {
            // Real mail and events arrive in `load()`.
            sampleMails = importantMails
            sampleEvents = todayEvents
            importantMails = []
            todayEvents = []
        }
    }

    var completedTodoCount: Int {
        todos.filter(\.isDone).count
    }

    /// Loads today's todos, both category lists, important mail, and today's events.
    func load() async {
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
            #if DEBUG
            if error as? EdgeError == .unavailable { importantMails = sampleMails }
            #endif
        }
        do {
            todayEvents = try await events
        } catch {
            #if DEBUG
            if error as? EdgeError == .unavailable { todayEvents = sampleEvents }
            #endif
        }
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
            errorMessage = nil
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
    func sendCommand(_ text: String) {
        guard let assistant = services?.assistant else { return }
        Task {
            do {
                try await assistant.command(text)
            } catch {
                errorMessage = error as? EdgeError == .unavailable ? "AI 비서가 아직 연결되지 않았어요." : "요청을 보내지 못했어요."
            }
        }
    }

    private func nextHour(after date: Date) -> Date {
        let hourStart = calendar.dateInterval(of: .hour, for: date)?.start ?? date
        return calendar.date(byAdding: .hour, value: 1, to: hourStart) ?? date
    }
}
