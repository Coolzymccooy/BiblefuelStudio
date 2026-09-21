import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { synthesize as realSynthesize, describeProviders as realDescribeProviders } from "../voice/index.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { splitForProvider } from "./chunker.js";

function defaultRunFfmpeg(args) {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const proc = spawn(ff, ["-hide_banner", "-loglevel", "error", ...args]);
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`))));
  });
}

export function chunkCacheKey({ provider, voiceId, rate, text }) {
  return crypto.createHash("sha1").update(`${provider}|${voiceId}|${rate}|${text}`).digest("hex");
}

async function ensureSilence(workDir, ms, runFfmpeg) {
  const file = path.join(workDir, `silence-${ms}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  // ffmpeg 5.1-safe: lavfi anullsrc, fixed duration, mp3 so concat stays homogeneous.
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", (ms / 1000).toFixed(3), "-c:a", "libmp3lame", "-q:a", "6", file]);
  return file;
}

// Minimum text length the voice orchestrator accepts (SpeechRequestSchema:
// `min(3)`). Anything shorter — a stray "Ok." left by the chunker — is
// skipped rather than allowed to abort the whole narration.
const MIN_CHUNK_CHARS = 3;

/**
 * The template's preferred providers, narrowed to those the orchestrator
 * reports as configured, in template order. Pure over the injected
 * `describeProviders` result so tests can shape availability freely.
 */
function availablePreferredProviders(template, describeProviders) {
  let described = {};
  try { described = describeProviders() || {}; } catch { described = {}; }
  return (template.voice.preferredProviders || []).filter((id) => described[id]?.available === true);
}

/**
 * Try the template's providers in order (only those actually configured);
 * the first that yields a file wins. With none of them configured, hand the
 * choice to the orchestrator's own default so narration still works on a box
 * with only ElevenLabs set up.
 */
async function synthesizeWithPreference({ text, voiceId, template, synthesize, providers }) {
  const base = { text, voiceId, prosody: { rate: template.voice.rate }, scriptureMode: true };
  if (providers.length === 0) return synthesize(base);
  let lastErr = null;
  for (const preferredProvider of providers) {
    try {
      const r = await synthesize({ ...base, preferredProvider });
      if (r?.ok && r.file) return r;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

async function synthChunk({ text, voiceId, template, chunksDir, synthesize, runFfmpeg, providers }) {
  const provider = template.voice.preferredProviders[0];
  const key = chunkCacheKey({ provider, voiceId, rate: template.voice.rate, text });
  const cached = path.join(chunksDir, `${key}.mp3`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) return { file: cached, provider: null };
  const r = await synthesizeWithPreference({ text, voiceId, template, synthesize, providers });
  if (!r?.ok || !r.file) throw new Error(`narration: synthesis returned no file for chunk "${text.slice(0, 40)}…"`);
  // Providers return whatever container they like (Chatterbox and Piper hand
  // back WAV); `-f concat` silently truncates a mixed WAV/mp3 list, so every
  // chunk is normalised to the same mono 44.1 kHz mp3 the silence file uses.
  // Transcode to a sibling temp file then rename: rename is atomic on the
  // same filesystem, so a hard kill mid-transcode can never leave a truncated
  // file at the cache path. The cache-hit check above only ever looks at
  // `cached`, so a stray `.tmp` left by an interrupted run is simply ignored.
  // `-f mp3` is explicit because ffmpeg cannot infer a muxer from `.tmp`.
  const tmp = `${cached}.tmp`;
  await runFfmpeg(["-y", "-i", r.file, "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "4", "-f", "mp3", tmp]);
  fs.renameSync(tmp, cached);
  // The provider's own temp file is now redundant; best-effort cleanup.
  try { fs.unlinkSync(r.file); } catch { /* provider file may already be gone */ }
  // The orchestrator may have fallen through to another provider; report the real one.
  return { file: cached, provider: r.provider || provider };
}

/**
 * Resolve a probed duration into a positive integer millisecond count, or
 * throw a named error. The real probeAudioDurationSec returns `null` (not a
 * throw) on ffprobe failure or a non-positive duration — left unguarded that
 * silently contributes 0ms and corrupts every later section's timing.
 */
async function measureMs(probe, file, label) {
  const sec = await probe(file);
  const ms = Number(sec) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`narration: could not measure duration of ${label}`);
  return Math.round(ms);
}

function concatListLine(file) {
  return `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

/**
 * Narrate sections one chunk at a time, pausing between sections, then
 * concatenate. Section timings come from measured chunk durations, so no
 * word alignment is needed. Every chunk is cached by content hash: a failure
 * mid-way resumes instead of restarting.
 */
export async function narrateSections({ sections, template, voiceId, workDir }, deps = {}) {
  if (!Array.isArray(sections) || sections.length === 0) throw new Error("narration: no sections to narrate");
  const synthesize = deps.synthesize || realSynthesize;
  const describeProviders = deps.describeProviders || realDescribeProviders;
  const probe = deps.probeDurationSec || probeAudioDurationSec;
  const runFfmpeg = deps.runFfmpeg || defaultRunFfmpeg;
  const providers = availablePreferredProviders(template, describeProviders);
  const onProgress = typeof deps.onProgress === "function" ? deps.onProgress : null;

  const chunksDir = path.join(workDir, "chunks");
  fs.mkdirSync(chunksDir, { recursive: true });
  const pauseMs = template.voice.pauseMs;
  const silence = await ensureSilence(workDir, pauseMs, runFfmpeg);
  const silenceMs = Math.round((await probe(silence)) * 1000) || pauseMs;

  // Computed up front (pure, no I/O) so `onProgress` can report a stable
  // `total` from the very first chunk — a 30–60 min session narrates over
  // many minutes, and callers use this heartbeat to keep the project's
  // `updatedAt` fresh so a slow-but-healthy run isn't mistaken for stalled.
  // Sub-minimum chunks are dropped here so `total` never counts them.
  const chunksBySection = sections.map((s) => splitForProvider(s.text, template.voice.maxChunkChars).filter((c) => c.trim().length >= MIN_CHUNK_CHARS));
  const total = chunksBySection.reduce((n, c) => n + c.length, 0);
  let done = 0;

  const entries = [];
  const timed = [];
  let cursorMs = 0;
  let usedProvider = null;
  for (let i = 0; i < sections.length; i++) {
    if (i > 0) { entries.push(silence); cursorMs += silenceMs; }
    const startMs = cursorMs;
    for (const text of chunksBySection[i]) {
      const { file, provider } = await synthChunk({ text, voiceId, template, chunksDir, synthesize, runFfmpeg, providers });
      if (provider && !usedProvider) usedProvider = provider;
      entries.push(file);
      cursorMs += await measureMs(probe, file, path.basename(file));
      done += 1;
      // Fires for cache hits too — a resumed run should still bump the
      // heartbeat even though nothing was actually synthesised this time.
      if (onProgress) onProgress({ done, total });
    }
    timed.push({ ...sections[i], startMs, endMs: cursorMs });
  }

  const listPath = path.join(workDir, "concat.txt");
  fs.writeFileSync(listPath, entries.map(concatListLine).join("\n") + "\n", "utf8");
  const audioPath = path.join(workDir, "narration.mp3");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "libmp3lame", "-q:a", "4", "-ar", "44100", audioPath]);

  return { audioPath, durationMs: cursorMs, sections: timed, provider: usedProvider || template.voice.preferredProviders[0] };
}
