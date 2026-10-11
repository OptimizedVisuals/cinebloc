# ADR 0002: Completion sorts are derived, never stored

**Status:** accepted · 2026-10-04

## Context

The mobile checklist must sink completed shots to the bottom while the desktop
canvas keeps free spatial positioning. Both must reflect each other instantly.

## Decision

`is_completed` is data; "completed rows sink" is a *view* produced by the
`sortedShots` selector. Stored `order` (canonical sequence) and
`position_on_board` (spatial coordinates) are never modified by ticking a box.

## Why

If ticking mutated the stored array order, then: canvas drag order and
completion order would fight over the same field; undoing a tick would not
restore position; and the two layouts would need conflict resolution — the
classic bug this architecture exists to avoid. Derived views are pure,
testable (`src/kernel/__tests__/selectors.test.ts` asserts the source array is
untouched), and cheap for production-scale shot lists (< 1,000 rows).

## Alternatives rejected

- **Mutating `order` on completion:** creates read-modify-write conflicts
  between layouts.
- **Separate `completed_at` ordering field:** more state to keep consistent
  for identical user-visible behavior.
