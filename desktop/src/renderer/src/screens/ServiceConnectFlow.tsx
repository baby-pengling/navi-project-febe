import { useState, type ReactNode } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import type { SettingsModel } from '@/models/settings'
import { HStack, NaviButton, NaviImage, NaviTabHeader, Spacer, VStack } from '@/components/core'

export type ConnectService = 'mail' | 'calendar'
export type ConnectStep = 'prompt' | 'chooser' | 'permissions' | 'success' | 'failure'

/// Google connect flow for the mail / calendar tabs (Figma "08 - 메일 > 연동하세요" → "계정
/// 연동" → "권한 안내" → "완료" / "실패"). Gmail and Calendar share one Google consent.
export function ServiceConnectFlow({ service, model, step, setStep, onFinish }: {
  service: ConnectService
  model: SettingsModel
  step: ConnectStep
  setStep: (step: ConnectStep) => void
  /** "메일로 돌아가기" / "일정으로 돌아가기" after a successful connection. */
  onFinish: () => void
}) {
  useModel(model)
  const [searchText, setSearchText] = useState('')
  const copy = service === 'mail' ? MAIL_COPY : CALENDAR_COPY

  const logo = (height: number) => (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <NaviImage name={copy.logo} width={41} height={41} />
    </div>
  )

  const content = (() => {
    switch (step) {
      case 'prompt':
        return (
          <VStack spacing={15}>
            {logo(50)}
            <Heading title={copy.promptTitle} subtitle={copy.promptSubtitle} />
            <VStack spacing={8} style={{ padding: 15, background: T.itemBackground, borderRadius: 6, textAlign: 'left' }}>
              <span style={{ ...F.title(14), color: T.dark }}>{copy.benefits}</span>
              <span style={{ ...F.body(12), color: T.grayText }}>{copy.benefitsCaveat}</span>
            </VStack>
            <NaviButton title={copy.promptButton} onClick={() => setStep('chooser')} />
            <span style={{ ...F.body(10), color: T.grayText }}>연동한 계정은 설정에서 관리할 수 있어요.</span>
          </VStack>
        )
      case 'chooser':
        return (
          <VStack spacing={15}>
            {logo(50)}
            <Heading title={copy.chooserTitle} subtitle="연동할 서비스를 선택해 주세요." />
            <button
              type="button"
              aria-label={`${copy.providerName}, Google 계정으로 연동`}
              onClick={() => setStep('permissions')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 15,
                padding: 15,
                height: 73,
                background: T.cardWhite,
                borderRadius: 15,
                border: `1px solid ${T.border}`,
                width: '100%'
              }}
            >
              <NaviImage name={copy.logo} width={41} height={41} />
              <VStack spacing={3} align="flex-start">
                <span style={{ ...F.title(14), color: T.ink }}>{copy.providerName}</span>
                <span style={{ ...F.body(12), color: T.grayText }}>Google 계정으로 연동</span>
              </VStack>
              <Spacer />
            </button>
            <span style={{ ...F.body(12), color: T.grayText }}>Google 인증 화면에서 계정과 접근 권한을 확인해요.</span>
            <NaviButton title="취소" style="secondary" onClick={() => setStep('prompt')} />
          </VStack>
        )
      case 'permissions':
        return (
          <VStack spacing={10}>
            {logo(40)}
            <Heading title="계정 연동 전 확인" subtitle="Google에서 계정을 선택하고 연동을 승인해 주세요." />
            <VStack spacing={10} style={{ textAlign: 'left' }}>
              <span style={{ ...F.heading(18), color: T.dark }}>Navi에서 사용할 기능</span>
              {copy.permissions.map((permission) => (
                <VStack key={permission.title} spacing={4}>
                  <span style={{ ...F.title(14), color: T.dark }}>{permission.title}</span>
                  <span style={{ ...F.body(12), color: T.grayText }}>{permission.detail}</span>
                </VStack>
              ))}
              {/* One Google consent grants both scopes (Figma lists only this tab's service). */}
              <span style={{ ...F.body(10), color: T.grayText }}>{copy.sharedConsentNote}</span>
            </VStack>
            <NaviButton
              title={model.isConnectingGoogle ? '브라우저에서 연동 중…' : 'Google 계정으로 계속'}
              isEnabled={!model.isConnectingGoogle}
              onClick={async () => setStep((await model.connectGoogle()) ? 'success' : 'failure')}
            />
            <NaviButton
              title="취소"
              style="secondary"
              onClick={() => {
                // The consent runs in the browser, so 취소 also stops waiting for it.
                if (model.isConnectingGoogle) model.cancelGoogleConnect()
                else setStep('prompt')
              }}
            />
          </VStack>
        )
      case 'success':
        return (
          <VStack spacing={15}>
            {logo(50)}
            <Heading title={copy.successTitle} subtitle={copy.successSubtitle} />
            <HStack spacing={15} style={{ padding: '10px 15px', background: T.itemBackground, borderRadius: 6 }}>
              <NaviImage name={copy.logo} width={35} height={35} />
              <span style={{ ...F.title(14), color: T.dark }}>{copy.providerName} · 연동 완료</span>
              <Spacer />
            </HStack>
            <NaviButton title={copy.successButton} onClick={onFinish} />
          </VStack>
        )
      case 'failure':
        return (
          <VStack spacing={15}>
            {logo(50)}
            <Heading
              title={copy.failureTitle}
              subtitle={
                <>
                  인증이 취소됐거나 연결에 문제가 있을 수 있어요.
                  <br />
                  다시 연동해 주세요. 기존 데이터는 그대로 유지돼요.
                </>
              }
            />
            {model.connectError && <span style={{ ...F.body(11), color: T.red }}>{model.connectError}</span>}
            <NaviButton title="다시 연동하기" onClick={() => setStep('permissions')} />
            <NaviButton title="나중에 하기" style="secondary" onClick={() => setStep('prompt')} />
          </VStack>
        )
    }
  })()

  return (
    <VStack spacing={10} style={{ height: '100%' }}>
      <NaviTabHeader title={copy.tabTitle} searchPrompt={copy.searchPrompt} searchText={searchText} onSearchChange={setSearchText} isSearchEnabled={false} />
      <div
        className="scroll"
        style={{
          flex: 1,
          minHeight: 0,
          marginBottom: 10,
          background: T.cardWhite,
          borderRadius: 10,
          padding: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center'
        }}
      >
        <div key={step} className="fade-in" style={{ width: 460, margin: 'auto' }}>
          {content}
        </div>
      </div>
    </VStack>
  )
}

