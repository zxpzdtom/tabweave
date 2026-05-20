import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import { AppleIntelligenceGlow } from 'apple-intelligence-glow-react'
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import './index.css'
import { COLOR_CLASS, STORAGE_KEYS } from './lib/constants'
import { getPreferences, getRules, savePreferences } from './lib/storage'
import { applyTheme } from './lib/theme'
import { openExternalUrl } from './lib/links'
import { getMessages } from './lib/i18n'
import { buildSearchUrl, SEARCH_ENGINES } from './lib/search'
import {
  applyRulesToTabs,
  collapseGroupsByScope,
  consolidateDuplicateGroupsForTabs,
  createGroupFromTabs,
  getCurrentWindowSnapshot,
  queryTabsByScope,
} from './lib/grouping'
import type { AiGroupingPlan, GroupSnapshot, Preferences, SnoozeItem, TabSnapshot, WindowSnapshot } from './lib/types'
import { AnchorSelect, EmptyState, GhostButton, PrimaryButton, TextInput } from './components/ui'

type Messages = ReturnType<typeof getMessages>

function runtimeAvailable() {
  return typeof chrome !== 'undefined' && Boolean(chrome.tabs && chrome.tabGroups)
}

function isTabWeaveNewTab(tab: TabSnapshot) {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return false
  return tab.url.startsWith(chrome.runtime.getURL('newtab.html'))
}

function getTabFallbackLabel(tab: TabSnapshot) {
  try {
    const host = new URL(tab.url).hostname.replace(/^www\./, '')
    return host.charAt(0).toUpperCase() || 'T'
  } catch {
    return 'T'
  }
}

function getTabDragId(tabId: number) {
  return `tab:${tabId}`
}

function getGroupDropId(groupId: number) {
  return `group:${groupId}`
}

function getPendingGroupDropId(id: string) {
  return `pending-group:${id}`
}

function getGroupTabDropId(groupId: number, tabId: number) {
  return `tab-drop:group:${groupId}:${tabId}`
}

function getUngroupedTabDropId(tabId: number) {
  return `tab-drop:ungrouped:${tabId}`
}

function getTabIdFromDragId(id: unknown) {
  const value = String(id)
  if (!value.startsWith('tab:')) return null
  const tabId = Number(value.slice(4))
  return Number.isFinite(tabId) ? tabId : null
}

function getGroupIdFromDropId(id: string) {
  if (id.startsWith('group:')) {
    const groupId = Number(id.slice(6))
    return Number.isFinite(groupId) ? groupId : null
  }
  return null
}

function getTabDropTarget(id: string) {
  if (id.startsWith('tab-drop:ungrouped:')) {
    const tabId = Number(id.slice('tab-drop:ungrouped:'.length))
    return Number.isFinite(tabId) ? { type: 'ungrouped' as const, tabId } : null
  }

  if (id.startsWith('tab-drop:group:')) {
    const [, , groupIdText, tabIdText] = id.split(':')
    const groupId = Number(groupIdText)
    const tabId = Number(tabIdText)
    return Number.isFinite(groupId) && Number.isFinite(tabId)
      ? { type: 'group' as const, groupId, tabId }
      : null
  }

  return null
}

type PendingGroup = {
  id: string
  title: string
}

type MasonryColumn = {
  id: string
  groups: GroupSnapshot[]
  weight: number
}

function estimateGroupWeight(group: GroupSnapshot) {
  return 76 + group.tabs.length * 44
}

function buildMasonryColumnIds(groups: GroupSnapshot[], columnCount: number) {
  const columns = Array.from({ length: columnCount }, () => ({
    ids: [] as number[],
    weight: 0,
  }))

  groups.forEach((group) => {
    const target = columns.reduce((shortest, column) => column.weight < shortest.weight ? column : shortest, columns[0])
    target.ids.push(group.id)
    target.weight += estimateGroupWeight(group)
  })

  return columns.map((column) => column.ids)
}

function buildMasonryColumns(groups: GroupSnapshot[], columnIds: number[][]) {
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const assignedIds = new Set(columnIds.flat())
  const columns: MasonryColumn[] = columnIds.map((ids, index) => {
    const columnGroups = ids.flatMap((id) => {
      const group = groupById.get(id)
      return group ? [group] : []
    })
    return {
    id: `column-${index}`,
      groups: columnGroups,
      weight: columnGroups.reduce((total, group) => total + estimateGroupWeight(group), 0),
    }
  })

  groups.filter((group) => !assignedIds.has(group.id)).forEach((group) => {
    const target = columns.reduce((shortest, column) => column.weight < shortest.weight ? column : shortest, columns[0])
    target.groups.push(group)
    target.weight += estimateGroupWeight(group)
  })

  return columns
}

export function TabIcon({ tab }: { tab: TabSnapshot }) {
  const [failed, setFailed] = useState(false)
  if (tab.favIconUrl && !failed) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-900/70 ring-1 ring-white/10">
        <img src={tab.favIconUrl} alt="" className="h-4 w-4" onError={() => setFailed(true)} />
      </span>
    )
  }

  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-900/70 text-[10px] font-semibold text-zinc-500 ring-1 ring-white/10">
      {getTabFallbackLabel(tab)}
    </span>
  )
}

export function TabRow({
  tab,
  onOpen,
  onClose,
  closeLabel,
  onSnooze,
  snoozeLabel,
  dropId,
  overlay = false,
}: {
  tab: TabSnapshot
  onOpen: (tabId: number) => void
  onClose: (tabId: number) => void
  closeLabel?: string
  onSnooze?: (tabId: number) => void
  snoozeLabel?: string
  dropId?: string
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: getTabDragId(tab.id),
    disabled: overlay,
  })
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: dropId ?? `tab-drop-disabled:${tab.id}`,
    disabled: overlay || !dropId,
  })

  function setRefs(node: HTMLDivElement | null) {
    setNodeRef(node)
    setDropNodeRef(node)
  }

  return (
    <motion.div
      layout
      initial={overlay ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: isDragging ? 0.35 : 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ type: 'spring', duration: 0.28, bounce: 0 }}
      ref={setRefs}
      onClick={() => overlay ? undefined : onOpen(tab.id)}
      className={`group/tab relative grid cursor-grab grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-white/[0.06] active:cursor-grabbing ${overlay ? 'newtab-card w-[320px] p-2 shadow-2xl' : ''}`}
      {...listeners}
      {...attributes}
    >
      <span className="contents text-left" title={tab.title}>
        <TabIcon tab={tab} />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-5 text-zinc-100">{tab.title}</span>
          <span className="block truncate text-[11px] leading-4 text-zinc-500">{tab.url}</span>
        </span>
      </span>
      {!overlay && (
      <span className="flex items-center justify-end gap-1 opacity-0 group-hover/tab:opacity-100">
        {onSnooze && (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onSnooze(tab.id)
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-violet-500/10 hover:text-violet-300"
            title={snoozeLabel}
            aria-label={snoozeLabel}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </button>
        )}
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onClose(tab.id)
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-medium text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300"
          aria-label={closeLabel}
        >
          ×
        </button>
      </span>
      )}
    </motion.div>
  )
}

