import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import { closestCenter, DndContext, PointerSensor, pointerWithin, useSensor, useSensors } from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import './index.css'
import { COLOR_CLASS, DEFAULT_AI_GROUPING_MODELS, DEFAULT_AI_GROUPING_PROMPT, DEFAULT_AI_GROUPING_SETTINGS, DEFAULT_GEMINI_AI_GROUPING_MODEL, DEFAULT_GROUP_MIN_TABS, DEFAULT_HIBERNATE_AFTER_MINUTES, GROUP_COLORS, OPENROUTER_AI_GROUPING_MODEL_PLACEHOLDER, STORAGE_KEYS, getDefaultAiGroupingPrompt, isDefaultAiGroupingPrompt } from './lib/constants'
import { getAiGroupingSettings, getPreferences, getRules, parseAiGroupingApiKeys, resetRules, saveAiGroupingSettings, savePreferences, saveRules } from './lib/storage'
import { applyTheme } from './lib/theme'
import { formatShortcut } from './lib/shortcuts'
import { CHROME_WEB_STORE_URL, GITHUB_ISSUES_URL, GITHUB_REPO_URL, getExtensionVersion, openExternalUrl } from './lib/links'
import {
  getRuleConditions,
  getDomain,
  isValidRegex,
  queryTabsByScope,
  sortCurrentWindowGroupsByRuleOrder,
  testPattern,
  ungroupCurrentWindowGroupsByTitle,
  ungroupFallbackGroupsBelowThreshold,
} from './lib/grouping'
import type { AiGroupingProvider, AiGroupingSettings, AutoGroupRule, LanguageMode, MatchMode, MatchTarget, Preferences, RuleCondition, ShortcutInfo, ThemeMode, UiDensity } from './lib/types'
import { AnchorSelect, DangerButton, FieldLabel, GhostButton, PrimaryButton, Switch, TextArea, TextInput, Tooltip } from './components/ui'
import { getLanguageName, getMessages, resolveLanguage } from './lib/i18n'


const now = () => Date.now()

const HEADER_ACTION_CLASS = 'inline-flex min-h-[var(--opt-header-button-min)] appearance-none items-center justify-center rounded-[var(--opt-header-button-r)] bg-zinc-900/70 px-[var(--opt-header-button-x)] font-sans text-[length:var(--opt-header-button-text)] font-medium leading-none text-zinc-200 antialiased ring-1 ring-white/10 transition hover:bg-zinc-800 active:scale-[.98]'
const SMALL_ACTION_CLASS = 'min-h-[var(--opt-small-button-min)] px-[var(--opt-small-button-x)] py-[var(--opt-small-button-y)] text-[length:var(--opt-small-button-text)]'

const THEME_ICON_OPTIONS: { value: ThemeMode }[] = [
  { value: 'dark' },
  { value: 'light' },
  { value: 'system' },
]

const LANGUAGE_OPTIONS: { value: LanguageMode; label: string }[] = [
  { value: 'system', label: 'A' },
  { value: 'zh', label: '中' },
  { value: 'en', label: 'EN' },
]

const UI_DENSITY_OPTIONS: { value: UiDensity }[] = [
  { value: 'default' },
  { value: 'compact' },
]

type SavePhase = 'saved' | 'error'

type SaveToast = {
  id: number
  phase: Exclude<SavePhase, 'idle'>
  label: string
  detail?: string
}

type DebouncedSaveBucket<T> = {
  timer: number | null
  operation: (() => Promise<T>) | null
  resolvers: Array<{ resolve: (value: T) => void; reject: (reason?: unknown) => void }>
}

const SAVE_DEBOUNCE_MS = 520

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : ''
}

function SaveStatusToast({
  toast,
}: {
  toast: SaveToast
}) {
  const { phase, label, detail } = toast
  const textClass = phase === 'error'
    ? 'text-red-200'
    : 'text-zinc-100'
  const dotClass = phase === 'error'
    ? 'bg-red-400 shadow-[0_0_0_4px_rgba(248,113,113,0.16)]'
    : 'bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.16)]'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -18, scale: 0.94 }}
      transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
      className="inline-flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full bg-zinc-950/92 px-5 py-3 text-sm font-semibold text-zinc-100 shadow-[0_18px_50px_rgba(0,0,0,0.35)] ring-1 ring-white/12 backdrop-blur-xl light:bg-white/94 light:text-zinc-900 light:shadow-[0_18px_50px_rgba(15,23,42,0.18)] light:ring-zinc-900/10"
      role={phase === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      title={detail}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className={`truncate ${textClass}`}>{label}</span>
    </motion.div>
  )
}

function SaveToastViewport({ toasts }: { toasts: SaveToast[] }) {
  const [viewportTop, setViewportTop] = useState(28)

  useEffect(() => {
    const updateViewportTop = () => {
      setViewportTop((window.visualViewport?.offsetTop ?? 0) + 28)
    }

    updateViewportTop()
    window.visualViewport?.addEventListener('resize', updateViewportTop)
    window.visualViewport?.addEventListener('scroll', updateViewportTop)
    window.addEventListener('resize', updateViewportTop)
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewportTop)
      window.visualViewport?.removeEventListener('scroll', updateViewportTop)
      window.removeEventListener('resize', updateViewportTop)
    }
  }, [])

  const viewportLayer = (
    <div
      className="pointer-events-none fixed left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2 px-4"
      style={{ top: viewportTop }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <SaveStatusToast key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  )

  return createPortal(viewportLayer, document.body)
}

function createDebouncedSaveBucket<T>(): DebouncedSaveBucket<T> {
  return { timer: null, operation: null, resolvers: [] }
}

function EyeIcon({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="m4 4 16 16" />}
    </svg>
  )
}


function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === 'light') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="8" cy="8" r="3" />
        <path d="M8 0.9a.7.7 0 0 1 .7.7v1a.7.7 0 1 1-1.4 0v-1A.7.7 0 0 1 8 .9ZM8 12.7a.7.7 0 0 1 .7.7v1a.7.7 0 1 1-1.4 0v-1a.7.7 0 0 1 .7-.7ZM15.1 8a.7.7 0 0 1-.7.7h-1a.7.7 0 1 1 0-1.4h1a.7.7 0 0 1 .7.7ZM3.3 8a.7.7 0 0 1-.7.7h-1a.7.7 0 1 1 0-1.4h1a.7.7 0 0 1 .7.7ZM13.02 2.98a.7.7 0 0 1 0 .99l-.7.7a.7.7 0 1 1-.99-.99l.7-.7a.7.7 0 0 1 .99 0ZM4.67 11.33a.7.7 0 0 1 0 .99l-.7.7a.7.7 0 1 1-.99-.99l.7-.7a.7.7 0 0 1 .99 0ZM13.02 13.02a.7.7 0 0 1-.99 0l-.7-.7a.7.7 0 1 1 .99-.99l.7.7a.7.7 0 0 1 0 .99ZM4.67 4.67a.7.7 0 0 1-.99 0l-.7-.7a.7.7 0 1 1 .99-.99l.7.7a.7.7 0 0 1 0 .99Z" />
      </svg>
    )
  }

  if (mode === 'system') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="3" width="12" height="8" rx="1.5" fill="currentColor" opacity="0.22" />
        <path d="M4 11h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M6.5 14h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M8 11v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M8 3v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
        <path d="M3.5 5.2A1.2 1.2 0 0 1 4.7 4h2.6v6H4.7a1.2 1.2 0 0 1-1.2-1.2V5.2Z" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M13.42 10.15A6.35 6.35 0 0 1 5.85 2.58a.55.55 0 0 0-.68-.67A6.55 6.55 0 1 0 14.1 10.83a.55.55 0 0 0-.68-.68Z" />
    </svg>
  )
}

function DensityIcon({ density }: { density: UiDensity }) {
  if (density === 'compact') {
    return (
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.4" y="2.5" width="11.2" height="1.4" rx="0.7" fill="currentColor" />
        <rect x="2.4" y="5.1" width="11.2" height="1.4" rx="0.7" fill="currentColor" />
        <rect x="2.4" y="7.7" width="11.2" height="1.4" rx="0.7" fill="currentColor" />
        <rect x="2.4" y="10.3" width="11.2" height="1.4" rx="0.7" fill="currentColor" />
        <rect x="2.4" y="12.9" width="11.2" height="1.4" rx="0.7" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="2.6" rx="1.3" fill="currentColor" opacity="0.95" />
      <rect x="2.5" y="6.7" width="11" height="2.6" rx="1.3" fill="currentColor" opacity="0.72" />
      <rect x="2.5" y="10.9" width="11" height="2.6" rx="1.3" fill="currentColor" opacity="0.48" />
    </svg>
  )
}

function createRule(name = '新规则'): AutoGroupRule {
  return {
    id: crypto.randomUUID(),
    name,
    enabled: true,
    target: 'url',
    mode: 'contains',
    pattern: 'example.com',
    conditions: [{ id: crypto.randomUUID(), target: 'url', mode: 'contains', pattern: 'example.com' }],
    groupTitle: '',
    color: 'blue',
    scope: 'currentWindow',
    createdAt: now(),
    updatedAt: now(),
  }
}

async function getConfiguredShortcuts(): Promise<ShortcutInfo[]> {
  if (typeof chrome === 'undefined' || !chrome.commands?.getAll) return []
  const commands = await chrome.commands.getAll()
  return commands.flatMap((command) => command.name ? [{
    name: command.name,
    description: command.description,
    shortcut: command.shortcut,
  }] : [])
}

function getShortcutLabel(shortcuts: ShortcutInfo[], name: string, unboundLabel: string) {
  return formatShortcut(shortcuts.find((shortcut) => shortcut.name === name)?.shortcut ?? '', unboundLabel)
}

function getRuleSearchText(rule: AutoGroupRule) {
  return [
    rule.name,
    rule.groupTitle,
    rule.target,
    rule.mode,
    rule.pattern,
    String(rule.minTabs ?? ''),
    ...getRuleConditions(rule).flatMap((condition) => [condition.target, condition.mode, condition.pattern]),
  ].join('\n').toLowerCase()
}

function ruleMatchesQuery(rule: AutoGroupRule, normalizedQuery: string) {
  return !normalizedQuery || getRuleSearchText(rule).includes(normalizedQuery)
}

function ruleIdFromDnd(value: DragEndEvent['active']['id']) {
  return String(value)
}

function getAiPromptVariables(appLanguage: LanguageMode, minTabs: number) {
  const language = getLanguageName(appLanguage)
  return {
    language,
    minTabs: String(minTabs),
    tabCount: '当前标签数量',
  }
}

function renderAiPromptPreview(prompt: string) {
  return prompt
}

function getEditablePlainText(element: HTMLElement) {
  return element.innerText.replace(/\u00a0/g, ' ')
}

function getSelectionTextOffset(root: HTMLElement) {
  return getSelectionTextRange(root)?.start ?? null
}

function getSelectionTextRange(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const beforeStart = range.cloneRange()
  beforeStart.selectNodeContents(root)
  beforeStart.setEnd(range.startContainer, range.startOffset)
  const beforeEnd = range.cloneRange()
  beforeEnd.selectNodeContents(root)
  beforeEnd.setEnd(range.endContainer, range.endOffset)
  return {
    start: beforeStart.toString().length,
    end: beforeEnd.toString().length,
  }
}

function restoreSelectionTextOffset(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let remaining = Math.max(0, offset)
  let node = walker.nextNode()

  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      range.setStart(node, remaining)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= length
    node = walker.nextNode()
  }

  range.selectNodeContents(root)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function renderAiPromptEditorDom(root: HTMLElement, prompt: string, variables: Record<string, string>) {
  const nodes: Node[] = []
  const pattern = /\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(prompt)) !== null) {
    if (match.index > lastIndex) nodes.push(document.createTextNode(prompt.slice(lastIndex, match.index)))
    const token = match[0]
    const value = variables[match[1]]
    if (value == null) {
      nodes.push(document.createTextNode(token))
    } else {
      const tokenNode = document.createElement('span')
      tokenNode.contentEditable = 'false'
      tokenNode.title = `${token} → ${value}`
      tokenNode.dataset.tooltip = value
      tokenNode.className = 'prompt-editor-token rounded-md px-1 font-medium'
      tokenNode.textContent = token
      nodes.push(tokenNode)
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < prompt.length) nodes.push(document.createTextNode(prompt.slice(lastIndex)))
  root.replaceChildren(...nodes)
}

