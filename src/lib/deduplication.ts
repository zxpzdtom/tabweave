import type { RuleScope } from './types'
import { getTargetWindowId } from './grouping'

export interface DeduplicateResult {
  closed: number
  duplicates: number
}

function normalizeDuplicateUrl(url = '') {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'about:' && parsed.pathname === 'blank') return 'blank-page'
    if (parsed.protocol === 'chrome:' && parsed.hostname === 'newtab') return 'blank-page'
    if (!['http:', 'https:', 'chrome:', 'chrome-extension:'].includes(parsed.protocol)) return ''
    parsed.hash = ''
    if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    return parsed.toString()
  } catch {
    return ''
  }
}

function isProtectedTab(tab: chrome.tabs.Tab) {
  return Boolean(tab.pinned || tab.audible)
}

function getKeepScore(tab: chrome.tabs.Tab) {
  return [
    tab.pinned ? 1 : 0,
    tab.audible ? 1 : 0,
    tab.active ? 1 : 0,
    tab.highlighted ? 1 : 0,
    tab.lastAccessed ?? 0,
    -(tab.index ?? 0),
  ]
}

function compareKeepCandidate(a: chrome.tabs.Tab, b: chrome.tabs.Tab) {
  const aScore = getKeepScore(a)
  const bScore = getKeepScore(b)
  for (let index = 0; index < aScore.length; index += 1) {
    if (aScore[index] === bScore[index]) continue
    return bScore[index] - aScore[index]
  }
  return 0
}

export async function queryDeduplicateTabs(scope: RuleScope): Promise<chrome.tabs.Tab[]> {
  if (scope === 'allWindows') {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
    return windows.flatMap((window) => window.tabs ?? [])
  }
  const windowId = await getTargetWindowId()
  if (typeof windowId === 'number') return chrome.tabs.query({ windowId })
  return chrome.tabs.query({ currentWindow: true })
}

export async function deduplicateTabs(tabs: chrome.tabs.Tab[]): Promise<DeduplicateResult> {
  const byUrl = new Map<string, chrome.tabs.Tab[]>()

  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue
    const normalizedUrl = normalizeDuplicateUrl(tab.url)
    if (!normalizedUrl) continue
    byUrl.set(normalizedUrl, [...(byUrl.get(normalizedUrl) ?? []), tab])
  }

  const removableIds: number[] = []
  let duplicates = 0

  for (const group of byUrl.values()) {
    if (group.length < 2) continue
    duplicates += group.length - 1

    const sorted = [...group].sort(compareKeepCandidate)
    const [keep, ...candidates] = sorted
    if (!keep) continue

    removableIds.push(
      ...candidates
        .filter((tab) => !isProtectedTab(tab))
        .map((tab) => tab.id)
        .filter((id): id is number => typeof id === 'number'),
    )
  }

  if (removableIds.length > 0) {
    await chrome.tabs.remove(removableIds)
  }

  return { closed: removableIds.length, duplicates }
}

export async function deduplicateByScope(scope: RuleScope): Promise<DeduplicateResult> {
  return deduplicateTabs(await queryDeduplicateTabs(scope))
}
