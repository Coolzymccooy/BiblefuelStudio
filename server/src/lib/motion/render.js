import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { hasLibass } from "../kinetic/capability.js";
import { shotArgs, lastFrameArgs } from "./shotArgs.js";
import { statementsAss, fxAss, finishArgs } from "./finish.js";

/**
 * Motion plan + working images + audio -> one MP4. Each shot is its own
 * short ffmpeg run (memory stays flat whatever the length), joined by the
 * concat demuxer without re-encoding, then one finish pass draws the
 * statements and overlays and mixes the audio.
 *
 * Shots render one after another, never in parallel: production has no swap.
 * renderPlan writes only inside workDir and to `out`, and never deletes workDir.
 */
export function runFfmpeg(args, { signal, onStdout, ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg" } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, error: "cancelled", stderr: "" });
      return;
    }
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    // ffmpeg can be chatty; the end of its stderr is the part that explains a failure.
    child.stderr?.on("data", (c) => { stderr = (stderr + c.toString()).slice(-STDERR_CAP); });
    // stdout carries nothing unless the caller asks (-progress pipe:1); it is always drained so a full pipe can't stall ffmpeg.
    const lines = lineSplitter(onStdout);
    child.stdout?.on("data", lines);
    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ ok: false, error: String(err?.message || err), stderr });
    });
    // "close" fires after the process has exited and its streams are drained.
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) resolve({ ok: false, error: "cancelled", stderr });
      else resolve({ ok: code === 0, code, stderr });
    });
  });
}

const STDERR_CAP = 16 * 1024;
const LINE_CAP = 8 * 1024;

/**
 * A chunk handler that calls `onLine` once per complete line. Only the part-line after the last
 * newline is kept, and one that outgrows LINE_CAP is dropped (up to its newline), so memory is flat.
 */
function lineSplitter(onLine) {
  let partial = "";
  let skipping = false;
  return (chunk) => {
    if (!onLine) return;
    const parts = (partial + chunk.toString()).split("\n");
    partial = parts.pop();
    for (const raw of parts) {
      if (skipping) skipping = false;
      else {
        // This runs inside a stream "data" handler: a throwing callback must never escape the engine.
        try { onLine(raw.replace(/\r$/, "")); } catch (err) { console.error("[motion] a progress callback threw:", err?.message || err); }
      }
    }
    if (partial.length > LINE_CAP) {
      partial = "";
      skipping = true;
    }
  };
}

/** Highest fraction a running finish reports; 1 is reserved for "saved to out". */
const FINISH_RUNNING_MAX = 0.99;

/**
 * A line handler for ffmpeg's -progress feed. out_time_us and out_time_ms are both
 * microseconds of output written; each new high-water mark becomes a fraction of durationSec
 * (clamped to 0..0.99), so the reported fractions only ever go up.
 */
export function finishProgressReader(durationSec, emit) {
  let best = 0;
  return (line) => {
    const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line);
    if (!m || !(durationSec > 0)) return;
    const fraction = Math.min(FINISH_RUNNING_MAX, Number(m[1]) / 1e6 / durationSec);
    if (!(fraction > best)) return;
    best = fraction;
    emit(fraction);
  };
}

const DETAIL_CAP = 2000;
const tail = (s) => String(s || "").trim().split("\n").slice(-8).join("\n").slice(-DETAIL_CAP);

/** Moves a finished file into place. rename is atomic; across devices it is copy then unlink. */
function moveInto(from, to) {
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if (err?.code !== "EXDEV") throw err;
    try {
      fs.copyFileSync(from, to);
    } catch (copyErr) {
      fs.rmSync(to, { force: true });
      throw copyErr;
    }
    fs.unlinkSync(from);
  }
}
const writeSide = (files) => { for (const f of files) fs.writeFileSync(f.path, f.text, "utf8"); };
const pad = (i) => String(i).padStart(3, "0");

