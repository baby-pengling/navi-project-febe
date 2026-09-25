import AuthenticationServices
import Combine
import Foundation
import Supabase

#if os(macOS)
import AppKit
#endif

@MainActor
final class AppSessionStore: ObservableObject {
    static let redirectURL = URL(string: "navi://auth-callback")!

    @Published private(set) var session: Session?
    @Published private(set) var isLoading = true
    @Published private(set) var isRestoringSession = true
    @Published var errorMessage: String?

    let client: SupabaseClient?
    let configurationError: String?

    private var authChangesTask: Task<Void, Never>?
    private var authenticationSession: ASWebAuthenticationSession?
    private var presentationProvider: OAuthPresentationContextProvider?

    init() {
        guard
            let rawURL = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
            let supabaseURL = URL(string: rawURL),
            let anonKey = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String,
            !rawURL.contains("your-project-ref"),
            !anonKey.contains("your-anon-key")
        else {
            client = nil
            configurationError = "Supabase 설정이 없습니다. Secrets.xcconfig를 확인해 주세요."
            return
        }

        let client = SupabaseClient(
            supabaseURL: supabaseURL,
            supabaseKey: anonKey,
            options: .init(auth: .init(redirectToURL: Self.redirectURL))
        )
        self.client = client
        configurationError = nil

        authChangesTask = Task { [weak self] in
            for await (_, session) in client.auth.authStateChanges {
                guard !Task.isCancelled else { return }
                self?.session = session
                self?.isLoading = false
                self?.isRestoringSession = false
            }
        }
    }

    deinit {
        authChangesTask?.cancel()
    }

    var isConfigured: Bool {
        client != nil
    }

    var onboardingState: OnboardingState {
        guard let session else { return OnboardingState() }

        let metadata = session.user.userMetadata
        let interests = metadata["navi_interests"]?.arrayValue?.compactMap(\.stringValue) ?? []

        return OnboardingState(
            interests: interests,
            gmailConnected: metadata["navi_gmail_connected"]?.boolValue ?? false,
            calendarConnected: metadata["navi_calendar_connected"]?.boolValue ?? false,
            isCompleted: metadata["navi_onboarding_completed"]?.boolValue == true
                || metadata["navi_onboarding_step"]?.stringValue == "complete"
        )
    }

    func signIn(email: String, password: String) async throws {
        guard let client else { throw AppSessionError.notConfigured }

        isLoading = true
        errorMessage = nil
        do {
            session = try await client.auth.signIn(email: email, password: password)
            isLoading = false
        } catch {
            isLoading = false
            throw normalizedAuthError(error)
        }
    }

    func signOut() async throws {
        guard let client else { throw AppSessionError.notConfigured }
        try await client.auth.signOut()
        session = nil
    }

