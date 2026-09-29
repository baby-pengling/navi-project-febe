import Combine
import Foundation

struct MailMessage: Identifiable, Equatable {
    struct Person: Equatable {
        var name: String
        var email: String

        /// "김지민 <jimin@example.com>"
        var display: String { name.isEmpty ? email : "\(name) <\(email)>" }
    }

    let id: UUID
    var sender: Person
    var subject: String
    var body: String
    var receivedAt: Date
    var isStarred: Bool
    /// Briefing category ("답장 대기", "요청·승인", …) used by the filter tabs.
    var category: String?
    /// AI summary bullets: bold lead + detail ("디자인 리뷰", "목요일 16:00").
    var summary: [(lead: String?, text: String)]
    var suggestedTodo: String?
    var replyDraft: String?

    static func == (lhs: MailMessage, rhs: MailMessage) -> Bool {
        lhs.id == rhs.id && lhs.isStarred == rhs.isStarred && lhs.subject == rhs.subject
            && lhs.replyDraft == rhs.replyDraft && lhs.suggestedTodo == rhs.suggestedTodo
    }

    var snippet: String {
        body.replacingOccurrences(of: "\n", with: " ")
    }
}

struct MailDraft: Identifiable, Equatable {
    let id: UUID
    var to: String
    var subject: String
    var body: String
    /// Set for replies.
    var replyTo: UUID?
    var savedAt: Date = .now
    /// Whether the draft exists in Gmail (`mail/drafts`), so saving PATCHes instead of POSTing.
    var isStored = false
}

/// State for the "메일" tab (Figma "03 Final Prototype › 08 메일"). Messages, labels, drafts,
/// sending, and AI summaries go through the `mail` Edge Function (`MailService`); until it is
/// deployed, DEBUG builds fall back to sample messages. "할 일에 추가" creates a real todo
/// through the todo tab's model.
@MainActor
final class MailTabModel: ObservableObject {
    enum Filter: Hashable {
        case all
        case starred
        case category(String)
        case drafts

        var title: String {
            switch self {
            case .all: return "전체"
            case .starred: return "즐겨찾기"
            case .category(let name): return name
            case .drafts: return "임시 보관함"
            }
        }
    }

    enum Panel: Equatable {
        case empty
        case detail(UUID)
        case compose(MailDraft)
        case replyReview(UUID)
        case replyEdit(UUID)
    }

    @Published private(set) var messages: [MailMessage]
    @Published private(set) var drafts: [MailDraft] = []
    @Published var filter: Filter = .all
    @Published var searchText = ""
    @Published var panel: Panel = .empty
    @Published private(set) var addedTodoMessageIDs: Set<UUID> = []
    @Published var errorMessage: String?
    @Published private(set) var isLoading = false
    @Published private(set) var isSending = false
    /// Messages whose summary request is in flight.
    @Published private(set) var loadingSummaryIDs: Set<UUID> = []

    let senderAddress: String
    let senderName: String
    private let todoModel: TodoTabModel
    private let services: EdgeServices?
    private var loadedSummaryIDs: Set<UUID> = []

    init(todoModel: TodoTabModel, services: EdgeServices? = nil, senderAddress: String, senderName: String, now: Date = .now) {
        self.todoModel = todoModel
        self.services = services
        self.senderAddress = senderAddress.isEmpty ? "me@navi.app" : senderAddress
        self.senderName = senderName
        messages = services == nil ? Self.mockMessages(now: now) : []
    }

