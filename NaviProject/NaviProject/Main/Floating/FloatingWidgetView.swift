import SwiftUI

/// Figma "03-1 Floating UI": the mini widget panel above the navi mascot, shown in its own
/// floating window while the main window is compressed (see `FloatingWidgetController`).
struct FloatingWidgetView: View {
    @ObservedObject var model: FloatingWidgetModel
    /// Brings the main window back, optionally on a given tab (expand button, settings, and
    /// flows the widget doesn't cover).
    let onOpenMainWindow: (MainTab?) -> Void

    /// Panel width. Figma's frames vary between 370 and 398pt per screen; the widget keeps the
    /// home screen's width so it doesn't jump while navigating.
    static let panelWidth: CGFloat = 398

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if model.isPanelOpen {
                panel
                    // Figma: the mascot overlaps the panel's bottom edge by 18pt and sticks
                    // out 69pt past its right edge.
                    .padding(.bottom, 68)
                    .padding(.trailing, 69)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .bottomTrailing)))
            }
            mascot
        }
        // Room for the panel shadow inside the transparent window, and for the mascot's lime
        // dot, which draws slightly past its frame.
        .padding([.top, .leading], model.isPanelOpen ? 40 : 0)
        .padding([.bottom, .trailing], 6)
        .animation(.easeInOut(duration: 0.18), value: model.isPanelOpen)
    }

    private var panel: some View {
        FloatingScreenView(model: model, onOpenMainWindow: onOpenMainWindow)
            .padding(.horizontal, 15)
            .padding(.vertical, 20)
            .frame(width: Self.panelWidth, alignment: .topLeading)
            .background(NaviTheme.widgetBackground)
            .clipShape(RoundedRectangle(cornerRadius: 15))
            .shadow(color: Color(red: 0.102, green: 0.102, blue: 0.141).opacity(0.2), radius: 19, y: 18)
    }

    private var mascot: some View {
        Button {
            model.isPanelOpen.toggle()
        } label: {
            NaviMascotView(width: 126)
                .frame(width: 129, height: 86)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(model.isPanelOpen ? "브리핑 접기" : "브리핑 열기")
        .accessibilityLabel(model.isPanelOpen ? "브리핑 접기" : "브리핑 열기")
    }
}

/// Routes `model.screen` to the widget screens.
private struct FloatingScreenView: View {
    @ObservedObject var model: FloatingWidgetModel
    let onOpenMainWindow: (MainTab?) -> Void

    var body: some View {
        switch model.screen {
        case .home:
            FloatingHomeScreen(model: model, onOpenMainWindow: onOpenMainWindow)
        case .mails:
            FloatingMailListScreen(model: model, onOpenMainWindow: onOpenMainWindow)
        case .mailDetail(let id):
            if let mail = model.mail(id) {
                FloatingMailDetailScreen(model: model, mail: mail, onOpenMainWindow: onOpenMainWindow)
            }
        case .events:
            FloatingEventListScreen(model: model, onOpenMainWindow: onOpenMainWindow)
        case .eventDetail(let id):
            if let event = model.event(id) {
                FloatingEventFormScreen(
                    model: model,
                    draft: model.draft(for: event),
                    title: event.title,
                    eventID: id,
                    fromMail: nil,
                    onOpenMainWindow: onOpenMainWindow
                )
                .id(id)
            }
        case .newEvent(let mailID):
            FloatingEventFormScreen(
                model: model,
                draft: model.newEventDraft(fromMail: mailID),
                title: "새 일정",
                eventID: nil,
                fromMail: mailID,
                onOpenMainWindow: onOpenMainWindow
            )
        case .todos:
            FloatingTodoListScreen(model: model, onOpenMainWindow: onOpenMainWindow)
        case .todoDetail(let id):
            if let todo = model.todo(id) {
                FloatingTodoDetailScreen(model: model, todo: todo, onOpenMainWindow: onOpenMainWindow)
                    .id(id)
            }
        case .deadline(let id):
            if let todo = model.todo(id) {
                FloatingChrome(backTitle: todo.title, onBack: { model.screen = .todoDetail(id) }, onOpenMainWindow: onOpenMainWindow) {
                    DeadlinePanel(
                        initial: todo.dueAt ?? model.newTodoDueAt,
                        showsCloseButton: false,
                        onCancel: { model.screen = .todoDetail(id) },
                        onApply: { date in
                            model.setDue(date, of: id)
                            model.screen = .todoDetail(id)
                        }
                    )
                }
            }
        }
    }
}

// MARK: - Chrome

