import SwiftUI

/// Figma "03 Final Prototype › 09 일정 (주)" and "09 일정 (월)".
struct CalendarTabView: View {
    @ObservedObject var model: CalendarTabModel
    let onAddCategory: () -> Void
    /// Opens the "이번 주 준비를 정리하고 있어요" dialog.
    let onStartPrep: () -> Void

    @State private var assistantText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviTabHeader(title: "일정", searchPrompt: "일정 검색", searchText: $model.searchText)
            toolbar
            switch model.mode {
            case .week: weekContent
            case .month: monthContent
            }
        }
        .task { await model.load() }
    }

    // MARK: - Toolbar ("2026년 9월", 주/월, ‹ 오늘 ›, 이번 주 미리 준비, 새 일정)

    private var toolbar: some View {
        HStack {
            Text(model.monthTitle)
                .font(NaviFont.title(22))
                .foregroundStyle(NaviTheme.dark)
            Spacer(minLength: 15)
            HStack(spacing: 15) {
                NaviSegmentTabs(items: CalendarTabModel.Mode.allCases, selection: $model.mode, title: \.title)
                HStack(spacing: 5) {
                    navButton(icon: 90, label: "이전") { model.step(-1) }
                    Button { model.goToToday() } label: {
                        Text("오늘")
                            .font(NaviFont.heading(12))
                            .foregroundStyle(NaviTheme.grayText)
                            .padding(.horizontal, 15)
                            .frame(height: 32)
                            .background(NaviTheme.cardWhite)
                            .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                    .buttonStyle(.plain)
                    navButton(icon: -90, label: "다음") { model.step(1) }
                }
                NaviPillButton(title: "이번 주 미리 준비", size: .large, action: onStartPrep)
                NaviPillButton(title: "새 일정", icon: "IconPlus", style: .primary, size: .large) {
                    model.panel = .newEvent
                }
            }
        }
    }

    private func navButton(icon rotation: Double, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            NaviIcon(name: "IconChevron")
                .rotationEffect(.degrees(rotation))
                .foregroundStyle(NaviTheme.ink)
                .padding(.horizontal, 5)
                .frame(height: 32)
                .background(NaviTheme.cardWhite)
                .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: - Week

    private var weekContent: some View {
        VStack(spacing: 10) {
            HStack(spacing: 4) {
                ForEach(model.weekDays, id: \.self) { day in
                    dayChip(day)
                }
            }
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 15) {
                    Text(model.dayTitle)
                        .font(NaviFont.heading(18))
                        .foregroundStyle(NaviTheme.ink)
                    DayTimeline(
                        day: model.selectedDay,
                        events: model.events(on: model.selectedDay),
                        selectedEventID: selectedEventID,
                        onSelect: { model.panel = .eventDetail($0.id) }
                    )
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 15)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(NaviTheme.cardWhite)
                .clipShape(RoundedRectangle(cornerRadius: 10))

                rightColumn
                    .frame(width: 439)
            }
            .padding(.bottom, 10)
        }
    }

    private func dayChip(_ day: Date) -> some View {
        let isSelected = model.isSelected(day)
        return Button { model.select(day) } label: {
            VStack(spacing: 3) {
                Text(TodoTabModel.format(day, "E"))
                    .font(NaviFont.paperlogy(12, weight: .medium))
                    .foregroundStyle(isSelected ? NaviTheme.purple : NaviTheme.grayText)
                Text(TodoTabModel.format(day, "d"))
                    .font(NaviFont.paperlogy(18, weight: .heavy))
                    .foregroundStyle(isSelected ? NaviTheme.purple : NaviTheme.dark)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(isSelected ? NaviTheme.lavender : NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay {
                if isSelected {
                    RoundedRectangle(cornerRadius: 10).stroke(NaviTheme.purple, lineWidth: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var selectedEventID: UUID? {
        if case .eventDetail(let id) = model.panel { return id }
        return nil
    }

    // MARK: - Month

    private var monthContent: some View {
        HStack(alignment: .top, spacing: 10) {
            MonthCalendarGrid(model: model)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(NaviTheme.cardWhite)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            rightColumn
                .frame(width: 284)
        }
        .padding(.bottom, 10)
    }

    // MARK: - Right column

    private var rightColumn: some View {
        VStack(spacing: 10) {
            rightPanel
                .frame(maxHeight: .infinity, alignment: .top)
            NaviPromptInput(prompt: "빈 시간에 할 일을 배치해 줘", text: $assistantText, onSubmit: model.sendAssistantPrompt)
        }
        .frame(maxHeight: .infinity)
    }

    @ViewBuilder
    private var rightPanel: some View {
        switch model.panel {
        case .overview:
            CalendarOverviewPanels(model: model, onAddCategory: onAddCategory)
        case .newEvent:
            NewEventPanel(
                categories: model.categories.map(\.category),
                draft: model.makeEventDraft(),
                onCancel: { model.panel = .overview },
                onSave: model.addEvent
            )
        case .eventDetail(let id):
            if let event = model.event(id) {
                NewEventPanel(
                    categories: model.categories.map(\.category),
                    draft: model.draft(for: event),
                    panelTitle: event.title,
                    onCancel: { model.panel = .overview },
                    onSave: { try await model.updateEvent(id, with: $0) }
                )
                .id(id)
            }
        case .dayDetail:
            VStack(alignment: .leading, spacing: 15) {
                NaviPanelHeader(title: TodoTabModel.format(model.selectedDay, "M월 d일 · EEEE")) {
                    model.panel = .overview
                }
                DayTimeline(
                    day: model.selectedDay,
                    events: model.events(on: model.selectedDay),
                    onSelect: { model.panel = .eventDetail($0.id) }
                )
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        case .prep:
            CalendarPrepPanel(model: model)
        case .prepCriteria:
            PrepCriteriaPanel(model: model, onRecommend: onStartPrep)
        case .prepDetail(let id):
            if let suggestion = model.suggestions.first(where: { $0.id == id }) {
                PrepDetailPanel(
                    categories: model.todoModel.categories,
                    suggestion: suggestion,
                    onCancel: { model.panel = .prep },
                    onAdd: { try await model.addSuggestion($0) }
                )
            }
        case .prepAdded(let added):
            PrepAddedPanel(added: added, onClose: { model.panel = .overview })
        }
    }
}

// MARK: - Month grid

/// Figma "September 2026 · month grid": weekday header, then one row per week; today's number
/// is a purple square, the selected day's column is tinted, and events are small tinted chips.
private struct MonthCalendarGrid: View {
    @ObservedObject var model: CalendarTabModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(Array(["일", "월", "화", "수", "목", "금", "토"].enumerated()), id: \.offset) { index, name in
                    Text(name)
                        .font(NaviFont.paperlogy(14))
                        .foregroundStyle(NaviTheme.grayMain)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .overlay(alignment: .leading) { if index > 0 { divider(vertical: true) } }
                }
            }
            .overlay(alignment: .bottom) { divider(vertical: false) }

            ForEach(model.monthWeeks, id: \.self) { week in
                HStack(spacing: 0) {
                    ForEach(Array(week.enumerated()), id: \.element) { index, day in
                        cell(day)
                            .overlay(alignment: .leading) { if index > 0 { divider(vertical: true) } }
                    }
                }
                .frame(maxHeight: .infinity)
                .overlay(alignment: .bottom) { divider(vertical: false) }
            }
        }
    }

    private func divider(vertical: Bool) -> some View {
        Rectangle()
            .fill(NaviTheme.border)
            .frame(width: vertical ? 1 : nil, height: vertical ? nil : 1)
    }

    private func cell(_ day: Date) -> some View {
        let isToday = model.isToday(day)
        let inMonth = model.isInSelectedMonth(day)
        let events = model.events(on: day)
        return Button { model.select(day) } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(TodoTabModel.format(day, "d"))
                    .font(NaviFont.body(10, weight: isToday ? .bold : .regular))
                    .foregroundStyle(isToday ? NaviTheme.cardWhite : inMonth ? NaviTheme.primaryText : NaviTheme.border)
                    .frame(width: 23, height: 23)
                    .background(isToday ? NaviTheme.purple : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                ForEach(events.prefix(3)) { event in
                    let tint = event.category.map { Color(naviHex: $0.color) } ?? NaviTheme.purple
                    Text(event.title)
                        .font(NaviFont.body(10, weight: .bold))
                        .foregroundStyle(tint)
                        .lineLimit(1)
                        .padding(.leading, 4)
                        .frame(maxWidth: .infinity, minHeight: 20, maxHeight: 20, alignment: .leading)
                        .background { ZStack { NaviTheme.cardWhite; tint.opacity(0.14) } }
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
                if events.count > 3 {
                    Text("+\(events.count - 3)")
                        .font(NaviFont.body(9))
                        .foregroundStyle(NaviTheme.grayText)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 7)
            .padding(.top, 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(model.isSelected(day) && model.panel == .dayDetail ? NaviTheme.selectedCell : NaviTheme.cardWhite)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(TodoTabModel.format(day, "M월 d일")), 일정 \(events.count)개")
    }
}

// MARK: - Overview panels

private struct CalendarOverviewPanels: View {
    @ObservedObject var model: CalendarTabModel
    let onAddCategory: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 10) {
                NaviSectionHeader(title: "일정에서 만든 할 일", tag: "\(model.calendarTodos.count)개")
                ScrollView {
                    VStack(spacing: 7) {
                        if model.calendarTodos.isEmpty {
                            Text("일정에서 만든 할 일이 아직 없어요. \"이번 주 미리 준비\"로 추천을 받아 보세요.")
                                .font(NaviFont.body(12))
                                .foregroundStyle(NaviTheme.grayText)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        ForEach(model.calendarTodos) { todo in
                            TodoItemRow(
                                todo: todo,
                                meta: TodoItemRow.dashboardMeta(for: todo),
                                showsDetails: false,
                                onToggle: { model.todoModel.toggle(todo.id) },
                                onOpen: {}
                            )
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 15) {
                HStack {
                    Text("카테고리")
                        .font(NaviFont.heading(18))
                        .foregroundStyle(NaviTheme.ink)
                    Spacer()
                    NaviPillButton(title: "추가", icon: "IconPlus", action: onAddCategory)
                }
                ScrollView {
                    VStack(spacing: 10) {
                        if model.categories.isEmpty {
                            Text("카테고리를 추가해 일정을 나눠 보세요.")
                                .font(NaviFont.body(12))
                                .foregroundStyle(NaviTheme.grayText)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        ForEach(model.categories, id: \.category.id) { item in
                            Button { model.toggleVisibility(of: item.category.id) } label: {
                                HStack {
                                    NaviTag(category: item.category, fontSize: 11)
                                    Spacer()
                                    NaviCheckbox(isChecked: item.isVisible)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(item.category.name) 표시")
                            .accessibilityValue(item.isVisible ? "켬" : "끔")
                        }
                    }
                    .padding(.horizontal, 10)
                }
                .scrollIndicators(.hidden)
                if let error = model.errorMessage {
                    Text(error)
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.red)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 15)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}

// MARK: - Prep panels

private struct CalendarPrepPanel: View {
    @ObservedObject var model: CalendarTabModel
    @State private var isAdding = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviPanelHeader(title: "이번 주 미리 준비") { model.panel = .overview }
            Text("\(model.weekRangeText) · 추천을 검토해 주세요.\n선택한 항목만 반영하며, 일정은 바꾸지 않아요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
                .fixedSize(horizontal: false, vertical: true)
            NaviDialogButton(title: "추천 기준 확인", role: .secondary) { model.panel = .prepCriteria }
            ScrollView {
                VStack(spacing: 5) {
                    ForEach(model.suggestions) { suggestion in
                        SuggestionCard(suggestion: suggestion) {
                            model.toggleSuggestion(suggestion.id)
                        } onOpen: {
                            model.panel = .prepDetail(suggestion.id)
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
            NaviDialogButton(
                title: isAdding ? "추가 중…" : "선택한 할 일 추가",
                isEnabled: model.suggestions.contains(where: \.isSelected) && !isAdding
            ) {
                isAdding = true
                Task {
                    await model.addSelectedSuggestions()
                    isAdding = false
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

private struct PrepCriteriaPanel: View {
    @ObservedObject var model: CalendarTabModel
    let onRecommend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviPanelHeader(title: "추천 기준") { model.panel = .overview }
            criterion("메일", $model.criteria.mail)
            criterion("미완료 할 일", $model.criteria.incompleteTodos)
            criterion("연관 할 일", $model.criteria.relatedTodos)
            criterion("사용자 패턴", $model.criteria.userPattern)
            Text("패턴: 최근 4주 · 준비 완료 시점\n미연동 서비스의 정보는 사용하지 않아요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            NaviDialogButton(title: "이 기준으로 다시 추천", action: onRecommend)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 15)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func criterion(_ title: String, _ isOn: Binding<Bool>) -> some View {
        Button { isOn.wrappedValue.toggle() } label: {
            HStack {
                Text(title)
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.ink)
                Spacer()
                NaviCheckCircle(isOn: isOn.wrappedValue)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Prep dialogs

/// "이번 주 준비를 정리하고 있어요": the steps being run, with 취소.
struct PrepLoadingDialog: View {
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 15) {
            NaviMascotView(width: 129)
            Text("이번 주 준비를 정리하고 있어요")
                .font(NaviFont.title(25))
                .foregroundStyle(NaviTheme.ink)
            Text("메일·할 일·사용자 패턴을 연결하고 기존 할 일과의 중복을 확인해요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
            VStack(spacing: 10) {
                ForEach(["메일에서 준비 요청 찾기", "미완료 할 일 확인하기", "연관 할 일 연결하기", "사용자 패턴 반영하기"], id: \.self) { step in
                    Text(step)
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.dark)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(NaviTheme.itemBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
            NaviButton(title: "취소", style: .secondary, action: onCancel)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 25)
        .frame(width: 460)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.14), radius: 14, y: 10)
    }
}

/// "추천에 사용할 정보가 없어요": no criteria selected.
struct PrepNoDataDialog: View {
    let onSetCriteria: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 15) {
            NaviMascotView(width: 129)
            Text("추천에 사용할 정보가 없어요")
                .font(NaviFont.title(25))
                .foregroundStyle(NaviTheme.ink)
            Text("추천 기준을 하나 이상 선택해 주세요.\n메일, 할 일과 패턴으로 추천할 수 있어요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
                .multilineTextAlignment(.center)
            NaviButton(title: "추천 기준 설정", action: onSetCriteria)
            NaviButton(title: "일정으로 돌아가기", style: .secondary, action: onDismiss)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 25)
        .frame(width: 460)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.14), radius: 14, y: 10)
    }
}
