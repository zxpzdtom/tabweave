import { DEFAULT_PREFERENCES, DEFAULT_RULES, STORAGE_KEYS } from './constants'
import type { AutoGroupRule, Preferences } from './types'

const hasChromeStorage = () => typeof chrome !== 'undefined' && Boolean(chrome.storage)

const localFallback = new Map<string, unknown>()

async function getArea(sync = true) {
  return sync ? chrome.storage.sync : chrome.storage.local
}

async function setRulesArea(sync: boolean, rules: AutoGroupRule[]) {
  await (await getArea(sync)).set({ [STORAGE_KEYS.rules]: rules })
}

type LegacyPreferences = Partial<Preferences> & {
  domainGroupMinTabs?: number
}

function normalizePreferences(preferences?: LegacyPreferences): Preferences {
  const groupMinTabs = preferences?.groupMinTabs ?? preferences?.domainGroupMinTabs ?? DEFAULT_PREFERENCES.groupMinTabs
  return {
    ...DEFAULT_PREFERENCES,
    ...preferences,
    groupMinTabs,
  }
}

export async function getPreferences(): Promise<Preferences> {
  if (!hasChromeStorage()) return normalizePreferences(localFallback.get(STORAGE_KEYS.preferences) as LegacyPreferences | undefined)
  const result = await chrome.storage.sync.get(STORAGE_KEYS.preferences)
  return normalizePreferences(result[STORAGE_KEYS.preferences] as LegacyPreferences | undefined)
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  if (!hasChromeStorage()) {
    localFallback.set(STORAGE_KEYS.preferences, preferences)
    return
  }
  await chrome.storage.sync.set({ [STORAGE_KEYS.preferences]: preferences })
}

function normalizeRule(rule: AutoGroupRule): AutoGroupRule {
  const migratedRule =
    rule.id === 'chrome-management-default'
      ? {
          ...rule,
          name: 'Chrome 与扩展页面',
          target: 'url' as const,
          mode: 'regex' as const,
          pattern: '^chrome-extension://|^chrome://(?!newtab/?$)',
          groupTitle: rule.groupTitle || 'Chrome',
          color: rule.color || 'blue',
        }
      : rule.id === 'video-default'
        ? {
            ...rule,
            name: rule.name || '视频与流媒体',
            target: 'url' as const,
            mode: 'regex' as const,
            pattern: '(youtube\\.com|youtu\\.be|netflix\\.com|vimeo\\.com|twitch\\.tv)\n(bilibili\\.com|douyin\\.com|kuaishou\\.com|iqiyi\\.com|youku\\.com)',
            conditions: [
              {
                id: 'video-global-condition',
                target: 'url' as const,
                mode: 'regex' as const,
                pattern: '(youtube\\.com|youtu\\.be|netflix\\.com|vimeo\\.com|twitch\\.tv)',
              },
              {
                id: 'video-cn-condition',
                target: 'url' as const,
                mode: 'regex' as const,
                pattern: '(bilibili\\.com|douyin\\.com|kuaishou\\.com|iqiyi\\.com|youku\\.com)',
              },
            ],
            groupTitle: rule.groupTitle || 'Video',
            color: rule.color || 'red',
          }
        : rule

  if (Array.isArray(migratedRule.conditions) && migratedRule.conditions.length > 0) return migratedRule
  return {
    ...migratedRule,
    conditions: [
      {
        id: `${migratedRule.id}-condition-1`,
        target: migratedRule.target,
        mode: migratedRule.mode,
        pattern: migratedRule.pattern,
      },
    ],
  }
}

function mergeDefaultRules(rules: AutoGroupRule[]): AutoGroupRule[] {
  const existingIds = new Set(rules.map((rule) => rule.id))
  const migrated = rules.map(normalizeRule)
  const additions = DEFAULT_RULES.filter((rule) => !existingIds.has(rule.id)).map(normalizeRule)
  return additions.length > 0 ? [...additions, ...migrated] : migrated
}

export async function getRules(): Promise<AutoGroupRule[]> {
  if (!hasChromeStorage()) return mergeDefaultRules((localFallback.get(STORAGE_KEYS.rules) as AutoGroupRule[]) ?? DEFAULT_RULES)
  const preferences = await getPreferences()
  const primaryArea = await getArea(preferences.syncRules)
  const secondaryArea = await getArea(!preferences.syncRules)
  const [primary, secondary] = await Promise.all([primaryArea.get(STORAGE_KEYS.rules), secondaryArea.get(STORAGE_KEYS.rules)])
  const primaryRules = primary[STORAGE_KEYS.rules]
  const secondaryRules = secondary[STORAGE_KEYS.rules]
  const rules = [
    ...(Array.isArray(secondaryRules) ? secondaryRules as AutoGroupRule[] : []),
    ...(Array.isArray(primaryRules) ? primaryRules as AutoGroupRule[] : []),
  ]
  if (rules.length > 0) {
    const mergedById = [...mergeDefaultRules(rules).reduce((map, rule) => map.set(rule.id, rule), new Map<string, AutoGroupRule>()).values()]
    return mergedById
  }
  return mergeDefaultRules(DEFAULT_RULES)
}

export async function saveRules(rules: AutoGroupRule[]): Promise<void> {
  const normalizedRules = mergeDefaultRules(rules)
  if (!hasChromeStorage()) {
    localFallback.set(STORAGE_KEYS.rules, normalizedRules)
    return
  }
  const preferences = await getPreferences()
  try {
    await setRulesArea(preferences.syncRules, normalizedRules)
  } catch (error) {
    if (!preferences.syncRules) throw error
    await setRulesArea(false, normalizedRules)
    await savePreferences({ ...preferences, syncRules: false })
  }
}

export async function resetRules(): Promise<AutoGroupRule[]> {
  const restored = mergeDefaultRules(DEFAULT_RULES)
  await saveRules(restored)
  return restored
}
