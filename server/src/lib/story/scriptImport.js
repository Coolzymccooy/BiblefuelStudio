// Import an already-written script into a Story Video project.
//
// The normal Story entry point is MEDIA: upload audio/video, transcribe it,
// segment the transcript into scenes, generate an image per scene. But Gumroad
// devotionals and Series parts are already TEXT — narrating them and then
// transcribing that narration back into text would be a lossy round trip
// (speech recognition mangles proper nouns like "Zerubbabel" and drops verse
// references), and it costs a transcription call for words we already have.
//
// transcribeStage short-circuits when project.transcript.words is already
// populated. So the bridge is: synthesize narration, take the WORD TIMINGS the
// TTS provider returns, write them straight into the project, and let the
// pipeline resume at segmentation. No transcription, no text loss.
//
// When the TTS provider returns no timings, buildEvenWordTimings distributes
// words evenly across the audio duration. Scene segmentation only needs
// approximate boundaries, so even timings still produce sensible scenes — the
// captions drift slightly within a scene, which is far better than failing.

/**
 * Distribute words evenly across a known audio duration.
 *
 * Fallback for providers that synthesize without timestamps. Word LENGTH is
 * used as the weight rather than a flat split, because "Nebuchadnezzar" plainly
 * takes longer to say than "of" — a small refinement that keeps scene
 * boundaries from landing mid-phrase.
 *
 * @param {string[]} words
 * @param {number} durationMs total narration length
 * @returns {Array<{text:string,startMs:number,endMs:number}>}
 */
export function buildEvenWordTimings(words, durationMs) {
  const list = (Array.isArray(words) ? words : []).map((w) => String(w || "").trim()).filter(Boolean);
  const total = Math.max(0, Number(durationMs) || 0);
  if (list.length === 0 || total === 0) return [];

  const weights = list.map((w) => Math.max(1, w.length));
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  const out = [];
  let cursor = 0;
  list.forEach((text, i) => {
    const share = (weights[i] / weightTotal) * total;
    const startMs = Math.round(cursor);
    // Clamp the final word to the exact duration so rounding never overshoots
    // the audio — scene segmentation trusts the last endMs as the total.
    const endMs = i === list.length - 1 ? Math.round(total) : Math.round(cursor + share);
    out.push({ text, startMs, endMs });
    cursor += share;
  });
  return out;
}

/**
 * Normalize provider word timings into the shape the story project expects.
 *
 * Accepts the common provider spellings (startMs/endMs, start/end in seconds,
 * word/text) so this works across the TTS chain without each caller adapting.
 *
 * @param {Array<object>} words
 * @returns {Array<{text:string,startMs:number,endMs:number}>}
 */
export function normalizeWordTimings(words) {
  const list = Array.isArray(words) ? words : [];
  const out = [];
  for (const w of list) {
    if (!w) continue;
    const text = String(w.text ?? w.word ?? "").trim();
    if (!text) continue;

    let startMs = Number(w.startMs ?? w.start_ms);
    let endMs = Number(w.endMs ?? w.end_ms);
    // Seconds variant — only trust it when the ms fields are genuinely absent.
    if (!Number.isFinite(startMs) && Number.isFinite(Number(w.start))) startMs = Number(w.start) * 1000;
    if (!Number.isFinite(endMs) && Number.isFinite(Number(w.end))) endMs = Number(w.end) * 1000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (endMs < startMs) continue;

    out.push({ text, startMs: Math.round(startMs), endMs: Math.round(endMs) });
  }
  return out;
}

/**
 * Build the transcript patch that lets a script-sourced project skip
 * transcription entirely.
 *
 * @param {{script:string, audioPath:string, durationMs:number, words?:Array<object>}} params
 * @returns {{source:{audioPath:string,durationMs:number}, transcript:{words:Array,hash:string}}}
 */
export function buildImportedTranscript({ script, audioPath, durationMs, words }) {
  const provided = normalizeWordTimings(words);
  const resolved = provided.length > 0
    ? provided
    : buildEvenWordTimings(String(script || "").split(/\s+/), durationMs);

  if (resolved.length === 0) {
    throw new Error("script import: no words to build a transcript from");
  }

  const lastEnd = resolved[resolved.length - 1].endMs;
  const effectiveDuration = Math.max(Number(durationMs) || 0, lastEnd);

  return {
    source: { audioPath: String(audioPath), durationMs: effectiveDuration },
    // Hash mirrors transcribeStage's format so downstream cache checks behave
    // identically for imported and transcribed projects.
    transcript: { words: resolved, hash: `${effectiveDuration}:${resolved.length}` },
  };
}
