import fs from "node:fs";
import path from "node:path";
import { isUrlLike } from "./inputUrl.js";
import { isInsideDir } from "./pathJail.js";
import { readLibrary } from "./library.js";
import { OUTPUT_DIR, isOwnerCtx } from "./paths.js";
import { resolveOutputAlias } from "./mediaThumb.js";
import { confineUserPath, isSharedTtsFile, UserPathError } from "./userPathScope.js";

/**
 * The path rule for render inputs: /api/render/* and queued render jobs
 * (#112). For anyone but the owner, a local input must be the caller's own
 * file (confineUserPath), a shared tts-* voice file, or a generated image made
 * for them (genvis-<userId>-*, auto-<userId>) or for a series (series_*).
 * Library refs (`library:`, `mylib:`) resolve through their own stores, a
 * saved library id through the caller's own library (whose local links are
 * confined too), and URLs through the SSRF-guarded download, which refuses
 * every scheme but http(s).
 *
 * The owner keeps today's behaviour, and so does a job with no ctx: only the
 * owner's jobs predate the ctx stamp.
 */

const OUTPUTS_ALIAS = /^\.?\/?outputs\/(.+)$/;
const MUSIC_REF = /^(library|mylib):/i;
const GENERATED_IMAGE = /\.(png|jpe?g|webp)$/i;
const SERIES_DIR = /^series_[a-z0-9]+_[a-z0-9]+$/i;
const PATH_FIELDS = ["audioPath", "musicPath", "backgroundPath", "videoPath", "generatedImage"];

/** The same folder-name rule imageGen uses for a series id. */
function safeSegment(value) {
  return String(value || "").replace(/[^a-z0-9_-]/gi, "_");
}

function realpathOrNull(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

/** Is `absPath` a flat file in OUTPUT_DIR/genImg/<dir>/ (lexically or after realpath)? Answers <dir>. */
function generatedImageDir(absPath) {
  for (const base of [path.resolve(OUTPUT_DIR), realpathOrNull(OUTPUT_DIR)]) {
    if (!base) continue;
    const parts = path.relative(path.join(base, "genImg"), absPath).split(path.sep);
    if (parts.length === 2 && parts.every((p) => p && p !== "..")) return parts[0];
  }
  return null;
}

/**
 * A picture image generation wrote to the shared global output folder for
 * this user (`genvis-<userId>-*` from the visuals generator, `auto-<userId>`
 * from auto backgrounds) or for a series (`series_*`, the campaign's
 * generatedImage).
 *
 * @param {string} absPath
 * @param {string} userId
 */
export function isSharedGeneratedImage(absPath, userId) {
  if (!GENERATED_IMAGE.test(absPath)) return false;
  const dir = generatedImageDir(absPath);
  if (!dir) return false;
  const seg = safeSegment(userId);
  if (seg && (dir === `auto-${seg}` || dir.startsWith(`genvis-${seg}-`))) return true;
  return SERIES_DIR.test(dir);
}

function scopeFor(ctx) {
  return { allowShared: (abs) => isSharedTtsFile(abs) || isSharedGeneratedImage(abs, ctx?.userId) };
}

function isUnconfined(ctx) {
  return !ctx || isOwnerCtx(ctx);
}

/** Does the value name a path rather than a saved library item id? */
function looksLikePath(value) {
  return path.isAbsolute(value) || value.includes("/") || value.includes("\\") || value.includes("\0");
}

/** Every local link a saved library item could resolve to. */
function localLinksOf(item) {
  const links = [];
  for (const file of Array.isArray(item.files) ? item.files : []) links.push(file?.link);
  links.push(item.url, item.previewUrl);
  return links.map((l) => String(l || "").trim()).filter((l) => l && !isUrlLike(l));
}

/**
 * Check one render input. Returns the value to resolve: the real path for a
 * local file, the value itself for anything resolved elsewhere. Throws a
 * UserPathError (PATH_OUTSIDE_MEDIA 403, FILE_NOT_FOUND 400) otherwise.
 *
 * @param {unknown} value
 * @param {{ userId?: string, dataDir?: string, outputDir?: string, isOwner?: boolean }|null|undefined} ctx
 */
export function scopeMediaInput(value, ctx) {
  const raw = String(value ?? "").trim();
  if (!raw || isUnconfined(ctx)) return raw;
  if (MUSIC_REF.test(raw)) return raw;
  if (isUrlLike(raw)) return raw;
  if (looksLikePath(raw)) return confineUserPath(raw, ctx, scopeFor(ctx));
  const item = ctx.dataDir ? readLibrary(ctx.dataDir).items.find((x) => String(x?.id) === raw) : null;
  if (!item) throw new UserPathError("FILE_NOT_FOUND", 400, `Not found: ${raw}`);
  for (const link of localLinksOf(item)) confineUserPath(link, ctx, scopeFor(ctx));
  return raw;
}

/**
 * Check every path field of a render job payload (scenes included). Throws a
 * UserPathError for the first one out of scope. With `ignoreMissing`, an
 * input that is merely not found (FILE_NOT_FOUND) is skipped so the job's own
 * "not found" message reports it, and the remaining fields are still checked.
 *
 * @param {Record<string, any>|null|undefined} payload
 * @param {object|null|undefined} ctx the job's ctx
 * @param {{ ignoreMissing?: boolean }} [options]
 */
export function assertPayloadPathsInScope(payload, ctx, { ignoreMissing = false } = {}) {
  if (!payload || typeof payload !== "object" || isUnconfined(ctx)) return;
  const values = PATH_FIELDS.map((field) => payload[field]);
  const scenes = Array.isArray(payload.scenes) ? payload.scenes : [];
  for (const scene of scenes) values.push(scene?.backgroundPath);
  for (const value of values) {
    if (value == null || !String(value).trim()) continue;
    try {
      scopeMediaInput(value, ctx);
    } catch (err) {
      if (ignoreMissing && err instanceof UserPathError && err.code === "FILE_NOT_FOUND") continue;
      throw err;
    }
  }
}

/**
 * The `/outputs/...` alias resolved for this ctx. The owner (or no ctx): the
 * global folder, as before. Anyone else: their own folder, or a shared voice
 * file or generated image in the global one. A value that is not an alias is
 * returned unchanged.
 *
 * @param {string} value
 * @param {object|null|undefined} ctx
 */
export function resolveOutputAliasForCtx(value, ctx) {
  const raw = String(value ?? "").trim();
  if (isUnconfined(ctx)) return resolveOutputAlias(raw);
  const match = OUTPUTS_ALIAS.exec(raw.split("\\").join("/"));
  if (!match) return raw;
  try {
    return confineUserPath(raw, ctx, scopeFor(ctx));
  } catch {
    // Not there, or not theirs: name the spot in their own folder, which
    // callers then report as not found. A ../ escape names nothing.
    const own = path.resolve(path.join(path.resolve(ctx.outputDir), match[1]));
    return isInsideDir(own, path.resolve(ctx.outputDir)) ? own : "";
  }
}
