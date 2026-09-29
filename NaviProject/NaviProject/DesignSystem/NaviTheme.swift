import SwiftUI

/// Color tokens from the Figma file's variables (names in the trailing comments).
enum NaviTheme {
    static let purple = Color(red: 0.443, green: 0.396, blue: 1.0) // #7165FF Purple/Main
    static let ink = Color(red: 0.098, green: 0.098, blue: 0.110) // #19191C Black/Main
    static let dark = Color(red: 0.180, green: 0.263, blue: 0.306) // #2E434E Dark
    static let grayMain = Color(red: 0.420, green: 0.482, blue: 0.525) // #6B7B86 Gray/Main
    static let primaryText = Color(red: 0.271, green: 0.369, blue: 0.416) // #455E6A Primary/Main
    static let blue = Color(red: 0.200, green: 0.400, blue: 0.800) // #3366CC Blue/Main
    static let blueLight = Color(red: 0.910, green: 0.941, blue: 1.0) // #E8F0FF Blue/Light
    /// Floating widget surface behind its white cards.
    static let widgetBackground = Color(red: 0.965, green: 0.965, blue: 0.965) // #F6F6F6 White/Bg
    /// Selected day column in the month grid.
    static let selectedCell = Color(red: 0.965, green: 0.961, blue: 1.0) // #F6F5FF
    static let grayText = Color(red: 0.459, green: 0.451, blue: 0.478) // #75737A Gray/Text
    static let graySecondary = Color(red: 0.580, green: 0.627, blue: 0.667) // #94A0AA Gray/Secondary
    static let border = Color(red: 0.859, green: 0.851, blue: 0.878) // #DBD9E0 Gray/Border
    static let borderLight = Color(red: 0.902, green: 0.918, blue: 0.933) // #E6EAEE Gray/Border-light
    static let lavender = Color(red: 0.925, green: 0.918, blue: 1.0) // #ECEAFF Background
    static let lime = Color(red: 0.835, green: 1.0, blue: 0.388) // #D5FF63 Lime/Main
    static let limeLight = Color(red: 0.925, green: 1.0, blue: 0.729) // #ECFFBA Lime/Light
    static let green = Color(red: 0.180, green: 0.639, blue: 0.400) // #2EA366 Green/Main
    static let greenLight = Color(red: 0.890, green: 0.973, blue: 0.886) // #E3F8E2 Green/Light
    static let red = Color(red: 0.898, green: 0.251, blue: 0.310) // #E5404F Red/Main
    static let redLight = Color(red: 1.0, green: 0.890, blue: 0.898) // #FFE3E5 Red/Light
    static let cardWhite = Color(red: 1.0, green: 1.0, blue: 1.0) // #FFFFFF White/White
    static let offWhite = Color(red: 0.973, green: 0.976, blue: 0.980) // #F8F9FA
    /// Row fill inside cards (todo rows, mail rows, settings rows).
    static let itemBackground = Color(red: 0.973, green: 0.980, blue: 0.984) // #F8FAFB White/Item
    /// Main-window canvas behind the white cards.
    static let canvas = Color(red: 0.969, green: 0.965, blue: 0.949) // #F7F6F2 White/Main
    /// Darker than `border` on purpose — the Figma disabled-button fill (#DBD9E0) is too close
    /// in lightness to white button text to read, so the disabled state uses this instead.
    static let disabled = Color(red: 0.663, green: 0.655, blue: 0.686) // #A9A7AF

    static var background: Color {
        #if os(macOS)
        return Color(nsColor: .windowBackgroundColor)
        #else
        return Color(.systemBackground)
        #endif
    }
}

extension Color {
    /// Parses the `#RRGGBB` strings stored in `todo_categories.color` / `calendar_categories.color`.
    /// Falls back to the brand purple for malformed values.
    init(naviHex hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self = NaviTheme.purple
            return
        }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
