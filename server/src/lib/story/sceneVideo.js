import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { resolveOwnUpload } from "../ambient/movementImage.js";

/**
 * A video clip of your own on a Story scene (a Pixabay download, say),
 * instead of a still.
 *
 * The clip is the path POST /api/media/upload-background returned: flat in
 * THIS tenant's outputs and named bg-video-<uuid>.<ext>. It goes through the
 * same own-upload check as a picture (resolveOwnUpload), so the client can
 * never name an arbitrary server file. It is then probed so a render is
 * never handed something it cannot use, and one frame is saved beside it as
 * a JPEG poster: everything that expects a picture (cards, previews,
 * thumbnails, the "every scene is done" check, a render whose clip has gone)
 * keeps working from the poster.
 *
 * Clips are not put in the image library.
 */

const VIDEO_UPLOAD_NAME = /^bg-video-[0-9a-f-]{36}\.(mp4|mov|webm|m4v)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;

export const MAX_SCENE_VIDEO_BYTES = 200 * 1024 * 1024;
export const MIN_SCENE_VIDEO_SEC = 0.3;
export const MAX_SCENE_VIDEO_SEC = 10 * 60;
export const MAX_SCENE_VIDEO_SIDE = 4096;

/**
 * The only containers a scene clip may be read as. An uploaded file's bytes
 * decide its format, not its name, and some formats (an HLS playlist, a
 * concat list) make ffmpeg open other files or URLs. Holding ffprobe and
 * ffmpeg to the MP4/MOV and Matroska/WebM demuxers rules that out.
 * `-format_whitelist` is an input option on ffmpeg 5.1 as well.
 */
export const SCENE_VIDEO_FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm";
export const SCENE_VIDEO_INPUT_GUARD = Object.freeze(["-format_whitelist", SCENE_VIDEO_FORMATS]);

const PROBE_TIMEOUT_MS = 20_000;
const POSTER_TIMEOUT_MS = 30_000;

const NOT_FOUND = "that upload was not found — try uploading it again";
const TOO_BIG = "That clip is over 200 MB. Download the HD (1080p) version instead of 4K.";
const UNREADABLE = "That clip could not be read. Try the MP4 download instead.";

/** True when an uploadPath names a video upload rather than a picture. */
export function isSceneVideoUpload(raw) {
  if (typeof raw !== "string") return false;
  const name = raw.trim().split(/[\\/]/).pop() || "";
  return VIDEO_EXT.test(name);
}

/**
 * Run a binary with an argument array (never a shell), bounded by a timeout.
 * Resolves { code, stdout }; code is null when it could not run or timed out.
 */
function run(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, args, { windowsHide: true });
    } catch {
      resolve({ code: null, stdout: "" });
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      finish(null);
    }, timeoutMs);
    if (timer.unref) timer.unref();
    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    // Drained so a chatty stderr can never fill its pipe and stall the child.
    proc.stderr?.on("data", () => {});
    proc.on("error", () => finish(null));
    proc.on("close", (code) => finish(code));
  });
}

/**
 * What ffprobe says about a clip: its first video stream's size and the
 * container's duration. null when it could not be read at all.
 *
 * @returns {Promise<{ hasVideo: boolean, width: number, height: number, durationSec: number } | null>}
 */
export async function probeSceneVideo(file) {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const { code, stdout } = await run(ffprobe, [
    "-v", "error",
    ...SCENE_VIDEO_INPUT_GUARD, "-protocol_whitelist", "file",
    "-show_entries", "stream=codec_type,width,height:format=duration",
    "-of", "json", file,
  ], PROBE_TIMEOUT_MS);
  if (code !== 0) return null;
  let info;
  try { info = JSON.parse(stdout); } catch { return null; }
  const video = (info?.streams || []).find((s) => s?.codec_type === "video");
  return {
    hasVideo: Boolean(video),
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    durationSec: Number(info?.format?.duration),
  };
}

/** Why a probed clip can't go on a scene, or null when it can. */
function shapeProblem(probe) {
  if (!probe) return UNREADABLE;
  if (!probe.hasVideo) return "That file has no video in it. Choose a video clip (MP4, MOV or WebM).";
  const d = probe.durationSec;
  if (!Number.isFinite(d) || d <= MIN_SCENE_VIDEO_SEC) return "That clip is too short to use. Choose one at least half a second long.";
  if (d > MAX_SCENE_VIDEO_SEC) return "That clip is over 10 minutes. Use a shorter clip for one scene.";
  const { width: w, height: h } = probe;
  if (!w || !h) return UNREADABLE;
  if (w > MAX_SCENE_VIDEO_SIDE || h > MAX_SCENE_VIDEO_SIDE) {
    return `That clip is ${w}×${h}, too large for a video scene. Download the HD (1080p) version instead of 4K.`;
  }
  return null;
}

/** Save one frame of the clip as a JPEG. Early in the clip, never past it. */
async function grabPoster(file, posterPath, durationSec) {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const at = Math.min(0.5, durationSec * 0.1);
  for (const seek of [at, 0]) {
    const { code } = await run(ff, [
      "-hide_banner", "-v", "error", "-y",
      "-ss", seek.toFixed(3),
      ...SCENE_VIDEO_INPUT_GUARD, "-protocol_whitelist", "file", "-i", file,
      "-frames:v", "1", "-q:v", "3", posterPath,
    ], POSTER_TIMEOUT_MS);
    if (code === 0 && fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0) return true;
  }
  try { fs.rmSync(posterPath, { force: true }); } catch { /* best effort */ }
  return false;
}

/**
 * Resolve the body of PUT /api/story/:id/scenes/:sid/image when it names a
 * video upload.
 *
 * @param {{ outputDir: string, uploadPath: unknown, maxBytes?: number }} args
 *        maxBytes exists so tests can exercise the cap without a 200 MB file.
 * @returns {Promise<{ ok: true, videoPath: string, videoUrl: string, posterPath: string,
 *                     posterUrl: string, durationSec: number, width: number, height: number }
 *                 | { ok: false, status: number, error: string }>}
 */
export async function resolveSceneVideo({ outputDir, uploadPath, maxBytes = MAX_SCENE_VIDEO_BYTES }) {
  const file = resolveOwnUpload(outputDir, uploadPath, VIDEO_UPLOAD_NAME);
  if (!file) return { ok: false, status: 400, error: NOT_FOUND };
  let size;
  try { size = fs.statSync(file).size; } catch { return { ok: false, status: 400, error: NOT_FOUND }; }
  if (size > maxBytes) return { ok: false, status: 400, error: TOO_BIG };

  const probe = await probeSceneVideo(file);
  const problem = shapeProblem(probe);
  if (problem) return { ok: false, status: 400, error: problem };

  const stem = path.basename(file, path.extname(file));
  const posterPath = path.join(path.dirname(file), `${stem}-poster.jpg`);
  if (!(await grabPoster(file, posterPath, probe.durationSec))) {
    return { ok: false, status: 400, error: UNREADABLE };
  }
  // Flat names in a tenant's outputs are served at /outputs/<name> (see
  // lib/perUserOutputs.js), the same way renders and upload thumbnails are.
  return {
    ok: true,
    videoPath: file,
    videoUrl: `/outputs/${path.basename(file)}`,
    posterPath,
    posterUrl: `/outputs/${path.basename(posterPath)}`,
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
  };
}
