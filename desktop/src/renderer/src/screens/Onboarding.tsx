import { useEffect, useState, type ReactNode } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import { errorText, type SessionStore } from '@/data/session'
import { HStack, NaviButton, NaviImage, NaviLinkButton, NaviMascot, NaviTextField, Spacer, Spinner, VStack } from '@/components/core'

// Port of the onboarding half of ContentView.swift.

export type OnboardingStep = 'programLanding' | 'welcome' | 'login' | 'signUp' | 'interests' | 'services'

export function OnboardingRouter({ store, step, setStep, isCompleted, setCompleted }: {
  store: SessionStore
  step: OnboardingStep
  setStep: (step: OnboardingStep) => void
  isCompleted: boolean
  setCompleted: (value: boolean) => void
}) {
  useModel(store)
  const [interests, setInterests] = useState<string[]>([])
  const [gmailConnected, setGmailConnected] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [loginNotice, setLoginNotice] = useState<string | null>(null)
  const isAuthenticated = store.session !== null
  const state = store.onboardingState

  // Hydrate from the session and, once signed in, never send the user back to the landing
  // or welcome screens (they are only for unauthenticated users).
  useEffect(() => {
    if (!isAuthenticated) return
    setInterests(state.interests)
    setGmailConnected(state.gmailConnected)
    setCalendarConnected(state.calendarConnected)
    if (!isCompleted && (step === 'programLanding' || step === 'welcome')) setStep('interests')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, state.interests.join('\n'), state.gmailConnected, state.calendarConnected])

  const content = (() => {
    switch (step) {
      case 'programLanding':
        return <ProgramLanding onFinished={() => setStep('welcome')} />
      case 'welcome':
        return <Welcome onLogin={() => setStep('login')} onSignUp={() => setStep('signUp')} />
      case 'login':
        return (
          <Login
            store={store}
            notice={loginNotice}
            onBack={() => setStep('welcome')}
            onSuccess={() => {
              setLoginNotice(null)
              if (store.onboardingState.isCompleted) setCompleted(true)
              else setStep('interests')
            }}
          />
        )
      case 'signUp':
        return (
          <SignUp
            store={store}
            onBackToLogin={() => setStep('login')}
            onSuccess={() => {
              setLoginNotice('회원가입이 완료되었습니다. 로그인해 주세요.')
              setStep('login')
            }}
          />
        )
      case 'interests':
        return (
          <InterestSelection
            store={store}
            interests={interests}
            setInterests={setInterests}
            onNext={async (latest) => {
              try {
                await store.saveInterests(latest)
                setStep('services')
              } catch (error) {
                store.setErrorMessage(errorText(error))
              }
            }}
          />
        )
      case 'services':
        return (
          <ServiceConnection
            store={store}
            gmailConnected={gmailConnected}
            calendarConnected={calendarConnected}
            onConnected={() => {
              setGmailConnected(true)
              setCalendarConnected(true)
            }}
            onComplete={async () => {
              try {
                await store.completeOnboarding(interests, gmailConnected, calendarConnected)
                setCompleted(true)
              } catch (error) {
                store.setErrorMessage(errorText(error))
              }
            }}
          />
        )
    }
  })()

  return (
    <div key={step} className="fade-in" style={{ height: '100%' }}>
      {content}
    </div>
  )
}

// MARK: - Screens

function ProgramLanding({ onFinished }: { onFinished: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onFinished, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <NaviCard>
      <HStack spacing={16} style={{ justifyContent: 'center' }}>
        <NaviImage name="LogoMark" width={56} />
        <NaviImage name="LogoWordmark" height={44} />
      </HStack>
    </NaviCard>
  )
}

function Welcome({ onLogin, onSignUp }: { onLogin: () => void; onSignUp: () => void }) {
  return (
    <NaviCard>
      <VStack spacing={40}>
        <VStack spacing={30} align="center">
          <NaviMascot width={129} />
          <VStack spacing={14} align="center">
            <NaviTitle prefix="안녕하세요, " suffix="예요." />
            <Subtitle>
              중요한 것을 놓치지 않도록 메일·일정을 미리 확인하고,
              <br />
              실행까지 도와드릴게요.
            </Subtitle>
          </VStack>
        </VStack>
        <VStack spacing={10}>
          <NaviButton title="로그인" onClick={onLogin} />
          <NaviButton title="새 계정 만들기" style="secondary" onClick={onSignUp} />
        </VStack>
      </VStack>
    </NaviCard>
  )
}

