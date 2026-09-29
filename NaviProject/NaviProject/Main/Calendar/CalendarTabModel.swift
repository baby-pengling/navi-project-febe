import Combine
import Foundation

/// State for the "일정" tab (Figma "03 Final Prototype › 09 일정"): week / month views, the
/// right column (calendar-made todos + categories, new / edit event, day detail, weekly prep),
/// and the prep dialogs.
///
/// Calendar categories and their visibility come from Supabase (`calendar_categories`);
/// todos made from events come from the todo tab's model. Events go through the `calendar`
/// Edge Function (Google Calendar); weekly prep through `todo-ai`. Until those are deployed,
/// DEBUG builds fall back to sample events and suggestions.
@MainActor
final class CalendarTabModel: ObservableObject {
    enum Mode: Hashable, CaseIterable {
        case week, month

        var title: String { self == .week ? "주" : "월" }
    }

    enum Panel: Equatable {
        case overview
        case newEvent
        case eventDetail(UUID)
        case dayDetail
        case prep
        case prepCriteria
        case prepDetail(UUID)
        case prepAdded([PrepSuggestion])
    }

    /// "추천 기준" toggles.
    struct PrepCriteria: Equatable {
        var mail = true
        var incompleteTodos = true
        var relatedTodos = true
        var userPattern = true

        var isEmpty: Bool { !(mail || incompleteTodos || relatedTodos || userPattern) }
    }

    @Published var mode: Mode = .week
    /// The selected day (week strip / month cell).
    @Published var selectedDay: Date
    @Published var panel: Panel = .overview
    @Published var searchText = ""
    @Published private(set) var events: [DashboardEvent]
    @Published private(set) var categories: [(category: NaviCategory, isVisible: Bool)] = []
    @Published var criteria = PrepCriteria()
    @Published private(set) var suggestions: [PrepSuggestion] = []
    @Published var errorMessage: String?

    let todoModel: TodoTabModel
    private let store: TodoStore?
    private let services: EdgeServices?
    private var calendar: Calendar
    private var cancellables: Set<AnyCancellable> = []
    /// Month (start date) whose events are loaded; reloaded when navigation leaves it.
    private var loadedMonth: Date?

    init(store: TodoStore?, services: EdgeServices? = nil, todoModel: TodoTabModel, now: Date = .now, calendar: Calendar = .current) {
        self.store = store
        self.services = services
        self.todoModel = todoModel
        var calendar = calendar
        calendar.firstWeekday = 1 // Figma weeks run 일–토.
        self.calendar = calendar
        selectedDay = calendar.startOfDay(for: now)
        let mock = Self.mockData(now: now, calendar: calendar)
        events = services == nil ? mock.events : []
        if store == nil {
            categories = mock.categories.map { ($0, true) }
        }
        // Re-render when the linked todos change.
        todoModel.objectWillChange
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
    }

    func load() async {
        guard let store else { return }
        do {
            categories = try await store.calendarCategoryVisibility()
            errorMessage = nil
        } catch {
            errorMessage = "캘린더 카테고리를 불러오지 못했어요."
        }
        await loadEvents(force: true)
        await todoModel.load()
    }

    /// Loads the selected month's grid (plus the surrounding weeks) from `calendar/events`.
    func loadEvents(force: Bool = false) async {
        guard let service = services?.calendar,
              let month = calendar.dateInterval(of: .month, for: selectedDay) else { return }
        guard force || loadedMonth != month.start else { return }
        loadedMonth = month.start
        let start = calendar.date(byAdding: .day, value: -7, to: month.start) ?? month.start
        let end = calendar.date(byAdding: .day, value: 7, to: month.end) ?? month.end
        do {
            events = try await service.events(from: start, to: end)
        } catch {
            #if DEBUG
            if error as? EdgeError == .unavailable {
                if events.isEmpty { events = Self.mockData(now: .now, calendar: calendar).events }
                return
            }
            #endif
            loadedMonth = nil
            errorMessage = "일정을 불러오지 못했어요."
        }
    }

