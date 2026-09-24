import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import { readProject, writeProject, isMusicOnly } from "./projectStore.js";
import { orderTracks, bedHash, buildBedArgs } from "./bedAssembly.js";
import { voiceDrops } from "./drops.js";
import { deriveMovements, imagePromptFor, AMBIENT_IMAGE_STYLE } from "./movements.js";
import { buildAmbientFfmpegArgs } from "./ambientRender.js";
import { insideOutputs } from "./ownFiles.js";
import { measureLoudness, gainToTargetDb } from "./loudness.js";

import { lookupVerses } from "../bible/scriptureApi.js";
import { synthesize } from "../voice/index.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { generateBibleImage } from "../imageGen/index.js";
import { findReusableImages, markUsed, registerImage, pruneLibrary } from "../imageGen/imageLibrary.js";
import { resolveLibraryTrack } from "../musicLibrary.js";
import { resolveTenantTrack, readMusicLibrary } from "../musicLibraryStore.js";
import {
  persistJob, markRunning, markProgress, markDone, markError,
  attachProc, getJob as getRenderJob,
} from "../renderJobs.js";

/**
 * Ambient pipeline stages — the long, detached work behind routes/ambient.js.
 *
 * Voicing, images, bed assembly and the render each outlive an HTTP request
 * (a two-hour bed is minutes of ffmpeg), so the routes start them and return,
 * and the stages write their progress onto the project for GET /:id to read.
 * Every stage takes `ctx` = { dataDir, outputDir } from the caller's own
 * req.ctx; nothing here reaches a shared path.
 */

export const AMBIENT_STATUS = Object.freeze({
  DRAFT: "draft",
  VOICING: "voicing",
  ASSEMBLING: "assembling",
  GENERATING_IMAGES: "generating_images",
  READY_TO_RENDER: "ready_to_render",
  RENDERING: "rendering",
  DONE: "done",
  ERROR: "error",
});

// --- mockable seams (same shape as routes/story.js) ------------------------
let _lookupFn = lookupVerses;
export function _setLookupImpl(impl) { _lookupFn = impl; }
export function _resetLookupImpl() { _lookupFn = lookupVerses; }

let _synthFn = synthesize;
export function _setSynthImpl(impl) { _synthFn = impl; }
export function _resetSynthImpl() { _synthFn = synthesize; }

let _probeFn = probeAudioDurationSec;
export function _setProbeImpl(impl) { _probeFn = impl; }
export function _resetProbeImpl() { _probeFn = probeAudioDurationSec; }

let _imageGenFn = generateBibleImage;
export function _setImageGenImpl(impl) { _imageGenFn = impl; }
export function _resetImageGenImpl() { _imageGenFn = generateBibleImage; }

const REAL_IMAGE_LIB = { find: findReusableImages, mark: markUsed, register: registerImage };
let _imageLib = REAL_IMAGE_LIB;
export function _setImageLibraryImpl(impl) { _imageLib = { ...REAL_IMAGE_LIB, ...impl }; }
export function _resetImageLibraryImpl() { _imageLib = REAL_IMAGE_LIB; }

// Projects the operator asked to cancel. The detached stages check this between
// units of work so a cancel lands promptly instead of after the last image.
const cancelled = new Set();
export function markCancelled(id) { cancelled.add(String(id)); }
export function isCancelled(id) { return cancelled.has(String(id)); }
export function clearCancelled(id) { cancelled.delete(String(id)); }

// ---------------------------------------------------------------- helpers

