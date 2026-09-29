import SwiftUI

/// Figma "비밀번호 변경 대화상자", shown over a dimmed window.
struct PasswordChangeDialog: View {
    @ObservedObject var model: SettingsModel
    let onDismiss: () -> Void

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmation = ""
    @State private var error: PasswordChangeError?
    @State private var failureMessage: String?
    @State private var isSubmitting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("비밀번호 변경")
                .font(NaviFont.heading(18))
                .foregroundStyle(NaviTheme.ink)
            Text("안전한 계정 사용을 위해 현재 비밀번호를 확인하세요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)

            NaviTextField(title: "현재 비밀번호", text: $currentPassword, isSecure: true)
            NaviTextField(title: "새 비밀번호", text: $newPassword, isSecure: true)
            NaviTextField(title: "새 비밀번호 확인", text: $confirmation, isSecure: true)

            Text(footnote)
                .font(NaviFont.body(12))
                .foregroundStyle(hasError ? NaviTheme.red : NaviTheme.grayText)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 11) {
                NaviDialogButton(title: "취소", role: .cancel, action: onDismiss)
                NaviDialogButton(
                    title: isSubmitting ? "변경 중…" : "변경하기",
                    isEnabled: canSubmit,
                    action: submit
                )
            }
        }
        .naviDialogCard()
        .onChange(of: [currentPassword, newPassword, confirmation]) {
            error = nil
            failureMessage = nil
        }
    }

    private var hasError: Bool {
        error != nil || failureMessage != nil
    }

    private var footnote: String {
        failureMessage
            ?? error?.errorDescription
            ?? "영문·숫자·특수문자를 포함해 8자 이상 입력하세요."
    }

    private var canSubmit: Bool {
        !isSubmitting && !currentPassword.isEmpty && !newPassword.isEmpty && !confirmation.isEmpty
    }

    private func submit() {
        if let validationError = model.validatePasswordChange(
            current: currentPassword,
            new: newPassword,
            confirmation: confirmation
        ) {
            error = validationError
            return
        }

        isSubmitting = true
        Task {
            do {
                try await model.changePassword(current: currentPassword, new: newPassword)
                onDismiss()
            } catch {
                failureMessage = error.localizedDescription
            }
            isSubmitting = false
        }
    }
}
