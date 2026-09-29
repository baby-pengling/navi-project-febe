import SwiftUI

/// Google connect flow for the mail / calendar tabs, from Figma "03 Final Prototype":
/// "08 - 메일 > 연동하세요" → "계정 연동" (service choice) → "계정 연동 > 권한 안내" →
/// "계정 연동 > 완료" or "계정 연동 > 실패". The calendar tab reuses the same screens with
/// calendar copy (it has no frames of its own). Gmail and Calendar share one Google consent.
struct ServiceConnectFlow: View {
    enum Service: Equatable {
        case mail
        case calendar
    }

    enum Step: Equatable {
        case prompt
        case chooser
        case permissions
        case success
        case failure
    }

    let service: Service
    @ObservedObject var sessionStore: AppSessionStore
    @ObservedObject var model: SettingsModel
    @Binding var step: Step
    /// "메일로 돌아가기" / "일정으로 돌아가기" after a successful connection.
    let onFinish: () -> Void

    @State private var searchText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NaviTabHeader(
                title: copy.tabTitle,
                searchPrompt: copy.searchPrompt,
                searchText: $searchText,
                isSearchEnabled: false
            )

            content
                .frame(width: 460)
                .multilineTextAlignment(.center)
                .padding(30)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(NaviTheme.cardWhite)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.bottom, 10)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .prompt: prompt
        case .chooser: chooser
        case .permissions: permissions
        case .success: success
        case .failure: failure
        }
    }

    // MARK: - Steps

    private var prompt: some View {
        VStack(spacing: 15) {
            serviceLogo(height: 50)
            heading(copy.promptTitle, copy.promptSubtitle)
            VStack(alignment: .leading, spacing: 8) {
                Text(copy.benefits)
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.dark)
                Text(copy.benefitsCaveat)
                    .font(NaviFont.body(12))
                    .foregroundStyle(NaviTheme.grayText)
            }
            .multilineTextAlignment(.leading)
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            NaviButton(title: copy.promptButton) { step = .chooser }
            Text("연동한 계정은 설정에서 관리할 수 있어요.")
                .font(NaviFont.body(10))
                .foregroundStyle(NaviTheme.grayText)
        }
    }

    private var chooser: some View {
        VStack(spacing: 15) {
            serviceLogo(height: 50)
            heading(copy.chooserTitle, "연동할 서비스를 선택해 주세요.")
            Button {
                step = .permissions
            } label: {
                HStack(spacing: 15) {
                    Image(copy.logo)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 41, height: 41)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(copy.providerName)
                            .font(NaviFont.title(14))
                            .foregroundStyle(NaviTheme.ink)
                        Text("Google 계정으로 연동")
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayText)
                    }
                    Spacer()
                }
                .padding(15)
                .frame(height: 73)
                .background(NaviTheme.cardWhite)
                .clipShape(RoundedRectangle(cornerRadius: 15))
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(NaviTheme.border, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(copy.providerName), Google 계정으로 연동")
            Text("Google 인증 화면에서 계정과 접근 권한을 확인해요.")
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
            NaviButton(title: "취소", style: .secondary) { step = .prompt }
        }
    }

    private var permissions: some View {
        VStack(spacing: 10) {
            serviceLogo(height: 40)
            heading("계정 연동 전 확인", "Google에서 계정을 선택하고 연동을 승인해 주세요.")
            VStack(alignment: .leading, spacing: 10) {
                Text("Navi에서 사용할 기능")
                    .font(NaviFont.heading(18))
                    .foregroundStyle(NaviTheme.dark)
                ForEach(copy.permissions, id: \.title) { permission in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(permission.title)
                            .font(NaviFont.title(14))
                            .foregroundStyle(NaviTheme.dark)
                        Text(permission.detail)
                            .font(NaviFont.body(12))
                            .foregroundStyle(NaviTheme.grayText)
                    }
                }
                // One Google consent grants both scopes (Figma lists only this tab's service).
                Text(copy.sharedConsentNote)
                    .font(NaviFont.body(10))
                    .foregroundStyle(NaviTheme.grayText)
            }
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            NaviButton(
                title: model.isConnectingGoogle ? "연동 중…" : "Google 계정으로 계속",
                isEnabled: !model.isConnectingGoogle
            ) {
                Task {
                    let connected = await model.connectGoogle(using: sessionStore)
                    step = connected ? .success : .failure
                }
            }
            NaviButton(title: "취소", style: .secondary, isEnabled: !model.isConnectingGoogle) {
                step = .prompt
            }
        }
    }

    private var success: some View {
        VStack(spacing: 15) {
            serviceLogo(height: 50)
            heading(copy.successTitle, copy.successSubtitle)
            HStack(spacing: 15) {
                Image(copy.logo)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 35, height: 35)
                    .accessibilityHidden(true)
                Text("\(copy.providerName) · 연동 완료")
                    .font(NaviFont.title(14))
                    .foregroundStyle(NaviTheme.dark)
                Spacer()
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 10)
            .background(NaviTheme.itemBackground)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            NaviButton(title: copy.successButton, action: onFinish)
        }
    }

    private var failure: some View {
        VStack(spacing: 15) {
            serviceLogo(height: 50)
            heading(
                copy.failureTitle,
                "인증이 취소됐거나 연결에 문제가 있을 수 있어요.\n다시 연동해 주세요. 기존 데이터는 그대로 유지돼요."
            )
            NaviButton(title: "다시 연동하기") { step = .permissions }
            NaviButton(title: "나중에 하기", style: .secondary) { step = .prompt }
        }
    }

    // MARK: - Pieces

    private func serviceLogo(height: CGFloat) -> some View {
        Image(copy.logo)
            .resizable()
            .scaledToFit()
            .frame(width: 41, height: 41)
            .frame(height: height)
            .accessibilityHidden(true)
    }

    private func heading(_ title: String, _ subtitle: String) -> some View {
        VStack(spacing: 15) {
            Text(title)
                .font(NaviFont.title(25))
                .foregroundStyle(NaviTheme.ink)
            Text(subtitle)
                .font(NaviFont.body(12))
                .foregroundStyle(NaviTheme.grayText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var copy: Copy {
        service == .mail ? .mail : .calendar
    }
}

// MARK: - Copy

private struct Copy {
    struct Permission {
        let title: String
        let detail: String
    }

    let tabTitle: String
    let searchPrompt: String
    let logo: String
    let providerName: String
    let promptTitle: String
    let promptSubtitle: String
    let benefits: String
    let benefitsCaveat: String
    let promptButton: String
    let chooserTitle: String
    let permissions: [Permission]
    let sharedConsentNote: String
    let successTitle: String
    let successSubtitle: String
    let successButton: String
    let failureTitle: String

    /// Figma copy, verbatim.
    static let mail = Copy(
        tabTitle: "메일",
        searchPrompt: "메일 검색",
        logo: "GmailLogo",
        providerName: "Gmail",
        promptTitle: "메일 계정을 연동하세요",
        promptSubtitle: "메일 계정을 연동하면 중요한 메일을 모아 볼 수 있어요.",
        benefits: "중요 메일 요약 · 즐겨찾기 · 답장 초안",
        benefitsCaveat: "연동 전에는 메일을 불러오거나 발송할 수 없어요.",
        promptButton: "메일 계정 연동하기",
        chooserTitle: "메일 계정 연동",
        permissions: [
            Permission(title: "메일 조회 및 요약", detail: "메일 목록과 본문을 바탕으로 중요한 메일을 정리해요."),
            Permission(title: "답장 초안 작성", detail: "선택한 메일의 답변 작성을 도와드려요."),
            Permission(title: "검토 후 발송", detail: "메일은 내용을 검토하고 발송을 승인한 뒤 보내요."),
        ],
        sharedConsentNote: "같은 Google 동의로 Google Calendar도 함께 연동돼요.",
        successTitle: "메일 계정이 연동됐어요",
        successSubtitle: "이제 중요한 메일과 답장 초안을 확인할 수 있어요.",
        successButton: "메일로 돌아가기",
        failureTitle: "메일 연동을 완료하지 못했어요"
    )

    /// Calendar has no Final Prototype frames for this flow. The prompt copy matches the Claude
    /// proposal frame "[제안] 09 - 일정 (주) > 캘린더 연동하세요"; the rest mirrors the mail screens.
    static let calendar = Copy(
        tabTitle: "일정",
        searchPrompt: "일정 검색",
        logo: "GoogleCalendarLogo",
        providerName: "Google Calendar",
        promptTitle: "캘린더를 연동하세요",
        promptSubtitle: "캘린더를 연동하면 오늘 일정과 이번 주 준비를 한눈에 볼 수 있어요.",
        benefits: "주간·월간 일정 · 새 일정 등록 · 이번 주 준비",
        benefitsCaveat: "Gmail과 함께 한 번에 연동돼요. 연동 전에는 일정을 불러오거나 등록할 수 없어요.",
        promptButton: "Google 계정 연동하기",
        chooserTitle: "캘린더 연동",
        permissions: [
            Permission(title: "일정 조회 및 브리핑", detail: "오늘과 이번 주 일정을 시간순으로 정리해요."),
            Permission(title: "일정 등록 및 수정", detail: "새 일정을 만들고 바꾸는 걸 도와드려요."),
            Permission(title: "승인 후 등록", detail: "일정은 내용을 확인하고 승인한 뒤 등록해요."),
        ],
        sharedConsentNote: "같은 Google 동의로 Gmail도 함께 연동돼요.",
        successTitle: "캘린더가 연동됐어요",
        successSubtitle: "이제 오늘 일정과 이번 주 준비를 확인할 수 있어요.",
        successButton: "일정으로 돌아가기",
        failureTitle: "캘린더 연동을 완료하지 못했어요"
    )
}
