import { useEffect, useRef, useState, type ReactNode } from 'react'
import { F, T, naviHex } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import { errorText } from '@/data/session'
import type { MailDraft } from '@/data/types'
import { passwordChangeErrorText, type PasswordChangeError, type SettingsModel } from '@/models/settings'
import {
  HStack,
  NaviButton,
  NaviDialogButton,
  NaviDialogCard,
  NaviImage,
  NaviMascot,
  NaviTag,
  NaviTextField,
  Spacer,
  VStack,
  useDismiss
} from '@/components/core'

// Window-wide modal dialogs: PasswordChangeDialog.swift, GoogleDisconnectDialog.swift,
// CategoryDialog.swift, and the prep / mail result dialogs.

const Title = ({ children }: { children: ReactNode }) => <span style={{ ...F.heading(18), color: T.ink }}>{children}</span>
const Caption = ({ children, color = T.grayText }: { children: ReactNode; color?: string }) => (
  <span style={{ ...F.body(12), color }}>{children}</span>
)

/// Figma "비밀번호 변경 대화상자".
export function PasswordChangeDialog({ model, onDismiss }: { model: SettingsModel; onDismiss: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<PasswordChangeError | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [isSubmitting, setSubmitting] = useState(false)

  useEffect(() => {
    setError(null)
    setFailure(null)
  }, [current, next, confirmation])

  const canSubmit = !isSubmitting && current !== '' && next !== '' && confirmation !== ''
  const footnote = failure ?? (error ? passwordChangeErrorText[error] : '영문·숫자·특수문자를 포함해 8자 이상 입력하세요.')

  const submit = async () => {
    if (!canSubmit) return
    const validation = model.validatePasswordChange(current, next, confirmation)
    if (validation) {
      setError(validation)
      return
    }
    setSubmitting(true)
    try {
      await model.changePassword(current, next)
      onDismiss()
    } catch (e) {
      setFailure(errorText(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <NaviDialogCard>
      <Title>비밀번호 변경</Title>
      <Caption>안전한 계정 사용을 위해 현재 비밀번호를 확인하세요.</Caption>
      <NaviTextField title="현재 비밀번호" value={current} onChange={setCurrent} isSecure autoFocus />
      <NaviTextField title="새 비밀번호" value={next} onChange={setNext} isSecure />
      <NaviTextField title="새 비밀번호 확인" value={confirmation} onChange={setConfirmation} isSecure onSubmit={submit} />
      <Caption color={error || failure ? T.red : T.grayText}>{footnote}</Caption>
      <HStack spacing={11}>
        <NaviDialogButton title="취소" role="cancel" onClick={onDismiss} />
        <NaviDialogButton title={isSubmitting ? '변경 중…' : '변경하기'} isEnabled={canSubmit} onClick={submit} />
      </HStack>
    </NaviDialogCard>
  )
}

/// "관리" → Google 연결 해제 확인.
export function GoogleDisconnectDialog({ model, onDismiss }: { model: SettingsModel; onDismiss: () => void }) {
  useModel(model)
  return (
    <NaviDialogCard>
      <Title>Google 연결을 해제할까요?</Title>
      <Caption>Gmail과 Google Calendar 연동이 함께 해제돼요. 해제하면 새 메일과 일정을 더 이상 불러오지 않아요.</Caption>
      <VStack spacing={6} style={{ padding: 15, background: T.itemBackground, borderRadius: 6 }}>
        <span style={{ ...F.title(14), color: T.dark }}>
          {model.services.googleEmail ? `Google 계정 · ${model.services.googleEmail}` : 'Google 계정'}
        </span>
        <Caption>다시 연결하면 언제든 이어서 사용할 수 있어요.</Caption>
      </VStack>
      {model.disconnectError && <span style={{ ...F.body(10), color: T.red }}>{model.disconnectError}</span>}
      <HStack spacing={11}>
        <NaviDialogButton title="취소" role="cancel" onClick={onDismiss} />
        <NaviDialogButton
          title={model.isDisconnecting ? '해제 중…' : '연결 해제'}
          role="destructive"
          isEnabled={!model.isDisconnecting}
          onClick={async () => {
            if (await model.disconnectGoogle()) onDismiss()
          }}
        />
      </HStack>
    </NaviDialogCard>
  )
}

/// Figma "카테고리 추가": name, color, live tag preview, 취소 / 추가하기.
export function CategoryDialog({ onCancel, onAdd }: { onCancel: () => void; onAdd: (name: string, color: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#7165FF')
  const [isPickerOpen, setPickerOpen] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pickerRef = useDismiss(isPickerOpen, () => setPickerOpen(false))

  const trimmed = name.trim()
  /** Matches the DB CHECKs: name 1…30 characters. */
  const isValid = [...trimmed].length >= 1 && [...trimmed].length <= 30

  const save = async () => {
    if (!isValid || isSaving) return
    setSaving(true)
    setError(null)
    try {
      await onAdd(trimmed, color.toUpperCase())
      onCancel()
    } catch {
      // The unique (user_id, name) index is the usual cause.
      setError('카테고리를 추가하지 못했어요. 같은 이름이 있는지 확인해 주세요.')
      setSaving(false)
    }
  }

  return (
    <NaviDialogCard>
      <Title>새로운 카테고리 추가</Title>
      <NaviTextField title="카테고리 이름" value={name} onChange={setName} onSubmit={save} autoFocus />
      <HStack style={{ height: 32 }}>
        <span style={{ ...F.title(14), color: '#000' }}>색상</span>
        <Spacer />
        <div ref={pickerRef} style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label={`색상 ${color}`}
            onClick={() => setPickerOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 8px',
              width: 128,
              height: 32,
              background: T.cardWhite,
              borderRadius: 8,
              border: `1px solid ${T.border}`
            }}
          >
            <span style={{ width: 18, height: 18, borderRadius: 5, background: naviHex(color) }} />
            <span style={{ ...F.body(12), color: '#000' }}>{color.toUpperCase()}</span>
          </button>
          {isPickerOpen && (
            <div className="popover fade-in" style={{ top: 'calc(100% + 6px)', right: 0 }}>
              <NaviColorPicker
                initialHex={color}
                onFinish={(picked) => {
                  if (picked) setColor(picked)
                  setPickerOpen(false)
                }}
              />
            </div>
          )}
        </div>
      </HStack>
      <HStack>
        <span style={{ ...F.title(14), color: '#000' }}>미리보기</span>
        <Spacer />
        <NaviTag text={trimmed || '카테고리'} style="category" tint={color} fontSize={11} />
      </HStack>
      {error && <span style={{ ...F.body(10), color: T.red }}>{error}</span>}
      <HStack spacing={11}>
        <NaviDialogButton title="취소" role="cancel" onClick={onCancel} />
        <NaviDialogButton title={isSaving ? '추가 중…' : '추가하기'} isEnabled={isValid && !isSaving} onClick={save} />
      </HStack>
    </NaviDialogCard>
  )
}

// MARK: - Color picker

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  const hex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${hex(f(5))}${hex(f(3))}${hex(f(1))}`.toUpperCase()
}

function hexToHsv(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  const r = ((value >> 16) & 0xff) / 255
  const g = ((value >> 8) & 0xff) / 255
  const b = (value & 0xff) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  return [h, max ? d / max : 0, max]
}

/// Figma "자유 색상 피커": saturation/brightness square, hue bar, HEX field, 취소 / 적용.
/// Calls `onFinish(null)` on cancel.
function NaviColorPicker({ initialHex, onFinish }: { initialHex: string; onFinish: (hex: string | null) => void }) {
  const [[hue, saturation, brightness], setHSV] = useState<[number, number, number]>(() => hexToHsv(naviHex(initialHex)))
  const [hexText, setHexText] = useState(naviHex(initialHex).toUpperCase())
  const current = hsvToHex(hue, saturation, brightness)
  const squareRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  const track = (ref: React.RefObject<HTMLDivElement | null>, onMove: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    const element = ref.current
    if (!element) return
    element.setPointerCapture(e.pointerId)
    const move = (event: PointerEvent | React.PointerEvent) => {
      const rect = element.getBoundingClientRect()
      onMove(
        Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
        Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1)
      )
    }
    move(e)
    const up = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
  }

  const applyHexText = (): string => {
    let text = hexText.trim().toUpperCase()
    if (!text.startsWith('#')) text = '#' + text
    if (!/^#[0-9A-F]{6}$/.test(text)) {
      setHexText(current)
      return current
    }
    setHSV(hexToHsv(text))
    setHexText(text)
    return text
  }

  return (
    <VStack spacing={8} style={{ width: 220 }}>
      <span style={{ ...F.title(14), color: T.ink }}>색상 선택</span>
      <div
        ref={squareRef}
        onPointerDown={track(squareRef, (x, y) => {
          setHSV([hue, x, 1 - y])
          setHexText(hsvToHex(hue, x, 1 - y))
        })}
        style={{
          position: 'relative',
          width: 220,
          height: 108,
          borderRadius: 6,
          background: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, ${hsvToHex(hue, 1, 1)})`,
          cursor: 'crosshair'
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: saturation * 220 - 5,
            top: (1 - brightness) * 108 - 5,
            width: 10,
            height: 10,
            borderRadius: '50%',
            border: '2px solid #fff',
            pointerEvents: 'none'
          }}
        />
      </div>
      <div
        ref={hueRef}
        onPointerDown={track(hueRef, (x) => {
          setHSV([x, saturation, brightness])
          setHexText(hsvToHex(x, saturation, brightness))
        })}
        style={{
          position: 'relative',
          width: 220,
          height: 14,
          borderRadius: 7,
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          cursor: 'pointer'
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: hue * 220 - 6,
            top: 1,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 0 2px rgba(0,0,0,0.4)',
            pointerEvents: 'none'
          }}
        />
      </div>
      <HStack style={{ padding: '0 8px', height: 32, border: `1px solid ${T.border}`, borderRadius: 6, color: '#000' }}>
        <span style={F.body(10)}>HEX</span>
        <input
          value={hexText}
          onChange={(e) => setHexText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyHexText()}
          style={{ ...F.body(12), textAlign: 'right' }}
        />
      </HStack>
      <HStack spacing={8}>
        <NaviDialogButton title="취소" role="cancel" onClick={() => onFinish(null)} />
        <NaviDialogButton title="적용" onClick={() => onFinish(applyHexText())} />
      </HStack>
    </VStack>
  )
}

// MARK: - Prep dialogs

function MascotDialog({ children }: { children: ReactNode }) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 15,
        padding: '25px 20px',
        width: 460,
        background: T.cardWhite,
        borderRadius: 14,
        boxShadow: '0 10px 28px rgba(0,0,0,0.14)',
        textAlign: 'center'
      }}
    >
      {children}
    </div>
  )
}

