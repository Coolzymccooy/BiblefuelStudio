import fs from "fs";
import path from "path";
import crypto from "crypto";
import { normaliseCaptionSettings } from "../story/projectStore.js";
import { deriveMovements } from "./movements.js";

/**
 * Ambient project persistence — one JSON file per project under
 * `<dataDir>/ambient/`, mirroring `lib/story/projectStore.js`.
 *
 * Ambient projects are music-first: the bed is the product and scripture drops
 * onto it at intervals. That inverts Story's model, where narration is the
 * spine and music is a bed underneath, so this gets its own store rather than
 * widening Story's shape with a dozen fields Story never reads.
 *
 * Writes are temp-file + rename in the same directory, so a crash mid-write
 * cannot leave a truncated project behind.
 */

export { normaliseCaptionSettings };

/** Fifteen minutes, the spec's default cadence for scripture drops. */
export const DEFAULT_DROP_INTERVAL_SEC = 900;

function projectsDir(baseDir) {
  return path.join(baseDir, "ambient");
}

function projectPath(baseDir, projectId) {
  return path.join(projectsDir(baseDir), `${projectId}.json`);
}

/**
 * sidechaincompress takes a LINEAR threshold, not dB — 0.02 is roughly -34 dBFS.
 * Writing 34 here would mean "never duck", silently, with no error.
 */
export const DEFAULT_DUCK = Object.freeze({
  threshold: 0.02,
  ratio: 8,
  attackMs: 20,
  releaseMs: 800,
});

export function createProject(baseDir, { title, theme, targetSec, aspect, translation } = {}) {
  const projectId = crypto.randomUUID();
  const now = Date.now();
  const project = {
    projectId,
    title: String(title || "Untitled ambient session").slice(0, 200),
    theme: String(theme || "").slice(0, 500),
    translation: String(translation || "kjv").toLowerCase(),
    targetSec: Number(targetSec) > 0 ? Math.round(Number(targetSec)) : 7200,
    aspect: aspect === "portrait" || aspect === "square" ? aspect : "landscape",
    status: "draft",

    bed: {
      mode: "assemble",
      trackRefs: [],
      filePath: null,
      crossfadeSec: 6,
      volume: 0.85,
      builtPath: null,
      builtHash: null,
      allowUncleared: false,
    },

    drops: [],
    movements: [],

    motion: "still",
    // `captions` is the render MODE and is deliberately not part of
    // normaliseCaptionSettings (Story sets it alongside the spread too), so it
    // has to be written here or ambientRender would read `undefined`.
    //
    // On, and held for each verse's whole section: shown only while spoken, a
    // ten-minute session carried ten seconds of scripture and read as a bare
    // image with music.
    captions: "static",
    captionSpan: "section",
    captionPosition: "lower",
    ...normaliseCaptionSettings({}),

    duck: { ...DEFAULT_DUCK },
    render: { jobId: null, outputPath: null, status: "idle", percent: 0, phase: "" },
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  // Derived now, not left as []: with no drops, deriveMovements still returns
  // the one full-length movement the render needs, and an empty list read as
  // "0 movements" and disabled Generate images on a brand-new session.
  return writeProject(baseDir, { ...project, movements: deriveMovements(project) });
}

export function readProject(baseDir, projectId) {
  const file = projectPath(baseDir, String(projectId || ""));
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // A corrupt project reads as missing rather than throwing: the caller
    // answers 404, which is recoverable, instead of 500ing the whole list.
    return null;
  }
}

export function writeProject(baseDir, project) {
  const dir = projectsDir(baseDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = { ...project, updatedAt: Date.now() };
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

export function listProjects(baseDir) {
  const dir = projectsDir(baseDir);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const p = readProject(baseDir, name.slice(0, -5));
    if (!p) continue;
    out.push({
      projectId: p.projectId,
      title: p.title,
      status: p.status,
      targetSec: p.targetSec,
      updatedAt: p.updatedAt || 0,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteProject(baseDir, projectId) {
  const file = projectPath(baseDir, String(projectId || ""));
  if (!file || !fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
