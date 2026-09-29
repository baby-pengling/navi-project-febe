import SwiftUI

/// Maps the Figma type styles to the bundled Paperlogy / Pretendard / Bagel Fat One
/// typefaces (see `Fonts/` and `Info.plist`'s `UIAppFonts`).
enum NaviFont {
    /// Figma's H2/H3/H6 styles are "Paperlogy 7 Bold"; only the size varies.
    static func title(_ size: CGFloat) -> Font {
        .custom("Paperlogy-7Bold", size: size)
    }

    /// Figma H4 ("Paperlogy 6 SemiBold") — card and section titles in the main window.
    static func heading(_ size: CGFloat) -> Font {
        .custom("Paperlogy-6SemiBold", size: size)
    }

    /// Paperlogy at an arbitrary weight, e.g. the unselected sidebar items (4 Regular).
    static func paperlogy(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(paperlogyName(for: weight), size: size)
    }

    /// The "navi" wordmark accent inside titles.
    static func wordmark(_ size: CGFloat) -> Font {
        .custom("BagelFatOne-Regular", size: size)
    }

    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(pretendardName(for: weight), size: size)
    }

    /// Tag / badge labels ("3/4 완료", "카테고리"). Figma uses Yde Street B, which isn't
    /// bundled yet, so Paperlogy 7 Bold stands in until the font file is added.
    static func tag(_ size: CGFloat) -> Font {
        title(size)
    }

    /// The dashboard date chips ("Mon 06 22"). Figma uses Geist Mono Bold, which isn't
    /// bundled, so the system monospaced face stands in.
    static func mono(_ size: CGFloat) -> Font {
        .system(size: size, weight: .bold, design: .monospaced)
    }

    private static func paperlogyName(for weight: Font.Weight) -> String {
        switch weight {
        case .black: return "Paperlogy-9Black"
        case .heavy: return "Paperlogy-8ExtraBold"
        case .bold: return "Paperlogy-7Bold"
        case .semibold: return "Paperlogy-6SemiBold"
        case .medium: return "Paperlogy-5Medium"
        case .light: return "Paperlogy-3Light"
        case .ultraLight, .thin: return "Paperlogy-1Thin"
        default: return "Paperlogy-4Regular"
        }
    }

    private static func pretendardName(for weight: Font.Weight) -> String {
        switch weight {
        case .black: return "Pretendard-Black"
        case .heavy, .bold: return "Pretendard-Bold"
        case .semibold: return "Pretendard-SemiBold"
        case .medium: return "Pretendard-Medium"
        case .light: return "Pretendard-Light"
        case .ultraLight, .thin: return "Pretendard-Thin"
        default: return "Pretendard-Regular"
        }
    }
}
