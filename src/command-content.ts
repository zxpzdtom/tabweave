import type { CommandSearchItem } from './lib/command-search'

type SearchResponse = { ok?: boolean; items?: CommandSearchItem[]; error?: string }
type CommandCopy = {
  placeholder: string
  loading: string
  loadingDesc: string
  noResults: string
  noResultsDesc: string
  hint: string
  ready: string
  resultCount: string
  categoryAll: string
  helpOpen: string
  helpMove: string
  helpCategory: string
  helpClose: string
  typeCommand: string
  typeTab: string
  typeGroup: string
  typeHistory: string
  pinned: string
  recent: string
  today: string
  yesterday: string
  dateLocale: string
  themeMode?: 'dark' | 'light' | 'system'
}
type CopyResponse = { ok?: boolean; copy?: CommandCopy }
type CategoryId = 'all' | 'pinned' | CommandSearchItem['type']
type Category = { id: CategoryId; label: string }

const defaultCopy: CommandCopy = {
  placeholder: 'Search tabs, URLs, groups, history, and commands',
  loading: 'Searching...',
  loadingDesc: 'Reading tabs, groups, commands, and history.',
  noResults: 'No matches found',
  noResultsDesc: 'Try a tab title, URL, group name, or recent page.',
  hint: 'Enter to open · ↑↓ to move · Esc to close',
  ready: 'Ready',
  resultCount: '{count} results',
  categoryAll: 'All',
  helpOpen: 'Open',
  helpMove: 'Move',
  helpCategory: 'Category',
  helpClose: 'Close',
  typeCommand: 'Command',
  typeTab: 'Tab',
  typeGroup: 'Group',
  typeHistory: 'History',
  pinned: 'Pinned',
  recent: 'Recent',
  today: 'Today',
  yesterday: 'Yesterday',
  dateLocale: 'en-US',
  themeMode: 'light',
}

const HOST_ID = 'tabweave-command-search-host'
const SEARCH_DEBOUNCE_MS = 160
const JUMP_SCROLL_DURATION_MS = 140
const paletteState = {
  open: false,
  query: '',
  items: [] as CommandSearchItem[],
  activeCategory: 'all' as CategoryId,
  selectedIndex: 0,
  loading: false,
  searchTimer: 0,
  searchRequestId: 0,
  repeatDelayTimer: 0,
  repeatTimer: 0,
  repeatDirection: 0 as -1 | 0 | 1,
  jumpScrollAnimation: 0,
  copy: defaultCopy,
}

let renderedListKey = ''
let shadowRoot: ShadowRoot | null = null
let inputElement: HTMLInputElement | null = null
let listElement: HTMLDivElement | null = null
let statusElement: HTMLDivElement | null = null
let frameElement: HTMLDivElement | null = null
let categoriesElement: HTMLDivElement | null = null

