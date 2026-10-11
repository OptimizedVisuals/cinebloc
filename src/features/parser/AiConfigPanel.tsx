import { useState } from 'react'
import { PROVIDER_MODELS, type ProviderId } from '@/kernel'
import { Button, Field, Input, Select } from '@/ui'
import { useAppStore } from '@/state/store'
import { useParseScript } from './useParseScript'
import styles from './parser.module.css'

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI (or compatible)' },
  { id: 'anthropic', label: 'Anthropic Claude' },
]

/**
 * Lightweight BYOK configuration — the only thing between a script and a shot
 * list. Deliberately separate from the full Settings panel: provider, model,
 * key, save. When a script is already waiting (the landing card handed one
 * over), saving the key resumes and parses it in the same step.
 */
export function AiConfigPanel() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const pending = useAppStore((s) => s.pending_script)
  const { status, error, parse } = useParseScript()

  const [provider, setProvider] = useState<ProviderId>(settings.provider)
  const [model, setModel] = useState(settings.model)
  const [apiKey, setApiKey] = useState(settings.api_key)
  const [localError, setLocalError] = useState<string | null>(null)

  const parsing = status === 'parsing'
  const message = localError ?? error

  async function save(): Promise<void> {
    setLocalError(null)
    if (apiKey.trim().length === 0) {
      setLocalError('Enter your API key to continue.')
      return
    }
    const store = useAppStore.getState()
    setSettings({
      provider,
      model: model.trim() || PROVIDER_MODELS[provider][0],
      api_key: apiKey.trim(),
    })

    if (!pending) {
      store.setActiveModal(null)
      return
    }

    // A script is waiting: parse it now and land the user on the board.
    const shots = await parse(pending)
    if (shots) {
      store.setPendingScript(null)
      store.completeOnboarding()
      store.setActiveModal(null)
    }
  }

  return (
    <div className={styles.aiConfig}>
      <Field label="Provider">
        <Select
          value={provider}
          onChange={(e) => {
            const next = e.target.value as ProviderId
            setProvider(next)
            setModel(PROVIDER_MODELS[next][0])
          }}
          data-testid="aiconfig-provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Model">
        <Input
          list="recbay-ai-models"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={PROVIDER_MODELS[provider][0]}
          data-testid="aiconfig-model"
        />
        <datalist id="recbay-ai-models">
          {PROVIDER_MODELS[provider].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      <Field label="API key (BYOK)">
        <Input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="stored on this device only"
          data-testid="aiconfig-key"
        />
      </Field>

      {message ? <p className={styles.error}>{message}</p> : null}

      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={parsing}
          data-testid="aiconfig-save"
          onClick={() => void save()}
        >
          {parsing ? 'Parsing…' : pending ? 'Save key & parse script' : 'Save key'}
        </Button>
        {parsing ? (
          <span className={styles.spinnerText} role="status">
            Parsing on device…
          </span>
        ) : null}
      </div>

      <p className={styles.spinnerText}>Key stays on this device; sent only to your provider.</p>
    </div>
  )
}
