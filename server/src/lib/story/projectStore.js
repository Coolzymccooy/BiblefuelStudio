import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

/** Project lifecycle states. */
export const STORY_STATUS = {
  DRAFT: "draft",
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
  return path.join(projectsDir(baseDir), `${safe}.json`);
}

/**
 * Create + persist a fresh draft project.
 * @param {string} baseDir  the caller's req.ctx.dataDir
 * @param {{title?:string, style?:string}} opts
 */
export function createProject(baseDir, { title = "Untitled", style = "cinematic-bible" } = {}) {
  const now = Date.now();
  const project = {
    projectId: uuid(),
    title: String(title).slice(0, 200),
    style: String(style),
    status: STORY_STATUS.DRAFT,
    source: { audioPath: null, durationMs: 0 },
    transcript: { words: [], hash: null },
    scenes: [],
    music: { path: null, volume: 0.3 },
    captionPreset: "default",
    render: { jobId: null, outputPath: null, status: null },
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  writeProject(baseDir, project);
  return project;
}

/** Read a project by id. Returns null if missing or unreadable/corrupt. */
export function readProject(baseDir, projectId) {
  const file = projectPath(baseDir, projectId);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Atomically persist a project (temp file + rename). Bumps updatedAt. */
export function writeProject(baseDir, project) {
  const dir = projectsDir(baseDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = { ...project, updatedAt: project.updatedAt || Date.now() };
  const file = projectPath(baseDir, next.projectId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
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
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
