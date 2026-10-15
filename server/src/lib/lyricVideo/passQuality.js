// server/src/lib/lyricVideo/passQuality.js
import { normWord } from "./align.js";

const LOOP_REPEATS = 6;
const MAX_GRAM = 3;
const MIN_HIT_RATE = 0.4; // measured: real windows 0.62+ (ad-libs included), chatter 0.2 or less bar a few short phrases
const HALLUCINATIONS = [["thanks", "for", "watching"], ["like", "and", "subscribe"], ["subscribe"]];

/**
 * Everyday words that any chatter shares with any lyric ("I don't know what
 * to say"), so hearing them is no evidence that the lyrics were heard. They
 * still count as heard words; they just never count as hits.
 */
const COMMON = new Set([
  "i", "me", "my", "you", "your", "we", "us", "our", "he", "she", "it", "they", "them", "his", "her",
  "the", "a", "an", "and", "or", "but", "so", "to", "of", "in", "on", "at", "for", "with", "by", "from",
  "is", "am", "are", "was", "be", "do", "don't", "dont", "not", "no", "yes", "oh", "eh", "yeah", "ah",
  "go", "know", "what", "that", "this", "there", "here", "will", "can", "just", "like", "all", "one",
  "up", "out", "if", "when", "now", "then", "get", "got",
]);

const isMusic = (w) => /♪/.test(w.word) || !normWord(w.word);

/** Drop every run of the given hallucinated phrase. */
function dropPhrase(words, phrase) {
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    if (phrase.every((t, k) => normWord(words[i + k]?.word ?? "") === t)) { i += phrase.length - 1; continue; }
    out.push(words[i]);
  }
  return out;
}

/** How many times the `size`-word phrase at `i` repeats back to back. */
function repeatsAt(norms, i, size) {
  let reps = 1;
  while (i + (reps + 1) * size <= norms.length && norms.slice(i, i + size).every((t, k) => t === norms[i + reps * size + k])) reps += 1;
  return reps;
}

/**
 * Whisper's failure modes on sung music: a phrase on loop, music notes, sign-offs.
 * Cuts at the first loop, and at the first time that steps backwards (a long
 * phrase looped at the end of a window: the heard words before it are good).
 * `cutBackwards: false` skips that cut: the first full pass is rejected whole
 * by rejectPass instead, since its prefix is not trustworthy as a reliable start.
 */
export function trimLoops(words, { cutBackwards = true } = {}) {
  let kept = (words || []).filter((w) => !isMusic(w));
  for (const h of HALLUCINATIONS) kept = dropPhrase(kept, h);
  const back = kept.findIndex((w, i) => i > 0 && w.start < kept[i - 1].start);
  if (back > 0 && cutBackwards) kept = kept.slice(0, back);
  const norms = kept.map((w) => normWord(w.word));
  for (let i = 0; i < norms.length; i += 1) {
    for (let size = 1; size <= MAX_GRAM; size += 1) {
      if (repeatsAt(norms, i, size) >= LOOP_REPEATS) return kept.slice(0, i);
    }
  }
  return kept;
}

/**
 * The words a pass may hear and the consecutive pairs they make, across line
 * breaks too (sung lines run on). Hyphenated words count as their parts.
 */
export function expectedFrom(lines) {
  const toks = lines.flatMap((l) => String(l.text).split(/\s+/).flatMap((w) => w.split("-")).map(normWord)).filter(Boolean);
  return { words: new Set(toks), pairs: new Set(toks.slice(1).map((t, i) => `${toks[i]} ${t}`)) };
}

/**
 * A heard word is evidence of the lyrics when it is an expected word that is
 * not an everyday one, or when it and the word heard before it make a pair the
 * expected lines make ("you are", "here with"). Chatter shares words with any
 * lyric but rarely its word order.
 */
function hitRate(real, expected) {
  const { words, pairs } = expected instanceof Set ? { words: expected, pairs: new Set() } : expected;
  const norms = real.map((w) => normWord(w.word));
  const hits = norms.filter((n, i) => (words.has(n) && !COMMON.has(n)) || (i > 0 && pairs.has(`${norms[i - 1]} ${n}`))).length;
  return hits / norms.length;
}

/**
 * Why a pass's words should be thrown away, or null when they are usable.
 * `expected` is `expectedFrom(lines)`, or a plain Set of words (no pairs).
 */
export function rejectPass(words, expected) {
  const real = (words || []).filter((w) => !isMusic(w));
  if (!real.length) return "heard nothing";
  for (let i = 1; i < real.length; i += 1) if (real[i].start < real[i - 1].start) return "times out of order";
  if (hitRate(real, expected) < MIN_HIT_RATE) return "did not hear the expected lyrics";
  return null;
}

/** The lines' text joined in order, cut at a line boundary under `maxChars`. */
export function promptFor(lines, maxChars = 900) {
  let out = "";
  for (const l of lines) {
    const next = out ? `${out} ${l.text}` : l.text;
    if (next.length > maxChars) break;
    out = next;
  }
  return out;
}
