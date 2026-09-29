import SwiftUI

/// Account actions the main window exposes to the menu bar.
struct AccountActions {
    let signOut: () -> Void
    let resetOnboarding: () -> Void
}

extension FocusedValues {
    @Entry var accountActions: AccountActions?
}

/// "navi" app menu items: 로그아웃 (and a debug-only onboarding reset). Disabled while the
/// onboarding flow is showing, since no main window publishes `accountActions` then.
struct AccountCommands: Commands {
    @FocusedValue(\.accountActions) private var actions

    var body: some Commands {
        CommandGroup(after: .appSettings) {
            Button("로그아웃") { actions?.signOut() }
                .disabled(actions == nil)
            #if DEBUG
            Button("온보딩 다시 보기") { actions?.resetOnboarding() }
                .disabled(actions == nil)
            #endif
        }
    }
}
