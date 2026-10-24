import fs from "fs";
import path from "path";
import crypto from "crypto";
import { writeJsonAtomic } from "../atomicFile.js";
import { readProject, updateProject, projectOutputDir, projectOutputUrl } from "./store.js";

/**
 * The character shelf: an approved character (look, voice, portrait) saved
 * once and pulled into later cartoons, so a recurring character keeps the
 * same face.
 *
 * The shelf is one JSON file per user (ctx.dataDir/cartoon-cast.json) and its
 * pictures live in that user's output folder (cartoon-cast/<id>.png), so
 * tenants never see each other's characters.
 *
 * Pictures are always COPIED, never linked: shelving copies the project's
 * portrait onto the shelf, and pulling copies the shelf picture into the
 * target project's own pictures/ folder, with portrait.file stored relative to
 * that folder exactly as images.js does (the film stage refuses a portrait
 * outside its project folder). Removing a shelf character therefore never
 * breaks a cartoon that already used it.
 *
 * Failures are plain Errors with a `code` the router can map: "NOT_FOUND"
 * (404) for an unknown character or cartoon, "INVALID" (400) for the rest.
 */

const SHELF_FILE = "cartoon-cast.json";
const PICTURE_DIR = "cartoon-cast";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNPLAIN_NAMES = new Set(["__proto__", "constructor", "prototype"]);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function shelfFile(ctx) {
  return path.join(ctx.dataDir, SHELF_FILE);
}

function pictureFile(ctx, id) {
  return path.join(ctx.outputDir, PICTURE_DIR, `${id}.png`);
}

/** The saved characters; a missing or damaged shelf file reads as empty. */
export function listShelf(ctx) {
  try {
    const rows = JSON.parse(fs.readFileSync(shelfFile(ctx), "utf8"));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveShelf(ctx, rows) {
  fs.mkdirSync(ctx.dataDir, { recursive: true });
  writeJsonAtomic(shelfFile(ctx), rows);
}

/** A cast member by own property only, never through the prototype chain. */
function ownMember(project, name) {
  const cast = project?.cast;
  if (!cast || typeof name !== "string" || !Object.hasOwn(cast, name)) return null;
  return cast[name];
}

/**
 * The approved portrait's file on disk, or null: it must be approved, done,
 * recorded relative to the project folder, stay inside it, and exist.
 */
function approvedPortraitFile(ctx, project, member) {
  const portrait = member?.portrait;
  if (!member?.approved || portrait?.status !== "done" || typeof portrait.file !== "string" || !portrait.file) return null;
  const base = path.resolve(projectOutputDir(ctx.outputDir, project.id));
  const full = path.resolve(base, portrait.file);
  const rel = path.relative(base, full);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  try {
    return fs.statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

/**
 * Save a cast member whose portrait is approved. Copies the picture onto the
 * shelf and returns the new Character. Throws when the cartoon or character
 * is unknown, or the portrait is not approved.
 *
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {{ id: string }} project
 * @param {string} name
 */
export function shelve(ctx, project, name) {
  const current = readProject(ctx.dataDir, project?.id) || project;
  const member = ownMember(current, name);
  if (!member) throw fail("NOT_FOUND", `No character called ${String(name)}.`);
  const source = approvedPortraitFile(ctx, current, member);
  if (!source) throw fail("INVALID", `Approve ${name}'s portrait first.`);

  const id = crypto.randomUUID();
  const target = pictureFile(ctx, id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  const character = {
    id,
    name,
    look: member.look || "",
    voice: member.voice || "",
    style: current.meta?.style ?? null,
    portraitUrl: `/outputs/${PICTURE_DIR}/${id}.png`,
    createdAt: Date.now(),
  };
  try {
    saveShelf(ctx, [...listShelf(ctx), character]);
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw err;
  }
  return character;
}

/** A trimmed cast name that is safe as an object key, or an Error. */
function plainName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || UNPLAIN_NAMES.has(name)) throw fail("INVALID", "Give the character a plain name.");
  return name;
}

/**
 * Put a shelf character into a cartoon, approved, with its picture copied into
 * the cartoon's pictures/ folder. A cast member with the same name is
 * overwritten (look, voice, portrait); otherwise one is added. Returns the
 * updated project. `styleMismatch` is true when the cartoon's style differs
 * from the one the character was made in.
 *
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {{ id: string }} project
 * @param {string} characterId
 * @param {string} [asName] defaults to the shelf character's name
 */
export function fromShelf(ctx, project, characterId, asName) {
  const character = listShelf(ctx).find((c) => c.id === characterId);
  if (!character) throw fail("NOT_FOUND", "No character on the shelf with that id.");
  const name = plainName(asName ?? character.name);
  const source = UUID_RE.test(character.id) ? pictureFile(ctx, character.id) : null;
  if (!source || !fs.existsSync(source)) throw fail("INVALID", `The saved picture for ${character.name} is missing.`);

  const updated = updateProject(ctx.dataDir, project?.id, (p) => {
    const attempt = (p.pictureCount || 0) + 1;
    const fileName = `shelf-${character.id.slice(0, 8)}-${attempt}.png`;
    const dir = path.join(projectOutputDir(ctx.outputDir, p.id), "pictures");
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(source, path.join(dir, fileName));
    const existing = ownMember(p, name) || {};
    const entry = {
      ...existing,
      name,
      look: character.look,
      voice: character.voice,
      portrait: { file: `pictures/${fileName}`, url: projectOutputUrl(p.id, "pictures", fileName), status: "done", error: null },
      approved: true,
      shelfId: character.id,
      styleMismatch: (character.style ?? null) !== (p.meta?.style ?? null),
    };
    return { ...p, pictureCount: attempt, cast: { ...p.cast, [name]: entry } };
  });
  if (!updated) throw fail("NOT_FOUND", "No cartoon found.");
  return updated;
}

/**
 * Delete a shelf character and its picture. Cartoons that already copied the
 * picture are untouched. Returns whether the character existed.
 */
export function removeFromShelf(ctx, characterId) {
  const rows = listShelf(ctx);
  const character = rows.find((c) => c.id === characterId);
  if (!character) return false;
  saveShelf(ctx, rows.filter((c) => c.id !== characterId));
  if (UUID_RE.test(character.id)) {
    try { fs.rmSync(pictureFile(ctx, character.id), { force: true }); } catch { /* best effort */ }
  }
  return true;
}
