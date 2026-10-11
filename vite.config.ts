import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The integration suites (`pairing-flow`, `webrtc-sync`, `engine`) drive
    // real timers, fake data channels and quiescence windows across two whole
    // app instances. Under a saturated worker pool the 5s default turns
    // scheduling pressure into a false failure, so give them headroom and cap
    // concurrency rather than weakening any assertion.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    maxWorkers: 4,
  },
})
