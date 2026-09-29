import SwiftUI

/// Figma "10 - 할 일 > 카테고리 추가" (and the calendar tab's copy): name, color, live tag
/// preview, 취소 / 추가하기. The color swatch opens the free color picker popover.
struct CategoryDialog: View {
    let onCancel: () -> Void
    let onAdd: (_ name: String, _ color: String) async throws -> Void

    @State private var name = ""
    @State private var color = "#7165FF"
    @State private var isPickerPresented = false
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("새로운 카테고리 추가")
                .font(NaviFont.heading(18))
                .foregroundStyle(NaviTheme.ink)

            NaviTextField(title: "카테고리 이름", text: $name)

            HStack {
                Text("색상")
                    .font(NaviFont.title(14))
                    .foregroundStyle(.black)
                Spacer()
                Button { isPickerPresented = true } label: {
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 5)
                            .fill(Color(naviHex: color))
                            .frame(width: 18, height: 18)
                        Text(color.uppercased())
                            .font(NaviFont.body(12))
                            .foregroundStyle(.black)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 8)
                    .frame(width: 128, height: 32)
                    .background(NaviTheme.cardWhite)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(NaviTheme.border, lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("색상 \(color)")
                .popover(isPresented: $isPickerPresented, arrowEdge: .bottom) {
                    NaviColorPicker(initialHex: color) { picked in
                        if let picked { color = picked }
                        isPickerPresented = false
                    }
                }
            }
            .frame(height: 32)

            HStack {
                Text("미리보기")
                    .font(NaviFont.title(14))
                    .foregroundStyle(.black)
                Spacer()
                NaviTag(
                    category: NaviCategory(id: UUID(), name: previewName, color: color),
                    fontSize: 11
                )
            }

            if let error {
                Text(error)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.red)
            }

            HStack(spacing: 11) {
                NaviDialogButton(title: "취소", role: .cancel, action: onCancel)
                NaviDialogButton(title: isSaving ? "추가 중…" : "추가하기", isEnabled: isValid && !isSaving, action: save)
            }
        }
        .naviDialogCard()
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var previewName: String {
        trimmedName.isEmpty ? "카테고리" : trimmedName
    }

    /// Matches the DB CHECKs: name 1…30 characters.
    private var isValid: Bool {
        (1...30).contains(trimmedName.count)
    }

    private func save() {
        guard isValid else { return }
        isSaving = true
        error = nil
        Task {
            do {
                try await onAdd(trimmedName, color.uppercased())
                onCancel()
            } catch {
                // The unique (user_id, name) index is the usual cause.
                self.error = "카테고리를 추가하지 못했어요. 같은 이름이 있는지 확인해 주세요."
            }
            isSaving = false
        }
    }
}

/// Figma "자유 색상 피커": saturation/brightness square, hue bar, HEX field, 취소 / 적용.
/// Calls `onFinish(nil)` on cancel.
struct NaviColorPicker: View {
    let initialHex: String
    let onFinish: (String?) -> Void

    @State private var hue: Double = 0.68
    @State private var saturation: Double = 0.6
    @State private var brightness: Double = 1
    @State private var hexText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("색상 선택")
                .font(NaviFont.title(14))
                .foregroundStyle(NaviTheme.ink)

            saturationBrightness
                .frame(width: 220, height: 108)
                .clipShape(RoundedRectangle(cornerRadius: 6))

            hueBar
                .frame(width: 220, height: 14)

            HStack {
                Text("HEX")
                    .font(NaviFont.body(10))
                Spacer()
                TextField("", text: $hexText)
                    .textFieldStyle(.plain)
                    .font(NaviFont.body(12))
                    .multilineTextAlignment(.trailing)
                    .onSubmit(applyHexText)
            }
            .foregroundStyle(.black)
            .padding(.horizontal, 8)
            .frame(width: 220, height: 32)
            .background(NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(NaviTheme.border, lineWidth: 1))

            HStack(spacing: 8) {
                NaviDialogButton(title: "취소", role: .cancel) { onFinish(nil) }
                NaviDialogButton(title: "적용") {
                    applyHexText()
                    onFinish(currentHex)
                }
            }
            .frame(width: 220)
        }
        .padding(12)
        .onAppear { load(initialHex) }
    }

    private var currentHex: String {
        NSColor(hue: hue, saturation: saturation, brightness: brightness, alpha: 1).naviHex
    }

    private var saturationBrightness: some View {
        GeometryReader { geometry in
            ZStack {
                Color(hue: hue, saturation: 1, brightness: 1)
                LinearGradient(colors: [.white, .white.opacity(0)], startPoint: .leading, endPoint: .trailing)
                LinearGradient(colors: [.black.opacity(0), .black], startPoint: .top, endPoint: .bottom)
                Circle()
                    .stroke(.white, lineWidth: 2)
                    .frame(width: 10, height: 10)
                    .position(x: saturation * geometry.size.width, y: (1 - brightness) * geometry.size.height)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                saturation = min(max(value.location.x / geometry.size.width, 0), 1)
                brightness = 1 - min(max(value.location.y / geometry.size.height, 0), 1)
                hexText = currentHex
            })
        }
    }

    private var hueBar: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                LinearGradient(
                    colors: stride(from: 0.0, through: 1.0, by: 1.0 / 6).map { Color(hue: $0, saturation: 1, brightness: 1) },
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .clipShape(RoundedRectangle(cornerRadius: 7))
                Circle()
                    .fill(.white)
                    .shadow(radius: 1)
                    .frame(width: 12, height: 12)
                    .offset(x: hue * geometry.size.width - 6)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                hue = min(max(value.location.x / geometry.size.width, 0), 1)
                hexText = currentHex
            })
        }
    }

    private func applyHexText() {
        load(hexText)
    }

    private func load(_ hex: String) {
        var text = hex.trimmingCharacters(in: .whitespaces).uppercased()
        if !text.hasPrefix("#") { text = "#" + text }
        guard text.range(of: "^#[0-9A-F]{6}$", options: .regularExpression) != nil,
              let color = NSColor(Color(naviHex: text)).usingColorSpace(.sRGB)
        else {
            hexText = currentHex
            return
        }
        hue = color.hueComponent
        saturation = color.saturationComponent
        brightness = color.brightnessComponent
        hexText = text
    }
}

extension NSColor {
    /// "#RRGGBB" in sRGB.
    var naviHex: String {
        let color = usingColorSpace(.sRGB) ?? self
        return String(
            format: "#%02X%02X%02X",
            Int((color.redComponent * 255).rounded()),
            Int((color.greenComponent * 255).rounded()),
            Int((color.blueComponent * 255).rounded())
        )
    }
}
