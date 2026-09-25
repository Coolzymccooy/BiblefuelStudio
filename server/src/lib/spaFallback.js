import path from "path";

/**
 * Fallback that serves the React app for client-side routing.
 *
 * CRITICAL: never serve index.html for asset-like requests. A stale client
 * (an old service worker, or a CDN/browser-cached index.html) can request a
 * chunk hash that a newer deploy already deleted. Returning index.html
 * (HTTP 200, text/html) for that .js makes the browser's module loader
 * hard-crash with a strict-MIME error → blank white page. Returning a real 404
 * lets the SW's autoUpdate + reload (and the browser's normal error handling)
 * recover cleanly. Only extensionless / non-/assets paths are real SPA routes.
 *
 * That 404 must also never be cached. During a deploy the new index.html can
 * be served while the old container still answers for /assets, so a chunk
 * that is about to exist 404s for a moment — and Cloudflare kept that 404,
 * adding a four-hour browser TTL, after the chunk was there.
 */
export const STATIC_ASSET_RE = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|webmanifest|json|txt|wasm|mp4|webm|mp3|wav)$/i;

export function spaFallback(publicDir) {
  return (req, res) => {
    if (req.path.startsWith("/assets/") || STATIC_ASSET_RE.test(req.path)) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(404).type("text/plain").send("Not found");
    }
    // index.html itself must always revalidate so a new deploy is picked up
    // immediately rather than from a stale browser/edge cache.
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    return res.sendFile(path.join(publicDir, "index.html"));
  };
}
