import SwiftUI

// Right-column panels of the todo tab (Figma "10 - 할 일 > 상세", "> 상세 > 기한 변경",
// "> 이번 주 미리 준비", "> 이번 주 미리 준비 > 상세", "> 이번 주 준비 > 추가 완료").

// MARK: - Detail

struct TodoDetailPanel: View {
    @ObservedObject var model: TodoTabModel
    let todo: DashboardTodo

    @State private var title = ""
    @State private var newSubtask = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            NaviPanelHeader(title: "할 일 상세") { model.panel = .overview }

            HStack(spacing: 10) {
                Button { model.toggle(todo.id) } label: {
                    NaviCheckbox(isChecked: todo.isDone, size: 18, uncheckedBorder: NaviTheme.border)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(todo.isDone ? "완료 취소" : "완료")
                TextField("", text: $title)
                    .textFieldStyle(.plain)
                    .font(NaviFont.body(16, weight: .bold))
                    .foregroundStyle(NaviTheme.ink)
                    .strikethrough(todo.isDone)
                    .onSubmit { model.rename(todo.id, to: title) }
            }

            Button { model.panel = .deadline(todo.id) } label: {
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
                    categories: model.categories,
                    selection: Binding(get: { todo.category }, set: { model.setCategory($0, of: todo.id) })
                )
            }

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
                ScrollView {
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
                            TextField(
                                "",
                                text: $newSubtask,
                                prompt: Text("할 일 추가").foregroundStyle(NaviTheme.grayText)
                            )
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
                .scrollIndicators(.hidden)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .onAppear { title = todo.title }
        .onChange(of: todo.id) { title = todo.title }
        .onDisappear { model.rename(todo.id, to: title) }
    }

    /// "오늘 · 오후 5:00", "내일 · 오전 9:00", "9월 30일 · 오후 6:00", or "기한 없음".
    private var deadlineText: String {
        guard let dueAt = todo.dueAt else { return "기한 없음" }
        let calendar = Calendar.current
        let time = TodoTabModel.format(dueAt, "a h:mm")
        if calendar.isDateInToday(dueAt) { return "오늘 · \(time)" }
        if calendar.isDateInTomorrow(dueAt) { return "내일 · \(time)" }
        return "\(TodoTabModel.format(dueAt, "M월 d일")) · \(time)"
    }
}

// MARK: - Deadline

/// "기한 변경": month grid (일–토) with the selected day in lavender, then hour / minute / 오전·오후
/// chips, 취소 and 적용.
struct DeadlinePanel: View {
    let initial: Date
    /// The floating widget hides the header X; its back link and 취소 already close the panel.
    var showsCloseButton = true
    let onCancel: () -> Void
    let onApply: (Date) -> Void

    @State private var month: Date = .now
    @State private var selectedDay: Date = .now
    @State private var hour = 7
    @State private var minute = 0
    @State private var isPM = true

    private var calendar: Calendar {
        var calendar = Calendar.current
        calendar.firstWeekday = 1
        return calendar
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            NaviPanelHeader(title: "기한 변경", onClose: showsCloseButton ? onCancel : nil)

            VStack(alignment: .leading, spacing: 15) {
                HStack {
                    Text(TodoTabModel.format(month, "yyyy년 M월"))
                        .font(NaviFont.title(16))
                        .foregroundStyle(NaviTheme.dark)
                    Spacer()
                    HStack(spacing: 5) {
                        monthButton(-1, rotation: 90, label: "이전 달")
                        monthButton(1, rotation: -90, label: "다음 달")
                    }
                }
                MonthGrid(month: month, selected: selectedDay, calendar: calendar) { selectedDay = $0 }
            }

            HStack {
                Text("시간")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.dark)
                Spacer()
                HStack(spacing: 5) {
                    TimeChip(value: String(format: "%02d", hour), options: (1...12).map { String(format: "%02d", $0) }) {
                        hour = Int($0) ?? hour
                    }
                    TimeChip(value: String(format: "%02d", minute), options: stride(from: 0, to: 60, by: 5).map { String(format: "%02d", $0) }) {
                        minute = Int($0) ?? minute
                    }
                    TimeChip(value: isPM ? "PM" : "AM", options: ["AM", "PM"]) { isPM = $0 == "PM" }
                }
            }