/// Screen scaffold. List screens have a back link, then the logo + title row with the settings
/// and expand buttons, then a purple subtitle and gray caption; detail screens put the buttons
/// on the back-link row and skip the title.
struct FloatingChrome<Content: View>: View {
    var backTitle: String?
    var title: String?
    var subtitle: String?
    var caption: String?
    var onBack: (() -> Void)?
    let onOpenMainWindow: (MainTab?) -> Void
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: backTitle == nil ? 12 : 10) {
            if let title {
                if let backTitle, let onBack {
                    FloatingBackButton(title: backTitle, action: onBack)
                }
                HStack {
                    HStack(spacing: 12) {
                        Image("LogoMark")
                            .resizable()
                            .frame(width: 30, height: 30)
                            .accessibilityHidden(true)
                        Text(title)
                            .font(NaviFont.heading(18))
                            .foregroundStyle(NaviTheme.dark)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 10)
                    FloatingHeaderButtons(onOpenMainWindow: onOpenMainWindow)
                }
            } else {
                HStack {
                    if let backTitle, let onBack {
                        FloatingBackButton(title: backTitle, action: onBack)
                    }
                    Spacer(minLength: 10)
                    FloatingHeaderButtons(onOpenMainWindow: onOpenMainWindow)
                }
            }
            if let subtitle {
                Text(subtitle)
                    .font(NaviFont.body(backTitle == nil ? 12 : 10))
                    .foregroundStyle(NaviTheme.purple)
            }
            if let caption {
                Text(caption)
                    .font(NaviFont.body(backTitle == nil ? 12 : 10))
                    .foregroundStyle(NaviTheme.grayText)
            }
            content
        }
    }
}

/// "‹ 오늘의 브리핑"
private struct FloatingBackButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                NaviIcon(name: "IconChevron")
                    .rotationEffect(.degrees(90))
                Text(title)
                    .font(NaviFont.body(12))
                    .lineLimit(1)
            }
            .foregroundStyle(NaviTheme.grayText)
            .padding(.horizontal, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title)(으)로 돌아가기")
    }
}

/// Settings gear and the purple "Resize Button / Expand".
private struct FloatingHeaderButtons: View {
    let onOpenMainWindow: (MainTab?) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button { onOpenMainWindow(.settings) } label: {
                Image(SidebarIcon.settings.assetName)
                    .resizable()
                    .frame(width: 12.6, height: 14)
                    .frame(width: 15, height: 15)
                    .foregroundStyle(NaviTheme.grayText)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("설정")
            .accessibilityLabel("설정")

            Button { onOpenMainWindow(nil) } label: {
                NaviIcon(name: "IconExpand", size: 18)
                    .frame(width: 22, height: 20)
                    .foregroundStyle(NaviTheme.cardWhite)
                    .padding(5)
                    .background(NaviTheme.purple)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
            }
            .buttonStyle(.plain)
            .help("큰 화면으로 보기")
            .accessibilityLabel("큰 화면으로 보기")
        }
    }
}

// MARK: - Shared pieces

/// Figma "Input" at the bottom of the widget. The assistant isn't connected yet, so sending
/// only clears the field.
struct FloatingPromptInput: View {
    let prompt: String
    /// The home and mail screens outline the input; the others don't.
    var isOutlined = false

    @State private var text = ""

    var body: some View {
        NaviPromptInput(prompt: prompt, text: $text) { _ in
            // TODO: Send to the `assistant` Edge Function once the widget is wired up.
        }
        .overlay {
            if isOutlined {
                RoundedRectangle(cornerRadius: 12).stroke(NaviTheme.border, lineWidth: 1)
            }
        }
    }
}

/// Full-width button under the widget cards ("새 일정 만들기", "이번 주 미리 준비하기").
struct FloatingWideButton: View {
    let title: String
    var isPrimary = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(NaviFont.body(12, weight: .bold))
                .foregroundStyle(isPrimary ? NaviTheme.cardWhite : NaviTheme.purple)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(isPrimary ? NaviTheme.purple : NaviTheme.lavender)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// White card holding a screen's list.
struct FloatingCard<Content: View>: View {
    var spacing: CGFloat = 10
    var horizontalPadding: CGFloat = 10
    var verticalPadding: CGFloat = 10
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

extension FloatingWidgetModel {
    /// "9월 15일, 화요일"
    static func dayTitle(_ date: Date = .now) -> String {
        TodoTabModel.format(date, "M월 d일, EEEE")
    }

    /// "오전 9:00"
    static func time(_ date: Date) -> String {
        TodoTabModel.format(date, "a h:mm")
    }
}

// MARK: - Home

/// Figma "00 - 브리핑 · 시작": greeting, then 중요 메일 / 오늘 일정 / 미리 준비할 일 cards.
private struct FloatingHomeScreen: View {
    @ObservedObject var model: FloatingWidgetModel
    let onOpenMainWindow: (MainTab?) -> Void

