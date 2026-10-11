import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { resolveOwnUpload } from "../ambient/movementImage.js";
import { VIDEO_INPUT_FORMATS, VIDEO_INPUT_GUARD } from "../videoInputGuard.js";

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

// The upload itself, or the converted copy made beside it (see
// normaliseSceneVideo), which is what a scene stores when its clip needed it.
const VIDEO_UPLOAD_NAME = /^bg-video-[0-9a-f-]{36}(?:\.(mp4|mov|webm|m4v)|-scene\.mp4)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;

export const MAX_SCENE_VIDEO_BYTES = 200 * 1024 * 1024;
export const MIN_SCENE_VIDEO_SEC = 0.3;
export const MAX_SCENE_VIDEO_SEC = 10 * 60;
export const MAX_SCENE_VIDEO_SIDE = 4096;

/**
 * What a clip may be at render time without being converted first. Every
 * clip scene is its own ffmpeg input and they all decode at once, so a 4K or
 * 120 fps clip on each scene multiplies the render's memory. Anything bigger,
 * faster or in another codec is converted once, when it goes on the scene.
 */
export const SCENE_VIDEO_MAX_LONG_SIDE = 1920;
export const SCENE_VIDEO_MAX_FPS = 60;
/** A scene loops its clip, so more than a minute of it is never needed. */
export const SCENE_VIDEO_MAX_CONVERTED_SEC = 60;

/**
 * The only containers a scene clip may be read as (MP4/MOV, Matroska/WebM),
 * and only from a local file, so a playlist or concat list dressed up as a
 * clip is never followed. Shared with the upload thumbnail (see
 * lib/videoInputGuard.js).
 */
export const SCENE_VIDEO_FORMATS = VIDEO_INPUT_FORMATS;
export const SCENE_VIDEO_INPUT_GUARD = VIDEO_INPUT_GUARD;

const PROBE_TIMEOUT_MS = 20_000;
const POSTER_TIMEOUT_MS = 30_000;
// Under Cloudflare's 100 s proxy limit, so a slow conversion fails with our
// message instead of a 524 while the server is still working.
const TRANSCODE_TIMEOUT_MS = 90_000;

const NOT_FOUND = "that upload was not found — try uploading it again";
export const SCENE_VIDEO_TOO_BIG = "That clip is over 200 MB. Use a shorter clip or the HD (1080p) version.";
const UNREADABLE = "That clip could not be read. Try the MP4 download instead.";
const TOO_SLOW = "That clip took too long to prepare. Use a shorter clip or the HD (1080p) version.";

/** True when an uploadPath names a video upload rather than a picture. */
export function isSceneVideoUpload(raw) {
  if (typeof raw !== "string") return false;
  const name = raw.trim().split(/[\\/]/).pop() || "";
  return VIDEO_EXT.test(name);
}

/**
 * Run a binary with an argument array (never a shell), bounded by a timeout.
 * Resolves { code, stdout, timedOut }; code is null when it could not run or
 * timed out.
 */
