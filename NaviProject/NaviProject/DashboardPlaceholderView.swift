import SwiftUI

struct DashboardPlaceholderView: View {
    let gmailConnected: Bool
    let calendarConnected: Bool
    let onResetOnboarding: () -> Void
    let onSignOut: () -> Void

    var body: some View {
        ZStack {
            NaviDashboardTheme.background.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    HStack(spacing: 8) {
                        Image("NaviMascot")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 45)
                        Text("navi")
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                    }

                    Spacer()

                    Button("온보딩 다시 보기", action: onResetOnboarding)
                        .buttonStyle(.bordered)
                    Button("로그아웃", action: onSignOut)
                        .buttonStyle(.bordered)
                }

                Text("좋은 아침이에요")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                Text("온보딩이 완료되었습니다. 이제 메일과 일정을 한곳에서 확인할 수 있어요.")
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 12) {
                    Text("연동 상태")
                        .font(.headline)

                    HStack(spacing: 16) {
                        DashboardConnectionCard(
                            title: "Gmail",
                            isConnected: gmailConnected,
                            symbol: "envelope.fill",
                            accessibilityIdentifier: "navi.status.gmail"
                        )
                        DashboardConnectionCard(
                            title: "Google Calendar",
                            isConnected: calendarConnected,
                            symbol: "calendar",
                            accessibilityIdentifier: "navi.status.calendar"
                        )
                    }
                }
                .frame(maxWidth: 650, alignment: .leading)

                HStack(spacing: 16) {
                    DashboardCard(title: "오늘의 메일", value: "준비 중", symbol: "envelope.fill")
                    DashboardCard(title: "오늘의 일정", value: "준비 중", symbol: "calendar")
                }
                .frame(maxWidth: 650)
            }
            .padding(48)
            .frame(maxWidth: 900, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

private struct DashboardConnectionCard: View {
    let title: String
    let isConnected: Bool
    let symbol: String
    let accessibilityIdentifier: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: symbol)
                    .foregroundStyle(Color(red: 0.443, green: 0.396, blue: 1.0))
                Spacer()
                Image(systemName: isConnected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isConnected ? .green : .secondary)
            }

            Text(title)
                .font(.headline)

            Text(isConnected ? "연동됨" : "연동 안 됨")
                .font(.subheadline)
                .foregroundStyle(isConnected ? .green : .secondary)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .accessibilityIdentifier(accessibilityIdentifier)
    }
}

private struct DashboardCard: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            Image(systemName: symbol)
                .foregroundStyle(Color(red: 0.443, green: 0.396, blue: 1.0))
            Text(title)
                .font(.headline)
            Text(value)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

private enum NaviDashboardTheme {
    static let background = Color(red: 0.965, green: 0.963, blue: 0.98)
}
