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

/** What a session says over its music: spoken verses, or nothing at all. */
export const WORDS = Object.freeze(["verses", "none"]);

/** A session saved before the choice existed has verses. */
export function isMusicOnly(project) {
  return project?.words === "none";
}

function projectsDir(baseDir) {
  return path.join(baseDir, "ambient");
}

/**
 * Ids are UUIDs we minted, so anything else is refused outright. Express
 * decodes %2F inside a route parameter, and without this "..%2F..%2Fx" read
 * and deleted JSON outside the tenant's ambient folder.
 */
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function projectPath(baseDir, projectId) {
  const id = String(projectId || "");
  if (!PROJECT_ID_RE.test(id)) return null;
  return path.join(projectsDir(baseDir), `${id}.json`);
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
    words: "verses",

    bed: {
      mode: "assemble",
      trackRefs: [],
      filePath: null,
      crossfadeSec: 6,
      volume: 0.85,
      order: "shuffle",
      builtPath: null,
      builtHash: null,
      builtOrder: null,
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
  if (!file) throw new Error("ambient projectStore: invalid project id");
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
    const published = Array.isArray(p.published) ? p.published : [];
    out.push({
      projectId: p.projectId,
      title: p.title,
      status: p.status,
      targetSec: p.targetSec,
      aspect: p.aspect,
      // Checked on disk, not inferred from status: a "done" session whose
      // video was cleaned up must not offer Watch or Publish.
      hasVideo: p.status === "done" && hasFile(p.render?.outputPath),
      lastPublished: published.length ? published[published.length - 1] : null,
      updatedAt: p.updatedAt || 0,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function hasFile(file) {
  try { return Boolean(file) && fs.statSync(file).isFile(); } catch { return false; }
}

/** YouTube ids are 11 characters today; allow some slack, never a URL. */
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const PRIVACY = new Set(["private", "unlisted", "public"]);
export const PUBLISHED_KEEP = 20;

/**
 * One upload of this session's video, as the page will show it. The link is
 * built here from the id, never taken from the client, because it is rendered
 * as an href. Returns null when the id isn't a YouTube id.
 */
export function publishedEntry(body, now = Date.now()) {
  const videoId = String(body?.videoId || "");
  if (!YOUTUBE_ID_RE.test(videoId)) return null;
  const privacy = String(body?.privacyStatus || "");
  const at = Date.parse(String(body?.publishAt || ""));
  return {
    videoId,
    url: `https://youtu.be/${videoId}`,
    privacyStatus: PRIVACY.has(privacy) ? privacy : "private",
    publishAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
    at: now,
  };
}

export function withPublished(project, entry) {
  const prior = Array.isArray(project.published) ? project.published : [];
  return { ...project, published: [...prior, entry].slice(-PUBLISHED_KEEP) };
}

export function deleteProject(baseDir, projectId) {
  const file = projectPath(baseDir, String(projectId || ""));
  if (!file || !fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}
