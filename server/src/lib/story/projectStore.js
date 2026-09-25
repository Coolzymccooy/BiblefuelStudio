import crypto from "crypto";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

/** Project lifecycle states. */
export const STORY_STATUS = {
  DRAFT: "draft",
  DRAFT_SCRIPT: "draft_script",   // long-form: outline written, nothing synthesised
  NARRATING: "narrating",         // long-form: chunked TTS in progress
  TRANSCRIBING: "transcribing",
  SEGMENTING: "segmenting",
  GENERATING_IMAGES: "generating_images",
  READY_TO_RENDER: "ready_to_render",
  RENDERING: "rendering",
  DONE: "done",
  ERROR: "error",
};

function projectsDir(baseDir) {
  return path.join(baseDir, "story-projects");
}

function projectPath(baseDir, projectId) {
  const safe = String(projectId || "").replace(/[^a-z0-9_-]/gi, "");
  if (!safe) throw new Error("projectStore: invalid projectId");
  return path.join(projectsDir(baseDir), `${safe}.json`);
}

/**
 * Create + persist a fresh draft project.
 * @param {string} baseDir  the caller's req.ctx.dataDir
 * @param {{title?:string, style?:string}} opts
 */
const CAPTION_MOTIONS = ["words", "lines", "block"];
const CAPTION_LAYOUTS = ["center", "center-large", "bottom-center", "bottom-left", "staggered"];

/**
 * Normalise the caption look/motion settings a project carries into its
 * render. Every field is optional: an absent one means "let the renderer
 * decide", which is how projects made before these controls existed keep
 * rendering exactly as they did.
 *
 * @param {object} [input]
 * @param {object} [current] existing values, kept when input omits a field
 */
export function normaliseCaptionSettings(input = {}, current = {}) {
  const pick = (key, allowed) => {
    const raw = input[key] === undefined ? current[key] : input[key];
    const value = raw === null || raw === undefined ? undefined : String(raw);
    return value && allowed.includes(value) ? value : undefined;
  };
  const bool = (key) => {
    const raw = input[key] === undefined ? current[key] : input[key];
    return raw === undefined || raw === null ? undefined : Boolean(raw);
  };
  const presetRaw = input.captionPreset === undefined ? current.captionPreset : input.captionPreset;
  const preset = presetRaw === null || presetRaw === undefined ? undefined : String(presetRaw).trim();
  return {
    captionPreset: preset || "default",
    captionMotion: pick("captionMotion", CAPTION_MOTIONS),
    captionLayout: pick("captionLayout", CAPTION_LAYOUTS),
    captionDepth: pick("captionDepth", ["none", "soft", "hard"]),
    captionStagger: bool("captionStagger"),
    captionHighlight: bool("captionHighlight"),
  };
}

export function createProject(baseDir, {
  title = "Untitled", style = "cinematic-bible", cast = [],
  aspect = "portrait", captions = "kinetic", scene = null, longform = null,
  ...captionOpts
} = {}) {
  const now = Date.now();
  const project = {
    projectId: uuid(),
    title: String(title).slice(0, 200),
    style: String(style),
    // Project-level cast: which known biblical figures appear in THIS story.
    // Applied to every scene prompt so a recurring character keeps the same
    // face and dress. Set once per project rather than per scene, because a
    // story's cast does not change halfway through.
    cast: Array.isArray(cast) ? cast.map(String) : [],
    status: STORY_STATUS.DRAFT,
    source: { audioPath: null, durationMs: 0 },
    transcript: { words: [], hash: null },
    scenes: [],
    music: { path: null, volume: 0.3 },
    // Caption look and motion. captionPreset was stored and never read until
    // these controls existed; it is now the typography/animation preset.
    ...normaliseCaptionSettings(captionOpts),
    render: { jobId: null, outputPath: null, status: null },
    error: null,
    // Video shape: "portrait" (default, existing behaviour) or "landscape".
    aspect: aspect === "landscape" ? "landscape" : "portrait",
    // Caption rendering mode for storyRender's drawtext chain.
    captions: ["none", "static", "kinetic"].includes(captions) ? captions : "kinetic",
    // Optional per-project scene policy: timing overrides (target scene length
    // / cap) and, for long-form, the visual-beat length the render is re-cut to.
    scene: scene && typeof scene === "object"
      ? {
          targetSceneSec: Number(scene.targetSceneSec) || undefined,
          maxScenes: Number(scene.maxScenes) || undefined,
          beatSec: Number(scene.beatSec) > 0 ? Number(scene.beatSec) : undefined,
        }
      : null,
    // Long-form (script -> chunked narration) metadata; null for the classic flow.
    longform: longform && typeof longform === "object" ? longform : null,
    createdAt: now,
    updatedAt: now,
  };
  writeProject(baseDir, project);
  return project;
}

/** Read a project by id. Returns null if missing or unreadable/corrupt. */
export function readProject(baseDir, projectId) {
  try {
    const file = projectPath(baseDir, projectId);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`[story] readProject failed for ${projectId}: ${err?.message || err}`);
    return null;
  }
}

/** Atomically persist a project (temp file + rename). Bumps updatedAt. */
export function writeProject(baseDir, project) {
  const dir = projectsDir(baseDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = { ...project, updatedAt: project.updatedAt || Date.now() };
  const file = projectPath(baseDir, next.projectId);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw err;
  }
  return next;
}

/** List project summaries (no scenes/words), newest updatedAt first. */
export function listProjects(baseDir) {
  const dir = projectsDir(baseDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return {
          projectId: p.projectId,
          title: p.title,
          status: p.status,
          style: p.style,
          updatedAt: p.updatedAt || 0,
        };
      } catch (err) {
        console.warn(`[story] listProjects skipped a corrupt file (${f}): ${err?.message || err}`);
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Delete a project's JSON. Returns true if it existed, false otherwise.
 * Asset cleanup (generated images/video) is the route's responsibility, since
 * those live under the output dir, not baseDir.
 * @param {string} baseDir  caller's req.ctx.dataDir
 * @param {string} projectId
 */
export function deleteProject(baseDir, projectId) {
  let file;
  try {
    file = projectPath(baseDir, projectId);
  } catch {
    return false; // invalid id
  }
  try {
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  } catch (err) {
    console.warn(`[story] deleteProject failed for ${projectId}: ${err?.message || err}`);
    return false;
  }
}
