import type { AutoGroupRule, GroupSnapshot, RuleCondition, RuleScope, TabSnapshot, WindowSnapshot } from './types'

export const UNGROUPED_ID = typeof chrome !== 'undefined' && chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1

export function getDomain(url = ''): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function getPatternItems(pattern: string) {
  return pattern
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function testPattern(value: string, pattern: string, mode: AutoGroupRule['mode']): boolean {
  const patterns = getPatternItems(pattern)
  if (patterns.length === 0) return false

  return patterns.some((item) => {
    if (mode === 'equals') return value.toLowerCase() === item.toLowerCase()
    if (mode === 'contains') return value.toLowerCase().includes(item.toLowerCase())
    try {
      return new RegExp(item, 'i').test(value)
    } catch {
      return false
    }
  })
}

export function isValidRegex(pattern: string): boolean {
  const patterns = getPatternItems(pattern)
  if (patterns.length === 0) return false
  return patterns.every((item) => {
    try {
      new RegExp(item)
      return true
    } catch {
      return false
    }
  })
}

function getConditionValue(condition: Pick<RuleCondition, 'target'>, tab: chrome.tabs.Tab) {
  return condition.target === 'domain' ? getDomain(tab.url) : condition.target === 'title' ? tab.title ?? '' : tab.url ?? ''
}

export function getRuleConditions(rule: AutoGroupRule): RuleCondition[] {
  if (Array.isArray(rule.conditions) && rule.conditions.length > 0) return rule.conditions
  return [{ id: `${rule.id}-legacy-condition`, target: rule.target, mode: rule.mode, pattern: rule.pattern }]
}

export function matchRule(rule: AutoGroupRule, tab: chrome.tabs.Tab): boolean {
  if (!rule.enabled) return false
  return getRuleConditions(rule).some((condition) => testPattern(getConditionValue(condition, tab), condition.pattern, condition.mode))
}

async function findExistingGroup(windowId: number, title: string) {
  const groups = await chrome.tabGroups.query({ windowId })
  return groups.find((group) => group.title === title)
}

type ApplyRuleResult = 'no-match' | 'matched-unchanged' | 'changed'

export async function applyRuleToTab(rule: AutoGroupRule, tab: chrome.tabs.Tab): Promise<ApplyRuleResult> {
  if (!tab.id) return 'no-match'
  if (!matchRule(rule, tab)) return 'no-match'

  const groupWindowId = tab.windowId
  const existing = await findExistingGroup(groupWindowId, rule.groupTitle)
  const alreadyInTargetGroup = typeof existing?.id === 'number' && tab.groupId === existing.id
  const groupId = alreadyInTargetGroup ? existing.id : await chrome.tabs.group({ tabIds: [tab.id], groupId: existing?.id })
  const needsGroupUpdate = !existing || existing.color !== rule.color || existing.collapsed

  if (needsGroupUpdate) {
    await chrome.tabGroups.update(groupId, {
      title: rule.groupTitle,
      color: rule.color,
      collapsed: false,
    })
  }

  return !alreadyInTargetGroup || needsGroupUpdate ? 'changed' : 'matched-unchanged'
}


export async function reconcileTabWithRules(rules: AutoGroupRule[], tab: chrome.tabs.Tab): Promise<'grouped' | 'ungrouped' | 'unchanged'> {
  for (const rule of rules.filter((item) => item.enabled)) {
    const result = await applyRuleToTab(rule, tab)
    if (result === 'changed') return 'grouped'
    if (result === 'matched-unchanged') return 'unchanged'
  }

  if (!tab.id || typeof tab.groupId !== 'number' || tab.groupId === UNGROUPED_ID) return 'unchanged'

  const managedGroupTitles = new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.groupTitle))
  const group = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
  if (!group?.title || !managedGroupTitles.has(group.title)) return 'unchanged'

  await chrome.tabs.ungroup(tab.id)
  return 'ungrouped'
}

export async function applyRulesToTabs(rules: AutoGroupRule[], tabs: chrome.tabs.Tab[]): Promise<number> {
  let changed = 0
  for (const tab of tabs) {
    const result = await reconcileTabWithRules(rules, tab)
    if (result !== 'unchanged') changed += 1
  }
  return changed
}

export async function getTargetWindowId(): Promise<number | undefined> {
  try {
    const lastFocused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
    if (typeof lastFocused.id === 'number') return lastFocused.id
  } catch {
    // Ignore and fallback below.
  }

  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
  return windows.find((window) => typeof window.id === 'number')?.id
}

export async function queryTargetWindowTabs(): Promise<chrome.tabs.Tab[]> {
  const windowId = await getTargetWindowId()
  if (typeof windowId === 'number') return chrome.tabs.query({ windowId })
  return chrome.tabs.query({ currentWindow: true })
}

export async function queryTabsByScope(scope: RuleScope): Promise<chrome.tabs.Tab[]> {
  if (scope === 'allWindows') {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
    return windows.flatMap((window) => window.tabs ?? [])
  }
  return queryTargetWindowTabs()
}

export async function regroupCurrentWindow(rules: AutoGroupRule[]): Promise<number> {
  const tabs = await queryTargetWindowTabs()
  return applyRulesToTabs(rules, tabs)
}

export async function getCurrentWindowSnapshot(): Promise<WindowSnapshot> {
  const windowId = await getTargetWindowId()
  const [tabs, groups] = await Promise.all([
    typeof windowId === 'number' ? chrome.tabs.query({ windowId }) : chrome.tabs.query({ currentWindow: true }),
    typeof windowId === 'number' ? chrome.tabGroups.query({ windowId }) : chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT }),
  ])

  const tabSnapshots: TabSnapshot[] = tabs
    .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number')
    .map((tab) => ({
      id: tab.id,
      title: tab.title || 'Untitled',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl,
      groupId: tab.groupId ?? UNGROUPED_ID,
      active: Boolean(tab.active),
    }))

  const grouped: GroupSnapshot[] = groups.map((group) => ({
    id: group.id,
    title: group.title || '未命名分组',
    color: group.color,
    collapsed: Boolean(group.collapsed),
    tabs: tabSnapshots.filter((tab) => tab.groupId === group.id),
  }))

  return {
    groups: grouped,
    ungroupedTabs: tabSnapshots.filter((tab) => tab.groupId === UNGROUPED_ID),
  }
}

export async function createGroupFromTabs(tabIds: number[], title: string, color: chrome.tabGroups.TabGroup['color']): Promise<void> {
  if (tabIds.length === 0) return
  const normalizedTabIds = tabIds as [number, ...number[]]
  const groupId = await chrome.tabs.group({ tabIds: normalizedTabIds })
  await chrome.tabGroups.update(groupId, { title, color })
}

export async function sortCurrentWindowGroupsByRuleOrder(rules: AutoGroupRule[]): Promise<number> {
  const windowId = await getTargetWindowId()
  if (typeof windowId !== 'number') return 0

  const groups = await chrome.tabGroups.query({ windowId })
  const orderByTitle = new Map<string, number>()
  rules.forEach((rule, index) => {
    if (!orderByTitle.has(rule.groupTitle)) orderByTitle.set(rule.groupTitle, index)
  })

  const sortableGroups = groups
    .map((group, originalIndex) => ({
      group,
      originalIndex,
      order: orderByTitle.get(group.title ?? '') ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.order - b.order || a.originalIndex - b.originalIndex)

  let moved = 0
  for (const [index, item] of sortableGroups.entries()) {
    if (!Number.isFinite(item.order)) continue
    await chrome.tabGroups.move(item.group.id, { index, windowId })
    moved += 1
  }

  return moved
}
