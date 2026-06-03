export type MatchTarget = 'url' | 'title' | 'domain'
export type MatchMode = 'contains' | 'regex' | 'equals'
export type RuleScope = 'currentWindow' | 'allWindows'
export type ThemeMode = 'dark' | 'light' | 'system'
export type LanguageMode = 'system' | 'zh' | 'en'
export type UiDensity = 'default' | 'compact'
export type AiGroupingProvider = 'openai' | 'openrouter' | 'gemini' | 'compatible'

export type ChromeGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange'

export interface RuleCondition {
  id: string
  target: MatchTarget
  mode: MatchMode
  pattern: string
}

export interface AutoGroupRule {
  id: string
  name: string
  enabled: boolean
  target: MatchTarget
  mode: MatchMode
  pattern: string
  conditions?: RuleCondition[]
  groupTitle: string
  color: ChromeGroupColor
  scope: RuleScope
  minTabs?: number
  createdAt: number
  updatedAt: number
}

export interface Preferences {
  autoGroupOnCreate: boolean
  autoGroupOnUpdate: boolean
  organizeScope: RuleScope
  autoDeduplicateTabs: boolean
  deduplicateOnOrganize: boolean
  autoHibernateTabs: boolean
  hibernateAfterMinutes: number
  hibernateScope: RuleScope
  hibernateProtectMedia: boolean
  hibernateProtectCollaboration: boolean
  hibernateOnOrganize: boolean
  hibernateWhitelist: string
  autoCollapseGroups: boolean
  domainFallbackGrouping: boolean
  groupMinTabs: number
  duplicateScope: RuleScope
  syncRules: boolean
  autoGroupOnPopupOpen: boolean
  openInSidePanel: boolean
  themeMode: ThemeMode
  languageMode: LanguageMode
  uiDensity: UiDensity
  newTabDashboardEnabled: boolean
  newTabShowSearch: boolean
}

export interface AiGroupingSettings {
  enabled: boolean
  provider: AiGroupingProvider
  model: string
  models: Partial<Record<AiGroupingProvider, string>>
  apiKey: string
  apiKeys: Partial<Record<AiGroupingProvider, string>>
  baseUrl: string
  sendUrls: boolean
  sendTitles: boolean
  sendPageContext: boolean
  includeGroupedTabs: boolean
  scope: RuleScope
  customPrompt: string
}

export interface AiGroupingPageContext {
  title?: string
  canonicalUrl?: string
  description?: string
  ogTitle?: string
  ogDescription?: string
  ogSiteName?: string
  twitterTitle?: string
  twitterDescription?: string
  language?: string
  headings?: string[]
}

export interface AiGroupingTabInput {
  id: number
  windowId: number
  title?: string
  url?: string
  domain: string
  groupTitle?: string
  pageContext?: AiGroupingPageContext
}

export interface AiGroupingPlanGroup {
  title: string
  color: ChromeGroupColor
  tabIds: number[]
  reason?: string
}

export interface AiGroupingPlan {
  groups: AiGroupingPlanGroup[]
  ungroupedTabIds: number[]
}

export interface ShortcutInfo {
  name: string
  description?: string
  shortcut?: string
}

export interface TabSnapshot {
  id: number
  title: string
  url: string
  favIconUrl?: string
  groupId: number
  active: boolean
  index: number
  lastAccessed: number
}

export interface GroupSnapshot {
  id: number
  title: string
  color: ChromeGroupColor
  collapsed: boolean
  tabs: TabSnapshot[]
}

export interface WindowSnapshot {
  groups: GroupSnapshot[]
  ungroupedTabs: TabSnapshot[]
}

export interface SnoozeItem {
  id: string
  url: string
  title: string
  favIconUrl?: string
  wakeUpAt: number
  createdAt: number
  recurring?: {
    hour: number
    minute: number
  }
  /** Shared ID linking tabs that were snoozed together as a group */
  groupId?: string
  /** Original Chrome tab group title */
  groupTitle?: string
  /** Original Chrome tab group color */
  groupColor?: ChromeGroupColor
}

export interface HibernateResult {
  discarded: number
  checked: number
  candidates: number
  skipped: number
  timestamp: number
}

export interface SessionSnapshotTab {
  url: string
  title: string
  favIconUrl?: string
  groupTitle?: string
  groupColor?: ChromeGroupColor
}

export interface SessionSnapshot {
  id: string
  name: string
  createdAt: number
  tabs: SessionSnapshotTab[]
}
