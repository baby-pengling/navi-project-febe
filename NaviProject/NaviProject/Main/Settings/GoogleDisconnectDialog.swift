import SwiftUI

/// "관리" → Google 연결 해제 확인. Not in the dev02 Figma page; follows the Claude proposal frame
/// "[제안] 12 - 설정 > Google 연결 해제 확인", which reuses the password dialog's layout.
struct GoogleDisconnectDialog: View {
    @ObservedObject var model: SettingsModel
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Google 연결을 해제할까요?")
                .font(NaviFont.heading(18))
                .foregroundStyle(NaviTheme.ink)
            Text("Gmail과 Google Calendar 연동이 함께 해제돼요. 해제하면 새 메일과 일정을 더 이상 불러오지 않아요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 6) {
                Text(model.services.googleEmail.map { "Google 계정 · \($0)" } ?? "Google 계정")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.dark)
                Text("다시 연결하면 언제든 이어서 사용할 수 있어요.")
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.grayText)
            }
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            if let error = model.disconnectError {
                Text(error)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.red)
            }

            HStack(spacing: 11) {
                NaviDialogButton(title: "취소", role: .cancel, action: onDismiss)
                NaviDialogButton(
                    title: model.isDisconnecting ? "해제 중…" : "연결 해제",
                    role: .destructive,
                    isEnabled: !model.isDisconnecting
                ) {
                    Task {
                        if await model.disconnectGoogle() { onDismiss() }
                    }
                }
            }
        }
        .naviDialogCard()
    }
}