export function outDirFor(outputDir, projectId) {
  const safe = String(projectId || "").replace(/[^a-z0-9_-]/gi, "");
  // An empty name would be the ambient folder itself: every session's video.
  if (!safe) throw new Error("ambient: invalid project id");
  return path.join(outputDir, "ambient", safe);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Load the project or answer 404. Returns null once the response is sent. */

/**
 * Re-derive movements whenever the drops change, and persist.
 *
 * Movements are a function of the drops (one picture per verse), so every
 * route that edits drops must go through here or the render would place the
 * old pictures against the new timings. `deriveMovements` preserves existing
 * images by index, so a retime costs no image quota.
 */
/**
 * The project as stored now. Throws when it has been deleted: a stage that
 * outlives a delete must stop, and falling back to its own stale copy wrote
 * the deleted session straight back into the list.
 */
function stillThere(ctx, projectId) {
  const live = readProject(ctx.dataDir, projectId);
  if (!live) throw new Error("this session was deleted");
  return live;
}

export function writeWithMovements(dataDir, project) {
  // Music only: one picture for the whole length. The drops stay stored so
  // switching back to verses restores them, but they never place pictures.
  const source = isMusicOnly(project) ? { ...project, drops: [] } : project;
  return writeProject(dataDir, { ...project, movements: deriveMovements(source) });
}

/**
 * Which tracks in a bed have no recorded licence.
 *
 * Bundled `library:` tracks ship with the app and are cleared by definition.
 * Only the tenant's own uploads carry a `licence` field, and it defaults to
 * "unknown" — on an hour-long music-led video a Content ID claim takes the
 * revenue for the WHOLE video, so "unknown" has to be a deliberate decision,
 * not a default the operator never saw.
 */
export function unclearedTracks(dataDir, trackRefs) {
  const items = readMusicLibrary(dataDir).items || [];
  const out = [];
  for (const ref of trackRefs || []) {
    const s = String(ref || "").trim();
    if (!s.startsWith("mylib:")) continue;
    const track = items.find((t) => t.id === s.slice("mylib:".length));
    if (!track) continue;
    const licence = String(track.licence || "unknown").trim().toLowerCase();
    if (licence && licence !== "unknown") continue;
    out.push({ id: s, label: track.label || s, licence: track.licence || "unknown" });
  }
  return out;
}

/** Resolve a bed track ref to a real file, or null. */
export function resolveTrackFile(ctx, ref) {
  const raw = String(ref || "").trim();
  if (!raw) return null;
  const resolved = resolveLibraryTrack(raw) || resolveTenantTrack(ctx.dataDir, raw);
  if (resolved) return resolved;
  // A ref that failed to resolve is a forgotten track and must NOT be handed
  // to ffmpeg as a literal "-i mylib:<uuid>".
  if (/^(library|mylib):/.test(raw)) return null;
  // A bare path is pre-library back-compat for YOUR OWN upload (see
  // MusicPicker) and nothing else: any other path is another tenant's file or
  // the server's, straight into ffmpeg's -i.
  return insideOutputs(ctx.outputDir, raw);
}

function realSpawnFfmpeg(args) {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return spawn(ff, args, { windowsHide: true });
}
let _spawnFfmpeg = realSpawnFfmpeg;
export function _setFfmpegSpawnImpl(impl) { _spawnFfmpeg = impl; }
export function _resetFfmpegSpawnImpl() { _spawnFfmpeg = realSpawnFfmpeg; }
function spawnFfmpeg(args) { return _spawnFfmpeg(args); }

let _measureLoudness = measureLoudness;
export function _setLoudnessImpl(impl) { _measureLoudness = impl; }
export function _resetLoudnessImpl() { _measureLoudness = measureLoudness; }


/** The image library as currently wired (real, or a test's stand-in). */
export function currentImageLib() { return _imageLib; }
// ---------------------------------------------------------------- stages

/**
 * Look up and speak every pending drop, writing after each so the UI can show
 * progress. One failed reference marks that drop and the rest continue.
 */
export async function voicingStage(ctx, projectId) {
  const project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");
  writeProject(ctx.dataDir, { ...project, status: AMBIENT_STATUS.VOICING, error: null });

  const drops = await voiceDrops(project, {
    lookupVerses: _lookupFn,
    synthesize: _synthFn,
    probeAudioDurationSec: _probeFn,
  });

  const fresh = stillThere(ctx, projectId);
  const anyPending = drops.some((d) => d.status !== "done");
  return writeWithMovements(ctx.dataDir, {
    ...fresh,
    drops,
    status: anyPending ? AMBIENT_STATUS.DRAFT : AMBIENT_STATUS.READY_TO_RENDER,
  });
}

/**
 * One still per movement. Asks the image library first — a reuse costs no
 * image quota, and the daily free cap is low enough that it matters on a
 * session with eight movements.
 */
export async function imagesStage(ctx, projectId, { force = false, onlyId = null } = {}) {
  const project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");

  const movements = [...(project.movements || [])];
  if (movements.length === 0) throw new Error("no movements to illustrate — add drops first");

  const pending = [];
  for (let i = 0; i < movements.length; i += 1) {
    // onlyId regenerates that one picture and leaves the ones you kept alone.
    const done = movements[i].imageStatus === "done" && movements[i].imagePath;
    if (onlyId ? movements[i].id !== onlyId : done && !force) continue;
    movements[i] = {
      ...movements[i],
      // Refreshed as it is (re)made: a session saved before the bright style
      // still carries the old prompt.
      imagePrompt: imagePromptFor(project.theme, i),
      imageStatus: "generating",
      imageError: null,
      ...(force || onlyId ? { imagePath: null, imageUrl: null, imageLibraryId: null } : {}),
    };
    pending.push(i);
  }
  writeProject(ctx.dataDir, { ...project, movements, status: AMBIENT_STATUS.GENERATING_IMAGES });

  const aspect = project.aspect === "portrait" ? "portrait" : "landscape";
  const claimed = new Set(movements.map((m) => m.imageLibraryId).filter(Boolean));

  for (const i of pending) {
    if (isCancelled(projectId)) break;

    let reused = null;
    try {
      const candidates = await _imageLib.find({
        dataDir: ctx.dataDir, prompt: movements[i].imagePrompt, style: AMBIENT_IMAGE_STYLE, aspect,
        excludeIds: [...claimed],
      });
      for (const c of candidates || []) {
        if (!c?.entry?.id || claimed.has(c.entry.id)) continue;
        claimed.add(c.entry.id);
        reused = c;
        break;
      }
    } catch (err) {
      console.warn(`[ambient] movement ${i + 1} library lookup failed: ${err?.message || err}`);
    }

    if (reused) {
      try { _imageLib.mark({ dataDir: ctx.dataDir, id: reused.entry.id }); } catch { /* stats only */ }
      movements[i] = {
        ...movements[i],
        imagePath: reused.entry.path,
        imageUrl: reused.entry.publicUrl || null,
        imageStatus: "done",
        imageError: null,
        imageSource: "library",
        imageLibraryId: reused.entry.id,
        imageReuseScore: reused.score,
      };
      writeProject(ctx.dataDir, { ...stillThere(ctx, projectId), movements });
      continue;
    }

    let result;
    try {
      result = await _imageGenFn({
        seriesId: `ambient-${project.projectId}`,
        partNumber: i + 1,
        rawPrompt: movements[i].imagePrompt,
        aspect,
      });
    } catch (err) {
      result = { ok: false, error: String(err?.message || err) };
    }

    if (result?.ok) {
      let entry = null;
      try {
        entry = await _imageLib.register({
          dataDir: ctx.dataDir, outputDir: ctx.outputDir, sourcePath: result.path,
          prompt: movements[i].imagePrompt, style: AMBIENT_IMAGE_STYLE, aspect,
          provider: result.provider, projectId: project.projectId,
        });
        if (entry?.id) claimed.add(entry.id);
      } catch (err) {
        // The picture exists; the index is only an optimisation.
        console.warn(`[ambient] movement ${i + 1} harvest failed: ${err?.message || err}`);
      }
      movements[i] = {
        ...movements[i],
        imagePath: result.path,
        imageUrl: result.publicUrl || null,
        imageStatus: "done",
        imageError: null,
        imageSource: "generated",
        imageLibraryId: entry?.id || null,
        imageReuseScore: null,
      };
    } else {
      movements[i] = {
        ...movements[i],
        imageStatus: "error",
        imageError: String(result?.error || "image generation failed").slice(0, 300),
      };
    }
    writeProject(ctx.dataDir, { ...stillThere(ctx, projectId), movements });
  }

  try { pruneLibrary({ dataDir: ctx.dataDir }); } catch { /* housekeeping only */ }

  const fresh = stillThere(ctx, projectId);
  if (isCancelled(projectId)) {
    clearCancelled(projectId);
    return writeProject(ctx.dataDir, { ...fresh, movements, status: AMBIENT_STATUS.ERROR, error: "Cancelled." });
  }
  const allDone = movements.every((m) => m.imageStatus === "done");
  return writeProject(ctx.dataDir, {
    ...fresh,
    movements,
    // A missing picture leaves it a draft, not "generating": that status is
    // transient (the page polled forever) and busy (it blocked uploading your
    // own picture for the failed movement).
    status: allDone ? AMBIENT_STATUS.READY_TO_RENDER : AMBIENT_STATUS.DRAFT,
  });
}

/**
 * Build (or reuse) the music bed.
 *
 * Assembling a two-hour bed is minutes of ffmpeg, so the result is cached
 * against a hash of the inputs: re-rendering an unchanged project skips
 * straight to the video pass.
 *
 * @returns {Promise<{ bedPath: string, project: object }>}
 */
export async function assembleBed(ctx, project) {
  const bed = project.bed || {};

  if (bed.mode === "file") {
    const file = resolveTrackFile(ctx, bed.filePath);
    if (!file) throw new Error("the uploaded bed file is missing");
    return { bedPath: file, project };
  }

  const refs = (bed.trackRefs || []).filter(Boolean);
  if (refs.length === 0) throw new Error("no music tracks chosen for the bed");

  const hash = bedHash({ trackRefs: refs, crossfadeSec: bed.crossfadeSec, targetSec: project.targetSec });
  if (bed.builtHash === hash && bed.builtPath && fs.existsSync(bed.builtPath)) {
    return { bedPath: bed.builtPath, project };
  }

  const tracks = [];
  for (const ref of refs) {
    const file = resolveTrackFile(ctx, ref);
    if (!file) continue; // a forgotten track thins the pool; it must not kill the render
    const durationSec = await _probeFn(file);
    if (Number(durationSec) > 0) tracks.push({ ref, file, durationSec: Number(durationSec) });
  }
  if (tracks.length === 0) throw new Error("none of the chosen tracks could be read");

  const crossfadeSec = Number(bed.crossfadeSec) >= 0 ? Number(bed.crossfadeSec) : 6;
  const order = orderTracks(tracks, project.targetSec, { crossfadeSec });
  const dir = ensureDir(outDirFor(ctx.outputDir, project.projectId));
  const bedPath = path.join(dir, "bed.m4a");

  // Measured once per file, however often the pool loops it. Cancel is
  // honoured between tracks: a big pool is minutes of measuring.
  const levels = new Map();
  let allMeasured = true;
  for (const file of new Set(order.map((t) => t.file))) {
    if (isCancelled(project.projectId)) throw new Error("Cancelled.");
    const measured = await _measureLoudness(file);
    if (!measured) allMeasured = false;
    levels.set(file, gainToTargetDb(measured));
  }
  const built = buildBedArgs(order.map((t) => t.file), {
    crossfadeSec, targetSec: project.targetSec, outPath: bedPath,
    gainsDb: order.map((t) => levels.get(t.file) || 0),
  });

  await new Promise((resolve, reject) => {
    const proc = spawnFfmpeg(built.args);
    let tail = "";
    proc.stderr.on("data", (d) => { tail = (tail + d.toString()).slice(-2000); });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0
      ? resolve()
      : reject(new Error(`bed assembly failed (ffmpeg ${code}): ${tail.slice(-400)}`))));
  });

  const fresh = stillThere(ctx, project.projectId);
  const savedRefs = order.map((t) => t.ref);
  // Keyed on the order saved, which is what the next render reads back; the
  // old key was the pre-shuffle list, so the cache almost never hit. And a
  // bed with an unmeasured track is not kept as levelled: it's rebuilt next
  // time, when the measurement may succeed.
  const builtHash = allMeasured
    ? bedHash({ trackRefs: savedRefs, crossfadeSec: bed.crossfadeSec, targetSec: project.targetSec })
    : null;
  const saved = writeProject(ctx.dataDir, {
    ...fresh,
    bed: { ...fresh.bed, trackRefs: savedRefs, builtPath: bedPath, builtHash },
  });
  return { bedPath, project: saved };
}

