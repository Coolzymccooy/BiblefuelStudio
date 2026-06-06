import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_BASE_URL || 'http://localhost:5051'

  return {
    plugins: [
      react(),
      VitePWA({
        // Self-destroying SW: generates a service worker that unregisters
        // itself and clears all caches on every client. The committed-bundle
        // deploy flow + a precaching SW repeatedly served stale index.html /
        // chunk hashes after deploys (blank screen, then cross-build chunk
        // mismatch). Killing the SW removes that whole failure class. Stuck
        // clients auto-recover on their next visit (sw.js is served no-cache).
        // The app stays a normal CDN-served SPA (no offline/installable PWA).
        selfDestroying: true,
        registerType: 'autoUpdate',
        // Disabled in dev: the service worker caches index.html + bundle
        // hashes, and any HMR change ships new hashes that the cached HTML
        // doesn't know about, leaving you on a blank page with the SW
        // serving stale bytes. PWA still bundles for prod builds.
        devOptions: {
          enabled: false
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
        workbox: {
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api/, /^\/outputs/, /^\/assets\/.+\.(js|css)$/],
        },
        manifest: {
          name: 'Biblefuel Studio',
          short_name: 'Biblefuel',
          description: 'AI-Powered Content Creation Studio',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            {
              src: 'vite.svg',
              sizes: '192x192',
              type: 'image/svg+xml'
            },
            {
              src: 'vite.svg',
              sizes: '512x512',
              type: 'image/svg+xml'
            }
          ]
        }
      })
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
