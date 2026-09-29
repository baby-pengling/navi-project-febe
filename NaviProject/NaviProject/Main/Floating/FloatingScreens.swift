import SwiftUI

// Drill-down screens of the floating widget (Figma "03-1 Floating UI": "01 - 메일 브리핑",
// "> 상세", "02 - 오늘 일정", "> 상세", "> 새 일정", "03 - 오늘 할 일", "> 상세").

// MARK: - Mail

/// "01 - 메일 브리핑": the briefing mails, most urgent first.
struct FloatingMailListScreen: View {
    @ObservedObject var model: FloatingWidgetModel
    let onOpenMainWindow: (MainTab?) -> Void

    var body: some View {
        FloatingChrome(
            backTitle: "오늘의 브리핑",
            title: "오늘 확인해야 하는 메일",
            subtitle: "우선 메일 · \(model.mails.count)개",
            caption: "급한 순서대로 정리했어요. 메일을 누르면 답장 초안을 볼 수 있어요.",
            onBack: { model.screen = .home },
            onOpenMainWindow: onOpenMainWindow
        ) {
            FloatingCard {
                ForEach(model.mails) { mail in
                    Button { model.screen = .mailDetail(mail.id) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(mail.message.sender.name) · \(Self.receivedText(mail.message.receivedAt))")
                                .font(NaviFont.body(10))
                                .foregroundStyle(NaviTheme.grayText)
                                .frame(height: 18)
                            Text(mail.message.subject)
                                .font(NaviFont.heading(14))
                                .foregroundStyle(NaviTheme.ink)
                                .lineLimit(1)
                            Text(mail.actionNote)
                                .font(NaviFont.body(10))
                                .foregroundStyle(NaviTheme.grayText)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(NaviTheme.itemBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            FloatingPromptInput(prompt: "여기서 제일 빨리 답장해야 하는 메일은 뭐야?", isOutlined: true)
        }
    }

    /// "오늘 08:12", "어제", or "9월 12일".
    static func receivedText(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "오늘 \(ScheduleBlock.time(date))" }
        if calendar.isDateInYesterday(date) { return "어제" }
        return TodoTabModel.format(date, "M월 d일")
    }
}

/// "01 - 메일 브리핑 > 상세": the message with its AI summary, a suggested todo and event, and
/// the reply draft.
struct FloatingMailDetailScreen: View {
    @ObservedObject var model: FloatingWidgetModel
    let mail: FloatingMail
    let onOpenMainWindow: (MainTab?) -> Void

    private var message: MailMessage { mail.message }

    var body: some View {
        FloatingChrome(
            backTitle: "오늘 확인해야 하는 메일",
            onBack: { model.screen = .mails },
            onOpenMainWindow: onOpenMainWindow
        ) {
            FloatingCard(spacing: 15, horizontalPadding: 15) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(message.subject)
                        .font(NaviFont.title(14))
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
                        .lineLimit(1)
                        Spacer(minLength: 5)
                        Text(dateText)
                            .font(NaviFont.body(10))
                            .foregroundStyle(NaviTheme.grayText)
                            .fixedSize()
                    }
                }

                VStack(alignment: .leading, spacing: 15) {
                    Text(message.body)
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.ink)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)

                    VStack(alignment: .leading, spacing: 5) {
                        if !message.summary.isEmpty {
                            summaryCard
                        }
                        if let todo = message.suggestedTodo {
                            let isAdded = model.addedTodoMailIDs.contains(mail.id)
                            suggestionRow(
                                leading: AnyView(NaviCheckbox(isChecked: isAdded)),
                                text: todo,
                                actionTitle: isAdded ? "추가됨" : "할 일에 추가",
                                isAdded: isAdded
                            ) {
                                model.addSuggestedTodo(from: mail.id)
                            }
                        }
                        if let event = mail.suggestedEvent {
                            let isAdded = model.addedEventMailIDs.contains(mail.id)
                            suggestionRow(
                                leading: AnyView(
                                    Image(SidebarIcon.calendar.assetName)
                                        .resizable()
                                        .frame(width: SidebarIcon.calendar.size.width, height: SidebarIcon.calendar.size.height)
                                        .frame(width: 15, height: 15)
                                        .foregroundStyle(NaviTheme.grayText)
                                ),
                                text: event,
                                actionTitle: isAdded ? "추가됨" : "일정에 추가",
                                isAdded: isAdded
                            ) {
                                model.screen = .newEvent(fromMail: mail.id)
                            }
                        }
                        if let draft = message.replyDraft {
                            replyCard(draft)
                        }
                    }
                }
            }
        }
    }

    /// "2026년 9월 16일 (4일 전)"
    private var dateText: String {
        let days = Calendar.current.dateComponents(
            [.day],
            from: Calendar.current.startOfDay(for: message.receivedAt),
            to: Calendar.current.startOfDay(for: .now)
        ).day ?? 0
        let relative = days <= 0 ? "오늘" : "\(days)일 전"
        return "\(TodoTabModel.format(message.receivedAt, "yyyy년 M월 d일")) (\(relative))"
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("AI 요약")
                .font(NaviFont.title(12))
                .foregroundStyle(NaviTheme.purple)
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(message.summary.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("•")
                        if let lead = line.lead {
                            Text("\(Text(lead).font(NaviFont.body(12, weight: .bold))): \(line.text)")
                        } else {
                            Text(line.text)
                        }
                    }
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                    .padding(.leading, 6)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func suggestionRow(
        leading: AnyView,
        text: String,
        actionTitle: String,
        isAdded: Bool,
        action: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 10) {
            leading
            Text(text)
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            NaviPillButton(title: actionTitle, style: isAdded ? .success : .accent, action: action)
                .disabled(isAdded)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func replyCard(_ draft: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("답장 초안")
                .font(NaviFont.title(12))
                .foregroundStyle(NaviTheme.purple)
            VStack(alignment: .leading, spacing: 10) {
                Text(draft)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                // Review / edit / send lives in the main window's mail tab.
                Button { onOpenMainWindow(.mail) } label: {
                    Text("검토 후 전송")
                        .font(NaviFont.body(12, weight: .bold))
                        .foregroundStyle(NaviTheme.cardWhite)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(NaviTheme.purple)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

// MARK: - Calendar

/// "02 - 오늘 일정": today's events as schedule blocks.
struct FloatingEventListScreen: View {
    @ObservedObject var model: FloatingWidgetModel
    let onOpenMainWindow: (MainTab?) -> Void

    var body: some View {
        FloatingChrome(
            backTitle: "오늘의 브리핑",
            title: "오늘 일정",
            subtitle: "\(FloatingWidgetModel.dayTitle()) · 일정 \(model.events.count)개",
            caption: caption,
            onBack: { model.screen = .home },
            onOpenMainWindow: onOpenMainWindow
        ) {
            if !model.events.isEmpty {
                FloatingCard {
                    ForEach(model.sortedEvents) { event in
                        Button { model.screen = .eventDetail(event.id) } label: {
                            ScheduleBlock(
                                title: event.title,
                                timeRange: ScheduleBlock.timeRange(event.startAt, event.endAt),
                                location: event.location,
                                tint: event.category.map { Color(naviHex: $0.color) } ?? NaviTheme.purple
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            VStack(spacing: 10) {
                FloatingWideButton(title: "새 일정 만들기", isPrimary: true) {
                    model.screen = .newEvent(fromMail: nil)
                }
                // The weekly prep flow lives in the main window's calendar tab.
                FloatingWideButton(title: "이번 주 미리 준비하기") { onOpenMainWindow(.calendar) }
            }
            FloatingPromptInput(prompt: "빈 시간에 할 일을 배치해 줘")
        }
    }

    private var caption: String {
        guard let next = model.nextEvent else { return "오늘 남은 일정이 없어요." }
        return "다음 일정은 \(ScheduleBlock.time(next.startAt)) \(next.title)이에요."
    }
}

/// "02 - 오늘 일정 > 상세" / "> 새 일정": the main window's event form inside the widget.
struct FloatingEventFormScreen: View {
    @ObservedObject var model: FloatingWidgetModel
    let draft: NewEventDraft
    let title: String
    let eventID: UUID?
    let fromMail: UUID?
    let onOpenMainWindow: (MainTab?) -> Void

    var body: some View {
        FloatingChrome(
            backTitle: fromMail.flatMap { model.mail($0)?.message.subject } ?? "오늘 일정",
            onBack: goBack,
            onOpenMainWindow: onOpenMainWindow
        ) {
            NewEventPanel(
                categories: model.calendarCategories,
                draft: draft,
                panelTitle: title,
                onCancel: goBack,
                onSave: { draft in
                    // TODO: Write through the `calendar` Edge Function once the widget is wired up.
                    model.saveEvent(draft, id: eventID)
                    if let fromMail {
                        model.markEventAdded(from: fromMail)
                    }
                    goBack()
                }
            )
        }
    }

    private func goBack() {
        model.screen = fromMail.map { .mailDetail($0) } ?? .events
    }
}

// MARK: - Todo

/// "03 - 오늘 할 일": today's todos with an inline add row.
struct FloatingTodoListScreen: View {
    @ObservedObject var model: FloatingWidgetModel
    let onOpenMainWindow: (MainTab?) -> Void

    @State private var newTitle = ""
    @State private var newCategory: NaviCategory?

    var body: some View {
        FloatingChrome(
            backTitle: "오늘의 브리핑",
            title: "오늘 할 일",
            subtitle: "\(FloatingWidgetModel.dayTitle()) · 할 일 \(model.todos.count)개",
            onBack: { model.screen = .home },
            onOpenMainWindow: onOpenMainWindow
        ) {
            FloatingCard {
                ForEach(model.todos) { todo in
                    FloatingTodoRow(todo: todo, model: model)
                }
                addRow
            }
            // The weekly prep flow lives in the main window's todo tab.
            FloatingWideButton(title: "이번 주 미리 준비하기") { onOpenMainWindow(.todo) }
            FloatingPromptInput(prompt: "오늘 할 일과 관련된 다른 할 일이 있을까?")
        }
        .onAppear { newCategory = newCategory ?? model.todoCategories.first }
    }

    /// Figma's add row: checkbox, "할 일 추가" field, a compact category picker, and the time.
    private var addRow: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                NaviCheckbox(isChecked: false)
                TextField("", text: $newTitle, prompt: Text("할 일 추가").foregroundStyle(NaviTheme.grayText))
                    .textFieldStyle(.plain)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                    .onSubmit(add)
            }
            HStack(spacing: 10) {
                categoryMenu
                Text(FloatingWidgetModel.time(model.newTodoDueAt))
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
            }
            .fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }

    /// Figma "Color picker" at row size: a 9pt tag and a 10pt chevron in a 5pt-radius box.
    private var categoryMenu: some View {
        Menu {
            Button("카테고리 없음") { newCategory = nil }
            ForEach(model.todoCategories) { category in
                Button(category.name) { newCategory = category }
            }
        } label: {
            HStack(spacing: 3) {
                if let newCategory {
                    NaviTag(category: newCategory)
                } else {
                    Text("없음")
                        .font(NaviFont.body(9))
                        .foregroundStyle(NaviTheme.grayText)
                        .padding(.horizontal, 6)
                }
                NaviIcon(name: "IconChevron", size: 10)
                    .foregroundStyle(NaviTheme.ink)
            }
            .padding(3)
            .background(NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(NaviTheme.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("카테고리")
        .accessibilityValue(newCategory?.name ?? "없음")
    }

    private func add() {
        // TODO: Insert through the `todos` TABLE once the widget is wired up.
        model.addTodo(title: newTitle, category: newCategory, dueAt: model.newTodoDueAt)
        newTitle = ""
    }
}

/// "03 - 오늘 할 일 > 상세": title, deadline, category, and subtasks.
struct FloatingTodoDetailScreen: View {
    @ObservedObject var model: FloatingWidgetModel
    let todo: DashboardTodo
    let onOpenMainWindow: (MainTab?) -> Void

    @State private var title = ""
    @State private var newSubtask = ""

    var body: some View {
        FloatingChrome(
            backTitle: "오늘 할 일",
            onBack: { model.screen = .todos },
            onOpenMainWindow: onOpenMainWindow
        ) {
            FloatingCard(spacing: 20, horizontalPadding: 20, verticalPadding: 20) {
                NaviPanelHeader(title: "할 일 상세", onClose: nil)

                HStack(spacing: 10) {
                    Button { model.toggleTodo(todo.id) } label: {
                        NaviCheckbox(isChecked: todo.isDone, size: 18, uncheckedBorder: NaviTheme.border)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(todo.isDone ? "완료 취소" : "완료")
                    TextField("", text: $title)
                        .textFieldStyle(.plain)
                        .font(NaviFont.body(16, weight: .bold))
                        .foregroundStyle(NaviTheme.ink)
                        .strikethrough(todo.isDone)
                        .onSubmit { model.renameTodo(todo.id, to: title) }
                }

                Button { model.screen = .deadline(todo.id) } label: {
                    NaviFieldBox(title: "기한") {
                        HStack {
                            Text(deadlineText)
                            Spacer()
                            NaviIcon(name: "IconChevron")
                                .rotationEffect(.degrees(-90))
                                .foregroundStyle(NaviTheme.ink)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                HStack {
                    Text("카테고리")
                        .font(NaviFont.title(14))
                        .foregroundStyle(NaviTheme.dark)
                    Spacer()
                    NaviCategoryPicker(
                        categories: model.todoCategories,
                        selection: Binding(get: { todo.category }, set: { model.setCategory($0, of: todo.id) })
                    )
                }

                subtasks
            }
            FloatingPromptInput(prompt: "오늘 할 일과 관련된 다른 할 일이 있을까?")
        }
        .onAppear { title = todo.title }
        .onDisappear { model.renameTodo(todo.id, to: title) }
    }

    private var subtasks: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("하위 할 일")
                    .font(NaviFont.title(16))
                    .foregroundStyle(NaviTheme.dark)
                Spacer()
                if !todo.subtasks.isEmpty {
                    Text("\(todo.subtasks.filter(\.isDone).count)/\(todo.subtasks.count) 완료")
                        .font(NaviFont.tag(9))
                        .foregroundStyle(NaviTheme.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 2)
                        .background(NaviTheme.limeLight)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                ForEach(todo.subtasks) { subtask in
                    Button { model.toggleSubtask(subtask.id, of: todo.id) } label: {
                        HStack(spacing: 10) {
                            NaviCheckbox(isChecked: subtask.isDone)
                            Text(subtask.title)
                                .font(NaviFont.body(12))
                                .foregroundStyle(NaviTheme.ink)
                                .strikethrough(subtask.isDone)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 7)
                        .padding(.vertical, 5)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                HStack(spacing: 10) {
                    NaviCheckbox(isChecked: false)
                    TextField("", text: $newSubtask, prompt: Text("할 일 추가").foregroundStyle(NaviTheme.grayText))
                        .textFieldStyle(.plain)
                        .font(NaviFont.body(12))
                        .onSubmit {
                            model.addSubtask(newSubtask, to: todo.id)
                            newSubtask = ""
                        }
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 5)
                .background(NaviTheme.itemBackground)
                .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            .padding(.horizontal, 5)
        }
    }

    /// "오늘 · 오후 5:00", "내일 · 오전 9:00", "9월 30일 · 오후 6:00", or "기한 없음".
    private var deadlineText: String {
        guard let dueAt = todo.dueAt else { return "기한 없음" }
        let calendar = Calendar.current
        let time = FloatingWidgetModel.time(dueAt)
        if calendar.isDateInToday(dueAt) { return "오늘 · \(time)" }
        if calendar.isDateInTomorrow(dueAt) { return "내일 · \(time)" }
        return "\(TodoTabModel.format(dueAt, "M월 d일")) · \(time)"
    }
}