export function TabDropPlaceholder({ label }: { label: string }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, scale: 0.98 }}
      animate={{ opacity: 1, height: 46, scale: 1 }}
      exit={{ opacity: 0, height: 0, scale: 0.98 }}
      transition={{ type: 'spring', duration: 0.24, bounce: 0 }}
      className="overflow-hidden rounded-xl border border-dashed border-violet-400/45 bg-violet-500/10"
    >
      <div className="flex h-full items-center gap-2 px-2 text-[11px] font-medium text-violet-300">
        <span className="h-6 w-6 rounded-lg bg-violet-400/15" />
        <span>{label}</span>
      </div>
    </motion.div>
  )
}

export function GroupCard({
  group,
  onToggle,
  onOpen,
  onCloseTab,
  onCloseGroup,
  onUngroupGroup,
  onSnoozeTab,
  dragging,
  showTabDropPlaceholder,
  overTabId,
  t,
}: {
  group: GroupSnapshot
  onToggle: (groupId: number, collapsed: boolean) => void
  onOpen: (tabId: number) => void
  onCloseTab: (tabId: number) => void
  onCloseGroup: (tabIds: number[]) => void
  onUngroupGroup: (tabIds: number[]) => void
  onSnoozeTab?: (tabId: number) => void
  dragging: boolean
  showTabDropPlaceholder: boolean
  overTabId: number | null
  t: Messages
}) {
  const [confirmUngroup, setConfirmUngroup] = useState(false)
  const visibleTabs = group.collapsed ? [] : group.tabs
  const tabIds = group.tabs.map((tab) => tab.id)
  const { isOver, setNodeRef: setDropNodeRef } = useDroppable({ id: getGroupDropId(group.id) })

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
      ref={setDropNodeRef}
      className={`newtab-card w-full rounded-2xl p-3 backdrop-blur transition ${
        isOver ? 'ring-2 ring-violet-400/45' : dragging ? 'ring-2 ring-violet-400/20' : ''
      }`}
    >
      <div>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_CLASS[group.color]}`} />
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onToggle(group.id, group.collapsed)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="truncate text-sm font-semibold tracking-[-0.02em] text-zinc-100">{group.title}</span>
          <span className="text-xs font-medium text-zinc-500 tabular-nums">{group.tabs.length}</span>
          <svg className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${group.collapsed ? '-rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            if (!confirmUngroup) {
              setConfirmUngroup(true)
              window.setTimeout(() => setConfirmUngroup(false), 2400)
              return
            }
            setConfirmUngroup(false)
            onUngroupGroup(tabIds)
          }}
          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 transition hover:bg-white/[0.08] hover:text-violet-300"
        >
          {confirmUngroup ? t.newTabConfirm : t.ungroupGroup}
        </button>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onCloseGroup(tabIds)}
          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300"
        >
          {t.close}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {(!group.collapsed || showTabDropPlaceholder) && (
          <motion.div
            key="tabs"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
            className="mt-2 overflow-hidden"
          >
            <div className="space-y-0.5" onPointerDown={(event) => event.stopPropagation()}>
              <AnimatePresence initial={false}>
                {visibleTabs.map((tab) => (
                  <div key={tab.id}>
                    {showTabDropPlaceholder && overTabId === tab.id && <TabDropPlaceholder label={t.newTabDropTabHere} />}
                    <TabRow
                      tab={tab}
                      onOpen={onOpen}
                      onClose={onCloseTab}
                      closeLabel={t.closeTab}
                      onSnooze={onSnoozeTab}
                      snoozeLabel={t.snoozeTab}
                      dropId={getGroupTabDropId(group.id, tab.id)}
                    />
                  </div>
                ))}
                {showTabDropPlaceholder && overTabId === null && <TabDropPlaceholder key="tab-drop-placeholder-end" label={t.newTabDropTabHere} />}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {group.tabs.length === 0 && (
        <div className="mt-2 rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-zinc-500">
          {t.newTabDragTabsHere}
        </div>
      )}
      </div>
    </motion.article>
  )
}

export function UngroupedCard({
  tabs,
  onOpen,
  onCloseTab,
  onSnoozeTab,
  onAiOrganize,
  aiBusy,
  dragging,
  showTabDropPlaceholder,
  overTabId,
  glow,
  t,
}: {
  tabs: TabSnapshot[]
  onOpen: (tabId: number) => void
  onCloseTab: (tabId: number) => void
  onSnoozeTab?: (tabId: number) => void
  onAiOrganize: () => void
  aiBusy: boolean
  dragging: boolean
  showTabDropPlaceholder: boolean
  overTabId: number | null
  glow: boolean
  t: Messages
}) {
  const { isOver, setNodeRef } = useDroppable({ id: 'ungrouped' })

  return (
    <div className="relative">
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
      ref={setNodeRef}
      className={`newtab-card rounded-2xl p-3 backdrop-blur transition ${
        isOver ? 'scale-[1.01] ring-2 ring-violet-400/45' : dragging ? 'ring-2 ring-violet-400/20' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.02em] text-zinc-100">{t.ungrouped}</h2>
          <p className="text-[11px] text-zinc-500">{t.newTabRecentFirst}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAiOrganize}
            disabled={aiBusy}
            className="rounded-lg px-2 py-1 text-[11px] font-semibold text-violet-300 transition hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiBusy ? 'AI…' : t.aiOrganize}
          </button>
          <span className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs font-semibold text-zinc-400 ring-1 ring-white/10 tabular-nums">
            {tabs.length}
          </span>
        </div>
      </div>
      <div className="mt-3 space-y-0.5">
        <AnimatePresence initial={false}>
          {tabs.map((tab) => (
            <div key={tab.id}>
              {showTabDropPlaceholder && overTabId === tab.id && <TabDropPlaceholder label={t.newTabDropTabHere} />}
              <TabRow tab={tab} onOpen={onOpen} onClose={onCloseTab} closeLabel={t.closeTab} onSnooze={onSnoozeTab} snoozeLabel={t.snoozeTab} dropId={getUngroupedTabDropId(tab.id)} />
            </div>
          ))}
          {showTabDropPlaceholder && overTabId === null && <TabDropPlaceholder key="tab-drop-placeholder-end" label={t.newTabDropTabHere} />}
        </AnimatePresence>
        {tabs.length === 0 && <EmptyState title={t.allGrouped} description={t.newTabAllGroupedDesc} />}
      </div>
    </motion.article>
    {glow && (
      <div className="pointer-events-none absolute inset-0 z-10">
        <AppleIntelligenceGlow
          radius={16}
          className="ai-response-glow h-full w-full rounded-2xl"
          style={{ width: '100%', height: '100%' }}
        >
          <div className="h-full w-full rounded-2xl" aria-hidden="true" />
        </AppleIntelligenceGlow>
      </div>
    )}
    </div>
  )
}

