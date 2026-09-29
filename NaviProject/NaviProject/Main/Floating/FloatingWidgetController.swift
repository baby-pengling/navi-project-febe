import Combine
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// Switches between the main window and the floating mini widget. The compress button hides
/// the main window and shows the widget in a borderless, always-on-top panel at the bottom
/// right of the screen; the widget's expand button (and its settings / "main window only"
/// actions) bring the main window back.
@MainActor
final class FloatingWidgetController: ObservableObject {
    static let shared = FloatingWidgetController()

    let model = FloatingWidgetModel()
    /// Tab the main window should show when it comes back; `MainWindowView` consumes it.
    @Published var requestedTab: MainTab?

    #if os(macOS)
    private var panel: NSPanel?
    private weak var mainWindow: NSWindow?
    private var keyWindowObserver: NSObjectProtocol?

    /// Hides `window` (the main window) and shows the widget on its home screen.
    func compress(_ window: NSWindow?) {
        if let window { mainWindow = window }
        model.screen = .home
        model.isPanelOpen = true
        mainWindow?.orderOut(nil)
        (panel ?? makePanel()).orderFrontRegardless()
    }

    /// Hides the widget and brings the main window back, on `tab` if given.
    func expand(to tab: MainTab?) {
        panel?.orderOut(nil)
        if let tab { requestedTab = tab }
        NSApp.activate()
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    private func makePanel() -> NSPanel {
        let panel = FloatingPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.backgroundColor = .clear
        panel.isOpaque = false
        // The SwiftUI panel draws its own shadow; the window's would outline the mascot area.
        panel.hasShadow = false
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        let root = FloatingWidgetView(model: model) { [weak self] tab in
            self?.expand(to: tab)
        }
        .fixedSize()
        .onGeometryChange(for: CGSize.self) { $0.size } action: { [weak self] size in
            self?.fit(size)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)

        let host = NSHostingView(rootView: root)
        // The window follows the content size through `fit`, anchored at its bottom-right.
        host.sizingOptions = []
        panel.contentView = host
        self.panel = panel

        // If the main window comes back some other way (Dock icon, Window menu), hide the widget.
        keyWindowObserver = NotificationCenter.default.addObserver(
            forName: NSWindow.didBecomeKeyNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            MainActor.assumeIsolated {
                guard let self,
                      let window = note.object as? NSWindow,
                      window !== self.panel,
                      window.styleMask.contains(.titled)
                else { return }
                self.mainWindow = window
                self.panel?.orderOut(nil)
            }
        }
        return panel
    }

    /// Resizes the panel to the SwiftUI content, keeping its bottom-right corner in place (the
    /// mascot stays put while the briefing grows or shrinks above it).
    private func fit(_ size: CGSize) {
        guard let panel, size.width > 0, size.height > 0 else { return }
        let anchor: NSPoint
        if panel.frame.width > 0 {
            anchor = NSPoint(x: panel.frame.maxX, y: panel.frame.minY)
        } else {
            // Figma: the mascot sits just above the Dock at the right edge of the screen.
            let visible = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? .zero
            anchor = NSPoint(x: visible.maxX - 24, y: visible.minY + 16)
        }
        panel.setFrame(
            NSRect(x: anchor.x - size.width, y: anchor.y, width: size.width, height: size.height),
            display: true
        )
    }
    #endif
}

#if os(macOS)
/// Borderless panels can't become key by default, which would block the widget's text fields.
private final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}
#endif

extension View {
    /// Main-window side of the widget: switches to the tab the widget asked for and keeps the
    /// widget's greeting name in sync.
    func floatingWidgetBridge(selection: Binding<MainTab>, userName: String) -> some View {
        modifier(FloatingWidgetBridge(selection: selection, userName: userName))
    }
}

private struct FloatingWidgetBridge: ViewModifier {
    @Binding var selection: MainTab
    let userName: String
    @ObservedObject private var controller = FloatingWidgetController.shared

    func body(content: Content) -> some View {
        content
            .onAppear { controller.model.userName = userName }
            .onChange(of: userName) { _, name in controller.model.userName = name }
            .onChange(of: controller.requestedTab) { _, tab in
                guard let tab else { return }
                selection = tab
                controller.requestedTab = nil
            }
    }
}
