import type { AiGroupingSettings, AutoGroupRule, ChromeGroupColor, Preferences } from './types'

export const STORAGE_KEYS = {
  rules: 'tabweave.rules',
  preferences: 'tabweave.preferences',
  hibernateLastResult: 'tabweave.hibernateLastResult',
  aiGroupingSettings: 'tabweave.aiGroupingSettings',
  aiGroupingApiKeyCursor: 'tabweave.aiGroupingApiKeyCursor',
  snoozedTabs: 'tabweave.snoozedTabs',
  snapshots: 'tabweave.snapshots',
} as const

export const DEFAULT_GROUP_MIN_TABS = 3
export const DEFAULT_HIBERNATE_AFTER_MINUTES = 30
export const OPENROUTER_AI_GROUPING_MODEL_PLACEHOLDER = 'provider/model'
export const DEFAULT_GEMINI_AI_GROUPING_MODEL = 'gemini-2.5-flash'
export const DEFAULT_AI_GROUPING_PROMPT_EN = [
  'Group tabs by the user intent behind them, not only by domain.',
  'Return group names and explanations in {{language}}.',
  'When several tabs support the same task or project, group them together even if they come from different tools or domains.',
  'For development work, treat local/dev pages, GitHub issues or PRs, deployment dashboards, logs, monitoring, API docs, product requirements, design files, and related chats as one workflow when they clearly refer to the same feature, bug, release, or product.',
  'Prefer practical group names based on the project, product, feature, workflow, or intent when obvious; otherwise use categories such as Code, Research, Design, AI, Docs, Social, Shopping, Travel, or Finance.',
  'Keep one-off pages ungrouped unless they clearly belong with another tab.',
  'Use concise group names that would make sense in a Chrome tab group.',
].join('\n')

export const DEFAULT_AI_GROUPING_PROMPT_ZH = [
  '按用户意图对标签页进行分组，而不仅仅按域名。',
  '用{{language}}返回分组名称和说明。',
  '当多个标签页服务于同一个任务或项目时，即使来自不同工具或域名也应归为一组。',
  '对于开发工作，将本地/开发页面、GitHub Issue 或 PR、部署仪表盘、日志、监控、API 文档、产品需求、设计稿和相关聊天视为同一工作流（当它们明显关联同一功能、Bug、发布或产品时）。',
  '优先使用基于项目、产品、功能、工作流或意图的实用分组名；其次使用类别名如 Code、Research、Design、AI、Docs、Social、Shopping、Travel 或 Finance。',
  '独立的页面保持未分组，除非它明显属于另一个标签页的上下文。',
  '使用简洁的分组名，使其在 Chrome 标签分组中一目了然。',
].join('\n')

export const DEFAULT_AI_GROUPING_PROMPT = DEFAULT_AI_GROUPING_PROMPT_EN

export function getDefaultAiGroupingPrompt(lang: 'zh' | 'en'): string {
  return lang === 'zh' ? DEFAULT_AI_GROUPING_PROMPT_ZH : DEFAULT_AI_GROUPING_PROMPT_EN
}

export function isDefaultAiGroupingPrompt(prompt: string): boolean {
  const trimmed = prompt.trim()
  return trimmed === DEFAULT_AI_GROUPING_PROMPT_EN || trimmed === DEFAULT_AI_GROUPING_PROMPT_ZH
}

export const DEFAULT_PREFERENCES: Preferences = {
  autoGroupOnCreate: true,
  autoGroupOnUpdate: true,
  organizeScope: 'currentWindow',
  autoDeduplicateTabs: false,
  deduplicateOnOrganize: false,
  autoHibernateTabs: false,
  hibernateAfterMinutes: DEFAULT_HIBERNATE_AFTER_MINUTES,
  hibernateScope: 'currentWindow',
  hibernateProtectMedia: true,
  hibernateProtectCollaboration: true,
  hibernateOnOrganize: false,
  hibernateWhitelist: '',
  autoCollapseGroups: false,
  domainFallbackGrouping: true,
  groupMinTabs: DEFAULT_GROUP_MIN_TABS,
  duplicateScope: 'currentWindow',
  syncRules: false,
  autoGroupOnPopupOpen: false,
  openInSidePanel: true,
  themeMode: 'system',
  languageMode: 'system',
  uiDensity: 'default',
  newTabDashboardEnabled: true,
  newTabShowSearch: true,
  newTabSearchEngine: 'google',
  newTabCustomSearchUrl: 'https://www.google.com/search?q={query}',
}

