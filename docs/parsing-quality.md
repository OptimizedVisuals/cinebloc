# Parsing quality gate (Phase 2)

## Why this gate exists

The entire product rests on the "70% skeleton" being usable. If a model returns
a 30%-error-rate list (wrong sizes, merged scenes, truncated action), users
spend longer fixing the skeleton than writing a shot list — and the product
collapses regardless of how good the canvas is.

**Entry rule:** nothing beyond Phase 1 core gets built until this gate passes.

## Threshold

- **≥ 70% of shots usable-as-is** across real screenplay samples
  (only trivial edits needed: a size swapped, a note added).
- Measured per shot, not per script: `usable shots / total shots`.

## How to run it

1. `npm run dev`, open Settings, add your own API key (BYOK).
2. Take **10–20 real, messy screenplays** — varied formats: proper Courier
   sluglines, prose-heavy amateur drafts, TV vs. feature, 2 pages to 30 pages.
3. Paste each, parse, and record for each script:
   - parse succeeded? (no ParseError / LLMError)
   - total shots vs. usable-as-is shots
   - recurring failure mode (see taxonomy below)
4. Update the results table below and iterate `features/parser/prompts.ts` or
   `repair.ts` — **not** the adapters — then re-run.

Automated proxy (runs in CI with `npm test`):
`src/features/parser/__tests__/quality.test.ts` feeds seven representative
messy model outputs (fences, trailing commas, envelopes, truncation mid-string,
camelCase drift, SCREAMING keys) through repair + normalize and requires 100%
of them to produce zod-valid shots.

## Results

| Date       | Sample                        | Scripts | Shots | Usable | Pass rate | Notes |
| ---------- | ----------------------------- | ------- | ----- | ------ | --------- | ----- |
| 2026-10-04 | synthetic fixture harness     | 7       | 7     | 7      | 100%      | automated proxy only — synthetic inputs |
| _pending_  | real scripts (needs API key)  | 10–20   |       |        |           | run procedure above |

> **Current status:** the automated proxy passes (7/7). The real-script
> measurement cannot be completed without a user-supplied API key; the
> procedure above is the handoff. Treat the Phase 2 gate as OPEN until the
> pending row is filled.

## Failure taxonomy (categorize every miss)

| Mode                    | Fix location                     |
| ----------------------- | -------------------------------- |
| Not valid JSON          | `features/parser/repair.ts`      |
| Valid JSON, bad keys    | `features/parser/normalize.ts` aliases |
| Wrong camera size/movement | `prompts.ts` vocabulary + examples |
| Merged/dropped scenes   | `prompts.ts` RULES section       |
| Truncated output        | `prompts.ts` shot-count guidance, `max_tokens` |
| Provider/format errors  | `adapters/llm/providers/*`       |
