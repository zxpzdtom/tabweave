import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import './index.css'
import { COLOR_CLASS } from './lib/constants'
import { getLastHibernateResult, getPreferences, getRules, saveRules } from './lib/storage'
import { applyTheme } from './lib/theme'
import { GITHUB_ISSUES_URL, getExtensionVersion, openExternalUrl } from './lib/links'
import { getMessages } from './lib/i18n'
import { applyRulesToTabs, collapseGroupsByScope, createGroupFromTabs, getCurrentWindowSnapshot, queryTabsByScope } from './lib/grouping'
import type { AutoGroupRule, HibernateResult, LanguageMode, Preferences, RuleCondition, TabSnapshot, WindowSnapshot } from './lib/types'
import { EmptyState, GhostButton, PrimaryButton, TextInput } from './components/ui'

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
  const [snapshot, setSnapshot] = useState<WindowSnapshot>({ groups: [], ungroupedTabs: [] })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [message, setMessage] = useState('')
  const [languageMode, setLanguageMode] = useState<LanguageMode>('system')
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [lastHibernateResult, setLastHibernateResult] = useState<HibernateResult | undefined>()

  const allTabCount = useMemo(
    () => snapshot.ungroupedTabs.length + snapshot.groups.reduce((total, group) => total + group.tabs.length, 0),
    [snapshot],
  )
  const ungroupedTabIds = useMemo(() => snapshot.ungroupedTabs.map((tab) => tab.id), [snapshot.ungroupedTabs])
  const allUngroupedSelected = ungroupedTabIds.length > 0 && ungroupedTabIds.every((id) => selected.includes(id))
  const hasCollapsedGroups = snapshot.groups.some((group) => group.collapsed)

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
      const [preferences, hibernateResult] = await Promise.all([getPreferences(), getLastHibernateResult()])
      applyTheme(preferences.themeMode)
      let next = await getCurrentWindowSnapshot()
      if (preferences.autoGroupOnPopupOpen) {
        const rules = await getRules()
        const tabs = await queryTabsByScope(preferences.organizeScope)
        await applyRulesToTabs(rules, tabs, preferences.domainFallbackGrouping, preferences.groupMinTabs)
        if (preferences.autoCollapseGroups) await collapseGroupsByScope(preferences.organizeScope)
        next = await getCurrentWindowSnapshot()
      }
      if (!cancelled) {
        setLanguageMode(preferences.languageMode)
        setPreferences(preferences)
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

  async function regroup() {
    setBusy(true)
    setMessage('')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_REGROUP' })
      setMessage(formatOrganizeStatus(response, preferences?.organizeScope ?? 'currentWindow'))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  function formatOrganizeStatus(
    response: { ok?: boolean; checked?: number; changed?: number; deduplicated?: { closed: number }; hibernated?: HibernateResult; error?: string },
    organizeScope: Preferences['organizeScope'],
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

  async function closeTab(tabId: number) {
    await chrome.tabs.remove(tabId)
    await refresh()
  }

  async function activateTab(tabId: number) {
    await chrome.tabs.update(tabId, { active: true })
    window.close()
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
  const organizeLabel = deduplicateOnOrganize ? t.organizeWithDeduplication : t.organize
  const extensionVersion = getExtensionVersion()
  const lastHibernateText = lastHibernateResult
    ? t.hibernateLastResult
      .replace('{count}', String(lastHibernateResult.discarded))
      .replace('{checked}', String(lastHibernateResult.checked))
    : ''

  return (
    <main className="flex h-[600px] w-[420px] flex-col overflow-hidden popup-surface text-zinc-100 shadow-2xl shadow-black/40 ring-1 ring-white/10">
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
            <div className={`grid gap-2 ${deduplicateOnOrganize ? 'grid-cols-2' : 'grid-cols-3'}`}>
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
                    <GhostButton onClick={deduplicate} disabled={busy || loading} className="w-full min-w-0 truncate whitespace-nowrap px-2.5 py-2 text-xs">
                      {t.deduplicateNow}
                    </GhostButton>
                  </motion.div>
                )}
              </AnimatePresence>
              <GhostButton onClick={hibernate} disabled={busy || loading} className="w-full min-w-0 truncate whitespace-nowrap px-2.5 py-2 text-xs">
                {t.hibernateNow}
              </GhostButton>
              <motion.div layout transition={{ type: 'spring', duration: 0.34, bounce: 0 }} className="min-w-0">
                <PrimaryButton
                  onClick={regroup}
                  disabled={busy || loading}
                  className={`w-full min-w-0 truncate whitespace-nowrap px-2.5 py-2 text-xs transition-[box-shadow,transform] ${
                    deduplicateOnOrganize ? 'shadow-lg shadow-emerald-500/20 ring-2 ring-emerald-300/40' : ''
                  }`}
                  title={busy ? t.organizing : organizeLabel}
                >
                  {busy ? t.organizing : organizeLabel}
                </PrimaryButton>
              </motion.div>
            </div>
          ) : (
            <div className="h-8" aria-hidden="true" />
          )}
        </div>
        {message && <div className="mt-3 rounded-xl bg-violet-500/10 px-3 py-2 text-xs text-violet-200">{message}</div>}
      </section>

      <section className="soft-scrollbar scroll-mask-y-10 min-h-0 flex-1 overflow-auto pb-4">
        {!runtimeAvailable() && (
          <div className="px-4 pt-4"><EmptyState title={t.runtimeTitle} description={t.runtimeDesc} /></div>
        )}

        {runtimeAvailable() && loading && <div className="px-4 py-12 text-center text-sm text-zinc-500">{t.loadingTabs}</div>}

        {!loading && runtimeAvailable() && (
          <div className="space-y-5">
            <div>
              <div className="sticky top-0 z-20 mb-3 flex min-h-11 items-center justify-between border-b border-white/10 bg-zinc-950 px-4 py-2 shadow-[0_10px_24px_rgba(9,9,11,.72)] theme-light-soft-sticky">
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
                <div className="px-4"><EmptyState title={t.noGroups} description={t.noGroupsDesc} /></div>
              ) : (
                <div className="space-y-3 px-4">
                  {snapshot.groups.map((group) => (
                    <div key={group.id} className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                      <button onClick={() => toggleGroup(group.id, group.collapsed)} className="group/header flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/5">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${COLOR_CLASS[group.color]}`} />
                          <span className="truncate text-sm font-semibold">{group.title}</span>
                          <span className="text-xs text-zinc-500">{group.tabs.length}</span>
                          <svg className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform duration-300 ${group.collapsed ? '-rotate-90' : 'rotate-0'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation()
                            void closeGroup(group.tabs.map((tab) => tab.id))
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            event.stopPropagation()
                            void closeGroup(group.tabs.map((tab) => tab.id))
                          }}
                          className="rounded-lg px-2 py-1 text-xs text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300"
                        >
                          {t.close}
                        </span>
                      </button>
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
                                <button onClick={() => closeTab(tab.id)} className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-zinc-600 transition hover:bg-red-500/10 hover:text-red-300" title={t.closeTab}>
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
              <div className="sticky top-0 z-20 mb-3 flex min-h-11 items-center justify-between border-b border-white/10 bg-zinc-950 px-4 py-2 shadow-[0_10px_24px_rgba(9,9,11,.72)] theme-light-soft-sticky">
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
              <div className="space-y-2 px-4">
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
                    <button type="button" onClick={() => closeTab(tab.id)} className="shrink-0 rounded-md px-1.5 py-1 text-[11px] text-zinc-600 transition hover:bg-red-500/10 hover:text-red-300" title={t.closeTab}>
                      {t.close}
                    </button>
                  </div>
                ))}
                {snapshot.ungroupedTabs.length === 0 && <div className="px-4 text-xs text-zinc-600">{t.allGrouped}</div>}
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
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
)
