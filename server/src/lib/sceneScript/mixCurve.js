/**
 * Music automation for scene-script renders, in composition seconds. Shared
 * by the Remotion composition (which calls it per frame) and the tests.
 * Ducking is computed from the known line times, so it is exact and
 * testable; there is no sidechain compressor.
 */

export const DUCK = 0.32;
export const CHANT_DUCK = 0.55;
export const FADE_IN_SEC = 1.8;
export const FADE_OUT_SEC = 2.2;

const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

/** 1 while nobody speaks, down to DUCK under a line (CHANT_DUCK under a chant), with soft edges. */
export function duckAt(t, lines) {
  let level = 1;
  for (const l of lines) {
    const s = l.start;
    const e = l.start + l.dur;
    if (t < s - 0.3 || t > e + 0.5) continue;
    const depth = l.kind === "chant" ? CHANT_DUCK : DUCK;
    const amount = Math.min(ramp(t, s - 0.3, s - 0.05), 1 - ramp(t, e + 0.1, e + 0.5));
    level = Math.min(level, 1 - (1 - depth) * amount);
  }
  return level;
}

/** Silence from the end of the line before the drop until the hit, then a short lift. */
export function dropGate(t, drop) {
  if (!drop) return 1;
  const { from, to } = drop;
  if (t < from - 0.05) return 1;
  if (t < from + 0.2) return 1 - ramp(t, from - 0.05, from + 0.2);
  if (t < to) return 0;
  return 1 + 0.25 * (1 - ramp(t, to, to + 2.5));
}

/**
 * @param {{ base: number, from: number, to: number, first?: boolean, gated?: boolean }} section
 * @param {number} t composition seconds
 */
export function musicVolume(section, t, lines, drop) {
  const fadeIn = ramp(t, section.from, section.from + (section.first ? 1.2 : FADE_IN_SEC));
  const fadeOut = 1 - ramp(t, section.to - FADE_OUT_SEC, section.to);
  const gate = section.gated ? dropGate(t, drop) : 1;
  return Math.min(1, section.base * fadeIn * fadeOut * duckAt(t, lines) * gate);
}

/** How loud a cue's bed sits, from its mood: quiet for reflection, full for victory. */
export function baseLevel(mood) {
  const m = String(mood || "");
  if (/victor|triumph|declar|glory|anthem|bold/i.test(m)) return 0.72;
  if (/soft|piano|gentle|intimate|reflect|emotional|peace|final/i.test(m)) return 0.5;
  return 0.55;
}
