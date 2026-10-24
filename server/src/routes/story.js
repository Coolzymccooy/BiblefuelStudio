import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import {
  createProject, readProject, writeProject, listProjects, deleteProject, STORY_STATUS,
  normaliseCaptionSettings, sourceDisplayFacts, normaliseAiMotion,
} from "../lib/story/projectStore.js";
import { segmentScenes } from "../lib/story/sceneSegmenter.js";
import { runStoryRender, probeAudioDurationSec } from "../lib/story/storyRender.js";
import { brandLogoFor } from "../lib/branding.js";
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
import { resolveTenantTrack } from "../lib/musicLibraryStore.js";
import { cleanCaptionLine, cleanSpeakableText } from "../lib/speakableScript.js";
import { buildImportedTranscript, normalizeWordTimings } from "../lib/story/scriptImport.js";
import { CHARACTER_ANCHORS, composeScenePrompt, sceneMatchText } from "../lib/story/styleAnchors.js";
import { confineToDir } from "../lib/confinePath.js";
import { isRemoteUrl } from "../lib/downloadInput.js";
import { confineUserPath, isSharedTtsFile, sendUserPathError, UserPathError } from "../lib/userPathScope.js";
import { OUTPUT_DIR } from "../lib/paths.js";
import { isNarrationActive } from "../lib/longform/narrationRegistry.js";
import { expandScenesToBeats } from "../lib/story/visualBeats.js";
import { findReusableImages, markUsed, registerImage, pruneLibrary, readLibrary as readImageLibrary } from "../lib/imageGen/imageLibrary.js";
import { resolveMovementImage, libraryImageView } from "../lib/ambient/movementImage.js";
import { isSceneVideoUpload, resolveSceneVideo } from "../lib/story/sceneVideo.js";
import { normalizeStoryAspect, storyFrameSize } from "../lib/story/sceneFraming.js";
import { createStoryAnimateRouter } from "./storyAnimate.js";
import { isAnimating } from "../lib/story/animateStage.js";
import { asRunningStoryStep, busyStep, isStoryStepRunning, signOfLifeStale } from "../lib/story/storyLiveness.js";
import { autoAnimate } from "../lib/story/autoAnimate.js";
import { isSeedanceConfigured } from "../lib/videoGen/providers/seedance.js";

const MUSIC_REF_PREFIX = /^(library|mylib):/;

// Scene target for an "AI motion" import: keeps most scenes under Seedance's
// 12 s clip ceiling, since the segmenter's target is soft.
const AI_MOTION_SCENE_SEC = 10;

// Spread wherever a new PICTURE goes on a scene. A scene can carry a clip of
// your own (videoPath), and the render plays the clip when there is one, so
// a picture put back without this would lose to the stale clip.
// The images stage writes its in-memory scenes back without re-reading them,
// so it must not run while AI clips are being made: it would overwrite a live
// clip's task id and status, and the paid clip would be dropped.
const ANIMATING_REFUSAL = Object.freeze({
  ok: false, code: "ANIMATING",
  error: "Scenes are being animated. Wait for the clips to arrive, or stop ordering them, then try again.",
});

// A new picture also drops any AI motion clip made from the old one.
const NO_SCENE_VIDEO = Object.freeze({
  videoPath: null, videoUrl: null, mediaKind: "image",
  aiVideoStatus: "none", aiVideoTaskId: null, aiVideoError: null, aiVideoClip: false,
});

/**
 * The music bed a caller may use (#112): a `library:`/`mylib:` ref that
 * resolves, or a file in the caller's own media folder (shared tts-* voice
 * files too). Anything else throws a UserPathError: another account's file, a
 * URL in any form, a UNC path, a link that leads out. Used when the bed is set
 * and again at render, for projects stored before this check.
 *
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {string} raw
 * @returns {string} the path to hand ffmpeg
 */
export function confineStoryMusic(ctx, raw) {
  const value = String(raw || "").trim();
  if (MUSIC_REF_PREFIX.test(value)) {
    const resolved = resolveLibraryTrack(value) || resolveTenantTrack(ctx.dataDir, value);
    if (!resolved) throw new UserPathError("MUSIC_NOT_FOUND", 400, "That music track is not in your library any more.");
    return resolved;
  }
  return confineUserPath(value, ctx, { allowShared: isSharedTtsFile });
}

/**
 * Resolve `project.music.path` for the final ffmpeg render.
 *
 * A `library:`/`mylib:` ref that fails to resolve (the track was forgotten,
 * its file deleted, or the project is stale) comes back `null`, not the
 * literal ref string: buildStoryFfmpegArgs has no existence check of its own
 * and would hand ffmpeg an `-i library:foo` that doesn't exist, failing the
 * WHOLE render instead of just dropping the music.
 *
 * A bare path (pre-library back-compat, see MusicPicker's REF_PREFIX comment)
 * must be the caller's own file (#112); one outside throws a UserPathError.
 */
export function resolveMusicPathForRender(ctx, rawMusicPath) {
  const raw = rawMusicPath || null;
  if (!raw) return null;
  try {
    return confineStoryMusic(ctx, raw);
  } catch (err) {
    if (err instanceof UserPathError && err.code === "MUSIC_NOT_FOUND") return null;
    throw err;
  }
}

const REMOTE_AUDIO_REFUSAL = "audioPath must be a file on this server, not a web link.";
const STORY_AUDIO_REFUSAL = "This project's audio is not a file in your own folders, so it can't be used. Start the project again from your audio.";

/**
 * The project's stored source audio, confined to the caller's folders (or a
 * server-named narration file) exactly as import-script confines it. Covers
 * projects stored before import-script confined every path: their audio would
 * otherwise reach ffprobe/ffmpeg as given (another account's file, or a URL).
 */
function confinedProjectAudio(ctx, project) {
  const raw = project?.source?.audioPath;
  if (!raw || isRemoteUrl(raw)) return { ok: false };
  return confineImportAudio(ctx, raw);
}

/**
 * The project's music bed as a local path (or null), re-checked at render.
 * A refusal is reported, not rendered.
 */
function storyMusicForRender(ctx, rawMusicPath) {
  try {
    return { ok: true, path: resolveMusicPathForRender(ctx, rawMusicPath) };
  } catch (err) {
    if (err instanceof UserPathError) return { ok: false, status: err.status, error: err.code, message: err.message };
    throw err;
  }
}

// Mockable seams (mirror routes/transcribe.js).
let _transcribeFn = transcribeAudio;
export function _setTranscribeImpl(impl) { _transcribeFn = impl; }
export function _resetTranscribeImpl() { _transcribeFn = transcribeAudio; }

let _imageGenFn = generateBibleImage;
export function _setImageGenImpl(impl) { _imageGenFn = impl; }
export function _resetImageGenImpl() { _imageGenFn = generateBibleImage; }

