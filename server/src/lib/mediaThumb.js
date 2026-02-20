import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

export const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || "./outputs");
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

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
  const firstTry = spawnSync(
    ffmpeg,
    ["-y", "-ss", "00:00:00.500", "-i", resolved, "-frames:v", "1", "-vf", "scale=720:-2", outputFile],
    { stdio: "ignore" },
  );
  if (firstTry.status !== 0) {
    const fallback = spawnSync(
      ffmpeg,
      ["-y", "-i", resolved, "-frames:v", "1", "-vf", "scale=720:-2", outputFile],
      { stdio: "ignore" },
    );
    if (fallback.status !== 0) return "";
  }

  return fs.existsSync(outputFile) ? `/outputs/${path.basename(outputFile)}` : "";
}
