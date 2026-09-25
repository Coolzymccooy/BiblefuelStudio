/**
 * Speech-synced background sequencing for the captioned-video renderer.
 *
 * The legacy multi-background path splits the timeline into N equal slots and
 * hard-cuts between them. This module instead:
 *   1. places the cut points on phrase boundaries (using the caption word
 *      timings) so a background change lands between spoken phrases, not
 *      mid-word; and
 *   2. emits an `xfade` chain so segments crossfade into each other instead of
 *      jump-cutting.
 *
 * The renderer caps the output with `-t durationSec`, so the xfade chain only
 * has to produce AT LEAST `durationSec` of video — we deliberately make each
 * clip a touch longer (so xfade always has tail material to blend) and let the
 * output cap trim the exact length. That removes the brittle "sum of segments
 * minus overlaps must equal duration" arithmetic.
 */

const DEFAULT_TRANSITION_SEC = 0.5;
const DEFAULT_MIN_SEG_SEC = 1.5;

/**
 * Distribute `count` background slots across `durationSec`, snapping each
 * boundary to the nearest phrase start (a word's start time) so cuts feel
 * intentional. Falls back to an even split when there's no usable timing data
 * or snapping would produce a too-short segment.
 *
 * @param {{ words?: {start:number,end:number}[], durationSec: number, count: number, minSegSec?: number }} args
 * @returns {number[]} `count` slot durations (seconds) summing to `durationSec`.
 */
export function computeSyncedSegments({ words, durationSec, count, minSegSec = DEFAULT_MIN_SEG_SEC } = {}) {
  const n = Math.max(1, Math.floor(count) || 1);
  const total = Number(durationSec) || 0;
  const even = () => Array.from({ length: n }, () => total / n);

  if (n < 2 || total <= 0) return even();

  // Candidate cut points: each word's start time, kept clear of the very start
  // and end so we never produce a sliver segment at the edges.
  const candidates = (Array.isArray(words) ? words : [])
    .map((w) => Number(w?.start))
    .filter((t) => Number.isFinite(t) && t > minSegSec && t < total - minSegSec)
    .sort((a, b) => a - b);

  const boundaries = [];
  let lastBoundary = 0;
  for (let k = 1; k < n; k++) {
    const target = (k * total) / n;
    // Nearest candidate that keeps min spacing from the previous boundary.
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (c - lastBoundary < minSegSec) continue;
      if (total - c < minSegSec) continue;
      const dist = Math.abs(c - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    const boundary = best == null ? target : best;
    if (boundary - lastBoundary < minSegSec) return even(); // snapping collapsed a segment
    boundaries.push(boundary);
    lastBoundary = boundary;
  }
  if (total - lastBoundary < minSegSec) return even();

  const segments = [];
  let prev = 0;
  for (const b of boundaries) {
    segments.push(b - prev);
    prev = b;
  }
  segments.push(total - prev);
  return segments;
}

/**
 * Build the pre-drawtext filtergraph that scales each background, trims it to
 * its (speech-synced) slot, and crossfades the slots together into `[vbg]`.
 *
 * @param {{ count:number, segments:number[], w:number, h:number, transitionSec?:number, label?:string }} args
 * @returns {{ chain: string, inputDurations: number[] }}
 *   `chain` ends with `[<label>];` ready to feed the drawtext stage.
 *   `inputDurations` is the per-background source length (for image `-t`).
 */
export function buildCrossfadeChain({ count, segments, w, h, transitionSec = DEFAULT_TRANSITION_SEC, label = "vbg" } = {}) {
  const n = Math.max(2, Math.floor(count));
  const segs = Array.isArray(segments) && segments.length === n
    ? segments.map((s) => Number(s) || 0)
    : Array.from({ length: n }, () => 1);

  // Clamp the transition so it never exceeds half the shortest slot (otherwise
  // a clip would be all-transition and the xfade offset goes negative).
  const shortest = Math.min(...segs);
  const t = Math.max(0.1, Math.min(transitionSec, shortest / 2));

  // Each clip carries its slot + one transition of tail so xfade always has
  // material to blend into the next clip. The final output `-t` trims the
  // small surplus.
  const inputDurations = segs.map((s) => Number((s + t).toFixed(3)));

  const clipParts = segs.map(
    (_, i) =>
      `[${i}:v]trim=duration=${inputDurations[i].toFixed(3)},scale=${w}:${h},setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[c${i}]`,
  );

  // Chain xfades: each transition begins `t` seconds before the running
  // composite ends, blending into the next clip.
  const xfadeParts = [];
  let prevLabel = "[c0]";
  let accLen = inputDurations[0];
  for (let i = 1; i < n; i++) {
    const offset = Math.max(0, accLen - t);
    const out = i === n - 1 ? `[${label}]` : `[x${i}]`;
    xfadeParts.push(`${prevLabel}[c${i}]xfade=transition=fade:duration=${t.toFixed(3)}:offset=${offset.toFixed(3)}${out}`);
    prevLabel = out;
    accLen = accLen + inputDurations[i] - t;
  }

  const chain = `${[...clipParts, ...xfadeParts].join(";")};`;
  return { chain, inputDurations };
}
