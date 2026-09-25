import crypto from "crypto";
import { toFilterScriptArgs } from "../story/storyRender.js";

/**
 * Bed assembly — turn a handful of short tracks into hours of continuous music.
 *
 * A two-hour session needs more track-minutes than any free library holds, so
 * repetition is a question of *how*, not *whether*. We cycle a shuffled list and
 * reshuffle on every pass, which spreads repeats out instead of looping one file
 * forty times the way Story's `-stream_loop -1` does.
 *
 * The one rule that matters perceptually: never place a track next to itself.
 * A repeat eight minutes later is inaudible as a repeat; the same piece playing
 * twice back to back is the most obvious artefact the format can produce.
 */

/** Deterministic shuffle so tests can pin an order; defaults to Math.random. */
function shuffle(list, rng = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Playing N tracks chained with a d-second crossfade does NOT last sum(durations):
 * each join overlaps by d, so the chain is `sum - (N-1)*d`. Ordering against the
 * raw sum would leave a two-hour bed minutes short.
 *
 * @param {Array<{ durationSec: number }>} chosen
 * @param {number} crossfadeSec
 */
export function chainDurationSec(chosen, crossfadeSec) {
  if (!Array.isArray(chosen) || chosen.length === 0) return 0;
  const sum = chosen.reduce((a, t) => a + (Number(t.durationSec) || 0), 0);
  return sum - (chosen.length - 1) * Number(crossfadeSec || 0);
}

/**
 * Choose a playback order long enough to cover `targetSec`.
 *
 * @param {Array<{ ref: string, file: string, durationSec: number }>} tracks
 * @param {number} targetSec
 * @param {{ crossfadeSec?: number, rng?: () => number, maxTracks?: number }} [opts]
 * @returns {Array<{ ref: string, file: string, durationSec: number }>}
 */
export function orderTracks(tracks, targetSec, { crossfadeSec = 6, rng = Math.random, maxTracks = 400 } = {}) {
  const pool = (tracks || []).filter((t) => Number(t?.durationSec) > 0);
  if (pool.length === 0) return [];

  const chosen = [];
  while (chainDurationSec(chosen, crossfadeSec) < targetSec && chosen.length < maxTracks) {
    let pass = shuffle(pool, rng);
    const last = chosen[chosen.length - 1];
    // Avoid a track butting against itself across the seam between passes.
    // With a single-track pool this is impossible, and repeating is still
    // better than returning a bed that is too short, so we let it through.
    if (last && pass.length > 1 && pass[0].ref === last.ref) {
      [pass[0], pass[1]] = [pass[1], pass[0]];
    }
    for (const t of pass) {
      chosen.push(t);
      if (chainDurationSec(chosen, crossfadeSec) >= targetSec) break;
    }
  }
  return chosen;
}

/**
 * The operator's own order. One pass in the order given, then again from the
 * top until the bed is long enough. A track is never placed straight after
 * itself (the seam of a list that starts and ends with the same track, or the
 * same track listed twice in a row) unless nothing else is left to play.
 *
 * @param {Array<{ ref: string, file: string, durationSec: number }>} tracks
 * @param {number} targetSec
 * @param {{ crossfadeSec?: number, maxTracks?: number }} [opts]
 */
export function fixedOrder(tracks, targetSec, { crossfadeSec = 6, maxTracks = 400 } = {}) {
  const pool = (tracks || []).filter((t) => Number(t?.durationSec) > 0);
  if (pool.length === 0) return [];

  const chosen = [];
  let i = 0;
  let skips = 0;
  while (chainDurationSec(chosen, crossfadeSec) < targetSec && chosen.length < maxTracks) {
    const t = pool[i % pool.length];
    i += 1;
    const last = chosen[chosen.length - 1];
    // After a full pass of skips there is nothing else to play: repeat.
    if (last && skips < pool.length && t.ref === last.ref) {
      skips += 1;
      continue;
    }
    skips = 0;
    chosen.push(t);
  }
  return chosen;
}

/**
 * When each track starts in the assembled bed. A crossfaded chain starts the
 * next track `crossfadeSec` before the previous one ends, so track i begins at
 * sum(durations before it) - i * crossfadeSec. Entries past the target are
 * dropped and the last one is cut to what actually plays.
 *
 * @param {Array<{ ref: string, durationSec: number }>} order
 * @param {number} crossfadeSec
 * @param {number} targetSec
 */
export function trackStarts(order, crossfadeSec, targetSec) {
  const d = Number(crossfadeSec) || 0;
  const out = [];
  let chainEnd = 0;
  for (let i = 0; i < (order || []).length; i += 1) {
    const dur = Number(order[i].durationSec) || 0;
    const startSec = i === 0 ? 0 : chainEnd - d;
    if (startSec >= targetSec) break;
    out.push({ ...order[i], startSec, durationSec: Math.min(dur, targetSec - startSec) });
    chainEnd = startSec + dur;
  }
  return out;
}

/**
 * Cache key for a built bed. Re-rendering an unchanged project must not
 * re-assemble — on a two-hour bed that is minutes of ffmpeg for no change.
 */
// Bumped when the way a bed is built changes, so cached beds built the old
// way are rebuilt rather than reused. v2: tracks levelled to one loudness.
// v3: the operator's own order is part of the key.
const BED_BUILD_VERSION = 3;

export function bedHash({ trackRefs = [], crossfadeSec = 6, targetSec = 0, order = "shuffle" } = {}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ trackRefs, crossfadeSec, targetSec, order, build: BED_BUILD_VERSION }))
    .digest("hex");
}

/**
 * ffmpeg args that chain `files` with crossfades and trim to `targetSec`.
 *
 * Prod runs ffmpeg 5.1, so the graph goes out through `toFilterScriptArgs`
 * rather than an inline `-filter_complex`.
 *
 * @returns {{ args: string[], filter: string, scriptFile: string|null }}
 */
export function buildBedArgs(files, { crossfadeSec = 6, targetSec, outPath, gainsDb = [] }) {
  const list = (files || []).filter(Boolean);
  if (list.length === 0) throw new Error("bed assembly: no tracks to assemble");

  const args = ["-y"];
  for (const f of list) args.push("-i", f);

  const steps = [];
  // Each track to the bed's common loudness first (see loudness.js), so a
  // crossfade never jumps in level. A track already there is left alone.
  const input = list.map((_, i) => {
    const gain = Number(gainsDb[i]) || 0;
    if (Math.abs(gain) < 0.01) return `${i}:a`;
    steps.push(`[${i}:a]volume=${gain.toFixed(2)}dB[g${i}]`);
    return `g${i}`;
  });
  let label = input[0];
  for (let i = 1; i < list.length; i += 1) {
    const next = `x${i}`;
    steps.push(`[${label}][${input[i]}]acrossfade=d=${crossfadeSec}[${next}]`);
    label = next;
  }
  // asetpts rebases timestamps after the chain; without it the trim can land
  // against the source PTS of the last input rather than the chain's own clock.
  steps.push(`[${label}]atrim=0:${targetSec},asetpts=N/SR/TB[aout]`);
  const filter = steps.join(";\n");

  args.push("-filter_complex", filter, "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", outPath);
  const { args: scripted, scriptFile } = toFilterScriptArgs(args, outPath);
  return { args: scripted, filter, scriptFile };
}
