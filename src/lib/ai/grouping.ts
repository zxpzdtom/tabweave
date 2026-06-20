import { generateText, Output } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod/v4'
import { GROUP_COLORS } from '../constants'
import { getDomain, queryTabsByScope, UNGROUPED_ID } from '../grouping'
import { getLanguageName } from '../i18n'
import { consumeAiGroupingApiKey, getPreferences, getRules, parseAiGroupingApiKeys, saveRules } from '../storage'
import type { AiGroupingPageContext, AiGroupingPlan, AiGroupingPlanGroup, AiGroupingSettings, AiGroupingTabInput, AutoGroupRule, ChromeGroupColor, Preferences, RuleCondition } from '../types'
import { isChromeBuiltInAiProvider } from './chrome-built-in'

const PROVIDER_BASE_URLS: Record<AiGroupingSettings['provider'], string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  compatible: '',
  chromeBuiltIn: '',
}

const AI_REQUEST_TIMEOUT_MS = 45_000
const GEMINI_REQUEST_TIMEOUT_MS = 75_000
const COMPATIBLE_REQUEST_TIMEOUT_MS = 60_000
const OPENROUTER_REQUEST_TIMEOUT_MS = GEMINI_REQUEST_TIMEOUT_MS
const CHROME_BUILT_IN_AI_TIMEOUT_MS = 180_000
const AI_GROUPING_MAX_OUTPUT_TOKENS = 1200
const AI_PAGE_CONTEXT_TIMEOUT_MS = 900
const AI_PAGE_CONTEXT_MAX_TABS = 40

const colorSchema = z.enum(GROUP_COLORS as [ChromeGroupColor, ...ChromeGroupColor[]])
const groupingPlanJsonSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 32 },
          color: { enum: GROUP_COLORS },
          tabIds: {
            type: 'array',
            items: { type: 'integer' },
          },
          reason: { type: 'string', maxLength: 160 },
        },
        required: ['title', 'color', 'tabIds'],
        additionalProperties: false,
      },
    },
    ungroupedTabIds: {
      type: 'array',
      items: { type: 'integer' },
    },
  },
  required: ['groups', 'ungroupedTabIds'],
  additionalProperties: false,
} as const
const groupingPlanSchema = z.object({
  groups: z.array(z.object({
    title: z.string().min(1).max(32),
    color: colorSchema,
    tabIds: z.array(z.number().int()),
    reason: z.string().max(160).optional(),
  })).max(20),
  ungroupedTabIds: z.array(z.number().int()).default([]),
})

function getBaseUrl(settings: AiGroupingSettings) {
  return settings.provider === 'compatible' ? settings.baseUrl.trim() : PROVIDER_BASE_URLS[settings.provider]
}

function getProviderName(settings: AiGroupingSettings) {
  return settings.provider === 'compatible' ? 'tabweave-compatible' : `tabweave-${settings.provider}`
}

function collectPageContextFromDocument(): AiGroupingPageContext {
  const getMetaContent = (name: string) => {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(name) : name.replace(/"/g, '\\"')
    const selector = `meta[name="${escaped}"], meta[property="${escaped}"]`
    return document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? ''
  }
  const headings = [...document.querySelectorAll<HTMLHeadingElement>('h1, h2')]
    .map((heading) => heading.innerText.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 6)
  const canonicalUrl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href?.trim()

  return {
    title: document.title?.trim() || undefined,
    canonicalUrl: canonicalUrl || undefined,
    description: getMetaContent('description') || undefined,
    ogTitle: getMetaContent('og:title') || undefined,
    ogDescription: getMetaContent('og:description') || undefined,
    ogSiteName: getMetaContent('og:site_name') || undefined,
    twitterTitle: getMetaContent('twitter:title') || undefined,
    twitterDescription: getMetaContent('twitter:description') || undefined,
    language: document.documentElement.lang?.trim() || undefined,
    headings,
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(() => resolve(undefined), timeoutMs)
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(undefined))
      .finally(() => globalThis.clearTimeout(timeout))
  })
}

function canCollectPageContext(tab: chrome.tabs.Tab) {
  return typeof tab.id === 'number' && /^https?:\/\//i.test(tab.url ?? '')
}

