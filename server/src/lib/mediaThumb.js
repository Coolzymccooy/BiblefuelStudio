import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { DATA_DIR, OUTPUT_DIR } from "./paths.js";
import { VIDEO_INPUT_GUARD } from "./videoInputGuard.js";

export { DATA_DIR, OUTPUT_DIR };

/** Upper bound on one thumbnail ffmpeg run; it blocks the event loop. */
export const THUMBNAIL_TIMEOUT_MS = 30_000;

let ffmpegChecked = false;
let ffmpegAvailable = false;

export function normalizePathSlashes(value) {
  return String(value || "").replace(/\\/g, "/");
}

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

export function resolveOutputAlias(value) {
  const raw = normalizePathSlashes(String(value || "").trim());
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  if (raw.startsWith("/outputs/")) return path.join(OUTPUT_DIR, raw.slice("/outputs/".length));
  if (raw.startsWith("outputs/")) return path.join(OUTPUT_DIR, raw.slice("outputs/".length));
  if (raw.startsWith("./outputs/")) return path.join(OUTPUT_DIR, raw.slice("./outputs/".length));
  return raw;
}

export function toOutputPublicPath(value) {
  const resolved = resolveOutputAlias(value);
  if (!resolved) return "";
  if (resolved.startsWith("http://") || resolved.startsWith("https://")) return resolved;
  const name = path.basename(resolved);
  if (!name) return "";
  return `/outputs/${name}`;
}

export function deriveOutputJpgPathFromVideo(value) {
  const resolved = resolveOutputAlias(value);
  if (!resolved) return "";
  if (resolved.startsWith("http://") || resolved.startsWith("https://")) return "";
  const stem = path.basename(resolved).replace(/\.[^.]+$/, "");
  if (!stem) return "";
  return `/outputs/${stem}.jpg`;
}

export function isLocalOrRemote(value) {
  const resolved = resolveOutputAlias(value);
  if (!resolved) return false;
  if (resolved.startsWith("http://") || resolved.startsWith("https://")) return true;
  return fs.existsSync(resolved);
}

function canUseFfmpeg() {
  if (ffmpegChecked) return ffmpegAvailable;
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try {
    const result = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" });
    ffmpegAvailable = result.status === 0;
  } catch {
    ffmpegAvailable = false;
  }
  ffmpegChecked = true;
  return ffmpegAvailable;
}

export function generateVideoThumbnail(inputPath, options = {}) {
  const resolved = resolveOutputAlias(inputPath);
  if (!resolved || resolved.startsWith("http://") || resolved.startsWith("https://")) return "";
  if (!fs.existsSync(resolved)) return "";

  const outputBaseName = String(options.outputBaseName || "").trim() || path.basename(resolved).replace(/\.[^.]+$/, "");
  if (!outputBaseName) return "";

  ensureDir(OUTPUT_DIR);
  const outputFile = path.join(OUTPUT_DIR, `${outputBaseName}.jpg`);
  if (fs.existsSync(outputFile)) {
    return `/outputs/${path.basename(outputFile)}`;
  }
  if (!canUseFfmpeg()) return "";

  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  // Still synchronous (its callers are), but bounded: a run that takes too
  // long is killed, and a timed-out first try is not retried.
  const spawnOpts = {
    stdio: "ignore",
    windowsHide: true,
    timeout: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : THUMBNAIL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  };
  // The input is a file a user uploaded or picked: read it only as MP4/MOV
  // or Matroska/WebM and only from disk, so a concat list or playlist named
  // .mp4 is never followed (see videoInputGuard.js).
  const firstTry = spawnSync(
    ffmpeg,
    ["-y", "-ss", "00:00:00.500", ...VIDEO_INPUT_GUARD, "-i", resolved, "-frames:v", "1", "-vf", "scale=720:-2", outputFile],
    spawnOpts,
  );
  if (firstTry.status !== 0) {
    if (firstTry.error?.code === "ETIMEDOUT") return removePartial(outputFile);
    const fallback = spawnSync(
      ffmpeg,
      ["-y", ...VIDEO_INPUT_GUARD, "-i", resolved, "-frames:v", "1", "-vf", "scale=720:-2", outputFile],
      spawnOpts,
    );
    if (fallback.status !== 0) return removePartial(outputFile);
  }

  return fs.existsSync(outputFile) ? `/outputs/${path.basename(outputFile)}` : "";
}

/** A stopped or failed run may have left a partial JPEG: don't serve it. */
function removePartial(outputFile) {
  try { fs.rmSync(outputFile, { force: true }); } catch { /* best effort */ }
  return "";
}
