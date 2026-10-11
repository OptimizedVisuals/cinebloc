import type { LLMRequest, ProviderConfig } from '@/kernel'
import { LLMError } from '@/kernel'
import { asArray, asRecord, pickText, postJson } from '../base'

/** Anthropic messages format (direct browser access requires the opt-in header). */
export async function anthropicChat(
  config: ProviderConfig,
  request: LLMRequest,
): Promise<string> {
  const base = (config.base_url || 'https://api.anthropic.com').replace(/\/+$/, '')
  const json = await postJson({
    url: `${base}/v1/messages`,
    headers: {
      'x-api-key': config.api_key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: {
      model: config.model,
      max_tokens: request.max_tokens ?? 8192,
      temperature: 0.2,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    },
    signal: request.signal,
  })

  const root = asRecord(json)
  const content = root ? asArray(root['content']) : null
  const text = content
    ? pickText(
        content.filter((block) => {
          const rec = asRecord(block)
          return rec?.['type'] === 'text'
        }),
      )
    : null
  if (!text) throw new LLMError('Anthropic returned no text content.')
  return text
}
