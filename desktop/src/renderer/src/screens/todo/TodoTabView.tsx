import { useEffect } from 'react'
import { F, T } from '@/lib/theme'
import { useModel } from '@/lib/observable'
import type { DashboardTodo } from '@/data/types'
import { TODO_FILTERS, filterTitle, groupTitle, type TodoTabModel } from '@/models/todo'
import {
  HStack,
  NaviCategoryTag,
  NaviGroupSubtitle,
  NaviIcon,
  NaviPillButton,
  NaviPromptInput,
  NaviSectionHeader,
  NaviSegmentTabs,
  NaviTabHeader,
  Spacer,
  VStack
} from '@/components/core'
import { ErrorText, NewTodoPanel, TodoAddedPanel, TodoItemRow } from '@/components/shared'
import { Card, DeadlinePanel, PrepAddedPanel, PrepDetailPanel, TodoDetailPanel, WeeklyPrepPanel } from '@/components/todoPanels'
import { NaviAssistantPrompt } from '@/components/AssistantPrompt'

/// Figma "10 - 할 일": filter tabs, the deadline-grouped list with a quick-add bar on the
/// left, and a right column that swaps between the overview (오늘의 흐름 + 카테고리), todo
/// detail, deadline picker, new todo, and weekly-prep panels.
export function TodoTabView({ model, onAddCategory }: { model: TodoTabModel; onAddCategory: () => void }) {
  useModel(model)

  useEffect(() => {
    void model.load()
  }, [model])

  const panel = model.panel
  /** Figma uses 308pt for the overview / prep panels and 284pt for the form panels. */
  const rightWidth = ['overview', 'prep', 'prepAdded', 'todoAdded'].includes(panel.kind) ? 308 : 284
  const overview = () => model.set('panel', { kind: 'overview' })

  const isSelected = (todo: DashboardTodo) => (panel.kind === 'detail' || panel.kind === 'deadline') && panel.id === todo.id

  const rightPanel = (() => {
    switch (panel.kind) {
      case 'overview':
        return <TodoOverviewPanels model={model} onAddCategory={onAddCategory} />
      case 'detail': {
        const todo = model.todo(panel.id)
        return todo ? <TodoDetailPanel model={model} todo={todo} /> : <TodoOverviewPanels model={model} onAddCategory={onAddCategory} />
      }
      case 'deadline': {
        const todo = model.todo(panel.id)
        if (!todo) return null
        return (
          <DeadlinePanel
            key={todo.id}
            initial={todo.dueAt ?? new Date()}
            onCancel={() => model.set('panel', { kind: 'detail', id: todo.id })}
            onApply={(date) => {
              model.setDeadline(date, todo.id)
              model.set('panel', { kind: 'detail', id: todo.id })
            }}
          />
        )
      }
      case 'newTodo':
        return (
          <NewTodoPanel
            categories={model.categories}
            initialDraft={model.makeDraft()}
            onCancel={overview}
            onSave={async (draft) => model.set('panel', { kind: 'todoAdded', todo: await model.addTodo(draft) })}
          />
        )
      case 'todoAdded':
        return <TodoAddedPanel todo={panel.todo} onClose={overview} onOpenTodos={overview} />
      case 'prep':
        return <WeeklyPrepPanel model={model} />
      case 'prepDetail': {
        const suggestion = model.suggestions.find((s) => s.id === panel.id)
        if (!suggestion) return null
        return (
          <PrepDetailPanel
            key={suggestion.id}
            categories={model.categories}
            initial={suggestion}
            onCancel={() => model.set('panel', { kind: 'prep' })}
            onAdd={(s) => model.addSuggestion(s)}
          />
        )
      }
      case 'prepAdded':
        return <PrepAddedPanel added={panel.suggestions} onClose={overview} />
    }
  })()

  const emptyMessage = model.searchText ? '검색 결과가 없어요.' : '할 일이 없어요. 아래 입력창이나 "새 할 일"로 추가해 보세요.'

  return (
    <VStack spacing={10} style={{ height: '100%' }}>
      <NaviTabHeader title="할 일" searchPrompt="할 일 검색" searchText={model.searchText} onSearchChange={(t) => model.set('searchText', t)} />
      <HStack spacing={15}>
        <NaviSegmentTabs items={TODO_FILTERS} selection={model.filter} onSelect={(f) => model.set('filter', f)} title={(f) => filterTitle[f]} />
        <Spacer />
        <NaviPillButton title="이번 주 미리 준비" size="large" onClick={() => model.openPrep()} />
        <NaviPillButton title="새 할 일" icon="IconPlus" style="primary" size="large" onClick={() => model.set('panel', { kind: 'newTodo' })} />
      </HStack>

      <HStack spacing={10} align="stretch" style={{ flex: 1, minHeight: 0, paddingBottom: 10 }}>
        <VStack spacing={10} style={{ flex: 1, minWidth: 0 }}>
          <VStack spacing={20} style={{ flex: 1, minHeight: 0, padding: '15px 20px', background: T.cardWhite, borderRadius: 10 }}>
            <HStack>
              <span style={{ ...F.heading(18), color: T.ink }}>기한별 할 일</span>
              <Spacer />
              <button
                type="button"
                title={model.showsCompleted ? '완료한 할 일 숨기기' : '완료한 할 일 보기'}
                onClick={() => model.set('showsCompleted', !model.showsCompleted)}
                style={{ ...F.body(12), color: T.grayText, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 5px 5px 10px' }}
              >
                미완료 {model.openCount} · 완료 {model.doneCount}
                <NaviIcon name="IconChevron" style={{ transform: `rotate(${model.showsCompleted ? -90 : 0}deg)` }} />
              </button>
            </HStack>
            <VStack spacing={20} className="scroll" style={{ flex: 1, minHeight: 0 }}>
              {model.errorMessage && <ErrorText>{model.errorMessage}</ErrorText>}
              {model.groupedTodos.length === 0 && (
                <span style={{ ...F.body(12), color: T.grayText, padding: '8px 10px', background: T.itemBackground, borderRadius: 5 }}>
                  {model.isLoading ? '할 일을 불러오는 중이에요…' : emptyMessage}
                </span>
              )}
              {model.groupedTodos.map((section) => (
                <VStack key={section.group} spacing={10}>
                  <NaviGroupSubtitle title={groupTitle[section.group]} count={section.todos.length} isAlert={section.group === 'overdue'} />
                  {section.todos.map((todo) => (
                    <TodoItemRow
                      key={todo.id}
                      todo={todo}
                      meta={model.meta(todo)}
                      isSelected={isSelected(todo)}
                      onToggle={() => model.toggle(todo.id)}
                      onOpen={() => model.set('panel', { kind: 'detail', id: todo.id })}
                      onClick={() => model.set('panel', { kind: 'detail', id: todo.id })}
                      onDropTodo={(dragged) => model.move(dragged, todo.id)}
                    />
                  ))}
                </VStack>
              ))}
            </VStack>
          </VStack>
          <NaviPromptInput prompt="- [ ] 할 일을 입력하세요  /기한  #카테고리" action="enter" onSubmit={(text) => model.quickAdd(text)} />
        </VStack>

        <VStack spacing={10} style={{ width: rightWidth, flexShrink: 0, minHeight: 0 }}>
          <VStack spacing={10} style={{ flex: 1, minHeight: 0 }}>
            {rightPanel}
          </VStack>
          <NaviAssistantPrompt prompt="내가 놓친 할 일이 있어?" />
        </VStack>
      </HStack>
    </VStack>
  )
}

function caption(done: number, total: number): string {
  if (total === 0) return '오늘 할 일이 아직 없어요.'
  if (done === total) return '오늘 할 일을 모두 끝냈어요!'
  if (done * 2 >= total) return '오늘 할 일을 절반 끝냈어요.'
  if (done === 0) return '오늘 할 일을 시작해 볼까요?'
  return '오늘 할 일을 하나씩 끝내고 있어요.'
}

/// Overview: 오늘의 흐름 + 카테고리.
function TodoOverviewPanels({ model, onAddCategory }: { model: TodoTabModel; onAddCategory: () => void }) {
  const { done, total } = model.todayProgress
  const fraction = total === 0 ? 0 : done / total
  return (
    <VStack spacing={10}>
      <Card spacing={15}>
        <NaviSectionHeader title="오늘의 흐름" tag={`${done}/${total} 완료`} />
        <VStack spacing={5} style={{ paddingRight: 24 }}>
          <span style={{ ...F.title(28), color: T.purple }}>{Math.round(fraction * 100)}%</span>
          <VStack spacing={10}>
            <span style={{ ...F.body(12), color: T.grayText }}>{caption(done, total)}</span>
            <div style={{ height: 8, borderRadius: 4, background: T.itemBackground, overflow: 'hidden' }}>
              <div style={{ height: 8, borderRadius: 4, background: T.purple, width: `${fraction * 100}%` }} />
            </div>
          </VStack>
        </VStack>
      </Card>
      <Card spacing={20}>
        <HStack>
          <span style={{ ...F.heading(18), color: T.ink }}>카테고리</span>
          <Spacer />
          <NaviPillButton title="추가" icon="IconPlus" onClick={onAddCategory} />
        </HStack>
        <VStack spacing={10}>
          {model.categories.length === 0 && <span style={{ ...F.body(12), color: T.grayText }}>카테고리를 추가해 할 일을 나눠 보세요.</span>}
          {model.categories.map((category) => (
            <HStack key={category.id} style={{ padding: '0 10px' }}>
              <NaviCategoryTag category={category} fontSize={11} />
              <Spacer />
              <span style={{ ...F.body(12), color: T.grayText }}>{model.count(category)}</span>
            </HStack>
          ))}
        </VStack>
      </Card>
    </VStack>
  )
}
