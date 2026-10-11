import { LLMError } from '@/kernel'

/**
 * Shared HTTP transport for all provider adapters: JSON POST, bounded
 * retry with backoff on 429/5xx and network failures, and extraction of
 * the provider's human-readable error message.
 */

export interface PostJsonOptions {
  url: string
  headers: Record<string, string>
  body: unknown
  signal?: AbortSignal
  retries?: number
}

function clip(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function providerErrorMessage(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const err = parsed['error']
    if (err && typeof err === 'object') {
      const message = (err as Record<string, unknown>)['message']
      if (typeof message === 'string' && message) return `HTTP ${status}: ${message}`
    }
  } catch {
    // not JSON — fall through
  }
  return `HTTP ${status}: ${clip(text)}`
}

export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const { url, headers, body, signal } = options
  const retries = options.retries ?? 2
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await delay(500 * 2 ** attempt + Math.random() * 250)
    }
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal,
      })
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      lastError = new LLMError(
        'Network error — could not reach the model provider. Check your connection and base URL.',
      )
      continue
    }

    if (response.ok) {
      return (await response.json()) as unknown
    }

    const text = await response.text().catch(() => '')
    const error = new LLMError(providerErrorMessage(response.status, text), response.status)
    if (isRetryable(response.status) && attempt < retries) {
      lastError = error
      continue
    }
    throw error
  }

  throw lastError ?? new LLMError('Model request failed after retries.')
}

/** Unknown-safe traversal helpers for provider response shapes. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

export function pickText(value: unknown): string | null {
  if (typeof value === 'string') return value
  const parts = asArray(value)
  if (parts) {
    const texts = parts
      .map((p) => {
        const rec = asRecord(p)
        return rec && typeof rec['text'] === 'string' ? (rec['text'] as string) : null
      })
      .filter((t): t is string => t !== null)
    if (texts.length > 0) return texts.join('')
  }
  return null
}
