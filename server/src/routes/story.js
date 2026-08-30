import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import {
  createProject, readProject, writeProject, listProjects, deleteProject, STORY_STATUS,
} from "../lib/story/projectStore.js";
import { segmentScenes } from "../lib/story/sceneSegmenter.js";
import { runStoryRender, probeAudioDurationSec } from "../lib/story/storyRender.js";
import { createJob, persistJob, cancelJob as cancelRenderJob, getJob as getRenderJob } from "../lib/renderJobs.js";
import { generateBibleImage } from "../lib/imageGen/index.js";
import { extractAudioToMp3 } from "../lib/transcode.js";
import {
  transcribeAudio, chunkAudioForTranscription, stitchTranscriptions,
} from "../lib/voice/alignment.js";
import { refineScript } from "../lib/story/scriptRefine.js";
import { templateById } from "../lib/story/scriptTemplates.js";
import { synthesizeEdgeTts } from "../lib/edgeTts.js";
import { resolveLibraryTrack } from "../lib/musicLibrary.js";
import { cleanCaptionLine, cleanSpeakableText } from "../lib/speakableScript.js";
import { buildImportedTranscript } from "../lib/story/scriptImport.js";
import { CHARACTER_ANCHORS } from "../lib/story/styleAnchors.js";

// Mockable seams (mirror routes/transcribe.js).
let _transcribeFn = transcribeAudio;
export function _setTranscribeImpl(impl) { _transcribeFn = impl; }
export function _resetTranscribeImpl() { _transcribeFn = transcribeAudio; }

let _imageGenFn = generateBibleImage;
export function _setImageGenImpl(impl) { _imageGenFn = impl; }
export function _resetImageGenImpl() { _imageGenFn = generateBibleImage; }

let _ttsFn = synthesizeEdgeTts;
export function _setTtsImpl(impl) { _ttsFn = impl; }
export function _resetTtsImpl() { _ttsFn = synthesizeEdgeTts; }

// Confine a user-supplied mediaPath to the caller's own dirs (anti path-traversal).
function confineMediaPath(ctx, rawMediaPath) {
  const raw = String(rawMediaPath || "").trim();
  if (!raw) return { ok: false, status: 400, error: "mediaPath required" };
  const resolved = path.resolve(raw);
  const roots = [path.resolve(ctx.outputDir), path.resolve(ctx.dataDir)];
  const within = roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
  if (!within) return { ok: false, status: 403, error: "mediaPath is outside the allowed directory" };
  if (!fs.existsSync(resolved)) return { ok: false, status: 400, error: "mediaPath not found" };
  return { ok: true, path: resolved };
}

// --- Pipeline stages (re-entrant). ctx = { dataDir, outputDir }. ---
async function transcribeStage(ctx, projectId, mediaPath) {
  const project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");
  if (project.transcript?.words?.length) {
    return writeProject(ctx.dataDir, { ...project, status: STORY_STATUS.SEGMENTING });
  }
  writeProject(ctx.dataDir, { ...project, status: STORY_STATUS.TRANSCRIBING, error: null });
  const isVideo = VIDEO_EXT.has(path.extname(mediaPath).toLowerCase());
  const audioPath = isVideo ? await extractAudioToMp3(mediaPath, ctx.outputDir) : mediaPath;
  const chunks = await chunkAudioForTranscription(audioPath, ctx.outputDir, 0);
  const transcribed = await Promise.all(
    chunks.map(async (c) => ({ offsetMs: c.offsetMs, transcription: await _transcribeFn(c.path) })),
  );
  const stitched = stitchTranscriptions(transcribed);
  if (!stitched.words.length) {
    writeProject(ctx.dataDir, { ...readProject(ctx.dataDir, projectId), status: STORY_STATUS.ERROR, error: "transcription returned no words" });
    throw new Error("Transcription returned no words");
  }
  const durationMs = stitched.words[stitched.words.length - 1].endMs;
  return writeProject(ctx.dataDir, {
    ...readProject(ctx.dataDir, projectId),
    source: { audioPath, durationMs },
    transcript: { words: stitched.words, hash: String(durationMs) + ":" + stitched.words.length },
    status: STORY_STATUS.SEGMENTING,
  });
}

