// Word-level caption helpers. Converts ElevenLabs character-level alignment
// into word-level timing data the FFmpeg renderer can consume, and picks a
// keyword per line to emphasize.

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "of", "to", "for", "in", "on", "at",
  "by", "with", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "i", "you", "he", "she", "we", "they", "it",
  "my", "your", "his", "her", "our", "their", "its", "me", "him", "us", "them",
  "do", "does", "did", "have", "has", "had", "will", "would", "shall", "should",
  "can", "could", "may", "might", "must", "not", "no", "yes", "so", "than", "then",
  "there", "here", "when", "where", "why", "how", "what", "who", "which",
  "into", "out", "up", "down", "over", "under", "about", "any", "all", "some",
  "more", "less", "most", "least", "very", "just", "only", "also", "too",
]);

const WORD_CHAR = /[A-Za-z0-9']/;

/**
 * Group character-level alignment into word-level alignment. Whitespace and
 * punctuation become word boundaries. Returned ranges are in seconds.
 *
 * @param {{ characters: string[], starts: number[], ends: number[] }} alignment
 * @returns {Array<{ text: string, start: number, end: number }>}
 */
export function charsToWords(alignment) {
  const characters = Array.isArray(alignment?.characters) ? alignment.characters : [];
  const starts = Array.isArray(alignment?.starts) ? alignment.starts : [];
  const ends = Array.isArray(alignment?.ends) ? alignment.ends : [];
  if (characters.length === 0 || starts.length === 0 || ends.length === 0) return [];

  const out = [];
  let buf = "";
  let bufStart = 0;
  let bufEnd = 0;

  const flush = () => {
    if (!buf) return;
    out.push({ text: buf, start: bufStart, end: Math.max(bufEnd, bufStart + 0.05) });
    buf = "";
  };

  for (let i = 0; i < characters.length; i++) {
    const ch = String(characters[i] ?? "");
    const start = Number(starts[i]);
    const end = Number(ends[i]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (WORD_CHAR.test(ch)) {
      if (!buf) bufStart = start;
      buf += ch;
      bufEnd = end;
    } else {
      flush();
    }
  }
  flush();
  return out;
}

/**
 * Bridge the unified word-alignment contract into the caption word shape.
 *
 * The contract (e.g. Azure WordBoundary, via voice/alignmentContract.js) carries
 * `{ text, startMs, endMs }` in milliseconds. The caption pipeline downstream
 * (annotateEmphasis / groupWordsByBeat / ffmpeg drawtext) consumes
 * `{ text, start, end }` in seconds. Empty/whitespace tokens are dropped and a
 * minimum 50ms duration is enforced (mirrors charsToWords) so drawtext enable
 * windows never collapse.
 *
 * @param {Array<{ text: string, startMs: number, endMs: number }>} words
 * @returns {Array<{ text: string, start: number, end: number }>}
 */
export function captionWordsFromNativeWords(words) {
  if (!Array.isArray(words)) return [];
  const out = [];
  for (const w of words) {
    const text = String(w?.text ?? "").trim();
    if (!text) continue;
    const start = Number(w?.startMs);
    const endRaw = Number(w?.endMs);
    if (!Number.isFinite(start)) continue;
    const startSec = start / 1000;
    const endSec = Number.isFinite(endRaw) ? endRaw / 1000 : startSec;
    out.push({ text, start: startSec, end: Math.max(endSec, startSec + 0.05) });
  }
  return out;
}

/**
 * Pick the most "emphasizable" word from a line. Heuristic: longest
 * non-stopword (≥4 chars). Falls back to the longest word, then to the first.
 *
 * Returns the lowercased canonical form. Caller compares case-insensitively.
 *
 * @param {string} line
 * @returns {string | null}
 */
export function pickKeyword(line) {
  const tokens = String(line || "").split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9']/g, "")).filter(Boolean);
  if (tokens.length === 0) return null;
  const candidates = tokens.filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()));
  const pool = candidates.length > 0 ? candidates : tokens;
  const best = pool.reduce((acc, w) => (w.length > acc.length ? w : acc), "");
  return best ? best.toLowerCase() : null;
}

/**
 * Annotate a flat list of word-timings with `emphasize: true` on the keyword
 * of each sentence/line break. Sentence boundary = words inside one of the
 * provided `lines` strings, matched greedily by sequence order.
 *
 * If `lines` is not provided, treats the whole list as one sentence.
 *
 * @param {Array<{ text: string, start: number, end: number }>} words
 * @param {string[]} [lines]
 * @returns {Array<{ text: string, start: number, end: number, emphasize?: boolean }>}
 */
export function annotateEmphasis(words, lines) {
  if (!Array.isArray(words) || words.length === 0) return [];
  if (!Array.isArray(lines) || lines.length === 0) {
    const keyword = pickKeyword(words.map((w) => w.text).join(" "));
    return words.map((w) => ({ ...w, emphasize: keyword != null && w.text.toLowerCase() === keyword }));
  }

  // Walk through lines, picking a keyword per line and tagging the first
  // matching word from the remaining word list.
  const annotated = words.map((w) => ({ ...w }));
  let cursor = 0;
  for (const line of lines) {
    const lineWords = String(line || "").split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9']/g, "").toLowerCase()).filter(Boolean);
    if (lineWords.length === 0) continue;
    const keyword = pickKeyword(line);
    if (!keyword) {
      cursor += lineWords.length;
      continue;
    }
    const sliceEnd = Math.min(cursor + lineWords.length + 6, annotated.length);
    for (let i = cursor; i < sliceEnd; i++) {
      if (annotated[i].text.toLowerCase() === keyword) {
        annotated[i].emphasize = true;
        break;
      }
    }
    cursor += lineWords.length;
  }
  return annotated;
}

/**
 * Group word-timings into beat segments aligned to logical script sections
 * (hook / verse / reflection / cta). Used by the scene splitter to know
 * when to crossfade backgrounds.
 *
 * @param {Array<{ text: string, start: number, end: number }>} words
 * @param {string[]} lines  one line per beat
 * @returns {Array<{ line: string, start: number, end: number, words: Array<any> }>}
 */
export function groupWordsByBeat(words, lines) {
  if (!Array.isArray(words) || words.length === 0) return [];
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const beats = [];
  let cursor = 0;
  for (const line of lines) {
    const lineWords = String(line || "").split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9']/g, "").toLowerCase()).filter(Boolean);
    if (lineWords.length === 0) continue;
    const take = Math.min(lineWords.length, Math.max(0, words.length - cursor));
    if (take <= 0) break;
    const slice = words.slice(cursor, cursor + take);
    const start = slice[0]?.start ?? 0;
    const end = slice[slice.length - 1]?.end ?? start;
    beats.push({ line, start, end, words: slice });
    cursor += take;
  }
  return beats;
}
