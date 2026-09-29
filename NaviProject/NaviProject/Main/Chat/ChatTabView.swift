import SwiftUI

/// Figma "03 Final Prototype › 11 - 채팅": recent topic sessions on the left, the selected
/// conversation and the prompt input on the right.
struct ChatTabView: View {
    @ObservedObject var model: ChatTabModel

    @State private var input = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviTabHeader(title: "채팅", searchPrompt: "대화 검색", searchText: $model.searchText)

            HStack(alignment: .top, spacing: 10) {
                sessionList
                    .frame(width: 271)
                VStack(spacing: 10) {
                    conversation
                    NaviPromptInput(prompt: "무엇이든 물어보세요", text: $input) { text in
                        model.send(text)
                        input = ""
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(.bottom, 10)
        }
        .task { await model.load() }
    }

    // MARK: - Sessions

    private var sessionList: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Text("최근 대화")
                    .font(NaviFont.title(18))
                    .foregroundStyle(NaviTheme.dark)
                Circle().fill(NaviTheme.lime).frame(width: 6, height: 6)
                Text("대화는 주제별 세션으로 저장됩니다.")
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
            }

            Button(action: model.newChat) {
                HStack(spacing: 5) {
                    NaviIcon(name: "IconPlus")
                    Text("새 대화")
                        .font(NaviFont.body(12, weight: .bold))
                }
                .foregroundStyle(NaviTheme.cardWhite)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(NaviTheme.purple)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            ScrollView {
                VStack(spacing: 5) {
                    if model.visibleSessions.isEmpty {
                        Text("대화가 없어요.")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayText)
                            .padding(.top, 20)
                    }
                    ForEach(model.visibleSessions) { session in
                        ChatSessionRow(session: session, isSelected: session.id == model.selectedID) {
                            model.selectedID = session.id
                        }
                    }
                }
            }
            .scrollIndicators(.never)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 15)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: - Conversation

    private var conversation: some View {
        VStack(alignment: .leading, spacing: 15) {
            if let session = model.selectedSession {
                HStack(spacing: 15) {
                    Text(session.title)
                        .font(NaviFont.heading(18))
                        .foregroundStyle(NaviTheme.ink)
                    Circle().fill(NaviTheme.lime).frame(width: 6, height: 6)
                    Text(ChatTabModel.relativeTime(session.updatedAt))
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.grayText)
                }

                if session.messages.isEmpty {
                    emptyConversation
                } else {
                    messages(session)
                }
            } else {
                emptyConversation
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func messages(_ session: ChatSession) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                // Messages sit at the bottom of the panel, newest last, like the Figma frame.
                VStack(spacing: 15) {
                    ForEach(session.messages) { message in
                        switch message.role {
                        case .user:
                            UserBubble(text: message.text)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                        case .navi:
                            NaviAnswer(
                                message: message,
                                isAdded: model.addedMessageIDs.contains(message.id),
                                onAddTodos: { Task { await model.addTodos(from: message) } }
                            )
                            .frame(maxWidth: 547, alignment: .leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if model.respondingIDs.contains(session.id) {
                        Text("navi가 답변을 만들고 있어요…")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if let error = model.errorMessage {
                        Text(error)
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .frame(maxWidth: .infinity)
            }
            .defaultScrollAnchor(.bottom)
            .scrollIndicators(.never)
            .onChange(of: session.messages.count + model.respondingIDs.count) {
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    private var emptyConversation: some View {
        VStack(spacing: 15) {
            NaviMascotView(width: 120)
            Text("무엇을 도와드릴까요?")
                .font(NaviFont.heading(18))
                .foregroundStyle(NaviTheme.ink)
            Text("일정, 메일, 할 일을 참고해 답해 드려요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Pieces

/// Figma "Chat Item": title and relative time; lavender with a purple title when selected.
private struct ChatSessionRow: View {
    let session: ChatSession
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                Text(session.title)
                    .font(NaviFont.body(12, weight: .bold))
                    .foregroundStyle(isSelected ? NaviTheme.purple : NaviTheme.dark)
                    .lineLimit(1)
                Text(ChatTabModel.relativeTime(session.updatedAt))
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(isSelected ? NaviTheme.lavender : .clear)
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Figma "Chat Message / user": purple bubble, white text.
private struct UserBubble: View {
    let text: String

    var body: some View {
        Text(text)
            .font(NaviFont.body(14))
            .foregroundStyle(NaviTheme.cardWhite)
            .lineSpacing(3)
            .padding(.horizontal, 30)
            .padding(.vertical, 15)
            .background(NaviTheme.purple)
            .clipShape(RoundedRectangle(cornerRadius: 15))
            .frame(maxWidth: 547, alignment: .trailing)
            .textSelection(.enabled)
    }
}

/// Figma "Chat Message / navi" plus the "참고한 정보" card.
private struct NaviAnswer: View {
    let message: ChatMessage
    let isAdded: Bool
    let onAddTodos: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 20) {
                Text(message.text)
                    .font(NaviFont.body(14, weight: .bold))
                if !message.items.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(message.items.enumerated()), id: \.offset) { index, item in
                            Text(message.items.count > 1 ? "\(index + 1). \(item)" : item)
                        }
                    }
                    .font(NaviFont.body(14))
                    .lineSpacing(3)
                }
                if !message.suggestedTodos.isEmpty {
                    Button(action: onAddTodos) {
                        HStack(spacing: 5) {
                            if isAdded { NaviIcon(name: "IconCheck") }
                            Text(isAdded ? "추가됨" : "할 일에 추가")
                                .font(NaviFont.body(12, weight: .bold))
                        }
                        .foregroundStyle(NaviTheme.purple)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 8)
                        .background(NaviTheme.lavender)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isAdded)
                }
            }
            .foregroundStyle(NaviTheme.ink)
            .textSelection(.enabled)
            .padding(.horizontal, 30)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 15))

            if let context = message.context {
                VStack(alignment: .leading, spacing: 10) {
                    Text("참고한 정보")
                        .font(NaviFont.title(12))
                        .foregroundStyle(NaviTheme.purple)
                    Text(context)
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.ink)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(NaviTheme.itemBackground)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

#if DEBUG
#Preview("채팅") {
    ChatTabView(model: ChatTabModel(todoModel: TodoTabModel()))
        .padding(10)
        .frame(width: 1067, height: 694)
        .background(NaviTheme.canvas)
}
#endif
