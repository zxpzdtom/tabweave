import type { AutoGroupRule, GroupSnapshot, RuleCondition, RuleScope, TabSnapshot, WindowSnapshot } from './types'
import { DEFAULT_GROUP_MIN_TABS, DEFAULT_RULE_IDS, GROUP_COLORS } from './constants'

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
  if (condition.target === 'domain') return getDomain(tab.url)
  return condition.target === 'title' ? tab.title ?? '' : tab.url ?? ''
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
type RuleEligibility = Map<string, Set<string>>

function getRuleEligibilityKey(tab: chrome.tabs.Tab) {
  return typeof tab.windowId === 'number' ? String(tab.windowId) : ''
}

function isDefaultRule(rule: AutoGroupRule) {
  return DEFAULT_RULE_IDS.has(rule.id)
}

function getRuleMinimumTabs(rule: AutoGroupRule, defaultMinimumTabs: number) {
  if (typeof rule.minTabs === 'number') return normalizeGroupMinTabs(rule.minTabs)
  return isDefaultRule(rule) ? normalizeGroupMinTabs(defaultMinimumTabs) : 1
}

function ruleUsesMinimumTabs(rule: AutoGroupRule, defaultMinimumTabs: number) {
  return getRuleMinimumTabs(rule, defaultMinimumTabs) > 1
}

function isRuleEligible(rule: AutoGroupRule, tab: chrome.tabs.Tab, eligibility: RuleEligibility, defaultMinimumTabs: number) {
  if (!ruleUsesMinimumTabs(rule, defaultMinimumTabs)) return true
  const key = getRuleEligibilityKey(tab)
  return Boolean(key && eligibility.get(key)?.has(rule.id))
}

function getEligibleManagedGroupTitles(
  rules: AutoGroupRule[],
  tab: chrome.tabs.Tab,
  eligibility: RuleEligibility,
  defaultMinimumTabs: number,
) {
  return new Set(
    rules
      .filter((rule) => rule.enabled && isRuleEligible(rule, tab, eligibility, defaultMinimumTabs))
      .map((rule) => rule.groupTitle),
  )
}

function getIneligibleThresholdGroupTitles(
  rules: AutoGroupRule[],
  windowId: number,
  eligibility: RuleEligibility,
  defaultMinimumTabs: number,
) {
  const windowKey = String(windowId)
  const eligibleRuleIds = eligibility.get(windowKey) ?? new Set<string>()
  const alwaysManagedGroupTitles = new Set(
    rules
      .filter((rule) => rule.enabled && !ruleUsesMinimumTabs(rule, defaultMinimumTabs))
      .map((rule) => rule.groupTitle),
  )
  const eligibleThresholdGroupTitles = new Set(
    rules
      .filter((rule) => rule.enabled && ruleUsesMinimumTabs(rule, defaultMinimumTabs) && eligibleRuleIds.has(rule.id))
      .map((rule) => rule.groupTitle),
  )

  return new Set(
    rules
      .filter((rule) => rule.enabled && ruleUsesMinimumTabs(rule, defaultMinimumTabs) && !eligibleRuleIds.has(rule.id))
      .map((rule) => rule.groupTitle)
      .filter((title) => !alwaysManagedGroupTitles.has(title) && !eligibleThresholdGroupTitles.has(title)),
  )
}

function getRuleEligibility(rules: AutoGroupRule[], tabs: chrome.tabs.Tab[], defaultMinimumTabs: number): RuleEligibility {
  const normalizedMinimumTabs = normalizeGroupMinTabs(defaultMinimumTabs)
  const thresholdRules = rules.filter((rule) => rule.enabled && ruleUsesMinimumTabs(rule, defaultMinimumTabs))
  const counts = new Map<string, number>()
  const eligibility: RuleEligibility = new Map()

  for (const tab of tabs) {
    const windowKey = getRuleEligibilityKey(tab)
    if (!windowKey) continue
    for (const rule of thresholdRules) {
      if (!matchRule(rule, tab)) continue
      const countKey = `${windowKey}\n${rule.id}`
      counts.set(countKey, (counts.get(countKey) ?? 0) + 1)
    }
  }

  for (const [countKey, count] of counts) {
    const [windowKey, ruleId] = countKey.split('\n')
    const rule = thresholdRules.find((item) => item.id === ruleId)
    const minimumTabsForRule = rule ? getRuleMinimumTabs(rule, normalizedMinimumTabs) : normalizedMinimumTabs
    if (count < minimumTabsForRule) continue
    eligibility.set(windowKey, new Set([...(eligibility.get(windowKey) ?? []), ruleId]))
  }

  return eligibility
}

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


