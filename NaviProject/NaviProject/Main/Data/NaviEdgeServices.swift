import Foundation
import Supabase

// Edge Function / assistant-table clients for the Notion "API 명세" EDGE rows (`mail`,
// `calendar`, `assistant`, `todo-ai`, `google-auth`). The functions aren't deployed yet, so
// every call can fail with `EdgeError.unavailable`; the tab models then fall back to sample
// data in DEBUG builds and show an error otherwise.
//
// Request/response field names follow the spec where it names them (`events[]` items,
// `summary / reply_suggestion / suggested_todos`, `{error:{code,message}}`). Where the spec is
// silent the DTOs use the DB Schema column names in snake_case and decode leniently.
//
// Ownership boundary: DTOs and their mapping stay in this file, and every public method returns
// the app's screen types (`MailMessage`, `DashboardEvent`, `ChatSession`, `PrepSuggestion`, …).
// Backend contract changes only touch `Main/Data/`; the tab models never see wire formats.

// MARK: - Client

enum EdgeError: LocalizedError, Equatable {
    /// 404 / relay error / no network: the function isn't deployed or reachable.
    case unavailable
    /// `{error:{code,message}}` from a deployed function.
    case server(code: String, message: String)

    var errorDescription: String? {
        switch self {
        case .unavailable: return "서버 기능이 아직 준비되지 않았어요."
        case .server(_, let message): return message
        }
    }
}

/// Thin wrapper over `client.functions` that adds Idempotency-Keys, RFC3339 dates, and
/// the spec's error envelope.
struct EdgeClient: Sendable {
    let client: SupabaseClient

    enum Method { case get, post, patch, delete }

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            if let date = EdgeClient.parseDate(string) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date \(string)")
        }
        return decoder
    }()

    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(EdgeClient.formatDate(date))
        }
        return encoder
    }()

    static func parseDate(_ string: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: string) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: string) { return date }
        let day = DateFormatter()
        day.calendar = Calendar(identifier: .gregorian)
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = .current
        day.dateFormat = "yyyy-MM-dd"
        return day.date(from: string)
    }

    static func formatDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = .current
        return formatter.string(from: date)
    }

    /// Calls `/functions/v1/<path>` and decodes the JSON body.
    func call<Response: Decodable>(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem] = [],
        body: (some Encodable)? = Optional<EmptyBody>.none,
        idempotent: Bool = false
    ) async throws -> Response {
        try await perform(method, path, query: query, body: body, idempotent: idempotent) { data in
            try Self.decoder.decode(Response.self, from: data)
        }
    }

    /// Calls `/functions/v1/<path>` and ignores the body (202 / 204 responses).
    func send(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem] = [],
        body: (some Encodable)? = Optional<EmptyBody>.none,
        idempotent: Bool = false
    ) async throws {
        try await perform(method, path, query: query, body: body, idempotent: idempotent) { _ in () }
    }

    struct EmptyBody: Encodable {}

    private func perform<Response>(
        _ method: Method,
        _ path: String,
        query: [URLQueryItem],
        body: (some Encodable)?,
        idempotent: Bool,
        decode: (Data) throws -> Response
    ) async throws -> Response {
        let functionMethod: FunctionInvokeOptions.Method = switch method {
        case .get: .get
        case .post: .post
        case .patch: .patch
        case .delete: .delete
        }
        // Each user action gets one key; a retried request of the same action would reuse it.
        let headers = idempotent ? ["Idempotency-Key": UUID().uuidString] : [:]
        let options: FunctionInvokeOptions
        if let body {
            options = FunctionInvokeOptions(method: functionMethod, query: query, headers: headers,
                                            body: body, encoder: Self.encoder)
        } else {
            options = FunctionInvokeOptions(method: functionMethod, query: query, headers: headers)
        }
        do {
            return try await client.functions.invoke(path, options: options) { data, _ in try decode(data) }
        } catch let error as FunctionsError {
            throw Self.map(error)
        } catch is URLError {
            throw EdgeError.unavailable
        }
    }

    static func map(_ error: FunctionsError) -> Error {
        switch error {
        case .relayError:
            return EdgeError.unavailable
        case .httpError(let code, let data):
            struct Envelope: Decodable {
                struct Body: Decodable {
                    let code: String
                    let message: String
                }
                let error: Body
            }
            if let envelope = try? decoder.decode(Envelope.self, from: data) {
                return EdgeError.server(code: envelope.error.code, message: envelope.error.message)
            }
            // A 404 without the envelope means the function (or route) isn't deployed.
            return code == 404 ? EdgeError.unavailable : EdgeError.server(code: "HTTP_\(code)", message: "요청을 처리하지 못했어요. (\(code))")
        @unknown default:
            return EdgeError.unavailable
        }
    }
}

