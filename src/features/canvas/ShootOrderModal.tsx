import { useState } from 'react'
import { Button, InfoIcon, Modal } from '@/ui'
import { autoLinkByLocation, BOARD_MODES, locationKey, shootGroups, type BoardMode } from '@/kernel'
import { useShots } from '@/state/select'
import { useAppStore } from '@/state/store'
import styles from './canvas.module.css'

interface ShootOrderModalProps {
  onClose: () => void
}

/** Fastest shoot order: same-location/setup shots grouped into consecutive
 * setups so the crew rigs once per setup instead of per story beat.
 * "Link same-setup cards" draws the AI threads between them (dashed).
 * Copy is deliberately minimal — the long instructions live behind the
 * ⓘ tooltip next to the actions.
 */
export function ShootOrderModal({ onClose }: ShootOrderModalProps) {
  const shots = useShots()
  const groups = shootGroups(shots)
  const boardMode = useAppStore((s) => s.settings.board_mode)
  const [showInfo, setShowInfo] = useState(false)

  function relink(): void {
    const state = useAppStore.getState()
    const next = autoLinkByLocation(state.shots)
    const aiLinks = next.reduce(
      (n, s) => n + (s.links?.filter((l) => l.origin === 'ai').length ?? 0),
      0,
    )
    state.setShots(next)
    state.pushToast(`Linked ${aiLinks} same-setup shots across ${groups.length} setups.`, 'ok')
  }

  /** Mode switch — pick one and the board re-renders without the guide threads. */
  function pickMode(mode: BoardMode): void {
    if (mode === boardMode) return
    useAppStore.getState().setSettings({ board_mode: mode })
    onClose()
  }

  /** Batch remove: strips every AI (dashed) guide thread, keeps manual ones. */
  function stripAiLinks(): void {
    const state = useAppStore.getState()
    let removed = 0
    const next = state.shots.map((s) => {
      const keep = (s.links ?? []).filter((l) => {
        if (l.origin === 'ai') {
          removed++
          return false
        }
        return true
      })
      return keep.length === (s.links?.length ?? 0) ? s : { ...s, links: keep }
    })
    if (removed === 0) {
      state.pushToast('No AI guide threads to remove.', 'info')
      return
    }
    state.setShots(next)
    state.pushToast(`Removed ${removed} AI guide thread${removed === 1 ? '' : 's'}.`, 'ok')
  }

  // Story order would hop location on every boundary; grouped order doesn't.
  const sorted = [...shots].sort((a, b) => a.order - b.order)
  let storyMoves = 0
  for (let i = 1; i < sorted.length; i++) {
    if (locationKey(sorted[i].scene_heading) !== locationKey(sorted[i - 1].scene_heading)) {
      storyMoves++
    }
  }
  const groupedMoves = Math.max(0, groups.length - 1)
  const savesMoves = storyMoves > groupedMoves

  return (
    <Modal title="Shoot order" onClose={onClose} wide>
      {/* Condensed stat badge — replaces the old instructional paragraph. */}
      <div className={styles.orderStat} data-testid="order-badge">
        <span className={styles.orderStatText}>
          {groups.length} Setup{groups.length === 1 ? '' : 's'}
        </span>
        <span className={styles.orderStatDot} aria-hidden="true">•</span>
        <span className={styles.orderStatText}>
          {shots.length} Shot{shots.length === 1 ? '' : 's'} Total
        </span>
        {savesMoves ? (
          <>
            <span className={styles.orderStatDot} aria-hidden="true">•</span>
            <span className={styles.orderStatSave}>
              saves {storyMoves - groupedMoves} move{storyMoves - groupedMoves === 1 ? '' : 's'}
            </span>
          </>
        ) : null}
      </div>

      <div className={styles.orderModes}>
        <span className={styles.orderModeLabel}>Board mode</span>
        <div className={styles.orderModeSeg} role="group" aria-label="Board mode">
          {BOARD_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={[
                styles.orderModeBtn,
                boardMode === m.id ? styles.orderModeBtnOn : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={boardMode === m.id}
              data-testid={`order-mode-${m.id}`}
              title={m.hint}
              onClick={() => pickMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {/* Single concise helper line. */}
        <p className={styles.orderModeHint}>Applies to board, planner and checklist instantly.</p>
      </div>

      <ol className={styles.orderList}>
        {groups.map((g, i) => (
          <li key={g.key} className={styles.orderItem}>
            <span className={styles.orderBadge}>S{i + 1}</span>
            <span className={styles.orderMain}>
              <span className={styles.orderLabel}>{g.label}</span>
              <span className={styles.orderShots}>
                {g.shots
                  .map((s) => `${String(s.shot_number).padStart(2, '0')} ${s.size}`)
                  .join(' · ')}
              </span>
            </span>
            <span className={styles.orderCount}>
              {g.shots.length} shot{g.shots.length === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ol>

      {/* Equal-width action grid + ⓘ info toggle. */}
      <div className={styles.orderActions}>
        <Button
          variant="primary"
          className={styles.orderActionBtn}
          onClick={relink}
          data-testid="relink-setup"
        >
          Link same-setup cards
        </Button>
        <Button
          className={styles.orderActionBtn}
          onClick={stripAiLinks}
          data-testid="strip-ai-links"
        >
          Remove AI guide threads
        </Button>
        <div className={styles.orderInfoWrap}>
          <button
            type="button"
            className={styles.orderInfoBtn}
            aria-expanded={showInfo}
            aria-label="How shoot order works"
            data-testid="order-info"
            onClick={() => setShowInfo((v) => !v)}
          >
            <InfoIcon size={16} />
          </button>
          <Button className={styles.orderActionBtn} onClick={onClose} data-testid="order-close">
            Close
          </Button>
        </div>
      </div>

      {/* Expandable tooltip — the old dense paragraph, tucked away. */}
      {showInfo ? (
        <div className={styles.orderInfoPop} role="note" data-testid="order-info-pop">
          <div className={styles.orderInfoHead}>
            <span>How it works</span>
            <button
              type="button"
              className={styles.orderInfoClose}
              aria-label="Hide help"
              onClick={() => setShowInfo(false)}
            >
              ✕
            </button>
          </div>
          <p>
            AI links (dashed) chain cards inside each setup. Pick a board mode above — Default
            shows cards + empty edge nodes (draw your threads there), Blend keeps every thread,
            Custom keeps only the threads you draw. To draw one yourself, drag a round node on any
            card edge onto another card. Hover a line to rotate its ends (click a handle) or remove
            it (✕).
          </p>
        </div>
      ) : null}
    </Modal>
  )
}
