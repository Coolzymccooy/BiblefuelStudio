import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { readProject, writeProject, listProjects, STORY_STATUS } from "./projectStore.js";
import { resolveSceneVideo } from "./sceneVideo.js";
import {
  SEEDANCE_MODELS, clampSeedanceDuration, seedanceRatio,
  submitSeedanceTask, waitForSeedanceTask, downloadSeedanceVideo,
} from "../videoGen/providers/seedance.js";
import { estimateTokens, usdForTokens, usdPerSecond, reserveSpend, settleSpend, releaseSpend } from "../videoGen/spend.js";

/**
 * Animate: turn a Story scene's finished picture into a short Seedance clip.
 *
 * The clip lands in the scene's existing videoPath / mediaKind:"video"
 * fields, which the render already plays, and the picture stays as the
 * poster. Each clip is reserved in the spend ledger before it is ordered and
 * settled against BytePlus's real token count after. The task id is saved
 * on the scene BEFORE waiting, so after a restart resumeAnimations collects
 * a paid-for clip instead of ordering it again. A clip that fails leaves the
 * picture in place; the render never waits for animation.
 */

export const ANIMATE_CONCURRENCY = 3;
export const AI_QUALITY = Object.freeze({
  standard: Object.freeze({ model: SEEDANCE_MODELS.mini, resolution: "720p" }),
  high: Object.freeze({ model: SEEDANCE_MODELS.standard, resolution: "1080p" }),
});

const MOTION_LINE = "Slow push-in, gentle light shift, subtle natural movement.";
const IN_FLIGHT = new Set(["queued", "generating"]);

const defaultDeps = Object.freeze({
  submit: submitSeedanceTask,
  wait: waitForSeedanceTask,
  download: downloadSeedanceVideo,
  resolveClip: resolveSceneVideo,
  now: () => Date.now(),
});

const runs = new Set(); // projects with an Animate run in this process
const cancels = new Set(); // projects asked to stop ordering clips

export function isAnimating(projectId) {
  return runs.has(projectId);
}

export function cancelAnimation(projectId) {
  cancels.add(projectId);
}

export function qualityOf(q) {
  return Object.hasOwn(AI_QUALITY, q) ? q : "standard";
}

export function sceneClipSec(scene) {
  return clampSeedanceDuration(((scene.endMs || 0) - (scene.startMs || 0)) / 1000);
}

export function animatePrompt(scene) {
  return `${String(scene.imagePrompt || scene.text || "").trim()} ${MOTION_LINE}`.trim();
}

export const ledgerKey = (projectId, sceneId) => `${projectId}:${sceneId}`;

/**
 * The user's own uploaded clip (a video that AI motion did not make): never
 * animated over. aiVideoClip marks a kept AI clip, so a failed re-roll
 * (status "error") still counts as AI and can be tried again.
 */
export function isOwnClip(scene) {
  return scene.mediaKind === "video" && !scene.aiVideoClip && scene.aiVideoStatus !== "done";
}

/** The scene still plays an AI clip, whatever the last order's status. */
function hasAiClip(scene) {
  return scene.mediaKind === "video" && (scene.aiVideoClip === true || scene.aiVideoStatus === "done");
}

export function animatableScenes(project, sceneIds) {
  const wanted = Array.isArray(sceneIds) && sceneIds.length ? new Set(sceneIds) : null;
  return (project.scenes || []).filter((s) => {
    if (s.imageStatus !== "done" || !s.imagePath || IN_FLIGHT.has(s.aiVideoStatus)) return false;
    if (isOwnClip(s)) return false;
    // "Animate all" skips scenes already animated; naming one re-rolls it.
    return wanted ? wanted.has(s.id) : s.aiVideoStatus !== "done" && !hasAiClip(s);
  });
}