async function segmentStage(ctx, projectId) {
  const project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");
  if (project.scenes?.length) {
    return writeProject(ctx.dataDir, { ...project, status: STORY_STATUS.GENERATING_IMAGES });
  }
  const words = project.transcript?.words || [];
  if (!words.length) throw new Error("no transcript to segment");
  const scenes = await segmentScenes({ words, style: project.style, cast: project.cast || [] });
  return writeProject(ctx.dataDir, { ...project, scenes, status: STORY_STATUS.GENERATING_IMAGES });
}

// Bounded concurrency + per-image timeout for the image stage. Reads env each
// call so deploys (and tests) can tune without a code change.
//   STORY_IMAGE_CONCURRENCY — images generated at once (default 4)
//   STORY_IMAGE_TIMEOUT_MS   — give up on a single image after this long
function imageStageConcurrency() {
  return Math.max(1, Math.min(8, Number(process.env.STORY_IMAGE_CONCURRENCY) || 4));
}
function imageStageTimeoutMs() {
  return Math.max(1000, Number(process.env.STORY_IMAGE_TIMEOUT_MS) || 90_000);
}

// Projects the user asked to cancel mid-pipeline. imagesStage checks this
// between images so a long (or rogue) run stops promptly instead of grinding
// through every remaining scene.
const cancelledProjects = new Set();

// Translate a raw provider error into a short, user-facing reason. The most
// common real-world failure is the daily free image quota running out — the
// previous UI just showed "image failed" with no explanation.
function shortImageError(raw) {
  const msg = String(raw || "image generation failed");
  // Quota first — it's the most common real failure and the most actionable
  // ("wait for the daily reset, or upgrade"). The combined provider error can
  // ALSO contain Imagen's "paid plan" text, but the primary blocker is the
  // free-tier quota, so this message must win.
  if (/\b429\b|quota|rate.?limit|exceed|insufficient|neuron|allocation|capacity|too many/i.test(msg)) {
    return "Daily free image quota used up — resets each day, or upgrade the Cloudflare Workers AI plan.";
  }
  if (/only available on|\bpaid\b|billed|billing|permission|FAILED_PRECONDITION|not.?configured|no image.?gen providers/i.test(msg)) {
    return "Image provider isn't available — configure Cloudflare Workers AI or a billed Imagen key on the server.";
  }
  if (/timed out|timeout/i.test(msg)) return "Image generation timed out — try again.";
  if (/safety|\brai\b|filter/i.test(msg)) return "Blocked by the provider's safety filter — edit the image prompt.";
  return msg.slice(0, 200);
}