export function NewGroupCard({
  title,
  onTitleChange,
  dragging,
  onCreate,
  t,
}: {
  title: string
  onTitleChange: (title: string) => void
  dragging: boolean
  onCreate: (title: string) => void
  t: Messages
}) {
  const canCreate = Boolean(title.trim())
  const { isOver, setNodeRef } = useDroppable({ id: 'new-group', disabled: !title.trim() })

  function createFromSelected(event: FormEvent) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    onCreate(trimmedTitle)
    onTitleChange('')
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
      ref={setNodeRef}
      className={`newtab-card w-full rounded-2xl p-3 backdrop-blur transition ${
        isOver ? 'scale-[1.01] ring-2 ring-violet-400/45' : dragging && title.trim() ? 'ring-2 ring-violet-400/20' : ''
      }`}
    >
      <form onSubmit={createFromSelected} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <TextInput
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={t.newTabNewGroupPlaceholder}
          className="h-9 rounded-xl text-xs"
        />
        <PrimaryButton type="submit" disabled={!canCreate} className="h-9 whitespace-nowrap px-3 text-xs">
          {t.createGroup}
        </PrimaryButton>
      </form>
      <p className="mt-2 text-[11px] leading-4 text-zinc-500">
        {t.newTabNewGroupHint}
      </p>
    </motion.article>
  )
}

