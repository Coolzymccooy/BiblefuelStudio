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
import { filterPath } from "../branding.js";
import { FADE } from "./brandingPlan.js";

const SIZES = {
  portrait: { "720p": [720, 1280], "1080p": [1080, 1920] },
  landscape: { "720p": [1280, 720], "1080p": [1920, 1080] },
  square: { "720p": [720, 720], "1080p": [1080, 1080] },
};

const FPS = 30;
const DARK_BACKGROUND = "0x101820";
const CANCELLED = "Render cancelled";
/** The logo's time mask is drawn this small, then scaled to the logo: geq is cheap on 256 pixels. */
const MASK_SIZE = 16;
/** The end card logo fits a square this share of the frame's shorter side. */
const END_CARD_LOGO = 0.36;
/** Where the end card logo's centre sits, as a share of the frame height. */
const END_CARD_Y = { tall: 0.4, wide: 0.36 };
const END_CARD_FADE_SEC = 0.4;

/** Nearest even integer, at least 2: video encoders want even dimensions. */
const even = (n) => Math.max(2, 2 * Math.round(n / 2));

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

/** A number as ffmpeg should read it: no float noise, no trailing zeros. */
const num = (x) => String(Number(Number(x).toFixed(3)));

/**
 * The song's shaping as its own simple graph (-af on the mapped track): silence padded out to
 * the planned length, then the fade. Nothing when neither applies.
 */
function audioShape(audio) {
  if (!audio) return [];
  const filters = [];
  if (audio.padToSec > audio.inputSec) filters.push(`apad=whole_dur=${num(audio.padToSec)}`);
  if (audio.fadeSec > 0) filters.push(`afade=t=out:st=${num(audio.fadeFromSec)}:d=${num(audio.fadeSec)}`);
  return filters.length ? ["-af", filters.join(",")] : [];
}

/**
 * The logo as an endless 30 fps RGBA stream fitted into w x h. It is scaled once, before it
 * loops, so a large upload is not rescaled every frame. With `exact`, a transparent pad on the
 * right makes the size exactly w x h (the aspect-kept fit can round one side down), so a mask
 * of that size lines up and the logo stays at the band's left edge.
 */
function loopedLogo(file, w, h, { exact = false } = {}) {
  const pad = exact ? `pad=${w}:${h}:0:(oh-ih)/2:color=black@0,` : "";
  return `movie=${filterPath(file)},scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba,`
    + `${pad}loop=loop=-1:size=1:start=0,setpts=N/(${FPS}*TB)`;
}

/** 0 to 1 over time: 1 inside each band piece, with a FADE-second ramp at either end. */
function pieceMask(pieces) {
  return pieces
    .map(([a, b]) => `clip((T-${num(a)})/${FADE},0,1)*clip((${num(b)}-T)/${FADE},0,1)`)
    .join("+");
}

/** The small logo in the band, faded by a tiny time mask (geq runs on 16x16, never on the logo). */
function smallLogoChain({ plan, geometry, logo, from, to }) {
  const { x, y, w, h } = geometry.logo;
  const opacity = Number.isFinite(Number(logo.opacity)) ? Math.min(1, Math.max(0, Number(logo.opacity))) : 1;
  return [
    `${loopedLogo(logo.file, w, h, { exact: true })},split=2[blg][bla]`,
    `color=c=white:s=${MASK_SIZE}x${MASK_SIZE}:r=${FPS}:d=${num(plan.totalSec)},format=gray,`
      + `geq=lum='255*${num(opacity)}*(${pieceMask(plan.bandPieces)})',scale=${w}:${h}[bm]`,
    "[bla]alphaextract[ba0]",
    "[ba0][bm]blend=all_mode=multiply[ba1]",
    "[blg][ba1]alphamerge[blogo]",
    `[${from}][blogo]overlay=x=${x}:y=${y}:shortest=1[${to}]`,
  ];
}

/** The big logo on the end card, fading in when the card starts, centred a little above the middle. */
function endCardLogoChain({ plan, logo, width, height, from, to }) {
  const box = even(END_CARD_LOGO * Math.min(width, height));
  const cy = Math.round((width < height ? END_CARD_Y.tall : END_CARD_Y.wide) * height);
  const start = num(plan.endCard.start);
  return [
    `${loopedLogo(logo.file, box, box)},fade=t=in:st=${start}:d=${END_CARD_FADE_SEC}:alpha=1[becl]`,
    `[${from}][becl]overlay=x=(main_w-overlay_w)/2:y=${cy}-overlay_h/2:enable='gte(t,${start})':shortest=1[${to}]`,
  ];
}

/**
 * The logo chains the plan calls for, between the captions (`[bcap]`) and the final format.
 * Returns the chains and the label the final format reads; no chains means no plan for a logo.
 */
function logoChains({ plan, geometry, logo, width, height }) {
  if (!plan?.showLogo || !logo?.file) return { chains: [], last: null };
  const chains = [];
  let last = "bcap";
  if (plan.bandPieces?.length && geometry?.logo) {
    chains.push(...smallLogoChain({ plan, geometry, logo, from: last, to: "bvl" }));
    last = "bvl";
  }
  if (plan.endCard) {
    chains.push(...endCardLogoChain({ plan, logo, width, height, from: last, to: "bve" }));
    last = "bve";
  }
  return chains.length ? { chains, last } : { chains: [], last: null };
}

/**
 * ffmpeg args for one lyric video. With a branding `plan` (from buildRenderAss) the picture
 * runs for plan.totalSec, the song for plan.audio.inputSec shaped by -af, and the logo chains
 * are drawn after the captions. Without one the args are exactly as they always were.
 */
export function buildLyricRenderArgs({ songPath, background, assPath, width, height, durationSec, outPath, plan, geometry, logo }) {
  const framed = background
    ? sceneFrameFilter({ src: "[0:v]", i: 0, width, height, fit: background.fit === FIT_CONTAIN ? FIT_CONTAIN : FIT_COVER })
    : ["[0:v]null[s0]"];
  const ass = `[s0]fps=${FPS},ass=filename='${escapeFontPath(assPath)}':fontsdir='${escapeFontPath(FONT_DIR)}'`;
  // Prod's ffmpeg 5.1 needs the colour tags set explicitly before the pixel
  // format, or players disagree about the colours.
  const finish = "setparams=range=tv:colorspace=bt470bg,format=yuv420p[v]";
  const { chains, last } = logoChains({ plan, geometry, logo, width, height });
  const picture = last ? [`${ass}[bcap]`, ...chains, `[${last}]${finish}`] : [`${ass},${finish}`];
  return [
    "-y", "-hide_banner",
    ...pictureInput(background, width, height, plan ? plan.totalSec : durationSec),
    "-t", String(plan ? plan.audio.inputSec : durationSec), "-i", songPath,
    "-filter_complex", [...framed, ...picture].join(";"),
    // The song's audio goes straight to the encoder, never through the graph.
    "-map", "[v]", "-map", "1:a:0",
    ...audioShape(plan?.audio),
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
  const { jobId, outPath } = opts;
  // The video's own length: the plan's when the song is extended or trimmed.
  const durationSec = opts.plan ? opts.plan.totalSec : opts.durationSec;
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
