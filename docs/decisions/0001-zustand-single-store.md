# ADR 0001: One Zustand store as the only data model

**Status:** accepted · 2026-10-04

## Context

The system must project the same data into two mutually exclusive layouts
(desktop spatial canvas, mobile checklist) and reflect edits from either side
immediately (claim 5), entirely client-side.

## Decision

One Zustand store (`src/state/store.ts`) composed of typed slices is the sole
data model. The canvas reads `state.shots` (positions, records); the checklist
reads the derived `sortedShots` selector. Both dispatch the same kernel
commands. IndexedDB is a mirror written by a single debounced subscriber, never
a second source of truth.

## Why

- Bidirectional sync becomes *structural*: two views of one state cannot
  disagree. No event bus, no reconciliation, no server.
- Zustand is ~1 kB, has no provider boilerplate, exposes vanilla
  `getState/subscribe` for persistence and tests (`createTestStore()`).
- Slices keep feature-sized mental chunks without feature-sized coupling.

## Alternatives rejected

- **React Context:** re-renders everything on any change; no subscription API
  for the persistence layer.
- **Two stores (one per layout):** reintroduces the sync problem this patent
  claim exists to solve.
- **IndexedDB as live state (reactivity over IDB):** complexity of a second
  async read model for no benefit — writes are debounced and fast.
