import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { addClip, readLibrary, setPoster, markPosterFailed, clipDir } from "./store.js";
import { listProjects, readProject, writeProject } from "../story/projectStore.js";
import { VIDEO_INPUT_GUARD } from "../videoInputGuard.js";

/**
 * Filling the visual library from what came before it: AI clips that Story
 * Animate made before every clip was kept, and posters for clips that
 * arrived without one. Both work a batch at a time so one request never
 * holds the server for long; the caller asks again while some remain.
 */

const POSTER_TIMEOUT_MS = 30_000;
const MAX_POSTERS_PER_CALL = 10;
// Stop starting posters well before Cloudflare gives up on the request (~100 s).
const POSTER_RUN_BUDGET_MS = 60_000;
const MAX_STORY_CLIPS_PER_CALL = 10;

const isKeptStoryClip = (s) => s.mediaKind === "video" && (s.aiVideoClip === true || s.aiVideoStatus === "done")
  && s.aiVideoStatus !== "generating" && s.aiVideoStatus !== "queued";

const isInside = (dir, file) => {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** A project title as one tag: no commas (the tag editor splits on them), cut at a word. */
export function titleTag(title) {
  const words = String(title || "").replace(/[,\s]+/g, " ").trim();
  if (words.length <= 40) return words;
  const cut = words.slice(0, 40);
  return cut.slice(0, cut.lastIndexOf(" ") > 10 ? cut.lastIndexOf(" ") : 40).trim();
}

const storyClipsToKeep = (ctx, project) => (project?.scenes || []).filter((s) => isKeptStoryClip(s) && !s.aiVideoLibraryId
  && typeof s.videoPath === "string" && isInside(ctx.outputDir, s.videoPath) && fs.existsSync(s.videoPath));

function keepProjectClips(ctx, project, scenes, keep) {
  const found = {};
  for (const s of scenes) {
    try {
      found[s.id] = keep(ctx, {
        file: s.videoPath, copy: true, prompt: s.aiVideoPrompt || "",
        aspect: project.aspect || "portrait", costUsd: Number(s.aiVideoCostUsd) || 0,
        source: { kind: "story", projectId: project.projectId, sceneId: s.id },
        tags: [titleTag(project.title)].filter(Boolean),
      }).id;
    } catch (e) {
      console.warn(`[visual-library] could not keep Story clip ${project.projectId}/${s.id}: ${e?.message || e}`);
    }
  }
  if (!Object.keys(found).length) return 0;
  // Re-read before writing so nothing else written to the project is lost.
  // updatedAt is kept: this is bookkeeping, not an edit, and the Story list sorts by it.
  const fresh = readProject(ctx.dataDir, project.projectId);
  if (!fresh) return 0;
  writeProject(ctx.dataDir, {
    ...fresh,
    scenes: fresh.scenes.map((s) => (found[s.id] && !s.aiVideoLibraryId ? { ...s, aiVideoLibraryId: found[s.id] } : s)),
  });
  return Object.keys(found).length;
}

/**
 * Copy Story AI clips that are not in the library yet into it, up to a batch,
 * and mark each scene with its library id so it is never added twice. The
 * scene keeps its own copy. A clip ordered before its prompt was saved is
 * kept as "prompt unknown": the prompt it was made with cannot be recovered.
 */
export function backfillStoryClips(ctx, { keep = addClip, limit = MAX_STORY_CLIPS_PER_CALL } = {}) {
  let added = 0;
  let remaining = 0;
  for (const summary of listProjects(ctx.dataDir)) {
    try {
      const project = readProject(ctx.dataDir, summary.projectId);
      const scenes = storyClipsToKeep(ctx, project);
      if (!scenes.length) continue;
      const room = Math.max(0, limit - added);
      remaining += scenes.length - Math.min(room, scenes.length);
      if (room) added += keepProjectClips(ctx, project, scenes.slice(0, room), keep);
    } catch (e) {
      console.warn(`[visual-library] Story back-fill skipped project ${summary.projectId}: ${e?.message || e}`);
    }
  }
  return { added, remaining };
}

/** One frame from half a second in (or the first frame), scaled to 720 wide. */
export function grabPoster(file, out) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const run = (seek) => new Promise((resolve) => {
    const child = spawn(ffmpeg, ["-y", ...seek, ...VIDEO_INPUT_GUARD, "-i", file, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", out],
      { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => child.kill("SIGKILL"), POSTER_TIMEOUT_MS);
    child.on("error", () => { clearTimeout(timer); resolve(false); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0); });
  });
  return run(["-ss", "0.5"]).then((ok) => ok || run([]));
}

const needsPoster = (c) => !c.posterUrl && !c.posterFailed;

/**
 * Make posters for clips that have none, a batch at a time. A clip whose
 * poster cannot be made is marked and not tried again.
 */
export async function makeMissingPosters(ctx, { poster = grabPoster, limit = MAX_POSTERS_PER_CALL, budgetMs = POSTER_RUN_BUDGET_MS } = {}) {
  let made = 0;
  let failed = 0;
  const started = Date.now();
  for (const clip of readLibrary(ctx.dataDir).filter(needsPoster).slice(0, limit)) {
    if (Date.now() - started > budgetMs) break;
    const file = path.join(clipDir(ctx.outputDir, clip.id), "clip.mp4");
    const out = path.join(clipDir(ctx.outputDir, clip.id), "poster.tmp.jpg");
    const ok = fs.existsSync(file) && await poster(file, out).catch(() => false);
    if (ok && setPoster(ctx, clip.id, out)) made += 1;
    else {
      failed += 1;
      fs.rmSync(out, { force: true });
      markPosterFailed(ctx.dataDir, clip.id);
    }
  }
  return { made, failed, remaining: readLibrary(ctx.dataDir).filter(needsPoster).length };
}
