import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import {
  createProject, readProject, writeProject, listProjects, deleteProject, STORY_STATUS,
} from "../lib/story/projectStore.js";
import { segmentScenes } from "../lib/story/sceneSegmenter.js";
import { runStoryRender, probeAudioDurationSec } from "../lib/story/storyRender.js";
import { createJob, persistJob } from "../lib/renderJobs.js";
import { generateBibleImage } from "../lib/imageGen/index.js";
import { extractAudioToMp3 } from "../lib/transcode.js";
import {
  transcribeAudio, chunkAudioForTranscription, stitchTranscriptions,
} from "../lib/voice/alignment.js";
import { refineScript } from "../lib/story/scriptRefine.js";
import { templateById } from "../lib/story/scriptTemplates.js";
import { synthesizeEdgeTts } from "../lib/edgeTts.js";

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
  const scenes = await segmentScenes({ words, style: project.style });
  return writeProject(ctx.dataDir, { ...project, scenes, status: STORY_STATUS.GENERATING_IMAGES });
}

async function imagesStage(ctx, projectId) {
  let project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");
  const scenes = [...(project.scenes || [])];
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].imageStatus === "done" && scenes[i].imagePath) continue;
    scenes[i] = { ...scenes[i], imageStatus: "generating" };
    project = writeProject(ctx.dataDir, { ...project, scenes });
    const result = await _imageGenFn({ seriesId: project.projectId, partNumber: i + 1, rawPrompt: scenes[i].imagePrompt, aspect: "portrait" });
    scenes[i] = result?.ok
      ? { ...scenes[i], imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done" }
      : { ...scenes[i], imageStatus: "error" };
    project = writeProject(ctx.dataDir, { ...project, scenes });
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
    const { title, style } = req.body || {};
    const project = createProject(req.ctx.dataDir, { title, style });
    return res.json({ ok: true, project });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/", (req, res) => {
  return res.json({ ok: true, projects: listProjects(req.ctx.dataDir) });
});

router.get("/:id", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  return res.json({ ok: true, project });
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

    const script = await refineScript({ idea, template });
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

router.post("/:id/images", async (req, res) => {
  try {
    const updated = await imagesStage({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, req.params.id);
    return res.json({ ok: true, project: updated });
  } catch (e) {
    const msg = String(e?.message || e);
    return res.status(/not found/i.test(msg) ? 404 : 500).json({ ok: false, error: msg });
  }
});

// POST /:id/process — run transcribe -> segment -> images SERVER-SIDE, detached.
router.post("/:id/process", (req, res) => {
  if (!readProject(req.ctx.dataDir, req.params.id)) return res.status(404).json({ ok: false, error: "project not found" });
  const guard = confineMediaPath(req.ctx, req.body?.mediaPath);
  if (!guard.ok) return res.status(guard.status).json({ ok: false, error: guard.error });
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  const id = req.params.id;
  runStoryPipeline(ctx, id, guard.path).catch((e) => {
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
      ? { ...scenes[idx], imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done" }
      : { ...scenes[idx], imageStatus: "error" };
    const updated = writeProject(req.ctx.dataDir, { ...project, scenes });
    return res.json({ ok: true, project: updated });
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
    if (typeof req.body?.text === "string") patch.text = req.body.text;
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
    runStoryRender({
      jobId: job.jobId,
      scenes,
      words: project.transcript?.words || [],
      audioPath,
      musicPath: project.music?.path || null,
      musicVolume: project.music?.volume ?? 0.3,
      autoDuck: project.music?.autoDuck ?? true,
      width: 1080, height: 1920,
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
    });

    return res.json({ ok: true, jobId: job.jobId, project: readProject(req.ctx.dataDir, project.projectId) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