// Resolve `promise`, or reject once `ms` elapses. The underlying generation
// call isn't cancelled (the providers take no AbortSignal yet), but the
// pipeline stops waiting on it — one hung request can no longer freeze the
// whole render. unref()'d so a pending timer never holds the process open.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message || `timed out after ${ms}ms`)), ms);
    if (timer?.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function imagesStage(ctx, projectId, opts = {}) {
  const force = Boolean(opts.force);
  const project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");

  // Force mode regenerates EVERY scene from scratch — purge the cached images
  // first (generateBibleImage caches by {projectId, partNumber}, so without
  // this it would just return the same files).
  if (force) {
    const safeId = String(project.projectId).replace(/[^a-z0-9_-]/gi, "");
    try {
      fs.rmSync(path.join(ctx.outputDir, "genImg", safeId), { recursive: true, force: true });
    } catch (e) {
      console.warn(`[story] force-regenerate cache cleanup failed for ${safeId}: ${e?.message || e}`);
    }
  }

  // Single shared, mutated-in-place scenes array. writeProject is fully
  // synchronous (writeFileSync + renameSync), and JS is single-threaded, so
  // incremental writes from the concurrent workers below can't interleave or
  // clobber each other — each persists the latest full array.
  const scenes = [...(project.scenes || [])];

  const pending = [];
  for (let i = 0; i < scenes.length; i++) {
    const alreadyDone = scenes[i].imageStatus === "done" && scenes[i].imagePath;
    if (alreadyDone && !force) continue; // retry-failed reruns error/pending; force reruns all
    scenes[i] = { ...scenes[i], imageStatus: "generating", imageError: null, ...(force ? { imagePath: null, imageUrl: null } : {}) };
    pending.push(i);
  }
  writeProject(ctx.dataDir, { ...project, scenes, status: STORY_STATUS.GENERATING_IMAGES });

  const timeoutMs = imageStageTimeoutMs();
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      if (cancelledProjects.has(projectId)) return; // stop promptly on cancel
      const i = pending[cursor++];
      let result;
      try {
        result = await withTimeout(
          _imageGenFn({ seriesId: project.projectId, partNumber: i + 1, rawPrompt: scenes[i].imagePrompt, aspect: "portrait" }),
          timeoutMs,
          `image gen for scene ${i + 1} timed out after ${timeoutMs}ms`,
        );
      } catch (err) {
        console.warn(`[story] scene ${i + 1} image gen failed: ${err?.message || err}`);
        result = { ok: false, error: String(err?.message || err) };
      }
      scenes[i] = result?.ok
        ? { ...scenes[i], imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done", imageError: null }
        : { ...scenes[i], imageStatus: "error", imageError: shortImageError(result?.error) };
      writeProject(ctx.dataDir, { ...project, scenes });
    }
  };

  const workerCount = Math.min(imageStageConcurrency(), Math.max(1, pending.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (cancelledProjects.has(projectId)) {
    cancelledProjects.delete(projectId);
    return writeProject(ctx.dataDir, { ...project, scenes, status: STORY_STATUS.ERROR, error: "Cancelled." });
  }

  const allDone = scenes.every((s) => s.imageStatus === "done");
  return writeProject(ctx.dataDir, { ...project, scenes, status: allDone ? STORY_STATUS.READY_TO_RENDER : STORY_STATUS.GENERATING_IMAGES });
}

/** Run the whole pipeline server-side. Awaitable; the route fires it detached. */
export async function runStoryPipeline(ctx, projectId, mediaPath) {
  await transcribeStage(ctx, projectId, mediaPath);
  await segmentStage(ctx, projectId);
  await imagesStage(ctx, projectId);
}

const router = Router();
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function storyOutDir(outputDir, projectId) {
  return path.join(outputDir, "story", String(projectId).replace(/[^a-z0-9_-]/gi, ""));
}

router.post("/", (req, res) => {
  try {
    const { title, style, cast } = req.body || {};
    const project = createProject(req.ctx.dataDir, { title, style, cast });
    return res.json({ ok: true, project });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/", (req, res) => {
  return res.json({ ok: true, projects: listProjects(req.ctx.dataDir) });
});

// NOTE: must precede the "/:id" route below — Express matches in declaration
// order, so a dynamic ":id" placed first would swallow "/characters".
// GET /characters — the cast options the UI offers. Returned from the server
// so the list stays in one place; adding a character needs no client change.
router.get("/characters", (_req, res) => {
  res.json({
    ok: true,
    characters: Object.entries(CHARACTER_ANCHORS).map(([key, description]) => ({ key, description })),
  });
});

router.get("/:id", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  // Enrich with the LIVE render progress (kept in the in-memory job registry,
  // not persisted per-tick). `percent` present ⇒ the render is actually alive
  // in this process; absent while status==="rendering" ⇒ the job died (e.g.
  // server restart) and the UI should offer Resume rather than a fake bar.
  let out = project;
  if (project.status === STORY_STATUS.RENDERING && project.render?.jobId) {
    const job = getRenderJob(project.render.jobId);
    if (job) {
      out = { ...project, render: { ...project.render, percent: job.percent, phase: job.phase } };
    }
  }
  return res.json({ ok: true, project: out });
});

router.delete("/:id", (req, res) => {
  try {
    const existed = deleteProject(req.ctx.dataDir, req.params.id);
    if (!existed) return res.status(404).json({ ok: false, error: "project not found" });
    const safeId = String(req.params.id).replace(/[^a-z0-9_-]/gi, "");
    for (const sub of ["story", "genImg"]) {
      try {
        fs.rmSync(path.join(req.ctx.outputDir, sub, safeId), { recursive: true, force: true });
      } catch (e) {
        console.warn(`[story] asset cleanup (${sub}/${safeId}) failed: ${e?.message || e}`);
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/:id/transcribe", async (req, res) => {
  try {
    if (!readProject(req.ctx.dataDir, req.params.id)) return res.status(404).json({ ok: false, error: "project not found" });
    const guard = confineMediaPath(req.ctx, req.body?.mediaPath);
    if (!guard.ok) return res.status(guard.status).json({ ok: false, error: guard.error });
    const updated = await transcribeStage({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, req.params.id, guard.path);
    return res.json({ ok: true, project: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    return res.status(/no words/i.test(msg) ? 502 : 500).json({ ok: false, error: msg });
  }
});

// POST /script-to-audio — idea + template -> refined narration -> Edge TTS mp3,
// moved into the caller's output dir so it passes the /transcribe guard.
router.post("/script-to-audio", async (req, res) => {
  try {
    const idea = String(req.body?.idea || "").trim();
    if (idea.length < 3) return res.status(400).json({ ok: false, error: "idea is required" });
    const template = templateById(req.body?.templateId);
    const voiceId = req.body?.voiceId ? String(req.body.voiceId) : undefined;

    const rawScript = await refineScript({ idea, template });
    const script = cleanSpeakableText(rawScript || idea);
    if (script.length < 3) return res.status(400).json({ ok: false, error: "script is empty after formatting" });
    const tts = await _ttsFn({ text: script, voiceId });
    if (!tts?.ok || !tts.file) {
      return res.status(502).json({ ok: false, error: tts?.error || "voice synthesis failed" });
    }

    if (!fs.existsSync(req.ctx.outputDir)) fs.mkdirSync(req.ctx.outputDir, { recursive: true });
    const dest = path.join(req.ctx.outputDir, `story-tts-${uuid()}.mp3`);
    try {
      fs.renameSync(tts.file, dest);
    } catch {
      fs.copyFileSync(tts.file, dest);
      try { fs.unlinkSync(tts.file); } catch {}
    }
    return res.json({ ok: true, file: dest.replace(/\\/g, "/"), script });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = /disabled|required/i.test(msg) ? 400 : 500;
    return res.status(status).json({ ok: false, error: msg });
  }
});

// POST /import-script — create a Story project from text that is ALREADY
// written (a Gumroad devotional day, a Series part), rather than from uploaded
// media.
//
// Unlike /script-to-audio this does NOT run the text through refineScript: the
// caller's words are authoritative. A devotional the operator generated and
// reviewed should not be silently rewritten on its way to video.
//
// The narration's own word timings are written straight into the project, so
// transcribeStage short-circuits and the pipeline resumes at segmentation —
// no lossy speech-recognition round trip over words we already have.
//
// Body: { script, audioPath, durationMs, words?, title?, style? }
// Returns a project already at SEGMENTING; the client then calls
// /:id/segment and /:id/images exactly as the media path does.
// PATCH /:id/cast — set which figures appear in this story.
//
// Changing the cast only affects prompts built AFTERWARDS, so scenes already
// generated keep their old images until they are regenerated. The response
// says so explicitly rather than leaving the operator to wonder why the
// existing images did not change.
router.patch("/:id/cast", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });

  const incoming = req.body?.cast;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ ok: false, error: "cast must be an array of character keys" });
  }

  const known = new Set(Object.keys(CHARACTER_ANCHORS));
  const cast = [...new Set(incoming.map((k) => String(k).trim().toLowerCase()))].filter((k) => known.has(k));
  const rejected = incoming.filter((k) => !known.has(String(k).trim().toLowerCase()));

  const updated = writeProject(req.ctx.dataDir, { ...project, cast });
  const generated = (updated.scenes || []).filter((s) => s.imageStatus === "done").length;
  return res.json({
    ok: true,
    project: updated,
    rejected,
    note: generated > 0
      ? `${generated} scene image(s) already generated — regenerate them to apply the new cast.`
      : "",
  });
});

router.post("/import-script", (req, res) => {
  try {
    const script = String(req.body?.script || "").trim();
    if (script.length < 3) return res.status(400).json({ ok: false, error: "script is required" });

    const audioPath = String(req.body?.audioPath || "").trim();
    if (!audioPath) return res.status(400).json({ ok: false, error: "audioPath is required" });

    const durationMs = Number(req.body?.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return res.status(400).json({ ok: false, error: "durationMs must be a positive number" });
    }

    let patch;
    try {
      patch = buildImportedTranscript({ script, audioPath, durationMs, words: req.body?.words });
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e?.message || e) });
    }

    const project = createProject(req.ctx.dataDir, {
      title: req.body?.title || script.slice(0, 60),
      style: req.body?.style,
      cast: req.body?.cast,
    });

    const ready = writeProject(req.ctx.dataDir, {
      ...project,
      ...patch,
      status: STORY_STATUS.SEGMENTING,
    });

    return res.json({ ok: true, project: ready });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/:id/segment", async (req, res) => {
  try {
    const updated = await segmentStage({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, req.params.id);
    return res.json({ ok: true, project: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    const status = /not found/i.test(msg) ? 404 : /no transcript/i.test(msg) ? 400 : 500;
    return res.status(status).json({ ok: false, error: msg });
  }
});

// POST /:id/images — (re)generate scene images. Runs DETACHED and returns
// immediately so it isn't killed by the ~100s edge timeout when a long video
// has dozens of images; the client polls the project for progress.
//   body/query `force=true` → regenerate EVERY scene from scratch (purges cache)
//   otherwise               → retry only failed/pending scenes
router.post("/:id/images", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (!(project.scenes || []).length) return res.status(400).json({ ok: false, error: "no scenes to generate — segment first" });
  const force = req.body?.force === true || String(req.query?.force || "") === "true";

  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  const id = req.params.id;
  cancelledProjects.delete(id); // a fresh run supersedes any earlier cancel
  imagesStage(ctx, id, { force }).catch((e) => {
    try {
      const fresh = readProject(ctx.dataDir, id);
      if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
    } catch {}
  });
  // Reflect the in-flight state immediately so the UI shows progress, not idle.
  writeProject(ctx.dataDir, { ...project, status: STORY_STATUS.GENERATING_IMAGES, error: null });
  return res.json({ ok: true, project: readProject(ctx.dataDir, id) });
});

// POST /:id/cancel — stop an in-flight pipeline/render that's running long or
// has gone rogue. Flags the project so imagesStage halts between images, and
// kills the render ffmpeg if one is active.
router.post("/:id/cancel", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  cancelledProjects.add(req.params.id);
  const jobId = project.render?.jobId;
  if (jobId) { try { cancelRenderJob(jobId, req.ctx.userId); } catch {} }
  const updated = writeProject(req.ctx.dataDir, { ...project, status: STORY_STATUS.ERROR, error: "Cancelled." });
  return res.json({ ok: true, project: updated });
});

// POST /:id/process — run transcribe -> segment -> images SERVER-SIDE, detached.
router.post("/:id/process", (req, res) => {
  if (!readProject(req.ctx.dataDir, req.params.id)) return res.status(404).json({ ok: false, error: "project not found" });
  const guard = confineMediaPath(req.ctx, req.body?.mediaPath);
  if (!guard.ok) return res.status(guard.status).json({ ok: false, error: guard.error });
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  const id = req.params.id;
  cancelledProjects.delete(id);
  runStoryPipeline(ctx, id, guard.path).catch((e) => {
    try {
      const fresh = readProject(ctx.dataDir, id);
      if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
    } catch {}
  });
  return res.json({ ok: true });
});

// POST /:id/resegment — discard the current scenes and rebuild them from the
// EXISTING transcript, then regenerate images. Lets a project created before
// the scene-count cap (e.g. a 200-scene render that never finished) adopt the
// "fewer, longer scenes" behaviour without re-uploading or re-transcribing.
router.post("/:id/resegment", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (!project.transcript?.words?.length) {
    return res.status(400).json({ ok: false, error: "no transcript to re-segment — start again" });
  }
  const audioPath = project.source?.audioPath;
  if (!audioPath) {
    return res.status(400).json({ ok: false, error: "missing source audio — start again" });
  }

  // Purge cached generated images. They're keyed by { projectId, partNumber }
  // (generateBibleImage caches part-N.png), so without this the new scenes
  // would silently reuse the OLD images that no longer match their prompts.
  const safeId = String(project.projectId).replace(/[^a-z0-9_-]/gi, "");
  try {
    fs.rmSync(path.join(req.ctx.outputDir, "genImg", safeId), { recursive: true, force: true });
  } catch (e) {
    console.warn(`[story] resegment image-cache cleanup failed for ${safeId}: ${e?.message || e}`);
  }

  // Clear scenes so segmentStage re-runs (it short-circuits when scenes exist).
  writeProject(req.ctx.dataDir, { ...project, scenes: [], status: STORY_STATUS.SEGMENTING, error: null });

  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  const id = req.params.id;
  cancelledProjects.delete(id);
  runStoryPipeline(ctx, id, audioPath).catch((e) => {
    try {
      const fresh = readProject(ctx.dataDir, id);
      if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
    } catch {}
  });
  return res.json({ ok: true });
});