function Login({ store, notice, onBack, onSuccess }: {
  store: SessionStore
  notice: string | null
  onBack: () => void
  onSuccess: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setSubmitting] = useState(false)
  const canSubmit = !isSubmitting && email.trim() !== '' && password !== ''

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await store.signIn(email, password)
      onSuccess()
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <NaviCard>
      <VStack spacing={20}>
        <VStack spacing={30} align="center">
          <NaviMascot width={129} />
          <VStack spacing={14} align="center">
            <span style={{ ...F.title(25), color: T.ink }}>다시 만나서 반가워요!</span>
            <Subtitle>계속하려면 계정에 로그인해 주세요.</Subtitle>
          </VStack>
        </VStack>
        <VStack spacing={15}>
          <NaviTextField title="이메일" value={email} onChange={setEmail} onSubmit={submit} autoFocus />
          <NaviTextField title="비밀번호" value={password} onChange={setPassword} isSecure onSubmit={submit} />
          {notice && <InlineNotice message={notice} />}
          {errorMessage && <InlineError message={errorMessage} />}
          <VStack spacing={20}>
            <NaviButton title="로그인" isEnabled={canSubmit} onClick={submit} />
            <NaviLinkButton title="← 처음으로" onClick={onBack} />
          </VStack>
        </VStack>
      </VStack>
    </NaviCard>
  )
}

function SignUp({ store, onBackToLogin, onSuccess }: { store: SessionStore; onBackToLogin: () => void; onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('')
  const [errorField, setErrorField] = useState<'email' | 'password' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setSubmitting] = useState(false)
  const [isResending, setResending] = useState(false)
  const [requiresConfirmation, setRequiresConfirmation] = useState(false)
  const canSubmit = !isSubmitting && name.trim() !== '' && email.trim() !== '' && password !== ''

  const submit = async () => {
    if (!canSubmit) return
    if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
      setErrorField('email')
      setErrorMessage('올바른 이메일이 아닙니다.')
      return
    }
    if (password.length < 8) {
      setErrorField('password')
      setErrorMessage('비밀번호는 8자리 이상이어야 합니다.')
      return
    }
    setErrorField(null)
    setErrorMessage(null)
    setRequiresConfirmation(false)
    setSubmitting(true)
    try {
      const sessionCreated = await store.signUp(name, email, password, role)
      if (sessionCreated) {
        // Supabase returns a session when Confirm email is off. Keep signup and login as
        // separate user-visible steps by clearing that session before showing the login screen.
        await store.signOut()
        onSuccess()
      } else {
        setRequiresConfirmation(true)
        setErrorMessage('가입이 완료되었습니다. 이메일 인증 후 로그인해 주세요.')
      }
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setSubmitting(false)
    }
  }

  const resend = async () => {
    setResending(true)
    setErrorMessage(null)
    try {
      await store.resendSignupConfirmation(email)
      setErrorMessage('인증 메일을 다시 보냈어요. 받은 편지함을 확인해 주세요.')
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setResending(false)
    }
  }

  return (
    <NaviCard>
      <VStack spacing={20}>
        <VStack spacing={10} align="center">
          <NaviMascot width={129} />
          <VStack spacing={14} align="center">
            <NaviTitle prefix="나만의 " suffix=" 만들기" />
            <Subtitle>업무 방식과 말투를 학습해 나에게 맞는 조력자가 됩니다.</Subtitle>
          </VStack>
        </VStack>
        <VStack spacing={15}>
          <NaviTextField title="이름" value={name} onChange={setName} isRequired autoFocus />
          <NaviTextField title="이메일" value={email} onChange={setEmail} isRequired />
          {errorField === 'email' && errorMessage && <InlineError message={errorMessage} />}
          <NaviTextField title="비밀번호" value={password} onChange={setPassword} isSecure isRequired />
          {errorField === 'password' && errorMessage && <InlineError message={errorMessage} />}
          <NaviTextField title="직업 / 역할" value={role} onChange={setRole} onSubmit={submit} />
          {errorField === null && errorMessage && <InlineError message={errorMessage} />}
          {requiresConfirmation && (
            <NaviButton
              title={isResending ? '인증 메일 보내는 중...' : '인증 메일 다시 보내기'}
              style="secondary"
              isEnabled={!isResending}
              onClick={resend}
            />
          )}
          <VStack spacing={20}>
            <NaviButton title="계정 만들기" isEnabled={canSubmit} onClick={submit} />
            <NaviLinkButton title="← 이미 계정이 있나요? 로그인 하러가기" onClick={onBackToLogin} />
          </VStack>
        </VStack>
      </VStack>
    </NaviCard>
  )
}

