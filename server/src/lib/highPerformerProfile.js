// High-performer posting profile.
//
// Derived from the operator's own @Biblefuel grid (~100+ posts, Aug 2026), not
// from generic advice. Two patterns separated the top posts from the rest:
//
//   1. SINGLE HERO WORD, not paragraphs. The top posts (486, 452, 436, 342
//      plays) burn one large word over cinematic footage. The weakest (~140-180)
//      burn the whole verse + reflection + CTA as a wall of text.
//   2. PROBLEM-LED words. Every top performer leads with the ache, not the
//      comfort: "chaos", "overwhelmed", "surrounds", "crash". These map to the
//      `fear` category in emphasisLexicon.
//
// This is CORRELATION from one account's sample, not a law of the platform.
// It is expressed as a switchable profile so it can be turned off if the
// pattern stops holding — see HIGH_PERFORMER_PROFILE.enabled at the call site.

// scriptType values that produce problem-led openings, weighted for rotation.
// Rotating these is what widens the hook space: the campaign path previously
// pinned scriptType to the "peace" default on every single run.
export const PROBLEM_LED_SCRIPT_TYPES = Object.freeze([
  "anxiety",     // fear, worry, overthinking
  "healing",     // grief, brokenness
  "strength",    // battles, weariness
  "prayer",      // waiting, unanswered
  "peace",       // storms
  "forgiveness", // guilt, failure
  "identity",    // not enough, unseen
  "purpose",     // feeling behind, lost direction
]);

// Caption ceiling. The wall-of-text posts in the grid ran the full verse plus
// reflection plus CTA on screen at once. Past roughly this many characters the
// overlay stops being readable at thumbnail size.
export const MAX_ONSCREEN_CHARS = 90;

/**
 * Deterministically pick the next script type in the rotation.
 *
 * Deterministic (not random) so a given run index always yields the same type:
 * schedules stay reproducible and testable, and a morning/night pair never
 * silently collides on the same bucket.
 *
 * @param {number} index monotonically increasing run counter
 * @returns {string} a scriptType understood by generateScripts
 */
export function pickScriptType(index) {
  const n = Number(index);
  if (!Number.isFinite(n)) return PROBLEM_LED_SCRIPT_TYPES[0];
  const i = Math.abs(Math.trunc(n)) % PROBLEM_LED_SCRIPT_TYPES.length;
  return PROBLEM_LED_SCRIPT_TYPES[i];
}

/**
 * True when on-screen text is short enough to read at thumbnail size.
 * @param {string} text
 */
export function isReadableOnscreen(text) {
  return String(text || "").trim().length <= MAX_ONSCREEN_CHARS;
}

/**
 * Trim overlay text to the readable ceiling, breaking on a word boundary so a
 * word is never sliced in half. Returns the input unchanged when already short.
 * @param {string} text
 * @returns {string}
 */
export function trimToReadable(text) {
  const s = String(text || "").trim();
  if (s.length <= MAX_ONSCREEN_CHARS) return s;
  const cut = s.slice(0, MAX_ONSCREEN_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}
