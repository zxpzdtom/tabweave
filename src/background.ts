import { getAiGroupingSettings, getPreferences, getRules, getSnapshots, getSnoozedTabs, saveSnoozedTabs, saveSnapshots } from './lib/storage'
import { applyRulesToTabs, collapseGroupsByScope, consolidateDuplicateGroupsForTabs, queryTabsByScope } from './lib/grouping'
import { applyAiGroupingPlan, generateAiGroupingPlan } from './lib/ai/grouping'
import { deduplicateByScope } from './lib/deduplication'
import { hibernateByScope } from './lib/hibernation'
import { activateCommandItem, searchCommandItems, type CommandSearchItem } from './lib/command-search'
import { getMessages, resolveLanguage } from './lib/i18n'
import type { ChromeGroupColor, Preferences, SessionSnapshot, SnoozeItem } from './lib/types'

const HIBERNATE_ALARM_NAME = 'tabweave.hibernate'
const SNOOZE_ALARM_PREFIX = 'tabweave.snooze.'
const COMMAND_CONTENT_SCRIPT = 'command-content.js'
const POPUP_PATH = 'popup.html'
const SIDE_PANEL_PATH = 'sidepanel.html'

async function snoozeTab(tabId: number, wakeUpAt: number, recurring?: { hour: number; minute: number }) {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.url) return

  const snoozeId = crypto.randomUUID()
  const item: SnoozeItem = {
    id: snoozeId,
    url: tab.url,
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl,
    wakeUpAt,
    createdAt: Date.now(),
    recurring,
  }

  const current = await getSnoozedTabs()
  await saveSnoozedTabs([...current, item])
  await chrome.alarms.create(`${SNOOZE_ALARM_PREFIX}${snoozeId}`, { when: wakeUpAt })
  await chrome.tabs.remove(tabId)
}

async function snoozeTabs(
  tabIds: number[],
  wakeUpAt: number,
  recurring?: { hour: number; minute: number },
  groupInfo?: { title: string; color: ChromeGroupColor },
) {
  // Collect all tab info first before any removals
  const tabInfos: { tabId: number; url: string; title: string; favIconUrl?: string }[] = []
  for (const tabId of tabIds) {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (tab.url) {
        tabInfos.push({ tabId, url: tab.url, title: tab.title ?? '', favIconUrl: tab.favIconUrl })
      }
    } catch {
      // Tab may have already been closed
    }
  }

  if (tabInfos.length === 0) return

  // Use a single shared groupId and one alarm for the whole group
  const groupId = crypto.randomUUID()
  const now = Date.now()

  const newItems: SnoozeItem[] = tabInfos.map((info) => ({
    id: crypto.randomUUID(),
    url: info.url,
    title: info.title,
    favIconUrl: info.favIconUrl,
    wakeUpAt,
    createdAt: now,
    recurring,
    groupId,
    groupTitle: groupInfo?.title,
    groupColor: groupInfo?.color,
  }))

  // Save all items in one batch
  const current = await getSnoozedTabs()
  await saveSnoozedTabs([...current, ...newItems])

  // Create only ONE alarm for the group (keyed by groupId)
  await chrome.alarms.create(`${SNOOZE_ALARM_PREFIX}${groupId}`, { when: wakeUpAt })

  // Remove all tabs at once
  const tabIdsToRemove = tabInfos.map((info) => info.tabId)
  try {
    await chrome.tabs.remove(tabIdsToRemove)
  } catch {
    // Some tabs may already have been closed; remove individually
    for (const id of tabIdsToRemove) {
      try { await chrome.tabs.remove(id) } catch { /* ignore */ }
    }
  }
}

function computeNextRecurringWakeUp(hour: number, minute: number): number {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime()
}

async function wakeUpByAlarmKey(alarmKey: string) {
  const items = await getSnoozedTabs()

  // Find items: alarmKey may be an item.id (single tab) or a groupId (group snooze)
  const singleItem = items.find((i) => i.id === alarmKey)
  const toWake = singleItem
    ? [singleItem]
    : items.filter((i) => i.groupId === alarmKey)

  if (toWake.length === 0) return

  // Restore all tabs
  await Promise.all(toWake.map((item) => chrome.tabs.create({ url: item.url })))

  // Update storage: reschedule recurring, remove one-shot
  if (toWake[0].recurring) {
    const nextWakeUp = computeNextRecurringWakeUp(toWake[0].recurring.hour, toWake[0].recurring.minute)
    const wakeIds = new Set(toWake.map((i) => i.id))
    await saveSnoozedTabs(items.map((i) => wakeIds.has(i.id) ? { ...i, wakeUpAt: nextWakeUp } : i))
    await chrome.alarms.create(`${SNOOZE_ALARM_PREFIX}${alarmKey}`, { when: nextWakeUp })
  } else {
    const wakeIds = new Set(toWake.map((i) => i.id))
    await saveSnoozedTabs(items.filter((i) => !wakeIds.has(i.id)))
  }
}