export async function reconcileTabWithRules(
  rules: AutoGroupRule[],
  tab: chrome.tabs.Tab,
  eligibility: RuleEligibility = new Map(),
  defaultMinimumTabs = DEFAULT_GROUP_MIN_TABS,
): Promise<'grouped' | 'ungrouped' | 'unchanged'> {
  for (const rule of rules.filter((item) => item.enabled)) {
    if (!isRuleEligible(rule, tab, eligibility, defaultMinimumTabs)) continue
    const result = await applyRuleToTab(rule, tab)
    if (result === 'changed') return 'grouped'
    if (result === 'matched-unchanged') return 'unchanged'
  }

  if (!tab.id || typeof tab.groupId !== 'number' || tab.groupId === UNGROUPED_ID) return 'unchanged'

  const managedGroupTitles = getEligibleManagedGroupTitles(rules, tab, eligibility, defaultMinimumTabs)
  const group = await chrome.tabGroups.get(tab.groupId).catch(() => undefined)
  if (!group?.title || !managedGroupTitles.has(group.title)) return 'unchanged'

  await chrome.tabs.ungroup(tab.id)
  return 'ungrouped'
}

export async function applyRulesToTabs(
  rules: AutoGroupRule[],
  tabs: chrome.tabs.Tab[],
  domainFallbackGrouping = true,
  groupMinTabs = DEFAULT_GROUP_MIN_TABS,
): Promise<number> {
  const normalizedGroupMinTabs = normalizeGroupMinTabs(groupMinTabs)
  const latestTabs = await getLatestTabsById(tabs)
  const ruleEligibility = getRuleEligibility(rules, latestTabs, normalizedGroupMinTabs)
  let changed = 0
  for (const tab of latestTabs) {
    const result = await reconcileTabWithRules(rules, tab, ruleEligibility, normalizedGroupMinTabs)
    if (result !== 'unchanged') changed += 1
  }
  changed += await ungroupFallbackGroupsBelowThreshold(rules, latestTabs, normalizedGroupMinTabs, ruleEligibility)
  if (!domainFallbackGrouping) return changed
  return changed + await groupUngroupedTabsByDomain(latestTabs, normalizedGroupMinTabs)
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

async function collapseGroupsInWindow(windowId: number): Promise<number> {
  const groups = await chrome.tabGroups.query({ windowId })
  let collapsed = 0

  for (const group of groups) {
    if (group.collapsed) continue
    try {
      await chrome.tabGroups.update(group.id, { collapsed: true })
      collapsed += 1
    } catch {
      // Chrome can reject collapsing the active group; keep organizing reliable.
    }
  }

  return collapsed
}

export async function collapseGroupsByScope(scope: RuleScope): Promise<number> {
  if (scope === 'allWindows') {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] })
    const windowIds = windows.flatMap((window) => typeof window.id === 'number' ? [window.id] : [])
    const collapsedCounts = await Promise.all(windowIds.map(collapseGroupsInWindow))
    return collapsedCounts.reduce((total, count) => total + count, 0)
  }

  const windowId = await getTargetWindowId()
  if (typeof windowId !== 'number') return 0
  return collapseGroupsInWindow(windowId)
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

export async function ungroupCurrentWindowGroupsByTitle(title: string): Promise<number> {
  const windowId = await getTargetWindowId()
  if (typeof windowId !== 'number') return 0

  const groups = await chrome.tabGroups.query({ windowId })
  const matchingGroups = groups.filter((group) => group.title === title)
  let ungrouped = 0

  for (const group of matchingGroups) {
    const tabs = await chrome.tabs.query({ windowId, groupId: group.id })
    const tabIds = tabs.flatMap((tab) => typeof tab.id === 'number' ? [tab.id] : [])
    if (tabIds.length === 0) continue
    await chrome.tabs.ungroup(tabIds as [number, ...number[]])
    ungrouped += tabIds.length
  }

  return ungrouped
}