    var body: some View {
        FloatingChrome(
            title: greeting,
            subtitle: TodoTabModel.format(.now, "M월 d일 EEEE · a h:mm"),
            caption: "오늘 놓치면 안 될 \(itemCount)가지를 먼저 정리했어요.",
            onOpenMainWindow: onOpenMainWindow
        ) {
            BriefSection(
                title: "중요 메일 \(model.mails.count)개",
                icon: .mail,
                tint: NaviTheme.purple,
                wash: NaviTheme.lavender,
                onViewAll: { model.screen = .mails }
            ) {
                ForEach(Array(model.mails.enumerated()), id: \.element.id) { index, mail in
                    BriefItem(badge: "\(index + 1)", title: mail.briefTitle, tint: NaviTheme.purple) {
                        model.screen = .mailDetail(mail.id)
                    }
                }
            }

            BriefSection(
                title: "오늘 일정 \(model.events.count)개",
                icon: .calendar,
                tint: NaviTheme.blue,
                wash: NaviTheme.blueLight,
                onViewAll: { model.screen = .events }
            ) {
                ForEach(model.sortedEvents) { event in
                    BriefItem(badge: ScheduleBlock.time(event.startAt), title: event.title, tint: NaviTheme.blue) {
                        model.screen = .eventDetail(event.id)
                    }
                }
            }

            BriefSection(
                title: "미리 준비할 일 \(model.openTodos.count)개",
                icon: .todo,
                tint: NaviTheme.green,
                wash: NaviTheme.greenLight,
                onViewAll: { model.screen = .todos }
            ) {
                ForEach(model.openTodos) { todo in
                    FloatingTodoRow(todo: todo, model: model)
                }
            }

            FloatingPromptInput(prompt: "내가 놓친 할 일이 있어?", isOutlined: true)
        }
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: .now)
        let salutation: String
        switch hour {
        case 5..<12: salutation = "좋은 아침이에요"
        case 12..<18: salutation = "좋은 오후예요"
        default: salutation = "좋은 저녁이에요"
        }
        return model.userName.isEmpty ? "\(salutation)." : "\(salutation), \(model.userName)님."
    }

    private var itemCount: Int {
        model.mails.count + model.events.count + model.openTodos.count
    }
}

/// Figma "Brief Title" + list: a tinted subtitle chip with the section icon, "전체 보기 ›",
/// and the rows below.
private struct BriefSection<Rows: View>: View {
    let title: String
    let icon: SidebarIcon
    let tint: Color
    let wash: Color
    let onViewAll: () -> Void
    @ViewBuilder let rows: Rows

    var body: some View {
        FloatingCard(spacing: 8, verticalPadding: 7) {
            HStack {
                HStack(spacing: 6) {
                    Image(icon.assetName)
                        .resizable()
                        .frame(width: icon.size.width, height: icon.size.height)
                        .frame(width: 15, height: 15)
                    Text(title)
                        .font(NaviFont.heading(12))
                }
                .foregroundStyle(tint)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(wash)
                .clipShape(RoundedRectangle(cornerRadius: 5))

                Spacer()

                Button(action: onViewAll) {
                    HStack(spacing: 5) {
                        Text("전체 보기")
                            .font(NaviFont.body(12))
                        NaviIcon(name: "IconChevron")
                            .rotationEffect(.degrees(-90))
                    }
                    .foregroundStyle(NaviTheme.grayText)
                    .padding(.horizontal, 5)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            VStack(spacing: 5) {
                rows
            }
        }
    }
}

/// Figma "Brief Item": a small numbered / time badge and a one-line title.
private struct BriefItem: View {
    let badge: String
    let title: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Text(badge)
                    .font(NaviFont.title(8))
                    .foregroundStyle(NaviTheme.cardWhite)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 3)
                    .background(tint)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                Text(title)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Figma "Action Item" as the widget draws it: drag handle, checkbox, and title on the left;
/// category tag and due time on the right. Tapping the row opens the todo.
struct FloatingTodoRow: View {
    let todo: DashboardTodo
    @ObservedObject var model: FloatingWidgetModel

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 5) {
                DragHandle()
                HStack(spacing: 10) {
                    Button { model.toggleTodo(todo.id) } label: {
                        NaviCheckbox(isChecked: todo.isDone)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(todo.title)
                    .accessibilityValue(todo.isDone ? "완료" : "미완료")
                    Text(todo.title)
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.ink)
                        .strikethrough(todo.isDone)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                if let category = todo.category {
                    NaviTag(category: category)
                }
                if let dueAt = todo.dueAt {
                    Text(FloatingWidgetModel.time(dueAt))
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.grayText)
                }
            }
            .fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .contentShape(Rectangle())
        .onTapGesture { model.screen = .todoDetail(todo.id) }
    }
}

#Preview {
    FloatingWidgetView(model: FloatingWidgetModel()) { _ in }
        .padding()
}