extension AppSessionStore {
    /// Edge / assistant services for the signed-in user, or `nil` without a session (the tabs
    /// then show sample data).
    func makeEdgeServices() -> EdgeServices? {
        guard let client, let userID = session?.user.id else { return nil }
        let edge = EdgeClient(client: client)
        return EdgeServices(
            mail: MailService(edge: edge),
            calendar: CalendarService(edge: edge, client: client),
            assistant: AssistantService(edge: edge, client: client, userID: userID),
            todoAI: TodoAIService(edge: edge),
            googleAuth: GoogleAuthService(edge: edge)
        )
    }
}

struct EdgeServices: Sendable {
    let mail: MailService
    let calendar: CalendarService
    let assistant: AssistantService
    let todoAI: TodoAIService
    let googleAuth: GoogleAuthService
}

// MARK: - Shared DTOs

struct CategoryDTO: Decodable, Sendable {
    let id: UUID
    let name: String
    let color: String

    var category: NaviCategory { NaviCategory(id: id, name: name, color: color) }
}

/// Decodes either `["a", "b"]` or `"a\nb"` as lines.
struct FlexibleLines: Decodable, Sendable {
    let lines: [String]

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let array = try? container.decode([String].self) {
            lines = array
        } else {
            lines = (try container.decode(String.self))
                .components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        }
    }
}

// MARK: - Mail

/// `mail` Edge Function: Gmail list/detail/summary/star/read, labels, drafts, and briefing.
struct MailService: Sendable {
    let edge: EdgeClient

    struct PersonDTO: Decodable, Sendable {
        let name: String?
        let email: String
    }

    struct MessageDTO: Decodable, Sendable {
        let id: UUID
        let from: PersonDTO
        let subject: String?
        let snippet: String?
        let bodyText: String?
        let receivedAt: Date
        let starred: Bool?
        let labelIds: [String]?

        enum CodingKeys: String, CodingKey {
            case id, from, subject, snippet, starred
            case bodyText = "body_text"
            case receivedAt = "received_at"
            case labelIds = "label_ids"
        }
    }

    struct LabelDTO: Decodable, Sendable {
        let id: String
        let name: String
    }

    struct SummaryDTO: Decodable, Sendable {
        struct SuggestedTodo: Decodable, Sendable {
            let title: String
            let dueAt: Date?

            enum CodingKeys: String, CodingKey {
                case title
                case dueAt = "due_at"
            }
        }

        let summary: FlexibleLines
        let replySuggestion: String?
        let suggestedTodos: [SuggestedTodo]?

        enum CodingKeys: String, CodingKey {
            case summary
            case replySuggestion = "reply_suggestion"
            case suggestedTodos = "suggested_todos"
        }
    }

    struct DraftDTO: Decodable, Sendable {
        let id: UUID
        let to: [String]?
        let subject: String?
        let body: String?
        let replyToMessageId: UUID?
        let updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, to, subject, body
            case replyToMessageId = "reply_to_message_id"
            case updatedAt = "updated_at"
        }

