import fs from "fs";
import path from "path";

/**
 * Validate a trim request WITHOUT touching ffmpeg.
 *
 * Security boundary: the resolved input must live inside the caller's own
 * output dir. We realpath both sides so symlink tricks can't escape the jail.
 *
 * @returns {{ ok: true, resolvedPath: string, startSec: number, endSec: number }
 *          | { ok: false, error: string }}
 */
export function validateTrimRequest({ inputPath, startSec, endSec, outputDir }) {
  const raw = String(inputPath || "").trim();
  if (!raw) return { ok: false, error: "inputPath is required" };

  const start = Number(startSec);
  const end = Number(endSec);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, error: "startSec and endSec must be numbers" };
  }
  if (start < 0) return { ok: false, error: "startSec must be >= 0" };
  if (end <= start) return { ok: false, error: "invalid range: endSec must be greater than startSec" };
  if (end - start < 0.1) return { ok: false, error: "selection too short (minimum 0.1s)" };

  if (!fs.existsSync(raw)) return { ok: false, error: "input file not found" };

  let resolvedPath;
  let jail;
  try {
    resolvedPath = fs.realpathSync(raw);
    jail = fs.realpathSync(outputDir);
  } catch {
    return { ok: false, error: "input file not found" };
  }

  const rel = path.relative(jail, resolvedPath);
  const inside = rel === "" ? false : !rel.startsWith("..") && !path.isAbsolute(rel);
  if (!inside) return { ok: false, error: "invalid path: outside your media folder" };

  return { ok: true, resolvedPath, startSec: start, endSec: end };
}
