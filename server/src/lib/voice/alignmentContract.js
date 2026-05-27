/**
 * Unified word-alignment contract.
 *
 * The typography renderer should be provider-agnostic: it consumes ONE
 * normalized shape regardless of which TTS provider produced the audio.
 *
 *   AlignmentContract = {
 *     audioPath: string,
 *     words: Array<{ text: string, startMs: number, endMs: number }>
 *   }
 *
 * Two timing sources map into it today:
 *   - Azure WordBoundary words — native, already millisecond word timings.
 *   - char-level alignment ({characters,starts,ends} in SECONDS) used by
 *     ElevenLabs + the Whisper forced-alignment fallback — grouped into words.
 *
 * Other providers map in over time ("eventually"); until then their contract
 * just has an empty words[] (audio still renders, captions degrade gracefully).
 */

/**
 * @typedef {Object} WordTiming
 * @property {string} text
 * @property {number} startMs
 * @property {number} endMs
 */

/**
 * @typedef {Object} AlignmentContract
 * @property {string} audioPath
 * @property {WordTiming[]} words
 */

/**
 * Group a char-level alignment (seconds) into word timings (milliseconds).
 * Words are split on whitespace; runs of spaces collapse. A word's start is
 * its first character's start; its end is its last character's end.
 *
 * @param {{ characters?: string[], starts?: number[], ends?: number[] } | null | undefined} alignment
 * @returns {WordTiming[]}
 */
export function charAlignmentToWords(alignment) {
  const characters = alignment?.characters;
  const starts = alignment?.starts;
  const ends = alignment?.ends;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) {
    return [];
  }

  /** @type {WordTiming[]} */
  const words = [];
  let current = null; // { text, startSec, endSec }

  const flush = () => {
    if (current && current.text.length > 0) {
      words.push({
        text: current.text,
        startMs: Math.round(current.startSec * 1000),
        endMs: Math.round(current.endSec * 1000),
      });
    }
    current = null;
  };

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === undefined || ch === null) continue;
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    const start = Number(starts[i] ?? 0);
    const end = Number(ends[i] ?? start);
    if (!current) {
      current = { text: ch, startSec: start, endSec: end };
    } else {
      current.text += ch;
      current.endSec = end;
    }
  }
  flush();

  return words;
}

/**
 * Normalize any SpeechResult into the unified alignment contract.
 * Prefers a provider's native `words` (e.g. Azure); otherwise derives words
 * from char-level `alignment`; otherwise returns an empty words list.
 *
 * @param {{ file?: string, words?: WordTiming[], alignment?: object } | null | undefined} result
 * @returns {AlignmentContract}
 */
export function toAlignmentContract(result) {
  const audioPath = result?.file ?? "";
  if (Array.isArray(result?.words)) {
    return { audioPath, words: result.words };
  }
  if (result?.alignment) {
    return { audioPath, words: charAlignmentToWords(result.alignment) };
  }
  return { audioPath, words: [] };
}
