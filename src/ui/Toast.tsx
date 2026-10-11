import styles from './ui.module.css'

/**
 * Structurally typed view of a toast — deliberately local so ui/ never
 * imports state/ (dependency law); state's Toast is assignable to this.
 */
interface ToastData {
  id: string
  text: string
  tone: 'info' | 'ok' | 'error'
}

interface ToastProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

export function ToastStack({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null
  return (
    <div className={styles.toaster} aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            styles.toast,
            t.tone === 'ok' ? styles.toastOk : '',
            t.tone === 'error' ? styles.toastError : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span>{t.text}</span>
          <button
            type="button"
            className={styles.toastDismiss}
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
