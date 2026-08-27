import { fileURLToPath, URL } from 'node:url'
import { defineConfig, configDefaults } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Deliberately standalone rather than merged with vite.config.ts: that config
// carries the Cloudflare plugin, which boots workerd and rejects Vitest's
// `resolve.external`. Tests need Vue SFC compilation and the @ alias, nothing more —
// the Worker is exercised directly through `app.request()`.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    root: fileURLToPath(new URL('./', import.meta.url)),
  },
})
