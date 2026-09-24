import fs from "fs";
import { spawn } from "child_process";

/**
 * Track loudness for the music bed.
 *
 * Crossfading a quiet piano track into a loud worship mix is audible as a
 * jump in level, and on a two-hour bed it happens a dozen times. Each track is
 * measured once (EBU R128 integrated loudness and true peak, via ffmpeg's
 * loudnorm in analysis mode) and given one fixed gain to a common level.
 *
 * A fixed gain, not loudnorm's dynamic mode: this is music, and a track's own
 * rise and fall is the point of it. Only its overall level moves.
 */

/** A calm bed sits below broadcast loudness, leaving room over it for the voice. */
export const BED_TARGET_LUFS = -18;
/** A lift stops short of this true peak, so levelling never clips. */
const PEAK_CEILING_DBTP = -1.5;
const MAX_BOOST_DB = 12;
const MAX_CUT_DB = 18;

/** Integrated loudness and true peak from loudnorm's JSON report, or null. */
export function parseLoudnorm(stderr) {
  const json = String(stderr || "").match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!json) return null;
  try {
    const r = JSON.parse(json[0]);
    const inputI = Number(r.input_i);
    const inputTp = Number(r.input_tp);
    // Silence measures as -inf; there is nothing to level.
    if (!Number.isFinite(inputI) || !Number.isFinite(inputTp)) return null;
    return { inputI, inputTp };
  } catch {
    return null;
  }
}

/** The gain (dB) that brings a measured track to the bed's level without clipping it. */
export function gainToTargetDb(measured) {
  if (!measured) return 0;
  let gain = BED_TARGET_LUFS - measured.inputI;
  gain = Math.min(gain, PEAK_CEILING_DBTP - measured.inputTp);
  gain = Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, gain));
  return Math.round(gain * 100) / 100;
}

/** A ten-minute track measures in seconds; this is a stuck or hostile file. */
const MEASURE_TIMEOUT_MS = 5 * 60_000;

function runLoudnorm(file) {
  return new Promise((resolve, reject) => {
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const proc = spawn(ff, [
      "-hide_banner", "-nostats", "-i", file, "-vn",
      "-af", "loudnorm=print_format=json", "-f", "null", "-",
    ], { windowsHide: true });
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* gone */ }
      reject(new Error("loudness measurement timed out"));
    }, MEASURE_TIMEOUT_MS);
    let err = "";
    proc.stderr.on("data", (d) => { err = (err + d.toString()).slice(-8000); });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`loudnorm exited ${code}`));
    });
  });
}

// Keyed by path, size and mtime, so a replaced upload is measured again.
// Failures are remembered too (as null): a track that can't be measured is
// not decoded in full again on every render. Bounded, oldest out first.
const cache = new Map();
const CACHE_LIMIT = 1000;
export function _clearLoudnessCache() { cache.clear(); }

function cacheKey(file) {
  try {
    const st = fs.statSync(file);
    return `${file}|${st.size}|${st.mtimeMs}`;
  } catch {
    return file;
  }
}

/**
 * Measure a track once. Null when it can't be measured: the track then plays
 * at its own level rather than failing the bed.
 *
 * @param {string} file
 * @param {{ run?: (file: string) => Promise<string> }} [deps]
 */
export async function measureLoudness(file, { run = runLoudnorm } = {}) {
  const key = cacheKey(file);
  if (cache.has(key)) return cache.get(key);
  let measured = null;
  try {
    measured = parseLoudnorm(await run(file));
  } catch {
    measured = null;
  }
  cache.set(key, measured);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return measured;
}
