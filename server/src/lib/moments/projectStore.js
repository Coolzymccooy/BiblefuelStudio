import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { STYLE_IDS } from "../motion/styles.js";
import { normaliseSeed } from "../kinetic/renderCaptions.js";
import {
  resolveOccasion, LENGTHS, TITLE_MAX, STATEMENT_MAX, DETAIL_MAX, MAX_STATEMENTS, DETAIL_FIELDS,
} from "./occasions.js";

/**
 * Moments persistence: one JSON file per project under <dataDir>/moments/,
 * written to a temp file and renamed so a crash never leaves half a file.
 * The same layout and id rule as lib/ambient/projectStore.js.
 */
export const HISTORY_KEEP = 20;
export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 20;
/** The folder name under the data dir that holds project files (Task 4 scans it to protect library images). */
export const PROJECTS_SUBDIR = "moments";
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const dirOf = (baseDir) => path.join(baseDir, PROJECTS_SUBDIR);
function fileOf(baseDir, id) {
  const s = String(id || "");
  return ID_RE.test(s) ? path.join(dirOf(baseDir), `${s}.json`) : null;
}

export function createProject(baseDir, { occasion }) {
  const occ = resolveOccasion(occasion);
  if (!occ) throw new Error("unknown occasion");
  const now = Date.now();
  return writeProject(baseDir, {
    projectId: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    occasion: occ.id,
    details: {},
    photos: [],
    heroIndex: 0,
    sound: { song: { ref: occ.song, windowStartSec: null }, voiceover: null },
    title: "",
    statements: [],
    style: occ.style,
    energy: occ.energy,
    lengthSec: 15,
    seed: normaliseSeed(undefined),
    plan: null,
    render: null,
    history: [],
  });
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The stored project, but only when it is an object that names itself as this file. */
export function readProject(baseDir, id) {
  const file = fileOf(baseDir, id);
  if (!file || !fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  return isPlainObject(parsed) && parsed.projectId === id ? parsed : null;
}

export function writeProject(baseDir, project) {
  const file = fileOf(baseDir, project.projectId);
  if (!file) throw new Error("invalid project id");
  fs.mkdirSync(dirOf(baseDir), { recursive: true });
  // updatedAt only ever moves forward, so "newest first" is stable even when
  // two writes land in the same millisecond.
  const next = { ...project, updatedAt: Math.max(Date.now(), Number(project.updatedAt || 0) + 1) };
  const tmp = `${file}.${process.pid}.tmp`;
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
  const dir = dirOf(baseDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readProject(baseDir, f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({
      projectId: p.projectId,
      occasion: p.occasion,
      title: p.title,
      updatedAt: p.updatedAt,
      thumb: p.photos?.[p.heroIndex]?.url || p.photos?.[0]?.url || null,
      lastFile: p.history?.at(-1)?.file || null,
    }));
}

export function deleteProject(baseDir, id) {
  const file = fileOf(baseDir, id);
  if (!file || !fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

export function withHistory(project, entry) {
  return { ...project, history: [...(project.history || []), entry].slice(-HISTORY_KEEP) };
}

export function isRendering(project) {
  return project?.render?.status === "running";
}

/** Collapses whitespace in a string the caller has already checked is a string. */
const clean = (s) => s.replace(/\s+/g, " ").trim();
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
export const SONG_REF_MAX = 200;

function checkDetails(details) {
  if (!isPlainObject(details)) return { error: "details must be an object" };
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (!DETAIL_FIELDS.includes(k)) return { error: `unknown detail "${k}"` };
    if (typeof v !== "string") return { error: `${k} must be text` };
    const t = clean(v);
    if (t.length > DETAIL_MAX) return { error: `${k} can be up to ${DETAIL_MAX} characters` };
    if (t) out[k] = t;
  }
  return { value: out };
}

function checkStatements(list) {
  if (!Array.isArray(list)) return { error: "statements must be a list" };
  if (list.length > MAX_STATEMENTS) return { error: `up to ${MAX_STATEMENTS} statements` };
  if (list.some((s) => typeof s !== "string")) return { error: "each statement must be text" };
  const out = list.map(clean);
  if (out.some((s) => !s)) return { error: "a statement can't be empty" };
  if (out.some((s) => s.length > STATEMENT_MAX)) return { error: `each statement can be up to ${STATEMENT_MAX} characters` };
  return { value: out };
}

/** A photo ref rebuilt from its known keys only, so nothing extra is stored. */
function cleanRef(ref) {
  if (!isPlainObject(ref)) return null;
  if (ref.kind === "upload" && nonEmpty(ref.path)) return { kind: "upload", path: ref.path };
  if (ref.kind === "library" && nonEmpty(ref.id)) return { kind: "library", id: ref.id };
  return null;
}

function checkPhotos(photos) {
  if (!Array.isArray(photos)) return { error: "photos must be a list" };
  if (photos.length > MAX_PHOTOS) return { error: `up to ${MAX_PHOTOS} photos` };
  const out = [];
  for (const p of photos) {
    const ref = isPlainObject(p) ? cleanRef(p.ref) : null;
    if (!ref || typeof p.url !== "string" || !Number.isFinite(p.width) || !Number.isFinite(p.height)) {
      return { error: "photos are not resolved" };
    }
    out.push({ ref, url: p.url, width: p.width, height: p.height });
  }
  return { value: out };
}

function checkSound(current, sound) {
  if (!isPlainObject(sound)) return { error: "sound must be an object" };
  const next = { ...current };
  if ("song" in sound) {
    if (sound.song === null) next.song = null;
    else {
      const raw = isPlainObject(sound.song) ? sound.song.ref : undefined;
      if (!nonEmpty(raw)) return { error: "the song needs a ref" };
      const ref = clean(raw);
      if (ref.length > SONG_REF_MAX) return { error: `the song ref can be up to ${SONG_REF_MAX} characters` };
      const w = sound.song.windowStartSec;
      if (w !== null && w !== undefined && !(Number.isFinite(w) && w >= 0)) return { error: "the song window must start at 0 or later" };
      next.song = { ref, windowStartSec: w ?? null };
    }
  }
  if ("voiceover" in sound) {
    // The voiceover is made only by POST /:id/voiceover; here it can only be removed.
    if (sound.voiceover !== null) return { error: "the voiceover can only be removed here" };
    next.voiceover = null;
  }
  return { value: next };
}

/** The project with `body`'s fields applied, or the first problem found. */
export function applyUpdate(project, body = {}) {
  const next = { ...project };
  const fail = (error) => ({ ok: false, error });
  if (!isPlainObject(body)) return fail("the update must be an object");
  if ("occasion" in body) {
    const occ = resolveOccasion(body.occasion);
    if (!occ) return fail("unknown occasion");
    next.occasion = occ.id;
  }
  if ("details" in body) {
    const r = checkDetails(body.details);
    if (r.error) return fail(r.error);
    next.details = r.value;
  }
  if ("photos" in body) {
    const r = checkPhotos(body.photos);
    if (r.error) return fail(r.error);
    next.photos = r.value;
  }
  if ("heroIndex" in body) next.heroIndex = body.heroIndex;
  if (!(Number.isInteger(next.heroIndex) && next.heroIndex >= 0 && (next.heroIndex < next.photos.length || next.heroIndex === 0))) {
    return fail("the hero photo must be one of the photos");
  }
  if ("title" in body) {
    if (typeof body.title !== "string") return fail("the title must be text");
    const t = clean(body.title);
    if (t.length > TITLE_MAX) return fail(`the title can be up to ${TITLE_MAX} characters`);
    next.title = t;
  }
  if ("statements" in body) {
    const r = checkStatements(body.statements);
    if (r.error) return fail(r.error);
    next.statements = r.value;
  }
  if ("style" in body) {
    if (!STYLE_IDS.includes(body.style)) return fail("unknown style");
    next.style = body.style;
  }
  if ("energy" in body) next.energy = Math.min(1, Math.max(0, Number(body.energy) || 0));
  if ("lengthSec" in body) {
    if (!LENGTHS.includes(body.lengthSec)) return fail("the length must be 15, 30 or 60 seconds");
    next.lengthSec = body.lengthSec;
  }
  if ("seed" in body) next.seed = normaliseSeed(body.seed);
  if ("sound" in body) {
    const r = checkSound(project.sound, body.sound);
    if (r.error) return fail(r.error);
    next.sound = r.value;
  }
  return { ok: true, project: next };
}
