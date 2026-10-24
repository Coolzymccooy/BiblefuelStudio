/**
 * Cache headers for media the server hands to browsers.
 *
 * Video/audio MUST be range-served (esp. iOS Safari + QuickTime, which refuse
 * to play without a 206 and show the broken-play icon or nothing at all). The
 * origin honours Range correctly (res.sendFile / express.static both emit
 * 206), but Cloudflare's shared cache stores these as chunked 200s and then
 * answers Range requests with a full 200, so iOS breaks while desktop and
 * Android (which tolerate a plain 200) still play. Marking range-sensitive
 * media `private` keeps Cloudflare's SHARED cache from storing them, so it
 * proxies the request through and the origin's 206 reaches the device.
 * Browsers still cache (private allows the local cache). Images don't need
 * ranges, so they stay `public` and edge-cacheable.
 *
 * `no-transform` stops Cloudflare (or any proxy) gzipping the body, which
 * forces chunked transfer and also strips Range support.
 */

const RANGE_MEDIA_RE = /\.(mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg)$/i;

export function isRangeMedia(name) {
  return RANGE_MEDIA_RE.test(String(name || ""));
}

export function cacheControlForOutput(name) {
  return isRangeMedia(name)
    ? "private, max-age=86400, no-transform"
    : "public, max-age=86400, no-transform";
}

/**
 * express.static `setHeaders` for the public bundle: media that ships with
 * the client (the Moments style previews) gets the same range-safe headers
 * as rendered outputs. Everything else keeps express.static's defaults.
 */
export function publicAssetHeaders(res, filePath) {
  if (!isRangeMedia(filePath)) return;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", cacheControlForOutput(filePath));
}

/**
 * Headers every /outputs response carries. The files there include ones pulled
 * from outside URLs, so a browser must never sniff one into HTML, and if a
 * document is ever opened top-level it runs sandboxed (no script, unique
 * origin). A CSP on a media response does not affect <video>/<audio>/<img>
 * embedding, nor the browser's own viewer when a file is opened in a tab.
 */
export function setOutputSafetyHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
}