    /// Loads messages (with Gmail labels as categories) and drafts.
    func load() async {
        guard let mail = services?.mail else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let inbox = try await mail.inbox()
            // Keep summaries already opened in this session.
            messages = inbox.map { fresh in
                guard let previous = message(fresh.id) else { return fresh }
                var merged = fresh
                merged.summary = previous.summary
                merged.suggestedTodo = previous.suggestedTodo
                merged.replyDraft = previous.replyDraft
                if merged.category == nil { merged.category = previous.category }
                return merged
            }
            drafts = (try? await mail.drafts()) ?? drafts
            errorMessage = nil
        } catch {
            fallBack(error, message: "메일을 불러오지 못했어요.")
        }
    }

    /// DEBUG keeps the sample inbox while the Edge Function isn't deployed.
    private func fallBack(_ error: Error, message: String) {
        #if DEBUG
        if error as? EdgeError == .unavailable {
            if messages.isEmpty { messages = Self.mockMessages(now: .now) }
            errorMessage = nil
            return
        }
        #endif
        errorMessage = message
    }

    var filterTabs: [Filter] {
        var categories: [String] = []
        for message in messages {
            if let category = message.category, !categories.contains(category) { categories.append(category) }
        }
        return [.all, .starred] + categories.map(Filter.category)
    }

    var visibleMessages: [MailMessage] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        return messages
            .filter { message in
                switch filter {
                case .all, .drafts: return true
                case .starred: return message.isStarred
                case .category(let name): return message.category == name
                }
            }
            .filter {
                query.isEmpty
                    || $0.subject.localizedCaseInsensitiveContains(query)
                    || $0.sender.name.localizedCaseInsensitiveContains(query)
                    || $0.body.localizedCaseInsensitiveContains(query)
            }
            .sorted { $0.receivedAt > $1.receivedAt }
    }

    func message(_ id: UUID) -> MailMessage? {
        messages.first { $0.id == id }
    }

    var selectedMessageID: UUID? {
        switch panel {
        case .detail(let id), .replyReview(let id), .replyEdit(let id): return id
        case .compose(let draft): return draft.replyTo
        case .empty: return nil
        }
    }

    // MARK: - Actions

    /// Opens a message: marks it read, then loads the full body and the cached AI summary.
    func open(_ id: UUID) {
        panel = .detail(id)
        guard let mail = services?.mail, !loadedSummaryIDs.contains(id) else { return }
        loadingSummaryIDs.insert(id)
        Task {
            defer { loadingSummaryIDs.remove(id) }
            try? await mail.setRead(id, true)
            if let body = try? await mail.body(of: id), let index = messages.firstIndex(where: { $0.id == id }) {
                messages[index].body = body
            }
            do {
                let insight = try await mail.insight(for: id)
                guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
                messages[index].summary = insight.summary
                messages[index].suggestedTodo = insight.suggestedTodo
                messages[index].replyDraft = insight.replyDraft
                loadedSummaryIDs.insert(id)
            } catch {
                if error as? EdgeError != .unavailable { errorMessage = "메일 요약을 불러오지 못했어요." }
            }
        }
    }

    func toggleStar(_ id: UUID) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        let starred = !messages[index].isStarred
        messages[index].isStarred = starred
        guard let mail = services?.mail else { return }
        Task {
            do {
                try await mail.setStarred(id, starred)
            } catch {
                if error as? EdgeError == .unavailable { return }
                if let index = messages.firstIndex(where: { $0.id == id }) { messages[index].isStarred = !starred }
                errorMessage = "별표를 바꾸지 못했어요."
            }
        }
    }

    func compose() {
        panel = .compose(MailDraft(id: UUID(), to: "", subject: "", body: ""))
    }

    /// "할 일에 추가": saves the suggested todo (due today at 18:00) to the todo list.
    func addSuggestedTodo(from id: UUID) async {
        guard let message = message(id), let title = message.suggestedTodo else { return }
        let calendar = Calendar.current
        let due = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: .now) ?? .now
        do {
            _ = try await todoModel.addTodo(NewTodoDraft(title: title, dueAt: due, category: nil), source: .mailSuggestion)
            addedTodoMessageIDs.insert(id)
        } catch {
            errorMessage = "할 일에 추가하지 못했어요."
        }
    }

    func updateReplyDraft(_ id: UUID, to text: String) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[index].replyDraft = text
    }

    /// Full reply text shown in review: greeting, the AI draft, and a sign-off.
    func replyBody(for message: MailMessage) -> String {
        message.replyDraft ?? ""
    }

    /// Saves (if needed) and sends a draft the user approved. Returns it for the "메일을
    /// 보냈습니다" dialog, or nil after a failure (kept in `errorMessage`).
    func send(_ draft: MailDraft) async -> MailDraft? {
        isSending = true
        defer { isSending = false }
        do {
            if let mail = services?.mail {
                let stored = try await store(draft, with: mail)
                try await mail.sendDraft(stored.id)
            }
            drafts.removeAll { $0.id == draft.id }
            panel = .empty
            errorMessage = nil
            return draft
        } catch {
            errorMessage = sendError(error, fallback: "메일을 보내지 못했어요.")
            return nil
        }
    }

    func sendReply(to id: UUID) async -> MailDraft? {
        guard let message = message(id) else { return nil }
        return await send(MailDraft(id: UUID(), to: message.sender.email, subject: "Re: \(message.subject)",
                                    body: replyBody(for: message), replyTo: id))
    }

    func saveDraft(_ draft: MailDraft) async -> MailDraft? {
        isSending = true
        defer { isSending = false }
        do {
            var saved = draft
            if let mail = services?.mail { saved = try await store(draft, with: mail) }
            saved.savedAt = .now
            drafts.removeAll { $0.id == draft.id || $0.id == saved.id }
            drafts.insert(saved, at: 0)
            panel = .empty
            errorMessage = nil
            return saved
        } catch {
            errorMessage = sendError(error, fallback: "초안을 저장하지 못했어요.")
            return nil
        }
    }

    private func store(_ draft: MailDraft, with mail: MailService) async throws -> MailDraft {
        draft.isStored ? try await mail.updateDraft(draft) : try await mail.createDraft(draft)
    }

    private func sendError(_ error: Error, fallback: String) -> String {
        if case EdgeError.server(_, let message) = error { return message }
        if error as? EdgeError == .unavailable { return "메일 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요." }
        return fallback
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

    // MARK: - Formatting

    /// "2026년 9월 16일 (4일 전)"
    static func longDate(_ date: Date, now: Date = .now) -> String {
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: date), to: Calendar.current.startOfDay(for: now)).day ?? 0
        let relative = days == 0 ? "오늘" : days == 1 ? "어제" : "\(days)일 전"
        return "\(TodoTabModel.format(date, "yyyy년 M월 d일")) (\(relative))"
    }

    /// "08:18" today, "9월 16일" otherwise.
    static func listTime(_ date: Date) -> String {
        Calendar.current.isDateInToday(date) ? TodoTabModel.format(date, "HH:mm") : TodoTabModel.format(date, "M월 d일")
    }

    // MARK: - Mock

    private static func mockMessages(now: Date) -> [MailMessage] {
        let calendar = Calendar.current
        func at(_ dayOffset: Int, _ hour: Int, _ minute: Int) -> Date {
            let day = calendar.date(byAdding: .day, value: dayOffset, to: calendar.startOfDay(for: now)) ?? now
            return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
        }
        return [
            MailMessage(
                id: UUID(), sender: .init(name: "김지민", email: "jimin@example.com"),
                subject: "프로젝트 일정 변경 안내",
                body: "안녕하세요. 이번 주 디자인 리뷰가 목요일 오후 4시로 변경되었습니다.\n참석 가능 여부를 오늘 안에 알려주세요.",
                receivedAt: at(0, 8, 18), isStarred: true, category: "답장 대기",
                summary: [("디자인 리뷰", "목요일 16:00"), (nil, "오늘 안에 참석 여부 회신 필요")],
                suggestedTodo: "오늘 18:00까지 참석 여부 회신",
                replyDraft: "지민님, 안녕하세요.\n\n목요일 오후 4시 디자인 리뷰에 참석 가능합니다.\n변경된 일정 확인했습니다. 검토할 자료가 있다면 미리 공유 부탁드립니다.\n\n감사합니다."
            ),
            MailMessage(
                id: UUID(), sender: .init(name: "Korean Air", email: "news@koreanair.com"),
                subject: "대한항공과 아시아나항공의 마일리지 통합 방안 안내",
                body: "KOREAN AIR 대한항공과 아시아나항공의 마일리지 통합 방안 안내 - 2026년 12월 17일 대한항공・아시아나항공 통합일에 아시아나 마일리지는 스카이패스 계정으로 자동 이관됩니다.",
                receivedAt: at(0, 7, 2), isStarred: false, category: "참고용",
                summary: [("마일리지 통합", "12월 17일 스카이패스로 자동 이관"), (nil, "별도 조치 필요 없음")],
                suggestedTodo: nil, replyDraft: nil
            ),
            MailMessage(
                id: UUID(), sender: .init(name: "학생지원팀", email: "scholarship@korea.ac.kr"),
                subject: "[장학] 2학기 장학금 서류 제출 안내",
                body: "2학기 장학금 신청자는 금요일 오전 10시까지 서류를 PDF로 제출해 주세요. 기한 이후 제출분은 접수되지 않습니다.",
                receivedAt: at(-1, 17, 40), isStarred: false, category: "요청·승인",
                summary: [("마감", "금요일 10:00"), (nil, "서류는 PDF로 제출")],
                suggestedTodo: "장학금 서류 PDF 확인",
                replyDraft: "안녕하세요. 안내해 주신 서류를 기한 내 제출하겠습니다.\n\n감사합니다."
            ),
        ]
    }
}
