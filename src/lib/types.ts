export type MatchTarget = 'url' | 'title' | 'domain'
export type MatchMode = 'contains' | 'regex' | 'equals'
export type RuleScope = 'currentWindow' | 'allWindows'
export type ThemeMode = 'dark' | 'light' | 'system'
export type LanguageMode = 'system' | 'zh' | 'en'

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
  themeMode: ThemeMode
  languageMode: LanguageMode
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

export interface HibernateResult {
  discarded: number
  checked: number
  candidates: number
  skipped: number
  timestamp: number
}
