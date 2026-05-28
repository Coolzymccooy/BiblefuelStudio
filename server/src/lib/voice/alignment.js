import fs from "fs";
import path from "path";
import fetch, { File, FormData } from "node-fetch";

/**
 * Forced-alignment post-processor.
 *
 * When a TTS provider returns audio without alignment data (e.g. Edge-TTS,
 * future Chatterbox), this module can re-derive char-level timings by
 * running OpenAI Whisper over the produced audio.
 *
 * Cost note: this triggers an OpenAI API call per render. The orchestrator
 * only invokes it when the caller explicitly opts in via
 * `forcedAlignmentFallback: true`. The legacy synthesizeTts() shim leaves
 * it off; synthesizeForCategory() enables it by default.
 *
 * If OPENAI_API_KEY is not set the function returns null without throwing,
 * so renders never break — they just lose word-level captions.
 */

const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_TIMEOUT_MS = 60_000;

function getOpenAIApiKey() {
  const raw = (process.env.OPENAI_API_KEY || "").replace(/['"]/g, "").trim();
  if (!raw || raw.startsWith("your-")) return "";
  return raw;
}

export function isForcedAlignmentAvailable() {
  return Boolean(getOpenAIApiKey());
}

function mimeFromPath(p) {
  const ext = path.extname(String(p || "")).toLowerCase();
  switch (ext) {
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".m4a": return "audio/mp4";
    case ".ogg": return "audio/ogg";
    case ".webm": return "audio/webm";
    case ".flac": return "audio/flac";
    default: return "application/octet-stream";
  }
}

/**
 * Expand a list of word timings into a character-level alignment whose
 * shape matches what synthesizeElevenLabsWithTimestamps returns:
 *   { characters: string[], starts: number[], ends: number[] }
 *
 * Each word's duration is distributed uniformly across its characters; a
 * single space (with zero duration) is inserted between words so the
 * alignment array reconstructs the same string the caller passed in.
 *
 * Exported for testing.
 *
 * @param {Array<{ word: string, start: number, end: number }>} words
 * @returns {{ characters: string[], starts: number[], ends: number[] }}
 */
export function wordsToCharAlignment(words) {
  /** @type {string[]} */
  const characters = [];
  /** @type {number[]} */
  const starts = [];
  /** @type {number[]} */
  const ends = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const wText = String(w?.word ?? "");
    const wStart = Number(w?.start ?? 0);
    const wEnd = Number(w?.end ?? wStart);
    const len = wText.length;

    if (len > 0) {
      const dur = Math.max(0, wEnd - wStart);
      const per = len > 0 ? dur / len : 0;
      for (let j = 0; j < len; j++) {
        characters.push(wText[j]);
        starts.push(wStart + per * j);
        ends.push(wStart + per * (j + 1));
      }
    }

    // Insert separating space between consecutive words (except after the last).
    if (i < words.length - 1) {
      characters.push(" ");
      starts.push(wEnd);
      ends.push(wEnd);
    }
  }

  return { characters, starts, ends };
}

/**
 * Call Whisper, parse the response, return a char alignment.
 * Returns null on any failure (missing key, network blip, malformed response).
 *
 * @param {string} audioPath  Absolute path to the audio file produced by a TTS provider.
 * @param {string} _text      Original text. Currently unused — kept for the signature so future
 *                            implementations can do forced alignment against the known transcript.
 * @returns {Promise<{ characters: string[], starts: number[], ends: number[] } | null>}
 */
export async function alignAudioWithText(audioPath, _text) {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) return null;
  if (!audioPath || !fs.existsSync(audioPath)) {
    console.warn(`[alignment] audio file not found: ${audioPath}`);
    return null;
  }

  try {
    const bytes = fs.readFileSync(audioPath);
    const form = new FormData();
    form.set("model", "whisper-1");
    form.set("response_format", "verbose_json");
    // verbose_json with word timestamps — supported on whisper-1 with
    // timestamp_granularities. Sending the param as a repeated key.
    form.append("timestamp_granularities[]", "word");
    form.set(
      "file",
      new File([bytes], path.basename(audioPath), { type: mimeFromPath(audioPath) }),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(WHISPER_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(`[alignment] whisper error ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const payload = await resp.json();
    const words = Array.isArray(payload?.words) ? payload.words : [];
    if (words.length === 0) {
      console.warn("[alignment] whisper returned no word timestamps");
      return null;
    }
    return wordsToCharAlignment(words);
  } catch (err) {
    console.warn(`[alignment] forced alignment failed: ${err?.message || err}`);
    return null;
  }
}

/**
 * Public transcription entry point. Same Whisper call as `alignAudioWithText`,
 * but returns the normalised word contract used by captions/render
 * (`{ words: [{ text, startMs, endMs }] }`) instead of the char-level
 * forced-alignment shape.
 *
 * Returns null when OPENAI_API_KEY is unset or Whisper returns no words —
 * callers must treat null as "transcription unavailable", never as an error.
 *
 * `_fetchImpl` is a unit-test seam; in production it falls back to the
 * runtime's `fetch`.
 *
 * @param {string} audioPath
 * @param {{ _fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ words: Array<{ text: string, startMs: number, endMs: number }> } | null>}
 */
export async function transcribeAudio(audioPath, options = {}) {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) return null;

  const fetchImpl = options._fetchImpl || fetch;

  if (!audioPath || !fs.existsSync(audioPath)) {
    console.warn(`[transcribe] audio file not found: ${audioPath}`);
    return null;
  }

  try {
    const bytes = fs.readFileSync(audioPath);
    const form = new FormData();
    form.set("model", "whisper-1");
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.set(
      "file",
      new File([bytes], path.basename(audioPath), { type: mimeFromPath(audioPath) }),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetchImpl(WHISPER_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn(`[transcribe] whisper error ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const payload = await resp.json();
    const raw = Array.isArray(payload?.words) ? payload.words : [];
    if (raw.length === 0) return null;

    const words = raw
      .map((w) => ({
        text: String(w?.word ?? "").trim(),
        startMs: Math.round(Number(w?.start ?? 0) * 1000),
        endMs: Math.round(Number(w?.end ?? 0) * 1000),
      }))
      .filter((w) => w.text && Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs > w.startMs);

    return words.length ? { words } : null;
  } catch (err) {
    console.warn(`[transcribe] failed: ${err?.message || err}`);
    return null;
  }
}
