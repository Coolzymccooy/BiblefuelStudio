import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import { quota } from "../middleware/quota.js";
import { runExclusive } from "../lib/heavyJobGate.js";
import { createJob, persistJob, markError, getJob, cancelJob } from "../lib/renderJobs.js";
import { refineScript } from "../lib/story/scriptRefine.js";
import { cleanSpeakableText } from "../lib/speakableScript.js";
import { synthesizeEdgeTts } from "../lib/edgeTts.js";
import { STYLES } from "../lib/motion/styles.js";
import { normaliseSeed } from "../lib/kinetic/renderCaptions.js";
import {
  OCCASIONS, LENGTHS, STATEMENT_LIMIT, TITLE_MAX, STATEMENT_MAX, DETAIL_MAX, MAX_STATEMENTS, resolveOccasion,
} from "../lib/moments/occasions.js";
import {
  createProject, readProject, writeProject, listProjects, deleteProject, applyUpdate, isRendering, MIN_PHOTOS, MAX_PHOTOS,
} from "../lib/moments/projectStore.js";
import { resolvePhotos, resolveSong } from "../lib/moments/photos.js";
import { songGrid } from "../lib/moments/beatCache.js";
import { readLibrary } from "../lib/imageGen/imageLibrary.js";
import { libraryImageView } from "../lib/ambient/movementImage.js";
import { suggestStatements } from "../lib/moments/statements.js";
import { momentRenderStage, cancelMomentRender, VOICE_NAME, OUTPUT_NAME } from "../lib/moments/renderStage.js";

/**
 * Moments: one-tap photo videos for birthdays, sermons and events.
 *
 * Mounted WITHOUT a blanket quota (see index.js): the page polls GET /:id
 * while a render runs, and a per-request charge would empty a free user's
 * allowance in seconds. Each expensive POST charges its own bucket inline,
 * after its own checks pass.
 */
let _quota = quota;
export function _setQuotaImpl(fn) { _quota = fn; }
export function _resetQuotaImpl() { _quota = quota; }
let _renderStage = momentRenderStage;
export function _setRenderStageImpl(fn) { _renderStage = fn; }
export function _resetRenderStageImpl() { _renderStage = momentRenderStage; }
let _tts = synthesizeEdgeTts;
export function _setTtsImpl(fn) { _tts = fn; }
export function _resetTtsImpl() { _tts = synthesizeEdgeTts; }

const SCRIPT_MAX = 1200;
// The abort handle of each project's in-flight render run (queued or running), so Cancel can
// reach a run that is still waiting for the heavy-job gate.
const queuedRuns = new Map();
const router = Router();

function charged(bucket, req, res) {
  let passed = false;
  _quota(bucket)(req, res, () => { passed = true; });
  return passed;
}

function loadOr404(req, res) {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) res.status(404).json({ ok: false, error: "Moment not found" });
  return project;
}

/** The stored project as the client sees it: live percent, and a dead job as interrupted. */
function view(project) {
  const r = project.render;
  if (r?.status !== "running" || !r.jobId) return project;
  const job = getJob(r.jobId);
  if (!job) return { ...project, render: { ...r, status: "interrupted" } };
  return typeof job.percent === "number" ? { ...project, render: { ...r, percent: Math.max(r.percent || 0, job.percent) } } : project;
}

function removeOutput(outputDir, name, pattern) {
  if (!pattern.test(String(name || ""))) return;
  try { fs.unlinkSync(path.join(outputDir, name)); } catch { /* already gone */ }
}

router.get("/meta", (_req, res) => {
  res.json({
    ok: true,
    occasions: Object.values(OCCASIONS).map(({ id, label, church, fields, style, energy, song }) => ({ id, label, church, fields, style, energy, song })),
    styles: Object.values(STYLES).map(({ id, label, description }) => ({ id, label, description })),
    lengths: LENGTHS,
    limits: {
      statements: STATEMENT_LIMIT, maxStatements: MAX_STATEMENTS, title: TITLE_MAX, statement: STATEMENT_MAX,
      detail: DETAIL_MAX, minPhotos: MIN_PHOTOS, maxPhotos: MAX_PHOTOS,
    },
  });
});

router.get("/", (req, res) => res.json({ ok: true, projects: listProjects(req.ctx.dataDir) }));

