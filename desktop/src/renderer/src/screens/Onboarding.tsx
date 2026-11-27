import { useEffect, useState, type ReactNode } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import { errorText, type SessionStore } from '@/data/session'
import { HStack, NaviButton, NaviImage, NaviLinkButton, NaviLoadingStatus, NaviLogoMark, NaviMascot, NaviTextField, Spacer, VStack } from '@/components/core'
import { AppearancePicker } from '@/components/AppearancePicker'
import { readAppearance, type AgentAppearance } from '@/lib/appearance'

// Port of the onboarding half of ContentView.swift.

export type OnboardingStep = 'programLanding' | 'welcome' | 'login' | 'signUp' | 'appearance' | 'interests' | 'services'

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
    if ((step === 'programLanding' || step === 'welcome') && !state.hasAppearance) setStep('appearance')
    else if (!isCompleted && (step === 'programLanding' || step === 'welcome')) setStep('interests')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, state.hasAppearance, state.interests.join('\n'), state.gmailConnected, state.calendarConnected])

  const content = (() => {
    switch (step) {
      case 'programLanding':
        return <ProgramLanding onFinished={() => setStep('welcome')} />
      case 'welcome':
        return <Welcome onLogin={() => setStep('login')} onSignUp={() => { setCompleted(false); setStep('signUp') }} />
      case 'login':
        return (
          <Login
            store={store}
            notice={loginNotice}
            onBack={() => setStep('welcome')}
            onSuccess={() => {
              setLoginNotice(null)
              if (!store.onboardingState.hasAppearance) setStep('appearance')
              else if (store.onboardingState.isCompleted) setCompleted(true)
              else setStep('interests')
            }}
          />
        )
      case 'signUp':
        return (
          <SignUp
            store={store}
            onBackToLogin={() => setStep('login')}
            onSuccess={() => setStep('appearance')}
          />
        )
      case 'appearance':
        return <AppearanceSelection store={store} onNext={() => store.onboardingState.isCompleted ? setCompleted(true) : setStep('interests')} />
      case 'interests':
        return (
          <InterestSelection
            store={store}
            interests={interests}
            setInterests={setInterests}
            onNext={async (latest) => {
              try {
                await store.completeOnboarding(latest, gmailConnected, calendarConnected)
                setCompleted(true)
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

function AppearanceSelection({ store, onNext }: { store: SessionStore; onNext: () => void }) {
  const [appearance, setAppearance] = useState<AgentAppearance>(() => readAppearance(store.session?.user.user_metadata))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const continueToInterests = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await store.saveAppearance(appearance)
      onNext()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setSaving(false)
    }
  }
  return <NaviCard>
    <VStack spacing={22}>
      <VStack spacing={8} align="center"><span style={{ ...F.title(25), color: T.ink }}>나만의 navi 만들기</span><Subtitle>원하는 모양과 색을 골라 주세요. 설정에서 언제든 바꿀 수 있어요.</Subtitle></VStack>
      <AppearancePicker value={appearance} onChange={setAppearance} />
      <NaviButton title="계속하기" isLoading={saving} loadingMessage="캐릭터를 저장하는 중…" onClick={() => void continueToInterests()} />
      {error && <InlineError message={error} />}
    </VStack>
  </NaviCard>
}

function ProgramLanding({ onFinished }: { onFinished: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onFinished, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <NaviCard>
      <HStack spacing={16} style={{ justifyContent: 'center' }}>
        <NaviLogoMark width={56} />
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
  const [isSuccessful, setSuccessful] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [isResetting, setResetting] = useState(false)
  const [resetNotice, setResetNotice] = useState<string | null>(null)
  const canSubmit = !isSubmitting && email.trim() !== '' && password !== ''

  const submit = async () => {
    if (!canSubmit) return
    setErrorMessage(null)
    setSubmitting(true)
    try {
      await store.signIn(email, password)
      setSuccessful(true)
      await new Promise((resolve) => setTimeout(resolve, 650))
      store.finishLoginTransition()
      onSuccess()
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setSubmitting(false)
    }
  }

  const requestReset = async () => {
    if (!resetEmail.trim() || isResetting) return
    setResetting(true)
    setErrorMessage(null)
    setResetNotice(null)
    try {
      await store.requestPasswordReset(resetEmail)
      setResetNotice('계정이 있다면 비밀번호 재설정 메일을 보냈어요. 받은 편지함을 확인해 주세요.')
    } catch (error) {
      setErrorMessage(errorText(error))
    } finally {
      setResetting(false)
    }
  }

  if (isSubmitting || isSuccessful) return (
    <NaviCard>
      <VStack spacing={18} align="center" style={{ textAlign: 'center' }}>
        {isSuccessful ? <NaviMascot width={90} /> : <NaviLoadingStatus message="로그인 정보를 확인하는 중…" />}
        {isSuccessful && <span style={{ ...F.body(12, 'light'), color: T.ink }}>로그인에 성공했어요.</span>}
      </VStack>
    </NaviCard>
  )

  if (showReset) return (
    <NaviCard>
      <VStack spacing={20}>
        <VStack spacing={10} align="center">
          <NaviMascot width={100} />
          <span style={{ ...F.title(25), color: T.ink }}>비밀번호 재설정</span>
          <Subtitle>계정 이메일을 입력하면 재설정 링크를 보내드려요.</Subtitle>
        </VStack>
        <NaviTextField title="이메일" value={resetEmail} onChange={setResetEmail} onSubmit={requestReset} autoFocus />
        {errorMessage && <InlineError message={errorMessage} />}
        {resetNotice && <InlineNotice message={resetNotice} />}
        <NaviButton title="재설정 메일 보내기" isEnabled={!!resetEmail.trim()} isLoading={isResetting} loadingMessage="재설정 메일을 보내는 중…" onClick={requestReset} />
        <NaviLinkButton title="← 로그인으로 돌아가기" onClick={() => { setShowReset(false); setErrorMessage(null) }} />
      </VStack>
    </NaviCard>
  )

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
            <HStack style={{ justifyContent: 'space-between' }}>
              <NaviLinkButton title="← 처음으로" onClick={onBack} />
              <button type="button" className="navi-link-button password-reset-link" style={{ ...F.body(14, 'semibold'), color: T.red }} onClick={() => { setResetEmail(email); setErrorMessage(null); setShowReset(true) }}>비밀번호를 잊으셨나요?</button>
            </HStack>
          </VStack>
        </VStack>
      </VStack>
    </NaviCard>
  )
}

export function PasswordRecovery({ store, onComplete }: { store: SessionStore; onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isSaving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const save = async () => {
    if (isSaving) return
    if (password.length < 8) { setMessage('비밀번호는 8자리 이상이어야 합니다.'); return }
    if (password !== confirmation) { setMessage('비밀번호가 일치하지 않아요.'); return }
    setSaving(true)
    setMessage(null)
    try {
      await store.completePasswordRecovery(password)
      onComplete()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setSaving(false)
    }
  }
  return <NaviCard><VStack spacing={16}>
    <VStack spacing={10} align="center"><NaviMascot width={100} /><span style={{ ...F.title(25), color: T.ink }}>새 비밀번호 설정</span></VStack>
    <NaviTextField title="새 비밀번호" value={password} onChange={setPassword} isSecure isError={!!message && password.length < 8} />
    <NaviTextField title="비밀번호 확인" value={confirmation} onChange={setConfirmation} isSecure onSubmit={save} isError={!!message && password !== confirmation} />
    {message && <InlineError message={message} />}
    <NaviButton title="비밀번호 저장" isLoading={isSaving} loadingMessage="비밀번호를 저장하는 중…" onClick={save} />
  </VStack></NaviCard>
}

function SignUp({ store, onBackToLogin, onSuccess }: { store: SessionStore; onBackToLogin: () => void; onSuccess: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('')
  type RequiredField = 'name' | 'email' | 'password'
  const [touched, setTouched] = useState<Record<RequiredField, boolean>>({ name: false, email: false, password: false })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setSubmitting] = useState(false)
  const [isResending, setResending] = useState(false)
  const [requiresConfirmation, setRequiresConfirmation] = useState(false)
  const fieldErrors: Record<RequiredField, string | null> = {
    name: name.trim() ? null : '필수 입력 항목입니다.',
    email: !email.trim() ? '필수 입력 항목입니다.' : !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email) ? '올바른 이메일이 아닙니다.' : null,
    password: !password ? '필수 입력 항목입니다.' : password.length < 8 ? '비밀번호는 8자리 이상이어야 합니다.' : null
  }
  const markTouched = (field: RequiredField) => setTouched((current) => ({ ...current, [field]: true }))
  const changeField = (field: RequiredField, value: string, setter: (value: string) => void) => {
    setter(value)
    if (value) markTouched(field)
  }

  const submit = async () => {
    if (isSubmitting) return
    setTouched({ name: true, email: true, password: true })
    if (Object.values(fieldErrors).some(Boolean)) return
    setErrorMessage(null)
    setRequiresConfirmation(false)
    setSubmitting(true)
    try {
      const sessionCreated = await store.signUp(name, email, password, role)
      if (sessionCreated) {
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
          <NaviTextField title="이름" value={name} onChange={(value) => changeField('name', value, setName)} onBlur={() => markTouched('name')} isRequired isError={touched.name && !!fieldErrors.name} autoFocus />
          {touched.name && fieldErrors.name && <InlineError message={fieldErrors.name} />}
          <NaviTextField title="이메일" value={email} onChange={(value) => changeField('email', value, setEmail)} onBlur={() => markTouched('email')} isRequired isError={touched.email && !!fieldErrors.email} />
          {touched.email && fieldErrors.email && <InlineError message={fieldErrors.email} />}
          <NaviTextField title="비밀번호" value={password} onChange={(value) => changeField('password', value, setPassword)} onBlur={() => markTouched('password')} isSecure isRequired isError={touched.password && !!fieldErrors.password} />
          {touched.password && fieldErrors.password && <InlineError message={fieldErrors.password} />}
          <NaviTextField title="직업 / 역할" value={role} onChange={setRole} onSubmit={submit} />
          {errorMessage && <InlineError message={errorMessage} />}
          {requiresConfirmation && (
            <NaviButton
              title="인증 메일 다시 보내기"
              style="secondary"
              isLoading={isResending}
              onClick={resend}
            />
          )}
          <VStack spacing={20}>
            <NaviButton title="계정 만들기" isLoading={isSubmitting} loadingMessage="계정을 만드는 중…" onClick={submit} />
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
      <NaviLoadingStatus message="로그인 상태를 확인하는 중…" />
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
              placeholder="입력 후 Enter 또는 Tab을 눌러 태그 추가"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing && draft.trim()) {
                  e.preventDefault()
                  addDraft()
                }
              }}
              style={{ ...F.body(13), minWidth: 90, flex: 1, width: 'auto' }}
            />
          </div>
        </VStack>

        <VStack spacing={10}>
          <NaviButton
            title="관심 분야 추가하고 시작하기"
            isEnabled={interests.length > 0 || draft.trim() !== ''}
            isLoading={isSaving}
            onClick={() => {
              const latest = withDraft()
              setInterests(latest)
              setDraft('')
              saveAndContinue(latest)
            }}
          />
          <NaviButton title="건너뛰고 시작하기" style="secondary" isLoading={isSaving} onClick={() => saveAndContinue(interests)} />
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
              <NaviLoadingStatus message="Google 계정 연결을 기다리는 중…" compact />
              <Spacer />
              <button type="button" onClick={() => store.cancelGoogleConnect()} style={{ ...F.body(12, 'semibold'), color: T.purple }}>
                취소
              </button>
            </HStack>
          )}
          {store.errorMessage && <InlineError message={store.errorMessage} />}
          <NaviButton title="연결 완료" isEnabled={canComplete && !isConnecting} isLoading={isCompleting} onClick={complete} />
          <NaviButton title="나중에 연결하고 시작하기" style="secondary" isEnabled={!isConnecting} isLoading={isCompleting} onClick={complete} />
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
