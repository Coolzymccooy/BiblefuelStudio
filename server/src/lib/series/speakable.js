/**
 * Build a short, narration-ready excerpt from a list of verses.
 *
 * Why this exists:
 *  - A 22-second short can only narrate ~60-90 words. The full verse range
 *    in a Series segment can be 1000+ chars (e.g. John 3:23-36) which
 *    overruns the duration AND produces a `filter_complex` graph that
 *    blows past Windows' command-line limit (`spawn ENAMETOOLONG`) when
 *    ElevenLabs returns word-level alignment.
 *  - The full passage still lives in the social caption + YouVersion link,
 *    so we're not losing information — only choosing what's spoken.
 *
 * Algorithm:
 *  - Greedily concatenate whole verses while staying under `maxChars`.
 *  - If the FIRST verse alone exceeds the budget, trim at the nearest
 *    word boundary (no mid-word cuts) and append an ellipsis.
 *  - Whitespace is collapsed so the renderer doesn't choke on newlines.
 *
 * Pure function — no I/O.
 */

/** @typedef {{ verse: number, text: string }} VerseLike */

const MIN_BOUNDARY_RATIO = 0.6;

/**
 * @param {VerseLike[]} verses
 * @param {number} maxChars
 * @returns {string}
 */
export function extractSpeakableVerseText(verses, maxChars) {
  const cap = Math.max(40, Number(maxChars) || 280);
  if (!Array.isArray(verses) || verses.length === 0) return "";

  let acc = "";
  for (const v of verses) {
    const piece = String(v?.text || "").replace(/\s+/g, " ").trim();
    if (!piece) continue;

    const candidate = acc ? `${acc} ${piece}` : piece;
    if (candidate.length <= cap) {
      acc = candidate;
      continue;
    }

    if (!acc) {
      // First verse alone overflows: trim at the nearest word boundary.
      const cut = piece.slice(0, cap - 1);
      const lastSpace = cut.lastIndexOf(" ");
      const safe = lastSpace > cap * MIN_BOUNDARY_RATIO
        ? cut.slice(0, lastSpace)
        : cut;
      acc = `${safe.replace(/[\s,;:]+$/, "")}…`;
    }
    break;
  }
  return acc;
}