function toTitleCase(value: string) {
  return value
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function getDomainFallbackTitle(domain: string) {
  const parts = domain.split('.').filter(Boolean)
  if (parts.length === 0) return 'Tabs'
  return toTitleCase(parts[0])
}

function getDomainGroupColor(index: number) {
  return GROUP_COLORS[index % GROUP_COLORS.length]
}

function getEligibleDomainTabs(tabs: chrome.tabs.Tab[]) {
  return tabs.filter((tab): tab is chrome.tabs.Tab & { id: number; windowId: number } => {
    if (typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return false
    const url = tab.url ?? ''
    return Boolean(url) && !url.startsWith('chrome://newtab') && url !== 'about:blank'
  })
}

function cleanTitleSegment(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`([{【]+|[\s"'`\])}】]+$/g, '')
    .trim()
}

function getTitleSegments(title = '') {
  return title
    .split(/\s+(?:[-–—|·])\s+|[:：]/)
    .map(cleanTitleSegment)
    .filter((segment) => segment.length >= 2 && segment.length <= 40)
}

function inferTitleGroupName(tabs: chrome.tabs.Tab[], domain: string) {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    const uniqueSegments = new Set(getTitleSegments(tab.title))
    uniqueSegments.forEach((segment) => counts.set(segment, (counts.get(segment) ?? 0) + 1))
  }

  const minimumCount = Math.max(2, Math.ceil(tabs.length / 2))
  const [best] = [...counts.entries()]
    .filter(([, count]) => count >= minimumCount)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))

  return best?.[0] ?? getDomainFallbackTitle(domain)
}

function getDomainBucketKey(tab: chrome.tabs.Tab) {
  const domain = getDomain(tab.url)
  return domain && typeof tab.windowId === 'number' ? `${tab.windowId}\n${domain}` : ''
}

async function getLatestTabsById(tabs: chrome.tabs.Tab[]) {
  const tabIds = tabs.flatMap((tab) => typeof tab.id === 'number' ? [tab.id] : [])
  const latestTabs = await Promise.all(tabIds.map((id) => chrome.tabs.get(id).catch(() => undefined)))
  return latestTabs.filter((tab): tab is chrome.tabs.Tab => Boolean(tab))
}

async function findExistingDomainGroup(windowId: number, title: string, domain: string) {
  const groups = await chrome.tabGroups.query({ windowId })
  const candidates = groups.filter((group) => group.title === title)

  for (const group of candidates) {
    const groupTabs = await chrome.tabs.query({ windowId, groupId: group.id })
    const groupDomains = new Set(getEligibleDomainTabs(groupTabs).map((tab) => getDomain(tab.url)))
    if (groupDomains.size === 1 && groupDomains.has(domain)) return group
  }

  return undefined
}

async function getDomainGroupTitle(windowId: number, inferredTitle: string, domain: string) {
  const sameDomainGroup = await findExistingDomainGroup(windowId, inferredTitle, domain)
  if (sameDomainGroup) return inferredTitle

  const titleExistsForAnotherDomain = Boolean(await findExistingGroup(windowId, inferredTitle))
  return titleExistsForAnotherDomain ? `${inferredTitle} · ${domain}` : inferredTitle
}

async function groupTabsIntoDomainGroup(windowId: number, tabIds: number[], title: string, color: chrome.tabGroups.TabGroup['color'], domain: string) {
  if (tabIds.length === 0) return
  const existing = await findExistingDomainGroup(windowId, title, domain)
  const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], groupId: existing?.id })
  await chrome.tabGroups.update(groupId, { title, color, collapsed: false })
}

function normalizeGroupMinTabs(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_GROUP_MIN_TABS
  return Math.max(1, Math.floor(value))
}

function getWindowIdsFromTabs(tabs: chrome.tabs.Tab[]) {
  return [...new Set(tabs.flatMap((tab) => typeof tab.windowId === 'number' ? [tab.windowId] : []))]
}