export function estimateAnimation(project, sceneIds, quality = "standard") {
  const { model, resolution } = AI_QUALITY[qualityOf(quality)];
  const ratio = seedanceRatio(project.aspect);
  const scenes = animatableScenes(project, sceneIds);
  let seconds = 0;
  let usd = 0;
  for (const s of scenes) {
    const sec = sceneClipSec(s);
    seconds += sec;
    usd += usdForTokens({ model, resolution, tokens: estimateTokens({ durationSec: sec, ratio, resolution }) });
  }
  return {
    clips: scenes.length, seconds, usd, model, resolution,
    usdPerSecond: usdPerSecond({ model, resolution, ratio }),
    sceneIds: scenes.map((s) => s.id),
  };
}

/** Rewrite one scene from the latest project on disk; fn returns null to leave it. */
function patchScene(dataDir, projectId, sceneId, fn) {
  const fresh = readProject(dataDir, projectId);
  if (!fresh) return null;
  let changed = null;
  const scenes = (fresh.scenes || []).map((s) => {
    if (s.id !== sceneId) return s;
    changed = fn(s);
    return changed || s;
  });
  if (!changed) return null;
  writeProject(dataDir, { ...fresh, scenes, updatedAt: Date.now() });
  return changed;
}

/** Fail a scene, but only while it is still waiting on this same order. */
function markError(dataDir, projectId, sceneId, taskId, message) {
  patchScene(dataDir, projectId, sceneId, (s) => (
    (s.aiVideoTaskId ?? null) === (taskId ?? null) && IN_FLIGHT.has(s.aiVideoStatus)
      ? { ...s, aiVideoStatus: "error", aiVideoError: message }
      : null
  ));
}

function removeClipFiles(clip) {
  for (const f of [clip.videoPath, clip.posterPath]) {
    try { if (f) fs.rmSync(f, { force: true }); } catch { /* best effort */ }
  }
}

// BytePlus told us outright that no clip exists (so nothing was charged).
const NOT_CHARGED_CODES = new Set(["FAILED", "NOT_FOUND"]);

/** What this scene's clip is estimated to cost in tokens; 12 s (the longest) if the scene is gone. */
function estimatedTokensFor(ctx, projectId, sceneId, resolution) {
  const project = readProject(ctx.dataDir, projectId);
  const scene = project?.scenes?.find((s) => s.id === sceneId);
  return estimateTokens({
    durationSec: scene ? sceneClipSec(scene) : clampSeedanceDuration(12),
    ratio: seedanceRatio(project?.aspect),
    resolution,
  });
}

function removeFile(file) {
  try { if (file) fs.rmSync(file, { force: true }); } catch { /* best effort */ }
}

