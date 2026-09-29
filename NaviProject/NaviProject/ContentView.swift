import SwiftUI

struct ContentView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @StateObject private var sessionStore = AppSessionStore()
    @State private var onboardingStep: OnboardingStep = .programLanding

    var body: some View {
        Group {
            if !sessionStore.isConfigured {
                ConfigurationErrorView(message: sessionStore.configurationError ?? "Supabase 설정을 확인해 주세요.")
            } else if sessionStore.isRestoringSession {
                LoadingView()
            } else if hasCompletedOnboarding && sessionStore.session != nil {
                MainWindowView(
                    sessionStore: sessionStore,
                    onResetOnboarding: {
                        hasCompletedOnboarding = false
                    },
                    onSignOut: {
                        Task {
                            // The session is gone even if this throws (see `signOut`), so always
                            // reset — after it clears, or onboarding would resume at interests.
                            do {
                                try await sessionStore.signOut()
                            } catch {
                                sessionStore.errorMessage = error.localizedDescription
                            }
                            hasCompletedOnboarding = false
                            onboardingStep = .programLanding
                        }
                    }
                )
                // The dashboard's two-column layout (Figma: 1282×694) needs a wider window.
                .frame(minWidth: 1100, minHeight: 640)
            } else {
                OnboardingRouter(
                    isCompleted: $hasCompletedOnboarding,
                    step: $onboardingStep,
                    sessionStore: sessionStore
                )
            }
        }
        .frame(minWidth: 720, minHeight: 500)
        .onOpenURL { url in
            sessionStore.handleCallback(url)
        }
        .onAppear {
            syncCompletedOnboardingState()
        }
        .onChange(of: sessionStore.onboardingState) { _, state in
            if state.isCompleted {
                hasCompletedOnboarding = true
            }
        }
    }

    private func syncCompletedOnboardingState() {
        guard sessionStore.session != nil else { return }
        if sessionStore.onboardingState.isCompleted {
            hasCompletedOnboarding = true
        }
    }
}

#Preview {
    ContentView()
}

private struct ConfigurationErrorView: View {
    let message: String

    var body: some View {
        NaviCard {
            VStack(spacing: 18) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(NaviTheme.red)
                Text("앱 설정을 확인해 주세요")
                    .font(NaviFont.title(20))
                    .foregroundStyle(NaviTheme.ink)
                Text(message)
                    .font(NaviFont.body(13))
                    .foregroundStyle(NaviTheme.grayMain)
                    .multilineTextAlignment(.center)
            }
        }
    }
}

private enum OnboardingStep {
    case programLanding
    case welcome
    case login
    case signUp
    case interests
    case services
}

private struct OnboardingRouter: View {
    @Binding var isCompleted: Bool
    @Binding var step: OnboardingStep
    @ObservedObject var sessionStore: AppSessionStore
    @State private var interests: [String] = []
    @State private var gmailConnected = false
    @State private var calendarConnected = false
    @State private var loginNotice: String?

    var body: some View {
        Group {
            switch step {
            case .programLanding:
                ProgramLandingView { go(to: .welcome) }
            case .welcome:
                WelcomeView(
                    onLogin: { go(to: .login) },
                    onSignUp: { go(to: .signUp) }
                )
            case .login:
                LoginView(
                    sessionStore: sessionStore,
                    notice: loginNotice,
                    onBack: { go(to: .welcome) },
                    onSuccess: {
                        loginNotice = nil
                        if sessionStore.onboardingState.isCompleted {
                            isCompleted = true
                        } else {
                            go(to: .interests)
                        }
                    }
                )
            case .signUp:
                SignUpView(
                    sessionStore: sessionStore,
                    onBackToLogin: { go(to: .login) },
                    onSuccess: {
                        loginNotice = "회원가입이 완료되었습니다. 로그인해 주세요."
                        go(to: .login)
                    }
                )
            case .interests:
                InterestSelectionView(
                    sessionStore: sessionStore,
                    interests: $interests,
                    onNext: {
                        do {
                            try await sessionStore.saveInterests(interests)
                            go(to: .services)
                        } catch {
                            sessionStore.errorMessage = error.localizedDescription
                        }
                    }
                )
            case .services:
                ServiceConnectionView(
                    sessionStore: sessionStore,
                    gmailConnected: $gmailConnected,
                    calendarConnected: $calendarConnected,
                    onComplete: {
                        do {
                            try await sessionStore.completeOnboarding(
                                interests: interests,
                                gmailConnected: gmailConnected,
                                calendarConnected: calendarConnected
                            )
                            isCompleted = true
                        } catch {
                            sessionStore.errorMessage = error.localizedDescription
                        }
                    }
                )
            }
        }
        .animation(.easeInOut(duration: 0.22), value: step)
        .onAppear {
            hydrateFromSession()
            resumeAfterAuthenticationIfNeeded()
        }
        .onChange(of: sessionStore.session != nil) { _, isAuthenticated in
            guard isAuthenticated, !isCompleted else { return }
            hydrateFromSession()
            resumeAfterAuthenticationIfNeeded()
        }
        .onChange(of: sessionStore.onboardingState) { _, _ in
            hydrateFromSession()
        }
    }

