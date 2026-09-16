import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Default env stays node so existing 14 lib tests keep running as-is.
    // Component tests opt into jsdom via `// @vitest-environment jsdom`
    // header directive per-file (Slice X1, 2026-09-16).
    setupFiles: ['./src/test/setup.ts'],
  },
})
