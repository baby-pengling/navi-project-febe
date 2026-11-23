import { Observable } from '@/lib/observable'
import { AccountService, NotificationSettingsStore } from '@/data/backend'
import { isServerError, isUnavailable, type GoogleAuthService } from '@/data/edge'
import { AppSessionError, errorText, type SessionStore } from '@/data/session'
import { defaultNotificationPreferences, type ConnectedServices, type NotificationPreferences } from '@/data/types'

export type PasswordChangeError = 'currentPasswordRequired' | 'weakPassword' | 'confirmationMismatch'

export const passwordChangeErrorText: Record<PasswordChangeError, string> = {
  currentPasswordRequired: '현재 비밀번호를 입력해 주세요.',
  weakPassword: '영문 대/소문자·숫자·특수문자를 포함해 8자 이상 입력하세요.',
  confirmationMismatch: '새 비밀번호가 서로 일치하지 않아요.'
}

const googleEmail = (store: SessionStore): string | undefined => {
  const identity = store.session?.user.identities?.find((i) => i.provider === 'google')
  const email = identity?.identity_data?.email
  return typeof email === 'string' ? email : undefined
}

/// Settings screen state (`SettingsModel` in Swift). Name and login email come from the
/// session; the name is saved with Auth `updateUser`, the password through `AccountService`,
/// and notification preferences on the `notification_settings` TABLE.
export class SettingsModel extends Observable {
  name: string
  readonly loginEmail: string
  notifications: NotificationPreferences = defaultNotificationPreferences()
  services: ConnectedServices
  isConnectingGoogle = false
  connectError: string | null = null
  profileError: string | null = null
  notificationsError: string | null = null
  isDisconnecting = false
  disconnectError: string | null = null

  private notificationStore: NotificationSettingsStore | null
  private accountService: AccountService | null
  private googleAuth: GoogleAuthService | null
  private hasLoadedNotifications = false
  private savedName: string

  constructor(private sessionStore: SessionStore) {
    super()
    const user = sessionStore.session?.user
    const metadata = user?.user_metadata ?? {}
    const initialName = (metadata.navi_name ?? metadata.name ?? '') as string
    this.name = initialName
    this.savedName = initialName
    this.loginEmail = user?.email ?? ''
    const state = sessionStore.onboardingState
    this.services = {
      googleEmail: googleEmail(sessionStore),
      mailConnected: state.gmailConnected,
      calendarConnected: state.calendarConnected
    }
    const client = sessionStore.client
    this.notificationStore = client && user ? new NotificationSettingsStore(client, user.id) : null
    this.accountService = client ? new AccountService(client) : null
    this.googleAuth = sessionStore.makeEdgeServices()?.googleAuth ?? null
  }

  setName(name: string): void {
    this.name = name
    this.changed()
  }

  /// Reads the saved notification preferences.
  async load(): Promise<void> {
    if (!this.notificationStore || this.hasLoadedNotifications) return
    try {
      this.notifications = await this.notificationStore.load()
      this.hasLoadedNotifications = true
      this.notificationsError = null
    } catch {
      this.notificationsError = '알림 설정을 불러오지 못했어요.'
    }
    this.changed()
  }

  /// Saved to `notification_settings` on every change once loaded.
  setNotifications(update: Partial<NotificationPreferences>): void {
    const previous = this.notifications
    const next = { ...previous, ...update }
    this.notifications = next
    this.changed()
    if (!this.hasLoadedNotifications || !this.notificationStore) return
    this.notificationStore.save(next).then(
      () => {
        this.notificationsError = null
        this.changed()
      },
      () => {
        // Put the toggle back without saving again.
        this.notifications = previous
        this.notificationsError = '알림 설정을 저장하지 못했어요.'
        this.changed()
      }
    )
  }

  /// Supabase Auth policy (`lower_upper_letters_digits_symbols`, ≥ 8 chars). Stricter than the
  /// Figma footnote on purpose: the server rejects anything weaker.
  static isStrongPassword(password: string): boolean {
    return (
      [...password].length >= 8 &&
      /\p{Ll}/u.test(password) &&
      /\p{Lu}/u.test(password) &&
      /\p{N}/u.test(password) &&
      /[^\p{L}\p{N}\s]/u.test(password)
    )
  }

  validatePasswordChange(current: string, next: string, confirmation: string): PasswordChangeError | null {
    if (!current) return 'currentPasswordRequired'
    if (!SettingsModel.isStrongPassword(next)) return 'weakPassword'
    if (next !== confirmation) return 'confirmationMismatch'
    return null
  }

  async changePassword(current: string, next: string): Promise<void> {
    if (!this.accountService) throw AppSessionError.notConfigured()
    await this.accountService.changePassword(this.loginEmail, current, next)
  }

  /// Saves the profile name (`navi_name` in Auth user metadata). Empty names are rejected.
  saveName(): void {
    const trimmed = this.name.trim()
    if (!trimmed) {
      this.name = this.savedName
      this.profileError = '이름을 입력해 주세요.'
      this.changed()
      return
    }
    this.name = trimmed
    this.changed()
    if (trimmed === this.savedName || !this.accountService) return
    this.accountService.updateDisplayName(trimmed).then(
      () => {
        this.savedName = trimmed
        this.profileError = null
        this.changed()
      },
      () => {
        this.profileError = '이름을 저장하지 못했어요.'
        this.changed()
      }
    )
  }

  /// `DELETE google-auth/disconnect` (202). Returns whether the request was accepted.
  async disconnectGoogle(): Promise<boolean> {
    this.isDisconnecting = true
    this.disconnectError = null
    this.changed()
    try {
      await this.googleAuth?.disconnect()
      this.services = { googleEmail: undefined, mailConnected: false, calendarConnected: false }
      return true
    } catch (error) {
      if (isServerError(error)) this.disconnectError = error.message
      else if (isUnavailable(error)) this.disconnectError = '연결 해제 기능이 아직 준비되지 않았어요.'
      else this.disconnectError = '연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.'
      return false
    } finally {
      this.isDisconnecting = false
      this.changed()
    }
  }

  /// Gmail and Calendar are granted together in one Google consent, so every "연결" /
  /// "연동하기" button in the main window runs this same flow. Returns whether it succeeded.
  async connectGoogle(): Promise<boolean> {
    this.isConnectingGoogle = true
    this.connectError = null
    this.changed()
    try {
      await this.sessionStore.connectGoogleServices()
      const state = this.sessionStore.onboardingState
      this.services = {
        mailConnected: state.gmailConnected,
        calendarConnected: state.calendarConnected,
        googleEmail: googleEmail(this.sessionStore)
      }
      return true
    } catch (error) {
      this.connectError = errorText(error)
      return false
    } finally {
      this.isConnectingGoogle = false
      this.changed()
    }
  }

  cancelGoogleConnect(): void {
    this.sessionStore.cancelGoogleConnect()
  }
}
