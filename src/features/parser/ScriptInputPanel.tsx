import { useState } from 'react'
import { BOARD_MODES } from '@/kernel'
import { Button, Textarea } from '@/ui'
import { flushPersistence } from '@/state/persistence'
import { useAppStore } from '@/state/store'
import { useParseScript } from './useParseScript'
import styles from './parser.module.css'

/**
 * Parse modal — always the screenplay entry: paste text, pick the board mode
 * for the new workspace, press Generate shots. A successful parse closes
 * straight into the new board. With no key yet, Generate hands the script to
 * the lightweight AI Configuration modal, which parses it once the key saves.
 */
export function ScriptInputPanel() {
  const [text, setText] = useState('')
  const { status, error, parse, cancel } = useParseScript()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)

  const onClose = () => useAppStore.getState().setActiveModal(null)
  const openAiConfig = () => useAppStore.getState().setActiveModal('aiconfig')
  const hasKey = settings.api_key.trim().length > 0
  const mode = BOARD_MODES.find((m) => m.id === settings.board_mode) ?? BOARD_MODES[1]

  async function generate(): Promise<void> {
    if (!hasKey) {
      // Keep the script and let AI Configuration resume the parse after saving.
      useAppStore.getState().setPendingScript(text)
      openAiConfig()
      return
    }
    const shotsParsed = await parse(text)
    if (!shotsParsed) return
    // Land the new workspace in IndexedDB before the dialog closes, so a
    // screen lock right after generating loses nothing.
    await flushPersistence()
    onClose()
  }

  return (
    <div className={styles.panel}>
      <div className={styles.row}>
        <span className={styles.badge}>
          {settings.provider} · {settings.model}
        </span>
        <button className={styles.link} onClick={openAiConfig}>
          {settings.api_key ? 'Change key' : 'Add API key'}
        </button>
      </div>

      <div className={styles.modeBox}>
        <span className={styles.modeLabel}>Board mode</span>
        <div className={styles.modeSeg} role="group" aria-label="Board mode">
          {BOARD_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={[
                styles.modeBtn,
                settings.board_mode === m.id ? styles.modeBtnOn : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={settings.board_mode === m.id}
              data-testid={`parse-mode-${m.id}`}
              title={m.hint}
              onClick={() => setSettings({ board_mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className={styles.modeHint}>{mode.hint}</span>
      </div>

      <Textarea
        className={styles.scriptInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Paste your screenplay here…\n\nINT. DINER - NIGHT\n\nAlice slides into the booth.'}
        spellCheck={false}
        aria-label="Screenplay text"
      />

      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.actions}>
        {status === 'parsing' ? (
          <Button variant="danger" onClick={cancel}>
            Cancel parse
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={text.trim().length === 0}
            data-testid="parse-submit"
            onClick={() => void generate()}
          >
            Generate shots
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
        {status === 'parsing' ? (
          <span className={styles.spinnerText} role="status">
            Parsing on device via {settings.provider}…
          </span>
        ) : null}
      </div>
    </div>
  )
}
