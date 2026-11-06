/**
 * Provider-agnostic caption contract: { audioPath, words: [{text,startMs,endMs}] }.
 * Reject invalid sources as a whole rather than returning a misleading subset.
 * Structural validation is NOT transcript coverage: well-formed subsets still
 * pass. Acoustic alignment and matching against the complete script are unresolved.
 */

/** @typedef {{text: string, startMs: number, endMs: number}} WordTiming */
/** @typedef {{audioPath: string, words: WordTiming[]}} AlignmentContract */

function validWindow(start, end, positive = true) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 &&
    (positive ? end > start : end >= start);
}

function validWords(words) {
  if (!Array.isArray(words) || words.length === 0) return false;
  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  for (const word of words) {
    if (typeof word?.text !== "string" || !word.text.trim() ||
        !validWindow(word.startMs, word.endMs) ||
        word.startMs < previousStart || word.endMs < previousEnd) return false;
    previousStart = word.startMs;
    previousEnd = word.endMs;
  }
  return true;
}

/**
 * Group character timing (seconds) on whitespace, retaining Unicode/punctuation.
 * Starts and ends must each be nondecreasing. Provider overlaps are allowed;
 * backwards timing is not. Zero-duration characters/spaces are allowed only if
 * each resulting word has a positive window. No coercion, padding or rounding.
 * @param {{characters?: string[], starts?: number[], ends?: number[]}|null|undefined} alignment
 * @returns {WordTiming[]}
 */
export function charAlignmentToWords(alignment) {
  const { characters, starts, ends } = alignment ?? {};
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends) ||
      characters.length === 0 || starts.length !== characters.length ||
      ends.length !== characters.length) return [];

  const words = [];
  let current = null;
  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  const flush = () => {
    if (current) words.push(current);
    current = null;
  };
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    const start = starts[i];
    const end = ends[i];
    if (typeof ch !== "string" || ch.length === 0 ||
        !validWindow(start, end, false) || start < previousStart || end < previousEnd ||
        // Keep UTF-16 units, code points and graphemes; mixed text/space chunks
        // cannot be split without inventing character timings.
        (/\s/u.test(ch) && !/^\s+$/u.test(ch))) return [];
    previousStart = start;
    previousEnd = end;
    if (/^\s+$/u.test(ch)) {
      flush();
    } else if (!current) {
      current = { text: ch, startMs: start * 1000, endMs: end * 1000 };
    } else {
      current.text += ch;
      current.endMs = end * 1000;
    }
  }
  flush();
  // Reject conversion overflow and zero-width words as well.
  return validWords(words) ? words : [];
}

/**
 * Valid native words take priority, retaining trusted objects/numeric values.
 * Empty/invalid native words must not mask usable character timing.
 * @param {{file?: string, words?: WordTiming[], alignment?: object}|null|undefined} result
 * @returns {AlignmentContract}
 */
export function toAlignmentContract(result) {
  const audioPath = result?.file ?? "";
  const words = validWords(result?.words)
    ? result.words
    : charAlignmentToWords(result?.alignment);
  return { audioPath, words };
}
