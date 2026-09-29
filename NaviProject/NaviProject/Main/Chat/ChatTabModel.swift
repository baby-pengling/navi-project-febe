import Combine
import Foundation

struct ChatMessage: Identifiable, Equatable {
    enum Role: Equatable {
        case user
        case navi
    }

    let id: UUID
    var role: Role
    /// User text, or the bold lead line of a navi answer.
    var text: String
    /// Numbered lines under a navi answer ("12:00 전 — 사용자 인터뷰 질문 정리").
    var items: [String] = []
    /// Plan lines "할 일에 추가" saves ("12:00 전 — 디자인 리뷰 반영"); empty hides the button.
    var suggestedTodos: [String] = []
    /// "참고한 정보" footer ("오늘 일정 3개 · 중요 메일 1개 · 미완료 할 일 3개").
    var context: String?
}

struct ChatSession: Identifiable, Equatable {
    let id: UUID
    var title: String
    var updatedAt: Date
    var messages: [ChatMessage]
    /// Whether the row exists in `assistant_conversations`.
    var isStored = false
    var hasLoadedMessages = true
}

/// State for the "채팅" tab (Figma "03 Final Prototype › 11 - 채팅"). Conversations are topic
/// sessions in `assistant_conversations`; a question goes to the `assistant` Edge Function and
/// the reply arrives as an `assistant_messages` insert over Realtime. Until the backend is
/// deployed, DEBUG builds fall back to sample sessions. "할 일에 추가" creates real todos
/// through the todo tab's model.
@MainActor
final class ChatTabModel: ObservableObject {
    @Published private(set) var sessions: [ChatSession]
    @Published var selectedID: UUID? {
        didSet { if selectedID != oldValue { selectionChanged() } }
    }
    @Published var searchText = ""
    @Published private(set) var addedMessageIDs: Set<UUID> = []
    /// Sessions waiting for navi's reply ("답변을 만들고 있어요").
    @Published private(set) var respondingIDs: Set<UUID> = []
    @Published var errorMessage: String?

    private let todoModel: TodoTabModel
    private let assistant: AssistantService?
    private var subscription: Task<Void, Never>?

    init(todoModel: TodoTabModel, services: EdgeServices? = nil, now: Date = .now) {
        self.todoModel = todoModel
        assistant = services?.assistant
        sessions = services == nil ? Self.mockSessions(now: now) : []
        selectedID = sessions.first?.id
    }

    /// Loads recent sessions and opens the newest one.
    func load() async {
        guard let assistant else { return }
        do {
            let stored = try await assistant.sessions()
            let local = sessions.filter { !$0.isStored }
            // Keep messages already loaded in this session.
            sessions = local + stored.map { fresh in
                guard let previous = sessions.first(where: { $0.id == fresh.id }), previous.hasLoadedMessages else { return fresh }
                var merged = fresh
                merged.messages = previous.messages
                merged.hasLoadedMessages = true
                return merged
            }
            errorMessage = nil
            if selectedID == nil || selectedSession == nil { selectedID = visibleSessions.first?.id }
            else { selectionChanged() }
        } catch {
            #if DEBUG
            // The assistant tables / function aren't deployed yet: keep the sample sessions.
            if sessions.isEmpty {
                sessions = Self.mockSessions(now: .now)
                selectedID = sessions.first?.id
            }
            #else
            errorMessage = "대화 목록을 불러오지 못했어요."
            #endif
        }
    }

    var visibleSessions: [ChatSession] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        return sessions
            .filter { session in
                query.isEmpty
                    || session.title.localizedCaseInsensitiveContains(query)
                    || session.messages.contains { $0.text.localizedCaseInsensitiveContains(query) }
            }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    var selectedSession: ChatSession? {
        sessions.first { $0.id == selectedID }
    }

    // MARK: - Actions