async function wakeUpSnoozedItem(snoozeId: string) {
  // Manual wake-up from UI — wakes a single item, or the entire group if it belongs to one
  const items = await getSnoozedTabs()
  const item = items.find((i) => i.id === snoozeId)
  if (!item) return

  // If item belongs to a group, wake the entire group
  const toWake = item.groupId
    ? items.filter((i) => i.groupId === item.groupId)
    : [item]

  // Restore all tabs
  await Promise.all(toWake.map((i) => chrome.tabs.create({ url: i.url })))

  const wakeIds = new Set(toWake.map((i) => i.id))

  if (item.recurring) {
    const nextWakeUp = computeNextRecurringWakeUp(item.recurring.hour, item.recurring.minute)
    await saveSnoozedTabs(items.map((i) => wakeIds.has(i.id) ? { ...i, wakeUpAt: nextWakeUp } : i))
    const alarmKey = item.groupId ?? item.id
    await chrome.alarms.create(`${SNOOZE_ALARM_PREFIX}${alarmKey}`, { when: nextWakeUp })
  } else {
    await saveSnoozedTabs(items.filter((i) => !wakeIds.has(i.id)))
    // Clear the alarm
    const alarmKey = item.groupId ?? item.id
    await chrome.alarms.clear(`${SNOOZE_ALARM_PREFIX}${alarmKey}`)
  }
}

async function updateActionSurface(preferences?: Preferences) {
  const resolvedPreferences = preferences ?? await getPreferences()
  if (!chrome.sidePanel) return

  await Promise.all([
    chrome.action.setPopup({ popup: resolvedPreferences.openInSidePanel ? '' : POPUP_PATH }),
    chrome.sidePanel.setOptions({
      path: SIDE_PANEL_PATH,
      enabled: resolvedPreferences.openInSidePanel,
    }),
    chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: resolvedPreferences.openInSidePanel,
    }),
  ])
}

async function updateHibernateAlarm(preferences?: Preferences) {
  const resolvedPreferences = preferences ?? await getPreferences()
  await chrome.alarms.clear(HIBERNATE_ALARM_NAME)
  if (!resolvedPreferences.autoHibernateTabs) return
  await chrome.alarms.create(HIBERNATE_ALARM_NAME, { periodInMinutes: 5 })
}

async function regroupCurrentWindow(preferences?: Preferences) {
  const resolvedPreferences = preferences ?? await getPreferences()
  const deduplicated = resolvedPreferences.deduplicateOnOrganize
    ? await deduplicateByScope(resolvedPreferences.duplicateScope)
    : { closed: 0, duplicates: 0 }
  const hibernated = resolvedPreferences.hibernateOnOrganize
    ? await hibernateByScope(resolvedPreferences)
    : { discarded: 0, checked: 0, candidates: 0, skipped: 0, timestamp: Date.now() }
  const rules = await getRules()
  const tabs = await queryTabsByScope(resolvedPreferences.organizeScope)
  const changed = await applyRulesToTabs(
    rules,
    tabs,
    resolvedPreferences.domainFallbackGrouping,
    resolvedPreferences.groupMinTabs,
  )
  const consolidated = await consolidateDuplicateGroupsForTabs(tabs, true)
  const collapsed = resolvedPreferences.autoCollapseGroups
    ? await collapseGroupsByScope(resolvedPreferences.organizeScope)
    : 0
  return { checked: tabs.length, changed: changed + consolidated, collapsed, consolidated, deduplicated, hibernated }
}

async function deduplicateConfiguredTabs() {
  const preferences = await getPreferences()
  return deduplicateByScope(preferences.duplicateScope)
}

async function hibernateConfiguredTabs() {
  const preferences = await getPreferences()
  return hibernateByScope(preferences)
}

async function toggleCommandSearchInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (typeof tab?.id !== 'number') return

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'TABWEAVE_TOGGLE_COMMAND_SEARCH' })
    return
  } catch {
    // The content script is injected lazily so regular pages do not carry it until needed.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [COMMAND_CONTENT_SCRIPT],
    })
    await chrome.tabs.sendMessage(tab.id, { type: 'TABWEAVE_TOGGLE_COMMAND_SEARCH' })
  } catch {
    // Chrome internal pages and restricted Web Store pages cannot receive injected overlays.
  }
}

