import type { GetState, SetState, Toast, UiSlice } from '../types'

/** Feedback toasts are transient: they dismiss themselves. */
const TOAST_TTL_MS = 5000

export function createUiSlice(set: SetState, _get: GetState): UiSlice {
  return {
    hydrated: false,
    onboarding_done: false,
    active_modal: null,
    pending_script: null,
    toasts: [],
    vault_state: 'off',

    setVaultState(state) {
      set(() => ({ vault_state: state }))
    },

    completeOnboarding() {
      set(() => ({ onboarding_done: true }))
    },

    setActiveModal(modal) {
      set(() => ({ active_modal: modal }))
    },

    setPendingScript(script) {
      set(() => ({ pending_script: script }))
    },

    pushToast(text, tone = 'info') {
      const toast: Toast = { id: crypto.randomUUID(), text, tone }
      set((state) => ({ toasts: [...state.toasts.slice(-3), toast] }))
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== toast.id) }))
      }, TOAST_TTL_MS)
      return toast.id
    },

    dismissToast(id) {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    },
  }
}