    func newChat() {
        // Reuse an untouched "새 대화" instead of stacking empty sessions.
        if let empty = sessions.first(where: { !$0.isStored && $0.messages.isEmpty }) {
            selectedID = empty.id
            return
        }
        let session = ChatSession(id: UUID(), title: "새 대화", updatedAt: .now, messages: [])
        sessions.insert(session, at: 0)
        selectedID = session.id
    }

    func send(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if selectedSession == nil { newChat() }
        guard let id = selectedID, let index = sessions.firstIndex(where: { $0.id == id }) else { return }

        if sessions[index].messages.isEmpty { sessions[index].title = Self.title(for: text) }
        sessions[index].messages.append(ChatMessage(id: UUID(), role: .user, text: text))
        sessions[index].updatedAt = .now

        guard let assistant else {
            sessions[index].messages.append(ChatMessage(
                id: UUID(), role: .navi,
                text: "아직 AI 비서가 연결되지 않아 답변을 만들 수 없어요.",
                items: ["연결되면 일정·메일·할 일을 참고해 답해 드릴게요."]
            ))
            return
        }

        respondingIDs.insert(id)
        errorMessage = nil
        Task {
            do {
                if let index = sessions.firstIndex(where: { $0.id == id }), !sessions[index].isStored {
                    try await assistant.createConversation(id)
                    sessions[index].isStored = true
                    subscribe(to: id)
                }
                try await assistant.send(text, in: id)
            } catch {
                respondingIDs.remove(id)
                errorMessage = error as? EdgeError == .unavailable
                    ? "AI 비서가 아직 연결되지 않아 답변을 만들 수 없어요."
                    : "메시지를 보내지 못했어요."
            }
        }
    }

    // MARK: - Loading messages

    private func selectionChanged() {
        subscription?.cancel()
        subscription = nil
        guard let id = selectedID, let session = selectedSession, session.isStored else { return }
        subscribe(to: id)
        guard !session.hasLoadedMessages else { return }
        Task { await loadMessages(of: id) }
    }

    private func loadMessages(of id: UUID) async {
        guard let assistant else { return }
        do {
            let messages = try await assistant.chatMessages(in: id)
            guard let index = sessions.firstIndex(where: { $0.id == id }) else { return }
            sessions[index].messages = messages
            sessions[index].hasLoadedMessages = true
        } catch {
            errorMessage = "대화를 불러오지 못했어요."
        }
    }

    /// Follows `assistant_messages` inserts of one session (both the stored question and
    /// navi's reply).
    private func subscribe(to id: UUID) {
        guard let assistant, selectedID == id else { return }
        subscription?.cancel()
        subscription = Task { [weak self] in
            for await insert in assistant.messageInserts(in: id) {
                guard let self else { return }
                self.receive(insert)
            }
        }
    }

    private func receive(_ insert: AssistantService.Insert) {
        guard let index = sessions.firstIndex(where: { $0.id == insert.conversationID }) else { return }
        let message = insert.message
        guard !sessions[index].messages.contains(where: { $0.id == message.id }) else { return }
        if message.role == .user,
           let pending = sessions[index].messages.lastIndex(where: { $0.role == .user && $0.text == message.text }) {
            // Replace the optimistic copy with the stored row.
            sessions[index].messages[pending] = message
            return
        }
        sessions[index].messages.append(message)
        sessions[index].updatedAt = insert.createdAt ?? .now
        if message.role == .navi { respondingIDs.remove(insert.conversationID) }
    }

    /// "할 일에 추가": saves each plan line as a todo due today, at its "HH:mm 전" time or 18:00.
    func addTodos(from message: ChatMessage) async {
        guard !addedMessageIDs.contains(message.id) else { return }
        do {
            for line in message.suggestedTodos {
                let (title, due) = Self.parsePlanLine(line)
                _ = try await todoModel.addTodo(NewTodoDraft(title: title, dueAt: due, category: nil), source: .manual)
            }
            addedMessageIDs.insert(message.id)
        } catch {
            errorMessage = "할 일에 추가하지 못했어요."
        }
    }

