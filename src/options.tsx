import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import { closestCenter, DndContext, PointerSensor, pointerWithin, useSensor, useSensors } from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import './index.css'
import { COLOR_CLASS, DEFAULT_GROUP_MIN_TABS, DEFAULT_HIBERNATE_AFTER_MINUTES, GROUP_COLORS, STORAGE_KEYS } from './lib/constants'
import { getPreferences, getRules, resetRules, savePreferences, saveRules } from './lib/storage'
import { applyTheme } from './lib/theme'
import { formatShortcut, isMacPlatform } from './lib/shortcuts'
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
import type { AutoGroupRule, LanguageMode, MatchMode, MatchTarget, Preferences, RuleCondition, RuleScope, ThemeMode } from './lib/types'
import { AnchorSelect, DangerButton, FieldLabel, GhostButton, PrimaryButton, Switch, TextArea, TextInput } from './components/ui'
import { getMessages } from './lib/i18n'

const now = () => Date.now()

const HEADER_ACTION_CLASS = 'inline-flex h-9 appearance-none items-center justify-center rounded-xl bg-zinc-900/70 px-3 font-sans text-sm font-medium leading-none text-zinc-200 antialiased ring-1 ring-white/10 transition hover:bg-zinc-800 active:scale-[.98]'

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
      className="theme-light-save-toast inline-flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full bg-zinc-950/92 px-5 py-3 text-sm font-semibold text-zinc-100 shadow-[0_18px_50px_rgba(0,0,0,0.35)] ring-1 ring-white/12 backdrop-blur-xl"
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
      className={`group relative list-none select-none rounded-2xl ring-1 transition-colors ${
        selected ? 'bg-white/[0.08] ring-violet-400/40' : 'bg-white/[0.035] ring-white/10 hover:bg-white/[0.06]'
      } ${dragging || isDragging ? 'z-30 cursor-grabbing opacity-80 shadow-2xl shadow-black/30 ring-violet-300/70' : 'cursor-grab'}`}
      title={dragHint}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
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
    autoGroupOnCreate: true,
    autoGroupOnUpdate: true,
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
    themeMode: 'system',
    languageMode: 'system',
  })
  const [selectedId, setSelectedId] = useState<string>('')
  const [sample, setSample] = useState('')
  const [status, setStatus] = useState('')
  const [saveToasts, setSaveToasts] = useState<SaveToast[]>([])
  const saveToastIdRef = useRef(0)
  const rulesSaveRef = useRef(createDebouncedSaveBucket<void>())
  const preferencesSaveRef = useRef(createDebouncedSaveBucket<void>())
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

  const reloadStoredState = useCallback(async () => {
    const [loadedRules, loadedPreferences] = await Promise.all([getRules(), getPreferences()])
    applyTheme(loadedPreferences.themeMode)
    setRules(loadedRules)
    setPreferences(loadedPreferences)
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

  const duplicateScopeOptions: { value: RuleScope; label: string; description: string }[] = [
    { value: 'currentWindow', label: t.duplicateCurrentWindow, description: t.duplicateCurrentWindowDesc },
    { value: 'allWindows', label: t.duplicateAllWindows, description: t.duplicateAllWindowsDesc },
  ]

  const hibernateScopeOptions: { value: RuleScope; label: string; description: string }[] = [
    { value: 'currentWindow', label: t.hibernateCurrentWindow, description: t.hibernateCurrentWindowDesc },
    { value: 'allWindows', label: t.hibernateAllWindows, description: t.hibernateAllWindowsDesc },
  ]

  const organizeScopeOptions: { value: RuleScope; label: string; description: string }[] = [
    { value: 'currentWindow', label: t.organizeCurrentWindow, description: t.organizeCurrentWindowDesc },
    { value: 'allWindows', label: t.organizeAllWindows, description: t.organizeAllWindowsDesc },
  ]

  useEffect(() => {
    rulesOrderRef.current = rules
  }, [rules])

  useEffect(() => {
    draggingRuleIdRef.current = draggingRuleId
  }, [draggingRuleId])

  useEffect(() => {
    void (async () => {
      const [loadedRules, loadedPreferences] = await Promise.all([getRules(), getPreferences()])
      applyTheme(loadedPreferences.themeMode)
      setRules(loadedRules)
      setPreferences(loadedPreferences)
      setGroupMinTabsDraft(String(loadedPreferences.groupMinTabs))
      setHibernateAfterDraft(String(loadedPreferences.hibernateAfterMinutes))
      setSelectedId(loadedRules[0]?.id ?? '')
    })()
  }, [])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    const handleStorageChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (draggingRuleIdRef.current) return
      if (changes[STORAGE_KEYS.rules] || changes[STORAGE_KEYS.preferences]) {
        void reloadStoredState()
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => chrome.storage.onChanged.removeListener(handleStorageChanged)
  }, [reloadStoredState])

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

  async function updateRule(id: string, patch: Partial<AutoGroupRule>) {
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
    if (!trimmed) {
      await updateRule(rule.id, { minTabs: undefined })
      return
    }
    const parsed = Number.parseInt(trimmed, 10)
    const minTabs = Number.isFinite(parsed) ? Math.max(1, parsed) : undefined
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
    const next = { ...preferences, ...patch }
    setPreferences(next)
    if (typeof patch.groupMinTabs === 'number') setGroupMinTabsDraft(String(patch.groupMinTabs))
    if (typeof patch.hibernateAfterMinutes === 'number') setHibernateAfterDraft(String(patch.hibernateAfterMinutes))
    if (patch.themeMode) applyTheme(patch.themeMode)
    await debounceSave(preferencesSaveRef.current, () => savePreferences(next))
    if (typeof patch.syncRules === 'boolean') {
      await debounceSave(rulesSaveRef.current, () => saveRules(rules))
    }
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
    setStatus(formatOrganizeStatus(response, preferences.organizeScope))
  }

  function formatOrganizeStatus(
    response: { ok?: boolean; checked?: number; changed?: number; deduplicated?: { closed: number }; hibernated?: { discarded: number }; error?: string },
    organizeScope: RuleScope,
  ) {
    if (!response?.ok) return response?.error ?? t.failed
    const closed = response.deduplicated?.closed ?? 0
    const discarded = response.hibernated?.discarded ?? 0
    const checked = response.checked ?? 0
    const changed = response.changed ?? 0
    const isAllWindows = organizeScope === 'allWindows'
    if (discarded > 0) {
      return t.organizedWithCleanup
        .replace('{closed}', String(closed))
        .replace('{discarded}', String(discarded))
        .replace('{checked}', String(checked))
        .replace('{changed}', String(changed))
    }
    if (closed > 0) {
      return (isAllWindows ? t.organizedAllWindowsWithDeduplication : t.organizedWithDeduplication)
        .replace('{closed}', String(closed))
        .replace('{checked}', String(checked))
        .replace('{changed}', String(changed))
    }
    return (isAllWindows ? t.organizedAllWindows : t.organized)
      .replace('{checked}', String(checked))
      .replace('{changed}', String(changed))
  }

  async function deduplicateNow() {
    if (typeof chrome === 'undefined' || !chrome.runtime) return
    const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_DEDUPLICATE', scope: preferences.duplicateScope })
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
    ? preferences.organizeScope === 'allWindows'
      ? t.regroupWithDeduplicationAllWindows
      : t.regroupWithDeduplicationWindow
    : preferences.organizeScope === 'allWindows'
      ? t.regroupAllWindows
      : t.regroupWindow
  const openPopupShortcutLabel = formatShortcut(isMacPlatform() ? 'Command+Shift+Y' : 'Ctrl+Shift+Y')
  const commandSearchShortcutLabel = formatShortcut(isMacPlatform() ? 'Command+Shift+K' : 'Ctrl+Shift+K')
  const regroupShortcutLabel = formatShortcut(isMacPlatform() ? 'Alt+Shift+G' : 'Ctrl+Shift+G')
  const deduplicateShortcutLabel = formatShortcut(isMacPlatform() ? 'Alt+Shift+D' : 'Ctrl+Shift+X')

  return (
    <main className="options-surface min-h-screen bg-[radial-gradient(circle_at_8%_0%,rgba(34,211,238,.14),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(139,92,246,.2),transparent_30%),#09090b] text-zinc-100">
      <header className="border-b border-white/10 px-8 py-6">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-4">
          <div className="flex items-center justify-between gap-6">
            <div className="text-xs font-semibold uppercase tracking-[0.32em] text-violet-300">TabWeave</div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex rounded-xl bg-zinc-900/70 p-1 ring-1 ring-white/10" aria-label="Theme">
                {THEME_ICON_OPTIONS.map((option) => {
                  const label = option.value === 'dark' ? t.themeDark : option.value === 'light' ? t.themeLight : t.themeSystem
                  return (
                    <button
                      key={option.value}
                      type="button"
                      title={label}
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
                  )
                })}
              </div>
              <div className="flex rounded-xl bg-zinc-900/70 p-1 ring-1 ring-white/10" aria-label="Language">
                {LANGUAGE_OPTIONS.map((option) => {
                  const label = option.value === 'system' ? t.languageSystem : option.value === 'zh' ? t.languageZh : t.languageEn
                  return (
                    <button
                      key={option.value}
                      type="button"
                      title={label}
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
                  )
                })}
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-4xl font-semibold tracking-[-0.06em]">{t.appTagline}</h1>
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
                  className={`h-9 min-w-max whitespace-nowrap transition-[box-shadow,transform] ${
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

      <div className="mx-auto grid w-full min-w-[1180px] max-w-[1680px] grid-cols-[300px_minmax(520px,1fr)_320px] items-start gap-4 px-8 py-5 2xl:grid-cols-[300px_minmax(520px,1fr)_300px_300px]">
        <aside className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Rules</h2>
              <p className="mt-1 text-[11px] text-zinc-600">{t.dragHint}</p>
            </div>
            <PrimaryButton onClick={addRule} className="px-2 py-1 text-xs">{t.add}</PrimaryButton>
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
          <section className="rounded-[28px] bg-zinc-950/70 p-6 ring-1 ring-white/10 backdrop-blur">
          {selectedRule ? (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-[-0.04em]">{selectedRule.name}</h2>
                  <p className="mt-1 text-sm text-zinc-500">{t.ruleEditorDesc}</p>
                </div>
                <Switch checked={selectedRule.enabled} onChange={(checked) => updateRule(selectedRule.id, { enabled: checked })} />
              </div>

              <div className="grid grid-cols-2 gap-4">
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
                    <div key={condition.id} className="rounded-2xl bg-white/[0.035] p-3 ring-1 ring-white/10">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-zinc-500">#{index + 1}</span>
                        {getRuleConditions(selectedRule).length > 1 && (
                          <button onClick={() => removeCondition(selectedRule, condition.id)} className="text-xs text-zinc-500 hover:text-red-300">×</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
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

              <div className="rounded-2xl bg-white/[0.035] p-4 ring-1 ring-white/10">
                <div className="mb-3 flex items-center justify-between">
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

              <div className="flex justify-start border-t border-white/10 pt-5">
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

        <div className="col-start-3 grid gap-4 p-1 2xl:contents">
        <aside className="space-y-4 2xl:col-start-3 2xl:p-1">
          <section className="rounded-[24px] bg-white/[0.04] p-4 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.automation}</h2>
            <div className="mt-4 space-y-4">
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
                  <div className="text-sm text-zinc-200">{t.onPopupOpen}</div>
                  <div className="text-xs text-zinc-600">{t.onPopupOpenDesc}</div>
                </div>
                <Switch checked={preferences.autoGroupOnPopupOpen} onChange={(checked) => updatePreferences({ autoGroupOnPopupOpen: checked })} />
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

          <section className="rounded-[24px] bg-white/[0.04] p-4 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.groupingBehavior}</h2>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <FieldLabel>{t.organizeScope}</FieldLabel>
                <AnchorSelect value={preferences.organizeScope} options={organizeScopeOptions} onChange={(organizeScope) => updatePreferences({ organizeScope })} />
              </div>
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

          <section className="rounded-[24px] bg-white/[0.04] p-4 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.duplicateCleanup}</h2>
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.autoDeduplicate}</div>
                  <div className="text-xs text-zinc-600">{t.autoDeduplicateDesc}</div>
                </div>
                <Switch checked={preferences.autoDeduplicateTabs} onChange={(checked) => updatePreferences({ autoDeduplicateTabs: checked })} />
              </div>
              <div className="space-y-2">
                <FieldLabel>{t.duplicateScope}</FieldLabel>
                <AnchorSelect value={preferences.duplicateScope} options={duplicateScopeOptions} onChange={(duplicateScope) => updatePreferences({ duplicateScope })} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm text-zinc-200">{t.deduplicateOnOrganize}</div>
                  <div className="text-xs text-zinc-600">{t.deduplicateOnOrganizeDesc}</div>
                </div>
                <Switch checked={preferences.deduplicateOnOrganize} onChange={(checked) => updatePreferences({ deduplicateOnOrganize: checked })} />
              </div>
            </div>
          </section>

        </aside>

        <aside className="space-y-4 2xl:col-start-4 2xl:p-1">
          <section className="rounded-[24px] bg-white/[0.04] p-4 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.hibernation}</h2>
            <div className="mt-4 space-y-4">
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
              <div className="space-y-2">
                <FieldLabel>{t.hibernateScope}</FieldLabel>
                <AnchorSelect value={preferences.hibernateScope} options={hibernateScopeOptions} onChange={(hibernateScope) => updatePreferences({ hibernateScope })} />
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

          <section className="rounded-[24px] bg-white/[0.04] p-5 ring-1 ring-white/10">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">{t.maintenance}</h2>
                <p className="mt-1 text-xs leading-5 text-zinc-600">{t.resetDesc}</p>
              </div>
              <DangerButton onClick={() => setConfirmAction({ type: 'reset' })} className="shrink-0 px-2 py-1 text-xs">{t.reset}</DangerButton>
            </div>
          </section>

          <section className="rounded-[24px] bg-white/[0.04] p-5 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.shortcuts}</h2>
            <div className="mt-3 space-y-2 text-sm leading-6 text-zinc-500">
              <div className="flex justify-between gap-3"><span>{t.openPopup}</span><span className="text-zinc-300">{openPopupShortcutLabel}</span></div>
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

          <section className="rounded-[24px] bg-white/[0.04] p-5 ring-1 ring-white/10">
            <h2 className="text-sm font-semibold">{t.policy}</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-500">
              {t.policyItems.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/70 ring-4 ring-violet-400/10" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[24px] bg-white/[0.04] p-5 ring-1 ring-white/10">
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
            <div className="mt-4 grid grid-cols-2 gap-2">
              <GhostButton onClick={() => openExternalUrl(GITHUB_REPO_URL)} className="px-2 py-2 text-xs">{t.repo}</GhostButton>
              <GhostButton onClick={() => openExternalUrl(GITHUB_ISSUES_URL)} className="px-2 py-2 text-xs">{t.feedback}</GhostButton>
            </div>
          </section>

        </aside>
        </div>
      </div>

      {status && (
        <div className="fixed bottom-5 right-5 z-40 max-w-sm rounded-2xl bg-zinc-950/95 px-4 py-3 text-sm text-zinc-100 shadow-2xl shadow-black/30 ring-1 ring-white/10 backdrop-blur theme-light-toast">
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
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
)
