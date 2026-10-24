import fs from "node:fs";
import path from "node:path";
import { isInsideDir } from "../lib/pathJail.js";
import { fail } from "./toolResult.js";

/**
 * The path rule for tools that hand a file to a route that does not check
 * paths itself (voice cloning, audio processing and merging). An agent may
 * name a file only if it sits in the key owner's own media folder, or is a
 * voice file the TTS providers wrote to the shared output folder (`tts-*`).
 * Both sides are realpath'd so a symlink cannot lead out.
 *
 * `../lib/paths.js` reads env at import time, so it is imported on first use.
 */

const SHARED_VOICE_FILE = /^tts-[\w.-]+$/i;
const MEDIA_REF = /^(?:library|mylib):[\w.-]+$/;
const URL_LIKE = /^[a-z][a-z0-9+.-]*:\/\//i;
const OUTPUTS_ALIAS = /^\.?\/?outputs\/(.+)$/;

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

function aliasToPath(raw, outputDir) {
  const match = OUTPUTS_ALIAS.exec(raw.split("\\").join("/"));
  return match ? path.join(outputDir, match[1]) : raw;
}

function insideScope(real, outputDir, sharedDir) {
  const mine = realpathOrNull(outputDir);
  if (mine && isInsideDir(real, mine)) return true;
  const shared = realpathOrNull(sharedDir);
  return Boolean(shared && path.dirname(real) === shared && SHARED_VOICE_FILE.test(path.basename(real)));
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
  const { outputDir, sharedDir } = await scopeOf(ctx.user);
  const real = realpathOrNull(path.resolve(aliasToPath(raw, outputDir)));
  if (!real) return refuse("FILE_NOT_FOUND", `File not found: ${raw}`);
  if (!insideScope(real, outputDir, sharedDir)) {
    return refuse("PATH_OUTSIDE_MEDIA", "That file is outside your media folder. Use a path from media_list, media_import_url or another tool's output.");
  }
  return { path: real };
}
