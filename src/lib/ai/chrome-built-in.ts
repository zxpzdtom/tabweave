export const CHROME_BUILT_IN_AI_PREPARE_TIMEOUT_MS = 10 * 60_000

export interface ChromeBuiltInAiProgress {
  availability: ChromeAiAvailability
  percent?: number
}

export function isChromeBuiltInAiProvider(provider: string | undefined) {
  return provider === 'chromeBuiltIn'
}

export async function prepareChromeBuiltInAi(onProgress?: (progress: ChromeBuiltInAiProgress) => void): Promise<void> {
  if (typeof LanguageModel === 'undefined') {
    throw new Error('Chrome built-in AI is not available in this browser.')
  }

  const availability = await LanguageModel.availability()
  onProgress?.({ availability })
  if (availability === 'unavailable') {
    throw new Error('Chrome built-in AI is not available on this device.')
  }
  if (availability === 'available') return

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), CHROME_BUILT_IN_AI_PREPARE_TIMEOUT_MS)
  let session: ChromeAiLanguageModelSession | undefined

  try {
    session = await LanguageModel.create({
      signal: controller.signal,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const loaded = typeof (event as ProgressEvent).loaded === 'number' ? (event as ProgressEvent).loaded : undefined
          const percent = loaded === undefined ? undefined : Math.max(0, Math.min(100, Math.round(loaded * 100)))
          onProgress?.({ availability: 'downloading', percent })
        })
      },
    })
    onProgress?.({ availability: 'available', percent: 100 })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Chrome built-in AI model download did not finish in time.', { cause: error })
    }
    throw error
  } finally {
    session?.destroy()
    globalThis.clearTimeout(timeout)
  }
}
