import Combine
import Foundation

/// A briefing mail in the floating widget: the message plus the short lines the widget shows
/// ("황성주 교수님 회신 필요" on the home card, "오늘 17시 전 참석 여부 회신" in the list) and the
/// event the assistant suggests from it.
struct FloatingMail: Identifiable, Equatable {
    var message: MailMessage
    var briefTitle: String
    var actionNote: String
    var suggestedEvent: String?

    var id: UUID { message.id }
}

/// State for the floating mini widget (Figma "03-1 Floating UI": 00 브리핑, 01 메일, 02 일정,
/// 03 할 일). UI only for now: everything is sample data and edits stay in memory.
// TODO: Load from the same services as the main window once the widget is wired to the backend.
@MainActor
final class FloatingWidgetModel: ObservableObject {
    enum Screen: Equatable {
        case home
        case mails
        case mailDetail(UUID)
        case events
        case eventDetail(UUID)
        /// New-event form; from a mail's "일정에 추가" it is prefilled and returns to that mail.
        case newEvent(fromMail: UUID?)
        case todos
        case todoDetail(UUID)
        case deadline(UUID)
    }

    @Published var screen: Screen = .home
    /// Whether the panel is showing above the mascot; tapping the mascot toggles it.
    @Published var isPanelOpen = true
    @Published var userName = ""
    @Published private(set) var mails: [FloatingMail]
    @Published private(set) var events: [DashboardEvent]
    @Published private(set) var todos: [DashboardTodo]
    @Published private(set) var todoCategories: [NaviCategory]
    @Published private(set) var calendarCategories: [NaviCategory]
    @Published private(set) var addedTodoMailIDs: Set<UUID> = []
    @Published private(set) var addedEventMailIDs: Set<UUID> = []

    private let calendar: Calendar

