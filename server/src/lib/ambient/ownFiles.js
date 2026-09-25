import fs from "fs";
import path from "path";

/**
 * The real path of `raw` if it is a file inside this tenant's outputs folder,
 * otherwise null.
 *
 * Every upload route writes into req.ctx.outputDir, so that folder is the
 * whole of what a tenant can legitimately name by path. Anything a client
 * names outside it would reach ffmpeg's `-i` — another tenant's audio mixed
 * into your video, or any file the server process can read. realpath on both
 * sides so `..` segments and links cannot step out after the check.
 *
 * Tenant outputs live at DATA_DIR/users/<sub>/outputs and the operator's at
 * OUTPUT_DIR; neither contains another tenant's folder, so "inside" is enough.
 *
 * @param {string} outputDir req.ctx.outputDir
 * @param {unknown} raw client-supplied path
 * @returns {string|null}
 */
export function insideOutputs(outputDir, raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  // Only absolute local paths: never a URL, never a UNC share (which on a
  // Windows host would make the server open an outbound SMB connection).
  if (!s || !outputDir || !path.isAbsolute(s) || s.startsWith("\\\\") || s.startsWith("//")) return null;
  let resolved;
  let jail;
  try {
    resolved = fs.realpathSync(s);
    jail = fs.realpathSync(outputDir);
  } catch {
    return null;
  }
  const rel = path.relative(jail, resolved);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return fs.statSync(resolved).isFile() ? resolved : null;
}
