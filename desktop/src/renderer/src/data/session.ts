import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { Observable } from '@/lib/observable'
import { configurationError, REDIRECT_URL, supabase } from '@/lib/supabase'
import { unwrap, TodoStore } from './backend'
import { makeEdgeServices, type EdgeServices } from './edge'

/// Read/label/draft/send mail and read/write events (Notion "API 명세" google-auth).
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events'

/// How long the browser consent may take before the app stops waiting for `navi://`.
const OAUTH_TIMEOUT_MS = 5 * 60_000

export interface OnboardingState {
  interests: string[]
  gmailConnected: boolean
  calendarConnected: boolean
  isCompleted: boolean
}

export class AppSessionError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message)
  }

  static notConfigured = () => new AppSessionError('Supabase 설정이 없습니다.')
  static missingOAuthCallback = () => new AppSessionError('Google 인증 결과를 받지 못했습니다.')
  static oauthStartFailed = () => new AppSessionError('Google 인증 창을 열지 못했습니다.')
  static emailConfirmationRequired = () =>
    new AppSessionError('이메일 인증이 완료되지 않았어요. 받은 편지함에서 인증 링크를 먼저 눌러 주세요.')
  static googleProviderNotConfigured = () =>
    new AppSessionError('Google 연동이 아직 설정되지 않았어요. Supabase에서 Google provider를 활성화해 주세요.')
  static manualLinkingDisabled = () =>
    new AppSessionError('Google 계정 연결이 비활성화되어 있어요. Supabase에서 Allow manual linking을 켜 주세요.')
  static googleIdentityMissing = () =>
    new AppSessionError('Google 계정 정보를 확인하지 못했어요. 연동을 취소하고 다시 시도해 주세요.')
  static googleAccountMismatch = () => new AppSessionError('이 계정에 연결된 Google 계정으로 다시 선택해 주세요.')
  static rateLimited = (seconds?: number) =>
    new AppSessionError(
      seconds
        ? `인증 메일 요청이 잠시 제한되었어요. ${seconds}초 후 다시 시도해 주세요.`
        : '인증 메일 요청이 잠시 제한되었어요. 잠시 후 다시 시도해 주세요.',
      seconds
    )
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '알 수 없는 오류가 발생했어요.'

/// Session and onboarding state (`AppSessionStore` in Swift).
export class SessionStore extends Observable {
  session: Session | null = null
  isLoading = true
  isRestoringSession = true
  errorMessage: string | null = null

  readonly client: SupabaseClient | null = supabase
  readonly configurationError = configurationError

  private pendingOAuth: { resolve: (url: URL) => void; reject: (error: Error) => void } | null = null

  constructor() {
    super()
    if (!this.client) return
    this.client.auth.onAuthStateChange((_event, session) => {
      this.session = session
      this.isLoading = false
      this.isRestoringSession = false
      this.changed()
    })
  }

  get isConfigured(): boolean {
    return this.client !== null
  }

  setErrorMessage(message: string | null): void {
    this.errorMessage = message
    this.changed()
  }

  get onboardingState(): OnboardingState {
    const metadata = this.session?.user.user_metadata ?? {}
    return {
      interests: Array.isArray(metadata.navi_interests) ? metadata.navi_interests.filter((v: unknown) => typeof v === 'string') : [],
      gmailConnected: metadata.navi_gmail_connected === true,
      calendarConnected: metadata.navi_calendar_connected === true,
      isCompleted: metadata.navi_onboarding_completed === true || metadata.navi_onboarding_step === 'complete'
    }
  }

  /// The signed-in user's todo store, or null without a session.
  makeTodoStore(): TodoStore | null {
    const userID = this.session?.user.id
    return this.client && userID ? new TodoStore(this.client, userID) : null
  }

  /// Edge / assistant services for the signed-in user, or null without a session.
  makeEdgeServices(): EdgeServices | null {
    const userID = this.session?.user.id
    return this.client && userID ? makeEdgeServices(this.client, userID) : null
  }

  private requireClient(): SupabaseClient {
    if (!this.client) throw AppSessionError.notConfigured()
    return this.client
  }

  private setLoading(isLoading: boolean): void {
    this.isLoading = isLoading
    if (isLoading) this.errorMessage = null
    this.changed()
  }

