import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.ts'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    rollupOptions: { input: { page: 'src/page/index.html' } },
  },
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
})