function compactContextText(value: string | undefined, maxLength: number) {
  const text = String(value ?? '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, maxLength) : undefined
}

async function collectPageContext(tab: chrome.tabs.Tab, settings: AiGroupingSettings): Promise<AiGroupingPageContext | undefined> {
  if (!settings.sendPageContext || !canCollectPageContext(tab)) return undefined
  const result = await withTimeout(
    chrome.scripting.executeScript({
      target: { tabId: tab.id as number },
      func: collectPageContextFromDocument,
    }),
    AI_PAGE_CONTEXT_TIMEOUT_MS,
  )
  const context = result?.[0]?.result
  if (!context || typeof context !== 'object') return undefined

  return {
    title: settings.sendTitles ? compactContextText(context.title, 160) : undefined,
    canonicalUrl: settings.sendUrls ? compactContextText(context.canonicalUrl, 260) : undefined,
    description: compactContextText(context.description, 280),
    ogTitle: compactContextText(context.ogTitle, 160),
    ogDescription: compactContextText(context.ogDescription, 280),
    ogSiteName: compactContextText(context.ogSiteName, 80),
    twitterTitle: compactContextText(context.twitterTitle, 160),
    twitterDescription: compactContextText(context.twitterDescription, 280),
    language: compactContextText(context.language, 40),
    headings: context.headings?.map((heading) => compactContextText(heading, 120)).filter((heading): heading is string => Boolean(heading)).slice(0, 6),
  }
}

async function collectPageContexts(tabs: chrome.tabs.Tab[], settings: AiGroupingSettings) {
  if (!settings.sendPageContext) return new Map<number, AiGroupingPageContext>()
  const candidates = tabs.filter(canCollectPageContext).slice(0, AI_PAGE_CONTEXT_MAX_TABS)
  const entries = await Promise.all(candidates.map(async (tab) => {
    const context = await collectPageContext(tab, settings)
    return context && typeof tab.id === 'number' ? [tab.id, context] as const : undefined
  }))
  return new Map(entries.filter((entry): entry is readonly [number, AiGroupingPageContext] => Boolean(entry)))
}

function getTabInput(tab: chrome.tabs.Tab, groupById: Map<number, chrome.tabGroups.TabGroup>, settings: AiGroupingSettings): AiGroupingTabInput | undefined {
  if (typeof tab.id !== 'number' || typeof tab.windowId !== 'number') return undefined
  const url = tab.url ?? ''
  const domain = getDomain(url)
  if (!domain && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://')) return undefined
  const group = typeof tab.groupId === 'number' && tab.groupId !== UNGROUPED_ID ? groupById.get(tab.groupId) : undefined
  if (group && !settings.includeGroupedTabs) return undefined

  return {
    id: tab.id,
    windowId: tab.windowId,
    title: settings.sendTitles ? tab.title || 'Untitled' : undefined,
    url: settings.sendUrls ? url : undefined,
    domain,
    groupTitle: group?.title,
  }
}

async function getGroupsForTabs(tabs: chrome.tabs.Tab[]) {
  const windowIds = [...new Set(tabs.flatMap((tab) => typeof tab.windowId === 'number' ? [tab.windowId] : []))]
  const groups = await Promise.all(windowIds.map((windowId) => chrome.tabGroups.query({ windowId })))
  return new Map(groups.flat().map((group) => [group.id, group]))
}

export async function collectAiGroupingTabs(settings: AiGroupingSettings): Promise<AiGroupingTabInput[]> {
  const tabs = await queryTabsByScope(settings.scope)
  const groupById = await getGroupsForTabs(tabs)
  const inputs = tabs.flatMap((tab) => {
    const input = getTabInput(tab, groupById, settings)
    return input ? [input] : []
  })
  const inputIds = new Set(inputs.map((input) => input.id))
  const pageContextByTabId = await collectPageContexts(tabs.filter((tab) => typeof tab.id === 'number' && inputIds.has(tab.id)), settings)
  return inputs.map((input) => ({ ...input, pageContext: pageContextByTabId.get(input.id) }))
}

function compactPromptField(value: string | number | undefined) {
  return String(value ?? '-').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || '-'
}

function formatTabsForPrompt(tabs: AiGroupingTabInput[]) {
  const header = ['id', 'window', 'domain', 'group', 'title', 'url', 'page_context'].join('\t')
  const rows = tabs.map((tab) => [
    tab.id,
    tab.windowId,
    tab.domain,
    tab.groupTitle,
    tab.title,
    tab.url,
    formatPageContextForPrompt(tab.pageContext),
  ].map(compactPromptField).join('\t'))
  return ['Tabs, one per line. Fields are tab-separated:', header, ...rows].join('\n')
}

function formatPageContextForPrompt(context: AiGroupingPageContext | undefined) {
  if (!context) return ''
  const parts = [
    context.title && `title=${context.title}`,
    context.canonicalUrl && `canonical=${context.canonicalUrl}`,
    context.description && `description=${context.description}`,
    context.ogTitle && `og_title=${context.ogTitle}`,
    context.ogDescription && `og_description=${context.ogDescription}`,
    context.ogSiteName && `og_site=${context.ogSiteName}`,
    context.twitterTitle && `twitter_title=${context.twitterTitle}`,
    context.twitterDescription && `twitter_description=${context.twitterDescription}`,
    context.language && `lang=${context.language}`,
    context.headings && context.headings.length > 0 && `headings=${context.headings.join(' / ')}`,
  ].filter(Boolean)
  return parts.join(' | ')
}

function buildPrompt(tabs: AiGroupingTabInput[], settings: AiGroupingSettings, preferences: Preferences) {
  const language = getLanguageName(preferences.languageMode)
  const minTabs = preferences.groupMinTabs
  const exampleTitle = language === 'Chinese' ? '开发' : 'Code'
  const exampleReason = language === 'Chinese' ? '这些标签围绕同一个开发任务。' : 'These tabs support the same development task.'
  const customPrompt = renderPromptTemplate(settings.customPrompt, {
    language,
    minTabs: String(minTabs),
    tabCount: String(tabs.length),
  })
  return [
    'You are organizing browser tabs into useful Chrome tab groups.',
    'Return only groups that help a user regain context. Prefer project, workflow, topic, or app categories over overly broad buckets.',
    `Only create groups with at least ${minTabs} tabs unless a smaller group is clearly important.`,
    'Use short group titles, 1-3 words. Use only the provided tab ids. Do not invent ids.',
    'Leave unrelated one-off tabs in ungroupedTabIds.',
    `Return group titles and reason descriptions in ${language}.`,
    `When you include reason, write one concise user-facing sentence in ${language}.`,
    'Use page_context as supporting evidence when it exists, especially meta descriptions, Open Graph data, canonical URLs, and headings.',
    'Do not create rule conditions. TabWeave will handle any optional rule saving locally after the user reviews the plan.',
    'Available colors: ' + GROUP_COLORS.join(', ') + '.',
    `Return a JSON object with this shape: {"groups":[{"title":"${exampleTitle}","color":"purple","tabIds":[123],"reason":"${exampleReason}"}],"ungroupedTabIds":[456]}.`,
    'Do not include markdown fences, prose, comments, or extra keys.',
    '',
    'User grouping preferences:',
    customPrompt || 'Use balanced, practical groups based on topic and workflow.',
    '',
    formatTabsForPrompt(tabs),
  ].join('\n')
}

function renderPromptTemplate(template: string, variables: Record<string, string>) {
  return template.trim().replace(/\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g, (match, name: string) => variables[name] ?? match)
}

function normalizeTitle(title: string) {
  return title.replace(/\s+/g, ' ').trim().slice(0, 32)
}

export function normalizeAiGroupingPlan(plan: AiGroupingPlan, tabs: AiGroupingTabInput[], minTabs: number): AiGroupingPlan {
  const liveIds = new Set(tabs.map((tab) => tab.id))
  const assignedIds = new Set<number>()
  const groups: AiGroupingPlanGroup[] = []

  for (const group of plan.groups) {
    const title = normalizeTitle(group.title)
    const tabIds = [...new Set(group.tabIds)].filter((id) => liveIds.has(id) && !assignedIds.has(id))
    if (!title || tabIds.length < minTabs) continue
    tabIds.forEach((id) => assignedIds.add(id))
    groups.push({
      title,
      color: GROUP_COLORS.includes(group.color) ? group.color : 'blue',
      tabIds,
      reason: group.reason?.trim().slice(0, 160),
    })
  }

  const ungroupedTabIds = [...new Set([...(plan.ungroupedTabIds ?? []), ...tabs.map((tab) => tab.id).filter((id) => !assignedIds.has(id))])]
    .filter((id) => liveIds.has(id) && !assignedIds.has(id))

  return { groups, ungroupedTabIds }
}

async function generateStructuredAiGroupingPlan(settings: AiGroupingSettings, tabs: AiGroupingTabInput[], baseURL: string, apiKey: string, preferences: Preferences) {
  const provider = createOpenAICompatible({
    name: getProviderName(settings),
    baseURL,
    apiKey,
    supportsStructuredOutputs: true,
  })
  const { output } = await generateText({
    model: provider.chatModel(settings.model.trim()),
    output: Output.object({ schema: groupingPlanSchema }),
    temperature: 0.2,
    prompt: buildPrompt(tabs, settings, preferences),
    timeout: AI_REQUEST_TIMEOUT_MS,
  })

  return output
}

function getChatCompletionsUrl(baseURL: string) {
  return `${baseURL.replace(/\/+$/, '')}/chat/completions`
}

function getTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
      return ''
    })
    .join('')
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = (fenced ?? text).trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('AI returned an empty or non-JSON response')
  return source.slice(start, end + 1)
}

