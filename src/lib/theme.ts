import type { ThemeMode } from './types'

export function resolveTheme(themeMode: ThemeMode) {
  if (themeMode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return themeMode
}

export function applyTheme(themeMode: ThemeMode) {
  const resolved = resolveTheme(themeMode)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
  document.documentElement.style.background = resolved === 'light' ? '#f8fafc' : '#09090b'
}
