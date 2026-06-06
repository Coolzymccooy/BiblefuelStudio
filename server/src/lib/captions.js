// Word-level caption helpers. Converts ElevenLabs character-level alignment
// into word-level timing data the FFmpeg renderer can consume, and picks a
// keyword per line to emphasize.

import { scoreWord } from "./emphasisLexicon.js";

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

/** Normalize a token the same way the lexicon/keyword logic does. */
function normToken(text) {
  return String(text ?? "").replace(/[^A-Za-z0-9']/g, "").toLowerCase();
}

/**
 * Slice a flat word list into per-phrase index ranges. With `lines`, each line
 * is one phrase and words are assigned greedily by sequence (the same cursor
 * walk annotateEmphasis uses). Without `lines`, the whole list is one phrase.
 *
 * @returns {Array<[number, number]>} [startIndex, endIndexExclusive] per phrase
 */
function phraseRanges(words, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return [[0, words.length]];
  const ranges = [];
  let cursor = 0;
  for (const line of lines) {
    const count = String(line || "").split(/\s+/).map(normToken).filter(Boolean).length;
    if (count === 0) continue;
    const start = cursor;
    const end = Math.min(cursor + count, words.length);
    if (end > start) ranges.push([start, end]);
    cursor = end;
    if (cursor >= words.length) break;
  }
  // Any words past the last line (alignment drift) join the final phrase.
  if (ranges.length > 0 && cursor < words.length) {
    ranges[ranges.length - 1][1] = words.length;
  }
  return ranges;
}

/**
 * Annotate word-timings with a 3-tier emphasis `level`:
 *   "hero"   — the single highest-scoring lexicon word in the phrase
 *   "key"    — other lexicon hits, or (when nothing scores) the longest-word
 *              fallback so every phrase still gets one emphasized word
 *   "normal" — everything else
 *
 * `emphasize: true` is also set for hero+key so the existing FFmpeg drawtext
 * path and older callers keep working unchanged. Returns NEW objects.
 *
 * @param {Array<{ text: string, start: number, end: number }>} words
 * @param {string[]} [lines]  one phrase per line; omit to treat all as one
 * @returns {Array<{ text, start, end, level: "normal"|"key"|"hero", emphasize: boolean }>}
 */
export function annotateEmphasisTiers(words, lines) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const out = words.map((w) => ({ ...w, level: "normal", emphasize: false }));

  for (const [start, end] of phraseRanges(words, lines)) {
    let heroIdx = -1;
    let heroScore = 0;
    let anyHit = false;
    for (let i = start; i < end; i++) {
      const score = scoreWord(out[i].text);
      if (score > 0) {
        anyHit = true;
        out[i].level = "key";
        out[i].emphasize = true;
        if (score > heroScore) {
          heroScore = score;
          heroIdx = i; // first occurrence of the max (strict >)
        }
      }
    }
    if (heroIdx >= 0) {
      out[heroIdx].level = "hero";
    } else if (!anyHit) {
      // No lexicon score in this phrase → fall back to the longest-word keyword
      // (legacy behaviour) and tag the first matching word as the lone key.
      const phraseText = out.slice(start, end).map((w) => w.text).join(" ");
      const keyword = pickKeyword(phraseText);
      if (keyword) {
        for (let i = start; i < end; i++) {
          if (normToken(out[i].text) === keyword) {
            out[i].level = "key";
            out[i].emphasize = true;
            break;
          }
        }
      }
    }
  }
  return out;
}

const TERMINAL_PUNCT = /[.,;:!?]$/;

/**
 * Split a flat list of timed words into short "emotional" phrases for kinetic
 * display. A phrase ends when: the word/char limit would be exceeded by the
 * next word, or the current word ends in terminal punctuation. Each phrase
 * carries its member words plus aggregate start/end timing.
 *
 * @param {Array<{ text: string, start: number, end: number }>} words
 * @param {{ maxWords?: number, maxChars?: number }} [opts]
 * @returns {Array<{ text: string, start: number, end: number, words: Array<any> }>}
 */
export function splitPhrases(words, opts = {}) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const maxWords = Number.isFinite(opts.maxWords) ? opts.maxWords : 3;
  const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 22;

  const phrases = [];
  let current = [];
  let charLen = 0;

  const flush = () => {
    if (current.length === 0) return;
    phrases.push({
      text: current.map((w) => w.text).join(" "),
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
    current = [];
    charLen = 0;
  };

  for (const word of words) {
    const text = String(word?.text ?? "");
    const addLen = current.length === 0 ? text.length : charLen + 1 + text.length;
    const wouldOverflow =
      current.length > 0 && (current.length + 1 > maxWords || addLen > maxChars);
    if (wouldOverflow) flush();

    current.push(word);
    charLen = current.length === 1 ? text.length : charLen + 1 + text.length;

    if (TERMINAL_PUNCT.test(text.trim())) flush();
  }
  flush();
  return phrases;
}

/**
 * Render-path helper: chunk a flat word stream into micro-phrases, then
 * annotate 3-tier emphasis so each short on-screen phrase gets one hero word
 * (rather than one hero per long beat-line). This is what the kinetic caption
 * pipeline calls in place of the legacy annotateEmphasis.
 *
 * @param {Array<{ text: string, start: number, end: number }>} words
 * @param {{ maxWords?: number, maxChars?: number }} [opts]  forwarded to splitPhrases
 * @returns {Array<{ text, start, end, level: "normal"|"key"|"hero", emphasize: boolean }>}
 */
export function annotatePhrasedTiers(words, opts) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const phrases = splitPhrases(words, opts);
  return annotateEmphasisTiers(words, phrases.map((p) => p.text));
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