// The image library, as one injectable bundle so route tests can drive reuse
// without touching disk or the embedding API.
const REAL_IMAGE_LIB = { find: findReusableImages, mark: markUsed, register: registerImage };
let _imageLib = REAL_IMAGE_LIB;
export function _setImageLibraryImpl(impl) { _imageLib = { ...REAL_IMAGE_LIB, ...impl }; }
export function _resetImageLibraryImpl() { _imageLib = REAL_IMAGE_LIB; }

let _ttsFn = synthesizeEdgeTts;
export function _setTtsImpl(impl) { _ttsFn = impl; }
export function _resetTtsImpl() { _ttsFn = synthesizeEdgeTts; }

let _renderFn = runStoryRender;
export function _setRenderImpl(impl) { _renderFn = impl; }
export function _resetRenderImpl() { _renderFn = runStoryRender; }

// The pipeline an import with autoStart fires (route tests stub it).
let _pipelineFn = (...args) => runStoryPipeline(...args);
export function _setPipelineImpl(impl) { _pipelineFn = impl; }
export function _resetPipelineImpl() { _pipelineFn = (...args) => runStoryPipeline(...args); }

let _autoAnimateFn = autoAnimate;
export function _setAutoAnimateImpl(impl) { _autoAnimateFn = impl; }
export function _resetAutoAnimateImpl() { _autoAnimateFn = autoAnimate; }

// Confine a user-supplied mediaPath to the caller's own dirs (anti path-traversal).
function confineMediaPath(ctx, rawMediaPath) {
  const raw = String(rawMediaPath || "").trim();
  if (!raw) return { ok: false, status: 400, error: "mediaPath required" };
  const resolved = [ctx.outputDir, ctx.dataDir].map((root) => confineToDir(root, raw)).find(Boolean) || null;
  if (!resolved) return { ok: false, status: 403, error: "mediaPath is outside the allowed directory" };
  if (!fs.existsSync(resolved)) return { ok: false, status: 400, error: "mediaPath not found" };
  return { ok: true, path: resolved };
}

// The narration routes write every user's TTS into the shared outputs folder,
// so an imported script's audio is either in the user's own folders or is one
// of those server-named files (unguessable, never user-named). The names the
// TTS writers in lib/ produce: ElevenLabs tts-<uuid>.mp3, the others
// tts-<provider>-<uuid>.<ext>, where Edge, Azure and Fish write .mp3,
// Chatterbox .wav or .mp3, and Piper .wav, .mp3 or .ogg.
const TTS_PROVIDERS = "edge|azure|fish|chatterbox|piper";
const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SHARED_TTS_NAME = new RegExp(`^tts-(?:(?:${TTS_PROVIDERS})-)?${UUID_V4}\\.(?:mp3|wav|ogg)$`);

export function confineImportAudio(ctx, rawPath, sharedOutputDir = OUTPUT_DIR) {
  const own = confineMediaPath(ctx, rawPath);
  if (own.ok) return own;
  const shared = confineToDir(sharedOutputDir, String(rawPath || "").trim());
  if (shared && path.dirname(shared) === path.resolve(sharedOutputDir)
    && SHARED_TTS_NAME.test(path.basename(shared)) && fs.existsSync(shared)) {
    return { ok: true, path: shared };
  }
  return own;
}

// Image-gen aspect for a project: images are generated in the project's own
// output frame (portrait, landscape or square), and projects predating the
// field stay portrait. Shared by imagesStage and the single-scene regenerate
// route so the two paths can never drift apart.
function imageAspectFor(project) {
  return normalizeStoryAspect(project.aspect);
}

// --- Pipeline stages (re-entrant). ctx = { dataDir, outputDir }. ---
// Each runs as a step of its project (lib/story/storyLiveness.js): listed as
// live in this process and beating, so GET /:id can tell it from one a
// restart killed.
function transcribeStage(ctx, projectId, mediaPath) {
  return asRunningStoryStep(ctx, projectId, () => runTranscribe(ctx, projectId, mediaPath));
}

function segmentStage(ctx, projectId, options = {}) {
  return asRunningStoryStep(ctx, projectId, () => runSegment(ctx, projectId, options));
}

async function runTranscribe(ctx, projectId, mediaPath) {
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
  const fresh = readProject(ctx.dataDir, projectId);
  return writeProject(ctx.dataDir, {
    ...fresh,
    // Keep the display facts (name, trimmed) the start request recorded.
    source: { ...fresh.source, audioPath, durationMs },
    transcript: { words: stitched.words, hash: String(durationMs) + ":" + stitched.words.length },
    status: STORY_STATUS.SEGMENTING,
  });
}