function getProviderErrorPayload(value: unknown): unknown {
  if (Array.isArray(value)) return getProviderErrorPayload(value[0])
  if (value && typeof value === 'object' && 'error' in value) return value.error
  return value
}

function getRetryDelaySeconds(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('details' in value) || !Array.isArray(value.details)) return undefined
  for (const detail of value.details) {
    if (!detail || typeof detail !== 'object' || !('retryDelay' in detail) || typeof detail.retryDelay !== 'string') continue
    const match = detail.retryDelay.match(/^(\d+(?:\.\d+)?)s$/)
    if (match) return String(Math.ceil(Number(match[1])))
  }
  return undefined
}

function formatAiHttpError(status: number, text: string, statusText: string) {
  try {
    const payload = getProviderErrorPayload(JSON.parse(text))
    if (payload && typeof payload === 'object') {
      const message = 'message' in payload && typeof payload.message === 'string' ? payload.message : ''
      const code = 'code' in payload && (typeof payload.code === 'string' || typeof payload.code === 'number') ? String(payload.code) : String(status)
      const retryAfter = getRetryDelaySeconds(payload)
      const retryText = retryAfter ? ` Retry after about ${retryAfter}s.` : ''
      if (message) return `AI request failed (${code}): ${message}${retryText}`
    }
  } catch {
    // Fall back to the raw response preview below.
  }

  return `AI request failed (${status}): ${text.slice(0, 240) || statusText}`
}

