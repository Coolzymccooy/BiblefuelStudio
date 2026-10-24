import { z } from "zod";
import { fail } from "./toolResult.js";
import { NORMALISERS, outputUrl } from "./jobs.js";

/**
 * Shared pieces of the Story video tools (tools/story.js and tools/storyScenes.js):
 * what a project looks like to an agent, and how many pictures a step will make.
 * Lives outside tools/ because the registry loads every file there as tools.
 */

/** The picture styles a story can take (lib/story/styleAnchors.js STYLE_ANCHORS keys). */
export const STORY_STYLES = ["cinematic-bible", "modern-devotional", "heavenly-atmosphere", "ancient-scripture", "music-video"];
export const STORY_ASPECTS = ["portrait", "landscape", "square"];
export const CAPTION_MODES = ["none", "static", "kinetic"];

// Story ids are uuids and scene ids "scene-001": no dots or slashes, so both are safe in a route path.
export const STORY_ID = z.string().trim().regex(/^[\w-]{1,80}$/, "a story project id from story_project");
export const SCENE_ID = z.string().trim().regex(/^[\w-]{1,80}$/, "a scene id from story_project get");

// lib/story/sceneSegmenter.js: about one scene per 8 seconds, widened so a project never has more than the cap.
const TARGET_SCENE_SEC = 8;
const DEFAULT_MAX_SCENES = 60;
const MIN_MAX_SCENES = 8;

function maxScenes(scene) {
  const own = Number(scene?.maxScenes);
  if (Number.isFinite(own) && own >= 1) return Math.round(own);
  return Math.max(MIN_MAX_SCENES, Number(process.env.STORY_MAX_SCENES) || DEFAULT_MAX_SCENES);
}

/**
 * How many scenes (so how many pictures) the segmenter will make for this much speech, as it
 * sizes them. An estimate: the AI split it asks for may land a scene or two either side.
 * @param {number} durationMs
 * @param {{ targetSceneSec?: number, maxScenes?: number } | null} [scene] the project's scene policy
 */
export function estimateSceneCount(durationMs, scene = null) {
  const totalSec = Math.max(0, Number(durationMs) || 0) / 1000;
  if (totalSec === 0) return 0;
  const cap = maxScenes(scene);
  const target = Number(scene?.targetSceneSec) > 0 ? Number(scene.targetSceneSec) : TARGET_SCENE_SEC;
  const effective = Math.max(target, totalSec / cap);
  return Math.min(cap, Math.max(1, Math.ceil(totalSec / effective)));
}

const hasPicture = (scene) => scene?.imageStatus === "done";
// The images stage keeps a scene only when it is done AND has a file (routes/story.js runImagesStage).
const keptByImagesRun = (scene) => hasPicture(scene) && Boolean(scene.imagePath);

/** The pictures an images run makes: every scene without a finished one, or every scene with force. */
export function missingImageCount(project, { force = false } = {}) {
  const scenes = Array.isArray(project?.scenes) ? project.scenes : [];
  return force ? scenes.length : scenes.filter((s) => !keptByImagesRun(s)).length;
}

/** The narration's length when the project already knows it (its transcript, or its source), else null. */
export function knownDurationMs(project) {
  const words = project?.transcript?.words;
  const last = Array.isArray(words) && words.length ? Number(words[words.length - 1]?.endMs) : 0;
  if (last > 0) return last;
  const source = Number(project?.source?.durationMs);
  return source > 0 ? source : null;
}

/**
 * A project made with AI motion in the app animates its scenes, paid, the first time its
 * pictures are all in. Agents order paid clips only through story_animate (which charges the
 * aiVideoUsd cap), so the tools that make pictures refuse such a project until that has happened.
 */
export function aiMotionRefusal(project) {
  const motion = project?.aiMotion;
  if (!motion || motion.autoStartedAt) return null;
  return fail(
    "AI_MOTION_PROJECT",
    "This project was set up in the app to animate its scenes with paid AI motion as soon as the pictures are ready. Make its pictures in the app, or ask the user to.",
  );
}

function sceneView(scene, publicBase) {
  return {
    id: scene.id,
    text: scene.text ?? "",
    startMs: scene.startMs ?? null,
    endMs: scene.endMs ?? null,
    imagePrompt: scene.imagePrompt ?? "",
    imageStatus: scene.imageStatus ?? "pending",
    imageError: scene.imageError ?? null,
    image: scene.imagePath || scene.imageUrl
      ? { url: scene.imageUrl ? outputUrl(scene.imageUrl, publicBase) : null, path: scene.imagePath ?? null }
      : null,
    aiVideoStatus: scene.aiVideoStatus ?? "none",
  };
}

/**
 * A project as an agent sees it: the settings, each scene (with its picture as url and path)
 * and a story job handle, without the word-by-word transcript.
 */
export function projectView(project, publicBase) {
  const scenes = Array.isArray(project?.scenes) ? project.scenes : [];
  return {
    id: project.projectId,
    title: project.title ?? "",
    status: project.status ?? null,
    error: project.error ?? null,
    style: project.style ?? null,
    aspect: project.aspect ?? "portrait",
    captions: project.captions ?? "kinetic",
    cast: Array.isArray(project.cast) ? project.cast : [],
    music: project.music ?? null,
    audioPath: project.source?.audioPath ?? null,
    durationMs: knownDurationMs(project),
    aiMotion: project.aiMotion ?? null,
    sceneCount: scenes.length,
    scenesWithImage: scenes.filter(hasPicture).length,
    scenes: scenes.map((s) => sceneView(s, publicBase)),
    job: NORMALISERS.story.normalise({ project }, { outputUrl: (p) => outputUrl(p, publicBase) }),
  };
}

/** The handle a tool returns when it has just started story work in the background. */
export function startedHandle(id, phase) {
  return { kind: "story", id: String(id), status: "running", percent: null, phase, output: null, error: null };
}
