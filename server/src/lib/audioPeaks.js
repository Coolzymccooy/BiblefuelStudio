import crypto from "node:crypto";

/**
 * Audio peaks for the timeline's waveform traces.
 *
 * The existing GET /waveform.png renders a raster with ffmpeg's showwavespic.
 * That is fine for a one-off preview but fights the timeline: every zoom step
 * would re-request an image, and a stretched PNG looks wrong. Peaks as JSON
 * are drawn to a canvas instead, so zoom costs nothing and the trace takes its
 * colour from the lane's own ink in whichever theme is on.
 */

/**
 * Buckets per asset. 1024 pairs is ~16KB of JSON — small enough to cache and
 * ship, dense enough that an 8x zoom still has more detail than the clip has
 * pixels.
 */
export const PEAK_BUCKETS = 1024;

/**
 * Downsample signed 16-bit mono PCM to [min, max] pairs normalised to -1..1.
 *
 * Min AND max per bucket, not an average: averaging hides a clipped transient,
 * which is precisely what an operator scanning a waveform is looking for.
 */
export function downsamplePeaks(pcmBuffer, buckets = PEAK_BUCKETS) {
  const count = Math.max(1, Math.floor(buckets));
  const peaks = new Array(count);

  // Two bytes per sample. A truncated stream must not shift every subsequent
  // sample by one byte, which would turn the trace into noise.
  const totalSamples = Math.floor((pcmBuffer?.length || 0) / 2);
  if (totalSamples === 0) {
    for (let i = 0; i < count; i += 1) peaks[i] = [0, 0];
    return peaks;
  }

  const perBucket = totalSamples / count;

  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * perBucket);
    const end = Math.min(totalSamples, Math.max(start + 1, Math.floor((i + 1) * perBucket)));

    let min = 0;
    let max = 0;
    let seen = false;
    for (let s = start; s < end; s += 1) {
      const v = pcmBuffer.readInt16LE(s * 2);
      if (!seen) {
        min = v;
        max = v;
        seen = true;
      } else {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }

    // 32768 so a full-scale negative sample maps to exactly -1.
    peaks[i] = seen ? [min / 32768, max / 32768] : [0, 0];
  }

  return peaks;
}

/**
 * Cache key for an asset's peaks, from its size and mtime.
 *
 * Re-encoding a file in place keeps its name, so the name alone is not enough
 * — the trace would stay stale. Size plus mtime catches both an edit and a
 * replacement.
 */
export function peaksCacheKey({ size, mtimeMs }) {
  return crypto
    .createHash("sha1")
    .update(`${Number(size) || 0}:${Math.round(Number(mtimeMs) || 0)}`)
    .digest("base64url");
}