    init(now: Date = .now, calendar: Calendar = .current) {
        self.calendar = calendar
        let startOfToday = calendar.startOfDay(for: now)
        func today(_ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(bySettingHour: hour, minute: minute, second: 0, of: startOfToday) ?? now
        }
        func daysAgo(_ days: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(byAdding: .day, value: -days, to: today(hour, minute)) ?? now
        }

        let navi = NaviCategory(id: UUID(), name: "navi", color: "#7165FF")
        let team = NaviCategory(id: UUID(), name: "팀", color: "#E5404F")
        let work = NaviCategory(id: UUID(), name: "업무", color: "#7165FF")
        let research = NaviCategory(id: UUID(), name: "리서치", color: "#3366CC")
        todoCategories = [work, research]
        calendarCategories = [navi, team]

        mails = [
            FloatingMail(
                message: MailMessage(
                    id: UUID(),
                    sender: .init(name: "황성주", email: "sungju_hwang@example.com"),
                    subject: "졸업 프로젝트 중간 리뷰 요청",
                    body: "안녕하세요.\n졸업 프로젝트 중간 리뷰를 목요일 16시에 진행할 예정입니다.\n참석 가능 여부를 오늘 안에 알려주세요.",
                    receivedAt: today(8, 12),
                    isStarred: true,
                    category: "답장 대기",
                    summary: [(lead: "졸업 프로젝트 중간 리뷰", text: "목요일 16:00"), (lead: nil, text: "오늘 17시 전 참석 여부 회신 필요")],
                    suggestedTodo: "오늘 17:00까지 참석 여부 회신",
                    replyDraft: "교수님 안녕하세요. 목요일 16시 중간 리뷰에 참석하겠습니다.\n요청하신 자료는 확인 후 전달드리겠습니다."
                ),
                briefTitle: "황성주 교수님 회신 필요",
                actionNote: "오늘 17시 전 참석 여부 회신",
                suggestedEvent: "목요일 16시 졸업 프로젝트 중간 리뷰"
            ),
            FloatingMail(
                message: MailMessage(
                    id: UUID(),
                    sender: .init(name: "구영현", email: "younghyun@example.com"),
                    subject: "펭귄재단 장학금 마감",
                    body: "안녕하세요.\n펭귄재단 장학금 신청 마감이 9월 18일입니다.\n신청 서류를 기한 내에 제출해 주세요.",
                    receivedAt: daysAgo(1, 14, 30),
                    isStarred: false,
                    category: "요청·승인",
                    summary: [(lead: "장학금 신청 마감", text: "9월 18일"), (lead: nil, text: "신청 서류 제출 필요")],
                    suggestedTodo: "장학금 신청 서류 제출",
                    replyDraft: nil
                ),
                briefTitle: "펭귄재단 장학금 마감",
                actionNote: "9월 18일까지 신청 서류 제출",
                suggestedEvent: nil
            ),
            FloatingMail(
                message: MailMessage(
                    id: UUID(),
                    sender: .init(name: "GitHub", email: "noreply@github.com"),
                    subject: "아기펭귄수호대 팀 승인 요청",
                    body: "아기펭귄수호대 팀에서 최종 자료 승인을 요청했습니다.\n승인하려면 저장소에서 확인해 주세요.",
                    receivedAt: daysAgo(1, 9),
                    isStarred: false,
                    category: "요청·승인",
                    summary: [(lead: "팀 승인 요청", text: "최종 자료 승인 필요")],
                    suggestedTodo: "아기펭귄수호대 최종 자료 승인",
                    replyDraft: nil
                ),
                briefTitle: "아기펭귄수호대 팀 승인 요청",
                actionNote: "최종 자료 승인 필요",
                suggestedEvent: nil
            ),
        ]

        events = [
            DashboardEvent(id: UUID(), title: "팀 스탠드업", startAt: today(9), endAt: today(10), isAllDay: false, category: navi, location: "우정정보관 205호"),
            DashboardEvent(id: UUID(), title: "사용자 인터뷰", startAt: today(10, 30), endAt: today(11), isAllDay: false, category: team, location: "우정정보관 205호"),
            DashboardEvent(id: UUID(), title: "서연이랑 점심 약속", startAt: today(12), endAt: today(13), isAllDay: false, category: nil, location: nil),
            DashboardEvent(id: UUID(), title: "동창회", startAt: today(19), endAt: today(21), isAllDay: false, category: team, location: nil),
        ]

        todos = [
            DashboardTodo(
                id: UUID(), title: "Navi 회의록 초안 공유", isDone: false,
                category: work, dueAt: today(17), source: .mailSuggestion,
                subtaskProgress: SubtaskProgress(done: 0, total: 3), orderIndex: 1,
                subtasks: [
                    TodoSubtask(id: UUID(), title: "검토 의견 모으기", isDone: false),
                    TodoSubtask(id: UUID(), title: "수정 우선순위 정하기", isDone: false),
                    TodoSubtask(id: UUID(), title: "최종안 팀에 공유", isDone: false),
                ],
                day: startOfToday
            ),
            DashboardTodo(
                id: UUID(), title: "인터뷰 질문지 정리", isDone: false,
                category: research, dueAt: today(9), source: .calendarSuggestion,
                subtaskProgress: nil, orderIndex: 2, day: startOfToday
            ),
        ]
    }

    // MARK: - Lookups

    func mail(_ id: UUID) -> FloatingMail? { mails.first { $0.id == id } }
    func event(_ id: UUID) -> DashboardEvent? { events.first { $0.id == id } }
    func todo(_ id: UUID) -> DashboardTodo? { todos.first { $0.id == id } }

    var sortedEvents: [DashboardEvent] {
        events.sorted { $0.startAt < $1.startAt }
    }

    var nextEvent: DashboardEvent? {
        sortedEvents.first { $0.endAt > .now }
    }

    var openTodos: [DashboardTodo] {
        todos.filter { !$0.isDone }
    }

    // MARK: - Todos

