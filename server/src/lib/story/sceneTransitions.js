// Scene-to-scene transitions for the story renderer.
//
// The renderer previously used `concat`, giving a HARD CUT between every scene.
// Across 25-40 stills that reads as a slideshow rather than a film. FFmpeg's
// `xfade` crossfades instead, which is the single cheapest upgrade to how
// finished videos feel.
//
// THE TIMING TRAP
//
// xfade OVERLAPS its two inputs: feeding it clips of a and b seconds with a
// transition of d yields (a + b - d), not (a + b). Chaining N scenes therefore
// loses (N-1) * d seconds overall. Since scene timing is derived from the
// narration audio, that drift would desynchronise captions and voice — the
// video would end before the audio does.
//
// So each scene (except the last) is EXTENDED by the transition duration. The
// extra frames are exactly what the crossfade consumes, and total runtime is
// preserved. buildXfadeChain returns the padded durations for the caller to
// feed into Ken Burns, so the zoom still spans the full padded clip.

// Kept short: a long dissolve on a still image reads as a mistake rather than
// a choice. 0.5s is a documentary-standard gentle blend.
export const DEFAULT_TRANSITION_SEC = 0.5;

/**
 * Longest transition that is safe for a given pair of scenes.
 *
 * A transition cannot be longer than the shorter clip, or xfade produces
 * garbage/errors. Very short scenes therefore get a proportionally shorter
 * crossfade rather than being skipped, so pacing stays even.
 *
 * @param {number} durA seconds
 * @param {number} durB seconds
 * @param {number} desired seconds
 * @returns {number} clamped transition duration, >= 0
 */
export function safeTransitionSec(durA, durB, desired = DEFAULT_TRANSITION_SEC) {
  const a = Number(durA) || 0;
  const b = Number(durB) || 0;
  const want = Math.max(0, Number(desired) || 0);
  if (a <= 0 || b <= 0) return 0;
  // Never consume more than a third of either neighbour: past that the image
  // barely holds still and the sequence feels like a permanent dissolve.
  const ceiling = Math.min(a, b) / 3;
  return Number(Math.min(want, ceiling).toFixed(3));
}

/**
 * Build the xfade filter chain for a scene sequence.
 *
 * @param {Array<{durationSec:number}>} segs scene segments in order
 * @param {{transitionSec?:number, transition?:string}} [opts]
 * @returns {{
 *   paddedDurations: number[],
 *   filters: string[],
 *   outLabel: string,
 *   transitions: Array<{index:number, durationSec:number, offsetSec:number}>
 * }}
 */
export function buildXfadeChain(segs, { transitionSec = DEFAULT_TRANSITION_SEC, transition = "fade" } = {}) {
  const list = Array.isArray(segs) ? segs : [];
  if (list.length === 0) return { paddedDurations: [], filters: [], outLabel: "", transitions: [] };

  // One scene: nothing to cross into.
  if (list.length === 1) {
    return {
      paddedDurations: [Number(list[0].durationSec) || 0],
      filters: [],
      outLabel: "[s0]",
      transitions: [],
    };
  }

  // Work out each junction's transition first — padding depends on it.
  const transitions = [];
  for (let i = 0; i < list.length - 1; i += 1) {
    const d = safeTransitionSec(list[i].durationSec, list[i + 1].durationSec, transitionSec);
    transitions.push({ index: i, durationSec: d, offsetSec: 0 });
  }

  // Pad every scene except the last by the transition that FOLLOWS it, so the
  // overlap consumes borrowed frames instead of real screen time.
  const paddedDurations = list.map((seg, i) => {
    const base = Number(seg.durationSec) || 0;
    const pad = i < transitions.length ? transitions[i].durationSec : 0;
    return Number((base + pad).toFixed(3));
  });

  // xfade offset is measured on the ACCUMULATED timeline of the chain so far.
  // After each junction the running length grows by the next scene's ORIGINAL
  // duration (the pad is exactly what the crossfade ate).
  const filters = [];
  let prevLabel = "[s0]";
  let elapsed = Number(list[0].durationSec) || 0;
  for (let i = 0; i < transitions.length; i += 1) {
    const t = transitions[i];
    t.offsetSec = Number(elapsed.toFixed(3));
    const outLabel = i === transitions.length - 1 ? "[vcat]" : `[x${i}]`;
    filters.push(
      `${prevLabel}[s${i + 1}]xfade=transition=${transition}:duration=${t.durationSec}:offset=${t.offsetSec}${outLabel}`,
    );
    prevLabel = outLabel;
    elapsed += Number(list[i + 1].durationSec) || 0;
  }

  return { paddedDurations, filters, outLabel: "[vcat]", transitions };
}