function findAdjacentPromptToken(value: string, offset: number, direction: 'backward' | 'forward') {
  const pattern = /\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (direction === 'backward' && end === offset) return { start, end }
    if (direction === 'forward' && start === offset) return { start, end }
  }
  return null
}

function AiPromptTextArea({
  value,
  variables,
  onChange,
  placeholder,
}: {
  value: string
  variables: Record<string, string>
  onChange: (value: string) => void
  placeholder: string
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const caretOffsetRef = useRef<number | null>(null)
  const composingRef = useRef(false)

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (composingRef.current) return
    const active = document.activeElement === editor
    const requestedOffset = caretOffsetRef.current
    const shouldRestoreSelection = active || requestedOffset != null
    const offset = shouldRestoreSelection ? requestedOffset ?? getSelectionTextOffset(editor) ?? getEditablePlainText(editor).length : null
    renderAiPromptEditorDom(editor, value, variables)
    if (shouldRestoreSelection && offset != null) {
      editor.focus({ preventScroll: true })
      restoreSelectionTextOffset(editor, offset)
    }
    caretOffsetRef.current = null
  }, [value, variables])

  function handleInput() {
    const editor = editorRef.current
    if (!editor) return
    if (composingRef.current) return
    const offset = getSelectionTextOffset(editor) ?? getEditablePlainText(editor).length
    const nextValue = getEditablePlainText(editor)
    caretOffsetRef.current = offset
    onChange(nextValue)
  }

  function commitEditorValue() {
    const editor = editorRef.current
    if (!editor) return
    const nextValue = getEditablePlainText(editor)
    caretOffsetRef.current = getSelectionTextOffset(editor) ?? nextValue.length
    onChange(nextValue)
  }

  function handleCompositionStart() {
    composingRef.current = true
  }

  function handleCompositionEnd() {
    composingRef.current = false
    commitEditorValue()
  }

  function applyEditorValue(nextValue: string, offset: number) {
    const editor = editorRef.current
    caretOffsetRef.current = offset
    onChange(nextValue)
    editor?.focus()
  }

  function deletePromptRange(start: number, end: number) {
    applyEditorValue(`${value.slice(0, start)}${value.slice(end)}`, start)
  }

  function handleDelete(direction: 'backward' | 'forward') {
    const editor = editorRef.current
    if (!editor) return false
    const range = getSelectionTextRange(editor)
    if (!range) return false

    if (range.start !== range.end) {
      deletePromptRange(Math.min(range.start, range.end), Math.max(range.start, range.end))
      return true
    }

    const adjacentToken = findAdjacentPromptToken(value, range.start, direction)
    if (!adjacentToken) return false
    deletePromptRange(adjacentToken.start, adjacentToken.end)
    return true
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (composingRef.current || event.nativeEvent.isComposing) return
    if (!event.metaKey && !event.ctrlKey && (event.key === 'Backspace' || event.key === 'Delete')) {
      if (handleDelete(event.key === 'Backspace' ? 'backward' : 'forward')) event.preventDefault()
      return
    }

    if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.preventDefault()
  }

  function handleBeforeInput(event: FormEvent<HTMLDivElement>) {
    if (composingRef.current || (event.nativeEvent as InputEvent).isComposing) return
    const inputType = (event.nativeEvent as InputEvent).inputType
    if (inputType !== 'deleteContentBackward' && inputType !== 'deleteContentForward') return
    if (handleDelete(inputType === 'deleteContentBackward' ? 'backward' : 'forward')) event.preventDefault()
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      onInput={handleInput}
      onBeforeInput={handleBeforeInput}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className="prompt-editor-input soft-scrollbar max-h-[45dvh] min-h-[240px] overflow-auto rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-violet-400/70 focus:ring-4 focus:ring-violet-500/10"
    />
  )
}

const ruleCollisionDetection: CollisionDetection = (args) => {
  const pointerIntersections = pointerWithin(args)
  return pointerIntersections.length > 0 ? pointerIntersections : closestCenter(args)
}

