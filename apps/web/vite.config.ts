import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // In dev the API runs on `pnpm dev:server`. In production the Worker serves both from one origin.
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