        var draft: MailDraft {
            MailDraft(id: id, to: (to ?? []).joined(separator: ", "), subject: subject ?? "", body: body ?? "",
                      replyTo: replyToMessageId, savedAt: updatedAt ?? .now, isStored: true)
        }
    }

    struct DraftBody: Encodable, Sendable {
        let to: [String]
        let subject: String
        let body: String
        let replyToMessageId: UUID?

        init(_ draft: MailDraft) {
            to = draft.to.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            subject = draft.subject
            body = draft.body
            replyToMessageId = draft.replyTo
        }

        enum CodingKeys: String, CodingKey {
            case to, subject, body
            case replyToMessageId = "reply_to_message_id"
        }
    }

    /// Screen-ready AI summary of one message.
    struct Insight: Sendable {
        var summary: [(lead: String?, text: String)]
        var suggestedTodo: String?
        var replyDraft: String?
    }

    /// The inbox, newest first, with Gmail label names as categories. A labels failure only
    /// drops the categories.
    func inbox() async throws -> [MailMessage] {
        async let labelsRequest = labels()
        let rows = try await messages()
        let labels = Dictionary(((try? await labelsRequest) ?? []).map { ($0.id, $0.name) },
                                uniquingKeysWith: { first, _ in first })
        return rows.map { Self.message(from: $0, labels: labels) }
    }

    /// Full body text (`GET /mail/messages/:id`).
    func body(of id: UUID) async throws -> String? {
        let row = try await message(id)
        return row.bodyText ?? row.snippet
    }

    /// Cached AI summary, reply suggestion, and first suggested todo.
    func insight(for id: UUID) async throws -> Insight {
        let dto = try await summary(id)
        return Insight(
            summary: dto.summary.lines.map(Self.summaryLine),
            suggestedTodo: dto.suggestedTodos?.first?.title,
            replyDraft: dto.replySuggestion
        )
    }

    /// Dashboard "중요 메일" from today's briefing.
    func importantMails(on date: Date) async throws -> [DashboardMail] {
        try await briefing(on: date).map { row in
            DashboardMail(id: row.id, sender: row.from.name ?? row.from.email, subject: row.subject ?? "(제목 없음)",
                          snippet: row.snippet ?? "", receivedAt: row.receivedAt)
        }
    }

    static func message(from row: MessageDTO, labels: [String: String]) -> MailMessage {
        MailMessage(
            id: row.id,
            sender: .init(name: row.from.name ?? "", email: row.from.email),
            subject: row.subject ?? "(제목 없음)",
            body: row.bodyText ?? row.snippet ?? "",
            receivedAt: row.receivedAt,
            isStarred: row.starred ?? false,
            category: row.labelIds?.lazy.compactMap { labels[$0] }.first,
            summary: [],
            suggestedTodo: nil,
            replyDraft: nil
        )
    }

    /// "디자인 리뷰: 목요일 16:00" → bold lead + detail.
    static func summaryLine(_ line: String) -> (lead: String?, text: String) {
        let trimmed = line.hasPrefix("- ") || line.hasPrefix("• ") ? String(line.dropFirst(2)) : line
        let parts = trimmed.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
        if parts.count == 2, !parts[0].isEmpty, parts[0].count <= 12, !parts[1].isEmpty { return (parts[0], parts[1]) }
        return (nil, trimmed)
    }

    // MARK: Wire calls

    /// `GET /mail/messages?filter=` (all / starred / label).
    private func messages(filter: String = "all", labelID: String? = nil, query: String? = nil) async throws -> [MessageDTO] {
        struct Response: Decodable { let messages: [MessageDTO] }
        var items = [URLQueryItem(name: "filter", value: filter)]
        if let labelID { items.append(URLQueryItem(name: "label_id", value: labelID)) }
        if let query, !query.isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        let response: Response = try await edge.call(.get, "mail/messages", query: items)
        return response.messages
    }

    /// `GET /mail/messages/:id` (body + attachment metadata; doesn't mark as read).
    private func message(_ id: UUID) async throws -> MessageDTO {
        try await edge.call(.get, "mail/messages/\(id.uuidString.lowercased())")
    }

    /// `GET /mail/messages/:id/summary` (cached summary, reply suggestion, suggested todos).
    private func summary(_ id: UUID) async throws -> SummaryDTO {
        try await edge.call(.get, "mail/messages/\(id.uuidString.lowercased())/summary")
    }

    /// `PATCH /mail/messages/:id/star-state {starred}`.
    func setStarred(_ id: UUID, _ starred: Bool) async throws {
        struct Body: Encodable { let starred: Bool }
        try await edge.send(.patch, "mail/messages/\(id.uuidString.lowercased())/star-state", body: Body(starred: starred))
    }

    /// `PATCH /mail/messages/:id/read-state {read}`.
    func setRead(_ id: UUID, _ read: Bool) async throws {
        struct Body: Encodable { let read: Bool }
        try await edge.send(.patch, "mail/messages/\(id.uuidString.lowercased())/read-state", body: Body(read: read))
    }

    /// `GET /mail/labels` (the category tabs).
    private func labels() async throws -> [LabelDTO] {
        struct Response: Decodable { let labels: [LabelDTO] }
        let response: Response = try await edge.call(.get, "mail/labels")
        return response.labels
    }

    /// `GET /mail/briefing?date=` flattened to its messages.
    private func briefing(on date: Date) async throws -> [MessageDTO] {
        struct Response: Decodable {
            struct Category: Decodable { let messages: [MessageDTO] }
            let categories: [Category]
        }
        let day = TodoTabModel.format(date, "yyyy-MM-dd")
        let response: Response = try await edge.call(.get, "mail/briefing", query: [URLQueryItem(name: "date", value: day)])
        return response.categories.flatMap(\.messages)
    }

    /// `GET /mail/drafts`.
    func drafts() async throws -> [MailDraft] {
        struct Response: Decodable { let drafts: [DraftDTO] }
        let response: Response = try await edge.call(.get, "mail/drafts")
        return response.drafts.map(\.draft)
    }

    /// `POST /mail/drafts` (Idempotency-Key `mail.draft.create` / `mail.draft.reply.create`).
    func createDraft(_ draft: MailDraft) async throws -> MailDraft {
        let dto: DraftDTO = try await edge.call(.post, "mail/drafts", body: DraftBody(draft), idempotent: true)
        return dto.draft
    }

    /// `PATCH /mail/drafts/:id` (Idempotency-Key `mail.draft.update`).
    func updateDraft(_ draft: MailDraft) async throws -> MailDraft {
        let dto: DraftDTO = try await edge.call(.patch, "mail/drafts/\(draft.id.uuidString.lowercased())",
                                                body: DraftBody(draft), idempotent: true)
        return dto.draft
    }

    /// `POST /mail/drafts/:id/send` (Idempotency-Key `mail.draft.send`), after the user approved it.
    func sendDraft(_ id: UUID) async throws {
        try await edge.send(.post, "mail/drafts/\(id.uuidString.lowercased())/send", idempotent: true)
    }
}