async function runSegment(ctx, projectId, { maxScenes } = {}) {
  const project = readProject(ctx.dataDir, projectId);
  if (!project) throw new Error("project not found");
  if (project.scenes?.length) {
    return writeProject(ctx.dataDir, { ...project, status: STORY_STATUS.GENERATING_IMAGES });
  }
  const words = project.transcript?.words || [];
  if (!words.length) throw new Error("no transcript to segment");
  const scenes = await segmentScenes({
    words, style: project.style, cast: project.cast || [],
    targetSec: project.scene?.targetSceneSec, maxScenes: maxScenes ?? project.scene?.maxScenes,
  });
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

// Tiny helpers over the set so other routers (long-form narration) can take
// part in the same cancel flag without reaching into this module's state.
/** @param {string} projectId */
export function markCancelled(projectId) { cancelledProjects.add(projectId); }
/** @param {string} projectId */
export function isCancelled(projectId) { return cancelledProjects.has(projectId); }
/** @param {string} projectId */
export function clearCancelled(projectId) { cancelledProjects.delete(projectId); }

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

// Projects whose pictures wait on a step before them (an AI music video's
// prompts being written). Their status already reads generating_images, so
// the page shows its working state; a Resume meanwhile is a no-op, and a new
// image run or re-segment is refused, so the pictures are made once.
const preparingProjects = new Set();
const PREPARING_REFUSAL = Object.freeze({
  ok: false, code: "PREPARING",
  error: "The scene prompts are still being written. The pictures start by themselves in a moment.",
});

// Image runs in progress, by project. A run works from its own copy of the
// scenes and writes the whole list back as it goes, so a picture put on a
// scene meanwhile would be overwritten; PUT /scenes/:sid/image waits for it.
// The project's status can't tell: a run that hit the image quota leaves it at
// generating_images with nothing running.
const imageRuns = new Map();

function imagesRunning(projectId) {
  return (imageRuns.get(projectId) || 0) > 0;
}

// Scenes being regenerated one at a time: the PUT waits for those too, or the
// regenerate would land over the picture you just put there.
const sceneRegens = new Set();
const sceneKey = (projectId, sceneId) => `${projectId}\u0000${sceneId}`;

async function imagesStage(ctx, projectId, opts = {}) {
  // Every image run comes through here (the routes, the pipeline, long-form
  // narration), so this is the guard that keeps live AI clips safe; the
  // routes' own 409 only answers the request sooner.
  if (isAnimating(projectId)) {
    throw Object.assign(new Error(ANIMATING_REFUSAL.error), { code: ANIMATING_REFUSAL.code });
  }
  imageRuns.set(projectId, (imageRuns.get(projectId) || 0) + 1);
  let result;
  try {
    result = await asRunningStoryStep(ctx, projectId, () => runImagesStage(ctx, projectId, opts));
  } finally {
    const left = (imageRuns.get(projectId) || 1) - 1;
    if (left > 0) imageRuns.set(projectId, left); else imageRuns.delete(projectId);
  }
  // Every picture is in: an "AI motion" project animates its scenes now, within
  // the month's cap. Run after the counter is released, so the scenes are not
  // still locked by this run. Another image run on the project still going
  // would write its own copy of the scenes over the clips, so only the last
  // run to finish hands over, and a scene locked some other way (being
  // regenerated, a render running) is left out. Every image path (pipeline,
  // /images, /process, /resegment, long-form) comes through here. autoAnimate
  // never throws and only starts a detached run, but it must never fail the
  // images stage.
  if (result?.status === STORY_STATUS.READY_TO_RENDER && !imagesRunning(projectId)) {
    try {
      await _autoAnimateFn(ctx, projectId, { sceneBlocked: sceneImageBlocked });
    } catch (e) {
      console.warn(`[story] auto-animate ${projectId} failed: ${e?.message || e}`);
    }
  }
  return result;
}

async function runImagesStage(ctx, projectId, opts = {}) {
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

  // The writes below are from this run's own copy of the project, so each
  // stamps heartbeatAt: an older copy must not put a stale beat back (R50).
  // Single shared, mutated-in-place scenes array. writeProject is fully
  // synchronous (writeFileSync + renameSync), and JS is single-threaded, so
  // incremental writes from the concurrent workers below can't interleave or
  // clobber each other — each persists the latest full array.
  const scenes = [...(project.scenes || [])];

  const pending = [];
  for (let i = 0; i < scenes.length; i++) {
    const alreadyDone = scenes[i].imageStatus === "done" && scenes[i].imagePath;
    if (alreadyDone && !force) continue; // retry-failed reruns error/pending; force reruns all
    // Whatever this run puts here, it isn't a picture you chose.
    scenes[i] = { ...scenes[i], imageStatus: "generating", imageError: null, imageChosenByUser: false, ...(force ? { imagePath: null, imageUrl: null, ...NO_SCENE_VIDEO } : {}) };
    pending.push(i);
  }
  writeProject(ctx.dataDir, { ...project, scenes, status: STORY_STATUS.GENERATING_IMAGES });
  // The workers' writes keep the live run's status: the copy read above may
  // say ready_to_render (a forced re-run), which would read finished early.
  const live = { ...project, status: STORY_STATUS.GENERATING_IMAGES };

  const timeoutMs = imageStageTimeoutMs();
  const style = String(project.style || "");
  const aspect = imageAspectFor(project);
  // Library images already spoken for by THIS video. Scenes run concurrently,
  // so a claim is taken synchronously after the await — two workers must never
  // land on the same picture.
  const claimedIds = new Set(scenes.map((s) => s.imageLibraryId).filter(Boolean));
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      if (cancelledProjects.has(projectId)) return; // stop promptly on cancel
      const i = pending[cursor++];

      // 1. Ask the library first — a hit costs no image quota.
      let reused = null;
      try {
        const candidates = await _imageLib.find({ dataDir: ctx.dataDir, prompt: sceneMatchText(scenes[i].imagePrompt), style, aspect, excludeIds: [...claimedIds] });
        for (const c of candidates || []) {
          if (!c?.entry?.id || claimedIds.has(c.entry.id)) continue; // a sibling took it while we awaited
          claimedIds.add(c.entry.id); // claim synchronously
          reused = c;
          break;
        }
      } catch (err) {
        console.warn(`[story] scene ${i + 1} library lookup failed: ${err?.message || err}`);
      }

      if (reused) {
        // Usage stats are not worth failing a scene over.
        try { _imageLib.mark({ dataDir: ctx.dataDir, id: reused.entry.id }); } catch { /* ignore */ }
        console.log(`[story] scene ${i + 1} reused ${reused.entry.id} (score ${Number(reused.score).toFixed(3)})`);
        scenes[i] = {
          ...scenes[i],
          imagePath: reused.entry.path,
          imageUrl: reused.entry.publicUrl || null,
          imageStatus: "done",
          imageError: null,
          imageSource: "library",
          imageLibraryId: reused.entry.id,
          imageReuseScore: reused.score,
          ...NO_SCENE_VIDEO,
        };
        writeProject(ctx.dataDir, { ...live, scenes, heartbeatAt: Date.now() });
        continue;
      }

      // 2. Nothing fit — generate, then harvest the result for next time.
      let result;
      try {
        result = await withTimeout(
          _imageGenFn({ seriesId: project.projectId, partNumber: i + 1, rawPrompt: scenes[i].imagePrompt, aspect }),
          timeoutMs,
          `image gen for scene ${i + 1} timed out after ${timeoutMs}ms`,
        );
      } catch (err) {
        console.warn(`[story] scene ${i + 1} image gen failed: ${err?.message || err}`);
        result = { ok: false, error: String(err?.message || err) };
      }

      if (result?.ok) {
        let entry = null;
        try {
          entry = await _imageLib.register({ dataDir: ctx.dataDir, outputDir: ctx.outputDir, sourcePath: result.path, prompt: sceneMatchText(scenes[i].imagePrompt), style, aspect, provider: result.provider, watermarkFree: result.watermarkFree, projectId: project.projectId });
          if (entry?.id) claimedIds.add(entry.id);
        } catch (err) {
          // The picture exists; the index is only an optimisation.
          console.warn(`[story] scene ${i + 1} harvest failed: ${err?.message || err}`);
        }
        scenes[i] = {
          ...scenes[i],
          imagePath: result.path,
          imageUrl: result.publicUrl || null,
          imageStatus: "done",
          imageError: null,
          imageSource: "generated",
          imageLibraryId: entry?.id || null,
          imageReuseScore: null,
          ...NO_SCENE_VIDEO,
        };
      } else {
        scenes[i] = { ...scenes[i], imageStatus: "error", imageError: shortImageError(result?.error) };
      }
      writeProject(ctx.dataDir, { ...live, scenes, heartbeatAt: Date.now() });
    }
  };

  const workerCount = Math.min(imageStageConcurrency(), Math.max(1, pending.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Housekeeping: keep the library from growing without bound.
  try { pruneLibrary({ dataDir: ctx.dataDir }); } catch { /* ignore */ }

  if (cancelledProjects.has(projectId)) {
    cancelledProjects.delete(projectId);
    return writeProject(ctx.dataDir, { ...project, scenes, status: STORY_STATUS.ERROR, error: "Cancelled." });
  }

  const allDone = scenes.every((s) => s.imageStatus === "done");
  return writeProject(ctx.dataDir, { ...project, scenes, status: allDone ? STORY_STATUS.READY_TO_RENDER : STORY_STATUS.GENERATING_IMAGES });
}

/**
 * Run the whole pipeline server-side. Awaitable; the route fires it detached.
 * `maxScenes` caps this run's segmentation only (an agent's charged picture count, R44).
 */
export async function runStoryPipeline(ctx, projectId, mediaPath, { maxScenes } = {}) {
  await transcribeStage(ctx, projectId, mediaPath);
  await segmentStage(ctx, projectId, { maxScenes });
  await imagesStage(ctx, projectId);
}

const isFileSync = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/** Records a detached run's failure on the project, as every detached image run here does. */
function recordRunError(ctx, projectId, e) {
  try {
    const fresh = readProject(ctx.dataDir, projectId);
    if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
  } catch {}
}

/**
 * AI music videos (routes/lyricVideo.js POST /:id/to-story): a Story project
 * built straight from a timed song. The scenes are given (cut on the song's
 * sections), so there is no transcribing or segmenting; the song is the only
 * sound (no music bed) and Story draws no captions, because the lyric render
 * puts its own over the finished video. Each scene's prompt gets the style
 * anchor here, as the segmenter's do. AI motion is kept only when the server
 * has the Seedance key; the caller has already checked the user may spend it.
 *
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {{ title: string, style?: string, aspect?: string, audioPath: string, durationMs: number,
 *   words: Array<{text:string,startMs:number,endMs:number}>,
 *   scenes: Array<{startMs:number,endMs:number,text?:string,imagePrompt:string}>,
 *   aiMotion?: boolean | { quality?: string } }} opts
 * @returns {object} the project, at generating_images
 */
export function createStoryFromScenes(ctx, { title, style = "music-video", aspect, audioPath, durationMs, words = [], scenes, aiMotion = null }) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("a music video needs scenes");
  if (typeof audioPath !== "string" || !audioPath.trim() || !isFileSync(audioPath)) throw new Error("a music video needs the song's audio");
  const length = Math.round(Number(durationMs));
  if (!Number.isFinite(length) || length <= 0) throw new Error("the song's duration must be a positive number");
  const project = createProject(ctx.dataDir, {
    title, style, aspect, captions: "none",
    aiMotion: isSeedanceConfigured() ? aiMotion : null,
  });
  // The project owns its soundtrack: a copy in its own folder (removed with it), so the lyric
  // project deleting or replacing its song never leaves this one unable to render. The copy is
  // made in the background (copyPendingAudio, the first thing startStoryImages does): a song
  // can be large, and this answers a request. Nothing reads the audio before then.
  const ownAudio = path.join(storyOutDir(ctx.outputDir, project.projectId), `song${path.extname(audioPath).toLowerCase() || ".m4a"}`);
  const timed = normalizeWordTimings(words);
  return writeProject(ctx.dataDir, {
    ...project,
    source: { audioPath: ownAudio, durationMs: length, copyFrom: audioPath },
    transcript: { words: timed, hash: `${length}:${timed.length}` },
    music: null,
    scenes: scenes.map((s, i) => ({
      id: `scene-${String(i + 1).padStart(3, "0")}`,
      text: String(s.text ?? ""),
      startMs: Math.round(s.startMs),
      endMs: Math.round(s.endMs),
      imagePrompt: composeScenePrompt(String(s.imagePrompt ?? ""), { style: project.style }),
      imagePath: null,
      imageStatus: "pending",
      promptEditedByUser: false,
    })),
    status: STORY_STATUS.GENERATING_IMAGES,
  });
}