    private func go(to nextStep: OnboardingStep) {
        step = nextStep
    }

    private func resumeAfterAuthenticationIfNeeded() {
        // The landing and welcome screens are only for unauthenticated users.
        // When Supabase restores a session (or a login/signup finishes), never
        // send the user back to the beginning of onboarding.
        guard sessionStore.session != nil, !isCompleted else { return }
        guard step == .programLanding || step == .welcome else { return }
        step = .interests
    }

    private func hydrateFromSession() {
        guard sessionStore.session != nil else { return }

        let savedState = sessionStore.onboardingState
        interests = savedState.interests
        gmailConnected = savedState.gmailConnected
        calendarConnected = savedState.calendarConnected
    }
}

// MARK: - Screens

private struct ProgramLandingView: View {
    let onFinished: () -> Void

    var body: some View {
        NaviCard {
            HStack(spacing: 16) {
                Image("LogoMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 56)
                Image("LogoWordmark")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 44)
            }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                onFinished()
            }
        }
    }
}

private struct WelcomeView: View {
    let onLogin: () -> Void
    let onSignUp: () -> Void

    var body: some View {
        NaviCard {
            VStack(spacing: 40) {
                VStack(spacing: 30) {
                    NaviMascotView(width: 129)
                    VStack(spacing: 14) {
                        naviTitle("안녕하세요, ", suffix: "예요.")
                            .foregroundStyle(NaviTheme.ink)
                        Text("중요한 것을 놓치지 않도록 메일·일정을 미리 확인하고,\n실행까지 도와드릴게요.")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayMain)
                            .multilineTextAlignment(.center)
                            .lineSpacing(4)
                    }
                }

                VStack(spacing: 10) {
                    NaviButton(title: "로그인", action: onLogin)
                    NaviButton(title: "새 계정 만들기", style: .secondary, action: onSignUp)
                }
            }
        }
    }
}

private struct LoginView: View {
    @ObservedObject var sessionStore: AppSessionStore
    let notice: String?
    let onBack: () -> Void
    let onSuccess: () -> Void

    @State private var email = ""
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isSubmitting = false

    private var canSubmit: Bool {
        !isSubmitting
            && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !password.isEmpty
    }

    var body: some View {
        NaviCard {
            VStack(spacing: 20) {
                VStack(spacing: 30) {
                    NaviMascotView(width: 129)
                    VStack(spacing: 14) {
                        Text("다시 만나서 반가워요!")
                            .font(NaviFont.title(25))
                            .foregroundStyle(NaviTheme.ink)
                        Text("계속하려면 계정에 로그인해 주세요.")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayMain)
                    }
                }

                    VStack(spacing: 15) {
                        NaviTextField(title: "이메일", text: $email)
                        NaviTextField(title: "비밀번호", text: $password, isSecure: true)
                    if let notice {
                        NaviInlineNotice(message: notice)
                    }
                    if let errorMessage {
                        NaviInlineError(message: errorMessage)
                    }

                    VStack(spacing: 20) {
                        NaviButton(title: "로그인", isEnabled: canSubmit) {
                            isSubmitting = true
                            Task {
                                defer { isSubmitting = false }
                                do {
                                    try await sessionStore.signIn(email: email, password: password)
                                    onSuccess()
                                } catch {
                                    errorMessage = error.localizedDescription
                                }
                            }
                        }
                        NaviLinkButton(title: "← 처음으로", action: onBack)
                    }
                }
            }
        }
    }
}

