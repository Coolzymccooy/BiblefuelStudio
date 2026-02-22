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
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true
        },
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
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
      port: 5173,
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