/**
 * Starts the images stage for a project, detached, exactly as POST /:id/images
 * does: a failure is recorded on the project. When every picture is in, the
 * stage's own hook auto-animates an aiMotion project. Returns the run, which
 * never rejects (callers need not wait for it).
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {string} projectId
 * @returns {Promise<void>}
 */
export function startStoryImages(ctx, projectId, { before } = {}) {
  const run = { dataDir: ctx.dataDir, outputDir: ctx.outputDir };
  cancelledProjects.delete(projectId); // a fresh run supersedes any earlier cancel
  // Marked at once, so a Resume that lands before the steps end cannot start a second run.
  preparingProjects.add(projectId);
  return (async () => {
    let copied = false;
    try {
      // The song first: a project that cannot get its soundtrack can never render, so it makes no
      // pictures (and pays for no prompts).
      copied = await copyPendingAudio(run, projectId);
      if (copied && before) {
        try {
          await before();
        } catch (e) {
          console.warn(`[story] the step before ${projectId}'s pictures failed; making them anyway: ${e?.message || e}`);
        }
      }
    } finally {
      preparingProjects.delete(projectId);
    }
    if (!copied) return;
    try {
      await imagesStage(run, projectId);
    } catch (e) {
      recordRunError(run, projectId, e);
    }
  })();
}

/** What a project says when its song could not be copied into its own folder. */
export const AUDIO_COPY_FAILED = "The song could not be copied for this music video. Make the music video again from the lyric video.";

let _copyFileFn = (from, to) => fs.promises.copyFile(from, to);
export function _setCopyFileImpl(impl) { _copyFileFn = impl; }
export function _resetCopyFileImpl() { _copyFileFn = (from, to) => fs.promises.copyFile(from, to); }

/**
 * Makes the copy of the song a music video project is waiting for (source.copyFrom to
 * source.audioPath), off the request, without blocking the server. True when there is nothing
 * left to copy. A failure puts the project in error with a plain message and gives false.
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {string} projectId
 * @returns {Promise<boolean>}
 */
export async function copyPendingAudio(ctx, projectId) {
  const project = readProject(ctx.dataDir, projectId);
  const from = project?.source?.copyFrom;
  if (!from) return true;
  const to = project.source.audioPath;
  try {
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await _copyFileFn(from, to);
  } catch (e) {
    console.warn(`[story] could not copy the song for ${projectId}: ${e?.message || e}`);
    try { await fs.promises.rm(to, { force: true }); } catch { /* a partial copy is harmless */ }
    const fresh = readProject(ctx.dataDir, projectId);
    if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: AUDIO_COPY_FAILED });
    return false;
  }
  const fresh = readProject(ctx.dataDir, projectId);
  if (!fresh) {
    // Deleted while the song was copied: take the copy (and the folder it made) away again.
    try { await fs.promises.rm(path.dirname(to), { recursive: true, force: true }); } catch { /* best effort */ }
    return false;
  }
  const { copyFrom: _done, ...source } = fresh.source || {};
  writeProject(ctx.dataDir, { ...fresh, source });
  return true;
}