export async function renderPlan({
  plan, workImages, song = null, voice = null, workDir, out, runner = runFfmpeg, onProgress = () => {}, signal, libass,
}) {
  if (signal?.aborted) return { ok: false, error: "cancelled" };
  // Statements and the FX overlays both go through the ass filter, so either needs libass.
  const statementsText = statementsAss(plan);
  const fxText = fxAss(plan);
  if ((statementsText || fxText) && !(libass ?? hasLibass())) {
    return { ok: false, error: "This server can't draw the statements and effects (its ffmpeg has no libass)." };
  }
  const run = async (args, what, onStdout) => {
    const r = await runner(args, { signal, onStdout });
    if (r.ok) return null;
    if (r.error === "cancelled" || signal?.aborted) return { ok: false, error: "cancelled" };
    return { ok: false, error: `Rendering failed at ${what}.`, detail: tail(r.stderr || r.error) };
  };

  const n = plan.shots.length;
  const clips = [];
  for (let i = 0; i < n; i += 1) {
    const shot = plan.shots[i];
    const clip = path.join(workDir, `shot-${pad(i)}.mp4`);
    const prevFrame = i > 0 ? path.join(workDir, `last-${pad(i - 1)}.png`) : null;
    const { args, sideFiles } = shotArgs({
      shot, index: i, workImage: workImages[shot.photo], prevFrame, out: clip, w: plan.w, h: plan.h, fps: plan.fps, workDir,
    });
    writeSide(sideFiles);
    const failed = await run(args, `shot ${i + 1} of ${n}`);
    if (failed) return failed;
    if (plan.shots[i + 1]?.entrance.id === "crossfade") {
      const grabbed = await run(lastFrameArgs(clip, path.join(workDir, `last-${pad(i)}.png`)), `the last frame of shot ${i + 1} of ${n}`);
      if (grabbed) return grabbed;
    }
    clips.push(clip);
    onProgress({ stage: "shots", fraction: (i + 1) / n });
  }

  // The concat demuxer resolves these names against the list file's own folder.
  const list = path.join(workDir, "list.txt");
  fs.writeFileSync(list, clips.map((c) => `file '${path.basename(c)}'`).join("\n") + "\n", "utf8");
  const body = path.join(workDir, "body.mp4");
  const joined = await run(["-hide_banner", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", body], "joining the shots");
  if (joined) return joined;
  onProgress({ stage: "join", fraction: 1 });

  const statementsPath = statementsText ? path.join(workDir, "statements.ass") : null;
  if (statementsPath) fs.writeFileSync(statementsPath, statementsText, "utf8");
  const fxPath = fxText ? path.join(workDir, "fx.ass") : null;
  if (fxPath) fs.writeFileSync(fxPath, fxText, "utf8");
  // The finish renders into the work dir and moves to `out` only on success, so a cancelled or
  // failed run never leaves a truncated file where a "file exists" check would take it for a render.
  const final = path.join(workDir, "final.mp4");
  const { args, sideFiles } = finishArgs({ body, out: final, plan, statementsPath, fxPath, song, voice, workDir });
  writeSide(sideFiles);
  // Progress is a render concern, not part of the finish graph: finishArgs stays the pure
  // description of the encode, and this is the one place that listens to ffmpeg's -progress feed.
  const watch = finishProgressReader(plan.durationSec, (fraction) => onProgress({ stage: "finish", fraction }));
  const finished = await run(["-progress", "pipe:1", "-nostats", ...args], "the finishing pass", watch);
  if (finished) {
    fs.rmSync(final, { force: true });
    return finished;
  }
  try {
    moveInto(final, out);
  } catch (err) {
    return { ok: false, error: "Couldn't save the finished video.", detail: String(err?.code || err?.message || err).slice(0, DETAIL_CAP) };
  }
  onProgress({ stage: "finish", fraction: 1 });
  return { ok: true, file: out };
}
