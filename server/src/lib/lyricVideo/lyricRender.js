// server/src/lib/lyricVideo/lyricRender.js
//
// Draws a song's lyric captions (an ASS file) over one background - a looped
// video, a still image, or a dark colour - with the song's own audio, as a
// tracked render job.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { sceneFrameFilter, toFilterScriptArgs } from "../story/storyRender.js";
import { FIT_COVER, FIT_CONTAIN, chooseSceneFit, probeMediaSize } from "../story/sceneFraming.js";
import { escapeFontPath, FONT_DIR } from "../videoFilters.js";
import { markRunning, markProgress, markDone, markError, attachProc, getJob } from "../renderJobs.js";

const SIZES = {
  portrait: { "720p": [720, 1280], "1080p": [1080, 1920] },
  landscape: { "720p": [1280, 720], "1080p": [1920, 1080] },
  square: { "720p": [720, 720], "1080p": [1080, 1080] },
};

const FPS = 30;
const DARK_BACKGROUND = "0x101820";
const CANCELLED = "Render cancelled";

export function renderSize(aspect, quality) {
  const frame = SIZES[aspect] || SIZES.portrait;
  const [width, height] = frame[quality] || frame["720p"];
  return { width, height };
}

/**
 * The picture input, bounded on the input side. Every input carries its own
 * `-t`: ffmpeg 8 can silently end a render with a second of audio silence
 * under CPU load when the audio is bounded by an output-side `-t` instead.
 */
function pictureInput(background, width, height, durationSec) {
  const t = String(durationSec);
  if (!background) return ["-f", "lavfi", "-t", t, "-i", `color=c=${DARK_BACKGROUND}:s=${width}x${height}:r=${FPS}`];
  if (background.kind === "image") return ["-loop", "1", "-framerate", String(FPS), "-t", t, "-i", background.file];
  return ["-stream_loop", "-1", "-t", t, "-i", background.file];
}

export function buildLyricRenderArgs({ songPath, background, assPath, width, height, durationSec, outPath }) {
  const framed = background
    ? sceneFrameFilter({ src: "[0:v]", i: 0, width, height, fit: background.fit === FIT_CONTAIN ? FIT_CONTAIN : FIT_COVER })
    : ["[0:v]null[s0]"];
  // Prod's ffmpeg 5.1 needs the colour tags set explicitly before the pixel
  // format, or players disagree about the colours.
  const captions =
    `[s0]fps=${FPS},ass=filename='${escapeFontPath(assPath)}':fontsdir='${escapeFontPath(FONT_DIR)}',` +
    "setparams=range=tv:colorspace=bt470bg,format=yuv420p[v]";
  return [
    "-y", "-hide_banner",
    ...pictureInput(background, width, height, durationSec),
    "-t", String(durationSec), "-i", songPath,
    "-filter_complex", [...framed, captions].join(";"),
    // The song's audio goes straight to the encoder, never through the graph.
    "-map", "[v]", "-map", "1:a",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ac", "2",
    "-movflags", "+faststart", outPath,
  ];
}

async function resolveFit(background, width, height) {
  if (!background || background.fit !== "auto") return background;
  const size = await probeMediaSize(background.file);
  const fit = chooseSceneFit({ mediaWidth: size?.width, mediaHeight: size?.height, frameWidth: width, frameHeight: height });
  return { ...background, fit };
}

function removeFile(file) {
  if (!file) return;
  try { fs.rmSync(file, { force: true }); } catch { /* a leftover script is harmless */ }
}

export async function runLyricRender(opts) {
  const { jobId, durationSec, outPath } = opts;
  const background = await resolveFit(opts.background, opts.width, opts.height);
  // A cancel that arrived while the background was measured has no ffmpeg to
  // kill yet; starting one now would overwrite the cancel and render anyway.
  if (getJob(jobId)?.cancelled) return { ok: false, error: CANCELLED };

  return new Promise((resolve) => {
    let scriptFile = null;
    let proc;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      removeFile(scriptFile);
      resolve(result);
    };
    const fail = (message) => {
      markError(jobId, message);
      finish({ ok: false, error: String(message) });
    };

    try {
      const scripted = toFilterScriptArgs(buildLyricRenderArgs({ ...opts, background }), outPath);
      scriptFile = scripted.scriptFile;
      markRunning(jobId);
      // spawn can throw synchronously (ENAMETOOLONG, ENOENT): that must become
      // a failed job, never a dead server.
      proc = spawn(process.env.FFMPEG_PATH?.trim() || "ffmpeg", scripted.args);
    } catch (err) {
      return fail(err?.message || err);
    }
    attachProc(jobId, proc);

    let tail = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && durationSec > 0) {
        markProgress(jobId, ((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / durationSec) * 100);
      }
    });
    proc.on("error", (err) => fail(err?.message || err));
    proc.on("close", (code) => {
      // markDone / markError leave a cancelled job cancelled, so only the
      // result needs to say so.
      if (getJob(jobId)?.cancelled) return finish({ ok: false, error: CANCELLED });
      if (code === 0) {
        markDone(jobId, outPath);
        return finish({ ok: true, file: outPath });
      }
      markError(jobId, `ffmpeg exited ${code}: ${tail.slice(-400)}`);
      finish({ ok: false, error: `ffmpeg exited ${code}` });
    });
  });
}