/// "이번 주 준비를 정리하고 있어요": the steps being run, with 취소.
export function PrepLoadingDialog({ onCancel }: { onCancel: () => void }) {
  return (
    <MascotDialog>
      <NaviMascot width={129} />
      <span style={{ ...F.title(25), color: T.ink }}>이번 주 준비를 정리하고 있어요</span>
      <Caption>메일·할 일·사용자 패턴을 연결하고 기존 할 일과의 중복을 확인해요.</Caption>
      <VStack spacing={10} align="center">
        {['메일에서 준비 요청 찾기', '미완료 할 일 확인하기', '연관 할 일 연결하기', '사용자 패턴 반영하기'].map((step) => (
          <span key={step} style={{ ...F.body(12), color: T.dark, padding: '10px 20px', background: T.itemBackground, borderRadius: 10 }}>
            {step}
          </span>
        ))}
      </VStack>
      <NaviButton title="취소" style="secondary" onClick={onCancel} />
    </MascotDialog>
  )
}

/// "추천에 사용할 정보가 없어요": no criteria selected.
export function PrepNoDataDialog({ onSetCriteria, onDismiss }: { onSetCriteria: () => void; onDismiss: () => void }) {
  return (
    <MascotDialog>
      <NaviMascot width={129} />
      <span style={{ ...F.title(25), color: T.ink }}>추천에 사용할 정보가 없어요</span>
      <Caption>
        추천 기준을 하나 이상 선택해 주세요.
        <br />
        메일, 할 일과 패턴으로 추천할 수 있어요.
      </Caption>
      <NaviButton title="추천 기준 설정" onClick={onSetCriteria} />
      <NaviButton title="일정으로 돌아가기" style="secondary" onClick={onDismiss} />
    </MascotDialog>
  )
}

