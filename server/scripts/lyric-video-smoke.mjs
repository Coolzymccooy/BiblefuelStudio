// server/scripts/lyric-video-smoke.mjs
// Usage: node --env-file=.env scripts/lyric-video-smoke.mjs <song file> <lyrics.txt> [out.mp4] [--vocals <vocals file>]
// Runs the real pipeline (Whisper, beats, render) on one song and prints the flag count and each line's effect.
// With --vocals, the words are timed from that vocals file instead of asking the laptop to separate them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createProject, writeProject, applySheet, readProject } from "../src/lib/lyricVideo/projectStore.js";
import { runAlignJob } from "../src/lib/lyricVideo/alignJob.js";
import { buildLyricAss, resolvedEffects } from "../src/lib/lyricVideo/lyricAss.js";
import { runLyricRender } from "../src/lib/lyricVideo/lyricRender.js";
import { probeAudioDurationSec } from "../src/lib/story/storyRender.js";
import { createJob } from "../src/lib/renderJobs.js";

const USAGE = "Usage: node --env-file=.env scripts/lyric-video-smoke.mjs <song file> <lyrics.txt> [out.mp4] [--vocals <vocals file>]";

/** Pulls `--vocals <path>` out of the arguments, wherever it sits, and returns the rest in order. */
function parseArgs(argv) {
  const rest = [];
  let vocals = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vocals") {
      vocals = argv[++i] || null;
      if (!vocals) return { error: "--vocals needs a file after it." };
    } else {
      rest.push(argv[i]);
    }
  }
  return { rest, vocals };
}

// The timing job removes a vocals file that is named like its own temporary one (lyric-vocals-*.m4a).
// If the caller's file happens to carry that name, hand the job a copy so the original is never deleted.
const JOB_OWNED_NAME = /^lyric-vocals-[\w-]+\.m4a$/;
function vocalsForJob(vocalsArg, dir) {
  const resolved = path.resolve(vocalsArg);
  if (!JOB_OWNED_NAME.test(path.basename(resolved))) return resolved;
  const copy = path.join(dir, `lyric-vocals-${randomUUID()}.m4a`);
  fs.copyFileSync(resolved, copy);
  return copy;
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.error) {
  console.error(parsed.error);
  console.error(USAGE);
  process.exit(2);
}
const [song, sheetFile, outArg] = parsed.rest;
if (!song || !sheetFile) {
  console.error(USAGE);
  process.exit(2);
}
if (parsed.vocals && !fs.existsSync(parsed.vocals)) {
  console.error(`The vocals file was not found: ${parsed.vocals}`);
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-smoke-"));
let p = createProject(dir, { title: path.basename(song, path.extname(song)), artist: "Smoke test" });
p = applySheet(p, fs.readFileSync(sheetFile, "utf8"));
p.song = { file: path.resolve(song), durationSec: await probeAudioDurationSec(song), coverStill: null };
writeProject(dir, p);
const t0 = Date.now();
const deps = parsed.vocals ? { vocalStem: async () => vocalsForJob(parsed.vocals, dir) } : undefined;
const done = await runAlignJob({ dataDir: dir, workDir: dir, projectId: p.projectId, ...(deps ? { deps } : {}) });
console.log(`timing: ${done.timing.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${done.lines.length} lines, ${done.lines.filter((l) => l.flag).length} flagged; ${done.timing.passes?.length} passes; ${done.timing.beats?.bpm} BPM; music stops at ${done.timing.audibleEnd?.toFixed(2)}s of ${done.song.durationSec.toFixed(2)}s; timed from ${done.timing.usedVocalStem ? "the vocals" : "the mix"} (usedVocalStem: ${Boolean(done.timing.usedVocalStem)})`);
const effects = resolvedEffects(readProject(dir, p.projectId));
for (const l of done.lines) console.log(`${l.start?.toFixed(2).padStart(7)} ${l.end?.toFixed(2).padStart(7)} ${l.flag ? "CHECK" : "     "} ${(effects[l.id] || "-").padEnd(6)} ${l.text}`);
if (outArg) {
  const ass = path.join(dir, "c.ass");
  fs.writeFileSync(ass, buildLyricAss(readProject(dir, p.projectId), { w: 720, h: 1280 }));
  const job = createJob("smoke", { durationSec: done.song.durationSec });
  const t1 = Date.now();
  const r = await runLyricRender({ jobId: job.jobId, songPath: done.song.file, background: null, assPath: ass, width: 720, height: 1280, durationSec: done.song.durationSec, outPath: path.resolve(outArg) });
  console.log("render:", r.ok ? r.file : r.error, `in ${((Date.now() - t1) / 1000).toFixed(0)}s`);
}