export const DEFAULT_AI_GROUPING_SETTINGS: AiGroupingSettings = {
  enabled: false,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  apiKey: '',
  apiKeys: {},
  baseUrl: '',
  sendUrls: true,
  sendTitles: true,
  sendPageContext: true,
  includeGroupedTabs: false,
  scope: 'currentWindow',
  customPrompt: DEFAULT_AI_GROUPING_PROMPT,
}

export const GROUP_COLORS: ChromeGroupColor[] = [
  'blue',
  'purple',
  'cyan',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'grey',
]

export const COLOR_CLASS: Record<ChromeGroupColor, string> = {
  grey: 'bg-zinc-500',
  blue: 'bg-blue-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-400',
  green: 'bg-emerald-500',
  pink: 'bg-pink-500',
  purple: 'bg-violet-500',
  cyan: 'bg-cyan-400',
  orange: 'bg-orange-500',
}

const defaultTimestamp = 1_775_772_000_000

export const DEFAULT_RULES: AutoGroupRule[] = [
  {
    id: 'blank-pages-default',
    name: '空白页',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '^(chrome://newtab/?|about:blank)$',
    groupTitle: 'Blank',
    color: 'grey',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'chrome-management-default',
    name: 'Chrome 与扩展页面',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '^chrome-extension://|^chrome://(?!newtab/?$)',
    groupTitle: 'Chrome',
    color: 'blue',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'github-default',
    name: 'GitHub 工作流',
    enabled: true,
    target: 'url',
    mode: 'contains',
    pattern: 'github.com',
    groupTitle: 'Code',
    color: 'purple',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'docs-default',
    name: '文档与知识库',
    enabled: true,
    target: 'title',
    mode: 'regex',
    pattern: '(docs|documentation|文档|指南|guide|manual|reference)',
    groupTitle: 'Docs',
    color: 'cyan',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'ai-default',
    name: 'AI 助手',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '(chatgpt\\.com|claude\\.ai|gemini\\.google\\.com|perplexity\\.ai|poe\\.com|kimi\\.com|doubao\\.com)',
    groupTitle: 'AI',
    color: 'green',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'design-default',
    name: '设计工具',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '(figma\\.com|canva\\.com|dribbble\\.com|behance\\.net)',
    groupTitle: 'Design',
    color: 'pink',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'notes-default',
    name: '笔记与知识管理',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '(notion\\.so|notion\\.site|yuque\\.com|feishu\\.cn|larksuite\\.com)',
    groupTitle: 'Notes',
    color: 'yellow',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'mail-default',
    name: '邮箱与日程',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '(mail\\.google\\.com|outlook\\.live\\.com|outlook\\.office\\.com|calendar\\.google\\.com)',
    groupTitle: 'Mail',
    color: 'orange',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'video-default',
    name: '视频与流媒体',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '(youtube\\.com|youtu\\.be|netflix\\.com|vimeo\\.com|twitch\\.tv)\n(bilibili\\.com|douyin\\.com|kuaishou\\.com|iqiyi\\.com|youku\\.com)',
    conditions: [
      {
        id: 'video-global-condition',
        target: 'url',
        mode: 'regex',
        pattern: '(youtube\\.com|youtu\\.be|netflix\\.com|vimeo\\.com|twitch\\.tv)',
      },
      {
        id: 'video-cn-condition',
        target: 'url',
        mode: 'regex',
        pattern: '(bilibili\\.com|douyin\\.com|kuaishou\\.com|iqiyi\\.com|youku\\.com)',
      },
    ],
    groupTitle: 'Video',
    color: 'red',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'assets-default',
    name: '图片与静态资源',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '(/|[-_.])(icon|icons|img|image|images|upload|uploads|asset|assets)(/|[-_.])|\\.(svg|png|jpe?g|gif|webp|avif|ico)(\\?|#|$)',
    groupTitle: 'Assets',
    color: 'cyan',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
  {
    id: 'local-dev-default',
    name: '本地开发服务',
    enabled: true,
    target: 'url',
    mode: 'regex',
    pattern: '^https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])(:\\d+)?',
    groupTitle: 'Local Dev',
    color: 'grey',
    scope: 'currentWindow',
    createdAt: defaultTimestamp,
    updatedAt: defaultTimestamp,
  },
]

export const DEFAULT_RULE_IDS = new Set(DEFAULT_RULES.map((rule) => rule.id))