  async signIn(email: string, password: string): Promise<void> {
    const client = this.requireClient()
    this.setLoading(true)
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw error
      this.session = data.session
    } catch (error) {
      throw normalizedAuthError(error)
    } finally {
      this.setLoading(false)
    }
  }

  /// Signs out this device only. The session is dropped locally first, so the app returns to
  /// onboarding even if the request fails (e.g. offline).
  async signOut(): Promise<void> {
    const client = this.requireClient()
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) throw error
    } finally {
      this.session = null
      this.changed()
    }
  }

  async signUp(name: string, email: string, password: string, role: string): Promise<boolean> {
    const client = this.requireClient()
    this.setLoading(true)
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          // Keep the original display name key for compatibility with existing Supabase users,
          // while also storing Navi's profile fields in auth.users.raw_user_meta_data.
          data: { name, navi_name: name, navi_role: role, navi_onboarding_step: 'interests' },
          emailRedirectTo: REDIRECT_URL
        }
      })
      if (error) throw error
      if (data.session) {
        this.session = data.session
        const metadata: Record<string, string> = { navi_name: name }
        if (role.trim()) metadata.navi_role = role
        await this.updateUserMetadata(metadata)
      }
      return data.session !== null
    } catch (error) {
      throw normalizedAuthError(error)
    } finally {
      this.setLoading(false)
    }
  }

  async resendSignupConfirmation(email: string): Promise<void> {
    const client = this.requireClient()
    const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: REDIRECT_URL } })
    if (error) throw normalizedAuthError(error)
  }

  async saveInterests(interests: string[]): Promise<void> {
    await this.updateUserMetadata({ navi_interests: interests, navi_onboarding_step: 'services' })
    await this.saveOnboardingMemory(interests)
  }

  /// Gmail and Calendar are granted in one Google consent. The first time links the Google
  /// identity to this account; after that (reconnect) it signs in with the linked identity,
  /// which lands on the same user. Either way the refresh token goes to
  /// `google-auth/credentials`, which keeps it in Vault and updates `users` / `auth_status`.
  ///
  /// The consent runs in the system browser and comes back through `navi://auth-callback`
  /// (the Swift app used ASWebAuthenticationSession for the same round trip).
  async connectGoogleServices(): Promise<void> {
    const client = this.requireClient()
    this.setLoading(true)
    try {
      const previous = this.session
      const isLinked = previous?.user.identities?.some((identity) => identity.provider === 'google') ?? false
      const options = {
        redirectTo: REDIRECT_URL,
        scopes: GOOGLE_SCOPES,
        queryParams: { access_type: 'offline', prompt: 'consent' },
        skipBrowserRedirect: true
      }
      const { data, error } = isLinked
        ? await client.auth.signInWithOAuth({ provider: 'google', options })
        : await client.auth.linkIdentity({ provider: 'google', options })
      if (error) throw error
      if (!data.url) throw AppSessionError.oauthStartFailed()

      const callback = await this.authenticate(data.url)
      const code = callback.searchParams.get('code')
      if (!code) throw AppSessionError.missingOAuthCallback()
      const exchange = await client.auth.exchangeCodeForSession(code)
      if (exchange.error) throw exchange.error
      const linkedSession = exchange.data.session

      // Picking another Google account on reconnect would sign in as a different user.
      if (previous && linkedSession.user.id !== previous.user.id) {
        const restored = await client.auth.setSession({
          access_token: previous.access_token,
          refresh_token: previous.refresh_token
        })
        this.session = restored.data.session
        throw AppSessionError.googleAccountMismatch()
      }
      this.session = linkedSession
      const refreshToken = linkedSession.provider_refresh_token
      if (!refreshToken) throw AppSessionError.googleIdentityMissing()
      await this.makeEdgeServices()?.googleAuth.registerCredentials(refreshToken, GOOGLE_SCOPES.split(' '))

      await this.updateUserMetadata({
        navi_gmail_connected: true,
        navi_calendar_connected: true,
        navi_onboarding_step: 'services'
      })
    } catch (error) {
      throw normalizedAuthError(error)
    } finally {
      this.setLoading(false)
    }
  }

  /// Stops waiting for a Google consent the user abandoned in the browser.
  cancelGoogleConnect(): void {
    this.pendingOAuth?.reject(AppSessionError.missingOAuthCallback())
    this.pendingOAuth = null
  }

  async completeOnboarding(interests: string[], gmailConnected: boolean, calendarConnected: boolean): Promise<void> {
    await this.updateUserMetadata({
      navi_interests: interests,
      navi_gmail_connected: gmailConnected,
      navi_calendar_connected: calendarConnected,
      navi_onboarding_step: 'complete',
      navi_onboarding_completed: true
    })
    await this.saveOnboardingMemory(interests)
  }

  /// `navi://auth-callback` from the browser: the Google consent this store is waiting for,
  /// or an email-confirmation link.
  handleCallback(rawURL: string): void {
    let url: URL
    try {
      url = new URL(rawURL)
    } catch {
      return
    }
    // Errors may arrive in the fragment (implicit-style) as well as the query.
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''))
    const errorDescription =
      url.searchParams.get('error_description') ?? fragment.get('error_description') ?? url.searchParams.get('error')

    if (this.pendingOAuth) {
      const pending = this.pendingOAuth
      this.pendingOAuth = null
      if (errorDescription) pending.reject(new Error(errorDescription.replace(/\+/g, ' ')))
      else pending.resolve(url)
      return
    }

    const code = url.searchParams.get('code')
    if (code && this.client) {
      this.client.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) this.setErrorMessage(normalizedAuthError(error).message)
      })
    } else if (errorDescription) {
      this.setErrorMessage(errorDescription.replace(/\+/g, ' '))
    }
  }

  private async updateUserMetadata(values: Record<string, unknown>): Promise<void> {
    const client = this.requireClient()
    const { data, error } = await client.auth.updateUser({ data: values })
    if (error) throw error
    if (this.session && this.session.user.id === data.user.id) {
      this.session = { ...this.session, user: data.user }
      this.changed()
    }
  }

  private async saveOnboardingMemory(interests: string[]): Promise<void> {
    const client = this.requireClient()
    const session = this.session
    if (!session) throw AppSessionError.notConfigured()
    const userID = session.user.id
    const role = typeof session.user.user_metadata.navi_role === 'string' ? session.user.user_metadata.navi_role.trim() : ''

    await unwrap(client.from('user_memory').delete().eq('user_id', userID).eq('key', 'role'))
    if (role) {
      await unwrap(client.from('user_memory').insert({ user_id: userID, key: 'role', value: role, source: 'onboarding' }))
    }

    await unwrap(client.from('user_memory').delete().eq('user_id', userID).eq('key', 'interest_tag'))
    const normalized = interests.map((interest) => interest.trim()).filter(Boolean)
    if (!normalized.length) return
    await unwrap(
      client
        .from('user_memory')
        .insert(normalized.map((value) => ({ user_id: userID, key: 'interest_tag', value, source: 'onboarding' })))
    )
  }

  private authenticate(url: string): Promise<URL> {
    this.cancelGoogleConnect()
    return new Promise<URL>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingOAuth?.resolve === done) this.pendingOAuth = null
        reject(AppSessionError.missingOAuthCallback())
      }, OAUTH_TIMEOUT_MS)
      const done = (callback: URL): void => {
        clearTimeout(timer)
        resolve(callback)
      }
      this.pendingOAuth = {
        resolve: done,
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      }
      window.navi.openExternal(url).catch(() => {
        this.pendingOAuth = null
        clearTimeout(timer)
        reject(AppSessionError.oauthStartFailed())
      })
    })
  }
}

function normalizedAuthError(error: unknown): Error {
  if (error instanceof AppSessionError) return error
  const diagnostic = [
    errorText(error),
    (error as { code?: string })?.code ?? '',
    String(error)
  ]
    .join(' ')
    .toLowerCase()

  if (
    diagnostic.includes('over_email_send_rate_limit') ||
    diagnostic.includes('email rate limit') ||
    diagnostic.includes('rate limit') ||
    diagnostic.includes('security purposes')
  ) {
    const seconds = (diagnostic.match(/\d+/g) ?? []).map(Number).find((n) => n > 0 && n <= 3600)
    return AppSessionError.rateLimited(seconds)
  }
  if (diagnostic.includes('email not confirmed') || diagnostic.includes('email_not_confirmed')) {
    return AppSessionError.emailConfirmationRequired()
  }
  if (diagnostic.includes('unsupported provider') || diagnostic.includes('provider is not enabled')) {
    return AppSessionError.googleProviderNotConfigured()
  }
  if (diagnostic.includes('manual linking is disabled')) {
    return AppSessionError.manualLinkingDisabled()
  }
  return error instanceof Error ? error : new Error(errorText(error))
}
