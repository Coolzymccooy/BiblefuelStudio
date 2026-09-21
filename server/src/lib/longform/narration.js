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
  fs.copyFileSync(r.file, cached);
  // The orchestrator may have fallen through to another provider; report the real one.
  return { file: cached, provider: r.provider || provider };
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

  const chunksDir = path.join(workDir, "chunks");
  fs.mkdirSync(chunksDir, { recursive: true });
  const pauseMs = template.voice.pauseMs;
  const silence = await ensureSilence(workDir, pauseMs, runFfmpeg);
  const silenceMs = Math.round((await probe(silence)) * 1000) || pauseMs;

  const entries = [];
  const timed = [];
  let cursorMs = 0;
  let usedProvider = null;
  for (let i = 0; i < sections.length; i++) {
    if (i > 0) { entries.push(silence); cursorMs += silenceMs; }
    const startMs = cursorMs;
    for (const text of splitForProvider(sections[i].text, template.voice.maxChunkChars)) {
      const { file, provider } = await synthChunk({ text, voiceId, template, chunksDir, synthesize });
      if (provider && !usedProvider) usedProvider = provider;
      entries.push(file);
      cursorMs += Math.round((await probe(file)) * 1000);
    }
    timed.push({ ...sections[i], startMs, endMs: cursorMs });
  }

  const listPath = path.join(workDir, "concat.txt");
  fs.writeFileSync(listPath, entries.map(concatListLine).join("\n") + "\n", "utf8");
  const audioPath = path.join(workDir, "narration.mp3");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "libmp3lame", "-q:a", "4", "-ar", "44100", audioPath]);

  return { audioPath, durationMs: cursorMs, sections: timed, provider: usedProvider || template.voice.preferredProviders[0] };
}
