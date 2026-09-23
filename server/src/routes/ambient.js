import { Router } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import {
  createProject, readProject, writeProject, listProjects, deleteProject,
  normaliseCaptionSettings, DEFAULT_DROP_INTERVAL_SEC,
} from "../lib/ambient/projectStore.js";
import { orderTracks, bedHash, buildBedArgs } from "../lib/ambient/bedAssembly.js";
import { defaultDropTimes, normaliseDrops, voiceDrops } from "../lib/ambient/drops.js";
import { deriveMovements } from "../lib/ambient/movements.js";
import { buildAmbientFfmpegArgs } from "../lib/ambient/ambientRender.js";
import { planReferences } from "../lib/ambient/versePlan.js";

import { lookupVerses } from "../lib/bible/scriptureApi.js";
import { synthesize } from "../lib/voice/index.js";
import { probeAudioDurationSec } from "../lib/story/storyRender.js";
import { generateBibleImage } from "../lib/imageGen/index.js";
import { findReusableImages, markUsed, registerImage, pruneLibrary, readLibrary } from "../lib/imageGen/imageLibrary.js";
import { libraryImageView, resolveMovementImage } from "../lib/ambient/movementImage.js";
import { insideOutputs } from "../lib/ambient/ownFiles.js";
import { resolveLibraryTrack } from "../lib/musicLibrary.js";
import { resolveTenantTrack, readMusicLibrary } from "../lib/musicLibraryStore.js";
import {
  createJob, persistJob, markRunning, markProgress, markDone, markError,
  attachProc, cancelJob as cancelRenderJob, getJob as getRenderJob,
} from "../lib/renderJobs.js";
import { quota } from "../middleware/quota.js";

/**
 * Ambient sessions — music-first scripture video.
 *
 * Every handler reads `req.ctx` for the caller's own data/output directories;
 * nothing here touches a shared path. The long stages (voicing, images, bed
 * assembly, render) run DETACHED and write progress onto the project, because
 * a two-hour bed takes minutes of ffmpeg and no HTTP client should hold a
 * socket open for that. The client polls GET /:id, which is why this router is
 * mounted WITHOUT a blanket render quota — see the mount in index.js.
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

let _planFn = planReferences;
export function _setPlanImpl(impl) { _planFn = impl; }
export function _resetPlanImpl() { _planFn = planReferences; }

// The whole render stage, injectable so route tests never spawn ffmpeg.
let _renderStageFn = null;
export function _setRenderStageImpl(impl) { _renderStageFn = impl; }
export function _resetRenderStageImpl() { _renderStageFn = null; }

// The router is mounted WITHOUT a blanket quota — the client polls GET /:id
// about once a second while a stage runs, and charging per request emptied a
// free user's allowance within seconds on the Story router. The buckets are
// charged on the expensive POSTs only, each against the resource it actually
// spends: TTS for voicing, images for the picture pass, render for ffmpeg.
let _quota = quota;
export function _setQuotaImpl(fn) { _quota = fn; }
export function _resetQuotaImpl() { _quota = quota; }
function renderQuota(req, res, next) { return _quota("render")(req, res, next); }
function ttsQuota(req, res, next) { return _quota("tts")(req, res, next); }
function imageQuota(req, res, next) { return _quota("imageGen")(req, res, next); }

/**
 * Keep the last verse a clear minute from the end — the same guard
 * `defaultDropTimes` applies. A verse that starts eight seconds before the
 * video ends is cut mid-sentence, which reads as a broken render.
 */
const TAIL_GUARD_MS = 60_000;

/**
 * Caption modes ambientRender understands.
 *
 * Story's shared panel also offers "kinetic", which word-syncs against a
 * narration transcript. An ambient drop has no per-word timing — only a start
 * and a measured duration — so kinetic is stored as "static" rather than
 * rejected: the operator's toggle still works, it just cannot animate.
 */
const CAPTION_MODES = ["none", "static", "kinetic"];
const CAPTION_SPANS = ["spoken", "section"];
const CAPTION_POSITIONS = ["lower", "centre"];

// Projects the operator asked to cancel. The detached stages check this between
// units of work so a cancel lands promptly instead of after the last image.
const cancelled = new Set();
export function markCancelled(id) { cancelled.add(String(id)); }
export function isCancelled(id) { return cancelled.has(String(id)); }
export function clearCancelled(id) { cancelled.delete(String(id)); }

