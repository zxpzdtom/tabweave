import { DEFAULT_AI_GROUPING_SETTINGS, DEFAULT_GEMINI_AI_GROUPING_MODEL, DEFAULT_OPENROUTER_AI_GROUPING_MODEL, DEFAULT_PREFERENCES, DEFAULT_RULES, STORAGE_KEYS } from './constants'
import type { AiGroupingSettings, AutoGroupRule, HibernateResult, LanguageMode, Preferences, SnoozeItem } from './types'

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

type LegacyAiGroupingSettings = Partial<AiGroupingSettings> & {
  minTabs?: number
  outputLanguage?: LanguageMode
}

function normalizePreferences(preferences?: LegacyPreferences): Preferences {
  const groupMinTabs = preferences?.groupMinTabs ?? preferences?.domainGroupMinTabs ?? DEFAULT_PREFERENCES.groupMinTabs
  const hibernateAfterMinutes = Math.max(1, Math.floor(Number(preferences?.hibernateAfterMinutes ?? DEFAULT_PREFERENCES.hibernateAfterMinutes)))
  return {
    ...DEFAULT_PREFERENCES,
    ...preferences,
    groupMinTabs,
    hibernateAfterMinutes,
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

function normalizeAiGroupingSettings(settings?: LegacyAiGroupingSettings): AiGroupingSettings {
  const provider = settings?.provider ?? DEFAULT_AI_GROUPING_SETTINGS.provider
  const apiKeys = { ...(settings?.apiKeys ?? {}) }
  if (settings?.apiKey && !apiKeys[provider]) apiKeys[provider] = settings.apiKey
  const fallbackModel = provider === 'openrouter'
    ? DEFAULT_OPENROUTER_AI_GROUPING_MODEL
    : provider === 'gemini'
      ? DEFAULT_GEMINI_AI_GROUPING_MODEL
      : provider === 'compatible'
        ? ''
        : DEFAULT_AI_GROUPING_SETTINGS.model
  const currentSettings: Partial<AiGroupingSettings> = { ...(settings ?? {}) }
  delete (currentSettings as LegacyAiGroupingSettings).minTabs
  delete (currentSettings as LegacyAiGroupingSettings).outputLanguage
  return {
    ...DEFAULT_AI_GROUPING_SETTINGS,
    ...currentSettings,
    provider,
    model: settings?.model ?? fallbackModel,
    apiKeys,
    apiKey: apiKeys[provider] ?? settings?.apiKey ?? DEFAULT_AI_GROUPING_SETTINGS.apiKey,
    sendPageContext: settings?.sendPageContext ?? DEFAULT_AI_GROUPING_SETTINGS.sendPageContext,
    customPrompt: settings?.customPrompt?.trim() ? settings.customPrompt : DEFAULT_AI_GROUPING_SETTINGS.customPrompt,
  }
}

export async function getAiGroupingSettings(): Promise<AiGroupingSettings> {
  if (!hasChromeStorage()) return normalizeAiGroupingSettings(localFallback.get(STORAGE_KEYS.aiGroupingSettings) as LegacyAiGroupingSettings | undefined)
  const result = await chrome.storage.local.get(STORAGE_KEYS.aiGroupingSettings)
  return normalizeAiGroupingSettings(result[STORAGE_KEYS.aiGroupingSettings] as LegacyAiGroupingSettings | undefined)
}

export async function saveAiGroupingSettings(settings: AiGroupingSettings): Promise<void> {
  const normalized = normalizeAiGroupingSettings(settings)
  if (!hasChromeStorage()) {
    localFallback.set(STORAGE_KEYS.aiGroupingSettings, normalized)
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.aiGroupingSettings]: normalized })
}

export function parseAiGroupingApiKeys(apiKeyText: string): string[] {
  return [...new Set(apiKeyText.split(/[,\n]/).map((key) => key.trim()).filter(Boolean))]
}

