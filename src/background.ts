import { getPreferences, getRules } from './lib/storage'
import { applyRulesToTabs, collapseGroupsByScope, queryTabsByScope } from './lib/grouping'
import { deduplicateByScope } from './lib/deduplication'
import { hibernateByScope } from './lib/hibernation'
import type { Preferences } from './lib/types'

const HIBERNATE_ALARM_NAME = 'tabweave.hibernate'

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
  const collapsed = resolvedPreferences.autoCollapseGroups
    ? await collapseGroupsByScope(resolvedPreferences.organizeScope)
    : 0
  return { checked: tabs.length, changed, collapsed, deduplicated, hibernated }
}

async function deduplicateConfiguredTabs() {
  const preferences = await getPreferences()
  return deduplicateByScope(preferences.duplicateScope)
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
  await updateHibernateAlarm()
})

chrome.runtime.onStartup.addListener(() => {
  void updateHibernateAlarm()
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
    await collapseAfterAutomaticGrouping(preferences)
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== HIBERNATE_ALARM_NAME) return
  void getPreferences().then((preferences) => {
    if (!preferences.autoHibernateTabs) return undefined
    return hibernateByScope(preferences)
  })
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes['tabweave.preferences']) return
  void updateHibernateAlarm(changes['tabweave.preferences'].newValue as Preferences | undefined)
})

chrome.commands.onCommand.addListener((command) => {
  if (command === 'regroup-current-window') {
    void regroupCurrentWindow()
    return
  }

  if (command === 'deduplicate-tabs') {
    void deduplicateConfiguredTabs()
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

  if (message?.type === 'TABWEAVE_HIBERNATE') {
    void getPreferences()
      .then((preferences) => hibernateByScope(message.preferences ? { ...preferences, ...message.preferences } : preferences))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    return true
  }

  return false
})
