import styles from './ui.module.css'

interface ToggleProps {
  checked: boolean
  onChange: () => void
  label: string
}

/**
 * App-style pill switch (large, high-friction touch target — claim 4).
 * Cyan track when on, muted track when off, with a sliding knob.
 * Shared by Settings (App Security) and the checklist completion row.
 */
export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      className={[styles.toggle, checked ? styles.toggleOn : ''].filter(Boolean).join(' ')}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
    >
      <span className={styles.toggleKnob} />
    </button>
  )
}
