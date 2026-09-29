import SwiftUI

/// Window-wide modal dialogs, shown over a dimmed scrim.
enum MainDialog: Equatable {
    case passwordChange
    case googleDisconnect
    case newTodoCategory
    case newCalendarCategory
    case calendarPrepLoading
    case calendarPrepNoData
    case mailSent(MailDraft)
    case mailDraftSaved(MailDraft)
}

/// Top-level destinations of the main window sidebar.
enum MainTab: String, CaseIterable, Identifiable {
    case dashboard
    case mail
    case calendar
    case todo
    case chat
    case settings

    var id: Self { self }

    var title: String {
        switch self {
        case .dashboard: return "대시보드"
        case .mail: return "메일"
        case .calendar: return "일정"
        case .todo: return "할 일"
        case .chat: return "채팅"
        case .settings: return "설정"
        }
    }

    /// Figma sidebar icon (template SVG in the asset catalog) for this tab.
    var icon: SidebarIcon {
        switch self {
        case .dashboard: return .dashboard
        case .mail: return .mail
        case .calendar: return .calendar
        case .todo: return .todo
        case .chat: return .chat
        case .settings: return .settings
        }
    }

    /// Tabs listed at the top of the sidebar; settings sits in the bottom group.
    static let primaryTabs: [MainTab] = [.dashboard, .mail, .calendar, .todo, .chat]
}

/// Main window shell: a white sidebar card on the left and the selected screen on the right,
/// matching the Figma "App screen" frame.
struct MainWindowView: View {
    @ObservedObject var sessionStore: AppSessionStore
    let onResetOnboarding: () -> Void
    let onSignOut: () -> Void

    @StateObject private var settingsModel: SettingsModel
    @StateObject private var dashboardModel: DashboardModel
    @StateObject private var todoModel: TodoTabModel
    @StateObject private var calendarModel: CalendarTabModel
    @StateObject private var mailModel: MailTabModel
    @StateObject private var chatModel: ChatTabModel
    @State private var selection: MainTab = .dashboard
    @State private var isSidebarCollapsed = false
    @State private var activeDialog: MainDialog?
    @State private var mailConnectStep: ServiceConnectFlow.Step = .prompt
    @State private var calendarConnectStep: ServiceConnectFlow.Step = .prompt

