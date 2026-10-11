import type { LLMRequest, ProviderConfig } from '@/kernel'
import { LLMError } from '@/kernel'
import { asArray, asRecord, pickText, postJson } from '../base'

/** Google Gemini generateContent format. */
export async function geminiChat(config: ProviderConfig, request: LLMRequest): Promise<string> {
  const base = (config.base_url || 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/+$/,
    '',
  )
  const model = encodeURIComponent(config.model)
  const json = await postJson({
    url: `${base}/models/${model}:generateContent?key=${encodeURIComponent(config.api_key)}`,
    headers: {},
    body: {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.user }] }],
      generationConfig: {
        temperature: 0.2,
        ...(request.max_tokens ? { maxOutputTokens: request.max_tokens } : {}),
      },
    },
    signal: request.signal,
  })

  const root = asRecord(json)
  const candidates = root ? asArray(root['candidates']) : null
  const first = candidates && candidates.length > 0 ? asRecord(candidates[0]) : null
  const content = first ? asRecord(first['content']) : null
  const parts = content ? asArray(content['parts']) : null
  const text = parts ? pickText(parts) : null
  if (!text) {
    const blockReason = root
      ? asRecord(asRecord(root['promptFeedback'])?.['safetyRatings'])
      : null
    throw new LLMError(
      blockReason ? `Gemini returned no content: ${JSON.stringify(blockReason)}` : 'Gemini returned no content.',
    )
  }
  return text
}
