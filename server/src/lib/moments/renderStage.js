import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { readProject, writeProject, withHistory, MIN_PHOTOS } from "./projectStore.js";
import { resolvePhoto, resolveSong } from "./photos.js";
import { songGrid, voiceGrid } from "./beatCache.js";
import { statementLimit, LENGTHS } from "./occasions.js";
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
const VOICE_UNREADABLE_NOTE = "The voiceover couldn't be read, so this Moment has no voice. Make it again.";
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

/** "N photos didn't fit L s." plus, when a longer length exists, a nudge to try the next one. */
export function droppedNote(dropped, lengthSec) {
  const next = LENGTHS.find((l) => l > lengthSec);
  const base = `${dropped} photo${dropped === 1 ? "" : "s"} didn't fit ${lengthSec} s.`;
  return next ? `${base} Try ${next} s?` : base;
}

function progressWriter(ctx, projectId, jobId) {
  let lastWritten = -1;
  // Best-effort: the engine calls this from a stream "data" handler, so nothing may escape.
  return (stage, fraction) => {
    try {
      const [a, b] = STAGES[stage];
      // 100% only once the finish stage reports fraction 1 (the file is in place);
      // rounding a running 0.99 must not show 100 while the move is still pending.
      const raw = Math.round(a + (b - a) * Math.min(1, Math.max(0, fraction)));
      const percent = stage === "finish" && fraction >= 1 ? 100 : Math.min(99, raw);
      try { markProgress(jobId, percent); } catch { /* job gone */ }
      if (percent - lastWritten < 5 && percent !== 100 && fraction !== 0) return;
      lastWritten = percent;
      const live = readProject(ctx.dataDir, projectId);
      if (!live || !ownsRender(live, jobId)) return;
      // A fresh record: nothing (file, notes, an old error) is inherited from an earlier render.
      writeProject(ctx.dataDir, { ...live, render: { jobId, status: "running", percent, stage } });
    } catch (err) {
      console.error(`[moments] progress for ${projectId} not recorded:`, err?.message || err);
    }
  };
}

/** False when the project's render belongs to a newer job, which this one must not overwrite. */
function ownsRender(project, jobId) {
  const current = project.render?.jobId;
  return !(current && current !== jobId);
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
    if (!ran.ok && (signal.aborted || ran.error === "cancelled")) throw new StageError("Cancelled.");
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

  // A voiceover that can't be read is a note, not a failure: the Moment simply has no voice.
  let voice = null;
  let voiceGridResult = null;
  if (sound.voiceFile) {
    try {
      voiceGridResult = await voiceGrid(sound.voiceFile, { lengthSec, decode: engine.decode });
      voice = { file: sound.voiceFile };
      if (voiceGridResult.durationSec > lengthSec + VOICE_SLACK_SEC) {
        notes.push(`Your voiceover is ${voiceGridResult.durationSec.toFixed(1)} s, so it's cut at ${lengthSec} s.`);
      }
    } catch (err) {
      console.error("[moments] voiceover could not be read:", err?.message || err);
      notes.push(VOICE_UNREADABLE_NOTE);
    }
  }

  if (sound.songFile) {
    const g = await songGrid(ctx, sound.songFile, { lengthSec, windowStartSec: sound.song.windowStartSec, decode: engine.decode });
    return { grid: g.grid, song: { file: sound.songFile, startSec: g.windowStartSec }, voice, notes };
  }
  return { grid: voiceGridResult || pulseGrid(lengthSec), song: null, voice, notes };
}

/** The stored project, or a StageError if it has been deleted since the render began. */
function liveProject(ctx, projectId) {
  const live = readProject(ctx.dataDir, projectId);
  if (!live) throw new StageError("This Moment no longer exists.");
  return live;
}

/**
 * Saves a finished render to the project. If it can't be saved (the project is gone, or a
 * newer render owns it) the finished file is removed so no orphan video is left behind.
 */
function recordDone(ctx, projectId, jobId, { name, out, plan, notes }) {
  let dropped = [];
  try {
    const live = liveProject(ctx, projectId);
    if (!ownsRender(live, jobId)) throw new StageError("This Moment was changed while it was being made. Make it again.");
    const file = `/outputs/${name}`;
    const entry = { jobId, file, createdAt: Date.now(), seed: plan.seed, notes };
    const next = withHistory({ ...live, render: { jobId, status: "done", percent: 100, stage: "done", file, notes } }, entry);
    writeProject(ctx.dataDir, next);
    dropped = [...(live.history || []), entry].filter((h) => !next.history.includes(h));
  } catch (err) {
    try { fs.rmSync(out, { force: true }); } catch { /* best effort */ }
    throw err;
  }
  removeDroppedVideos(ctx, dropped, name);
  try { markDone(jobId, out); } catch { /* job gone */ }
  try {
    persistJob(ctx.dataDir, { ...(getJob(jobId) || {}), jobId, projectId, status: "done", outputPath: out });
  } catch (persistErr) {
    // The project already says "done"; a failed job record must not turn that into an error.
    console.error(`[moments] could not persist job ${jobId}:`, persistErr);
  }
}

/** History the trim pushed out no longer points at its video; remove it (never the one just made). */
function removeDroppedVideos(ctx, dropped, keepName) {
  for (const h of dropped) {
    const base = path.basename(String(h?.file || ""));
    if (base === keepName || !OUTPUT_NAME.test(base)) continue;
    try { fs.unlinkSync(path.join(ctx.outputDir, base)); } catch { /* already gone */ }
  }
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
    if (live && ownsRender(live, jobId)) writeProject(ctx.dataDir, { ...live, render: { jobId, status: "error", percent: 0, stage: "error", error: friendly } });
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
    if (Number.isInteger(seed) && ownsRender(project, jobId)) project = writeProject(ctx.dataDir, { ...project, seed });
    try { markRunning(jobId); } catch { /* job gone */ }
    progress("prepare", 0);

    const sound = resolveSound(ctx, project);
    const { usable, notes } = await preparePhotos(ctx, project, workDir, controller.signal);
    progress("prepare", 1);
    const timed = await timing(ctx, project, sound);
    notes.push(...timed.notes);
    const { grid, song, voice } = timed;
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
    if (dropped) notes.push(droppedNote(dropped, project.lengthSec));
    const withPlan = liveProject(ctx, projectId);
    if (ownsRender(withPlan, jobId)) writeProject(ctx.dataDir, { ...withPlan, plan });
    progress("analyse", 1);

    const name = `moment-${crypto.randomUUID()}.mp4`;
    const out = path.join(ctx.outputDir, name);
    const result = await engine.renderPlan({
      plan,
      workImages: usable.map((u) => u.file),
      song,
      voice,
      workDir,
      out,
      signal: controller.signal,
      onProgress: ({ stage, fraction }) => progress(stage, fraction),
    });
    if (!result.ok) {
      if (result.detail) console.error(`[moments] render ${projectId} failed: ${result.detail}`);
      throw new StageError(result.error === "cancelled" ? "Cancelled." : result.error);
    }

    recordDone(ctx, projectId, jobId, { name, out, plan, notes });
  } catch (err) {
    recordFailure(ctx, projectId, jobId, err);
  } finally {
    unlink();
    if (controllers.get(String(projectId)) === controller) controllers.delete(String(projectId));
    if (workDir) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (err) { console.error(`[moments] could not remove ${workDir}:`, err?.message || err); }
    }
  }
}