async function collapseAfterAutomaticGrouping(preferences: Preferences) {
  if (!preferences.autoCollapseGroups) return
  await collapseGroupsByScope(preferences.organizeScope)
}

async function reconcileSnoozeAlarms() {
  const items = await getSnoozedTabs()
  const now = Date.now()
  const expired: string[] = []
  const reconciledAlarmKeys = new Set<string>()

  for (const item of items) {
    const alarmKey = item.groupId ?? item.id

    if (item.wakeUpAt <= now && !item.recurring) {
      // Missed wake-up — open the tab now
      await chrome.tabs.create({ url: item.url })
      expired.push(item.id)
    } else if (!reconciledAlarmKeys.has(alarmKey)) {
      // Re-create alarm in case it was lost during extension update (once per alarm key)
      reconciledAlarmKeys.add(alarmKey)
      const nextWake = item.recurring && item.wakeUpAt <= now
        ? computeNextRecurringWakeUp(item.recurring.hour, item.recurring.minute)
        : item.wakeUpAt
      await chrome.alarms.create(`${SNOOZE_ALARM_PREFIX}${alarmKey}`, { when: nextWake })
      if (item.recurring && item.wakeUpAt <= now) {
        item.wakeUpAt = nextWake
      }
    }
  }
  if (expired.length > 0) {
    await saveSnoozedTabs(items.filter((i) => !expired.includes(i.id)))
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await getRules()
    await getPreferences()
  }
  await Promise.all([updateHibernateAlarm(), updateActionSurface(), reconcileSnoozeAlarms()])
})

chrome.runtime.onStartup.addListener(() => {
  void Promise.all([updateHibernateAlarm(), updateActionSurface(), reconcileSnoozeAlarms()])
})

chrome.tabs.onCreated.addListener(async (tab) => {
  const preferences = await getPreferences()
  if (preferences.autoDeduplicateTabs) {
    await deduplicateByScope(preferences.duplicateScope)
  }
  if (preferences.autoGroupOnCreate) {
    const rules = await getRules()
    const tabs = await queryTabsByScope(preferences.organizeScope)
    await applyRulesToTabs(rules, tabs.length > 0 ? tabs : [tab], preferences.domainFallbackGrouping, preferences.groupMinTabs)
    await consolidateDuplicateGroupsForTabs(tabs.length > 0 ? tabs : [tab])
    await collapseAfterAutomaticGrouping(preferences)
  }
})

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
  if (changeInfo.status !== 'complete' && !changeInfo.url) return
  const preferences = await getPreferences()
  if (preferences.autoDeduplicateTabs) {
    await deduplicateByScope(preferences.duplicateScope)
  }
  if (preferences.autoGroupOnUpdate) {
    const rules = await getRules()
    const tabs = await queryTabsByScope(preferences.organizeScope)
    await applyRulesToTabs(rules, tabs, preferences.domainFallbackGrouping, preferences.groupMinTabs)
    await consolidateDuplicateGroupsForTabs(tabs)
    await collapseAfterAutomaticGrouping(preferences)
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(SNOOZE_ALARM_PREFIX)) {
    const alarmKey = alarm.name.slice(SNOOZE_ALARM_PREFIX.length)
    void wakeUpByAlarmKey(alarmKey)
    return
  }
  if (alarm.name !== HIBERNATE_ALARM_NAME) return
  void getPreferences().then((preferences) => {
    if (!preferences.autoHibernateTabs) return undefined
    return hibernateByScope(preferences)
  })
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes['tabweave.preferences']) return
  const preferences = changes['tabweave.preferences'].newValue as Preferences | undefined
  void Promise.all([updateHibernateAlarm(preferences), updateActionSurface(preferences)])
})