function getOrCreateRoot() {
  const existingHost = document.getElementById(HOST_ID)
  if (existingHost?.shadowRoot) {
    shadowRoot = existingHost.shadowRoot
    return shadowRoot
  }

  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.all = 'initial'
  document.documentElement.append(host)
  shadowRoot = host.attachShadow({ mode: 'open' })
  shadowRoot.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light;
        --tw-panel: #ffffff;
        --tw-search: #ffffff;
        --tw-item-hover: rgba(24, 24, 27, .045);
        --tw-item-selected: rgba(139, 92, 246, .1);
        --tw-icon-bg: rgba(244, 244, 245, .96);
        --tw-tag-bg: rgba(244, 244, 245, .9);
        --tw-border: rgba(24, 24, 27, .1);
        --tw-shadow-lg: rgba(24, 24, 27, .22);
        --tw-shadow-md: rgba(24, 24, 27, .16);
        --tw-shadow-sm: rgba(24, 24, 27, .08);
        --tw-surface-highlight: rgba(255, 255, 255, .82);
        --tw-backdrop: rgba(0, 0, 0, .08);
        --tw-muted: #71717a;
        --tw-subtle: #a1a1aa;
        --tw-text: #18181b;
        --tw-violet: #8b5cf6;
        --tw-violet-soft: rgba(139, 92, 246, .14);
        --tw-violet-ring: rgba(124, 58, 237, .22);
        --tw-key-bg: rgba(255, 255, 255, .9);
        --tw-tag-command-bg: rgba(139, 92, 246, .1);
        --tw-tag-command-text: #7c3aed;
        --tw-tag-tab-bg: rgba(14, 165, 233, .1);
        --tw-tag-tab-text: #0284c7;
        --tw-tag-group-bg: rgba(16, 185, 129, .1);
        --tw-tag-group-text: #059669;
        --tw-tag-history-bg: rgba(245, 158, 11, .12);
        --tw-tag-history-text: #b45309;
        --tw-chip-bg: rgba(244, 244, 245, .72);
        --tw-chip-text: #a1a1aa;
        --tw-shortcut-bg: rgba(139, 92, 246, .08);
        --tw-shortcut-text: #d4d4d8;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 10px;
        line-height: 1.3;
        -webkit-font-smoothing: antialiased;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
        font-family: inherit;
      }

      :host([data-theme="dark"]) {
        color-scheme: dark;
        --tw-panel: #09090b;
        --tw-search: #09090b;
        --tw-item-hover: rgba(255, 255, 255, .04);
        --tw-item-selected: rgba(139, 92, 246, .16);
        --tw-icon-bg: rgba(24, 24, 27, .9);
        --tw-tag-bg: rgba(24, 24, 27, .78);
        --tw-border: rgba(255, 255, 255, .1);
        --tw-shadow-lg: rgba(0, 0, 0, .55);
        --tw-shadow-md: rgba(0, 0, 0, .38);
        --tw-shadow-sm: rgba(0, 0, 0, .22);
        --tw-surface-highlight: rgba(255, 255, 255, .08);
        --tw-backdrop: rgba(0, 0, 0, .14);
        --tw-muted: #71717a;
        --tw-subtle: #52525b;
        --tw-text: #f4f4f5;
        --tw-violet-soft: rgba(139, 92, 246, .16);
        --tw-violet-ring: rgba(196, 181, 253, .25);
        --tw-key-bg: rgba(255, 255, 255, .06);
        --tw-tag-command-bg: rgba(139, 92, 246, .16);
        --tw-tag-command-text: #c4b5fd;
        --tw-tag-tab-bg: rgba(14, 165, 233, .16);
        --tw-tag-tab-text: #7dd3fc;
        --tw-tag-group-bg: rgba(16, 185, 129, .16);
        --tw-tag-group-text: #6ee7b7;
        --tw-tag-history-bg: rgba(245, 158, 11, .16);
        --tw-tag-history-text: #fcd34d;
        --tw-chip-bg: rgba(255, 255, 255, .055);
        --tw-chip-text: #52525b;
        --tw-shortcut-bg: rgba(139, 92, 246, .14);
        --tw-shortcut-text: #3f3f46;
      }

      [hidden] { display: none !important; }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        align-items: start;
        justify-items: center;
        padding-top: max(80px, 12vh);
        background: var(--tw-backdrop);
      }

      .frame {
        display: flex;
        flex-direction: column;
        width: min(680px, calc(100vw - 32px));
        height: min(560px, calc(100vh - 80px));
        max-height: min(620px, calc(100vh - 80px));
        overflow: hidden;
        overflow-x: hidden;
        border-radius: 22px;
        background:
          var(--tw-panel);
        box-shadow:
          0 42px 120px -44px var(--tw-shadow-lg),
          0 24px 60px -28px var(--tw-shadow-md),
          0 8px 24px -12px var(--tw-shadow-sm),
          inset 0 1px 0 var(--tw-surface-highlight),
          0 0 0 1px var(--tw-border);
      }

      .search {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
        padding: 12px 14px;
        background: var(--tw-search);
        border-bottom: 1px solid var(--tw-border);
      }

      .categories {
        display: flex;
        gap: 8px;
        overflow: auto;
        overflow-x: hidden;
        flex: 0 0 auto;
        padding: 8px 10px;
        border-bottom: 1px solid var(--tw-border);
        scrollbar-width: none;
      }

      .categories::-webkit-scrollbar { display: none; }

      .category {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 7px;
        min-height: 28px;
        border: 1px solid var(--tw-border);
        border-radius: 10px;
        padding: 0 10px;
        background: transparent;
        color: var(--tw-muted);
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        cursor: pointer;
        transition: background-color .14s ease, border-color .14s ease, color .14s ease, box-shadow .14s ease;
      }

      .category:hover {
        background: var(--tw-item-hover);
        color: var(--tw-text);
      }

      .category[data-active="true"] {
        background: var(--tw-item-selected);
        border-color: var(--tw-violet-ring);
        color: var(--tw-text);
        box-shadow: none;
      }

      .category-count {
        display: inline-flex;
        min-width: 21px;
        height: 20px;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 0 6px;
        background: var(--tw-chip-bg);
        color: var(--tw-chip-text);
        font-variant-numeric: tabular-nums;
      }

      .category[data-active="true"] .category-count {
        background: var(--tw-shortcut-bg);
      }

      .mark {
        display: grid;
        width: 30px;
        height: 30px;
        place-items: center;
        color: var(--tw-muted);
        font-family: inherit;
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
      }

      .mark svg {
        width: 16px;
        height: 16px;
      }

      input {
        all: unset;
        flex: 1;
        min-width: 0;
        height: 34px;
        color: var(--tw-text);
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        line-height: 34px;
      }

      input::placeholder { color: var(--tw-muted); }

      .esc {
        border-radius: 9px;
        padding: 7px 10px;
        background: var(--tw-tag-bg);
        color: var(--tw-muted);
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        box-shadow: inset 0 0 0 1px var(--tw-border);
      }

      .list {
        position: relative;
        min-height: 0;
        flex: 1 1 auto;
        overflow: auto;
        padding: 8px 8px 12px;
        scrollbar-color: #3f3f46 transparent;
        scrollbar-width: thin;
        -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 12px, #000 calc(100% - 18px), transparent 100%);
        mask-image: linear-gradient(180deg, transparent 0, #000 12px, #000 calc(100% - 18px), transparent 100%);
      }

      .item {
        display: flex;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        align-items: center;
        gap: 8px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        padding: 7px 8px;
        color: inherit;
        text-align: left;
        font-family: inherit;
        font-size: 10px;
        font-weight: 400;
        line-height: 1.3;
        transition: background-color .14s ease, transform .14s ease, box-shadow .14s ease;
        cursor: pointer;
      }

      .item:hover,
      .item[data-selected="true"] {
        background: var(--tw-item-selected);
        box-shadow: inset 0 0 0 1px rgba(139, 92, 246, .18);
      }

      .item:hover { background: var(--tw-item-hover); }

      .item[data-selected="true"]:hover { background: var(--tw-item-selected); }

      .item:active { transform: scale(.96); }

      .icon {
        display: grid;
        width: 30px;
        height: 30px;
        place-items: center;
        flex: 0 0 auto;
        overflow: hidden;
        border-radius: 9px;
        background: var(--tw-icon-bg);
        color: var(--tw-violet);
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        box-shadow: inset 0 0 0 1px var(--tw-border);
      }

      .icon[data-type="command"] {
        font-size: 17px;
        font-weight: 700;
      }

      .icon img {
        width: 20px;
        height: 20px;
      }

      .icon svg {
        width: 18px;
        height: 18px;
      }

      .copy {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        padding-right: 56px;
      }

      .title {
        overflow: hidden;
        display: block;
        color: var(--tw-text);
        font-family: inherit;
        font-size: 15px;
        line-height: 1.18;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .subtitle {
        margin-top: 1px;
        overflow: hidden;
        display: block;
        color: var(--tw-subtle);
        font-family: inherit;
        font-size: 12.5px;
        line-height: 1.18;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .subtitle:empty { display: none; }

      .section-title {
        position: sticky;
        top: -8px;
        z-index: 1;
        margin: 0 -8px;
        padding: 18px 18px 6px;
        background: var(--tw-panel);
        color: var(--tw-muted);
        font-family: inherit;
        font-size: 10.5px;
        font-weight: 700;
        line-height: 1;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      .section-title:first-child {
        padding-top: 14px;
      }

      .meta {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin-left: 18px;
      }

      .chip {
        flex: 0 0 auto;
        max-width: 84px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-radius: 8px;
        padding: 4px 7px;
        font-family: inherit;
        font-size: 11px;
        line-height: 1;
        letter-spacing: 0;
        box-shadow: none;
      }

      .chip {
        background: var(--tw-chip-bg);
        color: var(--tw-chip-text);
      }

      .chip[data-kind="shortcut"] {
        background: transparent;
        color: var(--tw-shortcut-text);
        font-variant-numeric: tabular-nums;
      }

      .shortcut-mod {
        margin-right: 3px;
      }

      .chip[data-kind="pinned"] {
        color: var(--tw-tag-tab-text);
      }

      .subtitle-type {
        color: var(--tw-muted);
      }

      .empty {
        padding: 42px 24px;
        text-align: center;
      }

      .empty-title {
        color: var(--tw-text);
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        line-height: 1.4;
      }

      .empty-desc {
        margin-top: 6px;
        color: var(--tw-muted);
        font-family: inherit;
        font-size: 12px;
        line-height: 1.5;
      }

      .status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
        border-top: 1px solid var(--tw-border);
        flex: 0 0 auto;
        min-height: 38px;
        padding: 10px 16px;
        color: var(--tw-muted);
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.2;
      }

      .status span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .help {
        display: flex;
        min-width: 0;
        flex-wrap: wrap;
        align-items: center;
        column-gap: 12px;
        row-gap: 5px;
      }

      .help-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
      }

      .key {
        display: inline-grid;
        min-width: 21px;
        height: 19px;
        place-items: center;
        border-radius: 5px;
        padding: 0 5px;
        background: var(--tw-key-bg);
        color: var(--tw-text);
        font-family: inherit;
        font-size: 10.5px;
        font-weight: 700;
        line-height: 1;
        box-shadow: inset 0 0 0 1px var(--tw-border), 0 1px 1px rgba(0, 0, 0, .04);
      }

      .count {
        display: inline-flex;
        align-items: center;
        flex: 0 0 auto;
        color: var(--tw-subtle);
        font-variant-numeric: tabular-nums;
      }

      @media (max-width: 460px) {
        .backdrop { padding-top: 56px; }
        .frame { width: calc(100vw - 20px); }
        .meta { display: none; }
      }
    </style>
    <div class="backdrop" hidden>
      <div class="frame">
        <div class="search">
          <div class="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </div>
          <input autocomplete="off" spellcheck="false" />
          <div class="esc">Esc</div>
        </div>
        <div class="categories"></div>
        <div class="list"></div>
        <div class="status"></div>
      </div>
    </div>
  `

  inputElement = shadowRoot.querySelector('input')
  listElement = shadowRoot.querySelector('.list')
  statusElement = shadowRoot.querySelector('.status')
  frameElement = shadowRoot.querySelector('.frame')
  categoriesElement = shadowRoot.querySelector('.categories')
  shadowRoot.querySelector('.backdrop')?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.classList.contains('backdrop')) closePalette()
  })
  frameElement?.addEventListener('click', (event) => event.stopPropagation())
  inputElement?.addEventListener('input', () => {
    paletteState.query = inputElement?.value ?? ''
    scheduleSearch()
  })
  shadowRoot.addEventListener('keydown', handleRootKeyDown)
  shadowRoot.addEventListener('keyup', handleRootKeyUp)
  shadowRoot.addEventListener('focusout', clearSelectionRepeat)

  return shadowRoot
}

function getTypeLabel(item: CommandSearchItem) {
  if (item.type === 'command') return paletteState.copy.typeCommand
  if (item.type === 'group') return paletteState.copy.typeGroup
  if (item.type === 'history') return paletteState.copy.typeHistory
  return paletteState.copy.typeTab
}

function getCategories(): Category[] {
  const categories: Category[] = [
    { id: 'all', label: paletteState.copy.categoryAll },
  ]
  if (getCategoryCount('pinned') > 0 || paletteState.activeCategory === 'pinned') categories.push({ id: 'pinned', label: paletteState.copy.pinned })
  categories.push(
    { id: 'tab', label: paletteState.copy.typeTab },
    { id: 'group', label: paletteState.copy.typeGroup },
    { id: 'history', label: paletteState.copy.typeHistory },
    { id: 'command', label: paletteState.copy.typeCommand },
  )
  return categories
}

function hasSearchQuery() {
  return paletteState.query.trim().length > 0
}

function getVisibleItems() {
  if (paletteState.activeCategory === 'all') {
    return hasSearchQuery() ? paletteState.items : paletteState.items.filter((item) => item.type !== 'command')
  }
  if (paletteState.activeCategory === 'pinned') return paletteState.items.filter((item) => item.pinned)
  return paletteState.items.filter((item) => item.type === paletteState.activeCategory)
}

function getCategoryCount(category: CategoryId) {
  if (category === 'all') {
    return hasSearchQuery() ? paletteState.items.length : paletteState.items.filter((item) => item.type !== 'command').length
  }
  if (category === 'pinned') return paletteState.items.filter((item) => item.pinned).length
  return paletteState.items.filter((item) => item.type === category).length
}

function setCategory(category: CategoryId) {
  paletteState.activeCategory = category
  paletteState.selectedIndex = 0
  renderCategories()
  renderList()
  renderStatus()
}

function moveCategory(direction: 1 | -1) {
  const categories = getCategories()
  const currentIndex = Math.max(0, categories.findIndex((category) => category.id === paletteState.activeCategory))
  const nextIndex = (currentIndex + direction + categories.length) % categories.length
  setCategory(categories[nextIndex].id)
}

function getIconLabel(item: CommandSearchItem) {
  if (item.type === 'command') return '⌘'
  if (item.type === 'group') return 'G'
  if (item.type === 'history') return 'H'
  return 'T'
}

function isMacPlatform() {
  return /mac|iphone|ipad|ipod/i.test(navigator.platform)
}

function getShortcutLabel(index: number) {
  if (index < 0 || index > 8) return ''
  return `${isMacPlatform() ? '⌘' : 'Ctrl'} ${index + 1}`
}

function isSameDate(timestamp: number, offsetDays = 0) {
  const date = new Date(timestamp)
  const reference = new Date()
  reference.setDate(reference.getDate() + offsetDays)
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate()
}

function getSectionTitle(item: CommandSearchItem) {
  if (!item.lastVisitTime || item.type === 'command') return ''
  const ageMs = Date.now() - item.lastVisitTime
  if (ageMs >= 0 && ageMs < 10 * 60 * 1000) return paletteState.copy.recent
  if (isSameDate(item.lastVisitTime)) return paletteState.copy.today
  if (isSameDate(item.lastVisitTime, -1)) return paletteState.copy.yesterday
  return new Intl.DateTimeFormat(paletteState.copy.dateLocale, { month: 'short', day: 'numeric' }).format(new Date(item.lastVisitTime))
}

function createChip(label: string, kind: string) {
  const chip = document.createElement('span')
  chip.className = 'chip'
  chip.dataset.kind = kind
  chip.textContent = label
  return chip
}

function createShortcutChip(label: string) {
  const chip = createChip('', 'shortcut')
  const [modifier, number] = label.split(' ')
  const modifierElement = document.createElement('span')
  modifierElement.className = 'shortcut-mod'
  modifierElement.textContent = modifier
  const numberElement = document.createElement('span')
  numberElement.textContent = number
  chip.append(modifierElement, numberElement)
  return chip
}

function createSubtitle(item: CommandSearchItem) {
  const subtitle = document.createElement('span')
  subtitle.className = 'subtitle'

  const type = document.createElement('span')
  type.className = 'subtitle-type'
  type.textContent = getTypeLabel(item)
  subtitle.append(type)

  if (item.subtitle) {
    subtitle.append(document.createTextNode(` · ${item.subtitle}`))
  }

  return subtitle
}

function setTabFallbackIcon(icon: HTMLElement) {
  icon.replaceChildren()
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', '4')
  rect.setAttribute('y', '5')
  rect.setAttribute('width', '16')
  rect.setAttribute('height', '14')
  rect.setAttribute('rx', '3')
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  line.setAttribute('d', 'M4 9h16')
  svg.append(rect, line)
  icon.append(svg)
}

function getResolvedTheme() {
  if (paletteState.copy.themeMode === 'dark') return 'dark'
  if (paletteState.copy.themeMode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function applyTheme() {
  const host = shadowRoot?.host
  if (host instanceof HTMLElement) host.dataset.theme = getResolvedTheme()
}

function renderCategories() {
  if (!categoriesElement) return
  categoriesElement.replaceChildren(...getCategories().map((category) => {
    const button = document.createElement('div')
    button.role = 'button'
    button.tabIndex = -1
    button.className = 'category'
    button.dataset.active = String(category.id === paletteState.activeCategory)
    const label = document.createElement('span')
    label.textContent = category.label
    const count = document.createElement('span')
    count.className = 'category-count'
    count.textContent = String(getCategoryCount(category.id))
    button.append(label, count)
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      setCategory(category.id)
      inputElement?.focus()
    })
    return button
  }))
}

function getListKey() {
  const visibleItems = getVisibleItems()
  if (paletteState.loading) return `loading:${paletteState.copy.loading}:${paletteState.copy.loadingDesc}`
  if (visibleItems.length === 0) return `empty:${paletteState.activeCategory}:${paletteState.copy.noResults}:${paletteState.copy.noResultsDesc}`
  return `${paletteState.activeCategory}:${visibleItems.map((item) => item.id).join('|')}`
}

function updateSelectedItem() {
  listElement?.querySelectorAll<HTMLElement>('.item').forEach((element, index) => {
    element.dataset.selected = String(index === paletteState.selectedIndex)
  })
}

function renderList() {
  if (!listElement) return
  const nextKey = getListKey()
  if (nextKey === renderedListKey) {
    updateSelectedItem()
    return
  }
  renderedListKey = nextKey
  if (paletteState.loading) {
    listElement.innerHTML = `<div class="empty"><div class="empty-title">${paletteState.copy.loading}</div><div class="empty-desc">${paletteState.copy.loadingDesc}</div></div>`
    return
  }

  const visibleItems = getVisibleItems()
  if (visibleItems.length === 0) {
    listElement.innerHTML = `<div class="empty"><div class="empty-title">${paletteState.copy.noResults}</div><div class="empty-desc">${paletteState.copy.noResultsDesc}</div></div>`
    return
  }

  let previousSectionTitle = ''
  const children = visibleItems.flatMap((item, index) => {
    const itemElements: HTMLElement[] = []
    const sectionTitle = getSectionTitle(item)
    if (sectionTitle && sectionTitle !== previousSectionTitle) {
      const heading = document.createElement('div')
      heading.className = 'section-title'
      heading.textContent = sectionTitle
      itemElements.push(heading)
    }
    previousSectionTitle = sectionTitle

    const button = document.createElement('div')
    button.role = 'button'
    button.tabIndex = -1
    button.className = 'item'
    button.dataset.selected = String(index === paletteState.selectedIndex)
    button.addEventListener('mouseenter', () => {
      paletteState.selectedIndex = index
      updateSelectedItem()
      renderStatus()
      inputElement?.focus()
    })
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      void activateItem(item)
    })

    const icon = document.createElement('span')
    icon.className = 'icon'
    icon.dataset.type = item.type
    if ((item.type === 'tab' || item.type === 'history') && item.favIconUrl) {
      const image = document.createElement('img')
      image.src = item.favIconUrl
      image.alt = ''
      image.addEventListener('error', () => {
        setTabFallbackIcon(icon)
      })
      icon.append(image)
    } else if (item.type === 'tab' || item.type === 'history') {
      setTabFallbackIcon(icon)
    } else {
      icon.textContent = getIconLabel(item)
    }

    const copy = document.createElement('span')
    copy.className = 'copy'
    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = item.title
    copy.append(title, createSubtitle(item))

    const meta = document.createElement('span')
    meta.className = 'meta'
    const shortcutLabel = getShortcutLabel(index)
    if (shortcutLabel) meta.append(createShortcutChip(shortcutLabel))
    if (item.pinned) meta.append(createChip(paletteState.copy.pinned, 'pinned'))

    button.append(icon, copy, meta)
    itemElements.push(button)
    return itemElements
  })
  listElement.replaceChildren(...children)
}

function renderStatus() {
  if (!statusElement) return
  statusElement.innerHTML = `
    <span class="help">
      <span class="help-item"><kbd class="key">↵</kbd> ${paletteState.copy.helpOpen}</span>
      <span class="help-item"><kbd class="key">↑</kbd><kbd class="key">↓</kbd> ${paletteState.copy.helpMove}</span>
      <span class="help-item"><kbd class="key">Tab</kbd> ${paletteState.copy.helpCategory}</span>
      <span class="help-item"><kbd class="key">Esc</kbd> ${paletteState.copy.helpClose}</span>
    </span>
    <span class="count">${getVisibleItems().length > 0 ? paletteState.copy.resultCount.replace('{count}', String(getVisibleItems().length)) : paletteState.copy.ready}</span>
  `
}

function render() {
  getOrCreateRoot()
  const backdrop = shadowRoot?.querySelector<HTMLElement>('.backdrop')
  if (!backdrop || !listElement || !statusElement || !categoriesElement) return
  applyTheme()
  if (inputElement) inputElement.placeholder = paletteState.copy.placeholder

  backdrop.hidden = !paletteState.open
  if (!paletteState.open) return

  renderCategories()
  renderList()
  renderStatus()
}

function scheduleSearch() {
  window.clearTimeout(paletteState.searchTimer)
  paletteState.searchTimer = window.setTimeout(() => {
    void search(paletteState.query)
  }, SEARCH_DEBOUNCE_MS)
}

async function search(query: string) {
  const requestId = ++paletteState.searchRequestId
  paletteState.loading = true
  render()
  const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_SEARCH_COMMANDS', query }) as SearchResponse
  if (requestId !== paletteState.searchRequestId || query !== paletteState.query) return
  paletteState.items = response?.ok ? response.items ?? [] : []
  paletteState.selectedIndex = 0
  paletteState.loading = false
  render()
}

async function loadCopy() {
  const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_GET_COMMAND_SEARCH_COPY' }) as CopyResponse
  paletteState.copy = response?.ok && response.copy ? response.copy : defaultCopy
}

async function activateItem(item: CommandSearchItem) {
  const response = await chrome.runtime.sendMessage({ type: 'TABWEAVE_ACTIVATE_COMMAND_ITEM', item }) as { ok?: boolean }
  if (response?.ok) closePalette()
}

function activateVisibleItem(index: number) {
  const item = getVisibleItems()[index]
  if (item) void activateItem(item)
}

async function openPalette() {
  paletteState.open = true
  paletteState.selectedIndex = 0
  paletteState.activeCategory = 'all'
  getOrCreateRoot()
  await loadCopy()
  render()
  inputElement?.focus()
  scheduleSearch()
}

function closePalette() {
  paletteState.open = false
  window.clearTimeout(paletteState.searchTimer)
  paletteState.searchRequestId += 1
  paletteState.loading = false
  window.cancelAnimationFrame(paletteState.jumpScrollAnimation)
  paletteState.jumpScrollAnimation = 0
  clearSelectionRepeat()
  render()
}

function moveSelection(direction: 1 | -1) {
  const visibleItems = getVisibleItems()
  if (visibleItems.length === 0) return
  const nextIndex = paletteState.selectedIndex + direction
  paletteState.selectedIndex = Math.max(0, Math.min(visibleItems.length - 1, nextIndex))
  updateSelectedItem()
  renderStatus()
  scrollSelectedItemIntoView()
}

function jumpSelection(index: number) {
  const visibleItems = getVisibleItems()
  if (visibleItems.length === 0) return
  paletteState.selectedIndex = Math.max(0, Math.min(visibleItems.length - 1, index))
  updateSelectedItem()
  renderStatus()
  if (listElement && paletteState.selectedIndex === 0) {
    animateListScrollTo(0)
    return
  }
  if (listElement && paletteState.selectedIndex === visibleItems.length - 1) {
    animateListScrollTo(listElement.scrollHeight - listElement.clientHeight)
    return
  }
  scrollSelectedItemIntoView()
}

function animateListScrollTo(targetTop: number) {
  if (!listElement) return
  window.cancelAnimationFrame(paletteState.jumpScrollAnimation)
  const startTop = listElement.scrollTop
  const maxTop = Math.max(0, listElement.scrollHeight - listElement.clientHeight)
  const endTop = Math.max(0, Math.min(maxTop, targetTop))
  const distance = endTop - startTop
  if (Math.abs(distance) < 1) {
    listElement.scrollTop = endTop
    return
  }

  const startedAt = performance.now()
  const tick = (now: number) => {
    if (!listElement) return
    const progress = Math.min(1, (now - startedAt) / JUMP_SCROLL_DURATION_MS)
    const eased = 1 - Math.pow(1 - progress, 3)
    listElement.scrollTop = startTop + distance * eased
    if (progress < 1) {
      paletteState.jumpScrollAnimation = window.requestAnimationFrame(tick)
    } else {
      paletteState.jumpScrollAnimation = 0
    }
  }
  paletteState.jumpScrollAnimation = window.requestAnimationFrame(tick)
}

function getStickyHeaderHeight(listRect: DOMRect) {
  if (!listElement) return 0
  for (const heading of listElement.querySelectorAll<HTMLElement>('.section-title')) {
    const headingRect = heading.getBoundingClientRect()
    if (headingRect.top <= listRect.top + 1 && headingRect.bottom > listRect.top) return headingRect.height
  }
  return 0
}

function scrollSelectedItemIntoView() {
  if (!listElement) return
  const item = listElement.querySelector<HTMLElement>('[data-selected="true"]')
  if (!item) return
  const listRect = listElement.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const style = window.getComputedStyle(listElement)
  const paddingTop = Number.parseFloat(style.paddingTop) || 0
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
  const visibleTop = listRect.top + paddingTop + getStickyHeaderHeight(listRect)
  const visibleBottom = listRect.bottom - paddingBottom

  if (itemRect.top < visibleTop) {
    listElement.scrollTop -= visibleTop - itemRect.top
  } else if (itemRect.bottom > visibleBottom) {
    listElement.scrollTop += itemRect.bottom - visibleBottom
  }
}

function clearSelectionRepeat() {
  window.clearTimeout(paletteState.repeatDelayTimer)
  window.clearInterval(paletteState.repeatTimer)
  paletteState.repeatDelayTimer = 0
  paletteState.repeatTimer = 0
  paletteState.repeatDirection = 0
}

function startSelectionRepeat(direction: 1 | -1) {
  if (paletteState.repeatDirection === direction) return
  clearSelectionRepeat()
  paletteState.repeatDirection = direction
  paletteState.repeatDelayTimer = window.setTimeout(() => {
    paletteState.repeatTimer = window.setInterval(() => {
      moveSelection(direction)
    }, 54)
  }, 220)
}

function handleInputKeyDown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
    const digit = event.code.startsWith('Digit') ? Number(event.code.slice(5)) : Number(event.key)
    if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
      event.preventDefault()
      activateVisibleItem(digit - 1)
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'Home') {
      event.preventDefault()
      clearSelectionRepeat()
      jumpSelection(0)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'End') {
      event.preventDefault()
      clearSelectionRepeat()
      jumpSelection(getVisibleItems().length - 1)
      return
    }
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closePalette()
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (!event.repeat) moveSelection(1)
    startSelectionRepeat(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!event.repeat) moveSelection(-1)
    startSelectionRepeat(-1)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    activateVisibleItem(paletteState.selectedIndex)
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    moveCategory(event.shiftKey ? -1 : 1)
  }
}

function handleInputKeyUp(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') clearSelectionRepeat()
}

function handleRootKeyDown(event: Event) {
  if (event instanceof KeyboardEvent) handleInputKeyDown(event)
}

function handleRootKeyUp(event: Event) {
  if (event instanceof KeyboardEvent) handleInputKeyUp(event)
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'TABWEAVE_TOGGLE_COMMAND_SEARCH') return false
  if (paletteState.open) closePalette()
  else void openPalette()
  return false
})