export async function consumeAiGroupingApiKey(settings: AiGroupingSettings): Promise<string> {
  const apiKeys = parseAiGroupingApiKeys(settings.apiKey)
  if (apiKeys.length === 0) return ''
  if (apiKeys.length === 1) return apiKeys[0]

  const cursorKey = `${STORAGE_KEYS.aiGroupingApiKeyCursor}.${settings.provider}`
  const current = hasChromeStorage()
    ? (await chrome.storage.local.get(cursorKey))[cursorKey]
    : localFallback.get(cursorKey)
  const cursor = Number.isFinite(Number(current)) ? Math.max(0, Math.floor(Number(current))) : 0
  const apiKey = apiKeys[cursor % apiKeys.length]
  const nextCursor = (cursor + 1) % apiKeys.length

  if (!hasChromeStorage()) {
    localFallback.set(cursorKey, nextCursor)
  } else {
    await chrome.storage.local.set({ [cursorKey]: nextCursor })
  }

  return apiKey
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

function normalizeSavedRules(rules: AutoGroupRule[]): AutoGroupRule[] {
  return rules.map(normalizeRule)
}

function mergeRulesByPreferredOrder(primaryRules: AutoGroupRule[], secondaryRules: AutoGroupRule[]) {
  const secondaryById = new Map(secondaryRules.map((rule) => [rule.id, normalizeRule(rule)]))
  const primaryById = new Map(primaryRules.map((rule) => [rule.id, normalizeRule(rule)]))
  const merged = primaryRules.map((rule) => primaryById.get(rule.id) ?? normalizeRule(rule))

  for (const rule of secondaryRules) {
    if (primaryById.has(rule.id)) continue
    const secondaryRule = secondaryById.get(rule.id)
    if (secondaryRule) merged.push(secondaryRule)
  }

  return merged
}

export async function getRules(): Promise<AutoGroupRule[]> {
  if (!hasChromeStorage()) {
    if (localFallback.has(STORAGE_KEYS.rules)) {
      const savedRules = localFallback.get(STORAGE_KEYS.rules)
      return Array.isArray(savedRules) ? normalizeSavedRules(savedRules as AutoGroupRule[]) : []
    }
    return mergeDefaultRules(DEFAULT_RULES)
  }
  const preferences = await getPreferences()
  const primaryArea = await getArea(preferences.syncRules)
  const secondaryArea = await getArea(!preferences.syncRules)
  const [primary, secondary] = await Promise.all([primaryArea.get(STORAGE_KEYS.rules), secondaryArea.get(STORAGE_KEYS.rules)])
  const primaryRules = primary[STORAGE_KEYS.rules]
  const secondaryRules = secondary[STORAGE_KEYS.rules]
  if (Array.isArray(primaryRules)) {
    return normalizeSavedRules(primaryRules as AutoGroupRule[])
  }
  if (Array.isArray(secondaryRules)) {
    return normalizeSavedRules(secondaryRules as AutoGroupRule[])
  }
  const rules = mergeRulesByPreferredOrder(
    Array.isArray(primaryRules) ? primaryRules as AutoGroupRule[] : [],
    Array.isArray(secondaryRules) ? secondaryRules as AutoGroupRule[] : [],
  )
  if (rules.length > 0) {
    return mergeDefaultRules(rules)
  }
  return mergeDefaultRules(DEFAULT_RULES)
}

export async function saveRules(rules: AutoGroupRule[]): Promise<void> {
  const normalizedRules = normalizeSavedRules(rules)
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

export async function getLastHibernateResult(): Promise<HibernateResult | undefined> {
  if (!hasChromeStorage()) return localFallback.get(STORAGE_KEYS.hibernateLastResult) as HibernateResult | undefined
  const result = await chrome.storage.local.get(STORAGE_KEYS.hibernateLastResult)
  return result[STORAGE_KEYS.hibernateLastResult] as HibernateResult | undefined
}

export async function saveLastHibernateResult(result: HibernateResult): Promise<void> {
  if (!hasChromeStorage()) {
    localFallback.set(STORAGE_KEYS.hibernateLastResult, result)
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.hibernateLastResult]: result })
}

export async function getSnoozedTabs(): Promise<SnoozeItem[]> {
  if (!hasChromeStorage()) return (localFallback.get(STORAGE_KEYS.snoozedTabs) as SnoozeItem[] | undefined) ?? []
  const result = await chrome.storage.local.get(STORAGE_KEYS.snoozedTabs)
  return (result[STORAGE_KEYS.snoozedTabs] as SnoozeItem[] | undefined) ?? []
}

export async function saveSnoozedTabs(items: SnoozeItem[]): Promise<void> {
  if (!hasChromeStorage()) {
    localFallback.set(STORAGE_KEYS.snoozedTabs, items)
    return
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.snoozedTabs]: items })
}
