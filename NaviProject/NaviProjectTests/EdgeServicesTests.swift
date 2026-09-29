import Foundation
import Functions
import Testing
@testable import NaviProject

/// Decoding and error mapping of the Edge Function clients (no network).
struct EdgeServicesTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try EdgeClient.decoder.decode(T.self, from: Data(json.utf8))
    }

    @Test func eventDecodesSpecShape() throws {
        let event = try decode(CalendarService.EventDTO.self, """
        {"id":"6F9619FF-8B86-D011-B42D-00C04FC964FF","title":"팀 스탠드업",
         "start_at":"2026-09-27T09:00:00.000+09:00","end_at":"2026-09-27T10:00:00+09:00",
         "all_day":false,"category":{"id":"7F9619FF-8B86-D011-B42D-00C04FC964FF","name":"navi","color":"#7165FF"}}
        """).event
        #expect(event.title == "팀 스탠드업")
        #expect(event.endAt.timeIntervalSince(event.startAt) == 3600)
        #expect(event.category?.name == "navi")
        #expect(event.location == nil)
    }

    @Test func summaryAcceptsListOrText() throws {
        let list = try decode(MailService.SummaryDTO.self, """
        {"summary":["디자인 리뷰: 목요일 16:00","오늘 안에 회신 필요"],"reply_suggestion":"참석 가능합니다.",
         "suggested_todos":[{"title":"참석 여부 회신","due_at":"2026-09-27T18:00:00+09:00"}]}
        """)
        #expect(list.summary.lines.count == 2)
        #expect(list.suggestedTodos?.first?.title == "참석 여부 회신")

        let text = try decode(MailService.SummaryDTO.self, #"{"summary":"첫 줄\n\n둘째 줄"}"#)
        #expect(text.summary.lines == ["첫 줄", "둘째 줄"])
        #expect(text.replySuggestion == nil)
    }

    @Test func errorEnvelopeAndMissingFunction() throws {
        let envelope = Data(#"{"error":{"code":"GOOGLE_NOT_CONNECTED","message":"Google 연결이 필요해요."}}"#.utf8)
        #expect(EdgeClient.map(.httpError(code: 409, data: envelope)) as? EdgeError
            == .server(code: "GOOGLE_NOT_CONNECTED", message: "Google 연결이 필요해요."))
        #expect(EdgeClient.map(.httpError(code: 404, data: Data("Function not found".utf8))) as? EdgeError == .unavailable)
        #expect(EdgeClient.map(.relayError) as? EdgeError == .unavailable)
        if case .server(let code, _)? = EdgeClient.map(.httpError(code: 500, data: Data())) as? EdgeError {
            #expect(code == "HTTP_500")
        } else {
            Issue.record("a 500 without the envelope is a server error")
        }
    }

    @Test func draftBodySplitsRecipients() throws {
        let body = MailService.DraftBody(MailDraft(id: UUID(), to: "a@x.com, b@y.com ,", subject: "s", body: "b"))
        #expect(body.to == ["a@x.com", "b@y.com"])
        let json = try JSONSerialization.jsonObject(with: EdgeClient.encoder.encode(body)) as? [String: Any]
        #expect(json?["reply_to_message_id"] == nil || json?["reply_to_message_id"] is NSNull)
    }

    @Test @MainActor func wireRowsBecomeScreenTypes() throws {
        let line = MailService.summaryLine("- 디자인 리뷰: 목요일 16:00")
        #expect(line.lead == "디자인 리뷰" && line.text == "목요일 16:00")
        #expect(MailService.summaryLine("오늘 안에 회신 필요").lead == nil)

        let row = try decode(MailService.MessageDTO.self, """
        {"id":"6F9619FF-8B86-D011-B42D-00C04FC964FF","from":{"name":"김지민","email":"jimin@example.com"},
         "subject":"프로젝트 일정 변경 안내","snippet":"안녕하세요.","received_at":"2026-09-27T08:18:00+09:00",
         "starred":true,"label_ids":["INBOX","Label_1"]}
        """)
        let message = MailService.message(from: row, labels: ["Label_1": "답장 대기"])
        #expect(message.sender.display == "김지민 <jimin@example.com>")
        #expect(message.category == "답장 대기" && message.isStarred)

        let reply = try decode(AssistantService.MessageRow.self, """
        {"id":"6F9619FF-8B86-D011-B42D-00C04FC964FF","conversation_id":"7F9619FF-8B86-D011-B42D-00C04FC964FF",
         "role":"assistant","content":"오늘은 다음 순서로 진행하는 것을 추천해요.\\n1. 12:00 전 — 질문 정리\\n2. 여유 시간 — 서류 준비"}
        """)
        let chat = AssistantService.chatMessage(from: reply)
        #expect(chat.role == .navi && chat.text == "오늘은 다음 순서로 진행하는 것을 추천해요.")
        #expect(chat.items == ["12:00 전 — 질문 정리", "여유 시간 — 서류 준비"])
    }

    @Test @MainActor func chatPlanLineBecomesTimedTodo() {
        let now = Calendar.current.date(bySettingHour: 8, minute: 0, second: 0, of: .now)!
        let (title, due) = ChatTabModel.parsePlanLine("16:30 전 — 디자인 리뷰 반영", now: now)
        #expect(title == "디자인 리뷰 반영")
        #expect(Calendar.current.dateComponents([.hour, .minute], from: due) == DateComponents(hour: 16, minute: 30))
        let (free, freeDue) = ChatTabModel.parsePlanLine("여유 시간 — 인턴십 서류 준비", now: now)
        #expect(free == "인턴십 서류 준비")
        #expect(Calendar.current.component(.hour, from: freeDue) == 18)
    }
}