async function finishTask(ctx, projectId, sceneId, taskId, { model, resolution, ledgerDir, deps }) {
  const key = ledgerKey(projectId, sceneId);
  const done = await deps.wait(taskId);
  if (!done.ok) {
    if (NOT_CHARGED_CODES.has(done.code)) {
      releaseSpend(ledgerDir, key);
      markError(ctx.dataDir, projectId, sceneId, taskId, done.error);
      return;
    }
    // Unknown outcome (timeout, auth, ...): BytePlus may still make and bill
    // this clip, so count the estimate rather than forgetting the spend.
    settleSpend(ledgerDir, key, { model, resolution, tokens: estimatedTokensFor(ctx, projectId, sceneId, resolution) });
    markError(ctx.dataDir, projectId, sceneId, taskId,
      `BytePlus did not return this clip (${done.error}). Its estimated cost has been counted in case BytePlus charged for it.`);
    return;
  }
  // Made means paid for, whatever happens to the scene now. A missing or zero
  // token count is never trusted as free.
  const tokens = Number(done.tokens) > 0 ? done.tokens : estimatedTokensFor(ctx, projectId, sceneId, resolution);
  const costUsd = settleSpend(ledgerDir, key, { model, resolution, tokens });
  const name = `bg-video-${randomUUID()}.mp4`;
  const downloaded = path.join(ctx.outputDir, name);
  try {
    fs.mkdirSync(ctx.outputDir, { recursive: true });
    await deps.download(done.videoUrl, downloaded);
  } catch (e) {
    removeFile(downloaded);
    markError(ctx.dataDir, projectId, sceneId, taskId, `The clip was made but could not be downloaded: ${e?.message || e}`);
    return;
  }
  const clip = await deps.resolveClip({ outputDir: ctx.outputDir, uploadPath: name });
  if (!clip.ok) {
    removeFile(downloaded);
    markError(ctx.dataDir, projectId, sceneId, taskId, clip.error);
    return;
  }
  let superseded = null; // the earlier AI clip a re-roll replaces
  const applied = patchScene(ctx.dataDir, projectId, sceneId, (s) => {
    if (s.aiVideoTaskId !== taskId || s.aiVideoStatus !== "generating") return null;
    superseded = hasAiClip(s) ? s.videoPath : null;
    return {
      ...s, videoPath: clip.videoPath, videoUrl: clip.videoUrl, mediaKind: "video",
      aiVideoClip: true, aiVideoStatus: "done", aiVideoError: null, aiVideoCostUsd: costUsd,
    };
  });
  // The scene keeps its picture as the poster, so the clip's own poster is spare,
  // and so is the original download when the clip was converted.
  if (clip.videoPath !== downloaded) removeFile(downloaded);
  if (!applied) {
    // A new picture was chosen meanwhile: keep it, and drop the late clip.
    removeClipFiles(clip);
    return;
  }
  if (clip.posterPath && clip.posterPath !== applied.imagePath) removeFile(clip.posterPath);
  // A running render may be about to open the old clip, so it stays until then.
  if (superseded && superseded !== clip.videoPath
    && readProject(ctx.dataDir, projectId)?.status !== STORY_STATUS.RENDERING) {
    removeFile(superseded);
  }
}

async function animateOne(ctx, projectId, sceneId, { model, resolution }, { ledgerDir, deps }) {
  const project = readProject(ctx.dataDir, projectId);
  const scene = project?.scenes?.find((s) => s.id === sceneId);
  if (!scene || scene.aiVideoStatus !== "queued") return; // changed or removed meanwhile
  const key = ledgerKey(projectId, sceneId);
  const durationSec = sceneClipSec(scene);
  const estimate = usdForTokens({
    model, resolution,
    tokens: estimateTokens({ durationSec, ratio: seedanceRatio(project.aspect), resolution }),
  });
  const reserved = reserveSpend(ledgerDir, key, estimate);
  if (!reserved.ok) {
    markError(ctx.dataDir, projectId, sceneId, null, reserved.error);
    return;
  }
  const submitted = await deps.submit({
    prompt: animatePrompt(scene), firstFramePath: scene.imagePath, aspect: project.aspect, durationSec, model, resolution,
  });
  if (!submitted.ok) {
    releaseSpend(ledgerDir, key);
    markError(ctx.dataDir, projectId, sceneId, null, submitted.error);
    return;
  }
  // Saved before waiting: after a restart the sweep collects this paid-for clip.
  patchScene(ctx.dataDir, projectId, sceneId, (s) => (
    s.aiVideoStatus === "queued"
      ? { ...s, aiVideoStatus: "generating", aiVideoTaskId: submitted.taskId, aiVideoMode: submitted.mode, aiVideoStartedAt: deps.now() }
      : null
  ));
  await finishTask(ctx, projectId, sceneId, submitted.taskId, { model, resolution, ledgerDir, deps });
}

