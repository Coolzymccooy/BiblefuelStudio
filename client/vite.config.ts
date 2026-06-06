import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// NOTE: the PWA / service worker was intentionally removed. The committed-bundle
// deploy flow (new chunk hashes every deploy, old ones deleted) repeatedly left
// a precaching service worker serving a stale index.html → blank screens and
// cross-build chunk mismatches. A self-destroying SW fixed the staleness but,
// left wired to registerSW.js, re-registered on every load and reload-looped
// (pegging memory/CPU). So we drop the SW entirely and serve a one-shot
// self-destroyer from public/sw.js (no registerSW → no loop) to clean up any
// client that still has a worker registered. The app is a normal CDN SPA.

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_BASE_URL || 'http://localhost:5051'

  return {
    plugins: [
      react(),
    ],
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/outputs': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: '../server/public',
      emptyOutDir: true,
    },
  }
})
