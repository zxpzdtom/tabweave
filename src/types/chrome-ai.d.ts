declare global {
  type ChromeAiAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

  interface ChromeAiPromptMessage {
    role: 'system' | 'user' | 'assistant'
    content: string
    prefix?: boolean
  }

  interface ChromeAiTextModality {
    type: 'text'
    languages?: string[]
  }

  interface ChromeAiSessionOptions {
    initialPrompts?: ChromeAiPromptMessage[]
    expectedInputs?: ChromeAiTextModality[]
    expectedOutputs?: ChromeAiTextModality[]
    temperature?: number
    topK?: number
    signal?: AbortSignal
    monitor?: (monitor: EventTarget) => void
  }

  interface ChromeAiPromptOptions {
    responseConstraint?: unknown
    omitResponseConstraintInput?: boolean
    signal?: AbortSignal
  }

  interface ChromeAiLanguageModelSession {
    prompt(input: string | ChromeAiPromptMessage[], options?: ChromeAiPromptOptions): Promise<string>
    destroy(): void
  }

  interface ChromeAiLanguageModel {
    availability(options?: ChromeAiSessionOptions): Promise<ChromeAiAvailability>
    create(options?: ChromeAiSessionOptions): Promise<ChromeAiLanguageModelSession>
    params?(): Promise<{
      defaultTopK: number
      maxTopK: number
      defaultTemperature: number
      maxTemperature: number
    }>
  }

  var LanguageModel: ChromeAiLanguageModel | undefined
}

export {}
