import { useEffect, useRef } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import { SNOOZE_PRESETS, type NotificationPreferences } from '@/data/types'
import type { SettingsModel } from '@/models/settings'
import { HStack, NaviCheckCircle, NaviImage, NaviMenu, NaviPanel, NaviPillButton, NaviSectionHeader, NaviTextField, Spacer, VStack } from '@/components/core'
import type { MainDialog } from '../MainWindow'

/// Figma "12 - 설정": profile + notifications on the left, connected services on the right.
export function SettingsView({ model, onDialog, onSignOut }: {
  model: SettingsModel
  onDialog: (dialog: MainDialog) => void
  onSignOut: () => void
}) {
  useModel(model)
  const modelRef = useRef(model)

  useEffect(() => {
    void model.load()
    // Commit an edited name when leaving the screen without pressing Return.
    return () => modelRef.current.saveName()
  }, [model])

  const services = model.services
  const googleCaption = services.googleEmail
    ? `Google 계정 · ${services.googleEmail}`
    : services.mailConnected || services.calendarConnected
      ? 'Google 계정'
      : 'Google 계정이 아직 연결되지 않았어요.'

  const toggle = (key: keyof Omit<NotificationPreferences, 'snoozeMinutes'>) => model.setNotifications({ [key]: !model.notifications[key] })

  const serviceRow = (title: string, logo: string, isConnected: boolean) => (
    <HStack style={{ padding: '12px 15px', background: T.itemBackground, borderRadius: 5 }}>
      <HStack spacing={15}>
        <NaviImage name={logo} width={28} height={28} />
        <span style={{ ...F.title(14), color: T.ink }}>{title}</span>
      </HStack>
      <Spacer />
      <HStack spacing={10}>
        <StatusBadge isConnected={isConnected} />
        {isConnected ? (
          <NaviPillButton title="관리" onClick={() => onDialog({ kind: 'googleDisconnect' })} />
        ) : (
          <NaviPillButton
            title={model.isConnectingGoogle ? '연결 중…' : '연결'}
            disabled={model.isConnectingGoogle}
            onClick={() => void model.connectGoogle()}
          />
        )}
      </HStack>
    </HStack>
  )

  return (
    <VStack spacing={10} style={{ height: '100%' }}>
      <span style={{ ...F.title(28), color: T.ink }}>설정</span>
      <div className="scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
        <HStack spacing={12} align="stretch" style={{ minHeight: '100%' }}>
          <VStack spacing={12} style={{ flex: 1, minWidth: 0 }}>
            <NaviPanel>
              <NaviSectionHeader title="프로필" />
              <NaviTextField title="이름" value={model.name} onChange={(name) => model.setName(name)} onSubmit={() => model.saveName()} onBlur={() => model.saveName()} />
              {model.profileError && <span style={{ ...F.body(10), color: T.red }}>{model.profileError}</span>}
              <ReadOnlyField title="이메일" value={model.loginEmail} />
              <HStack>
                <span style={{ ...F.body(10), color: T.grayText }}>비밀번호는 안전하게 별도 화면에서 변경해요.</span>
                <Spacer />
                <NaviPillButton title="비밀번호 변경" onClick={() => onDialog({ kind: 'passwordChange' })} />
              </HStack>
              {/* Not in Figma: signing out returns to the onboarding flow. */}
              <HStack>
                <span style={{ ...F.body(10), color: T.grayText }}>이 기기에서 로그아웃하고 처음 화면으로 돌아가요.</span>
                <Spacer />
                <NaviPillButton title="로그아웃" style="outline" onClick={onSignOut} />
              </HStack>
            </NaviPanel>

            <NaviPanel spacing={9} horizontalPadding={16} verticalPadding={16} fillsHeight>
              <NaviSectionHeader title="알림 설정" />
              <NaviMenu
                ariaLabel="스누즈 간격"
                items={SNOOZE_PRESETS.map((minutes) => ({
                  title: `${minutes}분`,
                  action: () => model.setNotifications({ snoozeMinutes: minutes })
                }))}
                label={
                  <HStack style={{ width: '100%', padding: '8px 14px', background: T.cardWhite, border: `1px solid ${T.border}`, borderRadius: 15 }}>
                    <VStack spacing={3} align="flex-start">
                      <span style={{ ...F.body(11, 'semibold'), color: T.grayText }}>스누즈 간격 · 기본값 9분</span>
                      <span style={{ ...F.body(14, 'medium'), color: T.ink }}>{model.notifications.snoozeMinutes}분</span>
                    </VStack>
                    <Spacer />
                    <span style={{ fontSize: 10, color: T.grayText }}>⌃⌄</span>
                  </HStack>
                }
              />
              <NotificationRow title="새 메일 알림" isOn={model.notifications.newMail} onToggle={() => toggle('newMail')} />
              <NotificationRow title="일정 리마인드" isOn={model.notifications.calendarReminder} onToggle={() => toggle('calendarReminder')} />
              <NotificationRow title="메일 발송 승인 요청" isOn={model.notifications.mailSendConfirmation} onToggle={() => toggle('mailSendConfirmation')} />
              <NotificationRow title="일정 등록 승인 요청" isOn={model.notifications.calendarApproval} onToggle={() => toggle('calendarApproval')} />
              {model.notificationsError && <span style={{ ...F.body(10), color: T.red }}>{model.notificationsError}</span>}
            </NaviPanel>
          </VStack>

          <div style={{ flex: 1, minWidth: 0 }}>
            <NaviPanel>
              <NaviSectionHeader title="연결된 서비스" tag="2개" />
              <span style={{ ...F.body(10), color: T.grayText }}>{googleCaption}</span>
              {serviceRow('Gmail', 'GmailLogo', services.mailConnected)}
              {serviceRow('Google Calendar', 'GoogleCalendarLogo', services.calendarConnected)}
              {model.isConnectingGoogle && (
                <HStack style={{ ...F.body(11), color: T.grayText }}>
                  브라우저에서 Google 계정을 선택하고 승인해 주세요.
                  <Spacer />
                  <button type="button" onClick={() => model.cancelGoogleConnect()} style={{ ...F.body(11, 'semibold'), color: T.purple }}>
                    취소
                  </button>
                </HStack>
              )}
              {model.connectError && <span style={{ ...F.body(11), color: T.red }}>{model.connectError}</span>}
            </NaviPanel>
          </div>
        </HStack>
      </div>
    </VStack>
  )
}