    init(
        sessionStore: AppSessionStore,
        onResetOnboarding: @escaping () -> Void,
        onSignOut: @escaping () -> Void
    ) {
        self.sessionStore = sessionStore
        self.onResetOnboarding = onResetOnboarding
        self.onSignOut = onSignOut
        let settingsModel = SettingsModel(sessionStore: sessionStore)
        _settingsModel = StateObject(wrappedValue: settingsModel)
        let store = sessionStore.makeTodoStore()
        let services = sessionStore.makeEdgeServices()
        _dashboardModel = StateObject(wrappedValue: DashboardModel(store: store, services: services))
        let todoModel = TodoTabModel(store: store, services: services)
        _todoModel = StateObject(wrappedValue: todoModel)
        _calendarModel = StateObject(wrappedValue: CalendarTabModel(store: store, services: services, todoModel: todoModel))
        _mailModel = StateObject(wrappedValue: MailTabModel(
            todoModel: todoModel,
            services: services,
            senderAddress: settingsModel.services.googleEmail ?? settingsModel.loginEmail,
            senderName: settingsModel.name
        ))
        _chatModel = StateObject(wrappedValue: ChatTabModel(todoModel: todoModel, services: services))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            MainSidebar(selection: $selection, isCollapsed: $isSidebarCollapsed)
            content
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 10)
        .background(NaviTheme.canvas)
        .overlay {
            // Dialogs dim the whole window (sidebar included), per the Figma scrim.
            if let activeDialog {
                ZStack {
                    Color.black.opacity(0.32)
                        .ignoresSafeArea()
                        .onTapGesture { self.activeDialog = nil }
                    switch activeDialog {
                    case .passwordChange:
                        PasswordChangeDialog(model: settingsModel) { self.activeDialog = nil }
                    case .googleDisconnect:
                        GoogleDisconnectDialog(model: settingsModel) { self.activeDialog = nil }
                    case .newTodoCategory:
                        CategoryDialog(onCancel: { self.activeDialog = nil }) { name, color in
                            try await todoModel.addCategory(name: name, color: color)
                        }
                    case .newCalendarCategory:
                        CategoryDialog(onCancel: { self.activeDialog = nil }) { name, color in
                            try await calendarModel.addCategory(name: name, color: color)
                        }
                    case .calendarPrepLoading:
                        PrepLoadingDialog { self.activeDialog = nil }
                            .task {
                                // The dialog stays up for the todo-ai request, and at least long
                                // enough to read its steps.
                                async let minimumDisplay: Void? = try? Task.sleep(for: .seconds(1.2))
                                let hasSuggestions = await calendarModel.generateSuggestions()
                                _ = await minimumDisplay
                                guard self.activeDialog == .calendarPrepLoading else { return }
                                self.activeDialog = hasSuggestions ? nil : .calendarPrepNoData
                            }
                    case .calendarPrepNoData:
                        PrepNoDataDialog(
                            onSetCriteria: {
                                calendarModel.panel = .prepCriteria
                                self.activeDialog = nil
                            },
                            onDismiss: { self.activeDialog = nil }
                        )
                    case .mailSent(let draft), .mailDraftSaved(let draft):
                        MailResultDialog(draft: draft, isSent: activeDialog == .mailSent(draft)) {
                            mailModel.filter = .all
                            self.activeDialog = nil
                        }
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.15), value: activeDialog)
        .floatingWidgetBridge(selection: $selection, userName: settingsModel.name)
        // Sign-out is also in the app menu (see `AccountCommands`), next to settings' 로그아웃.
        .focusedSceneValue(\.accountActions, AccountActions(
            signOut: onSignOut,
            resetOnboarding: onResetOnboarding
        ))
    }

    @ViewBuilder
    private var content: some View {
        switch selection {
        case .dashboard:
            DashboardView(
                sessionStore: sessionStore,
                model: dashboardModel,
                settingsModel: settingsModel,
                onSelectTab: { selection = $0 },
                onConnect: { service in
                    // The dashboard card already asked to connect, so skip the tab's prompt.
                    switch service {
                    case .mail:
                        mailConnectStep = .chooser
                        selection = .mail
                    case .calendar:
                        calendarConnectStep = .chooser
                        selection = .calendar
                    }
                }
            )
        case .settings:
            SettingsView(
                sessionStore: sessionStore,
                model: settingsModel,
                activeDialog: $activeDialog,
                onSignOut: onSignOut
            )
        // The flow stays up after connecting so its "연동 완료" screen can show.
        case .mail where !settingsModel.services.mailConnected || mailConnectStep == .success:
            ServiceConnectFlow(
                service: .mail,
                sessionStore: sessionStore,
                model: settingsModel,
                step: $mailConnectStep,
                onFinish: { mailConnectStep = .prompt }
            )
        case .calendar where !settingsModel.services.calendarConnected || calendarConnectStep == .success:
            ServiceConnectFlow(
                service: .calendar,
                sessionStore: sessionStore,
                model: settingsModel,
                step: $calendarConnectStep,
                onFinish: { calendarConnectStep = .prompt }
            )
        case .todo:
            TodoTabView(model: todoModel) { activeDialog = .newTodoCategory }
        case .calendar:
            CalendarTabView(
                model: calendarModel,
                onAddCategory: { activeDialog = .newCalendarCategory },
                onStartPrep: { activeDialog = .calendarPrepLoading }
            )
        case .mail:
            MailTabView(model: mailModel) { activeDialog = $0 }
        case .chat:
            ChatTabView(model: chatModel)
        }
    }
}

private struct MainSidebar: View {
    @Binding var selection: MainTab
    @Binding var isCollapsed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            logo
            VStack(spacing: 5) {
                ForEach(MainTab.primaryTabs) { tab in
                    item(tab.title, icon: tab.icon, isSelected: selection == tab) {
                        selection = tab
                    }
                }
            }
            Spacer(minLength: 0)
            VStack(spacing: 5) {
                item(
                    isCollapsed ? "사이드바 열기" : "사이드바 숨김",
                    icon: .sidebarToggle,
                    isSelected: false
                ) {
                    withAnimation(.easeInOut(duration: 0.2)) { isCollapsed.toggle() }
                }
                item(
                    MainTab.settings.title,
                    icon: MainTab.settings.icon,
                    isSelected: selection == .settings
                ) {
                    selection = .settings
                }
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 20)
        // Figma "Sidebar" component: 175pt expanded, 85pt collapsed (isCollapsed=True).
        .frame(width: isCollapsed ? 85 : 175)
        .frame(maxHeight: .infinity)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 15))
    }

    private var logo: some View {
        HStack(spacing: 9.7) {
            Image("LogoMark")
                .resizable()
                .scaledToFit()
                .frame(width: 30, height: 30)
            if !isCollapsed {
                Image("LogoWordmark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 58, height: 18.4)
            }
        }
        .frame(maxWidth: .infinity, alignment: isCollapsed ? .center : .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("navi")
    }

    private func item(
        _ title: String,
        icon: SidebarIcon,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(icon.assetName)
                    .resizable()
                    .frame(width: icon.size.width, height: icon.size.height)
                    .frame(width: 15, height: 15)
                if !isCollapsed {
                    Text(title)
                        .font(NaviFont.paperlogy(12, weight: isSelected ? .bold : .regular))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(isSelected ? NaviTheme.cardWhite : NaviTheme.grayText)
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: isCollapsed ? .center : .leading)
            .background(isSelected ? NaviTheme.purple : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Sidebar glyphs exported from the Figma "Icon" component. Each SVG keeps its own artboard
/// size (stroke overflow included), centered in the 15×15 icon slot like in Figma.
enum SidebarIcon {
    case dashboard, mail, calendar, todo, chat, sidebarToggle, settings

    var assetName: String {
        switch self {
        case .dashboard: return "SidebarDashboard"
        case .mail: return "SidebarMail"
        case .calendar: return "SidebarCalendar"
        case .todo: return "SidebarTodo"
        case .chat: return "SidebarChat"
        case .sidebarToggle: return "SidebarToggle"
        case .settings: return "SidebarSettings"
        }
    }

    var size: CGSize {
        switch self {
        case .dashboard: return CGSize(width: 12.25, height: 12.25)
        case .calendar: return CGSize(width: 13.35, height: 12.69)
        case .sidebarToggle: return CGSize(width: 13, height: 12)
        case .settings: return CGSize(width: 12.6, height: 14)
        case .mail, .todo, .chat: return CGSize(width: 15, height: 15)
        }
    }
}