router.post("/:id/scenes/:sid/regenerate", async (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const idx = (project.scenes || []).findIndex((s) => s.id === req.params.sid);
    if (idx < 0) return res.status(404).json({ ok: false, error: "scene not found" });
    const scenes = [...project.scenes];
    scenes[idx] = { ...scenes[idx], imageStatus: "generating" };
    const result = await _imageGenFn({
      seriesId: `${project.projectId}-${req.params.sid}-${Date.now()}`,
      partNumber: 1,
      rawPrompt: scenes[idx].imagePrompt,
      aspect: "portrait",
    });
    scenes[idx] = result?.ok
      ? { ...scenes[idx], imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done", imageError: null }
      : { ...scenes[idx], imageStatus: "error", imageError: shortImageError(result?.error) };
    const updated = writeProject(req.ctx.dataDir, { ...project, scenes });
    // ok=false on the *scene* (not the request) so the client can show the
    // real reason instead of a misleading "regenerated" success.
    return res.json({ ok: true, project: updated, sceneOk: Boolean(result?.ok), sceneError: result?.ok ? null : shortImageError(result?.error) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.patch("/:id/scenes/:sid", (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const idx = (project.scenes || []).findIndex((s) => s.id === req.params.sid);
    if (idx < 0) return res.status(404).json({ ok: false, error: "scene not found" });
    const scenes = [...project.scenes];
    const patch = {};
    if (typeof req.body?.text === "string") patch.text = cleanCaptionLine(req.body.text);
    if (typeof req.body?.imagePrompt === "string") {
      patch.imagePrompt = req.body.imagePrompt;
      patch.promptEditedByUser = true;
    }
    scenes[idx] = { ...scenes[idx], ...patch };
    const updated = writeProject(req.ctx.dataDir, { ...project, scenes });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// PATCH /:id/music — set/clear the background music bed
router.patch("/:id/music", (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const path = req.body?.path ? String(req.body.path) : null;
    const volume = Math.min(1, Math.max(0, Number(req.body?.volume ?? project.music?.volume ?? 0.3)));
    const autoDuck = req.body?.autoDuck === undefined ? (project.music?.autoDuck ?? true) : Boolean(req.body.autoDuck);
    const updated = writeProject(req.ctx.dataDir, { ...project, music: { path, volume, autoDuck } });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/:id/render", async (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const scenes = project.scenes || [];
    if (!scenes.length || scenes.some((s) => s.imageStatus !== "done")) {
      return res.status(400).json({ ok: false, error: "every scene needs a generated image before render" });
    }
    const out = storyOutDir(req.ctx.outputDir, project.projectId);
    if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
    const outPath = path.join(out, "video.mp4");
    const durationSec = scenes[scenes.length - 1].endMs / 1000;
    const job = createJob(req.ctx.userId, { durationSec });
    persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: "running" });
    writeProject(req.ctx.dataDir, {
      ...project, status: STORY_STATUS.RENDERING,
      render: { jobId: job.jobId, outputPath: null, status: "running" },
    });

    const audioPath = project.source?.audioPath;
    const audioDurationSec = await probeAudioDurationSec(audioPath);
    // Persist render % into the project file (throttled) so GET /story/:id can
    // report progress even when the in-memory job lives in another request/
    // process. Bumping updatedAt also keeps the project "live" so the UI shows
    // the % bar instead of a false "interrupted" banner.
    const dataDir = req.ctx.dataDir;
    const pid = project.projectId;
    let lastPersistPct = -1;
    let lastPersistAt = 0;
    const persistRenderPct = (pct) => {
      const p = Math.min(99, Math.max(0, Math.round(pct)));
      const now = Date.now();
      if (p <= lastPersistPct && now - lastPersistAt < 8000) return; // throttle
      if (p === lastPersistPct) return;
      lastPersistPct = p; lastPersistAt = now;
      try {
        const fresh = readProject(dataDir, pid);
        if (fresh && fresh.status === STORY_STATUS.RENDERING) {
          writeProject(dataDir, { ...fresh, render: { ...fresh.render, percent: p }, updatedAt: now });
        }
      } catch { /* progress persistence is best-effort */ }
    };
    runStoryRender({
      jobId: job.jobId,
      scenes,
      words: project.transcript?.words || [],
      audioPath,
      musicPath: resolveLibraryTrack(project.music?.path) || project.music?.path || null,
      musicVolume: project.music?.volume ?? 0.3,
      autoDuck: project.music?.autoDuck ?? true,
      onProgress: persistRenderPct,
      // Render resolution is env-tunable. Default 720×1280 (still vertical /
      // social-ready) keeps long videos renderable on a modest CPU box — full
      // 1080×1920 over a 27-min kinetic render pegs CPU/RAM and stalls the
      // server. Bump STORY_RENDER_WIDTH/HEIGHT once on bigger hardware.
      width: Math.max(240, Number(process.env.STORY_RENDER_WIDTH) || 720),
      height: Math.max(240, Number(process.env.STORY_RENDER_HEIGHT) || 1280),
      outPath,
      audioDurationSec: audioDurationSec || undefined,
    }).then((r) => {
      const fresh = readProject(req.ctx.dataDir, project.projectId);
      if (!fresh) return;
      const done = r.ok;
      writeProject(req.ctx.dataDir, {
        ...fresh,
        status: done ? STORY_STATUS.DONE : STORY_STATUS.ERROR,
        error: done ? null : (r.error || "render failed"),
        render: { jobId: job.jobId, outputPath: done ? outPath : null, status: done ? "done" : "error" },
      });
      persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: done ? "done" : "error", outputPath: done ? outPath : null });
    }).catch((err) => {
      // A rejected fire-and-forget is an UNHANDLED rejection - under Node's
      // default policy it killed the whole server when spawn threw
      // ENAMETOOLONG. Record the failure on the project instead.
      try {
        const fresh = readProject(req.ctx.dataDir, project.projectId);
        if (fresh) {
          writeProject(req.ctx.dataDir, {
            ...fresh,
            status: STORY_STATUS.ERROR,
            error: String(err?.message || err || "render failed"),
            render: { jobId: job.jobId, outputPath: null, status: "error" },
          });
        }
        persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: "error", outputPath: null });
      } catch { /* the error is already logged by the job registry */ }
    });

    return res.json({ ok: true, jobId: job.jobId, project: readProject(req.ctx.dataDir, project.projectId) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