export function LoadingView() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.background }}>
      <Spinner />
    </div>
  )
}

export function ConfigurationErrorView({ message }: { message: string }) {
  return (
    <NaviCard>
      <VStack spacing={18} align="center">
        <span style={{ fontSize: 32, color: T.red }}>⚠︎</span>
        <span style={{ ...F.title(20), color: T.ink }}>앱 설정을 확인해 주세요</span>
        <span style={{ ...F.body(13), color: T.grayMain, textAlign: 'center' }}>{message}</span>
      </VStack>
    </NaviCard>
  )
}

function InterestSelection({ store, interests, setInterests, onNext }: {
  store: SessionStore
  interests: string[]
  setInterests: (interests: string[]) => void
  onNext: (interests: string[]) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [isSaving, setSaving] = useState(false)

  const withDraft = (): string[] => {
    const added = draft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const next = [...interests]
    for (const interest of added) if (!next.includes(interest)) next.push(interest)
    return next
  }

  const addDraft = () => {
    setInterests(withDraft())
    setDraft('')
  }

  const saveAndContinue = async (latest: string[]) => {
    if (isSaving) return
    setSaving(true)
    store.setErrorMessage(null)
    try {
      await onNext(latest)
    } finally {
      setSaving(false)
    }
  }

  return (
    <NaviCard>
      <VStack spacing={20}>
        <VStack spacing={10} align="center">
          <NaviMascot width={129} />
          <VStack spacing={14} align="center">
            <NaviTitle prefix={'관심사를 알려주시면,\n'} suffix="가 먼저 찾아드려요" />
            <Subtitle>
              관심 분야와 키워드를 등록해 주세요. AI가 관련 메일과 일정, 할 일을 찾아 중요한 소식과 다음 행동을 한곳에
              모아드릴게요.
            </Subtitle>
          </VStack>
        </VStack>

        <VStack
          spacing={5}
          style={{ padding: '8px 14px', background: T.cardWhite, border: `1px solid ${T.border}`, borderRadius: 15 }}
        >
          <span style={{ ...F.body(11, 'semibold'), color: T.grayText }}>관심 분야 / 키워드</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
            {interests.map((interest) => (
              <span
                key={interest}
                style={{
                  ...F.body(12, 'medium'),
                  color: T.purple,
                  background: T.lavender,
                  borderRadius: 5,
                  padding: '2px 5px',
                  display: 'inline-flex',
                  gap: 3,
                  alignItems: 'center'
                }}
              >
                {interest}
                <button
                  type="button"
                  aria-label={`${interest} 삭제`}
                  onClick={() => setInterests(interests.filter((i) => i !== interest))}
                  style={{ fontSize: 9, fontWeight: 700, color: T.purple }}
                >
                  ✕
                </button>
              </span>
            ))}
            <input
              value={draft}
              aria-label="관심 분야 입력"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) addDraft()
              }}
              style={{ ...F.body(13), minWidth: 90, flex: 1, width: 'auto' }}
            />
          </div>
        </VStack>

        <VStack spacing={10}>
          <NaviButton
            title="관심 분야 추가"
            isEnabled={!isSaving && (interests.length > 0 || draft.trim() !== '')}
            onClick={() => {
              const latest = withDraft()
              setInterests(latest)
              setDraft('')
              saveAndContinue(latest)
            }}
          />
          <NaviButton title="건너뛰기" style="secondary" isEnabled={!isSaving} onClick={() => saveAndContinue(interests)} />
          {store.errorMessage && <InlineError message={store.errorMessage} />}
        </VStack>
      </VStack>
    </NaviCard>
  )
}