function getOpenRouterModels(settings: AiGroupingSettings) {
  return [settings.model.trim()].filter(Boolean)
}

function getOpenRouterHeaders(settings: AiGroupingSettings): Record<string, string> {
  if (settings.provider !== 'openrouter') return {}
  return {
    'HTTP-Referer': 'https://github.com',
    'X-OpenRouter-Title': 'TabWeave',
  }
}

function getOpenRouterRequestOptions(settings: AiGroupingSettings) {
  if (settings.provider !== 'openrouter') return {}
  return {
    response_format: { type: 'json_object' },
    reasoning: { enabled: false },
    include_reasoning: false,
    plugins: [{ id: 'response-healing' }],
  }
}

function getLenientRequestOptions(settings: AiGroupingSettings) {
  if (settings.provider === 'gemini') return {}
  return {
    max_tokens: AI_GROUPING_MAX_OUTPUT_TOKENS,
    ...getOpenRouterRequestOptions(settings),
  }
}

function getRequestTimeoutMs(settings: AiGroupingSettings) {
  if (settings.provider === 'chromeBuiltIn') return CHROME_BUILT_IN_AI_TIMEOUT_MS
  if (settings.provider === 'openrouter') return OPENROUTER_REQUEST_TIMEOUT_MS
  if (settings.provider === 'gemini') return GEMINI_REQUEST_TIMEOUT_MS
  if (settings.provider === 'compatible') return COMPATIBLE_REQUEST_TIMEOUT_MS
  return AI_REQUEST_TIMEOUT_MS
}

