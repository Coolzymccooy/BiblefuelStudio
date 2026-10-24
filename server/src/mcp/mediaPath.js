import fs from "node:fs";
import path from "node:path";
import { isInsideDir } from "../lib/pathJail.js";
import { fail } from "./toolResult.js";

/**
 * The path rule for tools that hand a file to a route that does not check
 * paths itself (voice cloning, audio processing and merging). An agent may
 * name a file only if it sits in the key owner's own media folder, or is a
 * voice file the TTS providers wrote to the shared output folder (`tts-*`),
 * or an image this user's images_generate calls wrote to the shared
 * genImg folder, in a genvis-<their id>-<random> series.
 *
 * Two checks, in this order. First a lexical one on the resolved string, with
 * no file system access at all: a UNC or device path would otherwise make the
 * server open a network share or device just to answer "not found". Only a
 * path that passes it is realpath'd and checked again, so a symlink or
 * junction inside the folder cannot lead out. A path outside the scope gets
 * one fixed answer whether or not anything exists there.
 *
 * `../lib/paths.js` reads env at import time, so it is imported on first use.
 */

const SHARED_VOICE_FILE = /^tts-[\w.-]+$/i;
const GENERATED_IMAGE = /^genImg\/([\w-]+)\/[\w.-]+\.(?:png|jpe?g|webp)$/i;
const MEDIA_REF = /^(?:library|mylib):[\w.-]+$/;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
const OUTPUTS_ALIAS = /^\.?\/?outputs\/(.+)$/;
const NETWORK_OR_DEVICE = /^[\\/]{2}/;
const OUTSIDE_MESSAGE =
  "That file is outside your media folder or does not exist. Use a path from media_list, media_import_url or another tool's output.";

async function defaultScope(user) {
  const paths = await import("../lib/paths.js");
  return { outputDir: paths.resolveScopeDirs(user).outputDir, sharedDir: paths.OUTPUT_DIR };
}

let scopeOf = defaultScope;

/** Test seam: replace how the media folders are found. Pass null to restore. */
export function _setScopeForTests(fn) {
  scopeOf = typeof fn === "function" ? fn : defaultScope;
}

function realpathOrNull(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

function refuse(code, message) {
  return { refusal: fail(code, message) };
}

/** The same folder, by path.relative so Windows case differences do not matter. */
function sameDir(a, b) {
  return path.relative(a, b) === "";
}

function isSharedVoiceFile(file, sharedDir) {
  return sameDir(path.dirname(file), sharedDir) && SHARED_VOICE_FILE.test(path.basename(file));
}

/** The series folder prefix images_generate gives this user's images (as routes/imagegen.js names it, lower-cased). */
function generatedSeriesPrefix(user) {
  return `genvis-${String(user?.sub || "anon")}-`.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60).toLowerCase();
}

/** True for <sharedDir>/genImg/<this user's series>/<name>.png|jpg|webp, judged on the string only. */
function isSharedGeneratedImage(file, sharedDir, user) {
  const match = GENERATED_IMAGE.exec(path.relative(sharedDir, file).split(path.sep).join("/"));
  return Boolean(match) && match[1].toLowerCase().startsWith(generatedSeriesPrefix(user));
}

function isSharedFile(file, sharedDir, user) {
  return isSharedVoiceFile(file, sharedDir) || isSharedGeneratedImage(file, sharedDir, user);
}

/** Pure string check: does this resolved path fall in the media folder or name a shared voice file or generated image? */
function lexicallyInScope(file, outputDir, sharedDir, user) {
  return isInsideDir(file, path.resolve(outputDir)) || isSharedFile(file, path.resolve(sharedDir), user);
}

/** After realpath: the same rule against the real folders. */
function realInScope(real, outputDir, sharedDir, user) {
  const mine = realpathOrNull(outputDir);
  if (mine && isInsideDir(real, mine)) return true;
  const shared = realpathOrNull(sharedDir);
  return Boolean(shared && isSharedFile(real, shared, user));
}

/** Where the raw value may point: an /outputs/ url form maps into the media folder, and a voice file or generated image also into the shared one. */
function candidatesFor(raw, outputDir, sharedDir) {
  const match = OUTPUTS_ALIAS.exec(raw.split("\\").join("/"));
  if (!match) return [path.resolve(raw)];
  const own = path.resolve(path.join(outputDir, match[1]));
  const maybeShared = SHARED_VOICE_FILE.test(path.basename(match[1])) || GENERATED_IMAGE.test(match[1]);
  return maybeShared ? [own, path.resolve(path.join(sharedDir, match[1]))] : [own];
}

