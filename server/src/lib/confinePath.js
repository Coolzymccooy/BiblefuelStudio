import path from "path";

/**
 * Lexically confine a candidate path to a root directory.
 *
 * Purely string-based: `path.resolve` collapses `.`/`..` segments and
 * normalises separators, but nothing here touches the filesystem or follows
 * symlinks, so a path that merely *names* somewhere outside `rootDir` is
 * rejected before any caller ever tries to read it.
 *
 * @param {string} rootDir   directory the result must live inside
 * @param {unknown} candidate user-supplied path (absolute or relative)
 * @returns {string|null} the resolved absolute path when it is `rootDir`
 *   itself or strictly inside it; `null` otherwise
 */
export function confineToDir(rootDir, candidate) {
  // A missing root would otherwise silently resolve to the process cwd.
  if (typeof rootDir !== "string" || !rootDir.trim()) return null;
  const root = path.resolve(rootDir);
  const raw = typeof candidate === "string" ? candidate.trim() : "";
  // An empty candidate would resolve to the process cwd — never a user file.
  if (!raw) return null;
  const resolved = path.resolve(raw);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}
