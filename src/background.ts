import { getPreferences, getRules } from './lib/storage'
import { applyRulesToTabs, queryTabsByScope } from './lib/grouping'
import { deduplicateByScope } from './lib/deduplication'
import type { Preferences } from './lib/types'

async function regroupCurrentWindow(preferences?: Preferences) {
  const resolvedPreferences = preferences ?? await getPreferences()
  const deduplicated = resolvedPreferences.deduplicateOnOrganize
    ? await deduplicateByScope(resolvedPreferences.duplicateScope)
    : { closed: 0, duplicates: 0 }
  const rules = await getRules()
  const tabs = await queryTabsByScope(resolvedPreferences.organizeScope)
  const changed = await applyRulesToTabs(
    rules,
    tabs,
    resolvedPreferences.domainFallbackGrouping,
    resolvedPreferences.groupMinTabs,
  )
  return { checked: tabs.length, changed, deduplicated }
}

async function deduplicateConfiguredTabs() {
  const preferences = await getPreferences()
  return deduplicateByScope(preferences.duplicateScope)
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await getRules()
    await getPreferences()
  }
})

chrome.tabs.onCreated.addListener(async (tab) => {
  const preferences = await getPreferences()
  if (preferences.autoDeduplicateTabs) {
    await deduplicateByScope(preferences.duplicateScope)
  }
  if (preferences.autoGroupOnCreate) {
    const rules = await getRules()
    await applyRulesToTabs(rules, [tab], preferences.domainFallbackGrouping, preferences.groupMinTabs)
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
  }
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

  return false
})