/**
 * Assemble the bed if needed, then run the single video pass.
 *
 * Runs detached from the request; progress lands on the job registry AND on
 * the project file, because the in-memory job map is not visible to whichever
 * request later serves GET /:id.
 */
export async function renderStage(ctx, projectId, jobId) {
  const start = readProject(ctx.dataDir, projectId);
  if (!start) throw new Error("project not found");

  writeProject(ctx.dataDir, {
    ...start,
    status: AMBIENT_STATUS.ASSEMBLING,
    error: null,
    render: { jobId, outputPath: null, status: "running", percent: 0, phase: "assembling the bed" },
  });

  const { bedPath, project } = await assembleBed(ctx, start);
  // Cancel can't stop bed assembly mid-ffmpeg, so honour it here, before the
  // hour of encoding it was meant to prevent.
  if (isCancelled(projectId)) {
    clearCancelled(projectId);
    throw new Error("Cancelled.");
  }

  const images = (project.movements || []).map((m) => m.imagePath).filter(Boolean);
  if (images.length !== (project.movements || []).length) {
    throw new Error("every movement needs an image before render");
  }

  const dir = ensureDir(outDirFor(ctx.outputDir, projectId));
  const outPath = path.join(dir, "video.mp4");
  const built = buildAmbientFfmpegArgs(project, {
    bedPath, images, drops: isMusicOnly(project) ? [] : (project.drops || []), outPath, workDir: dir,
  });

  writeProject(ctx.dataDir, {
    ...stillThere(ctx, projectId),
    status: AMBIENT_STATUS.RENDERING,
    render: { jobId, outputPath: null, status: "running", percent: 0, phase: "rendering" },
  });
  markRunning(jobId);

  const targetSec = Number(project.targetSec) || 0;
  let lastPct = -1;
  let lastAt = 0;
  const persistPct = (pct) => {
    const p = Math.min(99, Math.max(0, Math.round(pct)));
    const now = Date.now();
    // Throttled: an hour-long render emits progress several times a second and
    // each write is a full JSON rewrite of the project.
    if (p === lastPct || (p < lastPct && now - lastAt < 8000)) return;
    lastPct = p; lastAt = now;
    try {
      const live = readProject(ctx.dataDir, projectId);
      if (live && live.status === AMBIENT_STATUS.RENDERING) {
        writeProject(ctx.dataDir, { ...live, render: { ...live.render, percent: p } });
      }
    } catch { /* progress is best-effort */ }
  };

  const result = await new Promise((resolve) => {
    let proc;
    try {
      proc = spawnFfmpeg(built.args);
    } catch (err) {
      // spawn throws SYNCHRONOUSLY on ENAMETOOLONG/ENOENT — that must become a
      // failed job, never a dead server.
      return resolve({ ok: false, error: String(err?.message || err) });
    }
    attachProc(jobId, proc);
    let tail = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && targetSec > 0) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        const pct = (sec / targetSec) * 100;
        markProgress(jobId, pct);
        persistPct(pct);
      }
    });
    proc.on("error", (err) => resolve({ ok: false, error: String(err?.message || err) }));
    proc.on("close", (code) => (code === 0
      ? resolve({ ok: true })
      : resolve({ ok: false, error: `ffmpeg exited ${code}: ${tail.slice(-400)}` })));
  });

  const fresh = stillThere(ctx, projectId);
  if (result.ok) {
    markDone(jobId, outPath);
    // Spread the live job so the persisted record keeps its userId — without
    // it, reconcilePersistedJobs cannot attribute an interrupted render.
    persistJob(ctx.dataDir, { ...(getRenderJob(jobId) || {}), jobId, projectId, status: "done", outputPath: outPath });
    return writeProject(ctx.dataDir, {
      ...fresh,
      status: AMBIENT_STATUS.DONE,
      error: null,
      render: { jobId, outputPath: outPath, status: "done", percent: 100, phase: "" },
    });
  }
  markError(jobId, result.error);
  persistJob(ctx.dataDir, { ...(getRenderJob(jobId) || {}), jobId, projectId, status: "error", outputPath: null });
  return writeProject(ctx.dataDir, {
    ...fresh,
    status: AMBIENT_STATUS.ERROR,
    error: result.error,
    render: { jobId, outputPath: null, status: "error", percent: 0, phase: "" },
  });
}
