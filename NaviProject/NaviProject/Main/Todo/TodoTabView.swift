import SwiftUI

/// Figma "03 Final Prototype › 10 - 할 일": filter tabs, the deadline-grouped list with a
/// quick-add bar on the left, and a right column that swaps between the overview (오늘의 흐름 +
/// 카테고리), todo detail, deadline picker, new todo, and weekly-prep panels.
struct TodoTabView: View {
    @ObservedObject var model: TodoTabModel
    let onAddCategory: () -> Void

    @State private var quickAddText = ""
    @State private var assistantText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviTabHeader(title: "할 일", searchPrompt: "할 일 검색", searchText: $model.searchText)

            HStack {
                NaviSegmentTabs(items: TodoTabModel.Filter.allCases, selection: $model.filter, title: \.title)
                Spacer(minLength: 15)
                HStack(spacing: 15) {
                    NaviPillButton(title: "이번 주 미리 준비", size: .large) { model.openPrep() }
                    NaviPillButton(title: "새 할 일", icon: "IconPlus", style: .primary, size: .large) {
                        model.panel = .newTodo
                    }
                }
            }

            HStack(alignment: .top, spacing: 10) {
                VStack(spacing: 10) {
                    listPanel
                    NaviPromptInput(
                        prompt: "- [ ] 할 일을 입력하세요  /기한  #카테고리",
                        text: $quickAddText,
                        action: .enter,
                        onSubmit: { model.quickAdd($0) }
                    )
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                VStack(spacing: 10) {
                    rightPanel
                        .frame(maxHeight: .infinity, alignment: .top)
                    NaviPromptInput(
                        prompt: "내가 놓친 할 일이 있어?",
                        text: $assistantText,
                        onSubmit: model.sendAssistantPrompt
                    )
                }
                .frame(width: rightWidth)
                .frame(maxHeight: .infinity)
            }
            .padding(.bottom, 10)
        }
        .task { await model.load() }
    }

    /// Figma uses 308pt for the overview / prep panels and 284pt for the form panels.
    private var rightWidth: CGFloat {
        switch model.panel {
        case .overview, .prep, .prepAdded, .todoAdded: return 308
        case .detail, .deadline, .newTodo, .prepDetail: return 284
        }
    }

    // MARK: - List

    private var listPanel: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("기한별 할 일")
                    .font(NaviFont.heading(18))
                    .foregroundStyle(NaviTheme.ink)
                Spacer()
                Button {
                    model.showsCompleted.toggle()
                } label: {
                    HStack(spacing: 5) {
                        Text("미완료 \(model.openCount) · 완료 \(model.doneCount)")
                            .font(NaviFont.body(12))
                        NaviIcon(name: "IconChevron")
                            .rotationEffect(.degrees(model.showsCompleted ? -90 : 0))
                    }
                    .foregroundStyle(NaviTheme.grayText)
                    .padding(.leading, 10)
                    .padding(.trailing, 5)
                    .padding(.vertical, 5)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(model.showsCompleted ? "완료한 할 일 숨기기" : "완료한 할 일 보기")
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let error = model.errorMessage {
                        Text(error)
                            .font(NaviFont.body(10))
                            .foregroundStyle(NaviTheme.red)
                    }
                    if model.groupedTodos.isEmpty {
                        Text(model.isLoading ? "할 일을 불러오는 중이에요…" : emptyMessage)
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayText)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(NaviTheme.itemBackground)
                            .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                    ForEach(model.groupedTodos, id: \.group) { section in
                        VStack(alignment: .leading, spacing: 10) {
                            NaviGroupSubtitle(
                                title: section.group.title,
                                count: section.todos.count,
                                isAlert: section.group == .overdue
                            )
                            ForEach(section.todos) { todo in
                                row(todo)
                            }
                        }
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
    }

    private var emptyMessage: String {
        model.searchText.isEmpty ? "할 일이 없어요. 아래 입력창이나 \"새 할 일\"로 추가해 보세요." : "검색 결과가 없어요."
    }

    private func row(_ todo: DashboardTodo) -> some View {
        TodoItemRow(
            todo: todo,
            meta: model.meta(for: todo),
            isSelected: isSelected(todo),
            onToggle: { model.toggle(todo.id) },
            onOpen: { model.panel = .detail(todo.id) }
        )
        .contentShape(Rectangle())
        .onTapGesture { model.panel = .detail(todo.id) }
        .draggable(todo.id.uuidString) {
            TodoItemRow(todo: todo, meta: nil, onToggle: {}, onOpen: {})
                .frame(width: 420)
        }
        .dropDestination(for: String.self) { items, _ in
            guard let id = items.first.flatMap(UUID.init(uuidString:)) else { return false }
            withAnimation(.easeInOut(duration: 0.15)) { model.move(id, to: todo.id) }
            return true
        }
    }

    private func isSelected(_ todo: DashboardTodo) -> Bool {
        switch model.panel {
        case .detail(let id), .deadline(let id): return id == todo.id
        default: return false
        }
    }

    // MARK: - Right column

    @ViewBuilder
    private var rightPanel: some View {
        switch model.panel {
        case .overview:
            TodoOverviewPanels(model: model, onAddCategory: onAddCategory)
        case .detail(let id):
            if let todo = model.todo(id) {
                TodoDetailPanel(model: model, todo: todo)
            } else {
                TodoOverviewPanels(model: model, onAddCategory: onAddCategory)
            }
        case .deadline(let id):
            if let todo = model.todo(id) {
                DeadlinePanel(
                    initial: todo.dueAt ?? .now,
                    onCancel: { model.panel = .detail(id) },
                    onApply: { date in
                        model.setDeadline(date, of: id)
                        model.panel = .detail(id)
                    }
                )
            }
        case .newTodo:
            NewTodoPanel(
                categories: model.categories,
                draft: model.makeDraft(),
                onCancel: { model.panel = .overview },
                onSave: { draft in model.panel = .todoAdded(try await model.addTodo(draft)) }
            )
        case .todoAdded(let todo):
            TodoAddedPanel(
                todo: todo,
                onClose: { model.panel = .overview },
                onOpenTodos: { model.panel = .overview }
            )
        case .prep:
            WeeklyPrepPanel(model: model)
        case .prepDetail(let id):
            if let suggestion = model.suggestions.first(where: { $0.id == id }) {
                PrepDetailPanel(
                    categories: model.categories,
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

// MARK: - Overview (오늘의 흐름 + 카테고리)

private struct TodoOverviewPanels: View {
    @ObservedObject var model: TodoTabModel
    let onAddCategory: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            flow
            categories
        }
    }

    private var flow: some View {
        let progress = model.todayProgress
        let fraction = progress.total == 0 ? 0 : Double(progress.done) / Double(progress.total)
        return VStack(alignment: .leading, spacing: 15) {
            NaviSectionHeader(title: "오늘의 흐름", tag: "\(progress.done)/\(progress.total) 완료")
            VStack(alignment: .leading, spacing: 5) {
                Text("\(Int((fraction * 100).rounded()))%")
                    .font(NaviFont.title(28))
                    .foregroundStyle(NaviTheme.purple)
                VStack(alignment: .leading, spacing: 10) {
                    Text(caption(progress))
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.grayText)
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4).fill(NaviTheme.itemBackground)
                            RoundedRectangle(cornerRadius: 4)
                                .fill(NaviTheme.purple)
                                .frame(width: geometry.size.width * fraction)
                        }
                    }
                    .frame(height: 8)
                }
            }
            .padding(.trailing, 24)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func caption(_ progress: (done: Int, total: Int)) -> String {
        switch progress {
        case (_, 0): return "오늘 할 일이 아직 없어요."
        case let (done, total) where done == total: return "오늘 할 일을 모두 끝냈어요!"
        case let (done, total) where done * 2 >= total: return "오늘 할 일을 절반 끝냈어요."
        case (0, _): return "오늘 할 일을 시작해 볼까요?"
        default: return "오늘 할 일을 하나씩 끝내고 있어요."
        }
    }

    private var categories: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("카테고리")
                    .font(NaviFont.heading(18))
                    .foregroundStyle(NaviTheme.ink)
                Spacer()
                NaviPillButton(title: "추가", icon: "IconPlus", action: onAddCategory)
            }
            VStack(spacing: 10) {
                if model.categories.isEmpty {
                    Text("카테고리를 추가해 할 일을 나눠 보세요.")
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.grayText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(model.categories) { category in
                    HStack {
                        NaviTag(category: category, fontSize: 11)
                        Spacer()
                        Text("\(model.count(in: category))")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayText)
                    }
                    .padding(.horizontal, 10)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