private struct SignUpView: View {
    @ObservedObject var sessionStore: AppSessionStore
    let onBackToLogin: () -> Void
    let onSuccess: () -> Void

    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var role = ""
    @State private var errorField: ErrorField?
    @State private var errorMessage: String?
    @State private var isSubmitting = false
    @State private var isResendingConfirmation = false
    @State private var requiresEmailConfirmation = false

    private enum ErrorField { case email, password }

    private var canSubmit: Bool {
        !isSubmitting
            && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !password.isEmpty
    }

    var body: some View {
        NaviCard {
            VStack(spacing: 20) {
                VStack(spacing: 10) {
                    NaviMascotView(width: 129)
                    VStack(spacing: 14) {
                        naviTitle("나만의 ", suffix: " 만들기")
                            .foregroundStyle(NaviTheme.ink)
                        Text("업무 방식과 말투를 학습해 나에게 맞는 조력자가 됩니다.")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayMain)
                            .multilineTextAlignment(.center)
                    }
                }

                VStack(spacing: 15) {
                    NaviTextField(title: "이름", text: $name, isRequired: true)
                    NaviTextField(title: "이메일", text: $email, isRequired: true)
                    if errorField == .email, let errorMessage {
                        NaviInlineError(message: errorMessage)
                    }
                    NaviTextField(title: "비밀번호", text: $password, isSecure: true, isRequired: true)
                    if errorField == .password, let errorMessage {
                        NaviInlineError(message: errorMessage)
                    }
                    NaviTextField(title: "직업 / 역할", text: $role)
                    if errorField == nil, let errorMessage {
                        NaviInlineError(message: errorMessage)
                    }
                    if requiresEmailConfirmation {
                        NaviButton(
                            title: isResendingConfirmation ? "인증 메일 보내는 중..." : "인증 메일 다시 보내기",
                            style: .secondary,
                            isEnabled: !isResendingConfirmation,
                            action: resendConfirmation
                        )
                    }

                    VStack(spacing: 20) {
                        NaviButton(title: "계정 만들기", isEnabled: canSubmit, action: submit)
                        NaviLinkButton(title: "← 이미 계정이 있나요? 로그인 하러가기", action: onBackToLogin)
                    }
                }
            }
        }
    }

    private func submit() {
        let emailIsValid = email.range(
            of: #"^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
        if !emailIsValid {
            errorField = .email
            errorMessage = "올바른 이메일이 아닙니다."
        } else if password.count < 8 {
            errorField = .password
            errorMessage = "비밀번호는 8자리 이상이어야 합니다."
        } else {
            errorField = nil
            errorMessage = nil
            requiresEmailConfirmation = false
            isSubmitting = true
            Task {
                defer { isSubmitting = false }
                do {
                    let sessionCreated = try await sessionStore.signUp(
                        name: name,
                        email: email,
                        password: password,
                        role: role
                    )
                    if sessionCreated {
                        // Supabase returns a session when Confirm email is off.
                        // Keep signup and login as separate user-visible steps by
                        // clearing that session before showing the login screen.
                        try await sessionStore.signOut()
                        onSuccess()
                    } else {
                        requiresEmailConfirmation = true
                        errorMessage = "가입이 완료되었습니다. 이메일 인증 후 로그인해 주세요."
                    }
                } catch {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func resendConfirmation() {
        isResendingConfirmation = true
        errorMessage = nil
        Task {
            defer { isResendingConfirmation = false }
            do {
                try await sessionStore.resendSignupConfirmation(email: email)
                errorMessage = "인증 메일을 다시 보냈어요. 받은 편지함을 확인해 주세요."
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private struct LoadingView: View {
    var body: some View {
        ZStack {
            NaviTheme.background.ignoresSafeArea()
            ProgressView()
                .tint(NaviTheme.purple)
        }
    }
}

private struct InterestSelectionView: View {
    @ObservedObject var sessionStore: AppSessionStore
    @Binding var interests: [String]
    let onNext: () async -> Void

    @State private var draft = ""
    @State private var isSaving = false

    var body: some View {
        NaviCard {
            VStack(spacing: 20) {
                VStack(spacing: 10) {
                    NaviMascotView(width: 129)
                    VStack(spacing: 14) {
                        naviTitle("관심사를 알려주시면,\n", suffix: "가 먼저 찾아드려요")
                            .multilineTextAlignment(.center)
                            .foregroundStyle(NaviTheme.ink)
                        Text("관심 분야와 키워드를 등록해 주세요. AI가 관련 메일과 일정, 할 일을 찾아 중요한 소식과 다음 행동을 한곳에 모아드릴게요.")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayMain)
                            .multilineTextAlignment(.center)
                    }
                }

                VStack(alignment: .leading, spacing: 5) {
                    Text("관심 분야 / 키워드")
                        .font(NaviFont.body(11, weight: .semibold))
                        .foregroundStyle(NaviTheme.grayText)

                    NaviFlowLayout(spacing: 5) {
                        ForEach(interests, id: \.self) { interest in
                            InterestChip(title: interest) {
                                interests.removeAll { $0 == interest }
                            }
                        }
                        TextField("", text: $draft)
                            .textFieldStyle(.plain)
                            .font(NaviFont.body(13))
                            .frame(minWidth: 90)
                            .onSubmit(addDraft)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(NaviTheme.cardWhite)
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(NaviTheme.border, lineWidth: 1))

                VStack(spacing: 10) {
                    NaviButton(
                        title: "관심 분야 추가",
                        isEnabled: !isSaving && (!interests.isEmpty || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
                        action: continueAfterAddingDraft
                    )
                    NaviButton(title: "건너뛰기", style: .secondary, isEnabled: !isSaving, action: continueWithoutInterests)
                    if let errorMessage = sessionStore.errorMessage {
                        NaviInlineError(message: errorMessage)
                    }
                }
            }
        }
    }

    private func addDraft() {
        let newInterests = draft
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        for interest in newInterests where !interests.contains(interest) {
            interests.append(interest)
        }
        draft = ""
    }

    private func continueAfterAddingDraft() {
        guard !isSaving else { return }
        addDraft()
        saveAndContinue()
    }

    private func continueWithoutInterests() {
        guard !isSaving else { return }
        saveAndContinue()
    }

    private func saveAndContinue() {
        isSaving = true
        sessionStore.errorMessage = nil
        Task {
            defer { isSaving = false }
            await onNext()
        }
    }
}

private struct ServiceConnectionView: View {
    @ObservedObject var sessionStore: AppSessionStore
    @Binding var gmailConnected: Bool
    @Binding var calendarConnected: Bool
    let onComplete: () async -> Void
    @State private var isConnecting = false
    @State private var isCompleting = false

    private var canComplete: Bool {
        gmailConnected || calendarConnected
    }

    var body: some View {
        NaviCard {
            VStack(spacing: 50) {
                VStack(spacing: 30) {
                    NaviMascotView(width: 129)
                    VStack(spacing: 14) {
                        Text("연결하면 더 정확해져요")
                            .font(NaviFont.title(25))
                            .foregroundStyle(NaviTheme.ink)
                        Text("연결한 정보는 허용한 범위에서만 읽어요.")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayMain)
                    }
                }

                VStack(spacing: 15) {
                    ServiceRow(
                        title: "Gmail",
                        subtitle: "Google 계정으로 연결",
                        icon: "envelope.fill",
                        iconColor: .red,
                        isSelected: gmailConnected
                    ) {
                        connectGoogle()
                    }
                    .disabled(isConnecting)
                    ServiceRow(
                        title: "Google Calendar",
                        subtitle: "Google 계정으로 연결",
                        icon: "calendar",
                        iconColor: .blue,
                        isSelected: calendarConnected
                    ) {
                        connectGoogle()
                    }
                    .disabled(isConnecting)
                    if let errorMessage = sessionStore.errorMessage {
                        NaviInlineError(message: errorMessage)
                    }
                    NaviButton(title: "연결 완료", isEnabled: canComplete && !isConnecting && !isCompleting, action: complete)
                    NaviButton(title: "나중에 연결하고 시작하기", style: .secondary, isEnabled: !isConnecting && !isCompleting, action: complete)
                }
            }
        }
    }

    private func connectGoogle() {
        isConnecting = true
        sessionStore.errorMessage = nil
        Task {
            defer { isConnecting = false }
            do {
                // One Google authorization grants the two requested read-only
                // scopes, so both service indicators become available together.
                try await sessionStore.connectGoogleServices()
                gmailConnected = true
                calendarConnected = true
            } catch {
                sessionStore.errorMessage = error.localizedDescription
            }
        }
    }

    private func complete() {
        guard !isCompleting else { return }
        isCompleting = true
        sessionStore.errorMessage = nil
        Task {
            defer { isCompleting = false }
            await onComplete()
        }
    }
}

private struct ServiceRow: View {
    let title: String
    let subtitle: String
    let icon: String
    let iconColor: Color
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 15) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(iconColor)
                    .frame(width: 41, height: 41)
                    .background(NaviTheme.cardWhite)
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(NaviFont.title(14))
                        .foregroundStyle(NaviTheme.ink)
                    Text(subtitle)
                        .font(NaviFont.body(12))
                        .foregroundStyle(NaviTheme.grayText)
                }

                Spacer()

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(isSelected ? NaviTheme.purple : NaviTheme.border)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 15)
            .background(NaviTheme.cardWhite)
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(isSelected ? NaviTheme.purple : NaviTheme.border, lineWidth: isSelected ? 1.5 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 15))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Shared building blocks

/// A fixed-width (≤400pt) card centered in the window, matching the Figma "Welcome modal"
/// component. Shrinking only on windows narrower than the card keeps the layout stable —
/// buttons and inputs always span the card's own width instead of stretching independently.
private struct NaviCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                content
                    .padding(.horizontal, 10)
                    .padding(.vertical, 24)
                    .frame(width: min(400, max(proxy.size.width - 48, 260)))
                    .frame(minHeight: proxy.size.height, alignment: .center)
                    .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
        .background(NaviTheme.background)
    }
}

private struct InterestChip: View {
    let title: String
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 3) {
            Text(title)
                .font(NaviFont.body(12, weight: .medium))
                .foregroundStyle(NaviTheme.purple)
                .lineLimit(1)
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(NaviTheme.purple)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(NaviTheme.lavender)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}

private struct NaviInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.circle.fill")
            Text(message)
        }
        .font(NaviFont.body(12))
        .foregroundStyle(NaviTheme.red)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct NaviInlineNotice: View {
    let message: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
            Text(message)
        }
        .font(NaviFont.body(12))
        .foregroundStyle(NaviTheme.purple)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct NaviLinkButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(NaviFont.body(14, weight: .semibold))
                .foregroundStyle(NaviTheme.purple)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("navi.button.\(title)")
    }
}

/// A "제목 안의 navi" title: the brand word renders in a heavier stand-in weight since the
/// actual Paperlogy / Bagel Fat One typefaces aren't bundled with the app yet.
private func naviTitle(_ prefix: String, suffix: String, size: CGFloat = 25) -> Text {
    Text(prefix).font(NaviFont.title(size))
        + Text("navi").font(NaviFont.wordmark(size + 5))
        + Text(suffix).font(NaviFont.title(size))
}

/// Simple left-to-right wrapping layout used for the interest chips + inline text field.
private struct NaviFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var isFirstInRow = true

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if !isFirstInRow, rowWidth + spacing + size.width > maxWidth {
                totalHeight += rowHeight + spacing
                rowWidth = 0
                rowHeight = 0
                isFirstInRow = true
            }
            rowWidth += (isFirstInRow ? 0 : spacing) + size.width
            rowHeight = max(rowHeight, size.height)
            isFirstInRow = false
        }
        totalHeight += rowHeight
        return CGSize(width: maxWidth.isFinite ? maxWidth : rowWidth, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
