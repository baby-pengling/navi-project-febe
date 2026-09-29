import Combine
import Foundation
import Supabase

/// Mirrors `notification_settings` (4 toggles + snooze interval).
struct NotificationPreferences: Equatable {
    var newMail = true
    var calendarReminder = true
    var mailSendConfirmation = true
    var calendarApproval = true
    /// DB CHECK allows 1…1440; the UI offers presets.
    var snoozeMinutes = 9

    static let snoozePresets = [5, 9, 10, 15, 30, 60]
}

/// Mirrors the connection part of `v_account_profile`.
struct ConnectedServices: Equatable {
    var googleEmail: String?
    var mailConnected: Bool
    var calendarConnected: Bool

    var isGoogleConnected: Bool { mailConnected || calendarConnected }
}

enum PasswordChangeError: LocalizedError, Equatable {
    case currentPasswordRequired
    case weakPassword
    case confirmationMismatch

    var errorDescription: String? {
        switch self {
        case .currentPasswordRequired:
            return "현재 비밀번호를 입력해 주세요."
        case .weakPassword:
            return "영문 대/소문자·숫자·특수문자를 포함해 8자 이상 입력하세요."
        case .confirmationMismatch:
            return "새 비밀번호가 서로 일치하지 않아요."
        }
    }
}

/// Settings screen state. Name and login email come from the session; the name is saved with
/// Auth `updateUser`, the password is changed through `AccountService`, and notification
/// preferences are read and written on the `notification_settings` TABLE. Google disconnect
/// needs the `google-auth` Edge Function, which doesn't exist yet, so it only updates this screen.
@MainActor
final class SettingsModel: ObservableObject {
    @Published var name: String
    let loginEmail: String
    /// Saved to `notification_settings` on every change once loaded.
    @Published var notifications = NotificationPreferences() {
        didSet {
            guard hasLoadedNotifications, notifications != oldValue else { return }
            saveNotifications(previous: oldValue)
        }
    }
    @Published private(set) var services: ConnectedServices
    @Published private(set) var isConnectingGoogle = false
    @Published private(set) var connectError: String?
    @Published private(set) var profileError: String?
    @Published private(set) var notificationsError: String?

    private let notificationStore: NotificationSettingsStore?
    private let accountService: AccountService?
    private let googleAuth: GoogleAuthService?
    @Published private(set) var isDisconnecting = false
    @Published var disconnectError: String?
    private var hasLoadedNotifications = false
    private var savedName: String

    init(sessionStore: AppSessionStore) {
        let user = sessionStore.session?.user
        let metadata = user?.userMetadata ?? [:]
        let initialName = metadata["navi_name"]?.stringValue ?? metadata["name"]?.stringValue ?? ""
        name = initialName
        savedName = initialName
        loginEmail = user?.email ?? ""

        let googleEmail = user?.identities?
            .first(where: { $0.provider == "google" })?
            .identityData?["email"]?.stringValue
        let state = sessionStore.onboardingState
        services = ConnectedServices(
            googleEmail: googleEmail,
            mailConnected: state.gmailConnected,
            calendarConnected: state.calendarConnected
        )

        if let client = sessionStore.client, let user {
            notificationStore = NotificationSettingsStore(client: client, userID: user.id)
            accountService = AccountService(client: client)
        } else {
            notificationStore = nil
            accountService = nil
        }
        googleAuth = sessionStore.makeEdgeServices()?.googleAuth
    }

    /// Reads the saved notification preferences.
    func load() async {
        guard let notificationStore, !hasLoadedNotifications else { return }
        do {
            let saved = try await notificationStore.load()
            notifications = saved
            hasLoadedNotifications = true
            notificationsError = nil
        } catch {
            notificationsError = "알림 설정을 불러오지 못했어요."
        }
    }

