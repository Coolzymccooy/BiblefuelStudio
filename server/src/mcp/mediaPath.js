import fs from "node:fs";
import path from "node:path";
import { isInsideDir } from "../lib/pathJail.js";
import { fail } from "./toolResult.js";

/**
 * The path rule for tools that hand a file to a route that does not check
 * paths itself (voice cloning, audio processing and merging). An agent may
 * name a file only if it sits in the key owner's own media folder, or is a
 * voice file the TTS providers wrote to the shared output folder (`tts-*`).
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

/** Pure string check: does this resolved path fall in the media folder or name a shared voice file? */
function lexicallyInScope(file, outputDir, sharedDir) {
  return isInsideDir(file, path.resolve(outputDir)) || isSharedVoiceFile(file, path.resolve(sharedDir));
}

/** After realpath: the same rule against the real folders. */
function realInScope(real, outputDir, sharedDir) {
  const mine = realpathOrNull(outputDir);
  if (mine && isInsideDir(real, mine)) return true;
  const shared = realpathOrNull(sharedDir);
  return Boolean(shared && isSharedVoiceFile(real, shared));
}

/** Where the raw value may point: an /outputs/ url form maps into the media folder, and a voice file also into the shared one. */
function candidatesFor(raw, outputDir, sharedDir) {
  const match = OUTPUTS_ALIAS.exec(raw.split("\\").join("/"));
  if (!match) return [path.resolve(raw)];
  const own = path.resolve(path.join(outputDir, match[1]));
  return SHARED_VOICE_FILE.test(path.basename(match[1])) ? [own, path.resolve(path.join(sharedDir, match[1]))] : [own];
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
  const inScope = candidatesFor(raw, outputDir, sharedDir).filter((file) => lexicallyInScope(file, outputDir, sharedDir));
  if (inScope.length === 0) return refuse("PATH_OUTSIDE_MEDIA", OUTSIDE_MESSAGE);
  for (const file of inScope) {
    const real = realpathOrNull(file);
    if (!real) continue;
    if (!realInScope(real, outputDir, sharedDir)) return refuse("PATH_OUTSIDE_MEDIA", OUTSIDE_MESSAGE);
    return { path: real };
  }
  return refuse("FILE_NOT_FOUND", `File not found: ${raw}`);
}

/** The /outputs/ link of a real path already confirmed in scope, or null. */
function outputsLinkFor(real, outputDir, sharedDir) {
  const mine = realpathOrNull(outputDir);
  if (mine && isInsideDir(real, mine)) return `/outputs/${path.relative(mine, real).split(path.sep).join("/")}`;
  const shared = realpathOrNull(sharedDir);
  if (shared && isSharedVoiceFile(real, shared)) return `/outputs/${path.basename(real)}`;
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
  const outputsPath = outputsLinkFor(checked.path, outputDir, sharedDir);
  if (!outputsPath) return refuse("PATH_OUTSIDE_MEDIA", OUTSIDE_MESSAGE);
  return { path: checked.path, outputsPath };
}
