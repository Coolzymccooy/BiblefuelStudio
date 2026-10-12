import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { readProject, writeProject, withHistory, MIN_PHOTOS } from "./projectStore.js";
import { resolvePhoto, resolveSong } from "./photos.js";
import { songGrid, voiceGrid } from "./beatCache.js";
import { statementLimit } from "./occasions.js";
import { orientationOf, workImageArgs } from "../motion/prepare.js";
import { directMoment } from "../motion/director.js";
import { validatePlan } from "../motion/plan.js";
import { pulseGrid } from "../motion/cuts.js";
import { renderPlan as realRenderPlan, runFfmpeg as realRunFfmpeg } from "../motion/render.js";
import { decodePcm } from "../motion/beats.js";
import { markRunning, markProgress, markDone, markError, persistJob, getJob } from "../renderJobs.js";
import { readLibrary } from "../imageGen/imageLibrary.js";
import { resolveOwnUpload } from "../ambient/movementImage.js";

/**
 * A Moment's render, run detached inside runExclusive. Every outcome is
 * written to the project (the client polls it), and the per-job work folder
 * is removed whatever happens. The stage never throws.
 */
export const VOICE_NAME = /^moment-vo-[0-9a-f-]{36}\.mp3$/i;
export const OUTPUT_NAME = /^moment-[0-9a-f-]{36}\.mp4$/i;
export const STAGES = Object.freeze({ prepare: [0, 10], analyse: [10, 20], shots: [20, 75], join: [75, 85], finish: [85, 100] });
const VOICE_SLACK_SEC = 0.05;
const VOICE_MISSING_NOTE = "The voiceover was missing, so this Moment has no voice. Make it again to add it back.";

let engine = { runFfmpeg: realRunFfmpeg, renderPlan: realRenderPlan, decode: decodePcm };
export function _setEngineForTest(over) { engine = { ...engine, ...over }; }
export function _resetEngineForTest() { engine = { runFfmpeg: realRunFfmpeg, renderPlan: realRenderPlan, decode: decodePcm }; }

const controllers = new Map();
export function cancelMomentRender(projectId) {
  const c = controllers.get(String(projectId));
  if (!c) return false;
  c.abort();
  return true;
}

class StageError extends Error {}

function progressWriter(ctx, projectId, jobId) {
  let lastWritten = -1;
  return (stage, fraction) => {
    const [a, b] = STAGES[stage];
    // 100% only once the finish stage reports fraction 1 (the file is in place);
    // rounding a running 0.99 must not show 100 while the move is still pending.
    const raw = Math.round(a + (b - a) * Math.min(1, Math.max(0, fraction)));
    const percent = stage === "finish" && fraction >= 1 ? 100 : Math.min(99, raw);
    try { markProgress(jobId, percent); } catch { /* job gone */ }
    if (percent - lastWritten < 5 && percent !== 100 && fraction !== 0) return;
    lastWritten = percent;
    const live = readProject(ctx.dataDir, projectId);
    if (live) writeProject(ctx.dataDir, { ...live, render: { ...live.render, jobId, status: "running", percent, stage } });
  };
}

async function preparePhotos(ctx, project, workDir, signal) {
  const items = readLibrary(ctx.dataDir)?.items || [];
  const usable = [];
  const notes = [];
  for (let i = 0; i < project.photos.length; i += 1) {
    if (signal.aborted) throw new StageError("Cancelled.");
    const r = resolvePhoto(ctx, project.photos[i].ref, { items });
    if (!r.ok) { notes.push(`Photo ${i + 1} was skipped: ${r.error}`); continue; }
    const out = path.join(workDir, `work-${i}.jpg`);
    const { args, shape } = workImageArgs({ src: r.file, out, width: r.width, height: r.height, orientation: orientationOf(r.file) });
    const ran = await engine.runFfmpeg(args, { signal });
    if (!ran.ok) { notes.push(`Photo ${i + 1} was skipped: it could not be read.`); continue; }
    usable.push({ index: i, file: out, shape });
  }
  if (usable.length < MIN_PHOTOS) throw new StageError("Need at least 3 readable photos. Add more photos and try again.");
  return { usable, notes };
}

/**
 * The files the sound needs, checked up front so a song that is gone fails
 * before any photo work. A song that is gone is fatal; a voiceover that is gone
 * never is (the Moment simply has no voice).
 */
function resolveSound(ctx, project) {
  const { song, voiceover } = project.sound || {};
  let songFile = null;
  if (song) {
    songFile = resolveSong(ctx, song.ref);
    if (!songFile) throw new StageError("That song is no longer available. Pick another song.");
  }
  const voiceFile = voiceover?.file ? resolveOwnUpload(ctx.outputDir, voiceover.file, VOICE_NAME) : null;
  return { song, songFile, voiceFile, voiceMissing: Boolean(voiceover?.file) && !voiceFile };
}