    private func saveNotifications(previous: NotificationPreferences) {
        guard let notificationStore else { return }
        let updated = notifications
        Task {
            do {
                try await notificationStore.save(updated)
                notificationsError = nil
            } catch {
                // Put the toggle back without saving again.
                hasLoadedNotifications = false
                notifications = previous
                hasLoadedNotifications = true
                notificationsError = "알림 설정을 저장하지 못했어요."
            }
        }
    }

    #if DEBUG
    /// Previews and snapshot tests: a fixed profile and connection state, no session needed.
    init(previewName: String, loginEmail: String, services: ConnectedServices) {
        name = previewName
        savedName = previewName
        self.loginEmail = loginEmail
        self.services = services
        notificationStore = nil
        accountService = nil
        googleAuth = nil
    }
    #endif

    /// Supabase Auth policy (`password_requirements = lower_upper_letters_digits_symbols`,
    /// ≥ 8 chars, see Notion "DB Schema › 비밀번호 정책"). Stricter than the Figma footnote on
    /// purpose: the server rejects anything weaker.
    static func isStrongPassword(_ password: String) -> Bool {
        password.count >= 8
            && password.contains(where: \.isLowercase)
            && password.contains(where: \.isUppercase)
            && password.contains(where: \.isNumber)
            && password.contains(where: { !$0.isLetter && !$0.isNumber && !$0.isWhitespace })
    }

    func validatePasswordChange(current: String, new: String, confirmation: String) -> PasswordChangeError? {
        if current.isEmpty { return .currentPasswordRequired }
        if !Self.isStrongPassword(new) { return .weakPassword }
        if new != confirmation { return .confirmationMismatch }
        return nil
    }

    func changePassword(current: String, new: String) async throws {
        guard let accountService else { throw AppSessionError.notConfigured }
        try await accountService.changePassword(email: loginEmail, current: current, new: new)
    }

    /// Saves the profile name (`navi_name` in Auth user metadata). Empty names are rejected.
    func saveName() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            name = savedName
            profileError = "이름을 입력해 주세요."
            return
        }
        name = trimmed
        guard trimmed != savedName, let accountService else { return }
        Task {
            do {
                _ = try await accountService.updateDisplayName(trimmed)
                savedName = trimmed
                profileError = nil
            } catch {
                profileError = "이름을 저장하지 못했어요."
            }
        }
    }

    /// `DELETE google-auth/disconnect` (202). The worker syncs every cache before revoking, so
    /// data stays as of the last sync. Returns whether the request was accepted.
    func disconnectGoogle() async -> Bool {
        isDisconnecting = true
        disconnectError = nil
        defer { isDisconnecting = false }
        do {
            try await googleAuth?.disconnect()
            services = ConnectedServices(googleEmail: nil, mailConnected: false, calendarConnected: false)
            return true
        } catch EdgeError.server(_, let message) {
            disconnectError = message
        } catch EdgeError.unavailable {
            disconnectError = "연결 해제 기능이 아직 준비되지 않았어요."
        } catch {
            disconnectError = "연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요."
        }
        return false
    }

    /// Gmail and Calendar are granted together in one Google consent, so every "연결" /
    /// "연동하기" button in the main window runs this same flow.
    /// Returns whether the connection succeeded; failures are also kept in `connectError`.
    @discardableResult
    func connectGoogle(using sessionStore: AppSessionStore) async -> Bool {
        isConnectingGoogle = true
        connectError = nil
        defer { isConnectingGoogle = false }
        do {
            try await sessionStore.connectGoogleServices()
            markGoogleConnected(from: sessionStore)
            return true
        } catch {
            connectError = error.localizedDescription
            return false
        }
    }

    private func markGoogleConnected(from sessionStore: AppSessionStore) {
        let state = sessionStore.onboardingState
        services.mailConnected = state.gmailConnected
        services.calendarConnected = state.calendarConnected
        services.googleEmail = sessionStore.session?.user.identities?
            .first(where: { $0.provider == "google" })?
            .identityData?["email"]?.stringValue
    }
}
