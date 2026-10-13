// server/src/lib/lyricVideo/passQuality.js
import { normWord } from "./align.js";

const LOOP_REPEATS = 6;
const MAX_GRAM = 3;
const MIN_HIT_RATE = 0.2;
const HALLUCINATIONS = [["thanks", "for", "watching"], ["like", "and", "subscribe"], ["subscribe"]];

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

/** Whisper's failure modes on sung music: a phrase on loop, music notes, sign-offs. Cuts at the first loop. */
export function trimLoops(words) {
  let kept = (words || []).filter((w) => !isMusic(w));
  for (const h of HALLUCINATIONS) kept = dropPhrase(kept, h);
  const norms = kept.map((w) => normWord(w.word));
  for (let i = 0; i < norms.length; i += 1) {
    for (let size = 1; size <= MAX_GRAM; size += 1) {
      if (repeatsAt(norms, i, size) >= LOOP_REPEATS) return kept.slice(0, i);
    }
  }
  return kept;
}

/** Why a pass's words should be thrown away, or null when they are usable. */
export function rejectPass(words, expected) {
  const real = (words || []).filter((w) => !isMusic(w));
  if (!real.length) return "heard nothing";
  for (let i = 1; i < real.length; i += 1) if (real[i].start < real[i - 1].start) return "times out of order";
  const hits = real.filter((w) => expected.has(normWord(w.word))).length;
  if (hits / real.length < MIN_HIT_RATE) return "did not hear the expected lyrics";
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