// MARK: - Calendar

/// `calendar` Edge Function (Google Calendar through the cache) and the `set_event_category` RPC.
struct CalendarService: Sendable {
    let edge: EdgeClient
    let client: SupabaseClient

    /// `events[]` item: internal UUID, RFC3339 times, optional category (no Google IDs).
    struct EventDTO: Decodable, Sendable {
        let id: UUID
        let title: String
        let startAt: Date
        let endAt: Date
        let allDay: Bool?
        let category: CategoryDTO?
        let location: String?

        enum CodingKeys: String, CodingKey {
            case id, title, category, location
            case startAt = "start_at"
            case endAt = "end_at"
            case allDay = "all_day"
        }

        var event: DashboardEvent {
            DashboardEvent(id: id, title: title, startAt: startAt, endAt: endAt, isAllDay: allDay ?? false,
                           category: category?.category, location: location?.isEmpty == false ? location : nil)
        }
    }

    struct EventBody: Encodable, Sendable {
        let title: String
        let startAt: Date
        let endAt: Date
        let allDay = false
        let location: String?
        let categoryId: UUID?

        init(_ draft: NewEventDraft) {
            title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            startAt = draft.startAt
            endAt = draft.endAt
            let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
            self.location = location.isEmpty ? nil : location
            categoryId = draft.category?.id
        }