function formatChromeBuiltInAvailability(availability: ChromeAiAvailability) {
  if (availability === 'unavailable') {
    return 'Chrome built-in AI is not available on this device. Use Chrome 138+ on a supported desktop device, then try again.'
  }
  if (availability === 'downloadable' || availability === 'downloading') {
    return 'Chrome built-in AI model is not ready yet. Keep the Popup or Side Panel open while Chrome downloads the local model, then try again.'
  }
  return ''
}

async function generateChromeBuiltInAiGroupingPlan(settings: AiGroupingSettings, tabs: AiGroupingTabInput[], preferences: Preferences) {
  if (typeof LanguageModel === 'undefined') {
    throw new Error('Chrome built-in AI is not available in this browser. Use Chrome 138+ on a supported desktop device.')
  }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), CHROME_BUILT_IN_AI_TIMEOUT_MS)
  let session: ChromeAiLanguageModelSession | undefined

  try {
    const availability = await LanguageModel.availability()
    if (availability !== 'available') throw new Error(formatChromeBuiltInAvailability(availability))

    session = await LanguageModel.create({
      signal: controller.signal,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', () => undefined)
      },
    })

    const response = await session.prompt(buildPrompt(tabs, settings, preferences), {
      signal: controller.signal,
      responseConstraint: groupingPlanJsonSchema,
    })

    return groupingPlanSchema.parse(JSON.parse(extractJsonObject(response)))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Chrome built-in AI did not finish in time. If this is the first run, the local model may still be downloading.', { cause: error })
    }
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('Chrome needs a direct user action before starting built-in AI. Run AI organize again from the Popup or Side Panel.', { cause: error })
    }
    throw error
  } finally {
    session?.destroy()
    globalThis.clearTimeout(timeout)
  }
}

async function generateLenientAiGroupingPlanWithModel(
  settings: AiGroupingSettings,
  tabs: AiGroupingTabInput[],
  baseURL: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
  preferences: Preferences,
) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(getChatCompletionsUrl(baseURL), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...getOpenRouterHeaders(settings),
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...getLenientRequestOptions(settings),
        messages: [
          {
            role: 'user',
            content: buildPrompt(tabs, settings, preferences),
          },
        ],
      }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(formatAiHttpError(response.status, text, response.statusText))
    if (!text.trim()) throw new Error('AI returned an empty response')

    const body = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = getTextContent(body.choices?.[0]?.message?.content)
    if (!content.trim()) throw new Error('AI returned an empty message')

    return groupingPlanSchema.parse(JSON.parse(extractJsonObject(content)))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)}s`, { cause: error })
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

async function generateLenientAiGroupingPlan(settings: AiGroupingSettings, tabs: AiGroupingTabInput[], baseURL: string, apiKey: string, preferences: Preferences) {
  const models = getOpenRouterModels(settings)
  const errors: string[] = []

  for (const model of models) {
    try {
      return await generateLenientAiGroupingPlanWithModel(
        settings,
        tabs,
        baseURL,
        apiKey,
        model,
        getRequestTimeoutMs(settings),
        preferences,
      )
    } catch (error) {
      errors.push(`${model}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (models.length === 1) throw new Error(errors[0] ?? 'AI grouping failed')
  throw new Error(`AI grouping failed across ${models.length} models: ${errors.join(' | ')}`)
}

export async function generateAiGroupingPlan(settings: AiGroupingSettings): Promise<{ plan: AiGroupingPlan; checked: number }> {
  const baseURL = getBaseUrl(settings)
  if (!settings.enabled) throw new Error('AI grouping is disabled')
  if (!isChromeBuiltInAiProvider(settings.provider)) {
    if (parseAiGroupingApiKeys(settings.apiKey).length === 0) throw new Error('Missing AI API key')
    if (!settings.model.trim()) throw new Error('Missing AI model')
    if (!baseURL) throw new Error('Missing AI provider base URL')
  }

  const preferences = await getPreferences()
  const tabs = await collectAiGroupingTabs(settings)
  if (tabs.length === 0) return { plan: { groups: [], ungroupedTabIds: [] }, checked: 0 }

  const apiKey = isChromeBuiltInAiProvider(settings.provider) ? '' : await consumeAiGroupingApiKey(settings)
  const plan = isChromeBuiltInAiProvider(settings.provider)
    ? await generateChromeBuiltInAiGroupingPlan(settings, tabs, preferences)
    : settings.provider === 'openai'
    ? await generateStructuredAiGroupingPlan(settings, tabs, baseURL, apiKey, preferences)
    : await generateLenientAiGroupingPlan(settings, tabs, baseURL, apiKey, preferences)

  return {
    plan: normalizeAiGroupingPlan(plan, tabs, preferences.groupMinTabs),
    checked: tabs.length,
  }
}

