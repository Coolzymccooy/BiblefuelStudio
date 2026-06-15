import fs from "fs";
import path from "path";
import { spawn } from "child_process";
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

// Whisper re-encode target: 16 kHz mono MP3 @ 64 kbps. The OpenAI transcription
// API rejects files over 25 MB, and a ~27-min sermon at normal podcast bitrate
// lands right at/above that (the reported "no words" failures were 25.6 MB
// m4a files getting 413'd). Whisper downsamples everything to 16 kHz mono
// internally, so this costs zero accuracy while shrinking that same sermon to
// ~13 MB. At 64 kbps that's ~0.48 MB/min.
const WHISPER_AR = "16000";
const WHISPER_AC = "1";
const WHISPER_BITRATE = "64k";

// ~0.48 MB/min → 30 min ≈ 14 MB, comfortably under the 25 MB API limit even
// with container overhead. Longer audio is segmented into pieces this size.
export const CHUNK_DURATION_MS = 30 * 60 * 1000;

function runFfmpeg(args) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", (d) => { if (stderr.length < 8000) stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`)));
  });
}

/**
 * Prepare an audio file for Whisper transcription: re-encode to a compact
 * 16 kHz mono MP3 (so it clears the 25 MB API limit) and, for long audio,
 * split it into ≤CHUNK_DURATION_MS segments. Returns the list of
 * { path, offsetMs }, suitable for parallel transcription + stitching.
 *
 * Normal-length audio yields a single compact entry with offsetMs=0 so callers
 * don't need to special-case short sermons.
 *
 * @param {string} audioPath
 * @param {string} outDir
 * @param {number} durationMs   Actual duration of the source (caller probes it; 0 = unknown).
 * @returns {Promise<Array<{ path: string, offsetMs: number }>>}
 */
export async function chunkAudioForTranscription(audioPath, outDir, durationMs) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(audioPath, path.extname(audioPath));

  // Normal-length (or unknown-length) audio → one compact, Whisper-optimal
  // file. Always re-encode (never stream-copy) so the request clears the 25 MB
  // limit regardless of the source's bitrate, codec, or container. If the
  // re-encode fails for any reason, fall back to the original file so
  // transcription still attempts rather than hard-failing.
  if (!durationMs || durationMs <= CHUNK_DURATION_MS) {
    const out = path.join(outDir, `${base}-whisper.mp3`);
    try {
      await runFfmpeg(["-y", "-i", audioPath, "-vn", "-ac", WHISPER_AC, "-ar", WHISPER_AR, "-b:a", WHISPER_BITRATE, out]);
      return [{ path: out, offsetMs: 0 }];
    } catch (err) {
      console.warn(`[transcribe] compact re-encode failed, using original: ${err?.message || err}`);
      return [{ path: audioPath, offsetMs: 0 }];
    }
  }

  // Long audio → segment into compact mono chunks (re-encode while segmenting,
  // so each piece is independently under the size limit). On failure, fall back
  // to a single original-file chunk.
  const pattern = path.join(outDir, `${base}-chunk-%03d.mp3`);
  try {
    await runFfmpeg([
      "-y", "-i", audioPath,
      "-vn", "-ac", WHISPER_AC, "-ar", WHISPER_AR, "-b:a", WHISPER_BITRATE,
      "-f", "segment", "-segment_time", String(CHUNK_DURATION_MS / 1000),
      pattern,
    ]);
  } catch (err) {
    console.warn(`[transcribe] segment re-encode failed, using original: ${err?.message || err}`);
    return [{ path: audioPath, offsetMs: 0 }];
  }

  return fs.readdirSync(outDir)
    .filter((name) => name.startsWith(`${base}-chunk-`) && name.endsWith(".mp3"))
    .sort()
    .map((name, idx) => ({
      path: path.join(outDir, name),
      offsetMs: idx * CHUNK_DURATION_MS,
    }));
}

/**
 * Stitch the per-chunk transcription results back together, offsetting each
 * word by its chunk's start time.
 *
 * @param {Array<{ offsetMs: number, transcription: { words: Array<{ text: string, startMs: number, endMs: number }> } | null }>} chunks
 * @returns {{ words: Array<{ text: string, startMs: number, endMs: number }> }}
 */
export function stitchTranscriptions(chunks) {
  const words = [];
  for (const c of chunks) {
    if (!c?.transcription?.words) continue;
    for (const w of c.transcription.words) {
      words.push({
        text: w.text,
        startMs: w.startMs + c.offsetMs,
        endMs: w.endMs + c.offsetMs,
      });
    }
  }
  return { words };
}