router.get("/library-images", (req, res) => {
  res.json({ ok: true, images: libraryImageView(readLibrary(req.ctx.dataDir)?.items || []) });
});

router.post("/", (req, res) => {
  if (!resolveOccasion(req.body?.occasion)) return res.status(400).json({ ok: false, error: "choose an occasion" });
  return res.json({ ok: true, project: createProject(req.ctx.dataDir, { occasion: req.body.occasion }) });
});

router.get("/:id", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  return res.json({ ok: true, project: view(project) });
});

// The song's length and its best window at this Moment's length, for the
// "start at" slider. Cached by content hash, so only the first call decodes.
let _songGridFn = songGrid;
export function _setSongGridImpl(fn) { _songGridFn = fn; }
export function _resetSongGridImpl() { _songGridFn = songGrid; }
router.get("/:id/song-window", async (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  const song = project.sound?.song;
  const file = song ? resolveSong(req.ctx, song.ref) : null;
  if (!file) return res.status(400).json({ ok: false, error: "choose a song first" });
  try {
    const auto = await _songGridFn(req.ctx, file, { lengthSec: project.lengthSec });
    const chosen = song.windowStartSec === null
      ? auto
      : await _songGridFn(req.ctx, file, { lengthSec: project.lengthSec, windowStartSec: song.windowStartSec });
    return res.json({
      ok: true, durationSec: auto.durationSec, tempo: auto.tempo, windowStartSec: chosen.windowStartSec, autoStartSec: auto.windowStartSec,
    });
  } catch (e) {
    console.error(`[moments] song window ${project.projectId}:`, e);
    return res.status(422).json({ ok: false, error: "That song couldn't be read. Pick another song." });
  }
});

router.put("/:id", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (isRendering(view(project))) return res.status(409).json({ ok: false, error: "this Moment is rendering" });
  const body = { ...(req.body ?? {}) };
  if ("photos" in body) {
    if (!Array.isArray(body.photos)) return res.status(400).json({ ok: false, error: "photos must be a list" });
    if (body.photos.length > MAX_PHOTOS) return res.status(400).json({ ok: false, error: `up to ${MAX_PHOTOS} photos` });
    const resolved = resolvePhotos(req.ctx, body.photos);
    if (!resolved.ok) return res.status(400).json({ ok: false, error: resolved.error });
    body.photos = resolved.photos;
  }
  const r = applyUpdate(project, body);
  if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
  const saved = writeProject(req.ctx.dataDir, r.project);
  // Removing the voiceover also removes its file; it is an orphan nothing else points at.
  if (saved.sound?.voiceover === null) removeOutput(req.ctx.outputDir, project.sound?.voiceover?.file, VOICE_NAME);
  return res.json({ ok: true, project: saved });
});

router.delete("/:id", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (isRendering(view(project))) return res.status(409).json({ ok: false, error: "this Moment is rendering" });
  for (const h of project.history || []) removeOutput(req.ctx.outputDir, path.basename(String(h.file || "")), OUTPUT_NAME);
  removeOutput(req.ctx.outputDir, project.sound?.voiceover?.file, VOICE_NAME);
  deleteProject(req.ctx.dataDir, project.projectId);
  return res.json({ ok: true });
});

router.post("/:id/statements", async (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (!charged("scripts", req, res)) return undefined;
  const suggestion = await suggestStatements({ occasion: project.occasion, details: project.details, lengthSec: project.lengthSec });
  return res.json({ ok: true, suggestion });
});