chrome.commands.onCommand.addListener((command) => {
  if (command === 'regroup-current-window') {
    void regroupCurrentWindow()
    return
  }

  if (command === 'deduplicate-tabs') {
    void deduplicateConfiguredTabs()
    return
  }

  if (command === 'open-command-search') {
    void toggleCommandSearchInActiveTab()
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TABWEAVE_REGROUP') {
    void regroupCurrentWindow()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_GET_COMMANDS') {
    void chrome.commands
      .getAll()
      .then((commands) => sendResponse({ ok: true, commands }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_DEDUPLICATE') {
    void (message.scope ? deduplicateByScope(message.scope) : deduplicateConfiguredTabs())
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_AI_GROUPING_PLAN') {
    void getAiGroupingSettings()
      .then((settings) => generateAiGroupingPlan(settings))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_AI_APPLY_GROUPING_PLAN') {
    void applyAiGroupingPlan(message.plan, { saveRules: Boolean(message.saveRules) })
      .then((changed) => sendResponse({ ok: true, changed }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_SEARCH_COMMANDS') {
    void getPreferences()
      .then((preferences) => searchCommandItems(String(message.query ?? ''), preferences.languageMode))
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_ACTIVATE_COMMAND_ITEM') {
    const item = message.item as CommandSearchItem | undefined
    if (!item) {
      sendResponse({ ok: false, error: 'Missing command item' })
      return false
    }

    if (item.type === 'command') {
      const task = item.command === 'organize'
        ? regroupCurrentWindow()
        : item.command === 'deduplicate'
          ? deduplicateConfiguredTabs()
          : item.command === 'hibernate'
            ? hibernateConfiguredTabs()
            : Promise.resolve({ action: 'none' })
      void task
        .then((result) => sendResponse({ ok: true, action: item.command, result }))
        .catch((error) => {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      return true
    }

    void activateCommandItem(item)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_GET_COMMAND_SEARCH_COPY') {
    void getPreferences()
      .then((preferences) => {
        const t = getMessages(preferences.languageMode)
        const dateLocale = resolveLanguage(preferences.languageMode) === 'zh' ? 'zh-CN' : 'en-US'
        sendResponse({
          ok: true,
          copy: {
            placeholder: t.commandPlaceholder,
            loading: t.commandLoading,
            loadingDesc: t.commandLoadingDesc,
            noResults: t.commandNoResults,
            noResultsDesc: t.commandNoResultsDesc,
            hint: t.commandHint,
            ready: t.commandReady,
            resultCount: t.commandResultCount,
            categoryAll: t.commandCategoryAll,
            helpOpen: t.commandHelpOpen,
            helpMove: t.commandHelpMove,
            helpCategory: t.commandHelpCategory,
            helpClose: t.commandHelpClose,
            typeCommand: t.commandTypeCommand,
            typeTab: t.commandTypeTab,
            typeGroup: t.commandTypeGroup,
            typeHistory: t.commandTypeHistory,
            pinned: t.commandPinned,
            recent: t.commandRecent,
            today: t.commandToday,
            yesterday: t.commandYesterday,
            dateLocale,
            themeMode: preferences.themeMode,
          },
        })
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_HIBERNATE') {
    void getPreferences()
      .then((preferences) => hibernateByScope(message.preferences ? { ...preferences, ...message.preferences } : preferences))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_SNOOZE_TAB') {
    void snoozeTab(Number(message.tabId), Number(message.wakeUpAt), message.recurring as { hour: number; minute: number } | undefined)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_SNOOZE_TABS') {
    const tabIds = (message.tabIds as number[]).map(Number)
    const groupInfo = message.groupInfo as { title: string; color: ChromeGroupColor } | undefined
    void snoozeTabs(tabIds, Number(message.wakeUpAt), message.recurring as { hour: number; minute: number } | undefined, groupInfo)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_GET_SNOOZED_TABS') {
    void getSnoozedTabs()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_WAKE_UP_SNOOZE') {
    void wakeUpSnoozedItem(String(message.snoozeId))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_DELETE_SNOOZE') {
    void (async () => {
      const snoozeId = String(message.snoozeId)
      const items = await getSnoozedTabs()
      const item = items.find((i) => i.id === snoozeId)
      if (!item) { sendResponse({ ok: true }); return }

      // If the item belongs to a group, delete the entire group
      const idsToRemove = item.groupId
        ? new Set(items.filter((i) => i.groupId === item.groupId).map((i) => i.id))
        : new Set([snoozeId])

      await saveSnoozedTabs(items.filter((i) => !idsToRemove.has(i.id)))
      // Clear the alarm (keyed by groupId or item.id)
      const alarmKey = item.groupId ?? item.id
      await chrome.alarms.clear(`${SNOOZE_ALARM_PREFIX}${alarmKey}`)
      sendResponse({ ok: true })
    })().catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    return true
  }

  if (message?.type === 'TABWEAVE_SAVE_SNAPSHOT') {
    void (async () => {
      const window = await chrome.windows.getCurrent({ populate: false })
      const tabs = await chrome.tabs.query({ windowId: window.id })
      const groups = await chrome.tabGroups.query({ windowId: window.id })
      const groupMap = new Map(groups.map((g) => [g.id, g]))

      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = `快照 ${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

      const snapshotTabs = tabs
        .filter((tab) => tab.url && tab.url !== 'chrome://newtab/' && tab.url !== 'chrome://newtab')
        .map((tab) => {
          const group = tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? groupMap.get(tab.groupId) : undefined
          // Use group title if non-empty; otherwise use a fallback based on groupId to preserve grouping
          const groupTitle = group ? (group.title || `Group ${tab.groupId}`) : undefined
          return {
            url: tab.url!,
            title: tab.title ?? tab.url!,
            favIconUrl: tab.favIconUrl,
            groupTitle,
            groupColor: group?.color as ChromeGroupColor | undefined,
          }
        })

      const snapshot: SessionSnapshot = {
        id: crypto.randomUUID(),
        name,
        createdAt: Date.now(),
        tabs: snapshotTabs,
      }

      const existing = await getSnapshots()
      await saveSnapshots([snapshot, ...existing].slice(0, 20))
      sendResponse({ ok: true, snapshot })
    })().catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    return true
  }

  if (message?.type === 'TABWEAVE_GET_SNAPSHOTS') {
    void getSnapshots()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_RESTORE_SNAPSHOT') {
    void (async () => {
      const snapshotId = String(message.snapshotId)
      const snapshots = await getSnapshots()
      const snapshot = snapshots.find((s) => s.id === snapshotId)
      if (!snapshot) { sendResponse({ ok: false, error: 'Snapshot not found' }); return }

      // 在新窗口中恢复快照
      const newWindow = await chrome.windows.create({ focused: true })
      if (!newWindow?.id) { sendResponse({ ok: false, error: 'Failed to create window' }); return }
      const windowId = newWindow.id

      // 移除新窗口自带的空白标签页
      const defaultTabs = await chrome.tabs.query({ windowId })
      const defaultTabIds = defaultTabs.map((t) => t.id!).filter(Boolean)

      // 按分组逐一打开
      const groupTitleToId = new Map<string, number>()
      let firstTab = true
      for (const tab of snapshot.tabs) {
        try {
          const created = await chrome.tabs.create({ windowId, url: tab.url, active: firstTab })
          firstTab = false
          if (tab.groupTitle && created.id !== undefined) {
            if (!groupTitleToId.has(tab.groupTitle)) {
              const groupId = await chrome.tabs.group({ tabIds: [created.id], createProperties: { windowId } })
              await chrome.tabGroups.update(groupId, { title: tab.groupTitle, color: tab.groupColor ?? 'blue' })
              groupTitleToId.set(tab.groupTitle, groupId)
            } else {
              await chrome.tabs.group({ tabIds: [created.id], groupId: groupTitleToId.get(tab.groupTitle)! })
            }
          }
        } catch {
          // chrome:// and other restricted URLs cannot be opened by extensions — skip silently
        }
      }

      // 关闭新窗口自带的空白标签页
      if (defaultTabIds.length > 0) {
        try { await chrome.tabs.remove(defaultTabIds) } catch { /* may already be gone */ }
      }

      sendResponse({ ok: true })
    })().catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    return true
  }

  if (message?.type === 'TABWEAVE_UPDATE_SNAPSHOT') {
    void (async () => {
      const updated = message.snapshot as SessionSnapshot | undefined
      if (!updated?.id) { sendResponse({ ok: false, error: 'Invalid snapshot' }); return }
      const items = await getSnapshots()
      await saveSnapshots(items.map((s) => s.id === updated.id ? updated : s))
      sendResponse({ ok: true })
    })().catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    return true
  }

  if (message?.type === 'TABWEAVE_DELETE_SNAPSHOT') {
    void (async () => {
      const snapshotId = String(message.snapshotId)
      const items = await getSnapshots()
      await saveSnapshots(items.filter((s) => s.id !== snapshotId))
      sendResponse({ ok: true })
    })().catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    return true
  }

  if (message?.type === 'TABWEAVE_CLOSE_ALL_TABS') {
    void (async () => {
      const window = await chrome.windows.getCurrent({ populate: false })
      const currentTabs = await chrome.tabs.query({ windowId: window.id })
      await chrome.tabs.create({ windowId: window.id, url: 'chrome://newtab' })
      await chrome.tabs.remove(currentTabs.map((t) => t.id!))
      sendResponse({ ok: true })
    })().catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    return true
  }

  return false
})