        enum CodingKeys: String, CodingKey {
            case title, location
            case startAt = "start_at"
            case endAt = "end_at"
            case allDay = "all_day"
            case categoryId = "category_id"
        }
    }

    /// Accepts both `{event: {...}}` and a bare event.
    private struct EventEnvelope: Decodable {
        let event: EventDTO

        init(from decoder: Decoder) throws {
            enum Keys: String, CodingKey { case event }
            if let container = try? decoder.container(keyedBy: Keys.self),
               let event = try? container.decode(EventDTO.self, forKey: .event) {
                self.event = event
            } else {
                event = try EventDTO(from: decoder)
            }
        }
    }

    private struct EventsResponse: Decodable { let events: [EventDTO] }

    /// `GET /calendar/events?start=&end=`.
    func events(from start: Date, to end: Date) async throws -> [DashboardEvent] {
        let response: EventsResponse = try await edge.call(.get, "calendar/events", query: [
            URLQueryItem(name: "start", value: EdgeClient.formatDate(start)),
            URLQueryItem(name: "end", value: EdgeClient.formatDate(end)),
        ])
        return response.events.map(\.event)
    }

    /// `GET /calendar/briefing/today` (visible categories only, in time order).
    func todayBriefing() async throws -> [DashboardEvent] {
        let response: EventsResponse = try await edge.call(.get, "calendar/briefing/today")
        return response.events.map(\.event)
    }

    /// `POST /calendar/events` (Idempotency-Key `calendar.event.create`).
    func create(_ draft: NewEventDraft) async throws -> DashboardEvent {
        let response: EventEnvelope = try await edge.call(.post, "calendar/events", body: EventBody(draft), idempotent: true)
        return response.event.event
    }

    /// `PATCH /calendar/events/:id` (Idempotency-Key `calendar.event.update`) for Google fields;
    /// a category-only change goes through `set_event_category` without touching Google.
    func update(_ id: UUID, from old: DashboardEvent, to draft: NewEventDraft) async throws -> DashboardEvent {
        let location = draft.location.trimmingCharacters(in: .whitespacesAndNewlines)
        let googleFieldsChanged = old.title != draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
            || old.startAt != draft.startAt || old.endAt != draft.endAt || (old.location ?? "") != location
        var event = old
        if googleFieldsChanged {
            let response: EventEnvelope = try await edge.call(.patch, "calendar/events/\(id.uuidString.lowercased())",
                                                              body: EventBody(draft), idempotent: true)
            event = response.event.event
        }
        if old.category?.id != draft.category?.id {
            try await setCategory(of: id, to: draft.category?.id)
            event.category = draft.category
        }
        return event
    }

    /// RPC `set_event_category(event_id, category_id)`; nil clears the category.
    func setCategory(of eventID: UUID, to categoryID: UUID?) async throws {
        struct Params: Encodable, Sendable {
            let event_id: UUID
            let category_id: UUID?
        }
        try await client.rpc("set_event_category", params: Params(event_id: eventID, category_id: categoryID)).execute()
    }
}

// MARK: - Assistant

/// Chat sessions (`assistant_conversations` / `assistant_messages` TABLE + Realtime) and the
/// `assistant` Edge Function (messages, floating/prompt commands).
struct AssistantService: Sendable {
    let edge: EdgeClient
    let client: SupabaseClient
    let userID: UUID

