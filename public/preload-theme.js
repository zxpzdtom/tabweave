(() => {
  const preferencesKey = 'tabweave.preferences'
  const root = document.documentElement
  const originalVisibility = root.style.visibility
  root.style.visibility = 'hidden'

  const resolveTheme = (themeMode) => {
    if (themeMode === 'light' || themeMode === 'dark') return themeMode
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }

  const applyTheme = (themeMode) => {
    const resolved = resolveTheme(themeMode)
    root.dataset.theme = resolved
    root.style.colorScheme = resolved
    root.style.background = resolved === 'light' ? '#f8fafc' : '#09090b'
    root.style.visibility = originalVisibility
  }

  const fallback = window.setTimeout(() => applyTheme('system'), 180)

  try {
    chrome.storage.sync.get(preferencesKey, (result) => {
      window.clearTimeout(fallback)
      applyTheme(result?.[preferencesKey]?.themeMode ?? 'system')
    })
  } catch {
    window.clearTimeout(fallback)
    applyTheme('system')
  }
})()
