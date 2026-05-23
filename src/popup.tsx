import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import { AppleIntelligenceGlow } from 'apple-intelligence-glow-react'
import './index.css'
import { COLOR_CLASS, STORAGE_KEYS } from './lib/constants'
import { getAiGroupingSettings, getLastHibernateResult, getPreferences, getRules, saveRules } from './lib/storage'
import { applyTheme } from './lib/theme'
import { GITHUB_ISSUES_URL, getExtensionVersion, openExternalUrl } from './lib/links'
import { getMessages } from './lib/i18n'
import { createGroupFromTabs, getCurrentWindowSnapshot } from './lib/grouping'
import type { AiGroupingPlan, AiGroupingSettings, AutoGroupRule, HibernateResult, LanguageMode, Preferences, RuleCondition, TabSnapshot, WindowSnapshot } from './lib/types'
import { EmptyState, GhostButton, PrimaryButton, TextInput } from './components/ui'

const MESSAGE_AUTO_DISMISS_MS = 5200

function runtimeAvailable() {
  return typeof chrome !== 'undefined' && Boolean(chrome.tabs && chrome.tabGroups)
}

function getTabFallbackLabel(tab: TabSnapshot) {
  try {
    const host = new URL(tab.url).hostname.replace(/^www\./, '')
    return host.charAt(0).toUpperCase() || '•'
  } catch {
    return '•'
  }
}

function getUrlConditionForTab(tab: TabSnapshot): RuleCondition {
  return {
    id: crypto.randomUUID(),
    target: 'url',
    mode: 'contains',
    pattern: tab.url.trim(),
  }
}

function createRuleFromManualGroup(groupTitle: string, tabs: TabSnapshot[]): AutoGroupRule {
  const seenPatterns = new Set<string>()
  const conditions = tabs
    .map(getUrlConditionForTab)
    .filter((condition) => {
      const key = condition.pattern
      if (seenPatterns.has(key)) return false
      seenPatterns.add(key)
      return Boolean(condition.pattern)
    })
  const [firstCondition] = conditions
  const now = Date.now()

  return {
    id: crypto.randomUUID(),
    name: groupTitle,
    enabled: true,
    target: firstCondition?.target ?? 'url',
    mode: firstCondition?.mode ?? 'contains',
    pattern: firstCondition?.pattern ?? groupTitle,
    conditions: conditions.length > 0 ? conditions : [{ id: crypto.randomUUID(), target: 'url', mode: 'contains', pattern: groupTitle }],
    groupTitle,
    color: 'blue',
    scope: 'currentWindow',
    createdAt: now,
    updatedAt: now,
  }
}


function TabIcon({ tab, className = '' }: { tab: TabSnapshot; className?: string }) {
  const [failed, setFailed] = useState(false)

  if (tab.favIconUrl && !failed) {
    return (
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-800 ring-1 ring-white/10 ${className}`}>
        <img src={tab.favIconUrl} alt="" className="h-4 w-4" onError={() => setFailed(true)} />
      </span>
    )
  }

  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-[10px] font-semibold text-zinc-500 ring-1 ring-white/10 ${className}`}>
      {getTabFallbackLabel(tab)}
    </span>
  )
}