    func signUp(name: String, email: String, password: String, role: String) async throws -> Bool {
        guard let client else { throw AppSessionError.notConfigured }

        isLoading = true
        errorMessage = nil
        do {
            let response = try await client.auth.signUp(
                email: email,
                password: password,
                data: [
                    // Keep the original display name key for compatibility with
                    // existing Supabase users, while also storing Navi's profile
                    // fields in auth.users.raw_user_meta_data.
                    "name": .string(name),
                    "navi_name": .string(name),
                    "navi_role": .string(role),
                    "navi_onboarding_step": .string("interests")
                ],
                redirectTo: Self.redirectURL
            )

            if let newSession = response.session {
                session = newSession
                var metadata: [String: AnyJSON] = ["navi_name": .string(name)]
                if !role.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    metadata["navi_role"] = .string(role)
                }
                try await updateUserMetadata(metadata)
            }

            isLoading = false
            return response.session != nil
        } catch {
            isLoading = false
            throw normalizedAuthError(error)
        }
    }

    func resendSignupConfirmation(email: String) async throws {
        guard let client else { throw AppSessionError.notConfigured }

        do {
            try await client.auth.resend(email: email, type: .signup, emailRedirectTo: Self.redirectURL)
        } catch {
            throw normalizedAuthError(error)
        }
    }

    func saveInterests(_ interests: [String]) async throws {
        try await updateUserMetadata([
            "navi_interests": .array(interests.map(AnyJSON.string)),
            "navi_onboarding_step": .string("services")
        ])
        try await saveOnboardingMemory(interests: interests)
    }

    func connectGoogleServices() async throws {
        guard let client else { throw AppSessionError.notConfigured }

        isLoading = true
        errorMessage = nil
        do {
            let response = try await client.auth.getLinkIdentityURL(
                provider: .google,
                scopes: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly",
                redirectTo: Self.redirectURL,
                queryParams: [
                    (name: "access_type", value: "offline"),
                    (name: "prompt", value: "consent")
                ]
            )

            let callbackURL = try await authenticate(
                using: response.url,
                callbackURLScheme: Self.redirectURL.scheme!
            )
            session = try await client.auth.session(from: callbackURL)
            try await ensureConnectedUserProfile()

            try await updateUserMetadata([
                "navi_gmail_connected": .bool(true),
                "navi_calendar_connected": .bool(true),
                "navi_onboarding_step": .string("services")
            ])
            isLoading = false
        } catch {
            isLoading = false
            throw normalizedAuthError(error)
        }
    }

    func completeOnboarding(interests: [String], gmailConnected: Bool, calendarConnected: Bool) async throws {
        try await updateUserMetadata([
            "navi_interests": .array(interests.map(AnyJSON.string)),
            "navi_gmail_connected": .bool(gmailConnected),
            "navi_calendar_connected": .bool(calendarConnected),
            "navi_onboarding_step": .string("complete"),
            "navi_onboarding_completed": .bool(true)
        ])
        try await saveOnboardingMemory(interests: interests)
    }

    func handleCallback(_ url: URL) {
        client?.auth.handle(url)
    }

    private func updateUserMetadata(_ values: [String: AnyJSON]) async throws {
        guard let client else { throw AppSessionError.notConfigured }
        let updatedUser = try await client.auth.update(user: UserAttributes(data: values))
        guard var currentSession = session, currentSession.user.id == updatedUser.id else { return }
        currentSession.user = updatedUser
        session = currentSession
    }

    private func saveOnboardingMemory(interests: [String]) async throws {
        guard let client, let session else { throw AppSessionError.notConfigured }

        let userID = session.user.id.uuidString
        let role = session.user.userMetadata["navi_role"]?.stringValue?
            .trimmingCharacters(in: .whitespacesAndNewlines)

        try await client
            .from("user_memory")
            .delete()
            .eq("user_id", value: userID)
            .eq("key", value: "role")
            .execute()

        if let role, !role.isEmpty {
            try await client
                .from("user_memory")
                .insert([
                    "user_id": .string(userID),
                    "key": .string("role"),
                    "value": .string(role),
                    "source": .string("onboarding")
                ] as [String: AnyJSON])
                .execute()
        }

        try await client
            .from("user_memory")
            .delete()
            .eq("user_id", value: userID)
            .eq("key", value: "interest_tag")
            .execute()

        let normalizedInterests = interests
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        guard !normalizedInterests.isEmpty else { return }

        let rows: [[String: AnyJSON]] = normalizedInterests.map { interest in
            [
                "user_id": .string(userID),
                "key": .string("interest_tag"),
                "value": .string(interest),
                "source": .string("onboarding")
            ]
        }

        try await client
            .from("user_memory")
            .insert(rows)
            .execute()
    }

    private func ensureConnectedUserProfile() async throws {
        guard let client, let session else { throw AppSessionError.notConfigured }

        let googleIdentity = session.user.identities?.first(where: { $0.provider == "google" })
        let identityData = googleIdentity?.identityData
        let googleEmail = identityData?["email"]?.stringValue ?? session.user.email
        let googleSubject = identityData?["sub"]?.stringValue
            ?? identityData?["id"]?.stringValue
            ?? googleIdentity?.id

        guard let googleEmail, let googleSubject else {
            throw AppSessionError.googleIdentityMissing
        }

        let userID = session.user.id.uuidString
        try await client
            .from("users")
            .upsert([
                "id": .string(userID),
                "google_email": .string(googleEmail),
                "google_subject": .string(googleSubject)
            ] as [String: AnyJSON], onConflict: "id", returning: .minimal)
            .execute()

        try await client
            .from("auth_status")
            .upsert([
                "user_id": .string(userID),
                "status": .string("connected"),
                "mail_connected": .bool(true),
                "calendar_connected": .bool(true)
            ] as [String: AnyJSON], onConflict: "user_id", returning: .minimal)
            .execute()
    }

    private func normalizedAuthError(_ error: Error) -> Error {
        let diagnostic = [
            error.localizedDescription,
            String(describing: error),
            String(reflecting: error)
        ]
        .joined(separator: " ")
        .lowercased()

        if diagnostic.contains("over_email_send_rate_limit")
            || diagnostic.contains("email rate limit")
            || diagnostic.contains("rate limit")
            || diagnostic.contains("security purposes") {
            let seconds = diagnostic
                .split(whereSeparator: { !$0.isNumber })
                .compactMap { Int($0) }
                .first(where: { $0 > 0 && $0 <= 3600 })
            return AppSessionError.rateLimited(seconds: seconds)
        }

        if diagnostic.contains("email not confirmed")
            || diagnostic.contains("email_not_confirmed") {
            return AppSessionError.emailConfirmationRequired
        }

        if diagnostic.contains("unsupported provider")
            || diagnostic.contains("provider is not enabled") {
            return AppSessionError.googleProviderNotConfigured
        }

        if diagnostic.contains("manual linking is disabled") {
            return AppSessionError.manualLinkingDisabled
        }

        return error
    }

    private func authenticate(using url: URL, callbackURLScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let provider = OAuthPresentationContextProvider()
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackURLScheme
            ) { [weak self] callbackURL, error in
                self?.authenticationSession = nil
                self?.presentationProvider = nil

                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: AppSessionError.missingOAuthCallback)
                }
            }

            session.presentationContextProvider = provider
            presentationProvider = provider
            authenticationSession = session

            guard session.start() else {
                authenticationSession = nil
                presentationProvider = nil
                continuation.resume(throwing: AppSessionError.oauthStartFailed)
                return
            }
        }
    }
}

