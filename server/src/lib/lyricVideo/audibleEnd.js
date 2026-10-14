// server/src/lib/lyricVideo/audibleEnd.js
/**
 * Where the music stops: the start of a silence that runs to the end of the
 * file. Same rule as ffmpeg's silencedetect (every sample below the threshold
 * for at least the minimum length), worked out on decoded samples so it reuses
 * the beat detector's decoder.
 */
import { decodeMono } from "./beats.js";

export const SILENCE_DB = -40;
export const MIN_SILENCE_SEC = 0.5;
const MEASURE_RATE = 8000;

/** Seconds where the trailing silence starts, or null when there is none (or no sound at all). */
export function trailingSilenceStart(samples, sr, { thresholdDb = SILENCE_DB, minSilenceSec = MIN_SILENCE_SEC } = {}) {
  const threshold = 10 ** (thresholdDb / 20);
  let last = samples.length - 1;
  while (last >= 0 && Math.abs(samples[last]) < threshold) last -= 1;
  if (last < 0) return null;
  const quiet = samples.length - 1 - last;
  return quiet / sr >= minSilenceSec ? (last + 1) / sr : null;
}

/** The song's audible end in seconds, never past durationSec. Rejects when the audio cannot be decoded. */
export async function measureAudibleEnd(file, durationSec, { decode = decodeMono } = {}) {
  const samples = await decode(file, MEASURE_RATE);
  const start = trailingSilenceStart(samples, MEASURE_RATE);
  return start === null ? durationSec : Math.min(start, durationSec);
}