function SortableRuleCard({
  rule,
  selected,
  ruleSelected,
  dragging,
  dragHint,
  disabledLabel,
  selectRuleLabel,
  deleteRuleLabel,
  deleteRuleNamedLabel,
  onSelect,
  onToggleSelection,
  onDelete,
}: {
  rule: AutoGroupRule
  selected: boolean
  ruleSelected: boolean
  dragging: boolean
  dragHint: string
  disabledLabel: string
  selectRuleLabel: string
  deleteRuleLabel: string
  deleteRuleNamedLabel: string
  onSelect: () => void
  onToggleSelection: (checked: boolean) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.id })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative list-none select-none overflow-hidden rounded-2xl ring-1 transition-colors ${
        selected ? 'bg-[rgba(255,255,255,.08)] ring-violet-400/40 light:bg-[rgba(139,92,246,.1)] light:ring-violet-500/45 light:shadow-[0_10px_26px_rgba(139,92,246,.12)]' : 'bg-[rgba(255,255,255,.035)] ring-white/10 hover:bg-[rgba(255,255,255,.06)] light:bg-zinc-100/50 light:ring-zinc-900/10 light:hover:bg-violet-500/[0.06] light:hover:ring-violet-500/25'
      } ${dragging || isDragging ? 'z-30 cursor-grabbing opacity-80 shadow-2xl shadow-black/30 ring-violet-300/70' : 'cursor-grab'}`}
      title={dragHint}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {selected && <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-violet-400 light:bg-violet-500" aria-hidden="true" />}
      <div className="p-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={ruleSelected}
            onChange={(event) => onToggleSelection(event.target.checked)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="accent-violet-500"
            aria-label={selectRuleLabel}
          />
          <span className={`grid h-7 w-5 shrink-0 place-items-center rounded-md text-zinc-600 transition group-hover:text-zinc-300 ${dragging || isDragging ? 'text-violet-200' : ''}`} aria-hidden="true">
            <span className="leading-none">⋮⋮</span>
          </span>
          <span className={`h-2.5 w-2.5 rounded-full ${COLOR_CLASS[rule.color]}`} />
          <div className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-semibold">{rule.name}</span>
          </div>
          {!rule.enabled && <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">{disabledLabel}</span>}
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onDelete}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300"
            title={deleteRuleLabel}
            aria-label={deleteRuleNamedLabel}
          >
            {deleteRuleLabel}
          </button>
        </div>
        <div className="w-full text-left">
          <div className="mt-2 truncate pl-12 text-xs text-zinc-500">{rule.target} · {rule.mode} · {rule.pattern}</div>
          <div className="mt-1 pl-12 text-xs text-zinc-600">→ {rule.groupTitle}</div>
        </div>
      </div>
    </li>
  )
}

export function Options() {
  const [rules, setRules] = useState<AutoGroupRule[]>([])
  const [preferences, setPreferences] = useState<Preferences>({
    autoGroupOnCreate: false,
    autoGroupOnUpdate: false,
    organizeScope: 'currentWindow',
    autoDeduplicateTabs: false,
    deduplicateOnOrganize: false,
    autoHibernateTabs: false,
    hibernateAfterMinutes: DEFAULT_HIBERNATE_AFTER_MINUTES,
    hibernateScope: 'currentWindow',
    hibernateProtectMedia: true,
    hibernateProtectCollaboration: true,
    hibernateOnOrganize: false,
    hibernateWhitelist: '',
    autoCollapseGroups: false,
    domainFallbackGrouping: true,
    groupMinTabs: DEFAULT_GROUP_MIN_TABS,
    duplicateScope: 'currentWindow',
    syncRules: false,
    autoGroupOnPopupOpen: false,
    openInSidePanel: true,
    themeMode: 'system',
    languageMode: 'system',
    uiDensity: 'compact',
    newTabDashboardEnabled: true,
    newTabShowSearch: true,
  })
  const [aiGroupingSettings, setAiGroupingSettings] = useState<AiGroupingSettings>(DEFAULT_AI_GROUPING_SETTINGS)
  const aiGroupingSettingsRef = useRef<AiGroupingSettings>(DEFAULT_AI_GROUPING_SETTINGS)
  const [selectedId, setSelectedId] = useState<string>('')
  const [sample, setSample] = useState('')
  const [status, setStatus] = useState('')
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([])
  const [saveToasts, setSaveToasts] = useState<SaveToast[]>([])
  const saveToastIdRef = useRef(0)
  const rulesSaveRef = useRef(createDebouncedSaveBucket<void>())
  const preferencesSaveRef = useRef(createDebouncedSaveBucket<void>())
  const aiGroupingSaveRef = useRef(createDebouncedSaveBucket<void>())
  const [groupMinTabsDraft, setGroupMinTabsDraft] = useState(String(DEFAULT_GROUP_MIN_TABS))
  const [hibernateAfterDraft, setHibernateAfterDraft] = useState(String(DEFAULT_HIBERNATE_AFTER_MINUTES))
  const importInputRef = useRef<HTMLInputElement>(null)
  const [draggingRuleId, setDraggingRuleId] = useState<string | null>(null)
  const draggingRuleIdRef = useRef<string | null>(null)
  const lastOverRuleIdRef = useRef<string | null>(null)
  const rulesOrderRef = useRef<AutoGroupRule[]>([])
  const [ruleQuery, setRuleQuery] = useState('')
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([])
  const [ruleMinTabsDrafts, setRuleMinTabsDrafts] = useState<Record<string, string>>({})
  const [aiPromptEditorOpen, setAiPromptEditorOpen] = useState(false)
  const [aiPromptDraft, setAiPromptDraft] = useState(DEFAULT_AI_GROUPING_PROMPT)
  const [showAiApiKey, setShowAiApiKey] = useState(false)
  const [confirmAction, setConfirmAction] = useState<
    | { type: 'reset' }
    | { type: 'delete'; rule: AutoGroupRule }
    | { type: 'deleteMany'; rules: AutoGroupRule[] }
    | { type: 'import'; rules: AutoGroupRule[]; preferences?: Preferences }
    | null
  >(null)

  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedId) ?? rules[0], [rules, selectedId])
  const t = getMessages(preferences.languageMode)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const normalizedRuleQuery = ruleQuery.trim().toLowerCase()
  const filteredRules = useMemo(() => {
    if (!normalizedRuleQuery) return rules
    return rules.filter((rule) => ruleMatchesQuery(rule, normalizedRuleQuery))
  }, [normalizedRuleQuery, rules])
  const enabledRuleCount = useMemo(() => rules.filter((rule) => rule.enabled).length, [rules])
  const ruleStatsText = (normalizedRuleQuery ? t.ruleStatsWithFilter : t.ruleStats)
    .replace('{visible}', String(filteredRules.length))
    .replace('{enabled}', String(enabledRuleCount))
    .replace('{total}', String(rules.length))
  const visibleRuleIds = useMemo(() => filteredRules.map((rule) => rule.id), [filteredRules])
  const liveSelectedRuleIds = useMemo(() => {
    const liveRuleIds = new Set(rules.map((rule) => rule.id))
    return selectedRuleIds.filter((id) => liveRuleIds.has(id))
  }, [rules, selectedRuleIds])
  const selectedVisibleRuleIds = useMemo(
    () => visibleRuleIds.filter((id) => selectedRuleIds.includes(id)),
    [selectedRuleIds, visibleRuleIds],
  )
  const allVisibleRulesSelected = visibleRuleIds.length > 0 && selectedVisibleRuleIds.length === visibleRuleIds.length
  const aiPromptVariables = useMemo(
    () => getAiPromptVariables(preferences.languageMode, preferences.groupMinTabs),
    [preferences.languageMode, preferences.groupMinTabs],
  )
  const aiPromptPreview = renderAiPromptPreview(aiGroupingSettings.customPrompt)
  const aiApiKeyCount = parseAiGroupingApiKeys(aiGroupingSettings.apiKey).length

  const reloadStoredState = useCallback(async () => {
    const [loadedRules, loadedPreferences, loadedShortcuts, loadedAiGroupingSettings] = await Promise.all([getRules(), getPreferences(), getConfiguredShortcuts(), getAiGroupingSettings()])
    applyTheme(loadedPreferences.themeMode)
    setRules(loadedRules)
    setPreferences(loadedPreferences)
    aiGroupingSettingsRef.current = loadedAiGroupingSettings
    setAiGroupingSettings(loadedAiGroupingSettings)
    setShortcuts(loadedShortcuts)
    setGroupMinTabsDraft(String(loadedPreferences.groupMinTabs))
    setHibernateAfterDraft(String(loadedPreferences.hibernateAfterMinutes))
    setSelectedId((current) => loadedRules.some((rule) => rule.id === current) ? current : loadedRules[0]?.id ?? '')
  }, [setGroupMinTabsDraft, setHibernateAfterDraft])

  const targetOptions: { value: MatchTarget; label: string; description: string }[] = [
    { value: 'url', label: t.targetUrl, description: t.targetUrlDesc },
    { value: 'title', label: t.targetTitle, description: t.targetTitleDesc },
    { value: 'domain', label: t.targetDomain, description: t.targetDomainDesc },
  ]

  const modeOptions: { value: MatchMode; label: string; description: string }[] = [
    { value: 'contains', label: t.modeContains, description: t.modeContainsDesc },
    { value: 'equals', label: t.modeEquals, description: t.modeEqualsDesc },
    { value: 'regex', label: t.modeRegex, description: t.modeRegexDesc },
  ]


  const aiProviderOptions: { value: AiGroupingProvider; label: string; description: string }[] = [
    { value: 'openai', label: 'OpenAI', description: 'https://api.openai.com/v1' },
    { value: 'openrouter', label: 'OpenRouter', description: 'https://openrouter.ai/api/v1' },
    { value: 'gemini', label: 'Gemini', description: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    { value: 'compatible', label: t.aiProviderCompatible, description: t.aiProviderCompatibleDesc },
    { value: 'chromeBuiltIn', label: t.aiProviderChromeBuiltIn, description: t.aiProviderChromeBuiltInDesc },
  ]

  useEffect(() => {
    rulesOrderRef.current = rules
  }, [rules])

  useEffect(() => {
    draggingRuleIdRef.current = draggingRuleId
  }, [draggingRuleId])

  useEffect(() => {
    aiGroupingSettingsRef.current = aiGroupingSettings
  }, [aiGroupingSettings])

  useEffect(() => {
    void (async () => {
      const [loadedRules, loadedPreferences, loadedShortcuts, loadedAiGroupingSettings] = await Promise.all([getRules(), getPreferences(), getConfiguredShortcuts(), getAiGroupingSettings()])
      applyTheme(loadedPreferences.themeMode)
      setRules(loadedRules)
      setPreferences(loadedPreferences)
      aiGroupingSettingsRef.current = loadedAiGroupingSettings
      setAiGroupingSettings(loadedAiGroupingSettings)
      setShortcuts(loadedShortcuts)
      setGroupMinTabsDraft(String(loadedPreferences.groupMinTabs))
      setHibernateAfterDraft(String(loadedPreferences.hibernateAfterMinutes))
      setSelectedId(loadedRules[0]?.id ?? '')
    })()
  }, [])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    const handleStorageChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (draggingRuleIdRef.current) return
      if (changes[STORAGE_KEYS.rules] || changes[STORAGE_KEYS.preferences] || changes[STORAGE_KEYS.aiGroupingSettings]) {
        void reloadStoredState()
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => chrome.storage.onChanged.removeListener(handleStorageChanged)
  }, [reloadStoredState])

  useEffect(() => {
    const refreshShortcuts = () => {
      void getConfiguredShortcuts().then(setShortcuts)
    }

    window.addEventListener('focus', refreshShortcuts)
    document.addEventListener('visibilitychange', refreshShortcuts)
    return () => {
      window.removeEventListener('focus', refreshShortcuts)
      document.removeEventListener('visibilitychange', refreshShortcuts)
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => {
      if (preferences.themeMode === 'system') applyTheme('system')
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [preferences.themeMode])

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(''), 3200)
    return () => window.clearTimeout(timer)
  }, [status])

  function pushSaveToast(phase: SaveToast['phase'], label: string, detail?: string) {
    const id = saveToastIdRef.current + 1
    saveToastIdRef.current = id
    setSaveToasts((current) => [...current, { id, phase, label, detail }].slice(-2))
    const duration = phase === 'error' ? 5200 : phase === 'saved' ? 1800 : 1400
    window.setTimeout(() => {
      setSaveToasts((current) => current.filter((toast) => toast.id !== id))
    }, duration)
  }

  async function trackSave<T>(operation: () => Promise<T>) {
    try {
      const result = await operation()
      pushSaveToast('saved', t.autoSaveSaved)
      return result
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      pushSaveToast('error', t.autoSaveFailed, errorMessage ? `${t.autoSaveFailed}: ${errorMessage}` : t.autoSaveFailedDesc)
      throw error
    }
  }

  function debounceSave<T>(bucket: DebouncedSaveBucket<T>, operation: () => Promise<T>) {
    bucket.operation = operation
    if (bucket.timer !== null) window.clearTimeout(bucket.timer)
    return new Promise<T>((resolve, reject) => {
      bucket.resolvers.push({ resolve, reject })
      bucket.timer = window.setTimeout(() => {
        const pendingOperation = bucket.operation
        const pendingResolvers = bucket.resolvers
        bucket.timer = null
        bucket.operation = null
        bucket.resolvers = []
        if (!pendingOperation) return
        void trackSave(pendingOperation).then(
          (value) => pendingResolvers.forEach((resolver) => resolver.resolve(value)),
          (error) => pendingResolvers.forEach((resolver) => resolver.reject(error)),
        )
      }, SAVE_DEBOUNCE_MS)
    })
  }

  function cancelDebouncedSave<T>(bucket: DebouncedSaveBucket<T>, value: T) {
    if (bucket.timer !== null) window.clearTimeout(bucket.timer)
    bucket.timer = null
    bucket.operation = null
    const pendingResolvers = bucket.resolvers
    bucket.resolvers = []
    pendingResolvers.forEach((resolver) => resolver.resolve(value))
  }

  function cancelPendingDebouncedSaves() {
    cancelDebouncedSave(rulesSaveRef.current, undefined)
    cancelDebouncedSave(preferencesSaveRef.current, undefined)
  }

  async function persist(nextRules: AutoGroupRule[]) {
    setRules(nextRules)
    await debounceSave(rulesSaveRef.current, () => saveRules(nextRules))
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  function isSame(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((val, index) => isSame(val, b[index]))
    }
    if (isRecord(a) && isRecord(b)) {
      const keysA = Object.keys(a)
      const keysB = Object.keys(b)
      return keysA.length === keysB.length && keysA.every((key) => isSame(a[key], b[key]))
    }
    return false
  }

  async function updateRule(id: string, patch: Partial<AutoGroupRule>) {
    const rule = rules.find((r) => r.id === id)
    if (rule) {
      const hasChange = (Object.keys(patch) as Array<keyof AutoGroupRule>).some((key) => !isSame(patch[key], rule[key]))
      if (!hasChange) return
    }
    const next = rules.map((rule) => (rule.id === id ? { ...rule, ...patch, updatedAt: now() } : rule))
    await persist(next)
  }

  async function commitRuleMinTabs(rule: AutoGroupRule, value: string) {
    const trimmed = value.trim()
    setRuleMinTabsDrafts((current) => {
      const next = { ...current }
      delete next[rule.id]
      return next
    })

    const parsed = trimmed ? Number.parseInt(trimmed, 10) : undefined
    const minTabs = Number.isFinite(parsed) ? Math.max(1, parsed as number) : undefined

    if (minTabs === rule.minTabs) return

    await updateRule(rule.id, { minTabs })
  }

  function resetRuleMinTabsDraft(rule: AutoGroupRule) {
    setRuleMinTabsDrafts((current) => ({
      ...current,
      [rule.id]: rule.minTabs == null ? '' : String(rule.minTabs),
    }))
  }

  async function saveRuleConditions(rule: AutoGroupRule, conditions: RuleCondition[]) {
    const [first] = conditions
    await updateRule(rule.id, {
      conditions,
      target: first?.target ?? rule.target,
      mode: first?.mode ?? rule.mode,
      pattern: first?.pattern ?? rule.pattern,
    })
  }

  async function updateCondition(rule: AutoGroupRule, conditionId: string, patch: Partial<RuleCondition>) {
    const conditions = getRuleConditions(rule).map((condition) =>
      condition.id === conditionId ? { ...condition, ...patch } : condition,
    )
    await saveRuleConditions(rule, conditions)
  }

  async function addCondition(rule: AutoGroupRule) {
    const conditions = [
      ...getRuleConditions(rule),
      { id: crypto.randomUUID(), target: 'url' as const, mode: 'contains' as const, pattern: 'example.com' },
    ]
    await saveRuleConditions(rule, conditions)
  }

  async function removeCondition(rule: AutoGroupRule, conditionId: string) {
    const conditions = getRuleConditions(rule).filter((condition) => condition.id !== conditionId)
    if (conditions.length === 0) return
    await saveRuleConditions(rule, conditions)
  }

  async function addRule() {
    const rule = createRule(t.newRule)
    const next = [rule, ...rules]
    setSelectedId(rule.id)
    await persist(next)
  }

  async function duplicateRule(rule: AutoGroupRule) {
    const copy: AutoGroupRule = { ...rule, id: crypto.randomUUID(), name: `${rule.name} ${t.duplicateSuffix}`, createdAt: now(), updatedAt: now() }
    setSelectedId(copy.id)
    await persist([copy, ...rules])
  }

  async function removeRule(id: string) {
    await removeRules([id])
  }

  async function removeRules(ids: string[]) {
    const idSet = new Set(ids)
    const removedRules = rules.filter((rule) => idSet.has(rule.id))
    if (removedRules.length === 0) return
    const next = rules.filter((rule) => !idSet.has(rule.id))
    const managedGroupTitles = new Set(next.filter((rule) => rule.enabled).map((rule) => rule.groupTitle))
    setSelectedId((current) => next.some((rule) => rule.id === current) ? current : next[0]?.id ?? '')
    setSelectedRuleIds((current) => current.filter((id) => !idSet.has(id)))
    await persist(next)
    const orphanedGroupTitles = [...new Set(removedRules.map((rule) => rule.groupTitle))]
      .filter((groupTitle) => !managedGroupTitles.has(groupTitle))
    for (const groupTitle of orphanedGroupTitles) {
      await ungroupCurrentWindowGroupsByTitle(groupTitle)
    }
  }

  function toggleRuleSelection(id: string, checked: boolean) {
    setSelectedRuleIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id))
  }

  function toggleSelectVisibleRules() {
    if (allVisibleRulesSelected) {
      const visible = new Set(visibleRuleIds)
      setSelectedRuleIds((current) => current.filter((id) => !visible.has(id)))
      return
    }
    setSelectedRuleIds((current) => [...new Set([...current, ...visibleRuleIds])])
  }

  function invertVisibleRuleSelection() {
    const visible = new Set(visibleRuleIds)
    setSelectedRuleIds((current) => {
      const currentSet = new Set(current)
      const keptHidden = current.filter((id) => !visible.has(id))
      const invertedVisible = visibleRuleIds.filter((id) => !currentSet.has(id))
      return [...keptHidden, ...invertedVisible]
    })
  }

  function requestBulkDelete() {
    const selectedRules = rules.filter((rule) => selectedRuleIds.includes(rule.id))
    if (selectedRules.length === 0) return
    setConfirmAction({ type: 'deleteMany', rules: selectedRules })
  }

  function mergeReorderedVisibleRules(sourceRules: AutoGroupRule[], nextVisibleRules: AutoGroupRule[]) {
    if (!normalizedRuleQuery) return nextVisibleRules
    const visibleQueue = [...nextVisibleRules]
    const visibleIds = new Set(nextVisibleRules.map((rule) => rule.id))
    return sourceRules.map((rule) => visibleIds.has(rule.id) ? visibleQueue.shift() ?? rule : rule)
  }

  function reorderVisibleRules(sourceRules: AutoGroupRule[], draggedId: string, overId: string) {
    if (draggedId === overId) return sourceRules
    const visibleRules = sourceRules.filter((rule) => ruleMatchesQuery(rule, normalizedRuleQuery))
    const fromIndex = visibleRules.findIndex((rule) => rule.id === draggedId)
    const toIndex = visibleRules.findIndex((rule) => rule.id === overId)
    if (fromIndex < 0 || toIndex < 0) return sourceRules
    const nextVisibleRules = [...visibleRules]
    const [movedRule] = nextVisibleRules.splice(fromIndex, 1)
    nextVisibleRules.splice(toIndex, 0, movedRule)
    return mergeReorderedVisibleRules(sourceRules, nextVisibleRules)
  }

  function handleRuleDragStart(event: DragStartEvent) {
    const ruleId = ruleIdFromDnd(event.active.id)
    draggingRuleIdRef.current = ruleId
    lastOverRuleIdRef.current = ruleId
    setDraggingRuleId(ruleId)
  }

  function handleRuleDragOver(event: DragOverEvent) {
    const overId = event.over ? ruleIdFromDnd(event.over.id) : ''
    if (overId) lastOverRuleIdRef.current = overId
  }

  async function handleRuleDragEnd(event: DragEndEvent) {
    const activeId = ruleIdFromDnd(event.active.id)
    const overId = event.over ? ruleIdFromDnd(event.over.id) : lastOverRuleIdRef.current
    lastOverRuleIdRef.current = null
    draggingRuleIdRef.current = null
    setDraggingRuleId(null)
    if (!overId || activeId === overId) return

    const next = reorderVisibleRules(rulesOrderRef.current, activeId, overId)
    rulesOrderRef.current = next
    setRules(next)
    await saveReorderedRules(next)
  }

  async function saveReorderedRules(next = rulesOrderRef.current) {
    cancelDebouncedSave(rulesSaveRef.current, undefined)
    await trackSave(() => saveRules(next))
    const movedGroups = await sortCurrentWindowGroupsByRuleOrder(next)
    setStatus(movedGroups > 0 ? t.reorderedGroups : t.reordered)
  }

  async function updatePreferences(patch: Partial<Preferences>) {
    const hasChange = (Object.keys(patch) as Array<keyof Preferences>).some((key) => !isSame(patch[key], preferences[key]))
    if (!hasChange) return

    const next = { ...preferences, ...patch }
    setPreferences(next)
    if (typeof patch.groupMinTabs === 'number') setGroupMinTabsDraft(String(patch.groupMinTabs))
    if (typeof patch.hibernateAfterMinutes === 'number') setHibernateAfterDraft(String(patch.hibernateAfterMinutes))
    if (patch.themeMode) applyTheme(patch.themeMode)
    await debounceSave(preferencesSaveRef.current, () => savePreferences(next))
    if (typeof patch.syncRules === 'boolean') {
      await debounceSave(rulesSaveRef.current, () => saveRules(rules))
    }
    const currentAiGroupingSettings = aiGroupingSettingsRef.current
    if (patch.languageMode && isDefaultAiGroupingPrompt(currentAiGroupingSettings.customPrompt)) {
      const customPrompt = getDefaultAiGroupingPrompt(resolveLanguage(patch.languageMode))
      const nextAiGroupingSettings = { ...currentAiGroupingSettings, customPrompt }
      aiGroupingSettingsRef.current = nextAiGroupingSettings
      setAiGroupingSettings(nextAiGroupingSettings)
      if (aiPromptEditorOpen && isDefaultAiGroupingPrompt(aiPromptDraft)) setAiPromptDraft(customPrompt)
      await debounceSave(aiGroupingSaveRef.current, () => saveAiGroupingSettings(nextAiGroupingSettings, patch.languageMode))
    }
  }

  async function updateAiGroupingSettings(patch: Partial<AiGroupingSettings>) {
    const currentSettings = aiGroupingSettingsRef.current
    const currentProvider = currentSettings.provider
    const nextProvider = patch.provider ?? currentProvider
    const apiKeys = {
      ...(currentSettings.apiKeys ?? {}),
      [currentProvider]: patch.apiKey ?? currentSettings.apiKey,
    }
    if (typeof patch.apiKey === 'string') apiKeys[nextProvider] = patch.apiKey
    const models = {
      ...(currentSettings.models ?? {}),
      [currentProvider]: patch.model ?? currentSettings.model,
    }
    if (typeof patch.model === 'string') models[nextProvider] = patch.model
    const next = {
      ...currentSettings,
      ...patch,
      apiKeys,
      models,
      model: typeof patch.model === 'string' ? patch.model : models[nextProvider] ?? DEFAULT_AI_GROUPING_MODELS[nextProvider],
      apiKey: typeof patch.apiKey === 'string' ? patch.apiKey : apiKeys[nextProvider] ?? '',
    }
    if (patch.provider === 'openai' && currentSettings.provider !== 'openai') {
      next.model = models.openai ?? DEFAULT_AI_GROUPING_MODELS.openai
      next.baseUrl = ''
      next.apiKey = apiKeys.openai ?? ''
    }
    if (patch.provider === 'openrouter' && currentSettings.provider !== 'openrouter') {
      next.model = models.openrouter ?? DEFAULT_AI_GROUPING_MODELS.openrouter
      next.baseUrl = ''
      next.apiKey = apiKeys.openrouter ?? ''
    }
    if (patch.provider === 'gemini' && currentSettings.provider !== 'gemini') {
      next.model = models.gemini ?? DEFAULT_AI_GROUPING_MODELS.gemini
      next.baseUrl = ''
      next.apiKey = apiKeys.gemini ?? ''
    }
    if (patch.provider === 'compatible' && currentSettings.provider !== 'compatible') {
      next.model = models.compatible ?? DEFAULT_AI_GROUPING_MODELS.compatible
      next.apiKey = apiKeys.compatible ?? ''
    }
    if (patch.provider === 'chromeBuiltIn' && currentSettings.provider !== 'chromeBuiltIn') {
      next.model = models.chromeBuiltIn ?? DEFAULT_AI_GROUPING_MODELS.chromeBuiltIn
      next.apiKey = apiKeys.chromeBuiltIn ?? ''
    }
    next.apiKeys = { ...apiKeys, [next.provider]: next.apiKey }
    next.models = { ...models, [next.provider]: next.model }

    // Check if anything actually changed in the final object
    const hasChange = (Object.keys(next) as Array<keyof AiGroupingSettings>).some((key) => !isSame(next[key], currentSettings[key]))
    if (!hasChange) return

    aiGroupingSettingsRef.current = next
    setAiGroupingSettings(next)
    await debounceSave(aiGroupingSaveRef.current, () => saveAiGroupingSettings(next, preferences.languageMode))
  }

  function openAiPromptEditor() {
    setAiPromptDraft(aiGroupingSettings.customPrompt)
    setAiPromptEditorOpen(true)
  }

  async function saveAiPromptEditor() {
    await updateAiGroupingSettings({ customPrompt: aiPromptDraft })
    setAiPromptEditorOpen(false)
  }

  function resetAiPromptEditor() {
    setAiPromptDraft(getDefaultAiGroupingPrompt(resolveLanguage(preferences.languageMode)))
  }

  async function commitGroupMinTabs(value = groupMinTabsDraft) {
    const parsed = Number.parseInt(value, 10)
    const nextValue = Number.isFinite(parsed) ? Math.max(1, parsed) : DEFAULT_GROUP_MIN_TABS
    setGroupMinTabsDraft(String(nextValue))
    if (nextValue !== preferences.groupMinTabs) {
      await updatePreferences({ groupMinTabs: nextValue })
      const tabs = await queryTabsByScope(preferences.organizeScope)
      await ungroupFallbackGroupsBelowThreshold(rules, tabs, nextValue)
    }
  }

  async function commitHibernateAfter(value = hibernateAfterDraft) {
    const parsed = Number.parseInt(value, 10)
    const nextValue = Number.isFinite(parsed) ? Math.max(1, parsed) : DEFAULT_HIBERNATE_AFTER_MINUTES
    setHibernateAfterDraft(String(nextValue))
    if (nextValue !== preferences.hibernateAfterMinutes) {
      await updatePreferences({ hibernateAfterMinutes: nextValue })
    }
  }

  async function restoreDefaults() {
    cancelPendingDebouncedSaves()
    const restored = await trackSave(() => resetRules())
    setRules(restored)
    setSelectedId(restored[0]?.id ?? '')
    setStatus(t.resetDone)
  }

  async function replaceWithImportedRules(importedRules: AutoGroupRule[], importedPreferences?: Preferences) {
    cancelPendingDebouncedSaves()
    if (importedPreferences) {
      const nextPreferences = { ...preferences, ...importedPreferences }
      setPreferences(nextPreferences)
      setGroupMinTabsDraft(String(nextPreferences.groupMinTabs))
      applyTheme(nextPreferences.themeMode)
      await trackSave(() => savePreferences(nextPreferences))
    }
    setRules(importedRules)
    setSelectedId(importedRules[0]?.id ?? '')
    setSelectedRuleIds([])
    await trackSave(() => saveRules(importedRules))
    setStatus(t.importDone)
  }

  async function confirmDangerAction() {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)
    if (action.type === 'reset') {
      await restoreDefaults()
      return
    }
    if (action.type === 'deleteMany') {
      await removeRules(action.rules.map((rule) => rule.id))
      return
    }
    if (action.type === 'import') {
      await replaceWithImportedRules(action.rules, action.preferences)
      return
    }
    await removeRule(action.rule.id)
  }

  async function regroupNow() {
    if (typeof chrome === 'undefined' || !chrome.runtime) return
    const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_REGROUP' })
    setStatus(formatOrganizeStatus(response))
  }

  function formatOrganizeStatus(
    response: { ok?: boolean; checked?: number; changed?: number; consolidated?: number; deduplicated?: { closed: number }; hibernated?: { discarded: number }; error?: string },
  ) {
    if (!response?.ok) return response?.error ?? t.failed
    const closed = response.deduplicated?.closed ?? 0
    const discarded = response.hibernated?.discarded ?? 0
    const checked = response.checked ?? 0
    const changed = response.changed ?? 0
    const consolidated = response.consolidated ?? 0
    if (discarded > 0) {
      return t.organizedWithCleanup
        .replace('{closed}', String(closed))
        .replace('{discarded}', String(discarded))
        .replace('{checked}', String(checked))
        .replace('{changed}', String(changed))
    }
    if (closed > 0) {
      return t.organizedWithDeduplication
        .replace('{closed}', String(closed))
        .replace('{checked}', String(checked))
        .replace('{changed}', String(changed))
    }
    if (consolidated > 0) {
      return t.organizedWithGroupConsolidation
        .replace('{checked}', String(checked))
        .replace('{changed}', String(changed))
        .replace('{groups}', String(consolidated))
    }
    return t.organized
      .replace('{checked}', String(checked))
      .replace('{changed}', String(changed))
  }

  async function deduplicateNow() {
    if (typeof chrome === 'undefined' || !chrome.runtime) return
    const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_DEDUPLICATE' })
    if (!response?.ok) {
      setStatus(response?.error ?? t.failed)
      return
    }
    setStatus(response.closed > 0 ? t.deduplicated.replace('{count}', String(response.closed)) : t.noDuplicates)
  }

  async function hibernateNow() {
    if (typeof chrome === 'undefined' || !chrome.runtime) return
    const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_HIBERNATE' })
    if (!response?.ok) {
      setStatus(response?.error ?? t.failed)
      return
    }
    setStatus(response.discarded > 0 ? t.hibernated.replace('{count}', String(response.discarded)) : t.noHibernateCandidates)
  }

  const extensionVersion = getExtensionVersion()

  async function openShortcutSettings() {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
      return
    }
    window.open('chrome://extensions/shortcuts', '_blank')
  }

  function exportRules() {
    const blob = new Blob([JSON.stringify({ rules, preferences }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'tabweave-rules.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importRules(value: string) {
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed.rules)) throw new Error('Invalid file')
      setConfirmAction({ type: 'import', rules: parsed.rules, preferences: parsed.preferences })
    } catch {
      setStatus(t.importFailed)
    }
  }

  const sampleInput = sample.trim()
  const sampleMatchedConditionIndex = selectedRule && sampleInput
    ? getRuleConditions(selectedRule).findIndex((condition) => {
        const value = condition.target === 'url' ? sampleInput.split(' ')[0] : condition.target === 'domain' ? getDomain(sampleInput.split(' ')[0]) : sampleInput
        return testPattern(value, condition.pattern, condition.mode)
      })
    : -1
  const sampleMatched = sampleMatchedConditionIndex >= 0
  const regexInvalid = selectedRule ? getRuleConditions(selectedRule).some((condition) => condition.mode === 'regex' && !isValidRegex(condition.pattern)) : false
  const regroupLabel = preferences.deduplicateOnOrganize
    ? t.regroupWithDeduplicationWindow
    : t.regroupWindow
  const openPopupShortcutLabel = getShortcutLabel(shortcuts, '_execute_action', t.unbound)
  const commandSearchShortcutLabel = getShortcutLabel(shortcuts, 'open-command-search', t.unbound)
  const regroupShortcutLabel = getShortcutLabel(shortcuts, 'regroup-current-window', t.unbound)
  const deduplicateShortcutLabel = getShortcutLabel(shortcuts, 'deduplicate-tabs', t.unbound)

  return (
    <main
      data-density={preferences.uiDensity}
      className="options-surface min-h-screen min-w-[1120px] bg-[radial-gradient(circle_at_8%_0%,rgba(34,211,238,.14),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(139,92,246,.2),transparent_30%),#09090b] text-zinc-100 light:bg-[radial-gradient(circle_at_8%_0%,rgba(14,165,233,.12),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(139,92,246,.14),transparent_30%),#f8fafc]"
    >
      <header className="border-b border-white/10 px-[var(--opt-page-x)] py-[var(--opt-head-y)]">
        <div className="mx-auto flex min-w-[1120px] max-w-[1440px] flex-col gap-[var(--opt-head-gap)] 2xl:max-w-[1680px]">
          <div className="flex items-center justify-between gap-6">
            <div className="text-xs font-semibold uppercase tracking-[0.32em] text-violet-300">TabWeave</div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex rounded-xl bg-zinc-900/70 p-1 ring-1 ring-white/10" aria-label="Theme">
                {THEME_ICON_OPTIONS.map((option) => {
                  const label = option.value === 'dark' ? t.themeDark : option.value === 'light' ? t.themeLight : t.themeSystem
                  return (
                    <Tooltip key={option.value} content={label} delay={240}>
                      <button
                        type="button"
                        aria-label={label}
                        aria-pressed={preferences.themeMode === option.value}
                        onClick={() => updatePreferences({ themeMode: option.value })}
                        className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-semibold transition ${
                          preferences.themeMode === option.value
                            ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/20'
                            : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
                        }`}
                      >
                        <ThemeIcon mode={option.value} />
                        <span className="sr-only">{label}</span>
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
              <div className="flex rounded-xl bg-zinc-900/70 p-1 ring-1 ring-white/10" aria-label="Language">
                {LANGUAGE_OPTIONS.map((option) => {
                  const label = option.value === 'system' ? t.languageSystem : option.value === 'zh' ? t.languageZh : t.languageEn
                  return (
                    <Tooltip key={option.value} content={label} delay={240}>
                      <button
                        type="button"
                        aria-label={label}
                        aria-pressed={preferences.languageMode === option.value}
                        onClick={() => updatePreferences({ languageMode: option.value })}
                        className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-semibold transition ${
                          preferences.languageMode === option.value
                            ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/20'
                            : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
              <div className="flex rounded-xl bg-zinc-900/70 p-1 ring-1 ring-white/10" aria-label={t.uiDensity}>
                {UI_DENSITY_OPTIONS.map((option) => {
                  const label = option.value === 'compact' ? t.uiDensityCompact : t.uiDensityDefault
                  return (
                    <Tooltip key={option.value} content={label} delay={240}>
                      <button
                        type="button"
                        aria-label={label}
                        aria-pressed={preferences.uiDensity === option.value}
                        onClick={() => updatePreferences({ uiDensity: option.value })}
                        className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-semibold transition ${
                          preferences.uiDensity === option.value
                            ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/20'
                            : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
                        }`}
                      >
                        <DensityIcon density={option.value} />
                        <span className="sr-only">{label}</span>
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-[length:var(--opt-title)] font-semibold leading-[var(--opt-title-lh)] tracking-[-0.06em]">{t.appTagline}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{t.appDescription}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={exportRules} className={HEADER_ACTION_CLASS}>{t.export}</button>
              <button type="button" onClick={() => importInputRef.current?.click()} className={HEADER_ACTION_CLASS}>{t.import}</button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void file.text().then(importRules)
                }}
              />
              <AnimatePresence initial={false}>
                {!preferences.deduplicateOnOrganize && (
                  <motion.div
                    key="deduplicate-now"
                    layout
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    <button type="button" onClick={deduplicateNow} className={`${HEADER_ACTION_CLASS} whitespace-nowrap`}>{t.deduplicateNow}</button>
                  </motion.div>
                )}
              </AnimatePresence>
              <button type="button" onClick={hibernateNow} className={`${HEADER_ACTION_CLASS} whitespace-nowrap`}>{t.hibernateNow}</button>
              <motion.div layout transition={{ type: 'spring', duration: 0.34, bounce: 0 }}>
                <PrimaryButton
                  onClick={regroupNow}
                  className={`min-h-[var(--opt-header-button-min)] min-w-max whitespace-nowrap px-[var(--opt-header-button-x)] text-[length:var(--opt-header-button-text)] transition-[box-shadow,transform] ${
                    preferences.deduplicateOnOrganize ? 'shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-300/40' : ''
                  }`}
                >
                  {regroupLabel}
                </PrimaryButton>
              </motion.div>
            </div>
          </div>
        </div>
      </header>

      <SaveToastViewport toasts={saveToasts} />

      <div className="mx-auto grid w-full min-w-[1120px] max-w-[1440px] grid-cols-[300px_minmax(320px,1fr)_350px] items-start gap-[var(--opt-gap)] px-[var(--opt-page-x)] pb-28 pt-[var(--opt-top)] 2xl:max-w-[1680px] 2xl:grid-cols-[300px_minmax(480px,1fr)_350px_350px]">
        <aside className="flex flex-col gap-[var(--opt-side-gap)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Rules</h2>
              <p className="mt-1 text-[11px] text-zinc-600">{t.dragHint}</p>
            </div>
            <PrimaryButton onClick={addRule} className={SMALL_ACTION_CLASS}>{t.add}</PrimaryButton>
          </div>
          <div className="space-y-2">
            <TextInput
              value={ruleQuery}
              onChange={(event) => setRuleQuery(event.target.value)}
              placeholder={t.searchRules}
              className="h-9 text-xs"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectVisibleRules}
                disabled={visibleRuleIds.length === 0}
                className="rounded-lg bg-zinc-900/70 px-2 py-1 text-xs text-zinc-400 ring-1 ring-white/10 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {allVisibleRulesSelected ? t.clearVisibleRules : t.selectVisibleRules}
              </button>
              <button
                type="button"
                onClick={invertVisibleRuleSelection}
                disabled={visibleRuleIds.length === 0}
                className="rounded-lg bg-zinc-900/70 px-2 py-1 text-xs text-zinc-400 ring-1 ring-white/10 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.invertSelection}
              </button>
              <button
                type="button"
                onClick={requestBulkDelete}
                disabled={liveSelectedRuleIds.length === 0}
                className="rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-300 ring-1 ring-red-400/20 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.deleteSelected.replace('{count}', String(liveSelectedRuleIds.length))}
              </button>
            </div>
            <div className="text-[11px] text-zinc-600">
              {ruleStatsText}
            </div>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={ruleCollisionDetection}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragStart={handleRuleDragStart}
            onDragOver={handleRuleDragOver}
            onDragEnd={(event) => void handleRuleDragEnd(event)}
            onDragCancel={() => {
              lastOverRuleIdRef.current = null
              draggingRuleIdRef.current = null
              setDraggingRuleId(null)
            }}
          >
            <SortableContext items={visibleRuleIds} strategy={verticalListSortingStrategy}>
              <ol className="-m-1 space-y-2 p-1">
                {filteredRules.map((rule) => (
                  <SortableRuleCard
                    key={rule.id}
                    rule={rule}
                    selected={selectedRule?.id === rule.id}
                    ruleSelected={selectedRuleIds.includes(rule.id)}
                    dragging={draggingRuleId === rule.id}
                    dragHint={t.dragHint}
                    disabledLabel={t.disabled}
                    selectRuleLabel={t.selectRule.replace('{name}', rule.name)}
                    deleteRuleLabel={t.delete}
                    deleteRuleNamedLabel={t.deleteRuleNamed.replace('{name}', rule.name)}
                    onSelect={() => setSelectedId(rule.id)}
                    onToggleSelection={(checked) => toggleRuleSelection(rule.id, checked)}
                    onDelete={() => setConfirmAction({ type: 'delete', rule })}
                  />
                ))}
                {filteredRules.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-zinc-600">
                    {t.noRulesMatched}
                  </div>
                )}
              </ol>
            </SortableContext>
          </DndContext>
        </aside>

        <div className="p-1">
          <section className="rounded-[var(--opt-editor-r)] bg-zinc-950/70 p-[var(--opt-editor-pad)] ring-1 ring-white/10 backdrop-blur">
          {selectedRule ? (
            <div className="space-y-[var(--opt-editor-gap)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.04em]">{selectedRule.name}</h2>
                  <p className="mt-1 text-sm text-zinc-500">{t.ruleEditorDesc}</p>
                </div>
                <Switch checked={selectedRule.enabled} onChange={(checked) => updateRule(selectedRule.id, { enabled: checked })} />
              </div>

              <div className="grid grid-cols-2 gap-[var(--opt-gap)]">
                <div className="space-y-2">
                  <FieldLabel>{t.ruleName}</FieldLabel>
                  <TextInput value={selectedRule.name} onChange={(e) => updateRule(selectedRule.id, { name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <FieldLabel>{t.targetGroup}</FieldLabel>
                  <TextInput value={selectedRule.groupTitle} onChange={(e) => updateRule(selectedRule.id, { groupTitle: e.target.value })} />
                </div>
                <div className="col-span-2 space-y-2">
                  <FieldLabel>{t.ruleMinTabs}</FieldLabel>
                  <TextInput
                    type="number"
                    min={1}
                    step={1}
                    value={ruleMinTabsDrafts[selectedRule.id] ?? selectedRule.minTabs ?? ''}
                    onChange={(event) => setRuleMinTabsDrafts((current) => ({ ...current, [selectedRule.id]: event.target.value }))}
                    onBlur={(event) => commitRuleMinTabs(selectedRule, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') resetRuleMinTabsDraft(selectedRule)
                    }}
                    placeholder={t.ruleMinTabsPlaceholder.replace('{count}', String(preferences.groupMinTabs))}
                  />
                  <div className="text-xs leading-5 text-zinc-600">{t.ruleMinTabsDesc}</div>
                </div>
                <div className="col-span-2 space-y-2">
                  <FieldLabel>{t.color}</FieldLabel>
                  <div className="grid grid-cols-9 gap-2">
                    {GROUP_COLORS.map((color) => {
                      const selected = selectedRule.color === color
                      return (
                        <button
                          key={color}
                          onClick={() => updateRule(selectedRule.id, { color })}
                          className={`relative h-8 w-full rounded-xl ${COLOR_CLASS[color]} transition duration-200 hover:scale-[1.03] ${
                            selected ? 'scale-[1.03] ring-4 ring-white/35 shadow-lg shadow-black/20' : 'ring-1 ring-white/10'
                          }`}
                          title={color}
                        >
                          {selected && (
                            <span className="absolute inset-0 grid place-items-center text-white drop-shadow">
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m5 13 4 4L19 7" />
                              </svg>
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="col-span-2 space-y-3">
                  <div className="flex items-center justify-between">
                    <FieldLabel>{t.conditions}</FieldLabel>
                    <GhostButton onClick={() => addCondition(selectedRule)} className="px-2 py-1 text-xs">{t.addCondition}</GhostButton>
                  </div>
                  {getRuleConditions(selectedRule).map((condition, index) => (
                    <div key={condition.id} className="rounded-2xl bg-white/[0.035] p-[var(--opt-nested-pad)] ring-1 ring-white/10">
                      <div className="mb-[var(--opt-inner-gap)] flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-zinc-500">#{index + 1}</span>
                        {getRuleConditions(selectedRule).length > 1 && (
                          <button onClick={() => removeCondition(selectedRule, condition.id)} className="text-xs text-zinc-500 hover:text-red-300">×</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-[var(--opt-field-gap)]">
                        <div className="space-y-2">
                          <FieldLabel>{t.matchTarget}</FieldLabel>
                          <AnchorSelect value={condition.target} options={targetOptions} onChange={(target) => updateCondition(selectedRule, condition.id, { target })} />
                        </div>
                        <div className="space-y-2">
                          <FieldLabel>{t.matchMode}</FieldLabel>
                          <AnchorSelect value={condition.mode} options={modeOptions} onChange={(mode) => updateCondition(selectedRule, condition.id, { mode })} />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <FieldLabel>{t.matchPattern}</FieldLabel>
                          <TextArea rows={3} value={condition.pattern} onChange={(e) => updateCondition(selectedRule, condition.id, { pattern: e.target.value })} placeholder={condition.mode === 'regex' ? `github\\.com
(codebase|docs)` : `github.com
codebase.anyask.dev`} />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="text-xs leading-5 text-zinc-600">{t.patternHint}</div>
                  {regexInvalid && <div className="text-xs text-red-300">{t.invalidRegex}</div>}
                </div>
              </div>

              <div className="rounded-2xl bg-white/[0.035] p-[var(--opt-card-pad)] ring-1 ring-white/10">
                <div className="mb-[var(--opt-inner-gap)] flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t.matchTest}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${
                    sampleInput && sampleMatched && !regexInvalid
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : sampleInput
                        ? 'bg-zinc-800 text-zinc-500'
                        : 'bg-white/[0.05] text-zinc-600'
                  }`}>
                    {sampleInput ? (sampleMatched && !regexInvalid ? t.matched : t.notMatched) : t.matchTestIdle}
                  </span>
                </div>
                <TextArea rows={2} value={sample} onChange={(e) => setSample(e.target.value)} placeholder={t.matchTestPlaceholder} />
                {sampleInput && sampleMatched && !regexInvalid && (
                  <div className="mt-2 text-xs text-zinc-600">
                    {t.matchedCondition.replace('{index}', String(sampleMatchedConditionIndex + 1))}
                  </div>
                )}
              </div>

              <div className="flex justify-start border-t border-white/10 pt-[var(--opt-footer-gap)]">
                <div className="flex gap-2">
                  <GhostButton onClick={() => duplicateRule(selectedRule)}>{t.copyRule}</GhostButton>
                  <DangerButton onClick={() => setConfirmAction({ type: 'delete', rule: selectedRule })}>{t.deleteRule}</DangerButton>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">{t.emptyRule}</div>
          )}
          </section>
        </div>

        <div className="settings-side-stack col-start-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(350px,1fr))] gap-[var(--opt-gap)] 2xl:contents">
        <aside className="min-w-0 space-y-[var(--opt-gap)] 2xl:col-start-3 2xl:p-1">
          <section className="rounded-[var(--opt-card-r)] bg-white/[0.04] p-[var(--opt-card-pad)] ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.automation}</h2>
            <div className="mt-[var(--opt-section-gap)] space-y-[var(--opt-section-gap)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.onCreate}</div>
                  <div className="text-xs text-zinc-600">{t.onCreateDesc}</div>
                </div>
                <Switch checked={preferences.autoGroupOnCreate} onChange={(checked) => updatePreferences({ autoGroupOnCreate: checked })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.onUpdate}</div>
                  <div className="text-xs text-zinc-600">{t.onUpdateDesc}</div>
                </div>
                <Switch checked={preferences.autoGroupOnUpdate} onChange={(checked) => updatePreferences({ autoGroupOnUpdate: checked })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.autoDeduplicate}</div>
                  <div className="text-xs text-zinc-600">{t.autoDeduplicateDesc}</div>
                </div>
                <Switch checked={preferences.autoDeduplicateTabs} onChange={(checked) => updatePreferences({ autoDeduplicateTabs: checked })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.deduplicateOnOrganize}</div>
                  <div className="text-xs text-zinc-600">{t.deduplicateOnOrganizeDesc}</div>
                </div>
                <Switch checked={preferences.deduplicateOnOrganize} onChange={(checked) => updatePreferences({ deduplicateOnOrganize: checked })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.openInSidePanel}</div>
                  <div className="text-xs text-zinc-600">{t.openInSidePanelDesc}</div>
                </div>
                <Switch checked={preferences.openInSidePanel} onChange={(checked) => updatePreferences({ openInSidePanel: checked })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.syncRules}</div>
                  <div className="text-xs text-zinc-600">{t.syncRulesDesc}</div>
                </div>
                <Switch checked={preferences.syncRules} onChange={(checked) => updatePreferences({ syncRules: checked })} />
              </div>
            </div>
          </section>

          <section className="rounded-[var(--opt-card-r)] bg-white/[0.04] p-[var(--opt-card-pad)] ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.groupingBehavior}</h2>
            <div className="mt-[var(--opt-section-gap)] space-y-[var(--opt-section-gap)]">
              <div className="space-y-2">
                <FieldLabel>{t.groupMinTabs}</FieldLabel>
                <TextInput
                  type="number"
                  min={1}
                  step={1}
                  value={groupMinTabsDraft}
                  onChange={(event) => setGroupMinTabsDraft(event.target.value)}
                  onBlur={(event) => commitGroupMinTabs(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <div className="text-xs leading-5 text-zinc-600">{t.groupMinTabsDesc}</div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.domainFallbackGrouping}</div>
                  <div className="text-xs text-zinc-600">{t.domainFallbackGroupingDesc}</div>
                </div>
                <Switch checked={preferences.domainFallbackGrouping} onChange={(checked) => updatePreferences({ domainFallbackGrouping: checked })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.autoCollapseGroups}</div>
                  <div className="text-xs text-zinc-600">{t.autoCollapseGroupsDesc}</div>
                </div>
                <Switch checked={preferences.autoCollapseGroups} onChange={(checked) => updatePreferences({ autoCollapseGroups: checked })} />
              </div>
            </div>
          </section>

          <section className="rounded-[var(--opt-card-r)] bg-white/[0.04] p-[var(--opt-card-pad)] ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.aiGrouping}</h2>
            <div className="mt-[var(--opt-section-gap)] space-y-[var(--opt-section-gap)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.aiGroupingEnabled}</div>
                  <div className="text-xs text-zinc-600">{t.aiGroupingEnabledDesc}</div>
                </div>
                <Switch checked={aiGroupingSettings.enabled} onChange={(enabled) => updateAiGroupingSettings({ enabled })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.aiIncludeGrouped}</div>
                  <div className="text-xs text-zinc-600">{t.aiIncludeGroupedDesc}</div>
                </div>
                <Switch checked={aiGroupingSettings.includeGroupedTabs} onChange={(includeGroupedTabs) => updateAiGroupingSettings({ includeGroupedTabs })} />
              </div>
              <AnimatePresence initial={false}>
                {aiGroupingSettings.enabled && (
                  <motion.div
                    key="ai-grouping-settings"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-[var(--opt-section-gap)] px-1 pb-1 pt-1">
                      <div className="space-y-2">
                        <FieldLabel>{t.aiProvider}</FieldLabel>
                        <AnchorSelect value={aiGroupingSettings.provider} options={aiProviderOptions} onChange={(provider) => updateAiGroupingSettings({ provider })} />
                      </div>
                      {aiGroupingSettings.provider === 'chromeBuiltIn' && (
                        <div className="rounded-lg bg-violet-500/10 px-3 py-2 text-xs leading-5 text-violet-100 ring-1 ring-violet-400/20">
                          {t.aiChromeBuiltInDesc}
                        </div>
                      )}
                      <AnimatePresence initial={false}>
                        {aiGroupingSettings.provider === 'compatible' && (
                          <motion.div
                            key="ai-compatible-base-url"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ type: 'spring', duration: 0.28, bounce: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-2 px-1 pb-1">
                              <FieldLabel>{t.aiBaseUrl}</FieldLabel>
                              <TextInput value={aiGroupingSettings.baseUrl} onChange={(event) => updateAiGroupingSettings({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      {aiGroupingSettings.provider !== 'chromeBuiltIn' && (
                        <>
                          <div className="space-y-2">
                            <FieldLabel>{t.aiModel}</FieldLabel>
                            <TextInput value={aiGroupingSettings.model} onChange={(event) => updateAiGroupingSettings({ model: event.target.value })} placeholder={aiGroupingSettings.provider === 'openrouter' ? OPENROUTER_AI_GROUPING_MODEL_PLACEHOLDER : aiGroupingSettings.provider === 'gemini' ? DEFAULT_GEMINI_AI_GROUPING_MODEL : 'gpt-4.1-mini'} />
                          </div>
                          <div className="space-y-2">
                            <FieldLabel>{t.aiApiKey}</FieldLabel>
                            <div className="relative">
                              <TextInput
                                type={showAiApiKey ? 'text' : 'password'}
                                value={aiGroupingSettings.apiKey}
                                onChange={(event) => updateAiGroupingSettings({ apiKey: event.target.value })}
                                placeholder="sk-..."
                                className={aiApiKeyCount > 1 ? 'pr-32' : 'pr-12'}
                              />
                              {aiApiKeyCount > 1 && (
                                <span className="pointer-events-none absolute right-11 top-1/2 -translate-y-1/2 rounded-full bg-violet-500/12 px-2 py-0.5 text-[11px] font-medium text-violet-300 ring-1 ring-violet-400/20">
                                  {t.aiApiKeyCount.replace('{count}', String(aiApiKeyCount))}
                                </span>
                              )}
                              <span className="absolute right-2 top-1/2 -translate-y-1/2">
                                <Tooltip content={showAiApiKey ? t.aiApiKeyHide : t.aiApiKeyShow} delay={240}>
                                  <button
                                    type="button"
                                    aria-label={showAiApiKey ? t.aiApiKeyHide : t.aiApiKeyShow}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => setShowAiApiKey((visible) => !visible)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 outline-none transition hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-zinc-500/20"
                                  >
                                    <EyeIcon crossed={showAiApiKey} />
                                  </button>
                                </Tooltip>
                              </span>
                            </div>
                            <div className="text-xs leading-5 text-zinc-600">{t.aiApiKeyDesc}</div>
                          </div>
                        </>
                      )}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <FieldLabel>{t.aiPrompt}</FieldLabel>
                          <button type="button" onClick={openAiPromptEditor} className="rounded-lg px-2 py-1 text-xs font-medium text-violet-300 transition hover:bg-violet-500/10 hover:text-violet-200">
                            {t.aiPromptEdit}
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={openAiPromptEditor}
                          className="w-full rounded-2xl bg-zinc-950/70 px-3 py-2.5 text-left ring-1 ring-white/10 transition hover:bg-zinc-900 focus:outline-none focus:ring-4 focus:ring-violet-500/10"
                        >
                          <span className="two-line-clamp text-xs leading-5 text-zinc-600">{aiPromptPreview}</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>


        </aside>

        <aside className="min-w-0 space-y-[var(--opt-gap)] 2xl:col-start-4 2xl:p-1">
          <section className="rounded-[var(--opt-card-r)] bg-white/[0.04] p-[var(--opt-card-pad)] ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.hibernation}</h2>
            <div className="mt-[var(--opt-section-gap)] space-y-[var(--opt-section-gap)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.autoHibernate}</div>
                  <div className="text-xs text-zinc-600">{t.autoHibernateDesc}</div>
                </div>
                <Switch checked={preferences.autoHibernateTabs} onChange={(checked) => updatePreferences({ autoHibernateTabs: checked })} />
              </div>
              <div className="space-y-2">
                <FieldLabel>{t.hibernateAfter}</FieldLabel>
                <TextInput
                  type="number"
                  min={1}
                  step={1}
                  value={hibernateAfterDraft}
                  onChange={(event) => setHibernateAfterDraft(event.target.value)}
                  onBlur={(event) => commitHibernateAfter(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <div className="text-xs leading-5 text-zinc-600">{t.hibernateAfterDesc}</div>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.protectMediaTabs}</div>
                  <div className="text-xs text-zinc-600">{t.protectMediaTabsDesc}</div>
                </div>
                <Switch checked={preferences.hibernateProtectMedia} onChange={(checked) => updatePreferences({ hibernateProtectMedia: checked })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.protectCollaborationTabs}</div>
                  <div className="text-xs text-zinc-600">{t.protectCollaborationTabsDesc}</div>
                </div>
                <Switch checked={preferences.hibernateProtectCollaboration} onChange={(checked) => updatePreferences({ hibernateProtectCollaboration: checked })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.hibernateOnOrganize}</div>
                  <div className="text-xs text-zinc-600">{t.hibernateOnOrganizeDesc}</div>
                </div>
                <Switch checked={preferences.hibernateOnOrganize} onChange={(checked) => updatePreferences({ hibernateOnOrganize: checked })} />
              </div>
              <div className="space-y-2">
                <FieldLabel>{t.hibernateWhitelist}</FieldLabel>
                <TextArea
                  rows={4}
                  value={preferences.hibernateWhitelist}
                  onChange={(event) => updatePreferences({ hibernateWhitelist: event.target.value })}
                  placeholder={`domain:docs.google.com\nurl:/checkout\nregex:meeting|upload`}
                />
                <div className="text-xs leading-5 text-zinc-600">{t.hibernateWhitelistDesc}</div>
              </div>
            </div>
          </section>

          <section className="rounded-[var(--opt-card-r)] bg-white/[0.04] p-[var(--opt-card-pad)] ring-1 ring-white/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">{t.maintenance}</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-600">{t.resetDesc}</p>
              </div>
              <DangerButton onClick={() => setConfirmAction({ type: 'reset' })} className="shrink-0 px-2 py-1 text-xs">{t.reset}</DangerButton>
            </div>
          </section>

          <section className="rounded-[var(--opt-card-r)] bg-white/[0.04] p-[var(--opt-card-pad)] ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.shortcuts}</h2>
            <div className="mt-[var(--opt-section-gap-sm)] space-y-2 text-sm leading-6 text-zinc-500">
              <div className="flex justify-between gap-3"><span>{preferences.openInSidePanel ? t.openSidePanel : t.openPopup}</span><span className="text-zinc-300">{openPopupShortcutLabel}</span></div>
              <div className="flex justify-between gap-3"><span>{t.commandSearch}</span><span className="text-zinc-300">{commandSearchShortcutLabel}</span></div>
              <div className="flex justify-between gap-3"><span>{t.organizeNow}</span><span className="text-zinc-300">{regroupShortcutLabel}</span></div>
              <div className="flex justify-between gap-3"><span>{t.deduplicateTabs}</span><span className="text-zinc-300">{deduplicateShortcutLabel}</span></div>
              <p className="text-xs leading-5 text-zinc-600">
                {t.shortcutHelp}{' '}
                <button type="button" onClick={openShortcutSettings} className="font-medium text-violet-300 underline decoration-violet-400/30 underline-offset-4 hover:text-violet-200">
                  chrome://extensions/shortcuts
                </button>{' '}

              </p>
            </div>
          </section>

          <section className="rounded-[var(--opt-card-r)] bg-white/[0.04] p-[var(--opt-card-pad)] ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.policy}</h2>
            <ul className="mt-[var(--opt-section-gap-sm)] space-y-2 text-sm leading-6 text-zinc-500">
              {t.policyItems.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/70 ring-4 ring-violet-400/10" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[var(--opt-card-r)] bg-white/[0.04] p-[var(--opt-card-pad)] ring-1 ring-white/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">{t.about}</h2>
                <p className="mt-1 text-xs text-zinc-600">
                  {t.version}{' '}
                  <button
                    type="button"
                    onClick={() => openExternalUrl(CHROME_WEB_STORE_URL)}
                    className="font-medium text-zinc-500 underline decoration-zinc-700/60 underline-offset-4 transition hover:text-violet-300 hover:decoration-violet-400/40"
                  >
                    v{extensionVersion}
                  </button>
                </p>
              </div>
              <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300">Open Source</span>
            </div>
            <div className="mt-[var(--opt-section-gap)] grid grid-cols-2 gap-[var(--opt-action-gap)]">
              <GhostButton onClick={() => openExternalUrl(GITHUB_REPO_URL)} className="px-2 py-2 text-xs">{t.repo}</GhostButton>
              <GhostButton onClick={() => openExternalUrl(GITHUB_ISSUES_URL)} className="px-2 py-2 text-xs">{t.feedback}</GhostButton>
            </div>
          </section>

        </aside>
        </div>
      </div>

      {status && (
        <div className="fixed bottom-5 right-5 z-40 max-w-sm rounded-2xl bg-zinc-950/95 px-4 py-3 text-sm text-zinc-100 shadow-2xl shadow-black/30 ring-1 ring-white/10 backdrop-blur light:bg-white/96 light:text-zinc-900 light:shadow-[0_18px_45px_rgba(148,163,184,.28)] light:ring-zinc-900/10">
          {status}
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] bg-zinc-950 p-5 text-zinc-100 shadow-2xl shadow-black/50 ring-1 ring-white/10">
            <div className="flex items-start gap-3">
              <div className="mt-1 shrink-0 text-red-300">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-[-0.03em]">
                  {confirmAction.type === 'reset'
                    ? t.confirmResetTitle
                    : confirmAction.type === 'import'
                      ? t.confirmImportTitle
                    : confirmAction.type === 'deleteMany'
                      ? t.confirmBulkDeleteTitle.replace('{count}', String(confirmAction.rules.length))
                      : t.confirmDeleteTitle}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {confirmAction.type === 'reset'
                    ? t.confirmResetBody
                    : confirmAction.type === 'import'
                      ? t.confirmImportBody.replace('{count}', String(confirmAction.rules.length))
                    : confirmAction.type === 'deleteMany'
                      ? t.confirmBulkDeleteBody.replace('{count}', String(confirmAction.rules.length))
                      : t.confirmDeleteBody.replace('{name}', confirmAction.rule.name)}
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <GhostButton onClick={() => setConfirmAction(null)}>{t.cancel}</GhostButton>
              <DangerButton onClick={confirmDangerAction}>
                {confirmAction.type === 'reset' ? t.reset : confirmAction.type === 'import' ? t.confirmImportButton : t.deleteRule}
              </DangerButton>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {aiPromptEditorOpen && (
          <motion.div
            key="ai-prompt-editor"
            className="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setAiPromptEditorOpen(false)}
          >
            <motion.div
              className="w-full max-w-2xl rounded-[28px] bg-zinc-950 p-5 text-zinc-100 shadow-2xl shadow-black/50 ring-1 ring-white/10"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.97 }}
              transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-[-0.03em]">{t.aiPromptTitle}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">{t.aiPromptDesc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAiPromptEditorOpen(false)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                  aria-label={t.close}
                >
                  <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div className="mt-5 space-y-2">
                <FieldLabel>{t.aiPrompt}</FieldLabel>
                <AiPromptTextArea
                  value={aiPromptDraft}
                  variables={aiPromptVariables}
                  onChange={setAiPromptDraft}
                  placeholder={getDefaultAiGroupingPrompt(resolveLanguage(preferences.languageMode))}
                />
              </div>
              <div className="mt-5 flex items-center justify-between gap-3">
                <GhostButton onClick={resetAiPromptEditor} className="px-3 py-2 text-xs">{t.aiPromptReset}</GhostButton>
                <div className="flex items-center gap-2">
                  <GhostButton onClick={() => setAiPromptEditorOpen(false)}>{t.cancel}</GhostButton>
                  <PrimaryButton onClick={saveAiPromptEditor}>{t.save}</PrimaryButton>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
)