function ServiceConnection({ store, gmailConnected, calendarConnected, onConnected, onComplete }: {
  store: SessionStore
  gmailConnected: boolean
  calendarConnected: boolean
  onConnected: () => void
  onComplete: () => Promise<void>
}) {
  const [isConnecting, setConnecting] = useState(false)
  const [isCompleting, setCompleting] = useState(false)
  const canComplete = gmailConnected || calendarConnected

  const connectGoogle = async () => {
    if (isConnecting) return
    setConnecting(true)
    store.setErrorMessage(null)
    try {
      // One Google authorization grants both scopes, so both service indicators turn on together.
      await store.connectGoogleServices()
      onConnected()
    } catch (error) {
      store.setErrorMessage(errorText(error))
    } finally {
      setConnecting(false)
    }
  }

  const complete = async () => {
    if (isCompleting) return
    setCompleting(true)
    store.setErrorMessage(null)
    try {
      await onComplete()
    } finally {
      setCompleting(false)
    }
  }

  return (
    <NaviCard>
      <VStack spacing={50}>
        <VStack spacing={30} align="center">
          <NaviMascot width={129} />
          <VStack spacing={14} align="center">
            <span style={{ ...F.title(25), color: T.ink }}>연결하면 더 정확해져요</span>
            <Subtitle>연결한 정보는 허용한 범위에서만 읽어요.</Subtitle>
          </VStack>
        </VStack>
        <VStack spacing={15}>
          <ServiceRow title="Gmail" logo="GmailLogo" isSelected={gmailConnected} disabled={isConnecting} onClick={connectGoogle} />
          <ServiceRow
            title="Google Calendar"
            logo="GoogleCalendarLogo"
            isSelected={calendarConnected}
            disabled={isConnecting}
            onClick={connectGoogle}
          />
          {isConnecting && (
            <HStack spacing={8} style={{ ...F.body(12), color: T.grayText }}>
              <Spinner small />
              브라우저에서 Google 계정을 선택하고 승인해 주세요.
              <Spacer />
              <button type="button" onClick={() => store.cancelGoogleConnect()} style={{ ...F.body(12, 'semibold'), color: T.purple }}>
                취소
              </button>
            </HStack>
          )}
          {store.errorMessage && <InlineError message={store.errorMessage} />}
          <NaviButton title="연결 완료" isEnabled={canComplete && !isConnecting && !isCompleting} onClick={complete} />
          <NaviButton title="나중에 연결하고 시작하기" style="secondary" isEnabled={!isConnecting && !isCompleting} onClick={complete} />
        </VStack>
      </VStack>
    </NaviCard>
  )
}

function ServiceRow({ title, logo, isSelected, disabled, onClick }: {
  title: string
  logo: string
  isSelected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 15,
        padding: '15px 20px',
        background: T.cardWhite,
        borderRadius: 15,
        border: `${isSelected ? 1.5 : 1}px solid ${isSelected ? T.purple : T.border}`,
        width: '100%'
      }}
    >
      <span style={{ width: 41, height: 41, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <NaviImage name={logo} width={26} height={26} />
      </span>
      <VStack spacing={4} align="flex-start">
        <span style={{ ...F.title(14), color: T.ink }}>{title}</span>
        <span style={{ ...F.body(12), color: T.grayText }}>Google 계정으로 연결</span>
      </VStack>
      <Spacer />
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: isSelected ? 'none' : `1.5px solid ${T.border}`,
          background: isSelected ? T.purple : 'transparent',
          color: T.cardWhite,
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {isSelected ? '✓' : ''}
      </span>
    </button>
  )
}

// MARK: - Shared building blocks

/// A fixed-width (≤400pt) card centered in the window (Figma "Welcome modal").
function NaviCard({ children }: { children: ReactNode }) {
  return (
    <div className="scroll" style={{ height: '100%', background: T.background }}>
      <div
        style={{
          minHeight: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 0'
        }}
      >
        <div style={{ width: 'min(400px, max(calc(100% - 48px), 260px))', padding: '0 10px' }}>{children}</div>
      </div>
    </div>
  )
}

function Subtitle({ children }: { children: ReactNode }) {
  return <span style={{ ...F.body(12), color: T.grayMain, textAlign: 'center', lineHeight: 1.5 }}>{children}</span>
}

/// A "제목 안의 navi" title: the brand word in Bagel Fat One.
function NaviTitle({ prefix, suffix, size = 25 }: { prefix: string; suffix: string; size?: number }) {
  const lines = prefix.split('\n')
  return (
    <span style={{ ...F.title(size), color: T.ink, textAlign: 'center', lineHeight: 1.3 }}>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
      <span style={F.wordmark(size + 5)}>navi</span>
      {suffix}
    </span>
  )
}

function InlineError({ message }: { message: string }) {
  return <span style={{ ...F.body(12), color: T.red, display: 'flex', gap: 6 }}>ⓘ {message}</span>
}

function InlineNotice({ message }: { message: string }) {
  return <span style={{ ...F.body(12), color: T.purple, display: 'flex', gap: 6 }}>✓ {message}</span>
}