function run(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, args, { windowsHide: true });
    } catch {
      resolve({ code: null, stdout: "", timedOut: false });
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (code, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A killed child can still be holding its output file open; wait for it
      // to go so the caller can remove what it left.
      if (timedOut) {
        const backstop = setTimeout(() => resolve({ code, stdout, timedOut }), 5_000);
        proc.once("close", () => {
          clearTimeout(backstop);
          resolve({ code, stdout, timedOut });
        });
        return;
      }
      resolve({ code, stdout, timedOut });
    };
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      finish(null, true);
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
 * A rate like "30000/1001" as a number; NaN when ffprobe doesn't know it
 * ("0/0").
 */
function parseRate(raw) {
  const [n, d = "1"] = String(raw || "").split("/");
  const v = Number(n) / Number(d);
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

/**
 * The clip's picture stream: the first video stream that isn't cover art. A
 * song's embedded artwork is reported as a one-frame "video" stream marked
 * attached_pic; on its own it is no video. null when there is none.
 */
export function pickVideoStream(streams) {
  if (!Array.isArray(streams)) return null;
  return streams.find((s) => s?.codec_type === "video" && Number(s?.disposition?.attached_pic) !== 1) || null;
}

/** "01:02:03.5" (a Matroska DURATION tag) in seconds, or NaN. */
function parseClock(raw) {
  const m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(String(raw || "").trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
}

/**
 * How long a clip is. The container says, usually; a WebM written as it was
 * recorded (a browser's MediaRecorder) often doesn't, so fall back to the
 * video stream's duration, then to its Matroska DURATION tag. NaN when
 * nothing says (counting frames would mean decoding the whole clip).
 */
export function clipDurationSec(format, stream) {
  for (const v of [Number(format?.duration), Number(stream?.duration), parseClock(stream?.tags?.DURATION)]) {
    if (Number.isFinite(v) && v > 0) return v;
  }
  return NaN;
}

/**
 * What ffprobe says about a clip: its first video stream's size, codec,
 * frame rate and index, and the container's duration. null when it could
 * not be read at all.
 *
 * @returns {Promise<{ hasVideo: boolean, width: number, height: number, durationSec: number,
 *                     codec: string, fps: number, streamIndex: number } | null>}
 */
export async function probeSceneVideo(file) {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const { code, stdout } = await run(ffprobe, [
    "-v", "error",
    ...SCENE_VIDEO_INPUT_GUARD,
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration"
      + ":stream_disposition=attached_pic:stream_tags=DURATION:format=duration",
    "-of", "json", file,
  ], PROBE_TIMEOUT_MS);
  if (code !== 0) return null;
  let info;
  try { info = JSON.parse(stdout); } catch { return null; }
  const video = pickVideoStream(info?.streams);
  const avg = parseRate(video?.avg_frame_rate);
  return {
    hasVideo: Boolean(video),
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    durationSec: clipDurationSec(info?.format, video),
    codec: String(video?.codec_name || ""),
    fps: Number.isFinite(avg) ? avg : parseRate(video?.r_frame_rate),
    streamIndex: Number.isInteger(video?.index) ? video.index : 0,
  };
}

/**
 * Does this clip need converting before a render can take it cheaply? Too
 * big (long side over 1920), not H.264, or over 60 fps. An unknown frame rate
 * is left alone: the render's own fps=30 handles it.
 */
export function needsNormalising(probe) {
  if (Math.max(probe.width, probe.height) > SCENE_VIDEO_MAX_LONG_SIDE) return true;
  if (probe.codec !== "h264") return true;
  return Number.isFinite(probe.fps) && probe.fps > SCENE_VIDEO_MAX_FPS;
}

/**
 * Convert a clip once, beside the upload, to what every render can decode
 * cheaply: long side at most 1920 (shape kept, even sides), 30 fps, H.264
 * yuv420p, no sound, at most a minute. Written under a temporary name and
 * renamed, so a stopped conversion never leaves a clip that looks finished.
 *
 * @returns {Promise<{ ok: true, file: string } | { ok: false, error: string }>}
 */
async function normaliseSceneVideo(file, probe, timeoutMs) {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const stem = path.basename(file, path.extname(file)).replace(/-scene$/i, "");
  const out = path.join(path.dirname(file), `${stem}-scene.mp4`);
  const part = path.join(path.dirname(file), `${stem}-scene.${randomUUID()}.part.mp4`);
  const L = SCENE_VIDEO_MAX_LONG_SIDE;
  const scale = `scale='if(gt(iw,ih),min(${L},trunc(iw/2)*2),-2)':'if(gt(iw,ih),-2,min(${L},trunc(ih/2)*2))'`;
  const { code, timedOut } = await run(ff, [
    "-hide_banner", "-v", "error", "-y",
    "-threads", "2",
    ...SCENE_VIDEO_INPUT_GUARD, "-i", file,
    "-map", `0:${probe.streamIndex}`,
    "-t", String(SCENE_VIDEO_MAX_CONVERTED_SEC),
    "-vf", `${scale},fps=30`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-threads", "2",
    "-an", "-movflags", "+faststart",
    "-f", "mp4", part,
  ], timeoutMs);
  const ok = code === 0 && fs.existsSync(part) && fs.statSync(part).size > 0;
  if (!ok) {
    try { fs.rmSync(part, { force: true }); } catch { /* best effort */ }
    return { ok: false, error: timedOut ? TOO_SLOW : UNREADABLE };
  }
  try {
    fs.renameSync(part, out);
  } catch {
    // The same clip went on another scene at the same moment and its copy is
    // already in place (and may be open): use that one.
    try { fs.rmSync(part, { force: true }); } catch { /* best effort */ }
    if (!fs.existsSync(out)) return { ok: false, error: UNREADABLE };
  }
  return { ok: true, file: out };
}

/** Why a probed clip can't go on a scene, or null when it can. */
function shapeProblem(probe) {
  if (!probe) return UNREADABLE;
  if (!probe.hasVideo) return "That file has no video in it. Choose a video clip (MP4, MOV or WebM).";
  const d = probe.durationSec;
  if (!Number.isFinite(d)) return "Couldn't read that clip's length — re-save it as MP4.";
  if (d <= MIN_SCENE_VIDEO_SEC) return "That clip is too short to use. Choose one at least half a second long.";
  if (d > MAX_SCENE_VIDEO_SEC) return "That clip is over 10 minutes. Use a shorter clip for one scene.";
  const { width: w, height: h } = probe;
  if (!w || !h) return UNREADABLE;
  if (w > MAX_SCENE_VIDEO_SIDE || h > MAX_SCENE_VIDEO_SIDE) {
    return `That clip is ${w}×${h}, too large for a video scene. Use a 4K or smaller version.`;
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
      ...SCENE_VIDEO_INPUT_GUARD, "-i", file,
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
 * A clip that is too big, too fast or not H.264 is converted once (see
 * normaliseSceneVideo) and the scene gets the converted copy; one that is
 * already fine is used as it is.
 *
 * @param {{ outputDir: string, uploadPath: unknown, maxBytes?: number, transcodeTimeoutMs?: number }} args
 *        maxBytes and transcodeTimeoutMs exist so tests can exercise the cap
 *        and the time limit without a 200 MB file or a slow conversion.
 * @returns {Promise<{ ok: true, videoPath: string, videoUrl: string, posterPath: string,
 *                     posterUrl: string, durationSec: number, width: number, height: number }
 *                 | { ok: false, status: number, error: string }>}
 */
export async function resolveSceneVideo({
  outputDir, uploadPath, maxBytes = MAX_SCENE_VIDEO_BYTES, transcodeTimeoutMs = TRANSCODE_TIMEOUT_MS,
}) {
  const upload = resolveOwnUpload(outputDir, uploadPath, VIDEO_UPLOAD_NAME);
  if (!upload) return { ok: false, status: 400, error: NOT_FOUND };
  let size;
  try { size = fs.statSync(upload).size; } catch { return { ok: false, status: 400, error: NOT_FOUND }; }
  if (size > maxBytes) return { ok: false, status: 400, error: SCENE_VIDEO_TOO_BIG };

  const probe = await probeSceneVideo(upload);
  const problem = shapeProblem(probe);
  if (problem) return { ok: false, status: 400, error: problem };

  let file = upload;
  if (needsNormalising(probe)) {
    const converted = await normaliseSceneVideo(upload, probe, transcodeTimeoutMs);
    if (!converted.ok) return { ok: false, status: 400, error: converted.error };
    file = converted.file;
  }

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