function Heading({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <VStack spacing={15} align="center">
      <span style={{ ...F.title(25), color: T.ink }}>{title}</span>
      <span style={{ ...F.body(12), color: T.grayText }}>{subtitle}</span>
    </VStack>
  )
}

interface Copy {
  tabTitle: string
  searchPrompt: string
  logo: string
  providerName: string
  promptTitle: string
  promptSubtitle: string
  benefits: string
  benefitsCaveat: string
  promptButton: string
  chooserTitle: string
  permissions: { title: string; detail: string }[]
  sharedConsentNote: string
  successTitle: string
  successSubtitle: string
  successButton: string
  failureTitle: string
}

/// Figma copy, verbatim.
const MAIL_COPY: Copy = {
  tabTitle: '메일',
  searchPrompt: '메일 검색',
  logo: 'GmailLogo',
  providerName: 'Gmail',
  promptTitle: '메일 계정을 연동하세요',
  promptSubtitle: '메일 계정을 연동하면 중요한 메일을 모아 볼 수 있어요.',
  benefits: '중요 메일 요약 · 즐겨찾기 · 답장 초안',
  benefitsCaveat: '연동 전에는 메일을 불러오거나 발송할 수 없어요.',
  promptButton: '메일 계정 연동하기',
  chooserTitle: '메일 계정 연동',
  permissions: [
    { title: '메일 조회 및 요약', detail: '메일 목록과 본문을 바탕으로 중요한 메일을 정리해요.' },
    { title: '답장 초안 작성', detail: '선택한 메일의 답변 작성을 도와드려요.' },
    { title: '검토 후 발송', detail: '메일은 내용을 검토하고 발송을 승인한 뒤 보내요.' }
  ],
  sharedConsentNote: '같은 Google 동의로 Google Calendar도 함께 연동돼요.',
  successTitle: '메일 계정이 연동됐어요',
  successSubtitle: '이제 중요한 메일과 답장 초안을 확인할 수 있어요.',
  successButton: '메일로 돌아가기',
  failureTitle: '메일 연동을 완료하지 못했어요'
}

/// Calendar has no Final Prototype frames for this flow; the rest mirrors the mail screens.
const CALENDAR_COPY: Copy = {
  tabTitle: '일정',
  searchPrompt: '일정 검색',
  logo: 'GoogleCalendarLogo',
  providerName: 'Google Calendar',
  promptTitle: '캘린더를 연동하세요',
  promptSubtitle: '캘린더를 연동하면 오늘 일정과 이번 주 준비를 한눈에 볼 수 있어요.',
  benefits: '주간·월간 일정 · 새 일정 등록 · 이번 주 준비',
  benefitsCaveat: 'Gmail과 함께 한 번에 연동돼요. 연동 전에는 일정을 불러오거나 등록할 수 없어요.',
  promptButton: 'Google 계정 연동하기',
  chooserTitle: '캘린더 연동',
  permissions: [
    { title: '일정 조회 및 브리핑', detail: '오늘과 이번 주 일정을 시간순으로 정리해요.' },
    { title: '일정 등록 및 수정', detail: '새 일정을 만들고 바꾸는 걸 도와드려요.' },
    { title: '승인 후 등록', detail: '일정은 내용을 확인하고 승인한 뒤 등록해요.' }
  ],
  sharedConsentNote: '같은 Google 동의로 Gmail도 함께 연동돼요.',
  successTitle: '캘린더가 연동됐어요',
  successSubtitle: '이제 오늘 일정과 이번 주 준비를 확인할 수 있어요.',
  successButton: '일정으로 돌아가기',
  failureTitle: '캘린더 연동을 완료하지 못했어요'
}
