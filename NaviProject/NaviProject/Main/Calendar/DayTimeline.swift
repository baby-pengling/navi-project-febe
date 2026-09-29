import SwiftUI

/// Figma "Schedule - Hour" / "Schedule Block": an hourly ruler with event blocks laid out
/// proportionally and, for today, a red current-time marker. Scrolls to the current hour (or
/// the first event, if earlier) on appear. Used by the dashboard and the calendar tab.
struct DayTimeline: View {
    let day: Date
    let events: [DashboardEvent]
    /// The calendar shows "| 📍 장소" in blocks; the dashboard doesn't.
    var showsLocation = true
    var selectedEventID: UUID?
    var onSelect: ((DashboardEvent) -> Void)?

    private let hourHeight: CGFloat = 72
    /// Each hour's line sits half a label below its slot's top, so a slot scrolled to the top
    /// keeps its label fully visible.
    private let topInset: CGFloat = 6
    private let calendar = Calendar.current

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                TimelineView(.everyMinute) { context in
                    ZStack(alignment: .topLeading) {
                        VStack(spacing: 0) {
                            ForEach(0..<24, id: \.self) { hour in
                                hourRow(hour, hidesLabel: calendar.isDate(context.date, inSameDayAs: day) && isNearNow(hour, now: context.date))
                                    .frame(height: hourHeight, alignment: .top)
                                    .id(hour)
                            }
                        }

                        ForEach(events.filter { !$0.isAllDay && calendar.isDate($0.startAt, inSameDayAs: day) }) { event in
                            eventBlock(event)
                        }

                        if calendar.isDate(context.date, inSameDayAs: day) {
                            nowMarker(context.date)
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
            .onAppear {
                proxy.scrollTo(initialHour, anchor: .top)
            }
            .onChange(of: day) {
                proxy.scrollTo(initialHour, anchor: .top)
            }
        }
    }

    private var initialHour: Int {
        let firstEvent = events.filter { !$0.isAllDay }.map { calendar.component(.hour, from: $0.startAt) }.min()
        guard calendar.isDateInToday(day) else { return firstEvent ?? 8 }
        let now = calendar.component(.hour, from: .now)
        return min(now, firstEvent ?? now)
    }

    private func y(for date: Date) -> CGFloat {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        let minutes = CGFloat((parts.hour ?? 0) * 60 + (parts.minute ?? 0))
        return topInset + minutes / 60 * hourHeight
    }

    /// The red "now" label replaces an hour label it would otherwise overlap.
    private func isNearNow(_ hour: Int, now: Date) -> Bool {
        let parts = calendar.dateComponents([.hour, .minute], from: now)
        let minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        return abs(minutes - hour * 60) < 10
    }

    private func hourRow(_ hour: Int, hidesLabel: Bool) -> some View {
        HStack(spacing: 15) {
            Text(String(format: "%02d:00", hour))
                .font(NaviFont.body(10, weight: .semibold))
                .tracking(1)
                .foregroundStyle(NaviTheme.grayText)
                .frame(width: 35, alignment: .trailing)
                .opacity(hidesLabel ? 0 : 1)
            Rectangle()
                .fill(NaviTheme.border)
                .frame(height: 1)
        }
        .frame(height: 12)
    }

    private func eventBlock(_ event: DashboardEvent) -> some View {
        let height = max(y(for: event.endAt) - y(for: event.startAt) - 6, 34)
        // Figma's dashboard blocks leave out the location the calendar tab shows.
        let isSelected = event.id == selectedEventID
        return ScheduleBlock(
            title: event.title,
            timeRange: ScheduleBlock.timeRange(event.startAt, event.endAt),
            location: showsLocation ? event.location : nil,
            tint: event.category.map { Color(naviHex: $0.color) } ?? NaviTheme.purple,
            isCompact: height < 54
        )
        .frame(height: height, alignment: .top)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay {
            if isSelected {
                RoundedRectangle(cornerRadius: 5)
                    .stroke(event.category.map { Color(naviHex: $0.color) } ?? NaviTheme.purple, lineWidth: 1)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { onSelect?(event) }
        .padding(.leading, 50)
        .offset(y: y(for: event.startAt) + 3)
    }

    /// Figma "08:58" row: red time label plus a haloed dot and line.
    private func nowMarker(_ now: Date) -> some View {
        HStack(spacing: 15) {
            Text(ScheduleBlock.time(now))
                .font(NaviFont.body(10, weight: .semibold))
                .tracking(1)
                .foregroundStyle(NaviTheme.red)
                .frame(width: 35, alignment: .trailing)
            HStack(spacing: 0) {
                ZStack {
                    Circle().fill(NaviTheme.redLight).frame(width: 8, height: 8)
                    Circle().fill(NaviTheme.red).frame(width: 4, height: 4)
                }
                Rectangle()
                    .fill(NaviTheme.red)
                    .frame(height: 1)
            }
        }
        .frame(height: 12)
        .offset(y: y(for: now) - 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("현재 시각 \(ScheduleBlock.time(now))")
    }
}
