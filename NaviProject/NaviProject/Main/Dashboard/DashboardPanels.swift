import SwiftUI

// Right-column panels the dashboard swaps in for "오늘 일정" while adding something.
// Layouts follow Figma "03 Final Prototype": "10 - 할 일 > 새 할 일 추가",
// "10 - 할 일 > 새 할 일 > 추가 완료", and "09 - 일정 (주) > 새 일정".

// MARK: - New todo

struct NewTodoPanel: View {
    let categories: [NaviCategory]
    @State var draft: NewTodoDraft
    let onCancel: () -> Void
    let onSave: (NewTodoDraft) async throws -> Void

    @State private var isSaving = false
    @State private var saveError: String?

    var body: some View {
        NaviPanel(fillsHeight: true) {
            NaviPanelHeader(title: "새 할 일", onClose: onCancel)
            NaviTextField(title: "할 일", text: $draft.title, size: .compact)
                .onSubmit(save)
            NaviDateField(title: "기한", date: $draft.dueAt)
            HStack {
                Text("카테고리")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.dark)
                Spacer()
                NaviCategoryPicker(categories: categories, selection: $draft.category)
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
                    title: isSaving ? "저장 중…" : "할 일 저장",
                    isEnabled: draft.isValid && !isSaving,
                    action: save
                )
            }
        }
    }

    private func save() {
        guard draft.isValid, !isSaving else { return }
        isSaving = true
        saveError = nil
        Task {
            do {
                try await onSave(draft)
            } catch {
                saveError = "할 일을 저장하지 못했어요. 다시 시도해 주세요."
            }
            isSaving = false
        }
    }
}

/// "할 일 추가 완료": green check, summary card of the new todo, and a way to the todo list.
struct TodoAddedPanel: View {
    let todo: DashboardTodo
    let onClose: () -> Void
    let onOpenTodos: () -> Void

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
                Text(message)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.grayText)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(todo.title)
                        .font(NaviFont.title(14))
                        .foregroundStyle(NaviTheme.ink)
                        .lineLimit(1)
                    if let category = todo.category {
                        NaviTag(category: category)
                    }
                }
                if let dueAt = todo.dueAt {
                    Text(Self.dueText(dueAt))
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.dark)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            Spacer(minLength: 0)

            NaviDialogButton(title: "할 일 목록으로", action: onOpenTodos)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    /// Todos due on another day don't show up under "오늘 할 일", so say where they went.
    private var message: String {
        guard let dueAt = todo.dueAt, !Calendar.current.isDateInToday(dueAt) else {
            return "새 할 일이 목록에 추가됐어요."
        }
        return "새 할 일이 목록에 추가됐어요. 기한 날짜의 할 일에서 볼 수 있어요."
    }

    /// "9월 17일 · 오후 5:00"
    static func dueText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = "M월 d일 · a h:mm"
        return formatter.string(from: date)
    }
}

// MARK: - New event

struct NewEventPanel: View {
    let categories: [NaviCategory]
    @State var draft: NewEventDraft
    /// "새 일정", or the event's title when editing ("09 - 일정 > 일정 상세").
    var panelTitle = "새 일정"
    let onCancel: () -> Void
    /// Writes Google Calendar through the `calendar` Edge Function; throws to keep the form.
    let onSave: (NewEventDraft) async throws -> Void

    @State private var isSaving = false
    @State private var saveError: String?

    var body: some View {
        NaviPanel(fillsHeight: true) {
            NaviPanelHeader(title: panelTitle, onClose: onCancel)
            NaviTextField(title: "일정 이름", text: $draft.title, size: .compact)
            HStack {
                Text("카테고리")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.dark)
                Spacer()
                NaviCategoryPicker(categories: categories, selection: $draft.category)
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("기간")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.ink)
                HStack(spacing: 8) {
                    NaviDateField(title: "시작", date: $draft.startAt)
                    NaviDateField(title: "종료", date: $draft.endAt)
                }
                if draft.endAt <= draft.startAt {
                    Text("종료 시간은 시작 시간보다 늦어야 해요.")
                        .font(NaviFont.body(10))
                        .foregroundStyle(NaviTheme.red)
                }
            }
            NaviTextField(title: "장소", text: $draft.location, size: .compact)
            VStack(alignment: .leading, spacing: 8) {
                Text("미리보기")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.ink)
                ScheduleBlock(
                    title: draft.title.isEmpty ? "새 일정" : draft.title,
                    timeRange: ScheduleBlock.timeRange(draft.startAt, draft.endAt),
                    location: draft.location.isEmpty ? nil : draft.location,
                    tint: draft.category.map { Color(naviHex: $0.color) } ?? NaviTheme.purple
                )
            }
            Spacer(minLength: 0)
            if let saveError {
                Text(saveError)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.red)
            }
            HStack(spacing: 8) {
                NaviDialogButton(title: "취소", role: .cancel, action: onCancel)
                NaviDialogButton(title: isSaving ? "저장 중…" : "일정 저장", isEnabled: draft.isValid && !isSaving, action: save)
            }
        }
        .onChange(of: draft.startAt) { oldStart, newStart in
            // Keep the event's length when the start moves, like Calendar does.
            draft.endAt = newStart.addingTimeInterval(draft.endAt.timeIntervalSince(oldStart))
        }
    }

    private func save() {
        guard draft.isValid, !isSaving else { return }
        isSaving = true
        saveError = nil
        Task {
            do {
                try await onSave(draft)
            } catch EdgeError.server(_, let message) {
                saveError = message
            } catch EdgeError.unavailable {
                saveError = "캘린더 서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."
            } catch {
                saveError = "일정을 저장하지 못했어요. 다시 시도해 주세요."
            }
            isSaving = false
        }
    }
}

// MARK: - Schedule block

/// Figma "Schedule Block": category-tinted card with the title, a clock + time range, and an
/// optional "| 📍 location". Short events collapse to one line.
struct ScheduleBlock: View {
    let title: String
    let timeRange: String
    var location: String?
    let tint: Color
    var isCompact = false

    var body: some View {
        Group {
            if isCompact {
                HStack(spacing: 8) { titleText; details }
            } else {
                VStack(alignment: .leading, spacing: 5) { titleText; details }
            }
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background {
            ZStack {
                NaviTheme.cardWhite
                tint.opacity(0.14)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .accessibilityElement(children: .combine)
    }

    private var titleText: some View {
        Text(title)
            .font(NaviFont.title(14))
            .lineLimit(1)
    }

    private var details: some View {
        HStack(spacing: 5) {
            Image("IconClock")
                .resizable()
                .frame(width: 12, height: 12)
                .frame(width: 15, height: 15)
            Text(timeRange)
            if let location {
                Text("|")
                Image("IconLocation")
                    .resizable()
                    .frame(width: 10, height: 12)
                    .frame(width: 15, height: 15)
                Text(location)
                    .lineLimit(1)
            }
        }
        .font(NaviFont.body(9, weight: .bold))
    }

    /// "09:00 - 10:00"
    static func timeRange(_ start: Date, _ end: Date) -> String {
        "\(time(start)) - \(time(end))"
    }

    static func time(_ date: Date) -> String {
        date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }
}
