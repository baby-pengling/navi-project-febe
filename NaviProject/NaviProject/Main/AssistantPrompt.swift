import Combine
import SwiftUI

/// The prompt bars on the dashboard, mail, calendar, and todo tabs. A prompt goes to
/// `assistant/command`; navi's answer (or the failure) shows in a card above the bar until it's
/// closed. One model is shared by every tab, so a running request keeps going when switching tabs.
@MainActor
final class AssistantPromptModel: ObservableObject {
    enum State: Equatable {
        case running(prompt: String)
        case finished(AssistantService.CommandResult)
        case failed(message: String)
    }

    @Published private(set) var state: State?

    private let assistant: AssistantService?
    /// Runs after Claude changed something (e.g. created todos) so the tabs reload.
    private let onChange: @MainActor () async -> Void
    private var task: Task<Void, Never>?

    init(assistant: AssistantService?, onChange: @escaping @MainActor () async -> Void = {}) {
        self.assistant = assistant
        self.onChange = onChange
    }

    func send(_ text: String, context: AssistantService.Attachment? = nil) {
        guard let assistant else {
            state = .failed(message: "로그인 후 navi에게 요청할 수 있어요.")
            return
        }
        task?.cancel()
        state = .running(prompt: text)
        task = Task {
            do {
                let id = try await assistant.command(text, context: context)
                let result = try await assistant.commandResult(id)
                guard !Task.isCancelled else { return }
                if case .failed(let code) = result.status {
                    state = .failed(message: Self.message(for: code))
                    return
                }
                state = .finished(result)
                if !result.tools.isEmpty { await onChange() }
            } catch is CancellationError {
            } catch {
                guard !Task.isCancelled else { return }
                state = .failed(message: (error as? EdgeError)?.errorDescription ?? "요청을 보내지 못했어요.")
            }
        }
    }

    func dismiss() {
        task?.cancel()
        task = nil
        state = nil
    }

    /// `assistant_commands.error_code` → what the card says.
    static func message(for code: String?) -> String {
        switch code {
        case "LLM_NOT_CONFIGURED": return "AI 설정(API 키)을 확인해 주세요."
        case "LLM_BUSY": return "AI 응답이 지연되고 있어요. 잠시 후 다시 시도해 주세요."
        case "GOOGLE_NOT_CONNECTED": return "Google 계정을 연결하면 메일·일정 작업도 도와드릴게요."
        default: return "죄송해요, 지금은 처리하지 못했어요. 잠시 후 다시 시도해 주세요."
        }
    }
}

/// A tab's prompt bar with navi's answer card above it.
struct NaviAssistantPrompt: View {
    @EnvironmentObject private var model: AssistantPromptModel
    let prompt: String
    /// The row the prompt is about (the open mail), sent as `context`.
    var context: AssistantService.Attachment?
    @State private var text = ""

    var body: some View {
        VStack(spacing: 8) {
            if let state = model.state {
                AssistantResultCard(state: state, onClose: model.dismiss)
                    .transition(.opacity)
            }
            NaviPromptInput(prompt: prompt, text: $text) { model.send($0, context: context) }
        }
        .animation(.easeInOut(duration: 0.15), value: model.state)
    }
}

private struct AssistantResultCard: View {
    let state: AssistantPromptModel.State
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("navi")
                    .font(NaviFont.body(12, weight: .bold))
                    .foregroundStyle(NaviTheme.purple)
                Spacer()
                NaviCloseButton(action: onClose)
            }
            ViewThatFits(in: .vertical) {
                content
                ScrollView { content }
            }
            .frame(maxHeight: 220)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .running(let prompt):
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("“\(prompt)” 처리하고 있어요")
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.grayText)
                    .lineLimit(2)
            }
        case .finished(let result):
            answer(result)
        case .failed(let message):
            Text(message)
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.red)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func answer(_ result: AssistantService.CommandResult) -> some View {
        let lines = result.text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return VStack(alignment: .leading, spacing: 6) {
            if let lead = lines.first {
                Text(lead)
                    .font(NaviFont.body(13, weight: .bold))
                    .foregroundStyle(NaviTheme.ink)
            }
            ForEach(Array(lines.dropFirst().enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
            }
            ForEach(notes(for: result.tools), id: \.self) { note in
                Text(note)
                    .font(NaviFont.body(11, weight: .medium))
                    .foregroundStyle(NaviTheme.purple)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// What happened outside this card, per tool Claude ran.
    private func notes(for tools: [String]) -> [String] {
        var notes: [String] = []
        if tools.contains("create_todo") { notes.append("할 일 목록에 추가했어요.") }
        if tools.contains("create_mail_draft") { notes.append("메일 초안은 메일 탭 임시보관함에서 확인 후 보낼 수 있어요.") }
        if tools.contains("propose_calendar_event") { notes.append("일정 제안을 저장했어요. 승인 화면은 아직 준비 중이에요.") }
        return notes
    }
}