export function Popup() {
  const isSidePanel = window.location.pathname.endsWith('/sidepanel.html')
  const [snapshot, setSnapshot] = useState<WindowSnapshot>({ groups: [], ungroupedTabs: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [message, setMessage] = useState('')
  const [messagePaused, setMessagePaused] = useState(false)
  const [aiError, setAiError] = useState('')
  const [languageMode, setLanguageMode] = useState<LanguageMode>('system')
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [aiSettings, setAiSettings] = useState<AiGroupingSettings | null>(null)
  const [aiPlan, setAiPlan] = useState<AiGroupingPlan | null>(null)
  const [saveAiPlanAsRules, setSaveAiPlanAsRules] = useState(false)
  const [lastHibernateResult, setLastHibernateResult] = useState<HibernateResult | undefined>()

  const allTabCount = useMemo(
    () => snapshot.ungroupedTabs.length + snapshot.groups.reduce((total, group) => total + group.tabs.length, 0),
    [snapshot],
  )
  const ungroupedTabIds = useMemo(() => snapshot.ungroupedTabs.map((tab) => tab.id), [snapshot.ungroupedTabs])
  const tabsById = useMemo(() => {
    return new Map([...snapshot.groups.flatMap((group) => group.tabs), ...snapshot.ungroupedTabs].map((tab) => [tab.id, tab]))
  }, [snapshot])
  const allUngroupedSelected = ungroupedTabIds.length > 0 && ungroupedTabIds.every((id) => selected.includes(id))
  const hasCollapsedGroups = snapshot.groups.some((group) => group.collapsed)
  const [collapsedAiGroups, setCollapsedAiGroups] = useState<Record<string, boolean>>({})

  const commitSnapshot = useCallback((next: WindowSnapshot) => {
    const liveTabIds = new Set([...next.groups.flatMap((group) => group.tabs), ...next.ungroupedTabs].map((tab) => tab.id))
    setSnapshot(next)
    setSelected((current) => current.filter((id) => liveTabIds.has(id)))
  }, [])

  const refresh = useCallback(async () => {
    if (!runtimeAvailable()) {
      setLoading(false)
      return
    }
    commitSnapshot(await getCurrentWindowSnapshot())
    setLoading(false)
  }, [commitSnapshot])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!runtimeAvailable()) {
        if (!cancelled) setLoading(false)
        return
      }
      const [preferences, hibernateResult, aiGroupingSettings] = await Promise.all([getPreferences(), getLastHibernateResult(), getAiGroupingSettings()])
      applyTheme(preferences.themeMode)
      const next = await getCurrentWindowSnapshot()
      if (!cancelled) {
        setLanguageMode(preferences.languageMode)
        setPreferences(preferences)
        setAiSettings(aiGroupingSettings)
        setLastHibernateResult(hibernateResult)
        commitSnapshot(next)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [commitSnapshot])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => {
      void getPreferences().then((preferences) => {
        if (preferences.themeMode === 'system') applyTheme('system')
      })
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (!message || messagePaused) return undefined
    const timer = window.setTimeout(() => setMessage(''), MESSAGE_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [message, messagePaused])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return

    const handleStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'sync' && changes[STORAGE_KEYS.preferences]) {
        void getPreferences().then((preferences) => {
          setPreferences(preferences)
          setLanguageMode(preferences.languageMode)
          applyTheme(preferences.themeMode)
        })
      }
      if (areaName === 'local' && changes[STORAGE_KEYS.aiGroupingSettings]) {
        void getAiGroupingSettings().then(setAiSettings)
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => chrome.storage.onChanged.removeListener(handleStorageChanged)
  }, [])

  useEffect(() => {
    if (!runtimeAvailable()) return

    let cancelled = false
    let refreshTimer: number | undefined

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        if (cancelled) return
        void refresh()
      }, 120)
    }

    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh()
    }

    chrome.tabs.onCreated.addListener(scheduleRefresh)
    chrome.tabs.onRemoved.addListener(scheduleRefresh)
    chrome.tabs.onUpdated.addListener(scheduleRefresh)
    chrome.tabs.onMoved.addListener(scheduleRefresh)
    chrome.tabs.onAttached.addListener(scheduleRefresh)
    chrome.tabs.onDetached.addListener(scheduleRefresh)
    chrome.tabGroups.onCreated.addListener(scheduleRefresh)
    chrome.tabGroups.onRemoved.addListener(scheduleRefresh)
    chrome.tabGroups.onUpdated.addListener(scheduleRefresh)
    window.addEventListener('focus', scheduleRefresh)
    document.addEventListener('visibilitychange', refreshOnVisible)

    return () => {
      cancelled = true
      window.clearTimeout(refreshTimer)
      chrome.tabs.onCreated.removeListener(scheduleRefresh)
      chrome.tabs.onRemoved.removeListener(scheduleRefresh)
      chrome.tabs.onUpdated.removeListener(scheduleRefresh)
      chrome.tabs.onMoved.removeListener(scheduleRefresh)
      chrome.tabs.onAttached.removeListener(scheduleRefresh)
      chrome.tabs.onDetached.removeListener(scheduleRefresh)
      chrome.tabGroups.onCreated.removeListener(scheduleRefresh)
      chrome.tabGroups.onRemoved.removeListener(scheduleRefresh)
      chrome.tabGroups.onUpdated.removeListener(scheduleRefresh)
      window.removeEventListener('focus', scheduleRefresh)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!aiPlan && !aiError) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAiPlan(null)
      setAiError('')
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [aiPlan, aiError])

  async function regroup() {
    setBusy(true)
    setMessage('')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_REGROUP' })
      setMessage(formatOrganizeStatus(response))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  function formatOrganizeStatus(
    response: { ok?: boolean; checked?: number; changed?: number; consolidated?: number; deduplicated?: { closed: number }; hibernated?: HibernateResult; error?: string },
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

  async function deduplicate() {
    setBusy(true)
    setMessage('')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_DEDUPLICATE' })
      if (!response?.ok) {
        setMessage(response?.error ?? t.failed)
        return
      }
      setMessage(response.closed > 0 ? t.deduplicated.replace('{count}', String(response.closed)) : t.noDuplicates)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function hibernate() {
    setBusy(true)
    setMessage('')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_HIBERNATE' })
      if (!response?.ok) {
        setMessage(response?.error ?? t.failed)
        return
      }
      setLastHibernateResult(response)
      setMessage(response.discarded > 0 ? t.hibernated.replace('{count}', String(response.discarded)) : t.noHibernateCandidates)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function generateAiPlan() {
    setBusy(true)
    setAiBusy(true)
    setMessage('')
    setAiError('')
    setAiPlan(null)
    try {
      if (aiSettings?.provider === 'compatible') {
        const origin = new URL(aiSettings.baseUrl).origin
        const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
        if (!granted) {
          setAiError(t.aiPermissionDenied)
          return
        }
      }
      const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_AI_GROUPING_PLAN' })
      if (!response?.ok) {
        setAiError(response?.error ?? t.failed)
        return
      }
      const plan = response.plan as AiGroupingPlan
      setAiPlan(plan)
      setSaveAiPlanAsRules(false)
      setCollapsedAiGroups(Object.fromEntries(plan.groups.map((group, index) => [`${index}-${group.tabIds.join('-')}`, index !== 0])))
      setMessage(t.aiPlanReady.replace('{groups}', String(plan.groups.length)).replace('{checked}', String(response.checked ?? 0)))
    } catch (error) {
      setAiError(error instanceof Error ? error.message : t.failed)
    } finally {
      setAiBusy(false)
      setBusy(false)
    }
  }

  async function applyAiPlan() {
    if (!aiPlan) return
    setBusy(true)
    setMessage('')
    setAiError('')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_AI_APPLY_GROUPING_PLAN', plan: aiPlan, saveRules: saveAiPlanAsRules })
      if (!response?.ok) {
        setAiError(response?.error ?? t.failed)
        return
      }
      setMessage(t.aiApplied.replace('{changed}', String(response.changed ?? 0)))
      setAiPlan(null)
      setSaveAiPlanAsRules(false)
      await refresh()
    } catch (error) {
      setAiError(error instanceof Error ? error.message : t.failed)
    } finally {
      setBusy(false)
    }
  }

  function getAiPlanGroupKey(index: number) {
    const group = aiPlan?.groups[index]
    return group ? `${index}-${group.tabIds.join('-')}` : String(index)
  }

  function toggleAiPlanGroup(index: number) {
    const key = getAiPlanGroupKey(index)
    setCollapsedAiGroups((current) => ({ ...current, [key]: !current[key] }))
  }

  function updateAiPlanGroupTitle(index: number, title: string, commit = false) {
    const nextTitle = commit ? title.replace(/\s+/g, ' ').trim().slice(0, 32) : title.slice(0, 32)
    if (commit && !nextTitle) return
    setAiPlan((current) => {
      if (!current) return current
      return {
        ...current,
        groups: current.groups.map((group, groupIndex) => groupIndex === index ? { ...group, title: nextTitle } : group),
      }
    })
  }

  function cancelAiPlanGroup(index: number) {
    setAiPlan((current) => {
      if (!current) return current
      const group = current.groups[index]
      if (!group) return current
      return {
        ...current,
        groups: current.groups.filter((_, groupIndex) => groupIndex !== index),
        ungroupedTabIds: [...new Set([...current.ungroupedTabIds, ...group.tabIds])],
      }
    })
  }

  function removeAiPlanTab(groupIndex: number, tabId: number) {
    setAiPlan((current) => {
      if (!current) return current
      const groups = current.groups
        .map((group, index) => index === groupIndex
          ? { ...group, tabIds: group.tabIds.filter((id) => id !== tabId) }
          : group)
        .filter((group) => group.tabIds.length > 0)
      return {
        ...current,
        groups,
        ungroupedTabIds: [...new Set([...current.ungroupedTabIds, tabId])],
      }
    })
  }

  async function toggleGroup(groupId: number, collapsed: boolean) {
    await chrome.tabGroups.update(groupId, { collapsed: !collapsed })
    await refresh()
  }

  async function setAllGroupsCollapsed(collapsed: boolean) {
    const targetGroups = snapshot.groups.filter((group) => group.collapsed !== collapsed)
    if (targetGroups.length === 0) return
    await Promise.all(
      targetGroups.map((group) =>
        chrome.tabGroups.update(group.id, { collapsed }).catch(() => undefined),
      ),
    )
    await refresh()
  }

  async function closeGroup(tabIds: number[]) {
    await chrome.tabs.remove(tabIds)
    await refresh()
  }

  async function ungroupGroup(tabIds: number[]) {
    if (tabIds.length === 0) return
    await chrome.tabs.ungroup(tabIds as [number, ...number[]])
    await refresh()
  }

  async function closeTab(tabId: number) {
    await chrome.tabs.remove(tabId)
    await refresh()
  }

  async function activateTab(tabId: number) {
    await chrome.tabs.update(tabId, { active: true })
    if (!isSidePanel) window.close()
  }

  async function createManualGroup() {
    if (!selected.length || !newGroupTitle.trim()) return
    const title = newGroupTitle.trim()
    const selectedTabs = snapshot.ungroupedTabs.filter((tab) => selected.includes(tab.id))
    if (selectedTabs.length === 0) return
    const rules = await getRules()
    const rule = createRuleFromManualGroup(title, selectedTabs)
    await saveRules([rule, ...rules])
    await createGroupFromTabs(selected, title, 'blue')
    setMessage(t.manualGroupSaved.replace('{name}', title))
    setSelected([])
    setNewGroupTitle('')
    await refresh()
  }

  const t = getMessages(languageMode)
  const controlsReady = Boolean(preferences)
  const deduplicateOnOrganize = preferences?.deduplicateOnOrganize ?? false
  const organizeLabel = t.organize
  const aiVisible = Boolean(aiSettings?.enabled)
  const aiHasApiKey = Boolean(aiSettings?.apiKey.split(/[,\n]/).some((key) => key.trim()))
  const aiReady = Boolean(aiVisible && aiHasApiKey && aiSettings?.model.trim() && (aiSettings.provider !== 'compatible' || aiSettings.baseUrl.trim()))
  const controlGridClass = deduplicateOnOrganize
    ? aiVisible ? 'grid-cols-3' : 'grid-cols-2'
    : aiVisible ? 'grid-cols-4' : 'grid-cols-3'
  const extensionVersion = getExtensionVersion()
  const aiPlanTabCount = aiPlan?.groups.reduce((total, group) => total + group.tabIds.length, 0) ?? 0
  const lastHibernateText = lastHibernateResult
    ? t.hibernateLastResult
      .replace('{count}', String(lastHibernateResult.discarded))
      .replace('{checked}', String(lastHibernateResult.checked))
    : ''

  return (
    <div className={`relative ${isSidePanel ? 'h-screen w-screen min-w-[320px]' : 'h-[600px] w-[420px]'}`}>
    <main
      data-density={preferences?.uiDensity ?? 'default'}
      className="relative z-0 flex h-full w-full flex-col overflow-hidden popup-surface text-zinc-100 shadow-2xl shadow-black/40 ring-1 ring-white/10"
    >
      <section className="shrink-0 border-b border-white/10 px-4 py-3">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-violet-300">TabWeave</div>
              <h1 className="mt-0.5 truncate text-xl font-semibold tracking-[-0.04em]" title={t.popupTitle}>{t.popupTitle}</h1>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {t.currentWindowStats.replace('{tabs}', String(allTabCount)).replace('{groups}', String(snapshot.groups.length))}
              </p>
              {lastHibernateText && <p className="mt-0.5 truncate text-[11px] text-zinc-600">{lastHibernateText}</p>}
            </div>
            <GhostButton onClick={() => chrome.runtime.openOptionsPage()} className="shrink-0 px-2.5 py-2 text-xs">
              {t.settings}
            </GhostButton>
          </div>

          {controlsReady ? (
            <div className={`grid gap-2 ${controlGridClass}`}>
              <AnimatePresence initial={false}>
                {!deduplicateOnOrganize && (
                  <motion.div
                    key="deduplicate-now"
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
                    className="min-w-0"
                  >
                    <GhostButton onClick={deduplicate} disabled={busy || aiBusy || loading} className="w-full min-w-0 truncate whitespace-nowrap px-2.5 py-2 text-xs">
                      {t.deduplicateNow}
                    </GhostButton>
                  </motion.div>
                )}
              </AnimatePresence>
              <GhostButton onClick={hibernate} disabled={busy || aiBusy || loading} className="w-full min-w-0 truncate whitespace-nowrap px-2.5 py-2 text-xs">
                {t.hibernateNow}
              </GhostButton>
              {aiVisible && (
                <GhostButton onClick={generateAiPlan} disabled={busy || aiBusy || loading || !aiReady} className="w-full min-w-0 truncate whitespace-nowrap px-2.5 py-2 text-xs" title={aiReady ? t.aiOrganize : t.aiNeedsSetup}>
                  {aiBusy ? t.organizing : t.aiOrganize}
                </GhostButton>
              )}
              <motion.div layout transition={{ type: 'spring', duration: 0.34, bounce: 0 }} className="min-w-0">
                <PrimaryButton
                  onClick={regroup}
                  disabled={busy || aiBusy || loading}
                  className={`w-full min-w-0 truncate whitespace-nowrap px-2.5 py-2 text-xs transition-[box-shadow,transform] ${
                    deduplicateOnOrganize ? 'shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-300/40' : ''
                  }`}
                  title={busy ? t.organizing : deduplicateOnOrganize ? t.organizeWithDeduplication : organizeLabel}
                >
                  {busy ? t.organizing : organizeLabel}
                </PrimaryButton>
              </motion.div>
            </div>
          ) : (
            <div className="h-8" aria-hidden="true" />
          )}
        </div>
        <AnimatePresence initial={false}>
          {message && (
            <motion.div
              key="status-message"
              className="theme-light-toast mt-3 rounded-xl bg-violet-500/10 px-3 py-2 text-xs text-violet-200"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
              onMouseEnter={() => setMessagePaused(true)}
              onMouseLeave={() => setMessagePaused(false)}
              onFocus={() => setMessagePaused(true)}
              onBlur={() => setMessagePaused(false)}
            >
              {message}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section className="soft-scrollbar scroll-mask-y-10 min-h-0 flex-1 overflow-auto pb-4">
        {!runtimeAvailable() && (
          <div className="px-4 pt-4"><EmptyState title={t.runtimeTitle} description={t.runtimeDesc} /></div>
        )}

        {runtimeAvailable() && loading && <div className="px-4 py-12 text-center text-sm text-zinc-500">{t.loadingTabs}</div>}

        {!loading && runtimeAvailable() && (
          <div className="space-y-5">
            <div>
              <div className="sticky top-0 z-20 mb-3 flex min-h-11 items-center justify-between border-b border-white/10 bg-zinc-950 px-2.5 py-2 shadow-[0_10px_24px_rgba(9,9,11,.72)] theme-light-soft-sticky">
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Groups</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void setAllGroupsCollapsed(!hasCollapsedGroups)}
                    disabled={snapshot.groups.length === 0}
                    className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {hasCollapsedGroups ? t.expandAllGroups : t.collapseAllGroups}
                  </button>
                  <span className="rounded-xl bg-zinc-900/70 px-2 py-1 text-xs font-medium text-zinc-500 ring-1 ring-white/10">{snapshot.groups.length}</span>
                </div>
              </div>
              {snapshot.groups.length === 0 ? (
                <div className="px-2.5"><EmptyState title={t.noGroups} description={t.noGroupsDesc} /></div>
              ) : (
                <div className="space-y-3 px-2.5">
                  {snapshot.groups.map((group) => (
                    <div key={group.id} className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                      <div className="flex items-center gap-2 rounded-xl">
                        <button onClick={() => toggleGroup(group.id, group.collapsed)} className="group/header flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/5">
                          <span className={`h-2.5 w-2.5 rounded-full ${COLOR_CLASS[group.color]}`} />
                          <span className="truncate text-sm font-semibold">{group.title}</span>
                          <span className="text-xs text-zinc-500">{group.tabs.length}</span>
                          <svg className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-300 ${group.collapsed ? '-rotate-90' : 'rotate-0'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => void ungroupGroup(group.tabs.map((tab) => tab.id))}
                          className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                          title={t.ungroupGroup}
                        >
                          {t.ungroupGroup}
                        </button>
                        <button
                          type="button"
                          onClick={() => void closeGroup(group.tabs.map((tab) => tab.id))}
                          className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300"
                          title={t.closeGroup}
                        >
                          {t.close}
                        </button>
                      </div>
                      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${group.collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'}`}>
                        <div className="min-h-0 overflow-hidden">
                          <div className="mt-3 space-y-1.5">
                            {group.tabs.slice(0, 5).map((tab) => (
                              <div key={tab.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-white/5">
                                <button onClick={() => activateTab(tab.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                                  <TabIcon tab={tab} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium text-zinc-300">{tab.title}</span>
                                    <span className="block truncate text-[11px] text-zinc-600">{tab.url}</span>
                                  </span>
                                </button>
                                <button onClick={() => closeTab(tab.id)} className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] text-zinc-600 transition hover:bg-red-500/10 hover:text-red-300" title={t.closeTab}>
                                  {t.close}
                                </button>
                              </div>
                            ))}
                            {group.tabs.length > 5 && <div className="px-2 pt-1 text-xs text-zinc-600">{t.moreTabs.replace('{count}', String(group.tabs.length - 5))}</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="sticky top-0 z-20 mb-3 flex min-h-11 items-center justify-between border-b border-white/10 bg-zinc-950 px-2.5 py-2 shadow-[0_10px_24px_rgba(9,9,11,.72)] theme-light-soft-sticky">
                <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Ungrouped</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelected(allUngroupedSelected ? [] : ungroupedTabIds)}
                    disabled={ungroupedTabIds.length === 0}
                    className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {allUngroupedSelected ? t.clearSelection : t.selectAllTabs}
                  </button>
                  <span className="rounded-xl bg-zinc-900/70 px-2 py-1 text-xs font-medium text-zinc-500 ring-1 ring-white/10">{snapshot.ungroupedTabs.length}</span>
                </div>
              </div>
              <div className="space-y-2 px-2.5">
                {snapshot.ungroupedTabs.map((tab) => (
                  <div key={tab.id} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/10">
                    <input
                      type="checkbox"
                      checked={selected.includes(tab.id)}
                      onChange={(event) => setSelected((current) => event.target.checked ? [...current, tab.id] : current.filter((id) => id !== tab.id))}
                      className="accent-violet-500"
                      aria-label={`${t.add} ${tab.title}`}
                    />
                    <TabIcon tab={tab} />
                    <button type="button" onClick={() => activateTab(tab.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-xs font-medium text-zinc-200">{tab.title}</div>
                      <div className="truncate text-[11px] text-zinc-600">{tab.url}</div>
                    </button>
                    <button type="button" onClick={() => closeTab(tab.id)} className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] text-zinc-600 transition hover:bg-red-500/10 hover:text-red-300" title={t.closeTab}>
                      {t.close}
                    </button>
                  </div>
                ))}
                {snapshot.ungroupedTabs.length === 0 && <div className="px-2.5 text-xs text-zinc-600">{t.allGrouped}</div>}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="shrink-0 border-t border-white/10 bg-zinc-950/90 p-2.5 shadow-[0_-10px_24px_rgba(9,9,11,.22)] theme-light-footer-divider">
        {selected.length > 0 ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <div>
                <span className="font-medium text-zinc-300">{t.manualGroup}</span>
                <span className="ml-2 text-zinc-600">{t.selectedTabs.replace('{count}', String(selected.length))}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <TextInput value={newGroupTitle} onChange={(event) => setNewGroupTitle(event.target.value)} placeholder={t.groupNamePlaceholder} />
              <PrimaryButton onClick={createManualGroup} disabled={!newGroupTitle.trim()} className="shrink-0">{t.createGroup}</PrimaryButton>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-zinc-600">{t.selectToGroup}</span>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => void openExternalUrl(GITHUB_ISSUES_URL)}
                className="text-zinc-500 underline decoration-zinc-700/60 underline-offset-4 transition hover:text-violet-300 hover:decoration-violet-400/40"
              >
                {t.feedback}
              </button>
              <span className="text-zinc-700">v{extensionVersion}</span>
            </span>
          </div>
        )}
      </section>

      <AnimatePresence>
        {aiError && (
          <motion.div
            key="ai-error-modal"
            className="fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setAiError('')}
          >
            <motion.section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="ai-error-title"
              className="ai-plan-modal flex max-h-[min(520px,calc(100dvh-2rem))] w-full max-w-[520px] flex-col overflow-hidden rounded-[22px] bg-zinc-950/96 text-zinc-100 shadow-2xl shadow-black/50 ring-1 ring-white/12"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.97 }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="ai-plan-modal-header flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
                <div className="min-w-0">
                  <h2 id="ai-error-title" className="text-base font-semibold tracking-[-0.02em]">{t.aiGrouping}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{t.failed}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAiError('')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                  aria-label={t.close}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>

              <div className="ai-plan-scroll scroll-mask-y-8 min-h-0 flex-1 overflow-auto px-4 py-3">
                <pre className="whitespace-pre-wrap break-words rounded-2xl bg-red-500/[0.08] px-3 py-3 font-mono text-[11px] leading-5 text-red-200 ring-1 ring-red-400/[0.15]">{aiError}</pre>
              </div>

              <div className="ai-plan-modal-footer flex shrink-0 justify-end border-t border-white/10 bg-zinc-950/90 px-4 py-3">
                <GhostButton onClick={() => setAiError('')} className="px-3 py-1.5 text-xs">{t.close}</GhostButton>
              </div>
            </motion.section>
          </motion.div>
        )}

        {aiPlan && (
          <motion.div
            key="ai-plan-modal"
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
              aria-labelledby="ai-plan-title"
              className="ai-plan-modal flex max-h-[min(680px,calc(100dvh-2rem))] w-full max-w-[520px] flex-col overflow-hidden rounded-[24px] bg-zinc-950/96 text-zinc-100 shadow-2xl shadow-black/50 ring-1 ring-white/12"
              initial={{ opacity: 0, y: 22, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.96 }}
              transition={{ type: 'spring', duration: 0.34, bounce: 0 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="ai-plan-modal-header shrink-0 border-b border-white/10 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 id="ai-plan-title" className="text-lg font-semibold tracking-[-0.03em]">{t.aiPlanTitle}</h2>
                      <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-white/10">
                        {t.aiPlanTabCount.replace('{count}', String(aiPlanTabCount))}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">{t.aiPlanDesc}</p>
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

              <div className="ai-plan-scroll soft-scrollbar scroll-mask-y-8 min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3">
                {aiPlan.groups.length === 0 ? (
                  <div className="rounded-2xl bg-white/[0.04] px-4 py-8 text-center text-sm text-zinc-500 ring-1 ring-white/10">{t.aiNoPlan}</div>
                ) : (
                  aiPlan.groups.map((group, groupIndex) => {
                    const groupKey = getAiPlanGroupKey(groupIndex)
                    const collapsed = Boolean(collapsedAiGroups[groupKey])
                    return (
                      <div key={groupKey} className="ai-plan-card rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleAiPlanGroup(groupIndex)}
                            className="ai-plan-card-button group/header flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-white/5"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className={`h-2.5 w-2.5 rounded-full ${COLOR_CLASS[group.color]}`} />
                              <input
                                value={group.title}
                                data-previous-title={group.title}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => updateAiPlanGroupTitle(groupIndex, event.target.value)}
                                onFocus={(event) => {
                                  event.currentTarget.dataset.previousTitle = group.title
                                }}
                                onBlur={(event) => {
                                  const fallbackTitle = event.currentTarget.dataset.previousTitle || group.title
                                  updateAiPlanGroupTitle(groupIndex, event.currentTarget.value.trim() ? event.currentTarget.value : fallbackTitle, true)
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') event.currentTarget.blur()
                                  if (event.key === 'Escape') {
                                    updateAiPlanGroupTitle(groupIndex, event.currentTarget.dataset.previousTitle || group.title)
                                    event.currentTarget.blur()
                                  }
                                }}
                                aria-label={t.aiPlanGroupTitle}
                                className="ai-plan-title-input min-w-0 max-w-[180px] flex-1 rounded-lg bg-white/[0.04] px-2 py-1 text-sm font-semibold text-zinc-100 outline-none ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:ring-white/15 focus:bg-white/[0.07] focus:ring-violet-400/50"
                              />
                              <span className="text-xs text-zinc-500">{group.tabIds.length}</span>
                              <svg className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-300 ${collapsed ? '-rotate-90' : 'rotate-0'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelAiPlanGroup(groupIndex)}
                            className="ai-plan-card-action shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
                          >
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
                                  <div key={tabId} className="ai-plan-tab-row flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5">
                                    {tab ? <TabIcon tab={tab} /> : <span className="h-5 w-5 shrink-0 rounded-md bg-zinc-800 ring-1 ring-white/10" aria-hidden="true" />}
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-xs font-medium text-zinc-300">{tab?.title ?? `Tab ${tabId}`}</span>
                                      <span className="block truncate text-[11px] text-zinc-600">{tab?.url ?? String(tabId)}</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => removeAiPlanTab(groupIndex, tabId)}
                                      className="ai-plan-card-action shrink-0 whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] text-zinc-600 transition hover:bg-white/5 hover:text-zinc-200"
                                      title={t.aiRemoveFromPlan}
                                    >
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

              <div className="ai-plan-modal-footer shrink-0 border-t border-white/10 bg-zinc-950/90 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="group/save flex min-w-0 cursor-pointer items-center gap-2 rounded-xl px-1 py-1">
                    <span className="ai-plan-save-checkbox relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.08] ring-1 ring-white/20 transition group-hover/save:bg-white/[0.12] focus-within:ring-2 focus-within:ring-violet-400/70">
                      <input
                        type="checkbox"
                        checked={saveAiPlanAsRules}
                        onChange={(event) => setSaveAiPlanAsRules(event.target.checked)}
                        className="peer sr-only"
                      />
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
                    <GhostButton
                      onClick={() => {
                        setAiPlan(null)
                        setSaveAiPlanAsRules(false)
                      }}
                      disabled={busy}
                      className="px-3 py-1.5 text-xs"
                    >
                      {t.cancel}
                    </GhostButton>
                    <PrimaryButton onClick={applyAiPlan} disabled={busy || aiPlanTabCount === 0} className="px-3 py-1.5 text-xs">{t.aiApplyPlan}</PrimaryButton>
                  </span>
                </div>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
    {aiBusy && (
      <div className="pointer-events-none absolute inset-0 z-40">
        <AppleIntelligenceGlow
          radius={22}
          className="ai-response-glow h-full w-full rounded-[22px]"
          style={{ width: '100%', height: '100%' }}
        >
          <div className="h-full w-full rounded-[22px]" aria-hidden="true" />
        </AppleIntelligenceGlow>
      </div>
    )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
)
