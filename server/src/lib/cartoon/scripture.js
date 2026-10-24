/**
 * The scripture-only rule for Jesus (spec section 7.2). In BibleFuel-written
 * scripts and in the examples, Jesus speaks only words quoted exactly from the
 * Bible text BibleFuel holds, never invented dialogue.
 *
 * Pure and deterministic. A line counts as quoted when, after both sides are
 * normalised (case, curly quotes, punctuation and spacing), its words appear as
 * a whole-word run inside the verse text. Punctuation is ignored because a
 * line split from a longer verse ends with its own full stop or comma; the
 * words themselves must match exactly.
 */

const JESUS_RE = /^jesus$/i;
const SINGLE_QUOTES_RE = /[‘’‚‛′]/g;
const DOUBLE_QUOTES_RE = /[“”„‟″]/g;
// Anything that is not a letter, a digit, whitespace or a straight apostrophe.
const PUNCTUATION_RE = /[^\p{L}\p{N}\s']/gu;
// An apostrophe that is not between two word characters (a quote mark, not "don't").
const LOOSE_APOSTROPHE_RE = /(?<![\p{L}\p{N}])'|'(?![\p{L}\p{N}])/gu;

/** Lower case, straight quotes, no punctuation (apostrophes inside words kept), single spaces. */
export function normaliseForQuote(text) {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(SINGLE_QUOTES_RE, "'")
    .replace(DOUBLE_QUOTES_RE, '"')
    .replace(PUNCTUATION_RE, " ")
    .replace(LOOSE_APOSTROPHE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether every word of `line` appears, in order and whole, inside `verse` (both already normalised). */
function isQuoted(line, verse) {
  if (line === "") return true;
  return ` ${verse} `.includes(` ${line} `);
}

/** Lines Jesus speaks that are not quoted from `verseText`, as `{ sceneId, text }` with the text as written. */
export function unquotedJesusLines(parsed, verseText) {
  const verse = normaliseForQuote(verseText);
  const found = [];
  for (const scene of parsed?.scenes || []) {
    for (const beat of scene.beats || []) {
      if (beat.kind !== "line" || !JESUS_RE.test(String(beat.speaker || "").trim())) continue;
      if (!isQuoted(normaliseForQuote(beat.text), verse)) found.push({ sceneId: scene.id, text: beat.text });
    }
  }
  return found;
}
