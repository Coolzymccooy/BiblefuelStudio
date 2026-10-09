import { execFileSync } from "node:child_process";

/**
 * Whether this server's ffmpeg has the `ass` filter (libass). Studio caption
 * looks need it; without it they render as their drawtext fallback. Asked
 * once per process.
 */
let cached;

export function hasLibass() {
  if (cached !== undefined) return cached;
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try {
    const out = execFileSync(ff, ["-hide_banner", "-filters"], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"],
    });
    cached = /^\s*\S+\s+ass\s+V->V/m.test(out);
  } catch {
    cached = false;
  }
  return cached;
}

/** Pin (or with undefined, forget) the answer. Tests only. */
export function _setLibassForTest(value) {
  cached = value;
}