    // MARK: - Formatting

    /// "방금", "14:20", "어제", "9월 2일".
    static func relativeTime(_ date: Date, now: Date = .now) -> String {
        let calendar = Calendar.current
        if now.timeIntervalSince(date) < 60 { return "방금" }
        if calendar.isDate(date, inSameDayAs: now) { return TodoTabModel.format(date, "HH:mm") }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) { return "어제" }
        return TodoTabModel.format(date, "M월 d일")
    }

    /// "12:00 전 — 사용자 인터뷰 질문 정리" → ("사용자 인터뷰 질문 정리", today 12:00).
    static func parsePlanLine(_ line: String, now: Date = .now) -> (title: String, dueAt: Date) {
        let calendar = Calendar.current
        var hour = 18, minute = 0
        var title = line
        let parts = line.components(separatedBy: " — ")
        if parts.count == 2 {
            title = parts[1]
            let time = parts[0].replacingOccurrences(of: " 전", with: "").split(separator: ":").compactMap { Int($0) }
            if time.count == 2, (0..<24).contains(time[0]), (0..<60).contains(time[1]) {
                hour = time[0]
                minute = time[1]
            }
        }
        let due = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: now) ?? now
        return (title.trimmingCharacters(in: .whitespaces), due)
    }

    /// First question, trimmed, as the session title.
    private static func title(for text: String) -> String {
        let line = text.components(separatedBy: .newlines).first ?? text
        return line.count > 20 ? String(line.prefix(20)) + "…" : line
    }

    // MARK: - Mock

    private static func mockSessions(now: Date) -> [ChatSession] {
        let calendar = Calendar.current
        let yesterday = calendar.date(byAdding: .day, value: -1, to: now) ?? now
        let earlier = calendar.date(byAdding: .day, value: -25, to: now) ?? now
        let plan = [
            "12:00 전 — 사용자 인터뷰 질문 정리",
            "16:30 전 — 디자인 리뷰 반영",
            "18:00 전 — 일정 변경 메일에 회신",
            "여유 시간 — 인턴십 서류 준비",
        ]
        return [
            ChatSession(id: UUID(), title: "오늘 일정 우선순위", updatedAt: now, messages: [
                ChatMessage(id: UUID(), role: .user, text: "오늘 일정과 할 일을 보고 우선순위를 정리해 줘."),
                ChatMessage(
                    id: UUID(), role: .navi, text: "오늘은 다음 순서로 진행하는 것을 추천해요.",
                    items: plan,
                    suggestedTodos: plan,
                    context: "오늘 일정 3개 · 중요 메일 1개 · 미완료 할 일 3개"
                ),
            ]),
            ChatSession(id: UUID(), title: "메일 답장 도와줘", updatedAt: yesterday, messages: [
                ChatMessage(id: UUID(), role: .user, text: "김지민님 메일에 보낼 답장 초안 써 줘."),
                ChatMessage(
                    id: UUID(), role: .navi, text: "목요일 디자인 리뷰 참석 회신 초안이에요.",
                    items: ["목요일 오후 4시 디자인 리뷰에 참석 가능합니다.", "검토할 자료가 있다면 미리 공유 부탁드립니다."],
                    context: "메일 1개"
                ),
            ]),
            ChatSession(id: UUID(), title: "이번 주 일정 요약", updatedAt: earlier, messages: [
                ChatMessage(id: UUID(), role: .user, text: "이번 주 일정 요약해 줘."),
                ChatMessage(
                    id: UUID(), role: .navi, text: "이번 주에는 일정이 4개 있어요.",
                    items: ["월 10:00 — 팀 스탠드업", "수 14:00 — 사용자 인터뷰", "목 16:00 — 디자인 리뷰", "금 10:00 — 장학금 서류 마감"],
                    context: "이번 주 일정 4개"
                ),
            ]),
        ]
    }
}
