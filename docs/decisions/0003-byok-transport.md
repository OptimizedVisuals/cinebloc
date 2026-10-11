# ADR 0003: BYOK gateway behind provider adapters

**Status:** accepted · 2026-10-04

## Context

The parser needs generative-model access without a backend (zero server cost,
no accounts, claim 1). Users bring their own key for OpenAI, Anthropic, or
Google Gemini — or any OpenAI-compatible gateway (OpenRouter, Ollama, …).

## Decision

- `kernel/ports/llm.ts` defines `LLMPort.chat(config, request)`.
- `adapters/llm/` implements it: a shared `base.ts` transport (JSON POST,
  retry/backoff on 429/5xx, provider error extraction) plus one file per
  provider (`openai`, `anthropic`, `gemini`) selected by a registry.
- The key lives in local settings (IndexedDB meta), travels only to the
  chosen provider, and is excluded from nothing because it never leaves the
  device otherwise. Anthropic calls opt into direct browser access via
  `anthropic-dangerous-direct-browser-access`.
- Prompts are NOT here — they live in `features/parser/prompts.ts` so feature
  behavior and transport can evolve independently.

## Why

Adding a provider = one file + one registry case. Swapping the transport
(retries, streaming later) touches every provider once. The rest of the app —
parser, store, layouts — is provably provider-agnostic: it only ever sees
`LLMPort`.

## Alternatives rejected

- **Server-side key custody:** reintroduces accounts, cost, and the exact
  cloud dependency the product position rejects.
- **One adapter with per-provider branches:** mixes wire formats in one file;
  merge conflicts every time a vendor changes a field.
