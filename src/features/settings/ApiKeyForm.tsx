import { PROVIDER_MODELS, type ProviderId } from '@/kernel'
import { Field, Input, Select } from '@/ui'
import { useAppStore } from '@/state/store'
import styles from './settings.module.css'

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI (or compatible)' },
  { id: 'anthropic', label: 'Anthropic Claude' },
]

/**
 * The secure client-side API configuration gateway (claim 1): the token is
 * written straight into local device state — never to a server of ours.
 */
export function ApiKeyForm() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const models = PROVIDER_MODELS[settings.provider]

  return (
    <div className={styles.grid}>
      <Field label="Provider">
        <Select
          value={settings.provider}
          onChange={(e) => {
            const provider = e.target.value as ProviderId
            setSettings({ provider, model: PROVIDER_MODELS[provider][0] })
          }}
          data-testid="provider-select"
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
          list="recbay-models"
          value={settings.model}
          onChange={(e) => setSettings({ model: e.target.value })}
          placeholder={models[0]}
          data-testid="model-input"
        />
        <datalist id="recbay-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      <Field label="API key (BYOK)">
        <Input
          type="password"
          autoComplete="off"
          value={settings.api_key}
          onChange={(e) => setSettings({ api_key: e.target.value })}
          placeholder="stored on this device only"
          data-testid="api-key-input"
        />
      </Field>

      <Field label="Base URL (optional)">
        <Input
          value={settings.base_url ?? ''}
          onChange={(e) => setSettings({ base_url: e.target.value || null })}
          placeholder="https://api.openai.com/v1"
        />
      </Field>
    </div>
  )
}
