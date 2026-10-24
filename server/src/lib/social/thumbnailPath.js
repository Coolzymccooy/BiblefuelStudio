import path from "path";
import { confineToDir } from "../confinePath.js";
import { isSharedGeneratedImageDir } from "../mediaInputScope.js";

const GENIMG_ALIAS = "/outputs/genImg/";
const OUTPUT_ALIAS_PREFIXES = ["/outputs/", "outputs/", "./outputs/", "server/outputs/"];
const OUTSIDE_ERROR = "thumbnailPath must point inside your outputs folder";

/**
 * Strip the `/outputs/` URL alias (in any of its spellings) from a client
 * value, or return null when it is not an alias at all.
 */
function stripOutputsAlias(value) {
  const normalized = String(value || "").trim().replace(/\\/g, "/");
  for (const prefix of OUTPUT_ALIAS_PREFIXES) {
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  }
  return null;
}

/**
 * Resolve a client-supplied thumbnail reference to a local file path that is
 * guaranteed to sit inside a directory the caller is allowed to read.
 *
 * Two roots exist under multitenancy:
 *   - `ctxOutputDir`: the caller's own outputs (long-form/Story renders,
 *     uploaded thumbnails, Story scene images under genImg/). Any
 *     `/outputs/<rel>` alias or bare path resolves here and must stay inside it.
 *   - `globalOutputDir/genImg`: pictures image generation wrote to the GLOBAL
 *     outputs dir. The owner may use any of them. Anyone else only their own
 *     (`genvis-<userId>-*`, `auto-<userId>`) and series pictures, the same
 *     rule as render inputs (#112); any other `/outputs/genImg/` value is
 *     their own genImg folder. Either way the result stays inside that genImg.
 *
 * Pure: no filesystem access, so it is safe to call before existence checks.
 *
 * @param {unknown} alias   the client value (`/outputs/...`, or an absolute path)
 * @param {string} ctxOutputDir   the caller's per-user outputs directory
 * @param {string} globalOutputDir the process-wide OUTPUT_DIR
 * @param {{ userId?: string, isOwner?: boolean }} [caller] who asks; none means a tenant with no shared pictures
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
export function resolveThumbnail(alias, ctxOutputDir, globalOutputDir, { userId = "", isOwner = false } = {}) {
  const raw = String(alias || "").trim();
  if (!raw) return { ok: false, error: "thumbnailPath is required" };
  const normalized = raw.replace(/\\/g, "/");

  if (normalized.startsWith(GENIMG_ALIAS)) {
    const rest = normalized.slice(GENIMG_ALIAS.length);
    const dir = rest.split("/")[0];
    const shared = isOwner || isSharedGeneratedImageDir(dir, userId);
    const genImgRoot = path.join(shared ? globalOutputDir : ctxOutputDir, "genImg");
    const resolved = confineToDir(genImgRoot, path.join(genImgRoot, rest));
    return resolved ? { ok: true, path: resolved } : { ok: false, error: OUTSIDE_ERROR };
  }

  const rel = stripOutputsAlias(normalized);
  // A bare relative name ("thumb.png") is taken relative to the caller's
  // outputs, matching how the old basename lookup behaved — minus the I/O.
  const candidate = rel !== null ? path.join(ctxOutputDir, rel) : (path.isAbsolute(raw) ? raw : path.join(ctxOutputDir, raw));
  const resolved = confineToDir(ctxOutputDir, candidate);
  return resolved ? { ok: true, path: resolved } : { ok: false, error: OUTSIDE_ERROR };
}