async function getFallbackGroupTabIdsBelowThreshold(
  group: chrome.tabGroups.TabGroup,
  windowId: number,
  minimumTabs: number,
) {
  const tabs = await chrome.tabs.query({ windowId, groupId: group.id })
  const eligibleTabs = getEligibleDomainTabs(tabs)
  if (eligibleTabs.length !== tabs.length || eligibleTabs.length >= minimumTabs) return []

  const domains = new Set(eligibleTabs.map((tab) => getDomain(tab.url)))
  if (domains.size !== 1) return []

  return eligibleTabs.map((tab) => tab.id)
}

export async function ungroupFallbackGroupsBelowThreshold(
  rules: AutoGroupRule[],
  tabs: chrome.tabs.Tab[],
  minimumTabs: number,
  ruleEligibility: RuleEligibility = new Map(),
): Promise<number> {
  const normalizedMinimumTabs = normalizeGroupMinTabs(minimumTabs)
  const alwaysManagedGroupTitles = new Set(
    rules
      .filter((rule) => rule.enabled && !ruleUsesMinimumTabs(rule, normalizedMinimumTabs))
      .map((rule) => rule.groupTitle),
  )
  let changed = 0

  for (const windowId of getWindowIdsFromTabs(tabs)) {
    const ineligibleThresholdGroupTitles = getIneligibleThresholdGroupTitles(rules, windowId, ruleEligibility, normalizedMinimumTabs)
    const groups = await chrome.tabGroups.query({ windowId })
    for (const group of groups) {
      if (group.title && ineligibleThresholdGroupTitles.has(group.title)) {
        const groupTabs = await chrome.tabs.query({ windowId, groupId: group.id })
        const tabIds = groupTabs.flatMap((tab) => typeof tab.id === 'number' ? [tab.id] : [])
        if (tabIds.length === 0) continue
        await chrome.tabs.ungroup(tabIds as [number, ...number[]])
        changed += tabIds.length
        continue
      }

      if (group.title && alwaysManagedGroupTitles.has(group.title)) continue
      const tabIds = await getFallbackGroupTabIdsBelowThreshold(group, windowId, normalizedMinimumTabs)
      if (tabIds.length === 0) continue
      await chrome.tabs.ungroup(tabIds as [number, ...number[]])
      changed += tabIds.length
    }
  }

  return changed
}

async function groupUngroupedTabsByDomain(sourceTabs: chrome.tabs.Tab[], minimumTabs: number): Promise<number> {
  const latestTabs = await getLatestTabsById(sourceTabs)
  const domainBuckets = new Map<string, chrome.tabs.Tab[]>()

  for (const tab of getEligibleDomainTabs(latestTabs)) {
    if (tab.groupId !== UNGROUPED_ID) continue
    const key = getDomainBucketKey(tab)
    if (!key) continue
    domainBuckets.set(key, [...(domainBuckets.get(key) ?? []), tab])
  }

  const candidateBuckets = [...domainBuckets.entries()]
    .map(([key, tabs]) => {
      const [windowId, domain] = key.split('\n')
      return { windowId: Number(windowId), domain, tabs }
    })
    .filter((bucket) => bucket.tabs.length >= minimumTabs && Number.isFinite(bucket.windowId))

  const titleCounts = new Map<string, number>()
  const plannedBuckets = candidateBuckets.map((bucket) => {
    const inferredTitle = inferTitleGroupName(bucket.tabs, bucket.domain)
    titleCounts.set(inferredTitle, (titleCounts.get(inferredTitle) ?? 0) + 1)
    return { ...bucket, inferredTitle }
  })

  let changed = 0
  for (const [index, bucket] of plannedBuckets.entries()) {
    const title = titleCounts.get(bucket.inferredTitle) === 1
      ? await getDomainGroupTitle(bucket.windowId, bucket.inferredTitle, bucket.domain)
      : `${bucket.inferredTitle} · ${bucket.domain}`
    const tabIds = bucket.tabs.flatMap((tab) => typeof tab.id === 'number' ? [tab.id] : [])
    await groupTabsIntoDomainGroup(bucket.windowId, tabIds, title, getDomainGroupColor(index), bucket.domain)
    changed += tabIds.length
  }

  return changed
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
