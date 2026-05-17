import type { SearchEngineId } from './types'

export type SearchEngine = {
  id: SearchEngineId
  label: string
  url: string
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: 'google', label: 'Google', url: 'https://www.google.com/search?q={query}' },
  { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  { id: 'baidu', label: '百度', url: 'https://www.baidu.com/s?wd={query}' },
  { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' },
  { id: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai/search/new?q={query}' },
]

export function getSearchEngine(id: SearchEngineId) {
  return SEARCH_ENGINES.find((engine) => engine.id === id) ?? SEARCH_ENGINES[0]
}

export function buildSearchUrl(query: string, engineId: SearchEngineId, customSearchUrl: string) {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return ''
  if (/^(https?:\/\/|chrome:\/\/|edge:\/\/|about:)/i.test(trimmedQuery)) return trimmedQuery
  if (/^(localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(trimmedQuery)) return `http://${trimmedQuery}`
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(trimmedQuery)) return `https://${trimmedQuery}`

  const template = getSearchEngine(engineId).url || customSearchUrl.trim() || SEARCH_ENGINES[0].url
  const encodedQuery = encodeURIComponent(trimmedQuery)
  return template.includes('{query}')
    ? template.replaceAll('{query}', encodedQuery)
    : `${template}${template.includes('?') ? '&' : '?'}q=${encodedQuery}`
}