export function PendingGroupCard({
  group,
  dragging,
  t,
}: {
  group: PendingGroup
  dragging: boolean
  t: Messages
}) {
  const { isOver, setNodeRef } = useDroppable({ id: getPendingGroupDropId(group.id) })

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
      ref={setNodeRef}
      className={`newtab-card w-full rounded-2xl p-3 backdrop-blur transition ${
        isOver ? 'scale-[1.01] ring-2 ring-violet-400/45' : dragging ? 'ring-2 ring-violet-400/20' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.02em] text-zinc-100">
          {group.title}
        </span>
        <span className="rounded-lg px-2 py-1 text-[11px] font-semibold text-zinc-500">{t.newTabEmptyGroup}</span>
      </div>
      <div className="mt-2 rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-zinc-500">
        {t.newTabDragTabsHere}
      </div>
    </motion.article>
  )
}

export function SnoozedCard({
  items,
  onWakeUp,
  onDelete,
  t,
}: {
  items: SnoozeItem[]
  onWakeUp: (id: string) => void
  onDelete: (id: string) => void
  t: Messages
}) {
  if (items.length === 0) return null

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
      className="newtab-card w-full rounded-2xl p-3 backdrop-blur"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.02em] text-zinc-100">{t.newTabSnoozed}</h2>
        </div>
        <span className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs font-semibold text-zinc-400 ring-1 ring-white/10 tabular-nums">
          {items.length}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2 rounded-lg p-2 transition hover:bg-white/[0.04]">
            <img src={item.favIconUrl || `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=32`} className="h-4 w-4 shrink-0 rounded" alt="" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-zinc-300">{item.title}</div>
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                {item.recurring && (
                  <svg className="h-2.5 w-2.5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
                  </svg>
                )}
                <span>
                  {item.recurring
                    ? t.snoozeRecurringLabel.replace('{time}', `${String(item.recurring.hour).padStart(2, '0')}:${String(item.recurring.minute).padStart(2, '0')}`)
                    : new Date(item.wakeUpAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onWakeUp(item.id)}
              className="rounded-lg px-2 py-1 text-[10px] font-semibold text-violet-300 opacity-0 transition group-hover:bg-violet-500/10 group-hover:opacity-100"
            >
              {t.newTabWakeUpNow}
            </button>
            {item.recurring && (
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-zinc-500 opacity-0 transition hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                aria-label="Remove"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
    </motion.article>
  )
}

function getTomorrowDateInputValue() {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
}

export function SnoozeModal({
  onConfirm,
  onClose,
  t,
}: {
  onConfirm: (wakeUpAt: number, recurring?: { hour: number; minute: number }) => void
  onClose: () => void
  t: Messages
}) {
  const [mode, setMode] = useState<'preset' | 'custom' | 'recurring'>('preset')
  const [customDate, setCustomDate] = useState(getTomorrowDateInputValue)
  const [customTime, setCustomTime] = useState('09:00')
  const [recurringHour, setRecurringHour] = useState('09')
  const [recurringMinute, setRecurringMinute] = useState('00')

  const presets = [
    { label: t.snooze30min, ms: 30 * 60 * 1000 },
    { label: t.snooze1hour, ms: 60 * 60 * 1000 },
    { label: t.snooze2hours, ms: 2 * 60 * 60 * 1000 },
    { label: t.snooze4hours, ms: 4 * 60 * 60 * 1000 },
  ]

  function handlePreset(ms: number) {
    onConfirm(new Date().getTime() + ms)
  }

  function handleTomorrow() {
    const now = new Date()
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
    onConfirm(tomorrow.getTime())
  }

  function handleCustomConfirm() {
    if (!customDate || !customTime) return
    const [year, month, day] = customDate.split('-').map(Number)
    const [hour, minute] = customTime.split(':').map(Number)
    const target = new Date(year, month - 1, day, hour, minute, 0, 0)
    if (target.getTime() <= new Date().getTime()) return
    onConfirm(target.getTime())
  }

  function handleRecurringConfirm() {
    const hour = Number(recurringHour)
    const minute = Number(recurringMinute)
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    onConfirm(next.getTime(), { hour, minute })
  }

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/55 p-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        className="snooze-modal flex w-full max-w-[360px] flex-col overflow-hidden rounded-[24px] bg-zinc-950/96 text-zinc-100 shadow-2xl shadow-black/50 ring-1 ring-white/12"
        initial={{ opacity: 0, y: 22, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.96 }}
        transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-white/10 px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-[-0.02em]">{t.snoozeModalTitle}</h2>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-300"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          {/* Mode tabs */}
          <div className="mt-2 flex gap-1 rounded-lg bg-white/[0.04] p-0.5">
            {(['preset', 'custom', 'recurring'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
                  mode === m ? 'bg-white/[0.1] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {m === 'preset' ? t.snoozeTab : m === 'custom' ? t.snoozeCustomTime : t.snoozeRecurring}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-4 py-3">
          {mode === 'preset' && (
            <div className="space-y-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handlePreset(preset.ms)}
                  className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-300 transition hover:bg-white/[0.06]"
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleTomorrow}
                className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-300 transition hover:bg-white/[0.06]"
              >
                {t.snoozeTomorrow}
              </button>
            </div>
          )}

          {mode === 'custom' && (
            <div className="space-y-3">
              <div>
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-200 focus:border-violet-400/70 focus:outline-none focus:ring-4 focus:ring-violet-500/10"
                />
              </div>
              <div>
                <input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm text-zinc-200 focus:border-violet-400/70 focus:outline-none focus:ring-4 focus:ring-violet-500/10"
                />
              </div>
              <button
                type="button"
                onClick={handleCustomConfirm}
                className="w-full rounded-xl bg-violet-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-400 active:scale-[.98]"
              >
                {t.snoozeConfirm}
              </button>
            </div>
          )}

          {mode === 'recurring' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">{t.snoozeRecurring}</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={recurringHour}
                  onChange={(e) => setRecurringHour(e.target.value.padStart(2, '0'))}
                  className="w-16 rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-center text-sm text-zinc-200 tabular-nums focus:border-violet-400/70 focus:outline-none focus:ring-4 focus:ring-violet-500/10"
                />
                <span className="text-zinc-500">:</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={recurringMinute}
                  onChange={(e) => setRecurringMinute(e.target.value.padStart(2, '0'))}
                  className="w-16 rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-center text-sm text-zinc-200 tabular-nums focus:border-violet-400/70 focus:outline-none focus:ring-4 focus:ring-violet-500/10"
                />
              </div>
              <button
                type="button"
                onClick={handleRecurringConfirm}
                className="w-full rounded-xl bg-violet-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-400 active:scale-[.98]"
              >
                {t.snoozeConfirm}
              </button>
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  )
}

export function NewTab() {
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [snapshot, setSnapshot] = useState<WindowSnapshot>({ groups: [], ungroupedTabs: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [snoozedTabs, setSnoozedTabs] = useState<SnoozeItem[]>([])
  const [query, setQuery] = useState('')
  const [draggingTabId, setDraggingTabId] = useState<number | null>(null)
  const [overTabDropId, setOverTabDropId] = useState('')
  const [groupsGridWidth, setGroupsGridWidth] = useState(0)
  const [masonryColumnIds, setMasonryColumnIds] = useState<number[][]>([])
  const [ungroupedOrder, setUngroupedOrder] = useState<number[]>([])
  const [ungroupedOrderTouched, setUngroupedOrderTouched] = useState(false)
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [pendingGroups, setPendingGroups] = useState<PendingGroup[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPlan, setAiPlan] = useState<AiGroupingPlan | null>(null)
  const [aiPlanChecked, setAiPlanChecked] = useState(0)
  const [saveAiPlanAsRules, setSaveAiPlanAsRules] = useState(false)
  const [collapsedAiGroups, setCollapsedAiGroups] = useState<Record<string, boolean>>({})
  const [message, setMessage] = useState('')
  const [snoozeTargetTabId, setSnoozeTargetTabId] = useState<number | null>(null)
  const groupsGridObserverRef = useRef<ResizeObserver | null>(null)
  const groupsGridWidthRef = useRef(0)
  const latestGroupsRef = useRef<GroupSnapshot[]>([])
  const masonryColumnIdsRef = useRef<number[][]>([])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const t = getMessages(preferences?.languageMode ?? 'system')

  const refreshSnoozedTabs = useCallback(async () => {
    if (!runtimeAvailable()) return
    const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_GET_SNOOZED_TABS' })
    if (response?.ok) setSnoozedTabs(response.items)
  }, [])

  const wakeUpSnooze = useCallback(async (snoozeId: string) => {
    if (!runtimeAvailable()) return
    await chrome.runtime.sendMessage({ type: 'TABWEAVE_WAKE_UP_SNOOZE', snoozeId })
    await refreshSnoozedTabs()
  }, [refreshSnoozedTabs])

  const deleteSnooze = useCallback(async (snoozeId: string) => {
    if (!runtimeAvailable()) return
    await chrome.runtime.sendMessage({ type: 'TABWEAVE_DELETE_SNOOZE', snoozeId })
    await refreshSnoozedTabs()
  }, [refreshSnoozedTabs])

  const onSnoozeTab = useCallback((tabId: number) => {
    setSnoozeTargetTabId(tabId)
  }, [])

  const confirmSnooze = useCallback(async (wakeUpAt: number, recurring?: { hour: number; minute: number }) => {
    if (snoozeTargetTabId === null || !runtimeAvailable()) return
    await chrome.runtime.sendMessage({ type: 'TABWEAVE_SNOOZE_TAB', tabId: snoozeTargetTabId, wakeUpAt, recurring })
    setSnoozeTargetTabId(null)
    await refreshSnoozedTabs()
  }, [snoozeTargetTabId, refreshSnoozedTabs])

  const engineOptions = SEARCH_ENGINES.map((engine) => ({ value: engine.id, label: engine.label }))
  const searchEngineLabel = SEARCH_ENGINES.find((engine) => engine.id === preferences?.newTabSearchEngine)?.label ?? 'Google'

  const filteredSnapshot = useMemo<WindowSnapshot>(() => {
    const hiddenTabIds = new Set<number>()
    const groups = snapshot.groups
      .map((group) => {
        const tabs = group.tabs.filter((tab) => !isTabWeaveNewTab(tab))
        group.tabs.forEach((tab) => {
          if (isTabWeaveNewTab(tab)) hiddenTabIds.add(tab.id)
        })
        return { ...group, tabs }
      })
      .filter((group) => group.tabs.length > 0)
    return {
      groups,
      ungroupedTabs: snapshot.ungroupedTabs.filter((tab) => !hiddenTabIds.has(tab.id) && !isTabWeaveNewTab(tab)),
    }
  }, [snapshot])

  const allTabCount = useMemo(
    () => filteredSnapshot.ungroupedTabs.length + filteredSnapshot.groups.reduce((total, group) => total + group.tabs.length, 0),
    [filteredSnapshot],
  )
  const statusText = t.newTabStatus
    .replace('{tabs}', String(allTabCount))
    .replace('{groups}', String(filteredSnapshot.groups.length))
    .replace('{engine}', searchEngineLabel)
  const tabsById = useMemo(() => {
    return new Map([...filteredSnapshot.groups.flatMap((group) => group.tabs), ...filteredSnapshot.ungroupedTabs].map((tab) => [tab.id, tab]))
  }, [filteredSnapshot])
  const draggingTab = draggingTabId !== null ? tabsById.get(draggingTabId) : undefined
  const overTabTarget = getTabDropTarget(overTabDropId)
  const aiPlanTabCount = useMemo(
    () => aiPlan?.groups.reduce((total, group) => total + group.tabIds.length, 0) ?? 0,
    [aiPlan],
  )
  const groupColumnCount = useMemo(() => {
    if (groupsGridWidth <= 0) return 1
    return Math.max(1, Math.min(4, Math.floor((groupsGridWidth + 12) / 342)))
  }, [groupsGridWidth])
  const masonryColumns = useMemo(
    () => buildMasonryColumns(filteredSnapshot.groups, masonryColumnIds.length > 0 ? masonryColumnIds : buildMasonryColumnIds(filteredSnapshot.groups, groupColumnCount)),
    [filteredSnapshot.groups, groupColumnCount, masonryColumnIds],
  )
  const visibleGroupColumnCount = masonryColumns.length || 1
  const orderedUngroupedTabs = useMemo(() => {
    if (!ungroupedOrderTouched) return filteredSnapshot.ungroupedTabs
    const order = new Map(ungroupedOrder.map((tabId, index) => [tabId, index]))
    return [...filteredSnapshot.ungroupedTabs].sort((a, b) => {
      const aOrder = order.get(a.id)
      const bOrder = order.get(b.id)
      if (aOrder !== undefined && bOrder !== undefined) return aOrder - bOrder
      if (aOrder !== undefined) return -1
      if (bOrder !== undefined) return 1
      return a.index - b.index
    })
  }, [filteredSnapshot.ungroupedTabs, ungroupedOrder, ungroupedOrderTouched])

  const setGroupsGridNode = useCallback((node: HTMLDivElement | null) => {
    groupsGridObserverRef.current?.disconnect()
    groupsGridObserverRef.current = null
    if (!node) return

    function updateWidth(width: number) {
      groupsGridWidthRef.current = width
      setGroupsGridWidth(width)
      if (masonryColumnIdsRef.current.length === 0 && latestGroupsRef.current.length > 0) {
        const count = Math.max(1, Math.min(4, Math.floor((width + 12) / 342)))
        const nextColumns = buildMasonryColumnIds(latestGroupsRef.current, count)
        masonryColumnIdsRef.current = nextColumns
        setMasonryColumnIds(nextColumns)
      }
    }

    updateWidth(node.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) updateWidth(width)
    })
    observer.observe(node)
    groupsGridObserverRef.current = observer
  }, [])

  const refresh = useCallback(async () => {
    if (!runtimeAvailable()) {
      setLoading(false)
      return
    }
    const next = await getCurrentWindowSnapshot()
    setSnapshot(next)
    if (masonryColumnIdsRef.current.length === 0 && groupsGridWidthRef.current > 0) {
      const count = Math.max(1, Math.min(4, Math.floor((groupsGridWidthRef.current + 12) / 342)))
      const nextColumns = buildMasonryColumnIds(next.groups, count)
      masonryColumnIdsRef.current = nextColumns
      setMasonryColumnIds(nextColumns)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loadedPreferences = await getPreferences()
      if (cancelled) return
      setPreferences(loadedPreferences)
      applyTheme(loadedPreferences.themeMode)
      await refresh()
      await refreshSnoozedTabs()
    })()
    return () => {
      cancelled = true
    }
  }, [refresh, refreshSnoozedTabs])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    const handleStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync' || !changes[STORAGE_KEYS.preferences]) return
      void getPreferences().then((nextPreferences) => {
        setPreferences(nextPreferences)
        applyTheme(nextPreferences.themeMode)
      })
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => chrome.storage.onChanged.removeListener(handleStorageChanged)
  }, [])

  useEffect(() => {
    if (!message) return undefined
    const timer = window.setTimeout(() => setMessage(''), 3600)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    latestGroupsRef.current = filteredSnapshot.groups
  }, [filteredSnapshot.groups])

  useEffect(() => () => groupsGridObserverRef.current?.disconnect(), [])

  async function updatePreferences(patch: Partial<Preferences>) {
    if (!preferences) return
    const next = { ...preferences, ...patch }
    setPreferences(next)
    if (patch.themeMode) applyTheme(patch.themeMode)
    await savePreferences(next)
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    if (!preferences) return
    const url = buildSearchUrl(query, preferences.newTabSearchEngine, preferences.newTabCustomSearchUrl)
    if (url) window.location.href = url
  }

  async function organizeNow() {
    if (!preferences || busy) return
    setBusy(true)
    try {
      const rules = await getRules()
      const tabs = await queryTabsByScope(preferences.organizeScope)
      const changed = await applyRulesToTabs(rules, tabs, preferences.domainFallbackGrouping, preferences.groupMinTabs)
      await consolidateDuplicateGroupsForTabs(tabs)
      if (preferences.autoCollapseGroups) await collapseGroupsByScope(preferences.organizeScope)
      setMessage(t.organized.replace('{checked}', String(tabs.length)).replace('{changed}', String(changed)))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function toggleGroup(groupId: number, collapsed: boolean) {
    await chrome.tabGroups.update(groupId, { collapsed: !collapsed })
    await refresh()
  }

  async function activateTab(tabId: number) {
    await chrome.tabs.update(tabId, { active: true })
  }

  async function closeTab(tabId: number) {
    await chrome.tabs.remove(tabId)
    await refresh()
  }

  async function closeGroup(tabIds: number[]) {
    if (tabIds.length === 0) return
    await chrome.tabs.remove(tabIds)
    await refresh()
  }

  async function ungroupTabs(tabIds: number[]) {
    if (tabIds.length === 0) return
    await chrome.tabs.ungroup(tabIds as [number, ...number[]])
    await refresh()
  }

  async function moveTabToGroup(tabId: number, groupId: number, beforeTabId?: number) {
    const tab = tabsById.get(tabId)
    if (!tab) return
    const beforeTab = beforeTabId ? tabsById.get(beforeTabId) : undefined
    if (tab.groupId === groupId && beforeTab?.id === tabId) return
    await chrome.tabs.group({ tabIds: [tabId], groupId })
    if (beforeTab && beforeTab.id !== tabId) {
      await chrome.tabs.move(tabId, { index: beforeTab.index })
    }
    await refresh()
  }

  async function moveTabToUngrouped(tabId: number, beforeTabId?: number) {
    const tab = tabsById.get(tabId)
    const beforeTab = beforeTabId ? tabsById.get(beforeTabId) : undefined
    if (tab && tab.groupId < 0 && beforeTabId === undefined) return
    if (tab && tab.groupId < 0 && beforeTab?.id === tabId) return
    if (!tab || tab.groupId >= 0) {
      await chrome.tabs.ungroup(tabId)
    }
    if (beforeTab && beforeTab.id !== tabId) {
      await chrome.tabs.move(tabId, { index: beforeTab.index })
    }
    setUngroupedOrderTouched(true)
    setUngroupedOrder((current) => {
      const baseOrder = current.length > 0 ? current : orderedUngroupedTabs.map((tab) => tab.id)
      const withoutDragged = baseOrder.filter((id) => id !== tabId)
      const insertIndex = beforeTabId ? withoutDragged.indexOf(beforeTabId) : -1
      if (insertIndex < 0) return [...withoutDragged, tabId]
      return [...withoutDragged.slice(0, insertIndex), tabId, ...withoutDragged.slice(insertIndex)]
    })
    await refresh()
  }

  async function createGroupFromDraggedTab(tabId: number, title: string) {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    await createGroupFromTabs([tabId], trimmedTitle, 'blue')
    setNewGroupTitle('')
    await refresh()
  }

  async function createPendingGroupFromDraggedTab(tabId: number, pendingGroup: PendingGroup) {
    await createGroupFromTabs([tabId], pendingGroup.title, 'blue')
    setPendingGroups((current) => current.filter((group) => group.id !== pendingGroup.id))
    await refresh()
  }

  async function createPendingGroup(title: string) {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    setPendingGroups((current) => [{ id: crypto.randomUUID(), title: trimmedTitle }, ...current])
  }

  async function aiOrganizeNow() {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const planResponse = await chrome.runtime.sendMessage({ type: 'TABWEAVE_AI_GROUPING_PLAN' })
      if (!planResponse?.ok || !planResponse.plan) {
        setMessage(planResponse?.error ?? t.aiNoPlan)
        return
      }
      setAiPlan(planResponse.plan)
      setAiPlanChecked(planResponse.checked ?? 0)
      setSaveAiPlanAsRules(false)
      setCollapsedAiGroups({})
    } finally {
      setAiBusy(false)
    }
  }

  function updateAiPlanGroupTitle(groupIndex: number, title: string, fallback = false) {
    setAiPlan((current) => {
      if (!current) return current
      const groups = current.groups.map((group, index) => {
        if (index !== groupIndex) return group
        const nextTitle = fallback ? title.trim() || group.title : title
        return { ...group, title: nextTitle }
      })
      return { ...current, groups }
    })
  }

  function toggleAiPlanGroup(groupIndex: number) {
    setCollapsedAiGroups((current) => ({ ...current, [String(groupIndex)]: !current[String(groupIndex)] }))
  }

  function cancelAiPlanGroup(groupIndex: number) {
    setAiPlan((current) => {
      if (!current) return current
      return { ...current, groups: current.groups.filter((_, index) => index !== groupIndex) }
    })
  }

  function removeAiPlanTab(groupIndex: number, tabId: number) {
    setAiPlan((current) => {
      if (!current) return current
      const groups = current.groups
        .map((group, index) => index === groupIndex ? { ...group, tabIds: group.tabIds.filter((id) => id !== tabId) } : group)
        .filter((group) => group.tabIds.length > 0)
      return { ...current, groups }
    })
  }

  async function applyAiPlan() {
    if (!aiPlan || busy) return
    setBusy(true)
    try {
      const applyResponse = await chrome.runtime.sendMessage({
        type: 'TABWEAVE_AI_APPLY_GROUPING_PLAN',
        plan: aiPlan,
        saveRules: saveAiPlanAsRules,
      })
      if (!applyResponse?.ok) {
        setMessage(applyResponse?.error ?? t.failed)
        return
      }
      setMessage(t.aiApplied.replace('{changed}', String(applyResponse.changed ?? 0)))
      setAiPlan(null)
      setSaveAiPlanAsRules(false)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function deduplicateNow() {
    const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_DEDUPLICATE' })
    if (!response?.ok) {
      setMessage(response?.error ?? t.failed)
      return
    }
    setMessage(response.closed > 0 ? t.deduplicated.replace('{count}', String(response.closed)) : t.noDuplicates)
    await refresh()
  }

  async function hibernateNow() {
    const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_HIBERNATE' })
    if (!response?.ok) {
      setMessage(response?.error ?? t.failed)
      return
    }
    setMessage(response.discarded > 0 ? t.hibernated.replace('{count}', String(response.discarded)) : t.noHibernateCandidates)
    await refresh()
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingTabId(getTabIdFromDragId(event.active.id))
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id ? String(event.over.id) : ''
    if (getTabIdFromDragId(event.active.id) === null) return
    if (
      overId === 'ungrouped' ||
      overId === 'new-group' ||
      overId.startsWith('pending-group:') ||
      getGroupIdFromDropId(overId) !== null ||
      getTabDropTarget(overId)
    ) {
      setOverTabDropId(overId)
      return
    }
    setOverTabDropId('')
  }

  function handleDragEnd(event: DragEndEvent) {
    const tabId = getTabIdFromDragId(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : ''
    setDraggingTabId(null)
    setOverTabDropId('')
    if (!overId) return

    if (!tabId) return

    const tabDropTarget = getTabDropTarget(overId)
    if (tabDropTarget?.type === 'ungrouped') {
      void moveTabToUngrouped(tabId, tabDropTarget.tabId)
      return
    }
    if (tabDropTarget?.type === 'group') {
      void moveTabToGroup(tabId, tabDropTarget.groupId, tabDropTarget.tabId)
      return
    }

    if (overId === 'ungrouped') {
      void moveTabToUngrouped(tabId)
      return
    }

    if (overId === 'new-group') {
      void createGroupFromDraggedTab(tabId, newGroupTitle)
      return
    }

    if (overId.startsWith('pending-group:')) {
      const pendingGroup = pendingGroups.find((group) => getPendingGroupDropId(group.id) === overId)
      if (pendingGroup) void createPendingGroupFromDraggedTab(tabId, pendingGroup)
      return
    }

    const groupId = getGroupIdFromDropId(overId)
    if (groupId !== null) {
      void moveTabToGroup(tabId, groupId)
    }
  }

  if (!runtimeAvailable()) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-950 px-6 text-zinc-100">
        <EmptyState title={t.runtimeTitle} description={t.runtimeDesc} />
      </main>
    )
  }

  return (
    <main className="newtab-surface min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_12%_0%,rgba(34,211,238,.12),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(139,92,246,.16),transparent_34%),#09090b] px-6 pb-7 pt-[12vh] text-zinc-100 antialiased sm:px-10 2xl:px-14">
      <div className="w-full">
        <header className="mx-auto max-w-3xl">
          {preferences?.newTabShowSearch && (
            <form onSubmit={submitSearch} className="newtab-search-shell rounded-full bg-white/95 p-1.5 shadow-[0_2px_8px_rgba(60,64,67,.18),0_1px_3px_rgba(60,64,67,.12)] ring-1 ring-black/5 transition-shadow focus-within:shadow-[0_3px_12px_rgba(60,64,67,.2),0_1px_4px_rgba(60,64,67,.12)]">
              <div className="grid grid-cols-[122px_minmax(0,1fr)_auto] items-center gap-1.5 max-sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="max-sm:hidden">
                  <AnchorSelect
                    value={preferences.newTabSearchEngine}
                    options={engineOptions}
                    onChange={(newTabSearchEngine) => updatePreferences({ newTabSearchEngine })}
                  />
                </div>
                <TextInput
                  autoFocus={false}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t.newTabSearchPlaceholder.replace('{engine}', searchEngineLabel)}
                  className="h-10 rounded-full border-transparent bg-transparent px-4 text-base shadow-none focus:border-transparent focus:ring-0"
                />
                <button
                  type="submit"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 active:scale-[.96]"
                  aria-label={t.commandTrigger}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </button>
              </div>
              <div className="hidden max-sm:mt-1 max-sm:block">
                <AnchorSelect
                  value={preferences.newTabSearchEngine}
                  options={engineOptions}
                  onChange={(newTabSearchEngine) => updatePreferences({ newTabSearchEngine })}
                />
              </div>
            </form>
          )}
        </header>

        <section className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={organizeNow}
              disabled={busy}
              className="newtab-chip rounded-full px-3 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? t.organizing : t.organize}
            </button>
            <button type="button" onClick={() => void deduplicateNow()} disabled={busy} className="newtab-chip rounded-full px-3 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-50">
              {t.deduplicateNow}
            </button>
            <button type="button" onClick={() => void hibernateNow()} disabled={busy} className="newtab-chip rounded-full px-3 py-1.5 font-medium transition disabled:cursor-not-allowed disabled:opacity-50">
              {t.hibernateNow}
            </button>
            <button
              type="button"
              onClick={() => openExternalUrl(chrome.runtime.getURL('options.html'))}
              className="newtab-chip rounded-full px-3 py-1.5 font-medium transition"
            >
              {t.settings}
            </button>
          </div>
          <div className="font-medium">
            {message || statusText}
          </div>
        </section>

        {!preferences?.newTabDashboardEnabled ? (
          <section className="newtab-card mt-8 rounded-[28px] p-8 text-center">
            <h2 className="text-xl font-semibold">{t.newTabDashboardHidden}</h2>
            <p className="mt-2 text-sm text-zinc-500">{t.newTabDashboardHiddenDesc}</p>
          </section>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              setDraggingTabId(null)
              setOverTabDropId('')
            }}
          >
          <section className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]">
            <div ref={setGroupsGridNode} className="min-w-0">
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                <span>{t.newTabGroups}</span>
                <span className="tabular-nums tracking-normal">{filteredSnapshot.groups.length}</span>
              </div>
              <div
                className="newtab-masonry"
                style={{
                  gridTemplateColumns: `repeat(${visibleGroupColumnCount}, 330px)`,
                }}
              >
                {masonryColumns.map((column) => (
                  <div key={column.id} className="grid content-start gap-3">
                    <AnimatePresence initial={false}>
                      {column.id === 'column-0' && (
                        <NewGroupCard
                          key="new-group"
                          title={newGroupTitle}
                          onTitleChange={setNewGroupTitle}
                          dragging={Boolean(draggingTabId)}
                          onCreate={(title) => void createPendingGroup(title)}
                          t={t}
                        />
                      )}
                      {column.id === 'column-0' && pendingGroups.map((group) => (
                        <PendingGroupCard key={group.id} group={group} dragging={Boolean(draggingTabId)} t={t} />
                      ))}
                      {column.groups.map((group) => (
                        <GroupCard
                          key={group.id}
                          group={group}
                          onToggle={(groupId, collapsed) => void toggleGroup(groupId, collapsed)}
                          onOpen={(tabId) => void activateTab(tabId)}
                          onCloseTab={(tabId) => void closeTab(tabId)}
                          onCloseGroup={(tabIds) => void closeGroup(tabIds)}
                          onUngroupGroup={(tabIds) => void ungroupTabs(tabIds)}
                          onSnoozeTab={(tabId) => void onSnoozeTab(tabId)}
                          dragging={Boolean(draggingTabId)}
                          showTabDropPlaceholder={draggingTabId !== null && (getGroupDropId(group.id) === overTabDropId || (overTabTarget?.type === 'group' && overTabTarget.groupId === group.id))}
                          overTabId={overTabTarget?.type === 'group' && overTabTarget.groupId === group.id ? overTabTarget.tabId : null}
                          t={t}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                ))}
                {!loading && filteredSnapshot.groups.length === 0 && (
                  <article className="w-full">
                    <EmptyState title={t.noGroups} description={t.noGroupsDesc} />
                  </article>
                )}
              </div>
            </div>
            <aside className="min-w-0 space-y-4 lg:sticky lg:top-5">
              <SnoozedCard items={snoozedTabs} onWakeUp={wakeUpSnooze} onDelete={deleteSnooze} t={t} />
              <UngroupedCard
                tabs={orderedUngroupedTabs}
                onOpen={(tabId) => void activateTab(tabId)}
                onCloseTab={(tabId) => void closeTab(tabId)}
                onSnoozeTab={(tabId) => void onSnoozeTab(tabId)}
                onAiOrganize={() => void aiOrganizeNow()}
                aiBusy={aiBusy}
                dragging={Boolean(draggingTabId)}
                showTabDropPlaceholder={draggingTabId !== null && (overTabDropId === 'ungrouped' || overTabTarget?.type === 'ungrouped')}
                overTabId={overTabTarget?.type === 'ungrouped' ? overTabTarget.tabId : null}
                glow={aiBusy}
                t={t}
              />
            </aside>
            {!loading && filteredSnapshot.groups.length === 0 && filteredSnapshot.ungroupedTabs.length === 0 && (
              <article className="lg:col-span-2">
                <EmptyState title={t.noGroups} description={t.noGroupsDesc} />
              </article>
            )}
          </section>
          <DragOverlay dropAnimation={null}>
            {draggingTab ? (
              <TabRow tab={draggingTab} onOpen={() => undefined} onClose={() => undefined} closeLabel={t.closeTab} overlay />
            ) : null}
          </DragOverlay>
          </DndContext>
        )}
        <AnimatePresence>
          {aiPlan && (
            <motion.div
              key="newtab-ai-plan-modal"
              className="fixed inset-0 z-[90] flex items-center justify-center bg-zinc-950/55 p-4 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => {
                setAiPlan(null)
                setSaveAiPlanAsRules(false)
              }}
            >
              <motion.section
                role="dialog"
                aria-modal="true"
                aria-labelledby="newtab-ai-plan-title"
                className="ai-plan-modal flex max-h-[min(680px,calc(100dvh-2rem))] w-full max-w-[560px] flex-col overflow-hidden rounded-[24px] bg-zinc-950/96 text-zinc-100 shadow-2xl shadow-black/50 ring-1 ring-white/12"
                initial={{ opacity: 0, y: 22, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 18, scale: 0.96 }}
                transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="shrink-0 border-b border-white/10 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h2 id="newtab-ai-plan-title" className="text-lg font-semibold tracking-[-0.03em]">{t.aiPlanTitle}</h2>
                        <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-white/10">
                          {t.aiPlanTabCount.replace('{count}', String(aiPlanTabCount))}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{t.aiPlanReady.replace('{groups}', String(aiPlan.groups.length)).replace('{checked}', String(aiPlanChecked))}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAiPlan(null)
                        setSaveAiPlanAsRules(false)
                      }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                      aria-label={t.close}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="soft-scrollbar scroll-mask-y-8 min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
                  {aiPlan.groups.length === 0 ? (
                    <div className="rounded-2xl bg-white/[0.04] px-4 py-8 text-center text-sm text-zinc-500 ring-1 ring-white/10">{t.aiNoPlan}</div>
                  ) : (
                    aiPlan.groups.map((group, groupIndex) => {
                      const collapsed = Boolean(collapsedAiGroups[String(groupIndex)])
                      return (
                        <div key={`${group.title}-${groupIndex}`} className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => toggleAiPlanGroup(groupIndex)}
                              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-white/5"
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className={`h-2.5 w-2.5 rounded-full ${COLOR_CLASS[group.color]}`} />
                                <input
                                  value={group.title}
                                  data-previous-title={group.title}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => updateAiPlanGroupTitle(groupIndex, event.target.value)}
                                  onBlur={(event) => updateAiPlanGroupTitle(groupIndex, event.currentTarget.value, true)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') event.currentTarget.blur()
                                    if (event.key === 'Escape') {
                                      updateAiPlanGroupTitle(groupIndex, event.currentTarget.dataset.previousTitle || group.title)
                                      event.currentTarget.blur()
                                    }
                                  }}
                                  aria-label={t.aiPlanGroupTitle}
                                  className="min-w-0 max-w-[220px] flex-1 rounded-lg bg-white/[0.04] px-2 py-1 text-sm font-semibold text-zinc-100 outline-none ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:ring-white/15 focus:bg-white/[0.07] focus:ring-violet-400/50"
                                />
                                <span className="text-xs text-zinc-500">{group.tabIds.length}</span>
                                <svg className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-300 ${collapsed ? '-rotate-90' : 'rotate-0'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                  <path d="m6 9 6 6 6-6" />
                                </svg>
                              </span>
                            </button>
                            <button type="button" onClick={() => cancelAiPlanGroup(groupIndex)} className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200">
                              {t.cancel}
                            </button>
                          </div>
                          {group.reason && <div className="mt-1 px-2 text-xs leading-5 text-zinc-600">{group.reason}</div>}
                          <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
                            <div className="min-h-0 overflow-hidden">
                              <div className="mt-3 space-y-1.5">
                                {group.tabIds.map((tabId) => {
                                  const tab = tabsById.get(tabId)
                                  return (
                                    <div key={tabId} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                                      {tab ? <TabIcon tab={tab} /> : <span className="h-5 w-5 shrink-0 rounded-md bg-zinc-800 ring-1 ring-white/10" aria-hidden="true" />}
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium text-zinc-300">{tab?.title ?? t.newTabFallbackTabTitle.replace('{id}', String(tabId))}</span>
                                        <span className="block truncate text-[11px] text-zinc-600">{tab?.url ?? String(tabId)}</span>
                                      </span>
                                      <button type="button" onClick={() => removeAiPlanTab(groupIndex, tabId)} className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200" title={t.aiRemoveFromPlan}>
                                        {t.cancel}
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
                <div className="shrink-0 border-t border-white/10 bg-zinc-950/90 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="group/save flex min-w-0 cursor-pointer items-center gap-2 rounded-xl px-1 py-1">
                      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.08] ring-1 ring-white/20 transition group-hover/save:bg-white/[0.12] focus-within:ring-2 focus-within:ring-violet-400/70">
                        <input type="checkbox" checked={saveAiPlanAsRules} onChange={(event) => setSaveAiPlanAsRules(event.target.checked)} className="peer sr-only" />
                        <span className="absolute inset-0 rounded-md bg-violet-500 opacity-0 transition peer-checked:opacity-100" aria-hidden="true" />
                        <svg className="relative h-3.5 w-3.5 scale-75 text-white opacity-0 transition peer-checked:scale-100 peer-checked:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-zinc-300">{t.aiSaveAsRules}</span>
                        <span className="block truncate text-[11px] text-zinc-600">{t.aiSaveAsRulesDesc}</span>
                      </span>
                    </label>
                    <span className="flex shrink-0 items-center gap-2">
                      <GhostButton onClick={() => { setAiPlan(null); setSaveAiPlanAsRules(false) }} disabled={busy} className="px-3 py-1.5 text-xs">{t.cancel}</GhostButton>
                      <PrimaryButton onClick={applyAiPlan} disabled={busy || aiPlanTabCount === 0} className="px-3 py-1.5 text-xs">{t.aiApplyPlan}</PrimaryButton>
                    </span>
                  </div>
                </div>
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {snoozeTargetTabId !== null && (
            <SnoozeModal
              key="snooze-modal"
              onConfirm={(wakeUpAt, recurring) => void confirmSnooze(wakeUpAt, recurring)}
              onClose={() => setSnoozeTargetTabId(null)}
              t={t}
            />
          )}
        </AnimatePresence>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NewTab />
  </StrictMode>,
)
