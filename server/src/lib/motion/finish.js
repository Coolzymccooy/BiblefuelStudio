import path from "node:path";
import { buildAss } from "../kinetic/ass.js";
import { mulberry32 } from "../kinetic/director.js";
import { escapeFontPath, FONT_DIR } from "../videoFilters.js";
import { getEffect } from "./effects/index.js";
import { resolveStyle, captionEnergyFor } from "./styles.js";

/**
 * The last pass over the joined shots: colour grade, the statements
 * (kinetic engine), the ASS overlays, and the audio mix, encoded for social.
 *
 * Colour: the body clips are limited-range yuv420p tagged BT.601 (bt470bg).
 * Nothing here converts the matrix or retags, so the output keeps those tags.
 */
export const LOUDNESS = "loudnorm=I=-14:TP=-1.5:LRA=11";
/** The picture's fade to black at the very end. */
export const FADE_OUT_SEC = 0.8;
/** The song's fade-out: a little longer than the picture's, so the sound settles as it goes. */
const SONG_TAIL_SEC = 1.5;
/** How dark the closing card gets behind its words, so they read over any photo. */
const SCRIM = "black@0.4";
const n3 = (x) => Number(x).toFixed(3);

/** Darkens the closing card from its first frame (none when the Moment has no end card). */
function closingScrim(plan) {
  const end = plan.shots.at(-1);
  if (!end || end.role !== "end") return null;
  return `drawbox=x=0:y=0:w=iw:h=ih:color=${SCRIM}:t=fill:enable='gte(t,${n3(end.start)})'`;
}

export function statementsAss(plan) {
  if (!plan.captions.length) return "";
  const style = resolveStyle(plan.style);
  const overrides = {};
  plan.captions.forEach((c, i) => { if (c.effect) overrides[i] = c.effect; });
  return buildAss({
    lines: plan.captions.map(({ text, start, end, reveal, holdUntil }) => ({ text, start, end, reveal, holdUntil })),
    w: plan.w,
    h: plan.h,
    look: style.look,
    energy: captionEnergyFor(plan.energy),
    seed: plan.seed,
    overrides,
  });
}

export function fxAss(plan) {
  const ctx = { w: plan.w, h: plan.h, fps: plan.fps };
  const events = [];
  plan.shots.forEach((shot, i) => {
    shot.overlays.forEach((o, k) => {
      const fx = getEffect(o.id);
      if (fx?.assEvents) events.push(...fx.assEvents({ shot, ctx, rnd: mulberry32((plan.seed + i * 101 + k * 7) >>> 0) }));
    });
  });
  if (!events.length) return "";
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${plan.w}`, `PlayResY: ${plan.h}`, "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: FX,DejaVu Sans,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events, "",
  ].join("\n");
}

const assFilter = (p) => `ass=filename='${escapeFontPath(p)}':fontsdir='${escapeFontPath(FONT_DIR)}'`;

function audioGraph({ song, voice, D }) {
  // apad=whole_dur pads to exactly D; atrim is a hard ceiling for a source that runs long.
  const fit = `aresample=48000,apad=whole_dur=${n3(D)},atrim=0:${n3(D)}`;
  const tail = (sec) => `afade=t=out:st=${n3(Math.max(0, D - sec))}:d=${sec}`;
  // loudnorm emits 192 kHz. Resampling back to 48 kHz here, explicitly, stops the
  // implicit conversion in front of the AAC encoder from dropping the end of a mixed track.
  const end = `${LOUDNESS},aresample=48000[a]`;
  if (song && voice) {
    return [
      `[1:a]${fit},volume=0.35[m]`,
      `[2:a]${fit},asplit=2[v1][v2]`,
      `[m][v1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[duck]`,
      `[v2][duck]amix=inputs=2:duration=first:dropout_transition=2,${tail(SONG_TAIL_SEC)},${end}`,
    ];
  }
  if (song) return [`[1:a]${fit},afade=t=in:d=0.3,${tail(SONG_TAIL_SEC)},${end}`];
  if (voice) return [`[1:a]${fit},${tail(0.6)},${end}`];
  return ["[1:a]anull,aresample=48000[a]"];
}

export function finishArgs({ body, out, plan, statementsPath, fxPath, song, voice, workDir }) {
  const D = plan.durationSec;
  const style = resolveStyle(plan.style);
  const inputs = ["-i", body];
  // Each audio input is cut at D in the demuxer, so the audio graph only ever sees a natural EOF at
  // or before D. A long voice that hit the in-graph atrim ceiling while its demuxer was still
  // producing made the tail drop out under load.
  if (song) inputs.push("-ss", n3(song.startSec || 0), "-t", n3(D), "-i", song.file);
  if (voice) inputs.push("-t", n3(D), "-i", voice.file);
  if (!song && !voice) inputs.push("-f", "lavfi", "-t", n3(D), "-i", "anullsrc=r=48000:cl=stereo");
  // Both streams are bounded inside the graph. An output-side -t raced loudnorm's end-of-stream
  // flush (it buffers about 3 s), and the muxer could close the audio before the flush landed.
  const bound = `trim=end_frame=${Math.round(D * plan.fps)},setpts=N/${plan.fps}/TB`;
  // The scrim sits under the words; the fade to black closes everything, words included.
  const fadeOut = `fade=t=out:st=${n3(Math.max(0, D - FADE_OUT_SEC))}:d=${FADE_OUT_SEC}`;
  const video = [
    style.grade, closingScrim(plan), statementsPath && assFilter(statementsPath), fxPath && assFilter(fxPath), fadeOut, bound,
  ].filter(Boolean);
  // Picture and sound are two separate filtergraphs. In ffmpeg 8.0.1 a single graph holding both
  // lost the end of the mixed audio now and then when the machine was busy (the audio went to
  // silence from a random point in the last 1.5 s); separate graphs never did in repeated trials.
  const videoScript = path.join(workDir, "finish-video.txt");
  const audioScript = path.join(workDir, "finish-audio.txt");
  const args = [
    "-hide_banner", "-v", "error", "-y",
    ...inputs,
    "-filter_complex_script", videoScript,
    "-filter_complex_script", audioScript,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    out,
  ];
  return {
    args,
    sideFiles: [
      { path: videoScript, text: `[0:v]${video.join(",") || "null"}[v]` },
      { path: audioScript, text: audioGraph({ song, voice, D }).join(";") },
    ],
  };
}
