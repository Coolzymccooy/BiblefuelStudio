// server/scripts/lyric-video-smoke.mjs
// Usage: node --env-file=.env scripts/lyric-video-smoke.mjs <song file> <lyrics.txt> [out.mp4]
// Runs the real pipeline (Whisper, beats, render) on one song and prints the flag count.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, writeProject, applySheet, readProject } from "../src/lib/lyricVideo/projectStore.js";
import { runAlignJob } from "../src/lib/lyricVideo/alignJob.js";
import { buildLyricAss } from "../src/lib/lyricVideo/lyricAss.js";
import { runLyricRender } from "../src/lib/lyricVideo/lyricRender.js";
import { probeAudioDurationSec } from "../src/lib/story/storyRender.js";
import { createJob } from "../src/lib/renderJobs.js";

const [song, sheetFile, outArg] = process.argv.slice(2);
if (!song || !sheetFile) {
  console.error("Usage: node --env-file=.env scripts/lyric-video-smoke.mjs <song file> <lyrics.txt> [out.mp4]");
  process.exit(2);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-smoke-"));
let p = createProject(dir, { title: path.basename(song, path.extname(song)), artist: "Smoke test" });
p = applySheet(p, fs.readFileSync(sheetFile, "utf8"));
p.song = { file: path.resolve(song), durationSec: await probeAudioDurationSec(song), coverStill: null };
writeProject(dir, p);
const t0 = Date.now();
const done = await runAlignJob({ dataDir: dir, workDir: dir, projectId: p.projectId });
console.log(`timing: ${done.timing.status} in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${done.lines.length} lines, ${done.lines.filter((l) => l.flag).length} flagged; ${done.timing.passes?.length} passes; ${done.timing.beats?.bpm} BPM; music stops at ${done.timing.audibleEnd?.toFixed(2)}s of ${done.song.durationSec.toFixed(2)}s`);
for (const l of done.lines) console.log(`${l.start?.toFixed(2).padStart(7)} ${l.end?.toFixed(2).padStart(7)} ${l.flag ? "CHECK" : "     "} ${l.text}`);
if (outArg) {
  const ass = path.join(dir, "c.ass");
  fs.writeFileSync(ass, buildLyricAss(readProject(dir, p.projectId), { w: 720, h: 1280 }));
  const job = createJob("smoke", { durationSec: done.song.durationSec });
  const t1 = Date.now();
  const r = await runLyricRender({ jobId: job.jobId, songPath: done.song.file, background: null, assPath: ass, width: 720, height: 1280, durationSec: done.song.durationSec, outPath: path.resolve(outArg) });
  console.log("render:", r.ok ? r.file : r.error, `in ${((Date.now() - t1) / 1000).toFixed(0)}s`);
}
