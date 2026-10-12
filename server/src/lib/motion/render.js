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
export function runFfmpeg(args, { signal, ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg" } = {}) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, error: "cancelled", stderr: "" });
      return;
    }
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (c) => { stderr += c.toString(); });
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

const tail = (s) => String(s || "").trim().split("\n").slice(-8).join("\n");
const writeSide = (files) => { for (const f of files) fs.writeFileSync(f.path, f.text, "utf8"); };
const pad = (i) => String(i).padStart(3, "0");

export async function renderPlan({
  plan, workImages, song = null, voice = null, workDir, out, runner = runFfmpeg, onProgress = () => {}, signal, libass,
}) {
  if (signal?.aborted) return { ok: false, error: "cancelled" };
  const canDraw = libass ?? hasLibass();
  if (plan.captions.length && !canDraw) {
    return { ok: false, error: "This server can't draw the statements (its ffmpeg has no libass)." };
  }
  const run = async (args, what) => {
    const r = await runner(args, { signal });
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
      const grabbed = await run(lastFrameArgs(clip, path.join(workDir, `last-${pad(i)}.png`)), `shot ${i + 1} of ${n}`);
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

  const statementsText = statementsAss(plan);
  const statementsPath = statementsText ? path.join(workDir, "statements.ass") : null;
  if (statementsPath) fs.writeFileSync(statementsPath, statementsText, "utf8");
  const fxText = fxAss(plan);
  const fxPath = fxText ? path.join(workDir, "fx.ass") : null;
  if (fxPath) fs.writeFileSync(fxPath, fxText, "utf8");
  const { args, sideFiles } = finishArgs({ body, out, plan, statementsPath, fxPath, song, voice, workDir });
  writeSide(sideFiles);
  const finished = await run(args, "the finishing pass");
  if (finished) return finished;
  onProgress({ stage: "finish", fraction: 1 });
  return { ok: true, file: out };
}
