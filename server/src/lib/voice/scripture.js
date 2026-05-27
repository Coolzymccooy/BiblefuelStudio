/**
 * Scripture-aware text preparation for narration.
 *
 * Makes raw devotional/scripture text read naturally when spoken:
 *   - Bible references expand: "Psalm 91:1" → "Psalm chapter ninety-one, verse one"
 *   - chapter/verse numbers become words
 *   - whitespace is normalized and a terminal period is added for pacing
 *
 * Pure function — no provider/network. Output is plain speech-friendly text
 * (provider-agnostic), so it works whether the chosen TTS provider supports
 * SSML or not.
 *
 * Note for kinetic captions: this rewrites the SPOKEN text, so word-level
 * alignment (and therefore the on-screen words) follows the expanded form —
 * which is what you want for a spoken scripture video.
 */

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * Convert a non-negative integer (0–999) to words. Chapter/verse numbers never
 * exceed this range (Psalm 119; longest verse count is Psalm 119:176). Values
 * outside the range are returned as their plain string.
 *
 * @param {number} n
 * @returns {string}
 */
export function numberToWords(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return String(n);
  if (num < 20) return ONES[num];
  if (num < 100) {
    const t = Math.floor(num / 10);
    const o = num % 10;
    return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
  }
  if (num < 1000) {
    const h = Math.floor(num / 100);
    const rem = num % 100;
    const head = `${ONES[h]} hundred`;
    return rem === 0 ? head : `${head} ${numberToWords(rem)}`;
  }
  return String(num);
}

// Book = optional leading number (1–3) + Capitalized word(s), allowing lowercase
// "of" connectors (Song of Solomon). Followed by chapter:verse and optional
// -endVerse range.
const REFERENCE_RE =
  /((?:[1-3]\s)?[A-Z][a-zA-Z]+(?:\s(?:of\s)?[A-Z][a-zA-Z]+)*)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?/g;

function expandReference(_match, book, chapter, verse, endVerse) {
  const chapterWords = numberToWords(Number(chapter));
  if (endVerse) {
    return `${book} chapter ${chapterWords}, verses ${numberToWords(Number(verse))} to ${numberToWords(Number(endVerse))}`;
  }
  return `${book} chapter ${chapterWords}, verse ${numberToWords(Number(verse))}`;
}

/**
 * Prepare text for spoken narration.
 *
 * @param {string | null | undefined} text
 * @param {{ expandReferences?: boolean }} [opts]
 * @returns {string}
 */
export function prepareScriptureForSpeech(text, opts = {}) {
  let s = String(text ?? "").trim();
  if (!s) return "";

  if (opts.expandReferences !== false) {
    s = s.replace(REFERENCE_RE, expandReference);
  }

  // Normalize spacing for even pacing.
  s = s.replace(/\s+/g, " ").trim();

  // Ensure a terminal mark so the narrator doesn't rush off the end.
  if (s && !/[.!?…:;]$/.test(s)) s += ".";

  return s;
}
