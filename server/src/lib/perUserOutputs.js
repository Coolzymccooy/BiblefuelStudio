import fs from "fs";
import path from "path";

/**
 * Find a per-user output for a public /outputs/<relPath> URL.
 *
 * With multi-tenant on, renders land in DATA_DIR/users/<userId>/outputs/, not
 * the global outputs folder that express.static serves. Browsers play
 * <video src="/outputs/..."> with no auth headers, so this cannot sit behind
 * requireAuth; the link itself is the secret, as with an unlisted share link.
 *
 * A flat name is served as before (renders use UUID filenames). A nested path
 * such as ambient/<projectId>/video.mp4 is served only when one of its
 * segments is an unguessable id, so a predictable folder name never exposes
 * another account's files. Every candidate is confined to that user's
 * outputs folder, symlinks included.
 */

const MAX_SEGMENTS = 4;
const MAX_SEGMENT_LEN = 128;
const CACHE_MAX = 2000;
// A UUID, or a random token of at least 22 url-safe characters (~128 bits).
const UNGUESSABLE_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{22,}/i;

/** The path's segments, or null when it is not one this may serve. */
export function outputSegments(relPath) {
  const raw = String(relPath || "").replace(/^\/+/, "");
  if (!raw || raw.length > 512 || /[\0\:]/.test(raw)) return null;
  const segments = raw.split("/");
  if (segments.length > MAX_SEGMENTS) return null;
  for (const s of segments) {
    if (!s || s === "." || s === ".." || s.length > MAX_SEGMENT_LEN) return null;
  }
  if (segments.length > 1 && !segments.some((s) => UNGUESSABLE_RE.test(s))) return null;
  return segments;
}

function within(root, file) {
  const rel = path.relative(root, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function confinedFile(outputsRoot, segments) {
  const candidate = path.resolve(outputsRoot, ...segments);
  if (!within(outputsRoot, candidate)) return null;
  try {
    const real = fs.realpathSync(candidate);
    if (!within(fs.realpathSync(outputsRoot), real)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

export function createPerUserOutputFinder(dataDir) {
  const cache = new Map();
  return function findPerUserOutput(relPath) {
    const segments = outputSegments(relPath);
    if (!segments) return null;
    const key = segments.join("/");
    const cached = cache.get(key);
    if (cached && fs.existsSync(cached)) return cached;

    const usersRoot = path.join(dataDir, "users");
    let userIds;
    try { userIds = fs.readdirSync(usersRoot); } catch { return null; }
    for (const uid of userIds) {
      const hit = confinedFile(path.join(usersRoot, uid, "outputs"), segments);
      if (!hit) continue;
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, hit);
      return hit;
    }
    return null;
  };
}