// MARK: - Mail result

/// Figma "08 - 메일 > 메일 발송 확인" / "> 임시 저장 확인".
export function MailResultDialog({ draft, isSent, onClose }: { draft: MailDraft; isSent: boolean; onClose: () => void }) {
  /** "김지민 <jimin@example.com>" → "김지민". */
  const recipientName = draft.to.split('<')[0].trim() || draft.to
  return (
    <MascotDialog>
      <NaviImage name="IconCheckedCircle" width={50} height={50} />
      <span style={{ ...F.title(25), color: T.ink }}>{isSent ? '메일을 보냈습니다' : '초안을 저장했습니다'}</span>
      <Caption>
        {isSent ? (
          <>
            <b>{recipientName}</b>님에게 정상적으로 전달되었습니다.
          </>
        ) : (
          '작성 중인 메일은 임시 보관함에서 이어 쓸 수 있어요.'
        )}
      </Caption>
      <VStack spacing={10} style={{ padding: '10px 15px', background: T.itemBackground, borderRadius: 10, width: '100%', textAlign: 'left' }}>
        <HStack spacing={12} style={{ padding: '0 8px' }}>
          <span style={{ ...F.body(10), color: T.grayText }}>받는 사람</span>
          <span style={{ ...F.body(12), color: T.ink }}>{draft.to || '-'}</span>
        </HStack>
        <div style={{ height: 1, background: T.border }} />
        <span
          style={{
            ...F.body(12),
            color: T.ink,
            whiteSpace: 'pre-wrap',
            display: '-webkit-box',
            WebkitLineClamp: 8,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {draft.body}
        </span>
      </VStack>
      <NaviButton title="받은 메일함으로" onClick={onClose} />
    </MascotDialog>
  )
}
