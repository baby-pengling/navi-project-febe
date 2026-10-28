import { useEffect, useMemo, useState } from 'react'
import { useModel } from './lib/observable'
import { errorText, SessionStore } from './data/session'
import { ConfigurationErrorView, LoadingView, OnboardingRouter, type OnboardingStep } from './screens/Onboarding'
import { MainWindow } from './screens/MainWindow'

const COMPLETED_KEY = 'hasCompletedOnboarding'

function readCompleted(): boolean {
  try {
    return localStorage.getItem(COMPLETED_KEY) === 'true'
  } catch {
    return false
  }
}

/// Port of ContentView.swift: configuration error → restoring → main window or onboarding.
export function App() {
  const store = useMemo(() => new SessionStore(), [])
  useModel(store)
  const [hasCompletedOnboarding, setCompletedState] = useState(readCompleted)
  const [step, setStep] = useState<OnboardingStep>('programLanding')

  const setCompleted = (value: boolean) => {
    setCompletedState(value)
    try {
      localStorage.setItem(COMPLETED_KEY, String(value))
    } catch {
      // Not persisted; the session metadata restores it on the next launch anyway.
    }
  }

  // `navi://auth-callback` (Google consent, email confirmation).
  useEffect(() => window.navi.onDeepLink((url) => store.handleCallback(url)), [store])

  const isAuthenticated = store.session !== null
  const isCompleted = store.onboardingState.isCompleted
  useEffect(() => {
    if (isAuthenticated && isCompleted) setCompleted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isCompleted])

  const showsMain = store.isConfigured && !store.isRestoringSession && hasCompletedOnboarding && isAuthenticated

  const signOut = async () => {
    // The session is gone even if this throws (see `signOut`), so always reset.
    try {
      await store.signOut()
    } catch (error) {
      store.setErrorMessage(errorText(error))
    }
    setCompleted(false)
    setStep('programLanding')
  }
  const resetOnboarding = () => setCompleted(false)

  // The dashboard's two-column layout (Figma: 1282×694) needs a wider window.
  useEffect(() => {
    if (showsMain) window.navi.setMinimumSize(1100, 640)
    else window.navi.setMinimumSize(720, 500)
    window.navi.setAccountMenuEnabled(showsMain)
  }, [showsMain])

  if (!store.isConfigured) return <ConfigurationErrorView message={store.configurationError ?? 'Supabase 설정을 확인해 주세요.'} />
  if (store.isRestoringSession) return <LoadingView />
  if (showsMain) {
    return <MainWindow key={store.session!.user.id} store={store} onSignOut={signOut} onResetOnboarding={resetOnboarding} />
  }
  return (
    <OnboardingRouter
      store={store}
      step={step}
      setStep={setStep}
      isCompleted={hasCompletedOnboarding}
      setCompleted={setCompleted}
    />
  )
}