async function findExistingGroup(windowId: number, title: string) {
  const groups = await chrome.tabGroups.query({ windowId })
  return groups.find((group) => group.title === title)
}

function createFullUrlRuleConditions(tabs: chrome.tabs.Tab[]): RuleCondition[] {
  const seenPatterns = new Set<string>()
  return tabs
    .map((tab) => tab.url?.trim() ?? '')
    .filter((pattern) => {
      if (!pattern || seenPatterns.has(pattern)) return false
      seenPatterns.add(pattern)
      return true
    })
    .map((pattern) => ({ id: crypto.randomUUID(), target: 'url', mode: 'equals', pattern }))
}

function createAiRuleFromGroup(group: AiGroupingPlanGroup, tabs: chrome.tabs.Tab[], minTabs: number): AutoGroupRule | undefined {
  const conditions = createFullUrlRuleConditions(tabs)
  const [firstCondition] = conditions
  if (!firstCondition) return undefined

  const timestamp = Date.now()
  return {
    id: crypto.randomUUID(),
    name: group.title,
    enabled: true,
    target: firstCondition.target,
    mode: firstCondition.mode,
    pattern: firstCondition.pattern,
    conditions,
    groupTitle: group.title,
    color: group.color,
    scope: 'currentWindow',
    minTabs,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function getRuleSignature(rule: AutoGroupRule) {
  const conditions = (rule.conditions && rule.conditions.length > 0
    ? rule.conditions
    : [{ target: rule.target, mode: rule.mode, pattern: rule.pattern }]
  )
    .map((condition) => `${condition.target}:${condition.mode}:${condition.pattern.trim().toLowerCase()}`)
    .sort()
    .join('|')
  return `${rule.groupTitle.trim().toLowerCase()}|${rule.color}|${conditions}`
}

async function saveAiRulesAtTop(rules: AutoGroupRule[]) {
  if (rules.length === 0) return 0
  const currentRules = await getRules()
  const nextSignatures = new Set(rules.map(getRuleSignature))
  const dedupedCurrentRules = currentRules.filter((rule) => !nextSignatures.has(getRuleSignature(rule)))
  await saveRules([...rules, ...dedupedCurrentRules])
  return rules.length
}

export async function applyAiGroupingPlan(plan: AiGroupingPlan, options: { saveRules?: boolean } = {}): Promise<number> {
  let changed = 0
  const preferences = await getPreferences()
  const rulesToSave: AutoGroupRule[] = []

  for (const group of plan.groups) {
    const latestTabs = await Promise.all(group.tabIds.map((id) => chrome.tabs.get(id).catch(() => undefined)))
    const tabsByWindow = new Map<number, chrome.tabs.Tab[]>()
    for (const tab of latestTabs) {
      if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') continue
      tabsByWindow.set(tab.windowId, [...(tabsByWindow.get(tab.windowId) ?? []), tab])
    }

    for (const [windowId, tabs] of tabsByWindow) {
      const tabIds = tabs.flatMap((tab) => typeof tab.id === 'number' ? [tab.id] : [])
      if (tabIds.length === 0) continue
      const existing = await findExistingGroup(windowId, group.title)
      const groupId = await chrome.tabs.group({ tabIds: tabIds as [number, ...number[]], groupId: existing?.id })
      await chrome.tabGroups.update(groupId, { title: group.title, color: group.color, collapsed: false })
      changed += tabIds.length
    }

    if (options.saveRules) {
      const rule = createAiRuleFromGroup(group, latestTabs.filter((tab): tab is chrome.tabs.Tab => Boolean(tab)), preferences.groupMinTabs)
      if (rule) rulesToSave.push(rule)
    }
  }

  if (options.saveRules) await saveAiRulesAtTop(rulesToSave)

  return changed
}