    struct ConversationRow: Decodable, Sendable {
        let id: UUID
        let title: String?
        let lastMessageAt: Date?
        let createdAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, title
            case lastMessageAt = "last_message_at"
            case createdAt = "created_at"
        }
    }

    struct MessageRow: Decodable, Sendable {
        let id: UUID
        let conversationId: UUID
        let role: String
        let content: String
        let createdAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, role, content
            case conversationId = "conversation_id"
            case createdAt = "created_at"
        }
    }

    /// A missing table (`PGRST205` / `42P01`) means the assistant schema isn't deployed yet.
    private func table<T>(_ work: () async throws -> T) async throws -> T {
        do {
            return try await work()
        } catch let error as PostgrestError where ["PGRST205", "42P01"].contains(error.code ?? "") {
            throw EdgeError.unavailable
        } catch is URLError {
            throw EdgeError.unavailable
        }
    }

    /// A new `assistant_messages` row, as the chat screen shows it.
    struct Insert: Sendable {
        let conversationID: UUID
        let message: ChatMessage
        let createdAt: Date?
    }

    /// Recent sessions, newest first (messages load separately).
    func sessions() async throws -> [ChatSession] {
        try await conversations().map { row in
            ChatSession(id: row.id, title: row.title ?? "새 대화",
                        updatedAt: row.lastMessageAt ?? row.createdAt ?? .now,
                        messages: [], isStored: true, hasLoadedMessages: false)
        }
    }

    func chatMessages(in conversationID: UUID) async throws -> [ChatMessage] {
        try await messages(in: conversationID).map(Self.chatMessage(from:))
    }

    /// First line is navi's bold lead; the rest become the numbered lines.
    static func chatMessage(from row: MessageRow) -> ChatMessage {
        guard row.role != "user" else { return ChatMessage(id: row.id, role: .user, text: row.content) }
        var lines = row.content.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let lead = lines.isEmpty ? row.content : lines.removeFirst()
        let items = lines.map { $0.replacingOccurrences(of: #"^\d+\.\s*"#, with: "", options: .regularExpression) }
        return ChatMessage(id: row.id, role: .navi, text: lead, items: items)
    }

    // MARK: Wire calls

    private func conversations() async throws -> [ConversationRow] {
        try await table { try await client
            .from("assistant_conversations")
            .select("id, title, last_message_at, created_at")
            .order("last_message_at", ascending: false, nullsFirst: false)
            .limit(50)
            .execute()
            .value
        }
    }

    private func messages(in conversationID: UUID) async throws -> [MessageRow] {
        try await table { try await client
            .from("assistant_messages")
            .select("id, conversation_id, role, content, created_at")
            .eq("conversation_id", value: conversationID.uuidString)
            .order("created_at", ascending: true)
            .limit(200)
            .execute()
            .value
        }
    }

    /// TABLE insert with the app-generated id (UUID conflicts stop duplicates).
    func createConversation(_ id: UUID) async throws {
        struct Row: Encodable, Sendable {
            let id: UUID
            let user_id: UUID
        }
        _ = try await table { try await client.from("assistant_conversations").insert(Row(id: id, user_id: userID)).execute() }
    }

    /// `POST /assistant/conversations/:id/messages` (Idempotency-Key `assistant.message.create`).
    /// Returns 202; the reply arrives as an `assistant_messages` insert.
    func send(_ text: String, in conversationID: UUID) async throws {
        struct Body: Encodable { let content: String }
        try await edge.send(.post, "assistant/conversations/\(conversationID.uuidString.lowercased())/messages",
                            body: Body(content: text), idempotent: true)
    }

    /// `POST /assistant/command` from a tab's prompt input. Returns 202; results arrive on
    /// `assistant_commands`.
    func command(_ text: String) async throws {
        struct Body: Encodable { let text: String }
        try await edge.send(.post, "assistant/command", body: Body(text: text), idempotent: true)
    }

    /// Streams new messages of one conversation until the task is cancelled.
    func messageInserts(in conversationID: UUID) -> AsyncStream<Insert> {
        AsyncStream { continuation in
            let task = Task {
                let channel = client.channel("assistant-messages-\(conversationID.uuidString.lowercased())")
                let inserts = channel.postgresChange(
                    InsertAction.self,
                    schema: "public",
                    table: "assistant_messages",
                    filter: .eq("conversation_id", value: conversationID.uuidString.lowercased())
                )
                do {
                    try await channel.subscribeWithError()
                } catch {
                    continuation.finish()
                    return
                }
                for await insert in inserts {
                    if let row = try? insert.decodeRecord(as: MessageRow.self, decoder: EdgeClient.decoder) {
                        continuation.yield(Insert(conversationID: row.conversationId,
                                                  message: Self.chatMessage(from: row), createdAt: row.createdAt))
                    }
                }
                await client.removeChannel(channel)
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

// MARK: - Todo AI

/// `todo-ai` Edge Function. Suggestions aren't stored; approved ones become `todos` rows.
struct TodoAIService: Sendable {
    let edge: EdgeClient

    struct SuggestionDTO: Decodable, Sendable {
        let title: String
        let dueAt: Date?
        let reason: String?
        let effort: String?
        let categoryId: UUID?
        let isUrgent: Bool?

        enum CodingKeys: String, CodingKey {
            case title, reason, effort
            case dueAt = "due_at"
            case categoryId = "category_id"
            case isUrgent = "is_urgent"
        }

        func suggestion(categories: [NaviCategory], fallbackDue: Date) -> PrepSuggestion {
            PrepSuggestion(
                id: UUID(), title: title, dueAt: dueAt ?? fallbackDue,
                category: categories.first { $0.id == categoryId },
                reason: reason ?? "", effort: effort ?? "", isUrgent: isUrgent ?? false
            )
        }
    }

    struct Criteria: Encodable, Sendable {
        var mail = true
        var incompleteTodos = true
        var relatedTodos = true
        var userPattern = true

        enum CodingKeys: String, CodingKey {
            case mail
            case incompleteTodos = "incomplete_todos"
            case relatedTodos = "related_todos"
            case userPattern = "user_pattern"
        }
    }

    /// Suggestions for the prep panels. `criteria` is the calendar tab's "추천 기준" (all on
    /// when nil); categories resolve `category_id`, and `fallbackDue` fills a missing `due_at`.
    func suggestions(
        week: String = "current",
        criteria: CalendarTabModel.PrepCriteria? = nil,
        categories: [NaviCategory],
        fallbackDue: Date
    ) async throws -> [PrepSuggestion] {
        let body = criteria.map {
            Criteria(mail: $0.mail, incompleteTodos: $0.incompleteTodos, relatedTodos: $0.relatedTodos, userPattern: $0.userPattern)
        }
        return try await suggest(week: week, criteria: body)
            .map { $0.suggestion(categories: categories, fallbackDue: fallbackDue) }
    }

    /// `POST /todo-ai/todos/suggest` for this week (`next` on Sundays is optional).
    private func suggest(week: String, criteria: Criteria?) async throws -> [SuggestionDTO] {
        let criteria = criteria ?? Criteria()
        struct Body: Encodable {
            let week: String
            let criteria: Criteria
        }
        struct Response: Decodable { let suggestions: [SuggestionDTO] }
        let response: Response = try await edge.call(.post, "todo-ai/todos/suggest", body: Body(week: week, criteria: criteria))
        return response.suggestions
    }
}

// MARK: - Google

/// `google-auth` Edge Function.
struct GoogleAuthService: Sendable {
    let edge: EdgeClient

    /// `DELETE /google-auth/disconnect` (Idempotency-Key `google.disconnect`). Returns 202;
    /// the worker syncs every cache first so data stays as of the last sync.
    func disconnect() async throws {
        try await edge.send(.delete, "google-auth/disconnect", idempotent: true)
    }
}
