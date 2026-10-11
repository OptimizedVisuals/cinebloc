/** BYOK gateway port — user-supplied tokens for third-party generative LLMs. */
export type ProviderId = 'openai' | 'anthropic' | 'gemini'

export interface ProviderConfig {
  provider: ProviderId
  /** User-supplied access token; never leaves the device except to the provider. */
  api_key: string
  model: string
  /** Optional override for OpenAI-compatible gateways (OpenRouter, Ollama, …). */
  base_url: string | null
}

export interface LLMRequest {
  system: string
  user: string
  max_tokens?: number
  signal?: AbortSignal
}

/**
 * Implemented by adapters/llm (registry over openai/anthropic/gemini).
 * Injected into state/services by the app composition root.
 */
export interface LLMPort {
  chat(config: ProviderConfig, request: LLMRequest): Promise<string>
}

export class LLMError extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'LLMError'
    this.status = status
  }
}
