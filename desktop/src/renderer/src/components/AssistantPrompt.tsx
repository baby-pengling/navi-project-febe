import { createContext, useContext } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import type { AssistantAttachment, CommandResult } from '@/data/edge'
import type { AssistantPromptModel, PromptState } from '@/models/prompt'
import { HStack, NaviCloseButton, NaviPromptInput, Spacer, Spinner, VStack } from './core'

// Port of AssistantPrompt.swift's views. The model is shared through context (SwiftUI's
// `environmentObject`).

export const PromptContext = createContext<AssistantPromptModel | null>(null)

/// A tab's prompt bar with navi's answer card above it.
export function NaviAssistantPrompt({ prompt, context }: { prompt: string; context?: AssistantAttachment }) {
  const model = useModel(useContext(PromptContext)!)
  return (
    <VStack spacing={8}>
      {model.state && <AssistantResultCard state={model.state} onClose={() => model.dismiss()} />}
      <NaviPromptInput prompt={prompt} onSubmit={(text) => model.send(text, context)} />
    </VStack>
  )
}

function AssistantResultCard({ state, onClose }: { state: PromptState; onClose: () => void }) {
  return (
    <VStack className="fade-in" spacing={8} style={{ padding: 14, background: T.cardWhite, borderRadius: 12 }}>
      <HStack>
        <span style={{ ...F.body(12, 'bold'), color: T.purple }}>navi</span>
        <Spacer />
        <NaviCloseButton onClick={onClose} />
      </HStack>
      <div className="scroll selectable" style={{ maxHeight: 220 }}>
        {state.kind === 'running' && (
          <HStack spacing={8}>
            <Spinner small />
            <span className="truncate" style={{ ...F.body(12), color: T.grayText }}>
              “{state.prompt}” 처리하고 있어요
            </span>
          </HStack>
        )}
        {state.kind === 'finished' && <Answer result={state.result} />}
        {state.kind === 'failed' && <span style={{ ...F.body(12), color: T.red }}>{state.message}</span>}
      </div>
    </VStack>
  )
}

function Answer({ result }: { result: CommandResult }) {
  const lines = result.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return (
    <VStack spacing={6}>
      {lines[0] && <span style={{ ...F.body(13, 'bold'), color: T.ink }}>{lines[0]}</span>}
      {lines.slice(1).map((line, i) => (
        <span key={i} style={{ ...F.body(12), color: T.ink }}>
          {line}
        </span>
      ))}
      {notes(result.tools).map((note) => (
        <span key={note} style={{ ...F.body(11, 'medium'), color: T.purple }}>
          {note}
        </span>
      ))}
    </VStack>
  )
}

/// What happened outside this card, per tool Claude ran.
function notes(tools: string[]): string[] {
  const notes: string[] = []
  if (tools.includes('create_todo')) notes.push('할 일 목록에 추가했어요.')
  if (tools.includes('create_mail_draft')) notes.push('메일 초안은 메일 탭 임시보관함에서 확인 후 보낼 수 있어요.')
  if (tools.includes('propose_calendar_event')) notes.push('일정 제안을 저장했어요. 승인 화면은 아직 준비 중이에요.')
  return notes
}
