import SwiftUI

/// Figma "03 Final Prototype › 08 메일": filter tabs, the message list, and a right panel that
/// shows the empty state, a message with AI summary / todo / reply draft, a new message, or
/// the reply review / edit flow.
struct MailTabView: View {
    @ObservedObject var model: MailTabModel
    /// Shows "메일을 보냈습니다" / "초안을 저장했습니다".
    let onResult: (MainDialog) -> Void

    @State private var assistantText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviTabHeader(title: "메일", searchPrompt: "메일 검색", searchText: $model.searchText)

            HStack {
                NaviSegmentTabs(items: model.filterTabs, selection: $model.filter, title: \.title)
                Spacer(minLength: 10)
                HStack(spacing: 10) {
                    NaviSegmentTabs(items: [MailTabModel.Filter.drafts], selection: $model.filter, title: \.title)
                    NaviPillButton(title: "새 메일", icon: "IconPlus", style: .primary, size: .large, action: model.compose)
                }
            }

            HStack(alignment: .top, spacing: 10) {
                list
                    .frame(width: 360)
                VStack(alignment: .leading, spacing: 6) {
                    rightPanel
                    // Load / send / star failures from the `mail` Edge Function.
                    if let error = model.errorMessage {
                        Text(error)
                            .font(NaviFont.body(10))
                            .foregroundStyle(NaviTheme.red)
                            .padding(.horizontal, 10)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(.bottom, 10)
        }
        .task { await model.load() }
    }

    // MARK: - List

    private var list: some View {
        ScrollView {
            VStack(spacing: 5) {
                if model.filter == .drafts {
                    if model.drafts.isEmpty { emptyList("임시 보관한 메일이 없어요.") }
                    ForEach(model.drafts) { draft in
                        Button { model.panel = .compose(draft) } label: {
                            MailListRow(
                                sender: draft.to.isEmpty ? "받는 사람 없음" : draft.to,
                                subject: draft.subject.isEmpty ? "(제목 없음)" : draft.subject,
                                snippet: draft.body,
                                time: MailTabModel.listTime(draft.savedAt),
                                isStarred: nil,
                                isSelected: model.panel == .compose(draft)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    if model.visibleMessages.isEmpty { emptyList("메일이 없어요.") }
                    ForEach(model.visibleMessages) { message in
                        MailListRow(
                            sender: message.sender.name,
                            subject: message.subject,
                            snippet: message.snippet,
                            time: MailTabModel.listTime(message.receivedAt),
                            isStarred: message.isStarred,
                            isSelected: model.selectedMessageID == message.id,
                            onStar: { model.toggleStar(message.id) }
                        )
                        .contentShape(Rectangle())
                        .onTapGesture { model.open(message.id) }
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, 10)
        .padding(.vertical, 15)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func emptyList(_ text: String) -> some View {
        Text(text)
            .font(NaviFont.body(12))
            .foregroundStyle(NaviTheme.grayText)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Right panel

    @ViewBuilder
    private var rightPanel: some View {
        switch model.panel {
        case .empty:
            emptyState
        case .detail(let id):
            if let message = model.message(id) {
                VStack(spacing: 10) {
                    MailDetailPanel(model: model, message: message)
                    NaviPromptInput(prompt: "이 메일에서 할 일을 만들어 줘", text: $assistantText, onSubmit: model.sendAssistantPrompt)
                }
            }
        case .compose(let draft):
            ComposePanel(
                draft: draft,
                senderAddress: model.senderAddress,
                onClose: { model.panel = .empty },
                onSave: { draft in
                    Task { if let saved = await model.saveDraft(draft) { onResult(.mailDraftSaved(saved)) } }
                },
                onSend: { draft in
                    Task { if let sent = await model.send(draft) { onResult(.mailSent(sent)) } }
                },
                isSending: model.isSending
            )
            .id(draft.id)
        case .replyReview(let id), .replyEdit(let id):
            if let message = model.message(id) {
                ReplyPanel(model: model, message: message, isEditing: model.panel == .replyEdit(id)) {
                    Task { if let sent = await model.sendReply(to: id) { onResult(.mailSent(sent)) } }
                }
            }
        }
    }

    /// Figma "Select Mail": the faded navi ring behind "좌측에서 메일을 선택해주세요."
    private var emptyState: some View {
        ZStack {
            Image("MailEmptyState")
                .resizable()
                .frame(width: 250, height: 248.7)
                .opacity(0.5)
                .blur(radius: 16)
                .accessibilityHidden(true)
            Text(model.filter == .drafts ? "좌측에서 임시 보관한 메일을 선택해주세요." : "좌측에서 메일을 선택해주세요.")
                .font(NaviFont.paperlogy(18))
                .foregroundStyle(NaviTheme.ink)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - List row

/// Figma "Email Item / Detail": sender, star + time, bold subject (purple when selected),
/// and a one-line snippet.
private struct MailListRow: View {
    let sender: String
    let subject: String
    let snippet: String
    let time: String
    /// `nil` hides the star (drafts).
    let isStarred: Bool?
    let isSelected: Bool
    var onStar: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(sender)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.ink)
                    .lineLimit(1)
                Spacer()
                HStack(spacing: 5) {
                    if let isStarred {
                        Button { onStar?() } label: {
                            Image(isStarred ? "IconStarFilled" : "IconStar")
                                .resizable()
                                .frame(width: isStarred ? 13 : 14, height: 16)
                                .rotationEffect(.degrees(-90))
                                .frame(width: 16, height: 14)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(isStarred ? "즐겨찾기 해제" : "즐겨찾기")
                    }
                    Text(time)
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.graySecondary)
                }
            }
            .frame(height: 17)
            VStack(alignment: .leading, spacing: 3) {
                Text(subject)
                    .font(NaviFont.body(12, weight: .bold))
                    .foregroundStyle(isSelected ? NaviTheme.purple : NaviTheme.ink)
                    .lineLimit(1)
                Text(snippet)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isSelected ? NaviTheme.lavender : NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay {
            if isSelected { RoundedRectangle(cornerRadius: 5).stroke(NaviTheme.purple, lineWidth: 1) }
        }
    }
}

// MARK: - Detail

private struct MailDetailPanel: View {
    @ObservedObject var model: MailTabModel
    let message: MailMessage
    @State private var isAddingTodo = false

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            VStack(alignment: .leading, spacing: 10) {
                Text(message.subject)
                    .font(NaviFont.heading(18))
                    .foregroundStyle(NaviTheme.ink)
                Rectangle().fill(NaviTheme.border).frame(height: 1)
                HStack {
                    HStack(spacing: 10) {
                        Text(message.sender.name)
                            .font(NaviFont.body(12, weight: .bold))
                            .foregroundStyle(NaviTheme.ink)
                        Text("<\(message.sender.email)>")
                            .font(NaviFont.body(10))
                            .foregroundStyle(NaviTheme.grayText)
                    }
                    Spacer()
                    Text(MailTabModel.longDate(message.receivedAt))
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.grayText)
                }
            }
            ScrollView {
                Text(message.body)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.ink)
                    .lineSpacing(3)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)

            VStack(spacing: 10) {
                if !message.summary.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("AI 요약")
                            .font(NaviFont.title(12))
                            .foregroundStyle(NaviTheme.purple)
                        VStack(alignment: .leading, spacing: 5) {
                            ForEach(Array(message.summary.enumerated()), id: \.offset) { _, item in
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Text("•")
                                    if let lead = item.lead {
                                        Text("\(Text(lead).bold()): \(item.text)")
                                    } else {
                                        Text(item.text)
                                    }
                                }
                                .font(NaviFont.body(12))
                                .foregroundStyle(NaviTheme.ink)
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NaviTheme.itemBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                if let todo = message.suggestedTodo {
                    let isAdded = model.addedTodoMessageIDs.contains(message.id)
                    HStack {
                        HStack(spacing: 10) {
                            NaviCheckbox(isChecked: isAdded)
                            Text(todo)
                                .font(NaviFont.body(12))
                                .foregroundStyle(NaviTheme.ink)
                        }
                        Spacer()
                        NaviPillButton(title: isAdded ? "추가됨" : isAddingTodo ? "추가 중…" : "할 일에 추가", style: isAdded ? .success : .accent) {
                            guard !isAdded, !isAddingTodo else { return }
                            isAddingTodo = true
                            Task {
                                await model.addSuggestedTodo(from: message.id)
                                isAddingTodo = false
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(NaviTheme.itemBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                if let draft = message.replyDraft {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("답장 초안")
                            .font(NaviFont.title(12))
                            .foregroundStyle(NaviTheme.purple)
                        HStack(alignment: .top) {
                            Text(draft.split(separator: "\n").dropFirst(2).first.map(String.init) ?? draft)
                                .font(NaviFont.body(12))
                                .foregroundStyle(NaviTheme.ink)
                                .lineLimit(2)
                            Spacer()
                            NaviPillButton(title: "검토 후 전송", style: .primary) {
                                model.panel = .replyReview(message.id)
                            }
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NaviTheme.itemBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Compose

/// Figma "08 - 메일 > 새 메일": sender, 받는 사람, 제목, 내용, 임시 저장 / 보내기.
private struct ComposePanel: View {
    @State var draft: MailDraft
    let senderAddress: String
    let onClose: () -> Void
    let onSave: (MailDraft) -> Void
    let onSend: (MailDraft) -> Void
    var isSending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviPanelHeader(title: draft.replyTo == nil ? "새 메일" : "답장", onClose: onClose)
            HStack(spacing: 12) {
                Text("보내는 사람")
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
                    .frame(width: 85, alignment: .leading)
                Text(senderAddress)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
            }
            .frame(height: 22)
            field("받는 사람", text: $draft.to)
            field("제목", text: $draft.subject)
            VStack(alignment: .leading, spacing: 9) {
                Text("내용")
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
                TextEditor(text: $draft.body)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                    .scrollContentBackground(.hidden)
            }
            .padding(14)
            .frame(maxHeight: .infinity, alignment: .topLeading)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NaviTheme.border, lineWidth: 1))

            HStack(spacing: 10) {
                Spacer()
                NaviPillButton(title: "임시 저장", size: .large) { onSave(draft) }
                NaviPillButton(title: "보내기", style: .primary, size: .large) { onSend(draft) }
                    .disabled(!canSend || isSending)
                    .opacity(canSend ? 1 : 0.5)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var canSend: Bool {
        draft.to.contains("@") && !draft.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(NaviFont.body(10))
                .foregroundStyle(NaviTheme.grayText)
            TextField("", text: text)
                .textFieldStyle(.plain)
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.ink)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NaviTheme.border, lineWidth: 1))
    }
}

// MARK: - Reply review / edit

/// Figma "08 - 메일 > 답장 초안 검토" and "> 수정": the original message, then the reply draft
/// (read-only or editable), then 초안 수정 / 이대로 답장 전송하기 (or 수정 취소 / 검토 완료).
private struct ReplyPanel: View {
    @ObservedObject var model: MailTabModel
    let message: MailMessage
    let isEditing: Bool
    let onSend: () -> Void

    @State private var editedText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviPanelHeader(title: isEditing ? "답장 초안 수정" : "답장 초안 검토") {
                model.panel = .detail(message.id)
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("원본 메일  ·  \(message.sender.display)")
                    Spacer()
                    Text(MailTabModel.longDate(message.receivedAt))
                }
                .font(NaviFont.body(10))
                .foregroundStyle(NaviTheme.grayText)
                Text(message.subject)
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.ink)
                Text(message.snippet)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                    .lineLimit(2)
            }
            .padding(14)
            Rectangle().fill(NaviTheme.border).frame(height: 1)
            HStack(spacing: 10) {
                Text("답장 내용")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.ink)
                if !isEditing {
                    Text("초안 · 전송 전 수정 가능")
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.purple)
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Text("받는 사람")
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.grayText)
                    Text("\(Text(message.sender.name).bold()) <\(message.sender.email)>")
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.ink)
                }
                .padding(.horizontal, 8)
                Rectangle().fill(NaviTheme.border).frame(height: 1)
                if isEditing {
                    TextEditor(text: $editedText)
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.ink)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 120)
                } else {
                    Text(model.replyBody(for: message))
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.ink)
                        .lineSpacing(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 15)
            .background(isEditing ? NaviTheme.cardWhite : NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay {
                if isEditing { RoundedRectangle(cornerRadius: 10).stroke(NaviTheme.border, lineWidth: 1) }
            }
            if !isEditing {
                Text("전송하면 위 내용이 \(message.sender.name)님에게 전달됩니다.")
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                Spacer()
                if isEditing {
                    NaviPillButton(title: "수정 취소", style: .outline, size: .large) {
                        model.panel = .replyReview(message.id)
                    }
                    NaviPillButton(title: "검토 완료", style: .primary, size: .large) {
                        model.updateReplyDraft(message.id, to: editedText)
                        model.panel = .replyReview(message.id)
                    }
                } else {
                    NaviPillButton(title: "초안 수정", size: .large) {
                        editedText = model.replyBody(for: message)
                        model.panel = .replyEdit(message.id)
                    }
                    NaviPillButton(title: "이대로 답장 전송하기", style: .primary, size: .large, action: onSend)
                        .disabled(model.isSending)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .onAppear { editedText = model.replyBody(for: message) }
    }
}

// MARK: - Result dialog

/// Figma "08 - 메일 > 메일 발송 확인" / "> 임시 저장 확인".
struct MailResultDialog: View {
    let draft: MailDraft
    let isSent: Bool
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 15) {
            Image("IconCheckedCircle")
                .resizable()
                .frame(width: 50, height: 50)
                .accessibilityHidden(true)
            Text(isSent ? "메일을 보냈습니다" : "초안을 저장했습니다")
                .font(NaviFont.title(25))
                .foregroundStyle(NaviTheme.ink)
            Group {
                if isSent {
                    Text("\(Text(recipientName).bold())님에게 정상적으로 전달되었습니다.")
                } else {
                    Text("작성 중인 메일은 임시 보관함에서 이어 쓸 수 있어요.")
                }
            }
            .font(NaviFont.body(12))
            .foregroundStyle(NaviTheme.grayText)

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Text("받는 사람")
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.grayText)
                    Text(draft.to.isEmpty ? "-" : draft.to)
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.ink)
                }
                .padding(.horizontal, 8)
                Rectangle().fill(NaviTheme.border).frame(height: 1)
                Text(draft.body)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                    .lineLimit(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 10)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            NaviButton(title: "받은 메일함으로", action: onClose)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 25)
        .frame(width: 460)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.14), radius: 14, y: 10)
    }

    /// "김지민 <jimin@example.com>" → "김지민".
    private var recipientName: String {
        draft.to.components(separatedBy: "<").first?.trimmingCharacters(in: .whitespaces).nilIfEmpty ?? draft.to
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
