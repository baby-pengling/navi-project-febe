import SwiftUI

// MARK: - Onboarding building blocks

struct NaviMascotView: View {
    let width: CGFloat

    var body: some View {
        Image("NaviMascot")
            .resizable()
            .scaledToFit()
            .frame(width: width)
            .accessibilityLabel("navi")
    }
}

/// Figma "Input" sizes: `.regular` (11pt semibold label, 14pt value) on forms and settings,
/// `.compact` (10pt label, 12pt value) in side panels.
enum NaviFieldSize {
    case regular
    case compact

    var labelFont: Font {
        self == .regular ? NaviFont.body(11, weight: .semibold) : NaviFont.body(10)
    }

    var valueFont: Font {
        self == .regular ? NaviFont.body(14, weight: .medium) : NaviFont.body(12)
    }
}

/// Figma "Input" box: a caption label above any value view, in a rounded, bordered box.
struct NaviFieldBox<Value: View>: View {
    let title: String
    var size: NaviFieldSize = .regular
    var isRequired = false
    @ViewBuilder let value: Value

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 3) {
                Text(title)
                    .font(size.labelFont)
                    .foregroundStyle(NaviTheme.grayText)
                if isRequired {
                    Text("*")
                        .font(size.labelFont)
                        .foregroundStyle(NaviTheme.red)
                }
            }
            value
                .font(size.valueFont)
                .foregroundStyle(NaviTheme.ink)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NaviTheme.cardWhite)
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(NaviTheme.border, lineWidth: 1))
    }
}

/// Figma "Input": a caption label above an editable value.
struct NaviTextField: View {
    let title: String
    @Binding var text: String
    var isSecure = false
    var isRequired = false
    var size: NaviFieldSize = .regular

    var body: some View {
        NaviFieldBox(title: title, size: size, isRequired: isRequired) {
            Group {
                if isSecure {
                    SecureField("", text: $text)
                } else {
                    TextField("", text: $text)
                }
            }
            .textFieldStyle(.plain)
            .accessibilityIdentifier("navi.input.\(title)")
        }
    }
}

/// Figma date/time input: the value reads "2026.09.17  17:00"; clicking opens a calendar and
/// time picker in a popover.
struct NaviDateField: View {
    let title: String
    @Binding var date: Date
    var size: NaviFieldSize = .compact

    @State private var isPickerPresented = false