    func toggleTodo(_ id: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == id }) else { return }
        todos[index].isDone.toggle()
    }

    func renameTodo(_ id: UUID, to title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let index = todos.firstIndex(where: { $0.id == id }) else { return }
        todos[index].title = trimmed
    }

    func setCategory(_ category: NaviCategory?, of id: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == id }) else { return }
        todos[index].category = category
    }

    func setDue(_ date: Date, of id: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == id }) else { return }
        todos[index].dueAt = date
    }

    func addTodo(title: String, category: NaviCategory?, dueAt: Date?) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        todos.append(DashboardTodo(
            id: UUID(), title: trimmed, isDone: false, category: category, dueAt: dueAt,
            source: .manual, subtaskProgress: nil,
            orderIndex: (todos.map(\.orderIndex).max() ?? 0) + 1,
            day: calendar.startOfDay(for: .now)
        ))
    }

    func toggleSubtask(_ subtaskID: UUID, of id: UUID) {
        guard let index = todos.firstIndex(where: { $0.id == id }),
              let subIndex = todos[index].subtasks.firstIndex(where: { $0.id == subtaskID })
        else { return }
        todos[index].subtasks[subIndex].isDone.toggle()
        syncProgress(at: index)
    }

    func addSubtask(_ title: String, to id: UUID) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let index = todos.firstIndex(where: { $0.id == id }) else { return }
        todos[index].subtasks.append(TodoSubtask(id: UUID(), title: trimmed, isDone: false))
        syncProgress(at: index)
    }

    private func syncProgress(at index: Int) {
        let subtasks = todos[index].subtasks
        todos[index].subtaskProgress = subtasks.isEmpty
            ? nil
            : SubtaskProgress(done: subtasks.filter(\.isDone).count, total: subtasks.count)
    }

    /// Default due time for the inline "할 일 추가" row: the next full hour today.
    var newTodoDueAt: Date {
        let now = Date.now
        let nextHour = calendar.dateInterval(of: .hour, for: now)?.end ?? now
        return calendar.isDate(nextHour, inSameDayAs: now) ? nextHour : now
    }

    // MARK: - Events

    func saveEvent(_ draft: NewEventDraft, id: UUID?) {
        let event = DashboardEvent(
            id: id ?? UUID(),
            title: draft.title.trimmingCharacters(in: .whitespacesAndNewlines),
            startAt: draft.startAt,
            endAt: draft.endAt,
            isAllDay: false,
            category: draft.category,
            location: draft.location.isEmpty ? nil : draft.location
        )
        if let index = events.firstIndex(where: { $0.id == event.id }) {
            events[index] = event
        } else {
            events.append(event)
        }
    }

    func draft(for event: DashboardEvent) -> NewEventDraft {
        NewEventDraft(
            title: event.title,
            category: event.category,
            startAt: event.startAt,
            endAt: event.endAt,
            location: event.location ?? ""
        )
    }

    func newEventDraft(fromMail mailID: UUID? = nil) -> NewEventDraft {
        let start = newTodoDueAt
        return NewEventDraft(
            title: mailID.flatMap { mail($0)?.suggestedEvent } ?? "",
            category: calendarCategories.first,
            startAt: start,
            endAt: start.addingTimeInterval(3600)
        )
    }

    // MARK: - Mail actions

    func addSuggestedTodo(from mailID: UUID) {
        guard let mail = mail(mailID), let title = mail.message.suggestedTodo,
              !addedTodoMailIDs.contains(mailID)
        else { return }
        addTodo(title: title, category: todoCategories.first, dueAt: nil)
        todos[todos.count - 1].source = .mailSuggestion
        addedTodoMailIDs.insert(mailID)
    }

    /// Called after the prefilled new-event form from a mail's "일정에 추가" is saved.
    func markEventAdded(from mailID: UUID) {
        addedEventMailIDs.insert(mailID)
    }
}
