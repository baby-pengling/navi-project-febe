import SwiftUI

/// Figma "07 - 대시보드": greeting + date header, today's todos and important mail on the left,
/// today's timeline on the right, and the assistant command input along the bottom.
/// Without Google, the mail and timeline panels show the connect cards from the Claude proposal
/// frame "[제안] 07 - 대시보드 > Google 미연결".
struct DashboardView: View {
    @ObservedObject var sessionStore: AppSessionStore
    @ObservedObject var model: DashboardModel
    @ObservedObject var settingsModel: SettingsModel
    let onSelectTab: (MainTab) -> Void
    /// Opens the mail / calendar tab's Google connect flow.
    let onConnect: (ServiceConnectFlow.Service) -> Void

    @State private var command = ""
    @State private var rightPanel: RightPanel = .schedule

    /// What the right column shows. Adding a todo or an event swaps it in place of "오늘 일정",
    /// like the side panels of the Figma todo / calendar tabs.
    private enum RightPanel: Equatable {
        case schedule
        case newTodo
        case todoAdded(DashboardTodo)
        case newEvent
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                TimelineView(.everyMinute) { context in
                    header(now: context.date)
                }
                HStack(alignment: .top, spacing: 10) {
                    VStack(spacing: 10) {
                        todoPanel
                        mailPanel
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

                    rightColumn
                        .frame(width: 418)
                }
                .padding(.bottom, 10)
                .frame(maxHeight: .infinity)
            }
            commandInput
        }
        .task { await model.load() }
    }

    // MARK: - Header

    private func header(now: Date) -> some View {
        HStack {
            Text(greeting(at: now))
                .font(NaviFont.title(28))
                .foregroundStyle(NaviTheme.ink)
                .lineLimit(1)
            Spacer(minLength: 20)
            HStack(spacing: 20) {
                HStack(spacing: 5) {
                    dateChip(now.formatted(.dateTime.weekday(.abbreviated).locale(Locale(identifier: "en_US_POSIX"))))
                    // Plain numbers: the Korean locale would add "월" / "일" suffixes.
                    dateChip(String(format: "%02d", Calendar.current.component(.month, from: now)))
                    dateChip(String(format: "%02d", Calendar.current.component(.day, from: now)))
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(now.formatted(date: .complete, time: .omitted))

                NaviCompressButton()
            }
        }
    }

    private func dateChip(_ text: String) -> some View {
        Text(text)
            .font(NaviFont.mono(25))
            .foregroundStyle(NaviTheme.purple)
            .padding(.horizontal, 8)
            .padding(.vertical, 12)
            .background(NaviTheme.lavender)
            .clipShape(RoundedRectangle(cornerRadius: 5))
    }

    private func greeting(at date: Date) -> String {
        let hour = Calendar.current.component(.hour, from: date)
        let salutation: String
        switch hour {
        case 5..<11: salutation = "좋은 아침이에요"
        case 11..<17: salutation = "좋은 오후예요"
        case 17..<22: salutation = "좋은 저녁이에요"
        default: salutation = "편안한 밤이에요"
        }
        guard let name = displayName else { return "\(salutation)." }
        return "\(salutation), \(name)님."
    }

    /// Figma greets "박서연" as "서연님": a three-syllable Hangul name drops the family name;
    /// anything else is used as entered.
    private var displayName: String? {
        let name = settingsModel.name.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return nil }
        let isHangul = name.unicodeScalars.allSatisfy { (0xAC00...0xD7A3).contains($0.value) }
        return isHangul && name.count == 3 ? String(name.dropFirst()) : name
    }

    // MARK: - Today's todos

    private var todoPanel: some View {
        NaviPanel {
            NaviSectionHeader(
                title: "오늘 할 일",
                tag: "\(model.completedTodoCount)/\(model.todos.count) 완료",
                onViewAll: { onSelectTab(.todo) }
            )
            if model.todos.isEmpty {
                Text(model.isLoadingTodos ? "할 일을 불러오는 중이에요…" : "오늘 할 일이 없어요.")
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.grayText)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NaviTheme.itemBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            VStack(spacing: 7) {
                ForEach(model.todos.prefix(5)) { todo in
                    TodoItemRow(
                        todo: todo,
                        meta: TodoItemRow.dashboardMeta(for: todo),
                        onToggle: { model.toggleTodo(todo.id) },
                        onOpen: { onSelectTab(.todo) }
                    )
                    .draggable(todo.id.uuidString) {
                        TodoItemRow(todo: todo, meta: nil, onToggle: {}, onOpen: {})
                            .frame(width: 420)
                    }
                    .dropDestination(for: String.self) { items, _ in
                        guard let id = items.first.flatMap(UUID.init(uuidString:)) else { return false }
                        withAnimation(.easeInOut(duration: 0.15)) {
                            model.moveTodo(id, to: todo.id)
                        }
                        return true
                    }
                }
            }
            if let error = model.errorMessage {
                Text(error)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.red)
            }
            NaviPillButton(title: "할 일 추가", icon: "IconPlus", size: .large) {
                rightPanel = .newTodo
            }
        }
    }

    // MARK: - Important mail

    private var mailPanel: some View {
        NaviPanel(fillsHeight: true) {
            if settingsModel.services.mailConnected {
                NaviSectionHeader(
                    title: "중요 메일",
                    tag: "\(model.importantMails.count)개",
                    onViewAll: { onSelectTab(.mail) }
                )
                VStack(spacing: 5) {
                    ForEach(model.importantMails) { mail in
                        DashboardMailRow(mail: mail) { onSelectTab(.mail) }
                    }
                }
            } else {
                NaviSectionHeader(title: "중요 메일")
                connectCard(
                    logo: "GmailLogo",
                    title: "메일 계정을 연동하세요",
                    message: "연동하면 중요한 메일을 여기서 바로 볼 수 있어요.",
                    service: .mail
                )
            }
        }
    }

    // MARK: - Today's schedule

    private var schedulePanel: some View {
        NaviPanel(spacing: 15, fillsHeight: true) {
            if settingsModel.services.calendarConnected {
                NaviSectionHeader(
                    title: "오늘 일정",
                    tag: "\(model.todayEvents.count)개",
                    onViewAll: { onSelectTab(.calendar) }
                )
                DayTimeline(day: .now, events: model.todayEvents, showsLocation: false)
                NaviPillButton(title: "일정 추가", icon: "IconPlus", size: .large) {
                    rightPanel = .newEvent
                }
            } else {
                NaviSectionHeader(title: "오늘 일정")
                connectCard(
                    logo: "GoogleCalendarLogo",
                    title: "캘린더를 연동하세요",
                    message: "연동하면 오늘 일정을 시간순으로 볼 수 있어요.",
                    service: .calendar
                )
            }
        }
    }

    @ViewBuilder
    private var rightColumn: some View {
        switch rightPanel {
        case .schedule:
            schedulePanel
        case .newTodo:
            NewTodoPanel(
                categories: model.todoCategories,
                draft: model.makeTodoDraft(),
                onCancel: { rightPanel = .schedule },
                onSave: { draft in
                    rightPanel = .todoAdded(try await model.addTodo(draft))
                }
            )
        case .todoAdded(let todo):
            TodoAddedPanel(
                todo: todo,
                onClose: { rightPanel = .schedule },
                onOpenTodos: {
                    rightPanel = .schedule
                    onSelectTab(.todo)
                }
            )
        case .newEvent:
            NewEventPanel(
                categories: model.calendarCategories,
                draft: model.makeEventDraft(),
                onCancel: { rightPanel = .schedule },
                onSave: { draft in
                    _ = try await model.addEvent(draft)
                    rightPanel = .schedule
                }
            )
        }
    }

    // MARK: - Google not connected

    private func connectCard(
        logo: String,
        title: String,
        message: String,
        service: ServiceConnectFlow.Service
    ) -> some View {
        VStack(spacing: 8) {
            Image(logo)
                .resizable()
                .scaledToFit()
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)
            Text(title)
                .font(NaviFont.title(14))
                .foregroundStyle(NaviTheme.dark)
            Text(message)
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
                .multilineTextAlignment(.center)
            // Starts the tab's connect flow (service choice → permissions → Google).
            NaviPillButton(title: "Google 계정 연동하기") {
                onConnect(service)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
        .background(NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Command input

    private var commandInput: some View {
        NaviPromptInput(prompt: "오늘 할 일을 정리해줘", text: $command, onSubmit: model.sendCommand)
    }
}

// MARK: - Mail row

/// Figma "Email Item / Simple": sender, bold subject | snippet, received time.
private struct DashboardMailRow: View {
    let mail: DashboardMail
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 15) {
                Text(mail.sender)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                    .lineLimit(1)
                    .frame(width: 120, alignment: .leading)
                HStack(spacing: 5) {
                    Text(mail.subject)
                        .font(NaviFont.body(12, weight: .bold))
                        .foregroundStyle(NaviTheme.ink)
                        .layoutPriority(1)
                    Text("|")
                    Text(mail.snippet)
                }
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(mail.receivedAt.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)))
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.graySecondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

#if DEBUG
#Preview("Google 연결됨", traits: .fixedLayout(width: 1067, height: 674)) {
    DashboardView(
        sessionStore: AppSessionStore(),
        model: DashboardModel(),
        settingsModel: SettingsModel(
            previewName: "박서연",
            loginEmail: "babypenguin@korea.ac.kr",
            services: ConnectedServices(googleEmail: "cindy@korea.ac.kr", mailConnected: true, calendarConnected: true)
        ),
        onSelectTab: { _ in },
        onConnect: { _ in }
    )
    .padding(.horizontal, 10)
    .background(NaviTheme.canvas)
}

#Preview("Google 미연결", traits: .fixedLayout(width: 1067, height: 674)) {
    DashboardView(
        sessionStore: AppSessionStore(),
        model: DashboardModel(),
        settingsModel: SettingsModel(
            previewName: "박서연",
            loginEmail: "babypenguin@korea.ac.kr",
            services: ConnectedServices(googleEmail: nil, mailConnected: false, calendarConnected: false)
        ),
        onSelectTab: { _ in },
        onConnect: { _ in }
    )
    .padding(.horizontal, 10)
    .background(NaviTheme.canvas)
}
#endif