    var body: some View {
        Button {
            isPickerPresented = true
        } label: {
            NaviFieldBox(title: title, size: size) {
                Text(Self.format(date))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(date.formatted(date: .long, time: .shortened))
        .popover(isPresented: $isPickerPresented, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 10) {
                DatePicker(title, selection: $date, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                DatePicker(title, selection: $date, displayedComponents: .hourAndMinute)
                    .datePickerStyle(.field)
            }
            .labelsHidden()
            .padding(12)
        }
    }

    /// "2026.09.17  17:00"
    static func format(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy.MM.dd  HH:mm"
        return formatter.string(from: date)
    }
}

/// Full-width onboarding call-to-action button.
struct NaviButton: View {
    enum Style {
        case primary
        case secondary
    }

    let title: String
    var style: Style = .primary
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(NaviFont.body(14, weight: .bold))
                .foregroundStyle(textColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .padding(.horizontal, 25)
                .background(backgroundColor)
                .clipShape(RoundedRectangle(cornerRadius: 15))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("navi.button.\(title)")
        .disabled(!isEnabled)
    }

    private var backgroundColor: Color {
        guard isEnabled else { return NaviTheme.disabled }
        return style == .primary ? NaviTheme.purple : NaviTheme.lavender
    }

    private var textColor: Color {
        guard isEnabled else { return NaviTheme.cardWhite }
        return style == .primary ? NaviTheme.offWhite : NaviTheme.purple
    }
}

// MARK: - Main window building blocks

/// White rounded card that holds each main-window section ("오늘 할 일", "프로필", …).
struct NaviPanel<Content: View>: View {
    var spacing: CGFloat = 10
    var horizontalPadding: CGFloat = 20
    var verticalPadding: CGFloat = 15
    /// Stretch the card to the available height (Figma `flex-1` panels).
    var fillsHeight = false
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .frame(maxWidth: .infinity, maxHeight: fillsHeight ? .infinity : nil, alignment: .topLeading)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

/// Figma "Frame Title": section title with an optional count tag and "전체 보기" link.
struct NaviSectionHeader: View {
    let title: String
    var tag: String?
    var onViewAll: (() -> Void)?

    var body: some View {
        HStack {
            Text(title)
                .font(NaviFont.heading(18))
                .foregroundStyle(NaviTheme.ink)
            Spacer()
            HStack(spacing: 10) {
                if let tag {
                    NaviTag(text: tag)
                }
                if let onViewAll {
                    Button(action: onViewAll) {
                        HStack(spacing: 5) {
                            Text("전체 보기")
                                .font(NaviFont.body(12))
                            NaviIcon(name: "IconChevron")
                                .rotationEffect(.degrees(-90))
                        }
                        .foregroundStyle(NaviTheme.grayText)
                        .padding(.leading, 10)
                        .padding(.trailing, 5)
                        .padding(.vertical, 5)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Small rounded label: lime count badges ("3/4 완료", "2개") and lavender category chips.
struct NaviTag: View {
    enum Style {
        case count
        case category
    }

    let text: String
    var style: Style = .count
    /// Category tags use the user's category color: tinted text on a 14% wash (Figma's
    /// lavender-on-purple default is exactly that for #7165FF).
    var tint: Color?
    /// Figma uses 9pt category tags in rows and 11pt ones in pickers.
    var fontSize: CGFloat?

    var body: some View {
        Text(text)
            .font(NaviFont.tag(fontSize ?? (style == .count ? 11 : 9)))
            .foregroundStyle(foreground)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, style == .count || fontSize != nil ? 5 : 2)
            .background { background }
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private var foreground: Color {
        style == .count ? NaviTheme.dark : (tint ?? NaviTheme.purple)
    }

    @ViewBuilder
    private var background: some View {
        if style == .count {
            NaviTheme.limeLight
        } else if let tint {
            // Over white, so the wash reads the same on grey item rows.
            ZStack {
                NaviTheme.cardWhite
                tint.opacity(0.14)
            }
        } else {
            NaviTheme.lavender
        }
    }
}

extension NaviTag {
    /// Category chip in the category's own color.
    init(category: NaviCategory, fontSize: CGFloat? = nil) {
        self.init(text: category.name, style: .category, tint: Color(naviHex: category.color), fontSize: fontSize)
    }
}

/// Compact tinted button used inside cards ("할 일 추가", "비밀번호 변경", "연결", "관리").
struct NaviPillButton: View {
    enum Style {
        /// Lavender fill, purple label — the default action button.
        case accent
        /// Green fill — a read-only "연결 됨" state.
        case success
        /// White with a border — a read-only "연결 안 됨" state.
        case outline
        /// Purple fill, white label ("새 할 일", "새 일정").
        case primary
    }

    enum Size {
        /// 20×8 padding, 8pt corners (settings rows).
        case regular
        /// 25×10 padding, 10pt corners (add buttons under lists).
        case large
    }

    let title: String
    /// Asset name of a 15pt template icon drawn before the title (e.g. "IconPlus").
    var icon: String?
    var style: Style = .accent
    var size: Size = .regular
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let icon {
                    NaviIcon(name: icon)
                }
                Text(title)
                    .font(NaviFont.body(12, weight: .bold))
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, size == .large ? 25 : 20)
            .padding(.vertical, size == .large ? 10 : 8)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .overlay {
                if style == .outline {
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(NaviTheme.border, lineWidth: 1)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("navi.button.\(title)")
    }

    private var cornerRadius: CGFloat {
        size == .large ? 10 : 8
    }

    private var foreground: Color {
        switch style {
        case .accent: return NaviTheme.purple
        case .success: return NaviTheme.green
        case .outline: return NaviTheme.grayText
        case .primary: return NaviTheme.cardWhite
        }
    }

    private var background: Color {
        switch style {
        case .accent: return NaviTheme.lavender
        case .success: return NaviTheme.greenLight
        case .outline: return NaviTheme.cardWhite
        case .primary: return NaviTheme.purple
        }
    }
}

/// A Figma "Icon" component glyph: a template SVG from the asset catalog in a square slot,
/// tinted by the surrounding `foregroundStyle`.
struct NaviIcon: View {
    let name: String
    var size: CGFloat = 15

    var body: some View {
        Image(name)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// Figma "Color picker" dropdown: the selected category's tag and a chevron; opens a menu of
/// the user's categories.
struct NaviCategoryPicker: View {
    let categories: [NaviCategory]
    @Binding var selection: NaviCategory?
    var allowsNone = true

    var body: some View {
        Menu {
            if allowsNone {
                Button("카테고리 없음") { selection = nil }
            }
            ForEach(categories) { category in
                Button(category.name) { selection = category }
            }
        } label: {
            HStack(spacing: 8) {
                if let selection {
                    NaviTag(category: selection, fontSize: 11)
                } else {
                    Text("없음")
                        .font(NaviFont.body(11))
                        .foregroundStyle(NaviTheme.grayText)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                }
                NaviIcon(name: "IconChevron")
                    .foregroundStyle(NaviTheme.ink)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NaviTheme.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("카테고리")
        .accessibilityValue(selection?.name ?? "없음")
    }
}

/// Side-panel title row ("새 할 일", "새 일정"): H4 title, close X, and a divider below. The
/// floating widget's panels have no X (its back link closes them), so `onClose` is optional.
struct NaviPanelHeader: View {
    let title: String
    let onClose: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            HStack {
                Text(title)
                    .font(NaviFont.heading(18))
                    .foregroundStyle(NaviTheme.ink)
                Spacer()
                if let onClose {
                    NaviCloseButton(action: onClose)
                }
            }
            Rectangle()
                .fill(NaviTheme.border)
                .frame(height: 1)
        }
    }
}

/// Figma "Icon / X" (15pt, gray) as a button.
struct NaviCloseButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            NaviIcon(name: "IconX")
                .foregroundStyle(NaviTheme.grayText)
                .padding(.trailing, 5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("닫기")
    }
}

// MARK: - Tab header

/// Figma "Resize Button / Compress": hides the main window and shows the floating mini widget.
struct NaviCompressButton: View {
    var body: some View {
        Button {
            #if os(macOS)
            FloatingWidgetController.shared.compress(NSApp.keyWindow)
            #endif
        } label: {
            NaviIcon(name: "IconCompress", size: 24)
                .rotationEffect(.degrees(90))
                .frame(width: 28, height: 26)
                .foregroundStyle(NaviTheme.cardWhite)
                .padding(8)
                .background(NaviTheme.purple)
                .clipShape(RoundedRectangle(cornerRadius: 5))
        }
        .buttonStyle(.plain)
        .help("작게 보기")
        .accessibilityLabel("작게 보기")
    }
}

/// Header of the mail / calendar / todo tabs: H2 title, a 372pt search field, and the
/// compress button. The search field is dimmed (Figma: 40% opacity) while disabled.
struct NaviTabHeader: View {
    let title: String
    let searchPrompt: String
    @Binding var searchText: String
    var isSearchEnabled = true

    var body: some View {
        HStack {
            Text(title)
                .font(NaviFont.title(28))
                .foregroundStyle(NaviTheme.ink)
            Spacer()
            HStack(spacing: 10) {
                HStack(spacing: 5) {
                    NaviIcon(name: "IconSearch")
                        .foregroundStyle(NaviTheme.grayText)
                    TextField(
                        "",
                        text: $searchText,
                        prompt: Text(searchPrompt).foregroundStyle(NaviTheme.grayText)
                    )
                    .textFieldStyle(.plain)
                    .font(NaviFont.body(14, weight: .medium))
                    .foregroundStyle(NaviTheme.ink)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .frame(width: 372)
                .background(NaviTheme.cardWhite)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .opacity(isSearchEnabled ? 1 : 0.4)
                .disabled(!isSearchEnabled)

                NaviCompressButton()
            }
        }
    }
}

// MARK: - Dialogs

/// Figma dialog button row item: white "취소", purple primary, or red destructive.
struct NaviDialogButton: View {
    enum Role {
        /// White with a light border ("취소" in dialogs).
        case cancel
        /// Lavender with a purple label ("취소" in side panels).
        case secondary
        case primary
        case destructive
    }

    let title: String
    var role: Role = .primary
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(NaviFont.body(12, weight: role == .cancel ? .semibold : .bold))
                .foregroundStyle(foreground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(background)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay {
                    if role == .cancel {
                        RoundedRectangle(cornerRadius: 10).stroke(NaviTheme.borderLight, lineWidth: 1)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .keyboardShortcut(role == .cancel || role == .secondary ? .cancelAction : .defaultAction)
        .disabled(!isEnabled)
        .accessibilityIdentifier("navi.button.\(title)")
    }

    private var foreground: Color {
        switch role {
        case .cancel: return NaviTheme.ink
        case .secondary: return NaviTheme.purple
        case .primary, .destructive: return NaviTheme.cardWhite
        }
    }

    private var background: Color {
        switch role {
        case .cancel: return NaviTheme.cardWhite
        case .secondary: return NaviTheme.lavender
        case .primary: return isEnabled ? NaviTheme.purple : NaviTheme.disabled
        case .destructive: return isEnabled ? NaviTheme.red : NaviTheme.disabled
        }
    }
}

extension View {
    /// Figma dialog surface ("비밀번호 변경 대화상자"): 460pt wide white card with a soft shadow.
    func naviDialogCard() -> some View {
        padding(.horizontal, 24)
            .padding(.vertical, 22)
            .frame(width: 460)
            .background(NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.14), radius: 14, y: 10)
    }
}

// MARK: - Tabs, subtitles, prompt input

/// Figma "Tab": selected is lavender with a purple border and bold purple label; others are
/// white with a regular gray label.
struct NaviSegmentTabs<Item: Hashable>: View {
    let items: [Item]
    @Binding var selection: Item
    let title: (Item) -> String

    var body: some View {
        HStack(spacing: 10) {
            ForEach(items, id: \.self) { item in
                let isSelected = item == selection
                Button {
                    selection = item
                } label: {
                    Text(title(item))
                        .font(NaviFont.paperlogy(14, weight: isSelected ? .bold : .regular))
                        .foregroundStyle(isSelected ? NaviTheme.purple : NaviTheme.grayText)
                        .padding(.horizontal, 25)
                        .padding(.vertical, 7)
                        .background(isSelected ? NaviTheme.lavender : NaviTheme.cardWhite)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay {
                            if isSelected {
                                RoundedRectangle(cornerRadius: 8).stroke(NaviTheme.purple, lineWidth: 1)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }
}

/// Figma "Subtitle": a 16pt group heading with a count chip; red when `isAlert` (기한 지남).
struct NaviGroupSubtitle: View {
    let title: String
    let count: Int
    var isAlert = false

    var body: some View {
        HStack(spacing: 15) {
            Text(title)
                .font(NaviFont.title(16))
                .foregroundStyle(isAlert ? NaviTheme.red : NaviTheme.dark)
            Text("\(count)")
                .font(NaviFont.paperlogy(11, weight: .medium))
                .foregroundStyle(isAlert ? NaviTheme.red : NaviTheme.grayText)
                .frame(minWidth: 8)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(isAlert ? NaviTheme.redLight : NaviTheme.itemBackground)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}

/// Figma "Input / Chat": a white prompt bar with a purple ↑ send button, or a lavender
/// "Enter" button for the todo quick-add bar.
struct NaviPromptInput: View {
    enum Action {
        case send
        case enter
    }

    let prompt: String
    @Binding var text: String
    var action: Action = .send
    let onSubmit: (String) -> Void

    var body: some View {
        HStack {
            TextField("", text: $text, prompt: Text(prompt).foregroundStyle(NaviTheme.grayText))
                .textFieldStyle(.plain)
                .font(NaviFont.body(14, weight: .medium))
                .foregroundStyle(NaviTheme.ink)
                .onSubmit(submit)

            Button(action: submit) {
                switch action {
                case .send:
                    NaviIcon(name: "IconUpArrow")
                        .foregroundStyle(NaviTheme.cardWhite)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 10)
                        .background(NaviTheme.purple)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                case .enter:
                    Text("Enter")
                        .font(NaviFont.body(12, weight: .bold))
                        .foregroundStyle(NaviTheme.purple)
                        .padding(.horizontal, 25)
                        .padding(.vertical, 10)
                        .background(NaviTheme.lavender)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(action == .send ? "보내기" : "추가")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(NaviTheme.cardWhite)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func submit() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSubmit(trimmed)
        text = ""
    }
}
