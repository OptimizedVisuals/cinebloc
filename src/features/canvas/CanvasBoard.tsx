import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  BOARD_MODES,
  modeLabel,
  setupIndexByShot,
  shootGroups,
  type EdgeSide,
  type Project,
  type ShotLink,
} from '@/kernel'
import { openProject } from '@/state/projectActions'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import { useShots } from '@/state/select'
import { BoltIcon, Button, SlideshowIcon } from '@/ui'
import { ProjectSlideshow, type ProjectSlide } from '@/media'
import { RadialGrid } from './RadialGrid'
import { ShotCard } from './ShotCard'
import { EdgeLayer } from './EdgeLayer'
import { ShootOrderModal } from './ShootOrderModal'
import { nearestSide, type PendingConnect, type Size } from './edgeGeometry'
import styles from './canvas.module.css'

/**
 * Desktop spatial canvas (claim 3): infinite-feel panning board with radial
 * dotted grid, draggable cards, per-card metadata, and the connection
 * graph (feedback round): drag a card's edge node onto another card to
 * thread them; the SVG layer auto-routes every thread as a smooth curve.
 */
export function CanvasBoard() {
  const shots = useShots()
  const addLink = useAppStore((s) => s.addLink)
  const removeLink = useAppStore((s) => s.removeLink)
  const rotateLinkEnd = useAppStore((s) => s.rotateLinkEnd)
  const boardMode = useAppStore((s) => s.settings.board_mode)

  const [sizes, setSizes] = useState<Record<string, Size>>({})
  const [pending, setPending] = useState<PendingConnect | null>(null)
  const [orderOpen, setOrderOpen] = useState(false)
  const [slideshowOpen, setSlideshowOpen] = useState(false)

  const boardRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const projectId = useAppStore((s) => s.project?.id ?? null)
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  const sizesRef = useRef(sizes)
  sizesRef.current = sizes

  // Entering a different project always starts at the board's origin.
  useEffect(() => {
    const vp = viewportRef.current
    if (vp) {
      vp.scrollLeft = 0
      vp.scrollTop = 0
    }
    setSizes({})
  }, [projectId])

  const onSize = useCallback((id: string, w: number, h: number) => {
    setSizes((prev) =>
      prev[id] && prev[id].w === w && prev[id].h === h ? prev : { ...prev, [id]: { w, h } },
    )
  }, [])

  /** Card under a board-space point, clipped to its nearest edge. */
  function hitTarget(fromId: string, x: number, y: number): PendingConnect['target'] {
    for (const s of shotsRef.current) {
      if (s.id === fromId) continue
      const size = sizesRef.current[s.id]
      if (!size) continue
      const { x: left, y: top } = s.position_on_board
      if (x >= left && x <= left + size.w && y >= top && y <= top + size.h) {
        return { id: s.id, side: nearestSide(size, x - left, y - top) }
      }
    }
    return null
  }

  /** Click a node, pull, release on the next card — the thread clips to its edge. */
  const startConnect = useCallback(
    (e: ReactPointerEvent, fromId: string, side: EdgeSide) => {
      if (e.button !== 0) return
      e.preventDefault()
      const board = boardRef.current
      if (!board) return

      const toBoard = (ev: { clientX: number; clientY: number }) => {
        const rect = board.getBoundingClientRect()
        return { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
      }
      const start = toBoard(e)

      const onMove = (ev: globalThis.PointerEvent) => {
        const p = toBoard(ev)
        setPending((prev) =>
          prev && prev.fromId === fromId
            ? { ...prev, x: p.x, y: p.y, target: hitTarget(fromId, p.x, p.y) }
            : prev,
        )
      }
      const onUp = (ev: globalThis.PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const p = toBoard(ev)
        const target = hitTarget(fromId, p.x, p.y)
        setPending(null)
        if (!target) return
        const link: ShotLink = {
          id: crypto.randomUUID(),
          to: target.id,
          from_side: side,
          to_side: target.side,
          origin: 'manual',
        }
        addLink(fromId, link)
      }

      setPending({ fromId, side, x: start.x, y: start.y, target: null })
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [addLink],
  )

  /** Hold left button on empty board and move — the view pans with you. */
  const onPanDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    // Cards, nodes, buttons and dialogs own their own pointer behavior.
    if (target.closest('article, button, input, textarea, select, a, [role="dialog"]')) return
    const vp = viewportRef.current
    if (!vp) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const startLeft = vp.scrollLeft
    const startTop = vp.scrollTop
    vp.classList.add(styles.panning)
    const onMove = (ev: globalThis.PointerEvent) => {
      vp.scrollLeft = startLeft - (ev.clientX - startX)
      vp.scrollTop = startTop - (ev.clientY - startY)
    }
    const onUp = () => {
      vp.classList.remove(styles.panning)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const groups = shootGroups(shots)
  const setupIndex = setupIndexByShot(shots)
  const showSetups = boardMode === 'fast' && groups.length > 1
  // Which threads render:
  //   Default = none (cards only, but edge nodes remain so the user can
  //   draw threads — the canvas 'Default' UX you asked for).
  //   Blend = all (AI + manual merged).
  //   Custom = manual only; Fastest = all.
  const linkView = boardMode === 'blend' ? 'all' : boardMode === 'fast' ? 'all' : boardMode === 'custom' ? 'manual' : 'none'
  // Thread-starting nodes exist only where threads are allowed at all.
  // 'default' keeps its nodes (the user draws threads there); 'blend'
  // shows them; 'custom' shows them but only manual; 'fast' shows them
  // for the AI threads too.
  const connectable = boardMode === 'default' || boardMode === 'blend' || boardMode === 'custom'

  // Full mode name for the capsule hover tooltip.
  const fullModeName = BOARD_MODES.find((m) => m.id === boardMode)?.label ?? 'Default'

  // Every project image, in film order — the slideshow reel.
  const slideshowSlides: ProjectSlide[] = []
  for (const shot of shots) {
    const label = `${String(shot.shot_number).padStart(2, '0')} · ${shot.scene_heading}`
    for (const key of shot.asset_refs) {
      slideshowSlides.push({ assetKey: key, shotLabel: label })
    }
  }
  return (
    <>
      <div
        className={styles.viewport}
        data-testid="canvas-board"
        ref={viewportRef}
        onPointerDown={onPanDown}
      >
        <div
          className={shots.length === 0 ? `${styles.board} ${styles.boardEmpty}` : styles.board}
          ref={boardRef}
        >
          <RadialGrid />
          <EdgeLayer
            shots={shots}
            sizes={sizes}
            pending={pending}
            linkView={linkView}
            onRotate={(fromId, linkId, end) => rotateLinkEnd(fromId, linkId, end)}
            onRemove={(fromId, linkId) => removeLink(fromId, linkId)}
          />
          {shots.map((shot) => (
            <ShotCard
              key={shot.id}
              shot={shot}
              setup={showSetups ? setupIndex.get(shot.id) : undefined}
              linkTarget={pending?.target?.id === shot.id}
              onSize={onSize}
              startConnect={connectable ? (e, side) => startConnect(e, shot.id, side) : undefined}
            />
          ))}
          {shots.length === 0 ? <CanvasEmptyState /> : null}
        </div>

        {/* Minimal dock: mode capsule (icon + short label) + slideshow trigger. */}
        {shots.length > 0 ? (
          <div className={styles.dock}>
            <button
              type="button"
              className={styles.modeCapsule}
              aria-label={`Board mode: ${fullModeName}. Open shoot order settings`}
              data-testid="mode-capsule"
              onClick={() => setOrderOpen(true)}
            >
              <BoltIcon size={14} />
              <span>{modeLabel(boardMode)}</span>
              <span className={styles.modeCapsuleTip} role="tooltip">
                {fullModeName}
              </span>
            </button>
            <button
              type="button"
              className={styles.dockBtn}
              aria-label="Play project image slideshow"
              data-testid="slideshow-open"
              onClick={() => setSlideshowOpen(true)}
            >
              <SlideshowIcon size={16} />
            </button>
          </div>
        ) : null}
      </div>

      {slideshowOpen && slideshowSlides.length > 0 ? (
        <ProjectSlideshow
          slides={slideshowSlides}
          onClose={() => setSlideshowOpen(false)}
        />
      ) : null}

      {orderOpen ? <ShootOrderModal onClose={() => setOrderOpen(false)} /> : null}
    </>
  )
}

function CanvasEmptyState() {
  const onboardingDone = useAppStore((s) => s.onboarding_done)
  const [projects, setProjects] = useState<Project[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void getServices()
      .storage.listProjects()
      .then((list) => {
        if (!cancelled) setProjects([...list].sort((a, b) => b.updated_at - a.updated_at))
      })
      .catch((cause: unknown) => {
        console.error('list projects failed', cause)
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const hasProjects = (projects?.length ?? 0) > 0

  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>
        {projects === null ? 'Your board is empty' : hasProjects ? 'No project open' : 'Your board is empty'}
      </div>
      <p className={styles.emptyHint}>
        {!onboardingDone
          ? 'Welcome to RecBay. Start by pasting a screenplay — the AI builds the skeleton, you shape the board.'
          : hasProjects
            ? 'Pick a project below to get back to work, or start a fresh script.'
            : 'Paste a screenplay and the BYOK parser will lay out your first shot cards here.'}
      </p>
      <div className={styles.emptyActions}>
        <Button variant="primary"            onClick={() => useAppStore.getState().setActiveModal('parse')}>
          Parse a script
        </Button>
        <Button            onClick={() => useAppStore.getState().setActiveModal('settings')}>Settings</Button>
      </div>
      {hasProjects ? (
        <div className={styles.emptyProjects}>
          <div className={styles.emptyProjectsTitle}>Jump back in</div>
          <ul className={styles.emptyList}>
            {projects!.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={styles.emptyProjectBtn}
                  onClick={() => void openProject(p.id)}
                  data-testid="empty-open-project"
                >
                  <span className={styles.emptyProjectTitle}>{p.title}</span>
                  <span className={styles.emptyProjectMeta}>
                    {new Date(p.updated_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
