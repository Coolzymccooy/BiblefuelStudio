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
      // Opt-in LAN exposure for testing on a phone / second laptop:
      //   npm run dev -- --host        (or set VITE_EXPOSE=1)
      // Off by default: binding 0.0.0.0 puts the dev server, and the API it
      // proxies, on every network the machine is joined to. Deliberate, not
      // automatic.
      host: env.VITE_EXPOSE ? true : undefined,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          // The API runs under `node --watch` and restarts on every server
          // file save; a request in flight at that moment used to surface as
          // a bare "Request failed with status code 500" from the proxy.
          // Answer with a clear, retryable 503 the client can explain.
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              const r = res as import('http').ServerResponse;
              if (!r || r.headersSent || typeof r.writeHead !== 'function') return;
              r.writeHead(503, { 'Content-Type': 'application/json' });
              r.end(JSON.stringify({
                ok: false,
                error: 'API_UNREACHABLE',
                hint: `The local API was restarting or unreachable (${(err as NodeJS.ErrnoException).code || 'proxy error'}). Try again in a moment.`,
              }));
            });
          },
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
