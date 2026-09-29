import Combine
import Foundation

/// A "이번 주 미리 준비" recommendation. Real suggestions come from
/// `POST /functions/v1/todo-ai/todos/suggest`, which doesn't exist yet, so these are mock.
struct PrepSuggestion: Identifiable, Equatable {
    let id: UUID
    var title: String
    var dueAt: Date
    var category: NaviCategory?
    /// "발표 2일 전"
    var reason: String
    /// "약 40분"
    var effort: String
    /// Shown in red ("마감 전날").
    var isUrgent = false
    var isSelected = true
}

/// State for the "할 일" tab (Figma "03 Final Prototype › 10 - 할 일"). Todos, categories, and
/// every edit go through `TodoStore` (Supabase); without a store it runs on mock data.
@MainActor
final class TodoTabModel: ObservableObject {
    enum Filter: CaseIterable, Hashable {
        case all, today, thisWeek, overdue, noDeadline

        var title: String {
            switch self {
            case .all: return "전체"
            case .today: return "오늘"
            case .thisWeek: return "이번 주"
            case .overdue: return "기한 지남"
            case .noDeadline: return "기한 없음"
            }
        }

        fileprivate var groups: [Group] {
            switch self {
            case .all: return Group.allCases
            case .today: return [.today]
            case .thisWeek: return [.today, .thisWeek]
            case .overdue: return [.overdue]
            case .noDeadline: return [.noDeadline]
            }
        }
    }

    enum Group: CaseIterable, Hashable {
        case overdue, today, thisWeek, later, noDeadline

        var title: String {
            switch self {
            case .overdue: return "기한 지남"
            case .today: return "오늘"
            case .thisWeek: return "이번주"
            case .later: return "이후"
            case .noDeadline: return "기한 없음"
            }
        }
    }

    /// What the right column shows.
    enum Panel: Equatable {
        case overview
        case detail(UUID)
        case deadline(UUID)
        case newTodo
        case todoAdded(DashboardTodo)
        case prep
        case prepDetail(UUID)
        case prepAdded([PrepSuggestion])
    }

    @Published private(set) var todos: [DashboardTodo]
    @Published private(set) var categories: [NaviCategory]
    @Published private(set) var suggestions: [PrepSuggestion] = []
    @Published var filter: Filter = .all
    @Published var searchText = ""
    @Published var showsCompleted = true
    @Published var panel: Panel = .overview
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    @Published private(set) var isLoadingSuggestions = false

    private let store: TodoStore?
    private let services: EdgeServices?
    private var calendar: Calendar

    init(store: TodoStore? = nil, services: EdgeServices? = nil, now: Date = .now, calendar: Calendar = .current) {
        self.store = store
        self.services = services
        var calendar = calendar
        calendar.firstWeekday = 1 // Figma weeks run 일–토.
        self.calendar = calendar
        if store == nil {
            let mock = Self.mockData(now: now, calendar: calendar)
            todos = mock.todos
            categories = mock.categories
        } else {
            todos = []
            categories = []
        }
    }

    // MARK: - Loading

