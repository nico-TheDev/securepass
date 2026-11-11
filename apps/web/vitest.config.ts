import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Logic tests run in node. Component and hook tests opt in with `// @vitest-environment jsdom`.
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Argon2id at the KDF floor takes a moment per derivation.
    testTimeout: 30_000,
  },
})
