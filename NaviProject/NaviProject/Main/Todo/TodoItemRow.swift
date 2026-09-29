import SwiftUI


/// Figma "Action Item": drag handle, checkbox, title (+ subtask chevron) on the left;
/// subtask progress, category tag, and a due time / origin caption on the right.
struct TodoItemRow: View {
    struct Meta: Equatable {
        var text: String
        var isOverdue = false
    }

    let todo: DashboardTodo
    let meta: Meta?
    var isSelected = false
    /// Progress, category tag, and subtask chevron; the calendar's "일정에서 만든 할 일" list
    /// shows only the caption.
    var showsDetails = true
    let onToggle: () -> Void
    let onOpen: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 15) {
                DragHandle()
                HStack(spacing: 10) {
                    Button(action: onToggle) {
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

                    if showsDetails, todo.subtaskProgress != nil {
                        Button(action: onOpen) {
                            NaviIcon(name: "IconChevron")
                                .rotationEffect(.degrees(-90))
                                .foregroundStyle(NaviTheme.ink)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("하위 할 일 보기")
                    }
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                if showsDetails, let progress = todo.subtaskProgress {
                    SubtaskProgressBar(progress: progress)
                }
                if showsDetails, let category = todo.category {
                    NaviTag(category: category)
                }
                if let meta {
                    Text(meta.text)
                        .font(NaviFont.body(10))
                        .foregroundStyle(meta.isOverdue ? NaviTheme.red : NaviTheme.graySecondary)
                        .lineLimit(1)
                }
            }
            .fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(isSelected ? NaviTheme.lavender : NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay {
            if isSelected {
                RoundedRectangle(cornerRadius: 5).stroke(NaviTheme.purple, lineWidth: 1)
            }
        }
    }

    /// Dashboard caption: "오늘 12:00" / "내일 11:00" / "9/28 09:00" for dated todos, otherwise
    /// where it came from.
    static func dashboardMeta(for todo: DashboardTodo) -> Meta? {
        dashboardMetaText(for: todo).map { Meta(text: $0) }
    }

    private static func dashboardMetaText(for todo: DashboardTodo) -> String? {
        if let dueAt = todo.dueAt {
            let calendar = Calendar.current
            let time = dueAt.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
            if calendar.isDateInToday(dueAt) { return "오늘 \(time)" }
            if calendar.isDateInTomorrow(dueAt) { return "내일 \(time)" }
            return "\(dueAt.formatted(.dateTime.month(.defaultDigits).day())) \(time)"
        }
        switch todo.source {
        case .mailSuggestion: return "메일에서 생성됨"
        case .calendarSuggestion: return "일정에서 생성됨"
        case .manual, .subdivision: return nil
        }
    }
}

/// Figma "Drag" icon: a 2×3 grid of 2pt dots at 40% opacity.
struct DragHandle: View {
    var body: some View {
        Grid(horizontalSpacing: 2, verticalSpacing: 2) {
            ForEach(0..<3, id: \.self) { _ in
                GridRow {
                    dot
                    dot
                }
            }
        }
        .frame(width: 15, height: 15)
        .opacity(0.4)
        .accessibilityHidden(true)
    }

    private var dot: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(NaviTheme.grayText)
            .frame(width: 2, height: 2)
    }
}

/// Figma "Checkbox": outlined when open, filled gray with a white check when done.
struct NaviCheckbox: View {
    let isChecked: Bool
    var size: CGFloat = 15
    var uncheckedBorder: Color = NaviTheme.graySecondary

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2)
                .fill(isChecked ? NaviTheme.graySecondary : NaviTheme.cardWhite)
            if isChecked {
                Image("IconCheck")
                    .resizable()
                    .frame(width: size * 0.69, height: size * 0.5)
                    .foregroundStyle(NaviTheme.cardWhite)
            } else {
                RoundedRectangle(cornerRadius: 2)
                    .strokeBorder(uncheckedBorder, lineWidth: 1)
            }
        }
        .frame(width: size, height: size)
        .contentShape(Rectangle())
    }
}

struct SubtaskProgressBar: View {
    let progress: SubtaskProgress

    var body: some View {
        HStack(spacing: 5) {
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(NaviTheme.cardWhite)
                RoundedRectangle(cornerRadius: 3)
                    .fill(NaviTheme.purple)
                    .frame(width: 100 * fraction)
            }
            .frame(width: 100, height: 7)
            Text("\(progress.done)/\(progress.total)")
                .font(NaviFont.body(10))
                .foregroundStyle(NaviTheme.grayText)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("하위 할 일 \(progress.total)개 중 \(progress.done)개 완료")
    }

    private var fraction: CGFloat {
        guard progress.total > 0 else { return 0 }
        return CGFloat(progress.done) / CGFloat(progress.total)
    }
}
