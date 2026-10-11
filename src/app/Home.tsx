import { useEffect, useState } from 'react'
import type { Project } from '@/kernel'
import { openProject } from '@/state/projectActions'
import { getServices } from '@/state/services'
import { useAppStore } from '@/state/store'
import { Button, GridIcon } from '@/ui'
import styles from './app.module.css'

/** Homepage (feedback round): the app opens HERE, not inside a board. */
export function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [lastId, setLastId] = useState<string | null>(null)
  const setActiveModal = useAppStore((s) => s.setActiveModal)

  useEffect(() => {
    let cancelled = false
    const { storage } = getServices()
    void Promise.all([storage.listProjects(), storage.getMeta<string>('active_project_id')])
      .then(([list, active]) => {
        if (cancelled) return
        setProjects([...list].sort((a, b) => b.updated_at - a.updated_at))
        setLastId(active)
      })
      .catch((cause: unknown) => {
        console.error('home: list projects failed', cause)
        if (!cancelled) {
          setProjects([])
          setLastId(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const list = projects ?? []
  const last = lastId ? (list.find((p) => p.id === lastId) ?? null) : null
  const others = last ? list.filter((p) => p.id !== last.id) : list

  return (
    <div className={styles.home} data-testid="home">
      <section className={styles.homeHero}>
        <span className={styles.homeMark} aria-hidden="true">
          <GridIcon size={34} />
        </span>
        <h1 className={styles.homeTitle}>RecBay</h1>
        <p className={styles.homeLead}>
          Paste a screenplay, get a shot list you can actually shoot from. Parsed on this
          device with your own AI key — scripts, shots and images never leave it.
        </p>
        <div className={styles.parseBtnWrap}>
          <Button
            variant="primary"
            onClick={() => setActiveModal('parse')}
            data-testid="home-parse"
            style={{ width: '100%' }}
          >
            Parse a script
          </Button>
        </div>
      </section>

      <section className={styles.homeProjects}>
        {last ? (
          <div className={styles.homeContinue}>
            <span className={styles.homeContinueMeta}>Continue where you left off</span>
            <span className={styles.homeContinueTitle}>{last.title}</span>
            <Button
              variant="primary"
              onClick={() => void openProject(last.id)}
              data-testid="home-continue"
            >
              Open
            </Button>
          </div>
        ) : null}

        <div className={styles.homeProjectsTitle}>Your projects</div>
        {projects === null ? (
          <p className={styles.homeHint}>Loading local projects…</p>
        ) : others.length === 0 ? (
          <p className={styles.homeHint}>
            {last
              ? 'No other projects yet.'
              : 'Nothing here yet — parse a screenplay and the shots land on a fresh board.'}
          </p>
        ) : (
          <ul className={styles.homeList}>
            {others.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={styles.homeProjectBtn}
                  onClick={() => void openProject(p.id)}
                  data-testid="home-open-project"
                >
                  <span className={styles.homeProjectTitle}>{p.title}</span>
                  <span className={styles.homeProjectMeta}>
                    {new Date(p.updated_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
