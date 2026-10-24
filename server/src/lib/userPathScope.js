import fs from "node:fs";
import path from "node:path";
import { isUrlLike } from "./inputUrl.js";
import { isInsideDir } from "./pathJail.js";
import { OUTPUT_DIR } from "./paths.js";

/**
 * The one rule for a file path a signed-in user sends to a route that reads
 * it (#112). The file must sit inside the caller's own media folder
 * (`ctx.outputDir`), or be a shared file the route opts into with
 * `allowShared`. The owner's media folder is the global OUTPUT_DIR (paths.js),
 * so the owner keeps reading everything there.
 *
 * Two checks, in this order. First a lexical one on the string, with no file
 * system access at all: a UNC or device path would otherwise make the server
 * open a network share or device just to answer "not found", and a URL is
 * never a path. Only a value that passes is realpath'd and checked again, so a
 * symlink or junction inside the folder cannot lead out. A path outside the
 * scope gets one fixed answer whether or not anything exists there.
 */

const OUTPUTS_ALIAS = /^\.?\/?outputs\/(.+)$/;
const NETWORK_OR_DEVICE = /^[\\/]{2}/;
const SHARED_TTS_FILE = /^tts-[\w.-]+$/i;
const OUTSIDE_MESSAGE = "That file is outside your media folder. Use a file you uploaded or created here.";

export class UserPathError extends Error {
  /**
   * @param {string} code
   * @param {number} status
   * @param {string} message
   */
  constructor(code, status, message) {
    super(message);
    this.name = "UserPathError";
    this.code = code;
    this.status = status;
  }
}

const outside = () => new UserPathError("PATH_OUTSIDE_MEDIA", 403, OUTSIDE_MESSAGE);

function realpathOrNull(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

/** The same folder, by path.relative so Windows case differences do not matter. */
function sameDir(a, b) {
  return path.relative(a, b) === "";
}

/**
 * A voice file a TTS provider wrote to the shared global output folder
 * (`tts-*`, flat). Providers write there for every tenant, under uuid names.
 * Pass as `allowShared` where a route takes generated voice audio.
 *
 * @param {string} absPath
 */
export function isSharedTtsFile(absPath) {
  if (!SHARED_TTS_FILE.test(path.basename(absPath))) return false;
  const dir = path.dirname(absPath);
  if (sameDir(dir, OUTPUT_DIR)) return true;
  const real = realpathOrNull(OUTPUT_DIR);
  return Boolean(real && sameDir(dir, real));
}

const SHARED_STOCK_FILE = /^(?:(?:pexels|pixabay)-\d+\.mp4|thumb-(?:pexels|pixabay)-\d+\.jpg)$/i;

/**
 * A stock clip (or its thumbnail) the Pexels/Pixabay download routes saved
 * flat in the global output folder: `pexels-<id>.mp4`, `pixabay-<id>.mp4`,
 * `thumb-<provider>-<id>.jpg`. The downloads write there for every account
 * and the library item links that global path; the content is public stock
 * named by its provider id, so it is shared like a tts-* file.
 *
 * @param {string} absPath
 */
export function isSharedStockFile(absPath) {
  if (!SHARED_STOCK_FILE.test(path.basename(absPath))) return false;
  const dir = path.dirname(absPath);
  if (sameDir(dir, OUTPUT_DIR)) return true;
  const real = realpathOrNull(OUTPUT_DIR);
  return Boolean(real && sameDir(dir, real));
}

/** Where the raw value may point: an /outputs/ alias maps into the caller's folder and, for a shared file, the global one. */
function candidatesFor(raw, outputDir, allowShared) {
  const match = OUTPUTS_ALIAS.exec(raw.split("\\").join("/"));
  if (!match) return [path.resolve(raw)];
  const own = path.resolve(path.join(outputDir, match[1]));
  if (!allowShared) return [own];
  const shared = path.resolve(path.join(OUTPUT_DIR, match[1]));
  return shared === own ? [own] : [own, shared];
}

/**
 * @param {unknown} raw the path from the request: absolute, or an `/outputs/...` alias
 * @param {{ outputDir?: string }|undefined} ctx the request scope (req.ctx)
 * @param {{ allowShared?: (absPath: string) => boolean }} [options]
 * @returns {string} the real absolute path of the file
 * @throws {UserPathError} PATH_REQUIRED (400), PATH_OUTSIDE_MEDIA (403), FILE_NOT_FOUND (400), SCOPE_UNAVAILABLE (500)
 */
export function confineUserPath(raw, ctx, { allowShared } = {}) {
  const value = String(raw ?? "").trim();
  if (!value) throw new UserPathError("PATH_REQUIRED", 400, "A file path is required.");
  if (value.includes("\0") || NETWORK_OR_DEVICE.test(value) || isUrlLike(value)) throw outside();
  const outputDir = typeof ctx?.outputDir === "string" && ctx.outputDir.trim() ? path.resolve(ctx.outputDir) : null;
  if (!outputDir) throw new UserPathError("SCOPE_UNAVAILABLE", 500, "User scope unavailable.");

  const shared = typeof allowShared === "function" ? allowShared : null;
  const lexicallyInScope = (file) => isInsideDir(file, outputDir) || Boolean(shared && shared(file));
  const inScope = candidatesFor(value, outputDir, shared).filter(lexicallyInScope);
  if (inScope.length === 0) throw outside();

  const realOwn = realpathOrNull(outputDir);
  const realInScope = (real) => Boolean(realOwn && isInsideDir(real, realOwn)) || Boolean(shared && shared(real));
  for (const file of inScope) {
    const real = realpathOrNull(file);
    if (!real) continue;
    if (!realInScope(real)) throw outside();
    return real;
  }
  throw new UserPathError("FILE_NOT_FOUND", 400, "File not found.");
}

/**
 * Answer a UserPathError as `{ ok:false, error:<code>, message }` with its
 * status. Returns false (and writes nothing) for any other error.
 *
 * @param {import("express").Response} res
 * @param {unknown} err
 */
export function sendUserPathError(res, err) {
  if (!(err instanceof UserPathError)) return false;
  res.status(err.status).json({ ok: false, error: err.code, message: err.message });
  return true;
}