            HStack(spacing: 10) {
                NaviDialogButton(title: "취소", role: .secondary, action: onCancel)
                NaviDialogButton(title: "적용") { onApply(resolvedDate) }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .onAppear {
            month = initial
            selectedDay = initial
            let components = calendar.dateComponents([.hour, .minute], from: initial)
            let hour24 = components.hour ?? 19
            isPM = hour24 >= 12
            hour = hour24 % 12 == 0 ? 12 : hour24 % 12
            minute = ((components.minute ?? 0) / 5) * 5
        }
    }

    private var resolvedDate: Date {
        let hour24 = (hour % 12) + (isPM ? 12 : 0)
        return calendar.date(bySettingHour: hour24, minute: minute, second: 0, of: selectedDay) ?? selectedDay
    }

    private func monthButton(_ offset: Int, rotation: Double, label: String) -> some View {
        Button {
            month = calendar.date(byAdding: .month, value: offset, to: month) ?? month
        } label: {
            NaviIcon(name: "IconChevron")
                .rotationEffect(.degrees(rotation))
                .foregroundStyle(NaviTheme.ink)
                .padding(5)
                .background(NaviTheme.itemBackground)
                .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// Figma date grid: S M T W T F S header, a divider, and six week rows; days outside the
/// month are light gray, the selected day is bold purple on lavender.
struct MonthGrid: View {
    let month: Date
    let selected: Date
    let calendar: Calendar
    let onSelect: (Date) -> Void

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 0) {
                ForEach(Array(["S", "M", "T", "W", "T", "F", "S"].enumerated()), id: \.offset) { _, letter in
                    Text(letter)
                        .font(NaviFont.body(12.8))
                        .foregroundStyle(NaviTheme.grayText)
                        .frame(maxWidth: .infinity)
                }
            }
            Rectangle().fill(NaviTheme.border).frame(height: 1)
            ForEach(weeks, id: \.self) { week in
                HStack(spacing: 0) {
                    ForEach(week, id: \.self) { day in
                        dayCell(day)
                    }
                }
            }
        }
    }

    private func dayCell(_ day: Date) -> some View {
        let inMonth = calendar.isDate(day, equalTo: month, toGranularity: .month)
        let isSelected = calendar.isDate(day, inSameDayAs: selected)
        return Button { onSelect(day) } label: {
            Text("\(calendar.component(.day, from: day))")
                .font(NaviFont.body(isSelected ? 10 : 12.8, weight: isSelected ? .bold : .regular))
                .foregroundStyle(isSelected ? NaviTheme.purple : inMonth ? NaviTheme.grayText : NaviTheme.border)
                .frame(width: 29.5, height: 27)
                .background(isSelected ? NaviTheme.lavender : .clear)
                .clipShape(RoundedRectangle(cornerRadius: 5))
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TodoTabModel.format(day, "M월 d일"))
    }

    private var weeks: [[Date]] {
        guard let interval = calendar.dateInterval(of: .month, for: month),
              let firstWeek = calendar.dateInterval(of: .weekOfMonth, for: interval.start)
        else { return [] }
        // Only the weeks that touch this month (Figma shows 5 rows for September 2026).
        return (0..<6).map { week in
            (0..<7).compactMap { day in
                calendar.date(byAdding: .day, value: week * 7 + day, to: firstWeek.start)
            }
        }
        .filter { week in week.contains { calendar.isDate($0, equalTo: month, toGranularity: .month) } }
    }
}

/// A lavender 45pt chip showing a value; opens a menu of options.
private struct TimeChip: View {
    let value: String
    let options: [String]
    let onSelect: (String) -> Void

