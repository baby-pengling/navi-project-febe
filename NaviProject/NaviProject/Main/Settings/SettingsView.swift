import SwiftUI

/// Figma "12 - 설정": profile + notifications on the left, connected services on the right.
struct SettingsView: View {
    @ObservedObject var sessionStore: AppSessionStore
    @ObservedObject var model: SettingsModel
    @Binding var activeDialog: MainDialog?
    let onSignOut: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("설정")
                .font(NaviFont.title(28))
                .foregroundStyle(NaviTheme.ink)

            // Figma: the notifications card stretches to the bottom of the window; scroll only
            // when the window is shorter than the content.
            GeometryReader { geometry in
                ScrollView {
                    HStack(alignment: .top, spacing: 12) {
                        VStack(spacing: 12) {
                            profilePanel
                            notificationsPanel
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                        servicesPanel
                            .frame(maxWidth: .infinity)
                    }
                    .padding(.bottom, 10)
                    .frame(minHeight: geometry.size.height, alignment: .top)
                }
                .scrollIndicators(.hidden)
            }
        }
        .task { await model.load() }
        .onDisappear {
            // Commit an edited name when leaving the screen without pressing Return.
            model.saveName()
        }
    }

    // MARK: - Profile

    private var profilePanel: some View {
        NaviPanel {
            NaviSectionHeader(title: "프로필")
            NaviTextField(title: "이름", text: $model.name)
                .onSubmit { model.saveName() }
            if let profileError = model.profileError {
                Text(profileError)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.red)
            }
            ReadOnlyField(title: "이메일", value: model.loginEmail)
            HStack {
                Text("비밀번호는 안전하게 별도 화면에서 변경해요.")
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
                Spacer()
                NaviPillButton(title: "비밀번호 변경") {
                    activeDialog = .passwordChange
                }
            }
            // Not in Figma: signing out returns to the onboarding flow.
            HStack {
                Text("이 기기에서 로그아웃하고 처음 화면으로 돌아가요.")
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
                Spacer()
                NaviPillButton(title: "로그아웃", style: .outline, action: onSignOut)
            }
        }
    }

    // MARK: - Notifications

    private var notificationsPanel: some View {
        NaviPanel(spacing: 9, horizontalPadding: 16, verticalPadding: 16, fillsHeight: true) {
            NaviSectionHeader(title: "알림 설정")
            snoozeField
            notificationRow("새 메일 알림", isOn: $model.notifications.newMail)
            notificationRow("일정 리마인드", isOn: $model.notifications.calendarReminder)
            notificationRow("메일 발송 승인 요청", isOn: $model.notifications.mailSendConfirmation)
            notificationRow("일정 등록 승인 요청", isOn: $model.notifications.calendarApproval)
            if let notificationsError = model.notificationsError {
                Text(notificationsError)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.red)
            }
        }
    }

    private var snoozeField: some View {
        Menu {
            ForEach(NotificationPreferences.snoozePresets, id: \.self) { minutes in
                Button("\(minutes)분") { model.notifications.snoozeMinutes = minutes }
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("스누즈 간격 · 기본값 9분")
                        .font(NaviFont.body(11, weight: .semibold))
                        .foregroundStyle(NaviTheme.grayText)
                    Text("\(model.notifications.snoozeMinutes)분")
                        .font(NaviFont.body(14, weight: .medium))
                        .foregroundStyle(NaviTheme.ink)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(NaviTheme.grayText)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(NaviTheme.cardWhite)
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(NaviTheme.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityLabel("스누즈 간격")
        .accessibilityValue("\(model.notifications.snoozeMinutes)분")
    }

    private func notificationRow(_ title: String, isOn: Binding<Bool>) -> some View {
        Toggle(title, isOn: isOn)
            .toggleStyle(NaviCheckToggleStyle())
            .padding(.horizontal, 8)
            .frame(height: 42)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Connected services

    private var servicesPanel: some View {
        NaviPanel {
            NaviSectionHeader(title: "연결된 서비스", tag: "2개")
            Text(googleAccountCaption)
                .font(NaviFont.body(10))
                .foregroundStyle(NaviTheme.grayText)
            serviceRow("Gmail", logo: "GmailLogo", isConnected: model.services.mailConnected)
            serviceRow("Google Calendar", logo: "GoogleCalendarLogo", isConnected: model.services.calendarConnected)
            if let connectError = model.connectError {
                Text(connectError)
                    .font(NaviFont.body(11))
                    .foregroundStyle(NaviTheme.red)
            }
        }
    }

    private var googleAccountCaption: String {
        if let email = model.services.googleEmail {
            return "Google 계정 · \(email)"
        }
        return model.services.isGoogleConnected ? "Google 계정" : "Google 계정이 아직 연결되지 않았어요."
    }

    private func serviceRow(_ title: String, logo: String, isConnected: Bool) -> some View {
        HStack {
            HStack(spacing: 15) {
                Image(logo)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 28, height: 28)
                    .accessibilityHidden(true)
                Text(title)
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.ink)
            }
            Spacer()
            HStack(spacing: 10) {
                NaviStatusBadge(isConnected: isConnected)
                if isConnected {
                    NaviPillButton(title: "관리") {
                        activeDialog = .googleDisconnect
                    }
                } else {
                    NaviPillButton(title: model.isConnectingGoogle ? "연결 중…" : "연결") {
                        Task { await model.connectGoogle(using: sessionStore) }
                    }
                    .disabled(model.isConnectingGoogle)
                }
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 12)
        .background(NaviTheme.itemBackground)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}

// MARK: - Settings-specific pieces

/// Same look as `NaviTextField`, for values the user can't edit here (login email).
private struct ReadOnlyField: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(NaviFont.body(11, weight: .semibold))
                .foregroundStyle(NaviTheme.grayText)
            Text(value.isEmpty ? " " : value)
                .font(NaviFont.body(14, weight: .medium))
                .foregroundStyle(NaviTheme.ink)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NaviTheme.cardWhite)
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(NaviTheme.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Read-only "연결 됨" / "연결 안 됨" state shown next to each service.
private struct NaviStatusBadge: View {
    let isConnected: Bool

    var body: some View {
        Text(isConnected ? "연결 됨" : "연결 안 됨")
            .font(NaviFont.body(12, weight: .bold))
            .foregroundStyle(isConnected ? NaviTheme.green : NaviTheme.grayText)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
            .background(isConnected ? NaviTheme.greenLight : NaviTheme.cardWhite)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay {
                if !isConnected {
                    RoundedRectangle(cornerRadius: 8).stroke(NaviTheme.border, lineWidth: 1)
                }
            }
    }
}

/// Figma "Checked": a 30pt green circle with a checkmark; off is an empty outlined circle.
private struct NaviCheckToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack {
                configuration.label
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.ink)
                Spacer()
                ZStack {
                    Circle()
                        .fill(configuration.isOn ? NaviTheme.greenLight : NaviTheme.cardWhite)
                    Circle()
                        .stroke(configuration.isOn ? Color.clear : NaviTheme.border, lineWidth: 1)
                    if configuration.isOn {
                        Image(systemName: "checkmark")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(NaviTheme.green)
                    }
                }
                .frame(width: 30, height: 30)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(configuration.isOn ? .isSelected : [])
    }
}