/**
 * Puts new picture prompts on a project's scenes, by scene id, each with the
 * style anchor (as the segmenter's get). A prompt the user has edited is kept,
 * and an empty one changes nothing. Returns the project, or null when it is gone.
 * @param {{ dataDir: string }} ctx
 * @param {string} projectId
 * @param {Record<string, string>} prompts scene id -> prompt
 */
export function patchScenePrompts(ctx, projectId, prompts) {
  const fresh = readProject(ctx.dataDir, projectId);
  if (!fresh) return null;
  const scenes = (fresh.scenes || []).map((s) => {
    const prompt = String(prompts?.[s.id] ?? "").trim();
    if (!prompt || s.promptEditedByUser) return s;
    return { ...s, imagePrompt: composeScenePrompt(prompt, { style: fresh.style }) };
  });
  return writeProject(ctx.dataDir, { ...fresh, scenes });
}

// R43: only requests that start paid or heavy work count the plan's render
// quota: transcribing, making pictures or clips, rendering, narrating a script,
// and an import that starts its pipeline. Creating, editing, deleting, reading
// and cancelling are free. index.js passes this as the skip of the router's
// quota("render") mount. Express matches routes ignoring case and a trailing
// slash, so this does too.
const WORK_PATHS = [
  /^\/[^/]+\/(?:process|render|images|resegment|transcribe|animate)$/,
  /^\/[^/]+\/scenes\/[^/]+\/(?:regenerate|animate)$/,
  /^\/script-to-audio$/,
];
export function isQuotaFreeStoryRequest(req) {
  if (req?.method !== "POST") return true;
  const route = String(req?.path || "").toLowerCase().replace(/\/+$/, "");
  if (route === "/import-script") return req?.body?.autoStart !== true;
  return !WORK_PATHS.some((pattern) => pattern.test(route));
}

// The most scenes one /process or /resegment run may cut (R44): agents pass the
// picture count they were charged for. Absent keeps the project's own policy.
const MAX_SCENES_LIMIT = 60;
function maxScenesFrom(body) {
  const raw = body?.maxScenes;
  if (raw === undefined) return { ok: true, value: undefined };
  return Number.isInteger(raw) && raw >= 1 && raw <= MAX_SCENES_LIMIT ? { ok: true, value: raw } : { ok: false };
}
const BAD_MAX_SCENES = Object.freeze({ ok: false, error: `maxScenes must be a whole number from 1 to ${MAX_SCENES_LIMIT}` });

const router = Router();
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function storyOutDir(outputDir, projectId) {
  return path.join(outputDir, "story", String(projectId).replace(/[^a-z0-9_-]/gi, ""));
}

