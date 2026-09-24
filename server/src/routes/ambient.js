import fs from "fs";
import { Router } from "express";

import {
  createProject, readProject, writeProject, listProjects, deleteProject,
  normaliseCaptionSettings, DEFAULT_DROP_INTERVAL_SEC, publishedEntry, withPublished,
  WORDS, isMusicOnly,
} from "../lib/ambient/projectStore.js";
import { bedHash } from "../lib/ambient/bedAssembly.js";
import { defaultDropTimes, normaliseDrops } from "../lib/ambient/drops.js";
import { planReferences } from "../lib/ambient/versePlan.js";
import { readLibrary } from "../lib/imageGen/imageLibrary.js";
import { libraryImageView, resolveMovementImage } from "../lib/ambient/movementImage.js";
import {
  AMBIENT_STATUS, voicingStage, imagesStage, renderStage,
  markCancelled, clearCancelled, writeWithMovements, unclearedTracks, resolveTrackFile, currentImageLib,
  outDirFor,
} from "../lib/ambient/stages.js";
import {
  createJob, persistJob, markError, cancelJob as cancelRenderJob, getJob as getRenderJob,
} from "../lib/renderJobs.js";
import { quota } from "../middleware/quota.js";

// The stages, their seams and the cancel registry live in lib/ambient/stages.js.
// Re-exported so callers and tests keep one import surface; the bindings are
// live, so a seam set through this module still reaches the stage that runs.
export {
  AMBIENT_STATUS, unclearedTracks, voicingStage, imagesStage, assembleBed, renderStage,
  markCancelled, isCancelled, clearCancelled,
  _setLookupImpl, _resetLookupImpl, _setSynthImpl, _resetSynthImpl,
  _setProbeImpl, _resetProbeImpl, _setImageGenImpl, _resetImageGenImpl,
  _setImageLibraryImpl, _resetImageLibraryImpl,
  _setLoudnessImpl, _resetLoudnessImpl, _setFfmpegSpawnImpl, _resetFfmpegSpawnImpl,
} from "../lib/ambient/stages.js";

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

const router = Router();

// ---------------------------------------------------------------- helpers

function loadOr404(req, res) {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) {
    res.status(404).json({ ok: false, error: "project not found" });
    return null;
  }
  return project;
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
// ffmpeg is writing into the session's folder. Both have Cancel on the page,
// and Cancel works even after a restart, so this is never a dead end. Voicing
// and pictures may be deleted mid-stage: the stage stops when its project is
// gone rather than writing it back.
const ENCODING_STATUSES = new Set([AMBIENT_STATUS.ASSEMBLING, AMBIENT_STATUS.RENDERING]);

// DELETE /:id — the project and its rendered files. Pictures stay: they live
// in the shared image library and other sessions may be using them.
router.delete("/:id", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (ENCODING_STATUSES.has(project.status)) {
    return res.status(409).json({ ok: false, error: "this session is rendering — cancel it first, then delete" });
  }
  // The URL id passed readProject's check; the file's own projectId did not.
  const id = req.params.id;
  try {
    // Files first: if one is locked, the session stays listed to retry.
    fs.rmSync(outDirFor(req.ctx.outputDir, id), { recursive: true, force: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: `could not remove the video files (${err?.code || "error"}) — try again` });
  }
  if (!deleteProject(req.ctx.dataDir, id)) return res.status(404).json({ ok: false, error: "project not found" });
  // The cancel flag is left for any stage still running to find.
  return res.json({ ok: true });
});

// POST /:id/published — remember an upload of this session's video, so the
// history can show where it went and the operator can publish it again.
router.post("/:id/published", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (project.status !== AMBIENT_STATUS.DONE) {
    return res.status(409).json({ ok: false, error: "only a finished session can be published" });
  }
  const entry = publishedEntry(req.body);
  if (!entry) return res.status(400).json({ ok: false, error: "videoId is not a YouTube video id" });
  const updated = writeProject(req.ctx.dataDir, withPublished(project, entry));
  return res.json({ ok: true, project: updated });
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
        ? { ...prev, ...incoming, text: null, verses: null, audioPath: null, durationMs: null, status: "pending", error: null }
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
  if (isMusicOnly(project)) {
    return res.status(400).json({ ok: false, error: "this session is music only — switch verses back on to voice them" });
  }
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
    if (body.order === "shuffle" || body.order === "fixed") bed.order = body.order;

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
    const nextHash = bedHash({ trackRefs: bed.trackRefs, crossfadeSec: bed.crossfadeSec, targetSec: project.targetSec, order: bed.order || "shuffle" });
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
      items: readLibrary(dataDir).items, register: currentImageLib().register,
    });
    if (!got.ok) return res.status(got.status).json({ ok: false, error: got.error });
    try { currentImageLib().mark({ dataDir, id: got.entry.id }); } catch { /* stats only */ }

    // Checked again: POST /images can start while the upload is being copied,
    // and its own copy of the movement list would overwrite this one.
    const fresh = readProject(dataDir, project.projectId);
    // Deleted while the upload was copied: don't write it back.
    if (!fresh) return res.status(404).json({ ok: false, error: "project not found" });
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

// PATCH /:id/motion — still, or a gentle drift (see ambientMotion.js).
const MOTIONS = ["still", "drift"];
router.patch("/:id/motion", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  const motion = req.body?.motion;
  if (!MOTIONS.includes(motion)) {
    return res.status(400).json({ ok: false, error: "motion must be still or drift" });
  }
  // The encode already running has its picture chain; a write now would also
  // race the render stage's own progress writes.
  if (ENCODING_STATUSES.has(project.status)) {
    return res.status(409).json({ ok: false, error: "this session is rendering; change the motion when it finishes" });
  }
  try {
    return res.json({ ok: true, project: writeProject(req.ctx.dataDir, { ...project, motion }) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PATCH /:id/words — spoken verses over the music, or music only.
router.patch("/:id/words", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  const words = req.body?.words;
  if (!WORDS.includes(words)) {
    return res.status(400).json({ ok: false, error: "words must be verses or none" });
  }
  if (ENCODING_STATUSES.has(project.status)) {
    return res.status(409).json({ ok: false, error: "this session is rendering; change it when it finishes" });
  }
  try {
    return res.json({ ok: true, project: writeWithMovements(req.ctx.dataDir, { ...project, words }) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
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
