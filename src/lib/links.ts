export const GITHUB_REPO_URL = 'https://github.com/zxpzdtom/tabweave'
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues/new`
export const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/detail/tabweave/pmfoefbiapldlpljfpjienjahdfmefej'

export function getExtensionVersion() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    return chrome.runtime.getManifest().version
  }
  return '0.1.0'
}

export async function openExternalUrl(url: string) {
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    await chrome.tabs.create({ url })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}
