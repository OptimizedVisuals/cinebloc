import { autoLinkByLocation, defaultPosition, type Shot } from '@/kernel'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import { runViewChange } from '@/state/viewChanges'

/**
 * Dev-only demo project (?seed=1 in dev builds) so both layouts can be
 * exercised in a browser without a real API key. Never ships to production.
 */

interface SeedRow {
  scene: string
  shot: number
  size: string
  lens: string | null
  movement: string | null
  character: string | null
  action: string
}

const SEED_ROWS: SeedRow[] = [
  { scene: 'INT. DINER - NIGHT', shot: 1, size: 'WS', lens: '24mm', movement: 'STATIC', character: null, action: 'Rain streaks the windows as ALICE slides into the corner booth.' },
  { scene: 'INT. DINER - NIGHT', shot: 2, size: 'MS', lens: '35mm', movement: 'STATIC', character: 'ALICE', action: 'Alice checks the door, then the clock above the counter.' },
  { scene: 'INT. DINER - NIGHT', shot: 3, size: 'CU', lens: '50mm', movement: 'DOLLY', character: 'ALICE', action: 'Her fingers tap a nervous rhythm on the Formica tabletop.' },
  { scene: 'INT. DINER - NIGHT', shot: 4, size: 'OTS', lens: '40mm', movement: 'HANDHELD', character: 'WAITRESS', action: 'The WAITRESS sets down coffee without a word.' },
  { scene: 'EXT. PARKING LOT - NIGHT', shot: 1, size: 'EWS', lens: '18mm', movement: 'CRANE', character: null, action: 'The diner glow spills across the flooded lot.' },
  { scene: 'EXT. PARKING LOT - NIGHT', shot: 2, size: 'POV', lens: '28mm', movement: 'TRACK', character: 'ALICE', action: 'Alice’s POV: a figure waits beside the sedan.' },
  { scene: 'EXT. PARKING LOT - NIGHT', shot: 3, size: 'ECU', lens: '85mm', movement: 'STATIC', character: 'ALICE', action: 'Eyes widening — she recognizes him.' },
  { scene: 'INT. CAR - NIGHT', shot: 1, size: 'MS', lens: '35mm', movement: 'STATIC', character: 'ALICE', action: 'Alice locks the doors and exhales.' },
]

function makeShot(row: SeedRow, index: number): Shot {
  return {
    id: crypto.randomUUID(),
    scene_id: row.scene
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
    scene_heading: row.scene,
    shot_number: row.shot,
    character: row.character,
    action: row.action,
    size: row.size as Shot['size'],
    lens: row.lens,
    movement: row.movement as Shot['movement'],
    position_on_board: defaultPosition(index),
    is_completed: false,
    order: index,
    asset_refs: [],
    notes: '',
  }
}

const DEMO_TITLE = 'Demo — Rain Diner Sequence'

/**
 * Dev-only demo frames: a hue-shifted gradient card with the shot label,
 * rendered on a canvas and stored as a real PNG blob — so the slideshow,
 * checklists and thumbnails can be verified visually with no network and no
 * hand-made assets. Never shipped (this module is dev-only).
 */
async function renderDemoFrame(shot: Shot, i: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 400
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d canvas context')

  const hue = (i * 47) % 360
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  grad.addColorStop(0, `hsl(${hue} 70% 24%)`)
  grad.addColorStop(1, `hsl(${(hue + 45) % 360} 80% 8%)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 1
  for (let x = 40; x < canvas.width; x += 40) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, canvas.height)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.font = '700 34px system-ui, sans-serif'
  ctx.fillText(`${String(shot.shot_number).padStart(2, '0')} · ${shot.size}`, 28, 56)
  ctx.font = '600 18px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'
  ctx.fillText(shot.scene_heading, 28, canvas.height - 32)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas.toBlob returned null'))
    }, 'image/png')
  })
}

async function attachDemoImages(shots: Shot[]): Promise<void> {
  const { storage } = getServices()
  for (const [i, shot] of shots.slice(0, 6).entries()) {
    const blob = await renderDemoFrame(shot, i)
    const key = `${shot.id}/demo-frame-${i}.png`
    await storage.putBlob(key, blob)
    useAppStore.getState().addAssetRef(shot.id, key)
  }
}

export function seedDemoIfRequested(): void {
  if (!import.meta.env.DEV) return
  if (!new URLSearchParams(window.location.search).has('seed')) return

  const store = useAppStore.getState()
  if (store.project || store.shots.length > 0) return

  // Reuse an existing demo project so reloads don't fill History with copies.
  void (async () => {
    const list = await getServices().storage.listProjects()
    const existing = list.find((p) => p.title === DEMO_TITLE)
    if (existing) {
      const [project, shots] = await Promise.all([
        getServices().storage.loadProject(existing.id),
        getServices().storage.listShots(existing.id),
      ])
      if (project) {
        // Loading an existing demo project is a view change, exactly like
        // opening one from History — it must not create sync operations.
        const live = useAppStore.getState()
        runViewChange(() => {
          live.setProject(project)
          live.setShots(shots)
        })
        return
      }
    }
    store.newProject(DEMO_TITLE, 'INT. DINER - NIGHT\n\nAlice waits.')
    const seeded = autoLinkByLocation(SEED_ROWS.map(makeShot))
    store.setShots(seeded)
    store.completeOnboarding()
    if (new URLSearchParams(window.location.search).has('images')) {
      await attachDemoImages(seeded)
    }
    store.pushToast('Dev seed loaded (?seed=1).', 'info')
  })().catch((cause: unknown) => console.error('seed failed', cause))
}