/**
 * @param {{ user: object }} ctx
 * @param {unknown} value a path, an /outputs/ path, or (with allowRefs) a library:/mylib: reference
 * @param {{ allowRefs?: boolean }} [options]
 * @returns {Promise<{ path: string } | { refusal: object }>} the path to pass to the route, or a tool error to return
 */
export async function resolveMediaInput(ctx, value, { allowRefs = false } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return refuse("BAD_INPUT", "A file path is required.");
  if (allowRefs && MEDIA_REF.test(raw)) return { path: raw };
  if (URL_LIKE.test(raw)) {
    return refuse("PATH_OUTSIDE_MEDIA", "URLs are not accepted here. Import the file with media_import_url first, then use the path it returns.");
  }
  if (raw.includes("\0") || NETWORK_OR_DEVICE.test(raw)) return refuse("PATH_OUTSIDE_MEDIA", OUTSIDE_MESSAGE);
  const { outputDir, sharedDir } = await scopeOf(ctx.user);
  const inScope = candidatesFor(raw, outputDir, sharedDir).filter((file) => lexicallyInScope(file, outputDir, sharedDir, ctx.user));
  if (inScope.length === 0) return refuse("PATH_OUTSIDE_MEDIA", OUTSIDE_MESSAGE);
  for (const file of inScope) {
    const real = realpathOrNull(file);
    if (!real) continue;
    if (!realInScope(real, outputDir, sharedDir, ctx.user)) return refuse("PATH_OUTSIDE_MEDIA", OUTSIDE_MESSAGE);
    return { path: real };
  }
  return refuse("FILE_NOT_FOUND", `File not found: ${raw}`);
}

const OWN_FOLDER_ONLY =
  "That file is not in your own media folder, and this tool reads only files there (your uploads, imports and renders, see media_list).";

/**
 * The same rule as resolveMediaInput (no library refs), narrowed to the caller's
 * own media folder: for routes that read only files inside req.ctx.outputDir
 * (the lyric video song and background). A shared voice file or generated image
 * passes resolveMediaInput but would be refused there, so it is refused here.
 * The refusal never points at media_import_url: the SSRF guard refuses this
 * server's own files. The owner's media folder IS the shared one, so nothing
 * changes for the owner.
 *
 * @param {{ user: object }} ctx
 * @param {unknown} value
 * @param {{ message?: string }} [options] the tool's own BAD_INPUT wording
 * @returns {Promise<{ path: string } | { refusal: object }>}
 */
export async function resolveOwnMediaInput(ctx, value, { message = OWN_FOLDER_ONLY } = {}) {
  const checked = await resolveMediaInput(ctx, value);
  if (checked.refusal) return checked;
  const { outputDir } = await scopeOf(ctx.user);
  const mine = realpathOrNull(outputDir);
  if (mine && isInsideDir(checked.path, mine)) return checked;
  return refuse("BAD_INPUT", message);
}

/**
 * The key owner's own output folder (where their renders land) as a real absolute path, for job
 * handles whose status route names the video by its file name only (lyric_render).
 *
 * @param {object} user the key's user (`ctx.user`)
 * @returns {Promise<string>}
 */
export async function ownOutputDir(user) {
  const { outputDir } = await scopeOf(user);
  return realpathOrNull(outputDir) || path.resolve(outputDir);
}

/** The /outputs/ link of a real path already confirmed in scope, or null. */
function outputsLinkFor(real, outputDir, sharedDir, user) {
  const mine = realpathOrNull(outputDir);
  if (mine && isInsideDir(real, mine)) return `/outputs/${path.relative(mine, real).split(path.sep).join("/")}`;
  const shared = realpathOrNull(sharedDir);
  if (shared && isSharedVoiceFile(real, shared)) return `/outputs/${path.basename(real)}`;
  if (shared && isSharedGeneratedImage(real, shared, user)) return `/outputs/${path.relative(shared, real).split(path.sep).join("/")}`;
  return null;
}

/**
 * The same rule as resolveMediaInput (no library refs), answered as both the
 * real path and the file's `/outputs/...` link. Routes that confine or
 * publish by their own outputs alias (publishing, webhooks) take the link.
 *
 * @param {{ user: object }} ctx
 * @param {unknown} value
 * @returns {Promise<{ path: string, outputsPath: string } | { refusal: object }>}
 */
export async function resolveMediaOutput(ctx, value) {
  const checked = await resolveMediaInput(ctx, value);
  if (checked.refusal) return checked;
  const { outputDir, sharedDir } = await scopeOf(ctx.user);
  const outputsPath = outputsLinkFor(checked.path, outputDir, sharedDir, ctx.user);
  if (!outputsPath) return refuse("PATH_OUTSIDE_MEDIA", OUTSIDE_MESSAGE);
  return { path: checked.path, outputsPath };
}
