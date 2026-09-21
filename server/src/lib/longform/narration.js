import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { synthesize as realSynthesize } from "../voice/index.js";
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

async function synthChunk({ text, voiceId, template, chunksDir, synthesize }) {
  const provider = template.voice.preferredProviders[0];
  const key = chunkCacheKey({ provider, voiceId, rate: template.voice.rate, text });
  const cached = path.join(chunksDir, `${key}.mp3`);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 0) return { file: cached, provider: null };
  const r = await synthesize({ text, voiceId, prosody: { rate: template.voice.rate }, preferredProvider: provider, scriptureMode: true });
  if (!r?.ok || !r.file) throw new Error(`narration: synthesis returned no file for chunk "${text.slice(0, 40)}…"`);
  // Copy to a sibling temp file then rename: rename is atomic on the same
  // filesystem, so a hard kill mid-copy can never leave a truncated file at
  // the cache path. The cache-hit check above only ever looks at `cached`,
  // so a stray `.tmp` left by an interrupted run is simply ignored.
  const tmp = `${cached}.tmp`;
  fs.copyFileSync(r.file, tmp);
  fs.renameSync(tmp, cached);
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
  const probe = deps.probeDurationSec || probeAudioDurationSec;
  const runFfmpeg = deps.runFfmpeg || defaultRunFfmpeg;
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
  const chunksBySection = sections.map((s) => splitForProvider(s.text, template.voice.maxChunkChars));
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
      const { file, provider } = await synthChunk({ text, voiceId, template, chunksDir, synthesize });
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