enum AppSessionError: LocalizedError {
    case notConfigured
    case missingOAuthCallback
    case oauthStartFailed
    case emailConfirmationRequired
    case googleProviderNotConfigured
    case manualLinkingDisabled
    case googleIdentityMissing
    case rateLimited(seconds: Int?)

    var retryAfterSeconds: Int? {
        if case let .rateLimited(seconds) = self {
            return seconds
        }
        return nil
    }

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Supabase 설정이 없습니다."
        case .missingOAuthCallback:
            return "Google 인증 결과를 받지 못했습니다."
        case .oauthStartFailed:
            return "Google 인증 창을 열지 못했습니다."
        case .emailConfirmationRequired:
            return "이메일 인증이 완료되지 않았어요. 받은 편지함에서 인증 링크를 먼저 눌러 주세요."
        case .googleProviderNotConfigured:
            return "Google 연동이 아직 설정되지 않았어요. Supabase에서 Google provider를 활성화해 주세요."
        case .manualLinkingDisabled:
            return "Google 계정 연결이 비활성화되어 있어요. Supabase에서 Allow manual linking을 켜 주세요."
        case .googleIdentityMissing:
            return "Google 계정 정보를 확인하지 못했어요. 연동을 취소하고 다시 시도해 주세요."
        case let .rateLimited(seconds):
            if let seconds {
                return "인증 메일 요청이 잠시 제한되었어요. \(seconds)초 후 다시 시도해 주세요."
            }
            return "인증 메일 요청이 잠시 제한되었어요. 잠시 후 다시 시도해 주세요."
        }
    }
}

struct OnboardingState: Equatable, Sendable {
    var interests: [String] = []
    var gmailConnected = false
    var calendarConnected = false
    var isCompleted = false
}

private final class OAuthPresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for _: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        return NSApplication.shared.keyWindow ?? NSApplication.shared.mainWindow ?? NSWindow()
        #else
        return ASPresentationAnchor()
        #endif
    }
}