router.post("/:id/voiceover", async (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (isRendering(view(project))) return res.status(409).json({ ok: false, error: "this Moment is rendering" });
  const input = req.body ?? {};
  const typed = String(input.script || "").trim();
  const idea = String(input.idea || "").trim();
  if (!typed && idea.length < 3) return res.status(400).json({ ok: false, error: "write the voiceover, or describe it for the AI" });
  if (typed.length > SCRIPT_MAX || idea.length > SCRIPT_MAX) return res.status(400).json({ ok: false, error: `up to ${SCRIPT_MAX} characters` });
  if (typed && cleanSpeakableText(typed).length < 3) return res.status(400).json({ ok: false, error: "the voiceover is empty" });
  if (!charged("tts", req, res)) return undefined;
  try {
    const occ = resolveOccasion(project.occasion);
    const raw = typed || await refineScript({ idea, template: { prompt: occ?.voicePrompt || "", targetSeconds: Math.max(8, project.lengthSec - 3) } });
    const script = cleanSpeakableText(raw).slice(0, SCRIPT_MAX);
    const voiceId = input.voiceId ? String(input.voiceId).slice(0, 100) : undefined;
    let tts;
    try {
      tts = await _tts({ text: script, voiceId });
    } catch (e) {
      // Edge TTS throws for a disabled service or unusable text; those are the caller's to fix.
      const message = String(e?.message || e);
      return res.status(/disabled|required/i.test(message) ? 400 : 500).json({ ok: false, error: message });
    }
    if (!tts?.ok || !tts.file) return res.status(502).json({ ok: false, error: tts?.error || "voice synthesis failed" });
    fs.mkdirSync(req.ctx.outputDir, { recursive: true });
    const name = `moment-vo-${crypto.randomUUID()}.mp3`;
    const dest = path.join(req.ctx.outputDir, name);
    try { fs.renameSync(tts.file, dest); } catch { fs.copyFileSync(tts.file, dest); try { fs.unlinkSync(tts.file); } catch { /* temp file */ } }
    const live = readProject(req.ctx.dataDir, project.projectId);
    removeOutput(req.ctx.outputDir, live.sound?.voiceover?.file, VOICE_NAME);
    const saved = writeProject(req.ctx.dataDir, { ...live, sound: { ...live.sound, voiceover: { script, voiceId: voiceId || null, file: name } } });
    return res.json({ ok: true, project: saved });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/:id/render", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  if (isRendering(view(project))) return res.status(409).json({ ok: false, error: "this Moment is already rendering" });
  if ((project.photos || []).length < MIN_PHOTOS) return res.status(400).json({ ok: false, error: `add at least ${MIN_PHOTOS} photos` });
  const input = req.body ?? {};
  const seed = input.seed === undefined ? project.seed : normaliseSeed(input.seed);
  if (!charged("render", req, res)) return undefined;

  const job = createJob(req.ctx.userId, { durationSec: project.lengthSec });
  persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: "running" });
  writeProject(req.ctx.dataDir, { ...project, render: { jobId: job.jobId, status: "running", percent: 0, stage: "waiting" } });
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir, userId: req.ctx.userId };
  const id = project.projectId;
  // Aborting this controller removes a still-queued run from the gate; once the stage is running
  // it is the stage's own signal.
  const controller = new AbortController();
  queuedRuns.set(id, controller);
  const ownsRender = (live) => live?.render?.jobId === job.jobId;
  runExclusive(() => _renderStage(ctx, id, job.jobId, { seed, signal: controller.signal }), {
    signal: controller.signal,
    onQueued: () => {
      const live = readProject(ctx.dataDir, id);
      if (ownsRender(live)) writeProject(ctx.dataDir, { ...live, render: { ...live.render, stage: "waiting for another video to finish" } });
    },
  }).catch((err) => {
    // A rejected fire-and-forget is an unhandled rejection, which kills the server.
    const cancelled = String(err?.message) === "Cancelled.";
    const message = cancelled ? "Cancelled." : "Something went wrong while making this Moment. Please try again.";
    if (!cancelled) console.error(`[moments] render ${id} rejected:`, err);
    try { markError(job.jobId, message); } catch { /* already errored */ }
    const live = readProject(ctx.dataDir, id);
    if (ownsRender(live)) writeProject(ctx.dataDir, { ...live, render: { jobId: job.jobId, status: "error", percent: 0, stage: "error", error: message } });
  }).finally(() => {
    if (queuedRuns.get(id) === controller) queuedRuns.delete(id);
  });
  return res.json({ ok: true, jobId: job.jobId });
});

router.post("/:id/cancel", (req, res) => {
  const project = loadOr404(req, res);
  if (!project) return undefined;
  queuedRuns.get(project.projectId)?.abort();
  cancelMomentRender(project.projectId);
  if (project.render?.jobId) { try { cancelJob(project.render.jobId, req.ctx.userId); } catch { /* gone */ } }
  return res.json({ ok: true });
});

export default router;