async function runAnimation(ctx, projectId, ids, quality, opts) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length) {
      const sceneId = ids[cursor++];
      if (cancels.has(projectId)) {
        markError(ctx.dataDir, projectId, sceneId, null, "Stopped before this clip was ordered.");
        continue;
      }
      try {
        await animateOne(ctx, projectId, sceneId, quality, opts);
      } catch (e) {
        releaseSpend(opts.ledgerDir, ledgerKey(projectId, sceneId));
        markError(ctx.dataDir, projectId, sceneId, readProject(ctx.dataDir, projectId)?.scenes?.find((s) => s.id === sceneId)?.aiVideoTaskId ?? null, String(e?.message || e));
      }
    }
  };
  // allSettled: one worker's throw must not clear the run while others still work.
  await Promise.allSettled(Array.from({ length: Math.min(ANIMATE_CONCURRENCY, ids.length) }, worker));
}

/**
 * Mark the chosen scenes queued now (the page sees it on its next poll) and
 * make their clips in the background. Returns the project as written, or
 * null when a run is already going or nothing can be animated.
 */
export function startAnimation(ctx, projectId, { sceneIds, quality = "standard", ledgerDir, deps } = {}) {
  if (runs.has(projectId)) return null;
  const project = readProject(ctx.dataDir, projectId);
  if (!project) return null;
  const q = AI_QUALITY[qualityOf(quality)];
  const ids = new Set(animatableScenes(project, sceneIds).map((s) => s.id));
  if (!ids.size) return null;
  const scenes = project.scenes.map((s) => (ids.has(s.id)
    ? { ...s, aiVideoStatus: "queued", aiVideoError: null, aiVideoTaskId: null, aiVideoModel: q.model, aiVideoResolution: q.resolution }
    : s));
  // Written first: a write that throws must not leave the project marked animating.
  const written = writeProject(ctx.dataDir, { ...project, scenes, updatedAt: Date.now() });
  runs.add(projectId);
  cancels.delete(projectId);
  runAnimation(ctx, projectId, [...ids], q, { ledgerDir, deps: { ...defaultDeps, ...deps } })
    .catch((e) => console.warn(`[story] animate ${projectId} failed: ${e?.message || e}`))
    .finally(() => { runs.delete(projectId); cancels.delete(projectId); });
  return written;
}

/**
 * After a restart: collect clips that were ordered (task id saved) and fail
 * scenes that were queued but never ordered. A project counts as animating
 * until all of its clips are collected, so image runs stay refused meanwhile.
 * An order over 24 h old is still asked about: BytePlus saying it has no such
 * clip releases the estimate; any other outcome settles it, in case it was
 * charged. Resolves with the number of clips being collected.
 */
export async function resumeAnimations(ctx, { ledgerDir, deps } = {}) {
  const d = { ...defaultDeps, ...deps };
  const projectRuns = [];
  let count = 0;
  for (const summary of listProjects(ctx.dataDir)) {
    const project = readProject(ctx.dataDir, summary.projectId);
    if (!project || runs.has(project.projectId)) continue; // a live run owns its scenes
    const pending = [];
    for (const s of project.scenes || []) {
      if (!IN_FLIGHT.has(s.aiVideoStatus)) continue;
      if (!s.aiVideoTaskId) {
        releaseSpend(ledgerDir, ledgerKey(project.projectId, s.id));
        markError(ctx.dataDir, project.projectId, s.id, null, "Interrupted by a server restart before the clip was ordered. Animate it again.");
        continue;
      }
      pending.push(
        finishTask(ctx, project.projectId, s.id, s.aiVideoTaskId, {
          model: s.aiVideoModel || SEEDANCE_MODELS.mini, resolution: s.aiVideoResolution || "720p", ledgerDir, deps: d,
        }).catch((e) => console.warn(`[story] collecting clip ${s.aiVideoTaskId} failed: ${e?.message || e}`)),
      );
    }
    if (!pending.length) continue;
    const projectId = project.projectId;
    runs.add(projectId);
    count += pending.length;
    projectRuns.push(Promise.allSettled(pending).finally(() => { runs.delete(projectId); }));
  }
  await Promise.all(projectRuns);
  return count;
}
