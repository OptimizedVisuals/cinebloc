import { LLMError, type LLMPort, type LLMRequest, type ProviderConfig } from '@/kernel'
import { anthropicChat } from './providers/anthropic'
import { geminiChat } from './providers/gemini'
import { openaiChat } from './providers/openai'

/**
 * BYOK gateway (claim 1): the user's token is sent straight from this
 * browser process to the chosen provider — no intermediate server.
 * Adding a provider = one file in providers/ + one case here.
 */
export const llmGateway: LLMPort = {
  async chat(config: ProviderConfig, request: LLMRequest): Promise<string> {
    if (!config.api_key.trim()) {
      throw new LLMError('No API key configured — add one in Settings (BYOK).', 401)
    }
    if (!config.model.trim()) {
      throw new LLMError('No model configured — set one in Settings.')
    }
    switch (config.provider) {
      case 'openai':
        return openaiChat(config, request)
      case 'anthropic':
        return anthropicChat(config, request)
      case 'gemini':
        return geminiChat(config, request)
      default: {
        const exhaustive: never = config.provider
        throw new LLMError(`Unknown provider: ${String(exhaustive)}`)
      }
    }
  },
}