/// Same look as `NaviTextField`, for values the user can't edit here (login email).
function ReadOnlyField({ title, value }: { title: string; value: string }) {
  return (
    <VStack spacing={3} style={{ padding: '8px 14px', background: T.cardWhite, border: `1px solid ${T.border}`, borderRadius: 15 }}>
      <span style={{ ...F.body(11, 'semibold'), color: T.grayText }}>{title}</span>
      <span className="selectable" style={{ ...F.body(14, 'medium'), color: T.ink, minHeight: 17 }}>
        {value}
      </span>
    </VStack>
  )
}

/// Read-only "연결 됨" / "연결 안 됨" state shown next to each service.
function StatusBadge({ isConnected }: { isConnected: boolean }) {
  return (
    <span
      style={{
        ...F.body(12, 'bold'),
        color: isConnected ? T.green : T.grayText,
        background: isConnected ? T.greenLight : T.cardWhite,
        border: `1px solid ${isConnected ? 'transparent' : T.border}`,
        padding: '8px 20px',
        borderRadius: 8,
        whiteSpace: 'nowrap'
      }}
    >
      {isConnected ? '연결 됨' : '연결 안 됨'}
    </span>
  )
}

function NotificationRow({ title, isOn, onToggle }: { title: string; isOn: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={isOn}
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', padding: '0 8px', height: 42, background: T.itemBackground, borderRadius: 8, width: '100%' }}
    >
      <span style={{ ...F.body(12), color: T.ink }}>{title}</span>
      <Spacer />
      <NaviCheckCircle isOn={isOn} />
    </button>
  )
}
