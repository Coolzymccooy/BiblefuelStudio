import fs from "fs";
import path from "path";

export const MB = 1024 * 1024;

export function parsePositiveIntEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Free space that must remain after a write, in bytes (MIN_FREE_AFTER_UPLOAD_MB, default 1024). */
export function minFreeAfterWriteBytes() {
  return parsePositiveIntEnv("MIN_FREE_AFTER_UPLOAD_MB", 1024) * MB;
}

/**
 * Whether `incomingBytes` more can be written to `outputDir`'s disk while still
 * leaving the safety reserve free. Fails open when the disk cannot be measured.
 * `opts.statfs` / `opts.minFreeAfterBytes` exist for tests.
 */
export function hasDiskHeadroomForUpload(outputDir, incomingBytes, opts = {}) {
  const size = Number(incomingBytes || 0);
  if (!Number.isFinite(size) || size <= 0) return { ok: true, availableBytes: null };
  const minFreeAfterBytes = opts.minFreeAfterBytes ?? minFreeAfterWriteBytes();
  const statfs = opts.statfs || fs.statfsSync?.bind(fs);
  if (!statfs) return { ok: true, availableBytes: null, warning: "Disk headroom check unavailable" };
  try {
    const probeDir = fs.existsSync(outputDir) ? outputDir : path.dirname(outputDir);
    const stat = statfs(probeDir);
    const availableBytes = Number(stat.bavail ?? stat.f_bavail ?? 0) * Number(stat.bsize ?? stat.f_bsize ?? 0);
    if (availableBytes > 0 && availableBytes - size < minFreeAfterBytes) {
      return {
        ok: false,
        availableBytes,
        requiredBytes: size + minFreeAfterBytes,
        error: `Not enough disk space to finalize this upload. Free ${(availableBytes / MB).toFixed(0)} MB; need at least ${((size + minFreeAfterBytes) / MB).toFixed(0)} MB including safety reserve.`,
      };
    }
    return { ok: true, availableBytes };
  } catch {
    return { ok: true, availableBytes: null, warning: "Disk headroom check failed" };
  }
}
