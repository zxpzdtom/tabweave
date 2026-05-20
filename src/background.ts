import { getAiGroupingSettings, getPreferences, getRules, getSnoozedTabs, saveSnoozedTabs } from './lib/storage'
import { applyRulesToTabs, collapseGroupsByScope, consolidateDuplicateGroupsForTabs, queryTabsByScope } from './lib/grouping'
import { applyAiGroupingPlan, generateAiGroupingPlan } from './lib/ai/grouping'
import { deduplicateByScope } from './lib/deduplication'
import { hibernateByScope } from './lib/hibernation'
import { activateCommandItem, searchCommandItems, type CommandSearchItem } from './lib/command-search'
import { getMessages, resolveLanguage } from './lib/i18n'
import type { Preferences, SnoozeItem } from './lib/types'

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

function computeNextRecurringWakeUp(hour: number, minute: number): number {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime()
}

async function wakeUpSnoozedTab(snoozeId: string) {
  const items = await getSnoozedTabs()
  const item = items.find((i) => i.id === snoozeId)
  if (!item) return

  await chrome.tabs.create({ url: item.url })

  if (item.recurring) {
    const nextWakeUp = computeNextRecurringWakeUp(item.recurring.hour, item.recurring.minute)
    const updatedItem: SnoozeItem = { ...item, wakeUpAt: nextWakeUp }
    await saveSnoozedTabs(items.map((i) => (i.id === snoozeId ? updatedItem : i)))
    await chrome.alarms.create(`${SNOOZE_ALARM_PREFIX}${snoozeId}`, { when: nextWakeUp })
  } else {
    await saveSnoozedTabs(items.filter((i) => i.id !== snoozeId))
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

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await getRules()
    await getPreferences()
  }
  await Promise.all([updateHibernateAlarm(), updateActionSurface()])
})

chrome.runtime.onStartup.addListener(() => {
  void Promise.all([updateHibernateAlarm(), updateActionSurface()])
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
    const snoozeId = alarm.name.slice(SNOOZE_ALARM_PREFIX.length)
    void wakeUpSnoozedTab(snoozeId)
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

  if (message?.type === 'TABWEAVE_GET_SNOOZED_TABS') {
    void getSnoozedTabs()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  if (message?.type === 'TABWEAVE_WAKE_UP_SNOOZE') {
    void wakeUpSnoozedTab(String(message.snoozeId))
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
      await saveSnoozedTabs(items.filter((i) => i.id !== snoozeId))
      await chrome.alarms.clear(`${SNOOZE_ALARM_PREFIX}${snoozeId}`)
      sendResponse({ ok: true })
    })().catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    })
    return true
  }

  return false
})