async function timing(ctx, project, sound) {
  const lengthSec = project.lengthSec;
  const notes = [];
  if (sound.voiceMissing) notes.push(VOICE_MISSING_NOTE);

  let voiceGridResult = null;
  if (sound.voiceFile) {
    voiceGridResult = await voiceGrid(sound.voiceFile, { lengthSec, decode: engine.decode });
    if (voiceGridResult.durationSec > lengthSec + VOICE_SLACK_SEC) {
      notes.push(`Your voiceover is ${voiceGridResult.durationSec.toFixed(1)} s, so it's cut at ${lengthSec} s.`);
    }
  }

  if (sound.songFile) {
    const g = await songGrid(ctx, sound.songFile, { lengthSec, windowStartSec: sound.song.windowStartSec, decode: engine.decode });
    return { grid: g.grid, song: { file: sound.songFile, startSec: g.windowStartSec }, notes };
  }
  return { grid: voiceGridResult || pulseGrid(lengthSec), song: null, notes };
}

/** Wire an outside signal (a queued job's cancel) to this stage's own controller. */
function linkSignal(signal, controller) {
  if (!signal) return () => {};
  if (signal.aborted) { controller.abort(); return () => {}; }
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function recordFailure(ctx, projectId, jobId, err) {
  const friendly = err instanceof StageError ? err.message : "Something went wrong while making this Moment. Please try again.";
  if (!(err instanceof StageError)) console.error(`[moments] render ${projectId} crashed:`, err);
  try { markError(jobId, friendly); } catch { /* job gone */ }
  try {
    const live = readProject(ctx.dataDir, projectId);
    if (live) writeProject(ctx.dataDir, { ...live, render: { jobId, status: "error", percent: 0, stage: "error", error: friendly } });
  } catch (writeErr) {
    console.error(`[moments] could not record the failure of ${projectId}:`, writeErr);
  }
  try {
    persistJob(ctx.dataDir, { ...(getJob(jobId) || {}), jobId, projectId, status: "error", outputPath: null });
  } catch (persistErr) {
    console.error(`[moments] could not persist job ${jobId}:`, persistErr);
  }
}

export async function momentRenderStage(ctx, projectId, jobId, { seed, signal } = {}) {
  const controller = new AbortController();
  const unlink = linkSignal(signal, controller);
  const progress = progressWriter(ctx, projectId, jobId);
  let workDir;
  try {
    // Cancelled while it waited its turn: record that and do nothing else (and never
    // markRunning, which would overwrite a cancelled job's status).
    if (signal?.aborted || getJob(jobId)?.cancelled) throw new StageError("Cancelled.");
    controllers.set(String(projectId), controller);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "moment-"));

    let project = readProject(ctx.dataDir, projectId);
    if (!project) throw new StageError("This Moment no longer exists.");
    if (Number.isInteger(seed)) project = writeProject(ctx.dataDir, { ...project, seed });
    try { markRunning(jobId); } catch { /* job gone */ }
    progress("prepare", 0);

    const sound = resolveSound(ctx, project);
    const { usable, notes } = await preparePhotos(ctx, project, workDir, controller.signal);
    progress("prepare", 1);
    const timed = await timing(ctx, project, sound);
    notes.push(...timed.notes);
    const { grid, song } = timed;
    const heroAt = usable.findIndex((u) => u.index === project.heroIndex);
    const { plan, dropped } = directMoment({
      photos: usable.map((u) => ({ shape: u.shape })),
      heroIndex: heroAt >= 0 ? heroAt : 0,
      grid,
      title: project.title,
      statements: project.statements.slice(0, statementLimit(project.lengthSec)),
      styleId: project.style,
      energy: project.energy,
      lengthSec: project.lengthSec,
      seed: project.seed,
    });
    const checked = validatePlan(plan, { photoCount: usable.length, shapes: usable.map((u) => u.shape) });
    if (!checked.ok) {
      console.error(`[moments] invalid plan for ${projectId}: ${checked.errors.join("; ")}`);
      throw new StageError("Couldn't plan this Moment. Try Shuffle or a different length.");
    }
    if (dropped) notes.push(`${dropped} photo${dropped === 1 ? "" : "s"} didn't fit ${project.lengthSec} s.`);
    project = writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, projectId), plan });
    progress("analyse", 1);

    const name = `moment-${crypto.randomUUID()}.mp4`;
    const out = path.join(ctx.outputDir, name);
    const result = await engine.renderPlan({
      plan,
      workImages: usable.map((u) => u.file),
      song,
      voice: sound.voiceFile ? { file: sound.voiceFile } : null,
      workDir,
      out,
      signal: controller.signal,
      onProgress: ({ stage, fraction }) => progress(stage, fraction),
    });
    if (!result.ok) {
      if (result.detail) console.error(`[moments] render ${projectId} failed: ${result.detail}`);
      throw new StageError(result.error === "cancelled" ? "Cancelled." : result.error);
    }

    const file = `/outputs/${name}`;
    const live = readProject(ctx.dataDir, projectId);
    writeProject(ctx.dataDir, withHistory(
      { ...live, render: { jobId, status: "done", percent: 100, stage: "done", file, notes } },
      { jobId, file, createdAt: Date.now(), seed: plan.seed, notes },
    ));
    try { markDone(jobId, out); } catch { /* job gone */ }
    persistJob(ctx.dataDir, { ...(getJob(jobId) || {}), jobId, projectId, status: "done", outputPath: out });
  } catch (err) {
    recordFailure(ctx, projectId, jobId, err);
  } finally {
    unlink();
    if (controllers.get(String(projectId)) === controller) controllers.delete(String(projectId));
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
}
