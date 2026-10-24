import fs from "fs";

/**
 * How full the disk holding `dir` is. `low` is true when free space is under
 * DISK_ALARM_MIN_FREE_GB (default 2) or DISK_ALARM_MIN_FREE_PERCENT (default
 * 10) of the disk, whichever is larger: renders need room for their parts.
 * Null when the platform cannot say.
 */
export function diskStatus(dir, { env = process.env, statfs = fs.statfsSync } = {}) {
  let s;
  try {
    s = statfs(dir);
  } catch {
    return null;
  }
  const totalBytes = Number(s.blocks) * Number(s.bsize);
  const freeBytes = Number(s.bavail) * Number(s.bsize);
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  const minGb = Number(env.DISK_ALARM_MIN_FREE_GB);
  const minPercent = Number(env.DISK_ALARM_MIN_FREE_PERCENT);
  const floorBytes = Math.max(
    (Number.isFinite(minGb) && minGb >= 0 ? minGb : 2) * 1024 ** 3,
    ((Number.isFinite(minPercent) && minPercent >= 0 ? minPercent : 10) / 100) * totalBytes,
  );
  const gb = (b) => Math.round((b / 1024 ** 3) * 10) / 10;
  return {
    freeGb: gb(freeBytes),
    totalGb: gb(totalBytes),
    freePercent: Math.round((freeBytes / totalBytes) * 1000) / 10,
    low: freeBytes < floorBytes,
  };
}
