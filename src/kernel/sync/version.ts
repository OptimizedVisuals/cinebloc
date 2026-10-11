import type { Version } from './types'

/**
 * Logical clock + deterministic version ordering (ADR 0005).
 *
 * CONFLICT RULE — last-writer-wins over logical versions:
 *
 *   1. Every local mutation calls `advance()` and stamps the new record with
 *      `{ counter: clock, deviceId }`.
 *   2. A device that *receives* an op folds the op's counter into its own
 *      clock (`mergeClock`), so later local edits always outrank what it has
 *      already seen — this is what makes the order causal rather than random.
 *   3. Two conflicting versions compare by `counter` first, then by
 *      `deviceId` as a lexicographic tie-break. That is a *total* order, so
 *      every device independently reaches the same winner regardless of the
 *      order messages arrived in. No wall-clock comparison is ever used.
 */

export function compareVersions(a: Version, b: Version): number {
  if (a.counter !== b.counter) return a.counter - b.counter
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0
}

export function isNewerThan(candidate: Version, current: Version | undefined): boolean {
  if (!current) return true
  return compareVersions(candidate, current) > 0
}

export function sameVersion(a: Version, b: Version): boolean {
  return a.counter === b.counter && a.deviceId === b.deviceId
}

/**
 * Stamp the next local mutation: the clock only ever moves forward, and never
 * below a counter this device has already observed from a peer.
 */
export function advance(clock: number, deviceId: string): { version: Version; clock: number } {
  const counter = clock + 1
  return { version: { counter, deviceId }, clock: counter }
}

/** Fold remote versions into the local clock (Lamport receive rule). */
export function mergeClock(clock: number, versions: readonly Version[]): number {
  let next = clock
  for (const version of versions) {
    if (version.counter > next) next = version.counter
  }
  return next
}

/** Highest version in a collection — used when seeding a fresh clock. */
export function maxVersion(versions: readonly Version[]): Version | null {
  let best: Version | null = null
  for (const version of versions) {
    if (!best || compareVersions(version, best) > 0) best = version
  }
  return best
}
