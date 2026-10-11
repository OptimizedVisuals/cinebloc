import type { Project, Shot } from '@/kernel'
import { useAppStore } from './store'

/**
 * Undo/redo over the two persistent slices (shots + project). Snapshots are
 * module-local — never persisted. Bursts (card drags, note typing) coalesce
 * into a single step via a time window, and hydration / vault lock+reset are
 * never recorded, so a locked vault can't expose pre-lock states through undo.
 */

interface Snapshot {
  shots: Shot[]
  project: Project | null
}

const CAP = 60
const COALESCE_MS = 600

let undoStack: Snapshot[] = []
let redoStack: Snapshot[] = []
let lastPush = 0
let applying = false
let stop: (() => void) | null = null

export function initHistory(): () => void {
  if (stop) return stop
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (!state.hydrated || !prev.hydrated) {
      // Vault lock/reset wipes hydrated — drop pre-lock snapshots.
      if (prev.hydrated && !state.hydrated) clearHistory()
      return
    }
    if (applying) return
    if (state.shots === prev.shots && state.project === prev.project) return
    const now = Date.now()
    if (undoStack.length > 0 && now - lastPush < COALESCE_MS) {
      return // continuation of a burst — keep the pre-burst snapshot only
    }
    undoStack.push({ shots: prev.shots, project: prev.project })
    if (undoStack.length > CAP) undoStack.shift()
    lastPush = now
    redoStack = []
  })
  stop = () => {
    unsubscribe()
    stop = null
  }
  return stop
}

export function clearHistory(): void {
  undoStack = []
  redoStack = []
  lastPush = 0
}

/**
 * Apply a change that must NOT become an undo step.
 *
 * Used by device sync (ADR 0005): changes that arrive from a paired device are
 * not this user's edits, so Ctrl+Z must never “undo” a phone's tick. Reusing
 * the existing `applying` guard keeps a single source of truth for the rule.
 */
export function runWithoutHistory(apply: () => void): void {
  const previous = applying
  applying = true
  try {
    apply()
  } finally {
    applying = previous
  }
}

export function canUndo(): boolean {
  return undoStack.length > 0
}

export function canRedo(): boolean {
  return redoStack.length > 0
}

function usable(): boolean {
  const s = useAppStore.getState()
  return s.hydrated && s.vault_state !== 'locked'
}

export function undo(): boolean {
  if (!usable()) return false
  const snap = undoStack.pop()
  if (!snap) return false
  const cur = useAppStore.getState()
  redoStack.push({ shots: cur.shots, project: cur.project })
  applying = true
  try {
    useAppStore.setState({ shots: snap.shots, project: snap.project })
  } finally {
    applying = false
  }
  lastPush = 0
  return true
}

export function redo(): boolean {
  if (!usable()) return false
  const snap = redoStack.pop()
  if (!snap) return false
  const cur = useAppStore.getState()
  undoStack.push({ shots: cur.shots, project: cur.project })
  applying = true
  try {
    useAppStore.setState({ shots: snap.shots, project: snap.project })
  } finally {
    applying = false
  }
  lastPush = 0
  return true
}
