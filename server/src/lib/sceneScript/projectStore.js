import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Scene-script projects: one JSON file per project in the user's data
 * folder, written atomically (temp file + rename). Project ids are UUIDs so
 * the project's output folder (/outputs/scene-scripts/<id>/...) is
 * unguessable, which per-user output serving requires.
 */

const DIR = "scene-scripts";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isProjectId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

function projectFile(baseDir, id) {
  if (!isProjectId(id)) throw new Error("invalid scene-script id");
  return path.join(baseDir, DIR, `${id}.json`);
}

/** Where a project's voice, render and scratch files live. */
export function projectOutputDir(outputDir, id) {
  if (!isProjectId(id)) throw new Error("invalid scene-script id");
  return path.join(outputDir, DIR, id);
}

/** The public URL for a file inside a project's output folder. */
export function projectOutputUrl(id, ...parts) {
  return `/outputs/${DIR}/${id}/${parts.map(encodeURIComponent).join("/")}`;
}

export function readProject(baseDir, id) {
  try {
    const file = projectFile(baseDir, id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`[scene-script] read ${id} failed: ${err?.message || err}`);
    return null;
  }
}

export function writeProject(baseDir, project) {
  const file = projectFile(baseDir, project.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...project, updatedAt: Date.now() };
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
  return next;
}

/**
 * Read, change and write in one synchronous step, so two workers in this
 * process never lose each other's edits. fn returns the new project, or null
 * to leave it unchanged.
 */
export function updateProject(baseDir, id, fn) {
  const current = readProject(baseDir, id);
  if (!current) return null;
  const next = fn(current);
  if (!next) return null;
  return writeProject(baseDir, next);
}

export function createProject(baseDir, fields) {
  const now = Date.now();
  return writeProject(baseDir, { ...fields, id: crypto.randomUUID(), createdAt: now });
}

export function listProjects(baseDir) {
  const dir = path.join(baseDir, DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return { id: p.id, title: p.meta?.title || "Untitled", updatedAt: p.updatedAt || 0, renderStatus: p.render?.status || "idle" };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteProject(baseDir, outputDir, id) {
  const file = projectFile(baseDir, id);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  fs.rmSync(projectOutputDir(outputDir, id), { recursive: true, force: true });
  return true;
}
