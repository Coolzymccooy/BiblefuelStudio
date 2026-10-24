import path from "path";

/**
 * True when `child` sits strictly inside `parent` (the folder itself does not
 * count). Purely lexical: pass realpaths when symlinks must not escape.
 *
 * @param {string} child
 * @param {string} parent
 */
export function isInsideDir(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
