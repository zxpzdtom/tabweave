import { getMessages } from './i18n'
import type { ChromeGroupColor, LanguageMode } from './types'

export type CommandSearchItemType = 'command' | 'tab' | 'group' | 'history'
export type CommandAction = 'organize' | 'deduplicate' | 'hibernate'

export interface CommandSearchItem {
  id: string
  type: CommandSearchItemType
  title: string
  subtitle: string
  url?: string
  searchText?: string
  favIconUrl?: string
  pinned?: boolean
  tabId?: number
  windowId?: number
  groupId?: number
  groupColor?: ChromeGroupColor
  tabCount?: number
  command?: CommandAction
  lastVisitTime?: number
}

interface ScoredItem {
  item: CommandSearchItem
  score: number
}

function createCommandItems(languageMode: LanguageMode): CommandSearchItem[] {
  const t = getMessages(languageMode)
  return [
    {
      id: 'command:organize',
      type: 'command',
      title: t.commandOrganizeTitle,
      subtitle: t.commandOrganizeSubtitle,
      searchText: t.commandOrganizeSubtitle,
      command: 'organize',
    },
    {
      id: 'command:deduplicate',
      type: 'command',
      title: t.commandDeduplicateTitle,
      subtitle: t.commandDeduplicateSubtitle,
      searchText: t.commandDeduplicateSubtitle,
      command: 'deduplicate',
    },
    {
      id: 'command:hibernate',
      type: 'command',
      title: t.commandHibernateTitle,
      subtitle: t.commandHibernateSubtitle,
      searchText: t.commandHibernateSubtitle,
      command: 'hibernate',
    },
  ]
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function getHostname(url: string | undefined) {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function getFaviconUrl(url: string) {
  const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'))
  faviconUrl.searchParams.set('pageUrl', url)
  faviconUrl.searchParams.set('size', '32')
  return faviconUrl.toString()
}

function scoreValue(value: string, query: string) {
  const normalizedValue = normalize(value)
  if (!query) return 1
  if (!normalizedValue) return 0
  if (normalizedValue === query) return 120
  if (normalizedValue.startsWith(query)) return 90
  const wordStart = normalizedValue.indexOf(` ${query}`)
  if (wordStart >= 0) return 72
  const includes = normalizedValue.indexOf(query)
  if (includes >= 0) return Math.max(44, 68 - includes)

  const queryParts = query.split(/\s+/).filter(Boolean)
  if (queryParts.length <= 1) return 0
  const matchedParts = queryParts.filter((part) => normalizedValue.includes(part)).length
  return matchedParts === queryParts.length ? 38 : 0
}

function scoreItem(item: CommandSearchItem, query: string) {
  if (!query && item.type === 'command') return 80
  if (!query && item.type === 'tab') return item.tabId ? 45 : 0
  if (!query && item.type === 'group') return 36
  if (!query && item.type === 'history') return 28
  if (!query) return 0

  const titleScore = scoreValue(item.title, query)
  const metadataScore = scoreValue(item.searchText ?? '', query)
  const urlScore = scoreValue(item.url ?? '', query)
  const typeBoost = item.type === 'command' ? 8 : item.type === 'tab' ? 6 : item.type === 'group' ? 4 : 0
  const best = Math.max(titleScore, metadataScore * 0.72, urlScore * 0.68)
  return best > 0 ? best + typeBoost : 0
}

function getRecency(item: CommandSearchItem) {
  return item.lastVisitTime ?? 0
}

function getTypePriority(item: CommandSearchItem) {
  if (item.type === 'command') return 5
  if (item.type === 'tab') return 4
  if (item.type === 'group') return 3
  if (item.type === 'history') return 2
  return 1
}

function sortAndLimit(scored: ScoredItem[], limit: number, query: string) {
  return scored
    .sort((a, b) => {
      if (!query) {
        const recencyDiff = getRecency(b.item) - getRecency(a.item)
        if (recencyDiff !== 0) return recencyDiff
        const typeDiff = getTypePriority(b.item) - getTypePriority(a.item)
        if (typeDiff !== 0) return typeDiff
        return a.item.title.localeCompare(b.item.title)
      }
      const scoreDiff = b.score - a.score
      if (scoreDiff !== 0) return scoreDiff
      const recencyDiff = getRecency(b.item) - getRecency(a.item)
      if (recencyDiff !== 0) return recencyDiff
      return a.item.title.localeCompare(b.item.title)
    })
    .slice(0, limit)
    .map(({ item }) => item)
}

function sortByRecency(items: CommandSearchItem[]) {
  return [...items].sort((a, b) => {
    const recencyDiff = getRecency(b) - getRecency(a)
    if (recencyDiff !== 0) return recencyDiff
    return a.title.localeCompare(b.title)
  })
}

function getEmptyQueryItems({
  commands,
  tabs,
  groups,
  history,
  limit,
}: {
  commands: CommandSearchItem[]
  tabs: CommandSearchItem[]
  groups: CommandSearchItem[]
  history: CommandSearchItem[]
  limit: number
}) {
  const visibleGroups = sortByRecency(groups).slice(0, 6)
  const visibleHistory = sortByRecency(history).slice(0, 12)
  const tabLimit = Math.max(0, limit - visibleGroups.length - visibleHistory.length)
  const visibleTabs = sortByRecency(tabs).slice(0, tabLimit)
  return [...commands, ...visibleTabs, ...visibleGroups, ...visibleHistory].slice(0, limit)
}

async function getOpenTabItems(languageMode: LanguageMode) {
  const t = getMessages(languageMode)
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
  const items: CommandSearchItem[] = []

  for (const window of windows) {
    for (const tab of window.tabs ?? []) {
      if (typeof tab.id !== 'number') continue
      const host = getHostname(tab.url)
      items.push({
        id: `tab:${tab.id}`,
        type: 'tab',
        title: tab.title || host || t.commandUntitled,
        subtitle: host,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        pinned: tab.pinned,
        tabId: tab.id,
        windowId: tab.windowId,
        groupId: tab.groupId,
        lastVisitTime: tab.lastAccessed,
      })
    }
  }

  return items
}

async function getGroupItems(languageMode: LanguageMode) {
  const t = getMessages(languageMode)
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
  const items: CommandSearchItem[] = []

  for (const window of windows) {
    if (typeof window.id !== 'number') continue
    const groups = await chrome.tabGroups.query({ windowId: window.id })
    for (const group of groups) {
      const tabs = await chrome.tabs.query({ windowId: window.id, groupId: group.id })
      const lastAccessed = Math.max(0, ...tabs.map((tab) => tab.lastAccessed ?? 0))
      items.push({
        id: `group:${group.id}`,
        type: 'group',
        title: group.title || t.commandUntitledGroup,
        subtitle: t.commandTabsCount.replace('{count}', String(tabs.length)),
        windowId: window.id,
        groupId: group.id,
        groupColor: group.color,
        tabCount: tabs.length,
        lastVisitTime: lastAccessed,
      })
    }
  }

  return items
}

async function getHistoryItems(query: string, languageMode: LanguageMode) {
  const t = getMessages(languageMode)
  if (!chrome.history) return []

  const history = await chrome.history.search({
    text: query,
    maxResults: query ? 18 : 12,
    startTime: 0,
  })

  return history.flatMap<CommandSearchItem>((entry) => {
    if (!entry.url) return []
    const host = getHostname(entry.url)
    return [{
      id: `history:${entry.id}`,
      type: 'history',
      title: entry.title || host || entry.url,
      subtitle: host ? `${t.commandHistorySource} · ${host}` : t.commandHistorySource,
      url: entry.url,
      favIconUrl: getFaviconUrl(entry.url),
      lastVisitTime: entry.lastVisitTime,
    }]
  })
}

export async function searchCommandItems(query: string, languageMode: LanguageMode = 'system', limit = 36): Promise<CommandSearchItem[]> {
  const normalizedQuery = normalize(query)
  const commands = createCommandItems(languageMode)
  const [tabs, groups, history] = await Promise.all([
    getOpenTabItems(languageMode),
    getGroupItems(languageMode),
    getHistoryItems(normalizedQuery, languageMode),
  ])

  if (!normalizedQuery) return getEmptyQueryItems({ commands, tabs, groups, history, limit })

  const scored = [...commands, ...tabs, ...groups, ...history]
    .map((item) => ({ item, score: scoreItem(item, normalizedQuery) }))
    .filter(({ score }) => score > 0)

  return sortAndLimit(scored, limit, normalizedQuery)
}

export async function activateCommandItem(item: CommandSearchItem) {
  if (item.type === 'command' && item.command) {
    if (item.command === 'organize') {
      void chrome.runtime.sendMessage({ type: 'TABWEAVE_REGROUP' })
    } else if (item.command === 'deduplicate') {
      void chrome.runtime.sendMessage({ type: 'TABWEAVE_DEDUPLICATE' })
    } else if (item.command === 'hibernate') {
      void chrome.runtime.sendMessage({ type: 'TABWEAVE_HIBERNATE' })
    }
    return { action: item.command }
  }

  if (item.type === 'tab' && typeof item.tabId === 'number') {
    if (typeof item.windowId === 'number') await chrome.windows.update(item.windowId, { focused: true })
    await chrome.tabs.update(item.tabId, { active: true })
    return { action: 'tab' as const }
  }

  if (item.type === 'group' && typeof item.groupId === 'number' && typeof item.windowId === 'number') {
    await chrome.windows.update(item.windowId, { focused: true })
    await chrome.tabGroups.update(item.groupId, { collapsed: false }).catch(() => undefined)
    const [firstTab] = await chrome.tabs.query({ windowId: item.windowId, groupId: item.groupId })
    if (typeof firstTab?.id === 'number') await chrome.tabs.update(firstTab.id, { active: true })
    return { action: 'group' as const }
  }

  if (item.type === 'history' && item.url) {
    await chrome.tabs.create({ url: item.url })
    return { action: 'history' as const }
  }

  return { action: 'none' as const }
}
