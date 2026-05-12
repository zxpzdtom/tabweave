import { getTargetWindowId } from './grouping'
import { saveLastHibernateResult } from './storage'
import type { HibernateResult, Preferences, RuleScope } from './types'

const MEDIA_HOST_PATTERNS = [
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)bilibili\.com$/i,
  /(^|\.)netflix\.com$/i,
  /(^|\.)twitch\.tv$/i,
  /(^|\.)vimeo\.com$/i,
  /(^|\.)spotify\.com$/i,
  /(^|\.)music\.apple\.com$/i,
  /(^|\.)music\.youtube\.com$/i,
  /(^|\.)music\.163\.com$/i,
  /(^|\.)douyin\.com$/i,
  /(^|\.)kuaishou\.com$/i,
  /(^|\.)iqiyi\.com$/i,
  /(^|\.)youku\.com$/i,
]

const COLLABORATION_HOST_PATTERNS = [
  /(^|\.)slack\.com$/i,
  /(^|\.)discord\.com$/i,
  /(^|\.)telegram\.org$/i,
  /(^|\.)web\.telegram\.org$/i,
  /(^|\.)whatsapp\.com$/i,
  /(^|\.)larksuite\.com$/i,
  /(^|\.)feishu\.cn$/i,
  /(^|\.)teams\.microsoft\.com$/i,
  /(^|\.)weixin\.qq\.com$/i,
  /(^|\.)work.weixin\.qq\.com$/i,
  /(^|\.)docs\.google\.com$/i,
  /(^|\.)notion\.so$/i,
]

function getHostname(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function isNormalDiscardTarget(url = '') {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

function matchesHostPattern(tab: chrome.tabs.Tab, patterns: RegExp[]) {
  const hostname = getHostname(tab.url)
  return Boolean(hostname) && patterns.some((pattern) => pattern.test(hostname))
}

function matchesWhitelist(tab: chrome.tabs.Tab, whitelist: string) {
  const url = tab.url ?? ''
  const title = tab.title ?? ''
  const domain = getHostname(url)
  const haystacks = { url: url.toLowerCase(), title: title.toLowerCase(), domain: domain.toLowerCase() }

  return whitelist
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => {
      const [rawPrefix, ...rest] = line.split(':')
      const prefix = rawPrefix.toLowerCase()
      const value = rest.join(':').trim()
      if (prefix === 'regex' && value) {
        try {
          return new RegExp(value, 'i').test(url) || new RegExp(value, 'i').test(title)
        } catch {
          return false
        }
      }
      if ((prefix === 'url' || prefix === 'title' || prefix === 'domain') && value) {
        return haystacks[prefix].includes(value.toLowerCase())
      }
      const normalizedLine = line.toLowerCase()
      return haystacks.url.includes(normalizedLine) || haystacks.title.includes(normalizedLine) || haystacks.domain.includes(normalizedLine)
    })
}

function canHibernateTab(tab: chrome.tabs.Tab, preferences: Preferences, now: number) {
  if (typeof tab.id !== 'number') return false
  if (!isNormalDiscardTarget(tab.url)) return false
  if (tab.active || tab.pinned || tab.audible || tab.discarded) return false
  if (preferences.hibernateProtectMedia && matchesHostPattern(tab, MEDIA_HOST_PATTERNS)) return false
  if (preferences.hibernateProtectCollaboration && matchesHostPattern(tab, COLLABORATION_HOST_PATTERNS)) return false
  if (matchesWhitelist(tab, preferences.hibernateWhitelist)) return false

  const lastAccessed = tab.lastAccessed ?? now
  const idleMs = Math.max(1, preferences.hibernateAfterMinutes) * 60_000
  return now - lastAccessed >= idleMs
}

export async function queryHibernateTabs(scope: RuleScope): Promise<chrome.tabs.Tab[]> {
  if (scope === 'allWindows') {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
    return windows.flatMap((window) => window.tabs ?? [])
  }
  const windowId = await getTargetWindowId()
  if (typeof windowId === 'number') return chrome.tabs.query({ windowId })
  return chrome.tabs.query({ currentWindow: true })
}

export async function hibernateTabs(tabs: chrome.tabs.Tab[], preferences: Preferences): Promise<HibernateResult> {
  const now = Date.now()
  const candidates = tabs.filter((tab) => canHibernateTab(tab, preferences, now))
  let discarded = 0

  for (const tab of candidates) {
    if (typeof tab.id !== 'number') continue
    const result = await chrome.tabs.discard(tab.id).catch(() => undefined)
    if (result?.discarded) discarded += 1
  }

  const report = {
    discarded,
    checked: tabs.length,
    candidates: candidates.length,
    skipped: Math.max(0, tabs.length - candidates.length),
    timestamp: now,
  }
  await saveLastHibernateResult(report)
  return report
}

export async function hibernateByScope(preferences: Preferences): Promise<HibernateResult> {
  return hibernateTabs(await queryHibernateTabs(preferences.hibernateScope), preferences)
}