    func load() async {
        guard let store else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let todos = store.allTodos()
            async let categories = store.todoCategories()
            self.todos = try await todos
            self.categories = try await categories
            errorMessage = nil
        } catch {
            errorMessage = "할 일을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
        }
    }

    // MARK: - Derived

    var openCount: Int { todos.filter { !$0.isDone }.count }
    var doneCount: Int { todos.filter(\.isDone).count }

    /// "오늘의 흐름": today's todos done / total.
    var todayProgress: (done: Int, total: Int) {
        let today = todos.filter { group(of: $0) == .today }
        return (today.filter(\.isDone).count, today.count)
    }

    func count(in category: NaviCategory) -> Int {
        todos.filter { $0.category?.id == category.id && !$0.isDone }.count
    }

    /// Visible groups for the current filter and search, in Figma order.
    var groupedTodos: [(group: Group, todos: [DashboardTodo])] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        let visible = todos.filter { todo in
            (showsCompleted || !todo.isDone)
                && (query.isEmpty || todo.title.localizedCaseInsensitiveContains(query))
        }
        return filter.groups.compactMap { group in
            let items = visible
                .filter { self.group(of: $0) == group }
                .sorted { ($0.dueAt ?? .distantFuture, $0.orderIndex) < ($1.dueAt ?? .distantFuture, $1.orderIndex) }
            return items.isEmpty ? nil : (group, items)
        }
    }

    func group(of todo: DashboardTodo, now: Date = .now) -> Group? {
        guard let dueAt = todo.dueAt else { return .noDeadline }
        let startOfToday = calendar.startOfDay(for: now)
        if dueAt < startOfToday {
            // Finished overdue todos drop out of the list; they still count as done.
            return todo.isDone ? nil : .overdue
        }
        if calendar.isDate(dueAt, inSameDayAs: now) { return .today }
        if let week = calendar.dateInterval(of: .weekOfYear, for: now), week.contains(dueAt) {
            return .thisWeek
        }
        return .later
    }

    /// Row caption: "어제" (red) for overdue, "오전 9:00" today, "목 오전 9:00" this week,
    /// "9월 30일" later, or the origin for undated todos.
    func meta(for todo: DashboardTodo) -> TodoItemRow.Meta? {
        guard let dueAt = todo.dueAt else {
            switch todo.source {
            case .mailSuggestion: return .init(text: "메일에서 생성됨")
            case .calendarSuggestion: return .init(text: "일정에서 생성됨")
            case .manual, .subdivision: return nil
            }
        }
        switch group(of: todo) {
        case .overdue:
            if calendar.isDateInYesterday(dueAt) { return .init(text: "어제", isOverdue: true) }
            return .init(text: Self.format(dueAt, "M월 d일"), isOverdue: true)
        case .today:
            return .init(text: Self.format(dueAt, "a h:mm"))
        case .thisWeek:
            return .init(text: Self.format(dueAt, "E a h:mm"))
        default:
            return .init(text: Self.format(dueAt, "M월 d일"))
        }
    }

    func todo(_ id: UUID) -> DashboardTodo? {
        todos.first { $0.id == id }
    }

    // MARK: - Edits

    func toggle(_ id: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == id }) else { return }
        let isDone = !todos[index].isDone
        todos[index].isDone = isDone
        persist("할 일 상태를 저장하지 못했어요.") { store in
            try await store.setTodo(id, isDone: isDone)
        }
    }

    /// Mirrors the DB trigger locally: the parent is done exactly when every child is.
    func toggleSubtask(_ subtaskID: UUID, of todoID: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == todoID }),
              let subIndex = todos[index].subtasks.firstIndex(where: { $0.id == subtaskID })
        else { return }
        let isDone = !todos[index].subtasks[subIndex].isDone
        todos[index].subtasks[subIndex].isDone = isDone
        refreshProgress(at: index)
        persist("하위 할 일을 저장하지 못했어요.") { store in
            try await store.setTodo(subtaskID, isDone: isDone)
        }
    }

    func addSubtask(_ title: String, to todoID: UUID) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let index = todos.firstIndex(where: { $0.id == todoID }) else { return }
        let subtask = TodoSubtask(id: UUID(), title: trimmed, isDone: false)
        todos[index].subtasks.append(subtask)
        refreshProgress(at: index)
        let day = todos[index].day ?? todos[index].dueAt ?? .now
        persist("하위 할 일을 추가하지 못했어요.") { store in
            try await store.createSubtask(subtask, parentID: todoID, on: day)
        }
    }

    func rename(_ todoID: UUID, to title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let index = todos.firstIndex(where: { $0.id == todoID }),
              todos[index].title != trimmed
        else { return }
        todos[index].title = trimmed
        saveFields(of: todos[index])
    }

    func setCategory(_ category: NaviCategory?, of todoID: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == todoID }) else { return }
        todos[index].category = category
        saveFields(of: todos[index])
    }

    func setDeadline(_ dueAt: Date, of todoID: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == todoID }) else { return }
        todos[index].dueAt = dueAt
        todos[index].day = calendar.startOfDay(for: dueAt)
        saveFields(of: todos[index])
    }

    func move(_ id: UUID, to targetID: UUID) {
        guard id != targetID,
              let from = todos.firstIndex(where: { $0.id == id }),
              let target = todos.first(where: { $0.id == targetID })
        else { return }
        // Take the target's slot: just before it in order_index.
        let before = todos
            .filter { $0.id != id && $0.orderIndex < target.orderIndex }
            .map(\.orderIndex)
            .max() ?? (target.orderIndex - 2)
        let newIndex = (before + target.orderIndex) / 2
        todos[from].orderIndex = newIndex
        persist("순서를 저장하지 못했어요.") { store in
            try await store.reorder([TodoOrderUpdate(id: id, orderIndex: newIndex)])
        }
    }

    // MARK: - Create

    func makeDraft(now: Date = .now) -> NewTodoDraft {
        let hourStart = calendar.dateInterval(of: .hour, for: now)?.start ?? now
        return NewTodoDraft(dueAt: calendar.date(byAdding: .hour, value: 1, to: hourStart) ?? now, category: nil)
    }

    func addTodo(_ draft: NewTodoDraft, source: DashboardTodo.Source = .manual) async throws -> DashboardTodo {
        let todo = DashboardTodo(
            id: UUID(),
            title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            isDone: false,
            category: draft.category,
            dueAt: draft.dueAt,
            source: source,
            subtaskProgress: nil,
            orderIndex: (todos.map(\.orderIndex).max() ?? 0) + 1,
            day: calendar.startOfDay(for: draft.dueAt)
        )
        try await store?.createTodo(todo, on: draft.dueAt)
        todos.append(todo)
        return todo
    }

    /// Quick-add bar: "제목 /내일 17:00 #업무". `/` sets the deadline (오늘·내일·모레, M.d or
    /// M/d, HH:mm or H시); `#` picks an existing category by name.
    func quickAdd(_ text: String, now: Date = .now) {
        var parsed = parseQuickAdd(text, now: now)
        parsed.title = parsed.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !parsed.title.isEmpty else { return }
        let draft = NewTodoDraft(title: parsed.title, dueAt: parsed.dueAt ?? .distantFuture, category: parsed.category)
        Task {
            do {
                if parsed.dueAt == nil {
                    // No deadline: stored with due_at = null, listed today.
                    try await addUndatedTodo(title: parsed.title, category: parsed.category)
                } else {
                    _ = try await addTodo(draft)
                }
            } catch {
                errorMessage = "할 일을 추가하지 못했어요."
            }
        }
    }

    private func addUndatedTodo(title: String, category: NaviCategory?) async throws {
        let todo = DashboardTodo(
            id: UUID(), title: title, isDone: false, category: category, dueAt: nil,
            source: .manual, subtaskProgress: nil,
            orderIndex: (todos.map(\.orderIndex).max() ?? 0) + 1,
            day: calendar.startOfDay(for: .now)
        )
        try await store?.createTodo(todo, on: .now)
        todos.append(todo)
    }

    struct QuickAdd: Equatable {
        var title: String
        var dueAt: Date?
        var category: NaviCategory?
    }

    func parseQuickAdd(_ text: String, now: Date = .now) -> QuickAdd {
        var body = text.trimmingCharacters(in: .whitespaces)
        if body.hasPrefix("- [ ]") { body.removeFirst(5) }
        var titleWords: [String] = []
        var day: Date?
        var time: (hour: Int, minute: Int)?
        var category: NaviCategory?
        let today = calendar.startOfDay(for: now)

        for word in body.split(separator: " ").map(String.init) {
            if word.hasPrefix("#"), word.count > 1 {
                let name = String(word.dropFirst())
                category = categories.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }
                if category == nil { titleWords.append(word) }
            } else if word.hasPrefix("/"), word.count > 1 {
                let token = String(word.dropFirst())
                if let parsedDay = parseDay(token, today: today) {
                    day = parsedDay
                } else if let parsedTime = parseTime(token) {
                    time = parsedTime
                } else {
                    titleWords.append(word)
                }
            } else if let parsedTime = time == nil && day != nil ? parseTime(word) : nil {
                time = parsedTime // "/내일 17:00"
            } else {
                titleWords.append(word)
            }
        }

        var dueAt: Date?
        if day != nil || time != nil {
            let base = day ?? today
            let (hour, minute) = time ?? (18, 0)
            dueAt = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: base)
        }
        return QuickAdd(title: titleWords.joined(separator: " "), dueAt: dueAt, category: category)
    }

    private func parseDay(_ token: String, today: Date) -> Date? {
        switch token {
        case "오늘": return today
        case "내일": return calendar.date(byAdding: .day, value: 1, to: today)
        case "모레": return calendar.date(byAdding: .day, value: 2, to: today)
        default: break
        }
        let parts = token.split(whereSeparator: { $0 == "." || $0 == "/" }).compactMap { Int($0) }
        guard parts.count == 2, (1...12).contains(parts[0]), (1...31).contains(parts[1]) else { return nil }
        var components = calendar.dateComponents([.year], from: today)
        components.month = parts[0]
        components.day = parts[1]
        guard let date = calendar.date(from: components) else { return nil }
        // "9.1" in late December means next year.
        return date < today ? calendar.date(byAdding: .year, value: 1, to: date) : date
    }

    private func parseTime(_ token: String) -> (hour: Int, minute: Int)? {
        if token.hasSuffix("시"), let hour = Int(token.dropLast()), (0...23).contains(hour) {
            return (hour, 0)
        }
        let parts = token.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0...23).contains(parts[0]), (0...59).contains(parts[1]) else { return nil }
        return (parts[0], parts[1])
    }

    // MARK: - Categories

    func addCategory(name: String, color: String) async throws {
        let category = NaviCategory(id: UUID(), name: name.trimmingCharacters(in: .whitespaces), color: color)
        try await store?.createTodoCategory(category)
        categories.append(category)
    }

    // MARK: - Weekly prep

    /// "이번 주 미리 준비": `POST todo-ai/todos/suggest` for this week (the next week on Sundays).
    func openPrep(now: Date = .now) {
        panel = .prep
        guard suggestions.isEmpty else { return }
        guard let todoAI = services?.todoAI else {
            suggestions = Self.mockSuggestions(now: now, calendar: calendar, categories: categories)
            return
        }
        let isSunday = calendar.component(.weekday, from: now) == 1
        let fallbackDue = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: now) ?? now
        isLoadingSuggestions = true
        Task {
            defer { isLoadingSuggestions = false }
            do {
                suggestions = try await todoAI.suggestions(week: isSunday ? "next" : "current",
                                                           categories: categories, fallbackDue: fallbackDue)
                errorMessage = nil
            } catch {
                #if DEBUG
                if error as? EdgeError == .unavailable {
                    suggestions = Self.mockSuggestions(now: now, calendar: calendar, categories: categories)
                    return
                }
                #endif
                errorMessage = "추천 할 일을 불러오지 못했어요."
            }
        }
    }

    func toggleSuggestion(_ id: UUID) {
        guard let index = suggestions.firstIndex(where: { $0.id == id }) else { return }
        suggestions[index].isSelected.toggle()
    }

    func updateSuggestion(_ suggestion: PrepSuggestion) {
        guard let index = suggestions.firstIndex(where: { $0.id == suggestion.id }) else { return }
        suggestions[index] = suggestion
    }

    /// Saves the selected suggestions as `source = 'calendar_suggestion'` todos.
    func addSelectedSuggestions() async {
        let selected = suggestions.filter(\.isSelected)
        guard !selected.isEmpty else { return }
        var added: [PrepSuggestion] = []
        for suggestion in selected {
            do {
                _ = try await addTodo(
                    NewTodoDraft(title: suggestion.title, dueAt: suggestion.dueAt, category: suggestion.category),
                    source: .calendarSuggestion
                )
                added.append(suggestion)
            } catch {
                errorMessage = "추천 할 일을 추가하지 못했어요."
            }
        }
        suggestions.removeAll { suggestion in added.contains { $0.id == suggestion.id } }
        if !added.isEmpty { panel = .prepAdded(added) }
    }

    /// Adds one suggestion from its detail panel.
    func addSuggestion(_ suggestion: PrepSuggestion) async throws {
        _ = try await addTodo(
            NewTodoDraft(title: suggestion.title, dueAt: suggestion.dueAt, category: suggestion.category),
            source: .calendarSuggestion
        )
        suggestions.removeAll { $0.id == suggestion.id }
        panel = .prepAdded([suggestion])
    }

    /// `POST assistant/command` (202; results arrive on `assistant_commands`).
    func sendAssistantPrompt(_ text: String) {
        guard let assistant = services?.assistant else { return }
        Task {
            do {
                try await assistant.command(text)
            } catch {
                errorMessage = error as? EdgeError == .unavailable ? "AI 비서가 아직 연결되지 않았어요." : "요청을 보내지 못했어요."
            }
        }
    }

    // MARK: - Helpers

    private func refreshProgress(at index: Int) {
        let subtasks = todos[index].subtasks
        todos[index].subtaskProgress = subtasks.isEmpty
            ? nil
            : SubtaskProgress(done: subtasks.filter(\.isDone).count, total: subtasks.count)
        if !subtasks.isEmpty {
            todos[index].isDone = subtasks.allSatisfy(\.isDone)
        }
    }

    private func saveFields(of todo: DashboardTodo) {
        let day = todo.day ?? calendar.startOfDay(for: todo.dueAt ?? .now)
        persist("할 일을 저장하지 못했어요.") { store in
            try await store.updateTodo(todo.id, title: todo.title, dueAt: todo.dueAt, day: day, categoryID: todo.category?.id)
        }
    }

    /// Runs a store write; on failure reloads from the server so the screen matches the DB.
    private func persist(_ failure: String, _ write: @escaping (TodoStore) async throws -> Void) {
        guard let store else { return }
        Task {
            do {
                try await write(store)
            } catch {
                errorMessage = failure
                await load()
            }
        }
    }

    static func format(_ date: Date, _ pattern: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    // MARK: - Mock data (previews, no session)

    private static func mockData(now: Date, calendar: Calendar) -> (todos: [DashboardTodo], categories: [NaviCategory]) {
        let work = NaviCategory(id: UUID(), name: "업무", color: "#7165FF")
        let study = NaviCategory(id: UUID(), name: "공부", color: "#2EA366")
        let personal = NaviCategory(id: UUID(), name: "개인", color: "#3366CC")
        let today = calendar.startOfDay(for: now)
        func at(_ dayOffset: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            let day = calendar.date(byAdding: .day, value: dayOffset, to: today) ?? today
            return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
        }
        let laterThisWeek = min(2, 6 - (calendar.component(.weekday, from: now) - 1))
        func todo(_ title: String, _ due: Date?, _ category: NaviCategory?, done: Bool = false, order: Double,
                  subtasks: [TodoSubtask] = [], source: DashboardTodo.Source = .manual) -> DashboardTodo {
            DashboardTodo(
                id: UUID(), title: title, isDone: done, category: category, dueAt: due, source: source,
                subtaskProgress: subtasks.isEmpty ? nil : SubtaskProgress(done: subtasks.filter(\.isDone).count, total: subtasks.count),
                orderIndex: order, subtasks: subtasks, day: due.map { calendar.startOfDay(for: $0) } ?? today
            )
        }
        let todos = [
            todo("Navi 회의록 초안 공유", at(-1, 18), work, order: 1, source: .mailSuggestion),
            todo("디자인 리뷰 피드백 반영", at(0, 9), work, order: 2, subtasks: [
                TodoSubtask(id: UUID(), title: "검토 의견 모으기", isDone: true),
                TodoSubtask(id: UUID(), title: "수정 우선순위 정하기", isDone: true),
                TodoSubtask(id: UUID(), title: "최종안 팀에 공유", isDone: false),
            ]),
            todo("HCI 과제 제출", at(0, 17), study, order: 3),
            todo("장보기", at(0, 20), personal, order: 4),
            todo("발표 자료 검토", at(laterThisWeek, 17), work, order: 5),
            todo("주간 회고 작성", at(laterThisWeek, 21), work, done: true, order: 6, subtasks: [
                TodoSubtask(id: UUID(), title: "이번 주 한 일 정리", isDone: true),
                TodoSubtask(id: UUID(), title: "다음 주 목표", isDone: true),
                TodoSubtask(id: UUID(), title: "회고 공유", isDone: true),
            ]),
            todo("읽을 책 고르기", nil, personal, order: 7),
        ]
        return (todos, [work, study, personal])
    }

    private static func mockSuggestions(now: Date, calendar: Calendar, categories: [NaviCategory]) -> [PrepSuggestion] {
        let today = calendar.startOfDay(for: now)
        func at(_ dayOffset: Int, _ hour: Int) -> Date {
            let day = calendar.date(byAdding: .day, value: dayOffset, to: today) ?? today
            return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
        }
        return [
            PrepSuggestion(id: UUID(), title: "발표 자료 검토", dueAt: at(2, 17), category: categories.first,
                           reason: "발표 2일 전", effort: "약 40분", isSelected: false),
            PrepSuggestion(id: UUID(), title: "HCI 챕터 4 복습", dueAt: at(3, 18), category: categories.dropFirst().first ?? categories.first,
                           reason: "시험 3일 전", effort: "약 60분"),
            PrepSuggestion(id: UUID(), title: "장학금 서류 PDF 확인", dueAt: at(4, 10), category: categories.last,
                           reason: "마감 전날", effort: "약 15분", isUrgent: true),
        ]
    }
}
