/**
 * Build a Ken Burns (slow zoom) ffmpeg filter substring for an image scene.
 *
 * Returned string is a drop-in replacement for the `scale=W:H` step of an
 * image input: it upscales first (so zoompan has pixels to pan into without
 * shimmer), then zooms in gently from 1.0 to ~1.06 across the scene.
 *
 * @param {number} width   output canvas width
 * @param {number} height  output canvas height
 * @param {number} durSec  scene duration in seconds
 * @param {number} [fps=30]
 * @returns {string} e.g. "scale=2160:3840,zoompan=z='min(zoom+0.0006,1.06)':d=150:s=1080x1920:fps=30"
 */
export function kenBurnsFilter(width, height, durSec, fps = 30) {
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  const rate = Math.max(1, Math.round(Number(fps) || 30));
  const frames = Math.max(1, Math.round((Number(durSec) || 0) * rate));
  const upW = w * 2;
  const upH = h * 2;
  const zoom = `'min(zoom+0.0006,1.06)'`;
  return `scale=${upW}:${upH},zoompan=z=${zoom}:d=${frames}:s=${w}x${h}:fps=${rate}`;
}