const router = Router();

// ---------------------------------------------------------------- helpers

function outDirFor(outputDir, projectId) {
  const safe = String(projectId).replace(/[^a-z0-9_-]/gi, "");
  return path.join(outputDir, "ambient", safe);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Load the project or answer 404. Returns null once the response is sent. */
function loadOr404(req, res) {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) {
    res.status(404).json({ ok: false, error: "project not found" });
    return null;
  }
  return project;
}

/**
 * Re-derive movements whenever the drops change, and persist.
 *
 * Movements are a function of the drops (one picture per verse), so every
 * route that edits drops must go through here or the render would place the
 * old pictures against the new timings. `deriveMovements` preserves existing
 * images by index, so a retime costs no image quota.
 */
function writeWithMovements(dataDir, project) {
  return writeProject(dataDir, { ...project, movements: deriveMovements(project) });
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
function resolveTrackFile(ctx, ref) {
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

function spawnFfmpeg(args) {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return spawn(ff, args, { windowsHide: true });
}

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

  const fresh = readProject(ctx.dataDir, projectId) || project;
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
        dataDir: ctx.dataDir, prompt: movements[i].imagePrompt, style: "", aspect,
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
      writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, projectId), movements });
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
          prompt: movements[i].imagePrompt, style: "", aspect,
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
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, projectId), movements });
  }

  try { pruneLibrary({ dataDir: ctx.dataDir }); } catch { /* housekeeping only */ }

  const fresh = readProject(ctx.dataDir, projectId) || project;
  if (isCancelled(projectId)) {
    clearCancelled(projectId);
    return writeProject(ctx.dataDir, { ...fresh, movements, status: AMBIENT_STATUS.ERROR, error: "Cancelled." });
  }
  const allDone = movements.every((m) => m.imageStatus === "done");
  return writeProject(ctx.dataDir, {
    ...fresh,
    movements,
    status: allDone ? AMBIENT_STATUS.READY_TO_RENDER : AMBIENT_STATUS.GENERATING_IMAGES,
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

  const built = buildBedArgs(order.map((t) => t.file), {
    crossfadeSec, targetSec: project.targetSec, outPath: bedPath,
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

  const fresh = readProject(ctx.dataDir, project.projectId) || project;
  const saved = writeProject(ctx.dataDir, {
    ...fresh,
    bed: { ...fresh.bed, trackRefs: order.map((t) => t.ref), builtPath: bedPath, builtHash: hash },
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

  const images = (project.movements || []).map((m) => m.imagePath).filter(Boolean);
  if (images.length !== (project.movements || []).length) {
    throw new Error("every movement needs an image before render");
  }

  const dir = ensureDir(outDirFor(ctx.outputDir, projectId));
  const outPath = path.join(dir, "video.mp4");
  const built = buildAmbientFfmpegArgs(project, {
    bedPath, images, drops: project.drops || [], outPath, workDir: dir,
  });

  writeProject(ctx.dataDir, {
    ...(readProject(ctx.dataDir, projectId) || project),
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

  const fresh = readProject(ctx.dataDir, projectId) || project;
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

// ---------------------------------------------------------------- routes

// POST / — create a session.
router.post("/", (req, res) => {
  try {
    const { title, theme, targetSec, aspect, translation } = req.body || {};
    const project = createProject(req.ctx.dataDir, { title, theme, targetSec, aspect, translation });
    return res.json({ ok: true, project });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET / — summaries, newest first.
router.get("/", (req, res) => {
  return res.json({ ok: true, projects: listProjects(req.ctx.dataDir) });
});

// GET /:id — the full project, with live render progress folded in.
router.get("/:id", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  // The in-memory job knows the current percent; the project file may be up to
  // one throttle window behind it.
  const jobId = project.render?.jobId;
  if (jobId) {
    const job = getRenderJob(jobId);
    if (job && typeof job.percent === "number") {
      return res.json({ ok: true, project: { ...project, render: { ...project.render, percent: job.percent } } });
    }
  }
  return res.json({ ok: true, project });
});

// DELETE /:id
router.delete("/:id", (req, res) => {
  const removed = deleteProject(req.ctx.dataDir, req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: "project not found" });
  clearCancelled(req.params.id);
  return res.json({ ok: true });
});

// POST /:id/plan — suggest verse REFERENCES for the theme and space them across
// the runtime. The words themselves arrive later, verbatim, from POST /voice.
router.post("/:id/plan", async (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  try {
    const times = defaultDropTimes(project.targetSec, DEFAULT_DROP_INTERVAL_SEC);
    const requested = Number(req.body?.count);
    const count = requested > 0 ? Math.min(Math.round(requested), 200) : times.length;
    if (count === 0) {
      return res.status(400).json({ ok: false, error: "this session is too short for a scripture drop" });
    }

    const references = await _planFn({ theme: project.theme, count });
    // The default cadence is every fifteen minutes. An explicit count has to
    // be respaced across the WHOLE runtime instead — taking the first four of
    // the default times would cram four verses into the first hour of a
    // two-hour session and leave the rest silent.
    const lastAllowedMs = Math.max(0, project.targetSec * 1000 - TAIL_GUARD_MS);
    const step = (project.targetSec * 1000) / (references.length + 1);
    const atTimes = references.map((_, i) => (requested > 0
      ? Math.min(Math.round(step * (i + 1)), lastAllowedMs)
      : times[i] ?? Math.min(Math.round(step * (i + 1)), lastAllowedMs)));

    const drops = normaliseDrops(
      references.map((reference, i) => ({ reference, atMs: atTimes[i] })),
      { targetSec: project.targetSec, translation: project.translation },
    );
    const updated = writeWithMovements(req.ctx.dataDir, { ...project, drops, status: AMBIENT_STATUS.DRAFT });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PATCH /:id/drops — replace the drop list wholesale (the client always sends
// the whole list; a partial send would delete the others).
router.patch("/:id/drops", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (!Array.isArray(req.body?.drops)) {
    return res.status(400).json({ ok: false, error: "drops must be an array" });
  }
  try {
    const byId = new Map((project.drops || []).map((d) => [d.id, d]));
    // Only these four come from the client. audioPath reaches ffmpeg's -i and
    // text is burned in as scripture: both are the server's to fill, from the
    // verbatim lookup and the synthesiser, never from a request body.
    const merged = req.body.drops.map((raw) => {
      const incoming = Object.fromEntries(
        ["id", "atMs", "reference", "translation"]
          .filter((k) => raw?.[k] !== undefined && raw?.[k] !== null)
          .map((k) => [k, raw[k]]),
      );
      const prev = byId.get(incoming.id);
      if (!prev) return incoming;
      // A changed reference invalidates the audio: keeping it would speak the
      // OLD verse at the new citation's time, which is worse than no audio.
      const changed = String(incoming.reference || "").trim() !== prev.reference
        || String(incoming.translation || prev.translation) !== prev.translation;
      return changed
        ? { ...prev, ...incoming, text: null, audioPath: null, durationMs: null, status: "pending", error: null }
        : { ...prev, ...incoming };
    });
    const drops = normaliseDrops(merged, {
      targetSec: project.targetSec, translation: project.translation,
    });
    const updated = writeWithMovements(req.ctx.dataDir, { ...project, drops });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /:id/voice — verbatim lookup + synthesis for every pending drop.
// Detached: several verses at a few seconds of TTS each outlives a request.
router.post("/:id/voice", ttsQuota, (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (!(project.drops || []).length) {
    return res.status(400).json({ ok: false, error: "no drops to voice — suggest verses first" });
  }
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  const id = req.params.id;
  clearCancelled(id);
  voicingStage(ctx, id).catch((e) => {
    try {
      const fresh = readProject(ctx.dataDir, id);
      if (fresh) writeProject(ctx.dataDir, { ...fresh, status: AMBIENT_STATUS.ERROR, error: String(e?.message || e) });
    } catch { /* already logged */ }
  });
  const started = writeProject(req.ctx.dataDir, { ...project, status: AMBIENT_STATUS.VOICING, error: null });
  return res.json({ ok: true, project: started });
});

// PATCH /:id/bed — bed settings, gated on licence.
router.patch("/:id/bed", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  try {
    const body = req.body || {};
    const bed = { ...project.bed };

    if (body.mode === "assemble" || body.mode === "file") bed.mode = body.mode;
    if (Array.isArray(body.trackRefs)) bed.trackRefs = body.trackRefs.map((r) => String(r)).filter(Boolean);
    if (body.filePath !== undefined) bed.filePath = body.filePath ? String(body.filePath) : null;
    // Refuse, rather than store, a path that is not yours: stored, it would
    // only fail at render time, or worse, succeed.
    const ctxDirs = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
    const bareRefs = [
      ...(Array.isArray(body.trackRefs) ? bed.trackRefs : []),
      ...(body.filePath ? [bed.filePath] : []),
    ].filter((r) => !/^(library|mylib):/.test(r));
    if (bareRefs.some((r) => !resolveTrackFile(ctxDirs, r))) {
      return res.status(400).json({ ok: false, error: "that audio file was not found in your uploads — upload it again" });
    }
    if (Number.isFinite(Number(body.volume))) bed.volume = Math.min(2, Math.max(0, Number(body.volume)));
    if (Number.isFinite(Number(body.crossfadeSec))) bed.crossfadeSec = Math.min(30, Math.max(0, Number(body.crossfadeSec)));

    const allowUncleared = body.allowUncleared === true;
    if (!allowUncleared) {
      const uncleared = unclearedTracks(req.ctx.dataDir, bed.trackRefs);
      if (uncleared.length > 0) {
        return res.status(409).json({
          ok: false,
          error: "some tracks have no recorded licence",
          uncleared,
        });
      }
    }
    bed.allowUncleared = allowUncleared;

    // Any change to the inputs invalidates a cached assembly. Leaving the old
    // hash would silently render yesterday's bed.
    const nextHash = bedHash({ trackRefs: bed.trackRefs, crossfadeSec: bed.crossfadeSec, targetSec: project.targetSec });
    if (nextHash !== project.bed?.builtHash) { bed.builtPath = null; bed.builtHash = null; }

    const updated = writeProject(req.ctx.dataDir, { ...project, bed });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /:id/images — one still per movement. Detached; the client polls.
router.post("/:id/images", imageQuota, (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (!(project.movements || []).length) {
    return res.status(400).json({ ok: false, error: "no movements to illustrate — suggest verses first" });
  }
  const onlyId = req.body?.movementId ? String(req.body.movementId) : null;
  if (onlyId && !project.movements.some((m) => m.id === onlyId)) {
    return res.status(404).json({ ok: false, error: "movement not found" });
  }
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  const id = req.params.id;
  const force = req.body?.force === true;
  clearCancelled(id);
  imagesStage(ctx, id, { force, onlyId }).catch((e) => {
    try {
      const fresh = readProject(ctx.dataDir, id);
      if (fresh) writeProject(ctx.dataDir, { ...fresh, status: AMBIENT_STATUS.ERROR, error: String(e?.message || e) });
    } catch { /* already logged */ }
  });
  const started = writeProject(req.ctx.dataDir, { ...project, status: AMBIENT_STATUS.GENERATING_IMAGES, error: null });
  return res.json({ ok: true, project: started });
});

// Stages that rewrite the movement list from their own copy; a change made
// underneath them would be silently overwritten.
const MOVEMENTS_BUSY = new Set([AMBIENT_STATUS.GENERATING_IMAGES, AMBIENT_STATUS.ASSEMBLING, AMBIENT_STATUS.RENDERING]);

// PUT /:id/movements/:movementId/image — your own picture on one movement,
// from an upload or your image library. See lib/ambient/movementImage.js.
router.put("/:id/movements/:movementId/image", async (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  const idx = (project.movements || []).findIndex((m) => m.id === req.params.movementId);
  if (idx < 0) return res.status(404).json({ ok: false, error: "movement not found" });
  if (MOVEMENTS_BUSY.has(project.status)) {
    return res.status(409).json({ ok: false, error: "wait for the current step to finish, then try again" });
  }
  try {
    const { dataDir, outputDir } = req.ctx;
    const got = await resolveMovementImage({
      dataDir, outputDir, project, body: req.body || {},
      items: readLibrary(dataDir).items, register: _imageLib.register,
    });
    if (!got.ok) return res.status(got.status).json({ ok: false, error: got.error });
    try { _imageLib.mark({ dataDir, id: got.entry.id }); } catch { /* stats only */ }

    // Checked again: POST /images can start while the upload is being copied,
    // and its own copy of the movement list would overwrite this one.
    const fresh = readProject(dataDir, project.projectId) || project;
    if (MOVEMENTS_BUSY.has(fresh.status)) {
      return res.status(409).json({ ok: false, error: "wait for the current step to finish, then try again" });
    }
    const movements = fresh.movements.map((m) => (m.id !== req.params.movementId ? m : {
      ...m,
      imagePath: got.entry.path,
      imageUrl: got.entry.publicUrl || null,
      imageStatus: "done",
      imageError: null,
      imageSource: got.source,
      imageLibraryId: got.entry.id,
      imageReuseScore: null,
    }));
    return res.json({ ok: true, project: writeProject(dataDir, { ...fresh, movements }) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /:id/library-images — pictures you can choose from: ids and URLs only.
router.get("/:id/library-images", (req, res) => {
  if (!loadOr404(req, res)) return undefined;
  return res.json({ ok: true, images: libraryImageView(readLibrary(req.ctx.dataDir).items).slice(0, 200) });
});

// PATCH /:id/captions — merged against the stored project so a partial update
// never clears a setting it omits.
router.patch("/:id/captions", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  try {
    const body = req.body || {};
    const merged = normaliseCaptionSettings(body, project);
    // `captions` is the render mode and sits outside normaliseCaptionSettings
    // (see the store); an unrecognised value keeps whatever is already stored
    // rather than silently turning captions off mid-project.
    const requestedMode = String(body.captions);
    const mode = CAPTION_MODES.includes(requestedMode)
      ? (requestedMode === "none" ? "none" : "static")
      : project.captions;
    // Unknown values keep what is stored, for the same reason as the mode.
    const captionSpan = CAPTION_SPANS.includes(body.captionSpan) ? body.captionSpan : project.captionSpan;
    const captionPosition = CAPTION_POSITIONS.includes(body.captionPosition) ? body.captionPosition : project.captionPosition;
    const updated = writeProject(req.ctx.dataDir, { ...project, ...merged, captions: mode, captionSpan, captionPosition });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /:id/render — assemble the bed and render, detached.
// Ahead of the quota, so a refused second click does not spend a render.
function notAlreadyRendering(req, res, next) {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (project && (project.status === AMBIENT_STATUS.ASSEMBLING || project.status === AMBIENT_STATUS.RENDERING)) {
    return res.status(409).json({ ok: false, error: "this session is already rendering" });
  }
  return next();
}

router.post("/:id/render", notAlreadyRendering, renderQuota, (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  try {
    const movements = project.movements || [];
    if (!movements.length || movements.some((m) => m.imageStatus !== "done" || !m.imagePath)) {
      return res.status(400).json({ ok: false, error: "every movement needs an image before render" });
    }
    const bed = project.bed || {};
    const hasBed = bed.mode === "file" ? Boolean(bed.filePath) : (bed.trackRefs || []).length > 0;
    if (!hasBed) return res.status(400).json({ ok: false, error: "choose the music before rendering" });

    const id = req.params.id;
    clearCancelled(id);
    const job = createJob(req.ctx.userId, { durationSec: project.targetSec });
    persistJob(req.ctx.dataDir, { ...job, projectId: id, status: "running" });

    const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
    const stage = _renderStageFn || renderStage;
    stage(ctx, id, job.jobId).catch((err) => {
      // A rejected fire-and-forget is an UNHANDLED rejection; under Node's
      // default policy that kills the server. Record it on the project.
      const message = String(err?.message || err || "render failed");
      try { markError(job.jobId, message); } catch { /* already errored */ }
      try {
        const fresh = readProject(ctx.dataDir, id);
        if (fresh) {
          writeProject(ctx.dataDir, {
            ...fresh,
            status: AMBIENT_STATUS.ERROR,
            error: message,
            render: { jobId: job.jobId, outputPath: null, status: "error", percent: 0, phase: "" },
          });
        }
        persistJob(ctx.dataDir, { ...job, projectId: id, status: "error", outputPath: null });
      } catch { /* the job registry already carries the error */ }
    });

    return res.json({ ok: true, jobId: job.jobId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /:id/cancel — halt whichever stage is running.
router.post("/:id/cancel", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  markCancelled(req.params.id);
  const jobId = project.render?.jobId;
  if (jobId) { try { cancelRenderJob(jobId, req.ctx.userId); } catch { /* already gone */ } }
  const updated = writeProject(req.ctx.dataDir, {
    ...project, status: AMBIENT_STATUS.ERROR, error: "Cancelled.",
  });
  return res.json({ ok: true, project: updated });
});

export default router;