    private func reloadEventsIfNeeded() {
        guard services != nil else { return }
        Task { await loadEvents() }
    }

    // MARK: - Navigation

    /// "2026년 9월"
    var monthTitle: String {
        TodoTabModel.format(selectedDay, "yyyy년 M월")
    }

    var weekDays: [Date] {
        guard let week = calendar.dateInterval(of: .weekOfYear, for: selectedDay) else { return [] }
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: week.start) }
    }

    /// Weeks of the month grid (only rows that touch the month).
    var monthWeeks: [[Date]] {
        guard let month = calendar.dateInterval(of: .month, for: selectedDay),
              let firstWeek = calendar.dateInterval(of: .weekOfYear, for: month.start)
        else { return [] }
        return (0..<6).map { week in
            (0..<7).compactMap { calendar.date(byAdding: .day, value: week * 7 + $0, to: firstWeek.start) }
        }
        .filter { week in week.contains { calendar.isDate($0, equalTo: selectedDay, toGranularity: .month) } }
    }

    func step(_ direction: Int) {
        let component: Calendar.Component = mode == .week ? .weekOfYear : .month
        selectedDay = calendar.date(byAdding: component, value: direction, to: selectedDay) ?? selectedDay
        reloadEventsIfNeeded()
    }

    func goToToday() {
        selectedDay = calendar.startOfDay(for: .now)
        reloadEventsIfNeeded()
    }

    func select(_ day: Date) {
        selectedDay = calendar.startOfDay(for: day)
        reloadEventsIfNeeded()
        if mode == .month { panel = .dayDetail }
    }

    func isToday(_ day: Date) -> Bool { calendar.isDateInToday(day) }
    func isSelected(_ day: Date) -> Bool { calendar.isDate(day, inSameDayAs: selectedDay) }
    func isInSelectedMonth(_ day: Date) -> Bool { calendar.isDate(day, equalTo: selectedDay, toGranularity: .month) }

    /// "오늘 · 9월 15일" or "9월 16일 · 수요일".
    var dayTitle: String {
        if isToday(selectedDay) { return "오늘 · \(TodoTabModel.format(selectedDay, "M월 d일"))" }
        return TodoTabModel.format(selectedDay, "M월 d일 · EEEE")
    }

    // MARK: - Events

    /// Events in visible categories matching the search.
    func events(on day: Date) -> [DashboardEvent] {
        let hidden = Set(categories.filter { !$0.isVisible }.map(\.category.id))
        let query = searchText.trimmingCharacters(in: .whitespaces)
        return events
            .filter { calendar.isDate($0.startAt, inSameDayAs: day) }
            .filter { $0.category.map { !hidden.contains($0.id) } ?? true }
            .filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) }
            .sorted { $0.startAt < $1.startAt }
    }

    func event(_ id: UUID) -> DashboardEvent? {
        events.first { $0.id == id }
    }

    func makeEventDraft() -> NewEventDraft {
        let base = isToday(selectedDay) ? Date() : calendar.date(bySettingHour: 9, minute: 0, second: 0, of: selectedDay) ?? selectedDay
        let hourStart = calendar.dateInterval(of: .hour, for: base)?.start ?? base
        let start = isToday(selectedDay) ? calendar.date(byAdding: .hour, value: 1, to: hourStart) ?? base : hourStart
        return NewEventDraft(
            category: categories.first?.category,
            startAt: start,
            endAt: calendar.date(byAdding: .hour, value: 1, to: start) ?? start
        )
    }

    func draft(for event: DashboardEvent) -> NewEventDraft {
        NewEventDraft(title: event.title, category: event.category, startAt: event.startAt, endAt: event.endAt, location: event.location ?? "")
    }

    /// `POST calendar/events`; without a backend (previews) the event stays local.
    func addEvent(_ draft: NewEventDraft) async throws {
        let event: DashboardEvent
        if let service = services?.calendar {
            event = try await service.create(draft)
        } else {
            let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
            event = DashboardEvent(
                id: UUID(), title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
                startAt: draft.startAt, endAt: draft.endAt, isAllDay: false,
                category: draft.category, location: location.isEmpty ? nil : location
            )
        }
        events.append(event)
        selectedDay = calendar.startOfDay(for: draft.startAt)
        panel = .overview
    }

    /// `PATCH calendar/events/:id` for Google fields, `set_event_category` for the category.
    func updateEvent(_ id: UUID, with draft: NewEventDraft) async throws {
        guard let index = events.firstIndex(where: { $0.id == id }) else { return }
        if let service = services?.calendar {
            let updated = try await service.update(id, from: events[index], to: draft)
            if let index = events.firstIndex(where: { $0.id == id }) { events[index] = updated }
        } else {
            let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
            events[index].title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            events[index].category = draft.category
            events[index].startAt = draft.startAt
            events[index].endAt = draft.endAt
            events[index].location = location.isEmpty ? nil : location
        }
        panel = .overview
    }

    // MARK: - Categories

    func toggleVisibility(of id: UUID) {
        guard let index = categories.firstIndex(where: { $0.category.id == id }) else { return }
        let isVisible = !categories[index].isVisible
        categories[index].isVisible = isVisible
        guard let store else { return }
        Task {
            do {
                try await store.setCalendarCategory(id, isVisible: isVisible)
            } catch {
                errorMessage = "카테고리 표시 설정을 저장하지 못했어요."
                await load()
            }
        }
    }

    func addCategory(name: String, color: String) async throws {
        let category = NaviCategory(id: UUID(), name: name.trimmingCharacters(in: .whitespaces), color: color)
        try await store?.createCalendarCategory(category)
        categories.append((category, true))
    }

    /// "일정에서 만든 할 일": todos created from calendar suggestions.
    var calendarTodos: [DashboardTodo] {
        todoModel.todos.filter { $0.source == .calendarSuggestion }
    }

    // MARK: - Weekly prep

    /// "9월 14일–20일"
    var weekRangeText: String {
        guard let first = weekDays.first, let last = weekDays.last else { return "" }
        let sameMonth = calendar.isDate(first, equalTo: last, toGranularity: .month)
        return "\(TodoTabModel.format(first, "M월 d일"))–\(TodoTabModel.format(last, sameMonth ? "d일" : "M월 d일"))"
    }

    /// Runs behind the "정리하고 있어요" dialog (`POST todo-ai/todos/suggest`). Returns false
    /// when there's nothing to suggest from (the "추천에 사용할 정보가 없어요" dialog).
    func generateSuggestions() async -> Bool {
        guard !criteria.isEmpty else { return false }
        if let todoAI = services?.todoAI {
            do {
                let fallbackDue = weekDays.last.flatMap { calendar.date(bySettingHour: 18, minute: 0, second: 0, of: $0) } ?? .now
                let items = try await todoAI.suggestions(week: "current", criteria: criteria,
                                                         categories: todoModel.categories, fallbackDue: fallbackDue)
                guard !items.isEmpty else { return false }
                suggestions = items
                panel = .prep
                return true
            } catch {
                #if DEBUG
                if error as? EdgeError == .unavailable { return sampleSuggestions() }
                #endif
                errorMessage = "추천 할 일을 만들지 못했어요."
                return true
            }
        }
        return sampleSuggestions()
    }

    private func sampleSuggestions() -> Bool {
        let week = weekDays
        guard week.count == 7 else { return false }
        func at(_ index: Int, _ hour: Int) -> Date {
            calendar.date(bySettingHour: hour, minute: 0, second: 0, of: week[index]) ?? week[index]
        }
        let todoCategories = todoModel.categories
        var items: [PrepSuggestion] = []
        if criteria.mail || criteria.incompleteTodos {
            items.append(PrepSuggestion(id: UUID(), title: "디자인 리뷰", dueAt: at(3, 17), category: todoCategories.first,
                                        reason: [criteria.mail ? "메일" : nil, criteria.incompleteTodos ? "미완료 할 일" : nil].compactMap { $0 }.joined(separator: " + "),
                                        effort: "", isSelected: false))
        }
        if criteria.relatedTodos {
            items.append(PrepSuggestion(id: UUID(), title: "[이음] 인터뷰", dueAt: at(4, 18), category: todoCategories.first,
                                        reason: "연관 할 일", effort: ""))
        }
        if criteria.userPattern {
            items.append(PrepSuggestion(id: UUID(), title: "발표 리허설", dueAt: at(5, 10), category: todoCategories.first,
                                        reason: "", effort: ""))
        }
        suggestions = items
        panel = .prep
        return true
    }

    func toggleSuggestion(_ id: UUID) {
        guard let index = suggestions.firstIndex(where: { $0.id == id }) else { return }
        suggestions[index].isSelected.toggle()
    }

    func addSelectedSuggestions() async {
        var added: [PrepSuggestion] = []
        for suggestion in suggestions where suggestion.isSelected {
            do {
                try await addToTodos(suggestion)
                added.append(suggestion)
            } catch {
                errorMessage = "추천 할 일을 추가하지 못했어요."
            }
        }
        suggestions.removeAll { suggestion in added.contains { $0.id == suggestion.id } }
        if !added.isEmpty { panel = .prepAdded(added) }
    }

    func addSuggestion(_ suggestion: PrepSuggestion) async throws {
        try await addToTodos(suggestion)
        suggestions.removeAll { $0.id == suggestion.id }
        panel = .prepAdded([suggestion])
    }

    private func addToTodos(_ suggestion: PrepSuggestion) async throws {
        _ = try await todoModel.addTodo(
            NewTodoDraft(title: suggestion.title, dueAt: suggestion.dueAt, category: suggestion.category),
            source: .calendarSuggestion
        )
    }

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

    // MARK: - Mock events

    private static func mockData(now: Date, calendar: Calendar) -> (events: [DashboardEvent], categories: [NaviCategory]) {
        let navi = NaviCategory(id: UUID(), name: "navi", color: "#7165FF")
        let team = NaviCategory(id: UUID(), name: "팀", color: "#E5404F")
        let study = NaviCategory(id: UUID(), name: "스터디", color: "#3366CC")
        let personal = NaviCategory(id: UUID(), name: "개인", color: "#2EA366")
        let today = calendar.startOfDay(for: now)
        func event(_ title: String, _ dayOffset: Int, _ hour: Int, _ minute: Int = 0, minutes: Int = 60,
                   _ category: NaviCategory, _ location: String? = nil) -> DashboardEvent {
            let day = calendar.date(byAdding: .day, value: dayOffset, to: today) ?? today
            let start = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
            return DashboardEvent(id: UUID(), title: title, startAt: start,
                                  endAt: start.addingTimeInterval(TimeInterval(minutes * 60)),
                                  isAllDay: false, category: category, location: location)
        }
        let events = [
            event("팀 스탠드업", 0, 9, minutes: 60, navi, "우정정보관 205호"),
            event("사용자 인터뷰", 0, 10, 30, minutes: 30, team, "Zoom"),
            event("서류 제출", 1, 14, minutes: 30, study),
            event("프로젝트 회의", 3, 16, minutes: 60, team, "우정정보관 205호"),
            event("팀 회의", -13, 11, minutes: 60, navi),
            event("스터디", -7, 19, minutes: 90, study),
            event("워크숍", 8, 13, minutes: 120, personal, "본관 3층"),
            event("발표 준비", 13, 15, minutes: 60, navi),
        ]
        return (events, [navi, team, study, personal])
    }
}
