import { useState } from 'react'
import { Button, Textarea } from '@/ui'
import { useAppStore } from '@/state/store'
import { useParseScript } from './useParseScript'
import styles from './parser.module.css'

interface ScriptFirstCardProps {
  /**
   * Called when the card hands the script off to AI Configuration because no
   * key exists yet. Onboarding uses it to step aside so the modal can show.
   */
  onContinue?: () => void
  /** Called after a successful parse (onboarding marks itself done here). */
  onParsed?: () => void
}

/**
 * The script-first entry point: the screenplay field and one primary action
 * live together, so a new user never picks between "parse" and "add a key".
 * Pressing Parse Script with no key stashes the text and opens the lightweight
 * AI Configuration modal, which resumes the parse once the key is saved.
 */
export function ScriptFirstCard({ onContinue, onParsed }: ScriptFirstCardProps) {
  const [text, setText] = useState('')
  const { status, error, parse } = useParseScript()
  const hasKey = useAppStore((s) => s.settings.api_key.trim().length > 0)
  const parsing = status === 'parsing'

  async function onParse(): Promise<void> {
    if (text.trim().length === 0 || parsing) return
    if (!hasKey) {
      const store = useAppStore.getState()
      store.setPendingScript(text)
      onContinue?.()
      store.setActiveModal('aiconfig')
      return
    }
    const shots = await parse(text)
    if (shots) onParsed?.()
  }

  return (
    <div className={styles.firstCard}>
      <Textarea
        className={styles.firstInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Paste your screenplay here…\n\nINT. DINER - NIGHT\n\nAlice slides into the booth.'}
        spellCheck={false}
        aria-label="Screenplay text"
        data-testid="script-input"
      />

      {error ? <p className={styles.error}>{error}</p> : null}

      <Button
        variant="primary"
        disabled={text.trim().length === 0 || parsing}
        data-testid="script-parse"
        onClick={() => void onParse()}
      >
        {parsing ? 'Parsing…' : 'Parse Script'}
      </Button>

      {parsing ? (
        <span className={styles.spinnerText} role="status">
          Parsing on device…
        </span>
      ) : null}
    </div>
  )
}