    var body: some View {
        Menu {
            ForEach(options, id: \.self) { option in
                Button(option) { onSelect(option) }
            }
        } label: {
            Text(value)
                .font(NaviFont.title(14))
                .foregroundStyle(NaviTheme.purple)
                .frame(width: 45)
                .padding(.vertical, 5)
                .background(NaviTheme.lavender)
                .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}

// MARK: - Weekly prep

struct WeeklyPrepPanel: View {
    @ObservedObject var model: TodoTabModel
    @State private var isAdding = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviPanelHeader(title: "이번 주 미리 준비") { model.panel = .overview }
            Text("다가오는 일정에 맞춰 추천했어요.\n추가하기 전 이름과 기한을 확인하세요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
                .fixedSize(horizontal: false, vertical: true)

            if model.isLoadingSuggestions {
                Text("이번 주 일정을 보고 할 일을 정리하고 있어요…")
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.grayText)
                    .padding(.vertical, 8)
            } else if model.suggestions.isEmpty {
                Text(model.errorMessage ?? "이번 주에 추천할 할 일이 없어요.")
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.grayText)
                    .padding(.vertical, 8)
            }
            ScrollView {
                VStack(spacing: 10) {
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
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

/// Figma "Recommendation": title + category tag, deadline, and "reason · effort" with an
/// optional selection check.
struct SuggestionCard: View {
    let suggestion: PrepSuggestion
    var onToggle: (() -> Void)?
    var onOpen: (() -> Void)?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(suggestion.title)
                        .font(NaviFont.title(14))
                        .foregroundStyle(NaviTheme.ink)
                        .lineLimit(1)
                    if let category = suggestion.category {
                        NaviTag(category: category)
                    }
                }
                Text(TodoAddedPanel.dueText(suggestion.dueAt))
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.dark)
                if !suggestion.reason.isEmpty {
                    Text("\(Text(suggestion.reason).foregroundStyle(suggestion.isUrgent ? NaviTheme.red : NaviTheme.grayText))\(suggestion.effort.isEmpty ? "" : " · \(suggestion.effort)")")
                        .foregroundStyle(NaviTheme.grayText)
                        .font(NaviFont.body(10))
                }
            }
            Spacer(minLength: 8)
            if let onToggle {
                Button(action: onToggle) {
                    NaviCheckCircle(isOn: suggestion.isSelected)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(suggestion.isSelected ? "선택 해제" : "선택")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { onOpen?() }
    }
}

struct PrepDetailPanel: View {
    let categories: [NaviCategory]
    @State var suggestion: PrepSuggestion
    let onCancel: () -> Void
    let onAdd: (PrepSuggestion) async throws -> Void

    @State private var isSaving = false
    @State private var saveError: String?

    var body: some View {
        NaviPanel(fillsHeight: true) {
            NaviPanelHeader(title: "할 일 추천 상세", onClose: onCancel)
            NaviTextField(title: "할 일", text: $suggestion.title, size: .compact)
            NaviDateField(title: "기한", date: $suggestion.dueAt)
            HStack {
                Text("카테고리")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.dark)
                Spacer()
                NaviCategoryPicker(categories: categories, selection: $suggestion.category)
            }
            Spacer(minLength: 0)
            if let saveError {
                Text(saveError)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.red)
            }
            HStack(spacing: 8) {
                NaviDialogButton(title: "취소", role: .cancel, action: onCancel)
                NaviDialogButton(
                    title: isSaving ? "추가 중…" : "할 일 추가",
                    isEnabled: !suggestion.title.trimmingCharacters(in: .whitespaces).isEmpty && !isSaving
                ) {
                    isSaving = true
                    Task {
                        do {
                            try await onAdd(suggestion)
                        } catch {
                            saveError = "할 일을 추가하지 못했어요."
                        }
                        isSaving = false
                    }
                }
            }
        }
    }
}

struct PrepAddedPanel: View {
    let added: [PrepSuggestion]
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Spacer()
                NaviCloseButton(action: onClose)
            }
            .frame(height: 26)
            VStack(spacing: 10) {
                Image("IconCheckedCircle")
                    .resizable()
                    .frame(width: 50, height: 50)
                    .accessibilityHidden(true)
                Text("할 일 추가 완료")
                    .font(NaviFont.heading(18))
                    .foregroundStyle(NaviTheme.ink)
                Text("선택한 추천 할 일이 목록에 추가됐어요.")
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.grayText)
            }
            .frame(maxWidth: .infinity)
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(added) { SuggestionCard(suggestion: $0) }
                }
            }
            .scrollIndicators(.hidden)
            NaviDialogButton(title: "할 일 목록으로", action: onClose)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

/// Figma "Checked" (30pt): green check on a light green circle, or an empty outlined circle.
struct NaviCheckCircle: View {
    let isOn: Bool

    var body: some View {
        ZStack {
            Circle().fill(isOn ? NaviTheme.greenLight : NaviTheme.cardWhite)
            Circle().stroke(isOn ? Color.clear : NaviTheme.border, lineWidth: 1)
            if isOn {
                Image("IconCheck")
                    .resizable()
                    .frame(width: 13, height: 9.5)
                    .foregroundStyle(NaviTheme.green)
            }
        }
        .frame(width: 30, height: 30)
    }
}
