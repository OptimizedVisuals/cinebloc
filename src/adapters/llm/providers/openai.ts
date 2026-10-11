import type { LLMRequest, ProviderConfig } from '@/kernel'
import { LLMError } from '@/kernel'
import { asArray, asRecord, pickText, postJson } from '../base'

/** OpenAI chat-completions format — also works for OpenRouter/Ollama/etc. via base_url. */
export async function openaiChat(
  config: ProviderConfig,
  request: LLMRequest,
): Promise<string> {
  const base = (config.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const json = await postJson({
    url: `${base}/chat/completions`,
    headers: { authorization: `Bearer ${config.api_key}` },
    body: {
      model: config.model,
      temperature: 0.2,
      ...(request.max_tokens ? { max_tokens: request.max_tokens } : {}),
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
    },
    signal: request.signal,
  })

  const root = asRecord(json)
  const choices = root ? asArray(root['choices']) : null
  const first = choices && choices.length > 0 ? asRecord(choices[0]) : null
  const message = first ? asRecord(first['message']) : null
  const text = message ? pickText(message['content']) : null
  if (!text) throw new LLMError('OpenAI returned no message content.')
  return text
}