router.post("/", (req, res) => {
  try {
    const { title, style, cast, aspect, captions, scene, longform } = req.body || {};
    const project = createProject(req.ctx.dataDir, { title, style, cast, aspect, captions, scene, longform });
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

// AI motion clips on scenes (super admins only); see routes/storyAnimate.js.
// Also before "/:id": it serves GET /animate/rates. Its other routes are all
// POST /:id/... paths that nothing below shares.
router.use(createStoryAnimateRouter({ sceneBlocked: sceneImageBlocked }));

function renderJobLive(project) {
  const job = project.render?.jobId ? getRenderJob(project.render.jobId) : null;
  return Boolean(job && (job.status === "queued" || job.status === "running"));
}

/** Anything for this project running in this process: a step, an image run, the pictures' preparation, AI clips, a render. */
function liveHere(project) {
  const id = project.projectId;
  return isStoryStepRunning(id) || imagesRunning(id) || preparingProjects.has(id) || isAnimating(id) || renderJobLive(project);
}

/**
 * R50: a project showing a busy step that nothing in this process is running,
 * with no heartbeat or write for over two minutes, was stopped by a restart or
 * deploy; nothing will ever move it on.
 */
function interruptedByRestart(project) {
  return Boolean(busyStep(project)) && !liveHere(project) && signOfLifeStale(project);
}

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
  // Same idea for a long-form narration: `alive` says whether the run is
  // actually in flight in this process. false while status==="narrating"
  // ⇒ the server restarted mid-run and the UI should offer Resume now, not
  // after a stall timer. Wire-only — never persisted.
  if (project.status === STORY_STATUS.NARRATING) {
    const progress = project.longform?.progress || { done: 0, total: 0 };
    out = { ...out, longform: { ...out.longform, progress: { ...progress, alive: isNarrationActive(project.projectId) } } };
  }
  // Wire-only: the pictures are about to start by themselves (an AI music
  // video's song copy or prompts), though no scene is being made yet; or a
  // restart killed the step the project shows as running (left as stored;
  // Cancel resets it).
  const preparing = preparingProjects.has(project.projectId) ? { preparing: true } : {};
  const interrupted = interruptedByRestart(project) ? { interrupted: true } : {};
  return res.json({ ok: true, project: out, ...preparing, ...interrupted });
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
// Body: { script, audioPath, durationMs, words?, title?, style?, aiMotion?, autoStart? }
// With autoStart: true it returns a project already at SEGMENTING and the
// pipeline (segment -> images) runs detached on the server; otherwise the
// project is a DRAFT and the client calls /:id/segment and /:id/images
// exactly as the media path does. aiMotion
// (true or { quality }) is kept only for a super admin, and makes the images
// stage animate the scenes when the pictures are done (lib/story/autoAnimate.js).
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

const ASPECT_LOCKED_STATUSES = new Set([
  STORY_STATUS.TRANSCRIBING, STORY_STATUS.SEGMENTING, STORY_STATUS.GENERATING_IMAGES,
  STORY_STATUS.RENDERING, STORY_STATUS.NARRATING,
]);

// PATCH /:id/aspect — set the output frame: portrait, landscape or square,
// the same choices as the Render tab.
//
// Scene images already made keep their shape. At render time a picture whose
// shape differs from the frame is shown whole over a blurred fill rather than
// cropped (see sceneFraming.js), and the response says how many there are so
// the operator can regenerate them for a full-bleed fit.
router.patch("/:id/aspect", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  const requested = req.body?.aspect;
  if (normalizeStoryAspect(requested) !== requested) {
    return res.status(400).json({ ok: false, error: "aspect must be portrait, landscape or square" });
  }
  // A running stage read the project before it started and writes it back
  // when it ends, which would quietly put the old frame back.
  if (ASPECT_LOCKED_STATUSES.has(project.status)) {
    return res.status(409).json({ ok: false, error: "wait for the current step to finish before changing the output frame" });
  }
  const updated = writeProject(req.ctx.dataDir, { ...project, aspect: requested });
  const changed = normalizeStoryAspect(project.aspect) !== requested;
  const made = (updated.scenes || []).filter((s) => s.imageStatus === "done").length;
  const notes = [];
  if (changed && made > 0) {
    notes.push(`${made} scene image(s) were made for the old frame. Any that no longer fit will be shown whole over a blurred fill; regenerate them to fill the new frame.`);
  }
  if (changed && updated.status === STORY_STATUS.DONE) {
    notes.push("Render again to get the video in the new frame.");
  }
  return res.json({ ok: true, project: updated, note: notes.join(" ") });
});

router.post("/import-script", (req, res) => {
  try {
    const script = String(req.body?.script || "").trim();
    if (script.length < 3) return res.status(400).json({ ok: false, error: "script is required" });

    const audioPath = String(req.body?.audioPath || "").trim();
    if (!audioPath) return res.status(400).json({ ok: false, error: "audioPath is required" });
    // The stored path later reaches ffprobe/ffmpeg, which would fetch a URL
    // with no SSRF check. Narration is always a file on this server.
    if (isRemoteUrl(audioPath)) return res.status(400).json({ ok: false, error: REMOTE_AUDIO_REFUSAL });

    const durationMs = Number(req.body?.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return res.status(400).json({ ok: false, error: "durationMs must be a positive number" });
    }

    // Confined exactly as /process confines mediaPath, whatever autoStart
    // says: the stored path is later probed, segmented and rendered by
    // ffprobe/ffmpeg, so another account's file must never get in.
    const autoStart = req.body?.autoStart === true;
    const guard = confineImportAudio(req.ctx, audioPath);
    if (!guard.ok) return res.status(400).json({ ok: false, error: guard.error });
    const startPath = autoStart ? guard.path : null;

    let patch;
    try {
      patch = buildImportedTranscript({ script, audioPath: guard.path, durationMs, words: req.body?.words });
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e?.message || e) });
    }

    // AI motion spends the shared BytePlus balance: honoured only for a super
    // admin on a server that has the key, and silently dropped otherwise. Ten
    // second scenes keep most clips under Seedance's 12 s ceiling (the
    // segmenter's target is soft).
    const aiMotion = req.ctx.isSuperAdmin && isSeedanceConfigured() ? normaliseAiMotion(req.body?.aiMotion) : null;
    const scene = req.body?.scene ?? (aiMotion ? { targetSceneSec: AI_MOTION_SCENE_SEC } : undefined);

    const project = createProject(req.ctx.dataDir, {
      title: req.body?.title || script.slice(0, 60),
      style: req.body?.style,
      cast: req.body?.cast,
      aspect: req.body?.aspect,
      captions: req.body?.captions,
      scene,
      longform: req.body?.longform,
      aiMotion,
    });

    // Without autoStart nothing runs, so it is an idle draft: "segmenting" read
    // as a step running forever. /:id/segment and /:id/process work from either.
    const ready = writeProject(req.ctx.dataDir, {
      ...project,
      ...patch,
      status: autoStart ? STORY_STATUS.SEGMENTING : STORY_STATUS.DRAFT,
    });

    // Build it now (the transcript is already there, so transcription is
    // skipped) instead of leaving it at segmenting until someone clicks Resume.
    if (autoStart) {
      const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
      const id = ready.projectId;
      Promise.resolve()
        .then(() => _pipelineFn(ctx, id, startPath))
        .catch((e) => {
          try {
            const fresh = readProject(ctx.dataDir, id);
            if (fresh) writeProject(ctx.dataDir, { ...fresh, status: STORY_STATUS.ERROR, error: String(e?.message || e) });
          } catch {}
        });
    }

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

/**
 * Why a picture can't go on this scene right now, or null. Each reason has
 * its own code so the client can tell them apart without reading the words.
 */
export function sceneImageBlocked(project, sceneId) {
  if (!(project.scenes || []).some((s) => s.id === sceneId)) {
    return { status: 404, body: { error: "scene not found" } };
  }
  // The step before the pictures will put its prompts on every scene, then make them.
  if (preparingProjects.has(project.projectId)) {
    return { status: 409, body: { code: PREPARING_REFUSAL.code, error: PREPARING_REFUSAL.error } };
  }
  if (imagesRunning(project.projectId)) {
    return { status: 409, body: { code: "IMAGES_RUNNING", error: "Images are still being generated. Wait for that to finish, or Cancel it, then try again." } };
  }
  if (sceneRegens.has(sceneKey(project.projectId, sceneId))) {
    return { status: 409, body: { code: "SCENE_REGENERATING", error: "This scene is being regenerated. Wait for that to finish, then try again." } };
  }
  // Only a render alive in this process: one that died in a restart leaves
  // the status at "rendering", and must not lock the pictures for good.
  if (project.status === STORY_STATUS.RENDERING && project.render?.jobId && getRenderJob(project.render.jobId)) {
    return { status: 409, body: { code: "RENDERING", error: "The video is rendering. Wait for it to finish, then change pictures." } };
  }
  return null;
}

// PUT /:id/scenes/:sid/image — your own picture on one scene, instead of a
// generated one: { uploadPath } from POST /api/media/upload-background, or
// { libraryId } from GET /:id/library-images. Costs no image quota, so a
// project can be finished when the daily limit has run out. The checks on
// what may be used are Ambient's (lib/ambient/movementImage.js). An upload
// that is a video clip (a Pixabay download, say) goes through
// lib/story/sceneVideo.js instead: the scene plays the clip, and a poster
// frame stands in wherever a picture is expected.
router.put("/:id/scenes/:sid/image", async (req, res) => {
  try {
    const { dataDir, outputDir } = req.ctx;
    const project = readProject(dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const refused = sceneImageBlocked(project, req.params.sid);
    if (refused) return res.status(refused.status).json({ ok: false, ...refused.body });

    const body = req.body || {};
    let media;
    if (!body.libraryId && isSceneVideoUpload(body.uploadPath)) {
      // A clip of your own: its poster stands in wherever a picture is
      // expected, and the render plays the clip. Not put in the library.
      const clip = await resolveSceneVideo({ outputDir, uploadPath: body.uploadPath });
      if (!clip.ok) return res.status(clip.status).json({ ok: false, error: clip.error });
      media = {
        imagePath: clip.posterPath,
        imageUrl: clip.posterUrl,
        imageSource: "upload",
        imageLibraryId: null,
        videoPath: clip.videoPath,
        videoUrl: clip.videoUrl,
        mediaKind: "video",
        // Your own clip replaces any AI clip, and a late AI clip must not land on it.
        aiVideoStatus: "none", aiVideoTaskId: null, aiVideoError: null, aiVideoClip: false,
      };
    } else {
      const got = await resolveMovementImage({
        dataDir, outputDir, project: { ...project, aspect: imageAspectFor(project) }, body,
        items: readImageLibrary(dataDir).items, register: _imageLib.register,
      });
      if (!got.ok) return res.status(got.status).json({ ok: false, error: got.error });
      try { _imageLib.mark({ dataDir, id: got.entry.id }); } catch { /* stats only */ }
      media = {
        imagePath: got.entry.path,
        imageUrl: got.entry.publicUrl || null,
        imageSource: got.source,
        imageLibraryId: got.entry.id,
        ...NO_SCENE_VIDEO,
      };
    }

    // Checked again: a run, a render or a re-segment can start while the
    // upload is being copied. From here to the write nothing awaits, so none
    // can start in between.
    const fresh = readProject(dataDir, project.projectId);
    if (!fresh) return res.status(404).json({ ok: false, error: "project not found" });
    const refusedNow = sceneImageBlocked(fresh, req.params.sid);
    if (refusedNow) return res.status(refusedNow.status).json({ ok: false, ...refusedNow.body });
    const scenes = (fresh.scenes || []).map((s) => (s.id !== req.params.sid ? s : {
      ...s,
      ...media,
      imageStatus: "done",
      imageError: null,
      imageReuseScore: null,
      imageChosenByUser: true,
    }));
    // The quota stopped the run short (status "generating"), or it was
    // cancelled (status "error"); once every scene has a picture it is ready.
    const allDone = scenes.every((s) => s.imageStatus === "done");
    const settle = allDone && [STORY_STATUS.GENERATING_IMAGES, STORY_STATUS.ERROR].includes(fresh.status)
      ? { status: STORY_STATUS.READY_TO_RENDER, error: null }
      : {};
    const updated = writeProject(dataDir, { ...fresh, scenes, ...settle });
    // Uploads land in the library too; keep it from growing without bound.
    try { pruneLibrary({ dataDir }); } catch { /* housekeeping only */ }
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// GET /:id/library-images — pictures this account can put on a scene
// (generated or uploaded before): ids and URLs only, never server paths.
router.get("/:id/library-images", (req, res) => {
  if (!readProject(req.ctx.dataDir, req.params.id)) return res.status(404).json({ ok: false, error: "project not found" });
  return res.json({ ok: true, images: libraryImageView(readImageLibrary(req.ctx.dataDir).items).slice(0, 200) });
});

// POST /:id/images — (re)generate scene images. Runs DETACHED and returns
// immediately so it isn't killed by the ~100s edge timeout when a long video
// has dozens of images; the client polls the project for progress.
//   body/query `force=true` → regenerate EVERY scene from scratch (purges cache)
//   otherwise               → retry only failed/pending scenes
router.post("/:id/images", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  if (isAnimating(req.params.id)) return res.status(409).json(ANIMATING_REFUSAL);
  if (preparingProjects.has(req.params.id)) return res.status(409).json(PREPARING_REFUSAL);
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
  // Read again: the run has already marked its scenes generating, and writing
  // the copy read above would put their old error statuses back.
  const started = readProject(ctx.dataDir, id) || project;
  writeProject(ctx.dataDir, { ...started, status: STORY_STATUS.GENERATING_IMAGES, error: null });
  return res.json({ ok: true, project: readProject(ctx.dataDir, id) });
});

// POST /:id/cancel — stop an in-flight pipeline/render that's running long or
// has gone rogue. Flags the project so imagesStage halts between images, and
// kills the render ffmpeg if one is active.
router.post("/:id/cancel", (req, res) => {
  const project = readProject(req.ctx.dataDir, req.params.id);
  if (!project) return res.status(404).json({ ok: false, error: "project not found" });
  markCancelled(req.params.id);
  const jobId = project.render?.jobId;
  if (jobId) { try { cancelRenderJob(jobId, req.ctx.userId); } catch {} }
  const updated = writeProject(req.ctx.dataDir, { ...project, status: STORY_STATUS.ERROR, error: "Cancelled." });
  return res.json({ ok: true, project: updated });
});

// POST /:id/process — run transcribe -> segment -> images SERVER-SIDE, detached.
router.post("/:id/process", (req, res) => {
  const existing = readProject(req.ctx.dataDir, req.params.id);
  if (!existing) return res.status(404).json({ ok: false, error: "project not found" });
  const limit = maxScenesFrom(req.body);
  if (!limit.ok) return res.status(400).json(BAD_MAX_SCENES);
  if (isAnimating(req.params.id)) return res.status(409).json(ANIMATING_REFUSAL);
  // The pictures are about to start by themselves (an AI music video's prompts
  // are being written): Resume must not start a second run. It only undoes a
  // Cancel made meanwhile, so the queued start goes ahead instead of stopping.
  if (preparingProjects.has(req.params.id)) {
    cancelledProjects.delete(req.params.id);
    writeProject(req.ctx.dataDir, { ...existing, status: STORY_STATUS.GENERATING_IMAGES, error: null });
    return res.json({ ok: true, preparing: true });
  }
  // A music video whose song copy never finished (the server restarted): copy it, then the pictures.
  if (existing.source?.copyFrom) {
    writeProject(req.ctx.dataDir, { ...existing, status: STORY_STATUS.GENERATING_IMAGES, error: null });
    startStoryImages({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir }, req.params.id);
    return res.json({ ok: true });
  }
  // Same rule as an import's auto-start, so Resume works on an imported
  // script whose narration is in the shared outputs folder.
  const guard = confineImportAudio(req.ctx, req.body?.mediaPath);
  if (!guard.ok) return res.status(guard.status).json({ ok: false, error: guard.error });
  // What the soundtrack was called and whether it was trimmed: shown back to
  // the user in the Music panel, never used as a path. A resume sends neither
  // and keeps what the first start recorded.
  if (req.body?.sourceName !== undefined || req.body?.sourceTrimmed !== undefined) {
    const { name: _previousName, ...sourceWithoutName } = existing.source || {};
    const facts = sourceDisplayFacts({ name: req.body.sourceName, trimmed: req.body.sourceTrimmed });
    writeProject(req.ctx.dataDir, { ...existing, source: { ...sourceWithoutName, ...facts } });
  }
  const ctx = { dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir };
  const id = req.params.id;
  cancelledProjects.delete(id);
  runStoryPipeline(ctx, id, guard.path, { maxScenes: limit.value }).catch((e) => {
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
  const limit = maxScenesFrom(req.body);
  if (!limit.ok) return res.status(400).json(BAD_MAX_SCENES);
  if (isAnimating(req.params.id)) return res.status(409).json(ANIMATING_REFUSAL);
  if (preparingProjects.has(req.params.id)) return res.status(409).json(PREPARING_REFUSAL);
  if (!project.transcript?.words?.length) {
    return res.status(400).json({ ok: false, error: "no transcript to re-segment — start again" });
  }
  if (!project.source?.audioPath) {
    return res.status(400).json({ ok: false, error: "missing source audio — start again" });
  }
  const sourceAudio = confinedProjectAudio(req.ctx, project);
  if (!sourceAudio.ok) return res.status(400).json({ ok: false, error: STORY_AUDIO_REFUSAL });
  const audioPath = sourceAudio.path;

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
  runStoryPipeline(ctx, id, audioPath, { maxScenes: limit.value }).catch((e) => {
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
    if (preparingProjects.has(project.projectId)) return res.status(409).json(PREPARING_REFUSAL);
    const key = sceneKey(project.projectId, req.params.sid);
    sceneRegens.add(key);
    let image;
    let result;
    try {
      result = await _imageGenFn({
        seriesId: `${project.projectId}-${req.params.sid}-${Date.now()}`,
        partNumber: 1,
        rawPrompt: project.scenes[idx].imagePrompt,
        aspect: imageAspectFor(project),
      });
      if (result?.ok) {
        // Freshly generated, so this is no longer a library reuse — clear the
        // provenance or the UI keeps calling it "Reused" — and harvest it so
        // the next project can use it.
        let entry = null;
        try {
          entry = await _imageLib.register({ dataDir: req.ctx.dataDir, outputDir: req.ctx.outputDir, sourcePath: result.path, prompt: sceneMatchText(project.scenes[idx].imagePrompt), style: String(project.style || ""), aspect: imageAspectFor(project), provider: result.provider, watermarkFree: result.watermarkFree, projectId: project.projectId });
        } catch (err) {
          console.warn(`[story] regenerate harvest failed: ${err?.message || err}`);
        }
        image = { imagePath: result.path, imageUrl: result.publicUrl || null, imageStatus: "done", imageError: null, imageSource: "generated", imageLibraryId: entry?.id || null, imageReuseScore: null, imageChosenByUser: false, ...NO_SCENE_VIDEO };
      } else {
        image = { imageStatus: "error", imageError: shortImageError(result?.error), imageChosenByUser: false };
      }
    } finally {
      sceneRegens.delete(key);
    }
    // Generating took a while: put the result on the scene as it is NOW, so
    // a picture put on another scene, or a caption edit, meanwhile isn't
    // undone. (A picture can't be put on THIS scene meanwhile: the PUT waits.)
    const fresh = readProject(req.ctx.dataDir, req.params.id);
    if (!fresh) return res.status(404).json({ ok: false, error: "project not found" });
    const updated = writeProject(req.ctx.dataDir, {
      ...fresh,
      scenes: (fresh.scenes || []).map((s) => (s.id === req.params.sid ? { ...s, ...image } : s)),
    });
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
router.patch("/:id/captions", (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const captions = ["none", "static", "kinetic"].includes(req.body?.captions)
      ? req.body.captions
      : (project.captions || "kinetic");
    const updated = writeProject(req.ctx.dataDir, {
      ...project,
      captions,
      ...normaliseCaptionSettings(req.body || {}, project),
    });
    return res.json({ ok: true, project: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.patch("/:id/music", (req, res) => {
  try {
    const project = readProject(req.ctx.dataDir, req.params.id);
    if (!project) return res.status(404).json({ ok: false, error: "project not found" });
    const raw = req.body?.path ? String(req.body.path).trim() : "";
    let path = null;
    if (raw) {
      // A ref is stored as the ref (it resolves again at render); a file as its checked real path.
      try {
        const confined = confineStoryMusic(req.ctx, raw);
        path = MUSIC_REF_PREFIX.test(raw) ? raw : confined;
      } catch (err) {
        if (sendUserPathError(res, err)) return;
        throw err;
      }
    }
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
    // Both checked BEFORE a job exists, so a refusal leaves the project as it was.
    const sourceAudio = confinedProjectAudio(req.ctx, project);
    if (!sourceAudio.ok) return res.status(400).json({ ok: false, error: STORY_AUDIO_REFUSAL });
    const music = storyMusicForRender(req.ctx, project.music?.path);
    if (!music.ok) return res.status(music.status).json({ ok: false, error: music.error, message: music.message });
    const out = storyOutDir(req.ctx.outputDir, project.projectId);
    if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
    const outPath = path.join(out, "video.mp4");
    const durationSec = scenes[scenes.length - 1].endMs / 1000;
    const { width, height } = storyFrameSize(project.aspect);
    const job = createJob(req.ctx.userId, { durationSec });
    persistJob(req.ctx.dataDir, { ...job, projectId: project.projectId, status: "running" });
    writeProject(req.ctx.dataDir, {
      ...project, status: STORY_STATUS.RENDERING,
      render: { jobId: job.jobId, outputPath: null, status: "running" },
    });

    const audioPath = sourceAudio.path;
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
    // A step of the project (live here, beating) until the render settles.
    asRunningStoryStep({ dataDir }, pid, () => _renderFn({
      jobId: job.jobId,
      // Long-form templates set scene.beatSec so a 12-image, 30-minute session
      // is re-cut into ~40 s beats cycling through the images (each with its
      // own move + dissolve) instead of one static frame per 2-3 minutes.
      // Projects without beatSec render their scenes exactly as before.
      scenes: expandScenesToBeats(scenes, { beatSec: project.scene?.beatSec }),
      words: project.transcript?.words || [],
      audioPath,
      // A `library:`/`mylib:` ref that fails to resolve (forgotten track,
      // deleted file, stale project) must degrade to no music, not to the
      // literal ref string — resolveLibraryTrack/resolveTenantTrack return
      // null for it, and buildStoryFfmpegArgs would otherwise hand ffmpeg a
      // "-i mylib:<uuid>" that doesn't exist and kills the WHOLE render, not
      // just the music. A bare absolute path (pre-library back-compat, see
      // MusicPicker's REF_PREFIX comment) is still passed through as-is —
      // only the two known ref prefixes are treated as "must resolve or die".
      musicPath: music.path,
      musicVolume: project.music?.volume ?? 0.3,
      autoDuck: project.music?.autoDuck ?? true,
      onProgress: persistRenderPct,
      logo: brandLogoFor(req.ctx.dataDir),
      // Render resolution is env-tunable. Default 720×1280 (still vertical /
      // social-ready) keeps long videos renderable on a modest CPU box — full
      // 1080×1920 over a 27-min kinetic render pegs CPU/RAM and stalls the
      // server. Bump STORY_RENDER_WIDTH/HEIGHT once on bigger hardware.
      // Landscape projects use the separate STORY_RENDER_LANDSCAPE_WIDTH/HEIGHT
      // envs (default 1280×720) and square ones STORY_RENDER_SQUARE_SIZE
      // (default 1080), so portrait defaults/tuning stay untouched.
      width,
      height,
      captions: project.captions || "kinetic",
      captionPreset: project.captionPreset,
      captionMotion: project.captionMotion,
      captionLayout: project.captionLayout,
      captionDepth: project.captionDepth,
      captionStagger: project.captionStagger,
      captionHighlight: project.captionHighlight,
      captionEnergy: project.captionEnergy,
      captionSeed: project.captionSeed,
      captionTitle: project.captionTitle,
      outPath,
      audioDurationSec: audioDurationSec || undefined,
    })).then((r) => {
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
