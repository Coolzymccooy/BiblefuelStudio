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
const n3 = (x) => Number(x).toFixed(3);

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
  const fit = `aresample=48000,apad,atrim=0:${n3(D)}`;
  const tail = (sec) => `afade=t=out:st=${n3(Math.max(0, D - sec))}:d=${sec}`;
  // loudnorm emits 192 kHz. Resampling back to 48 kHz here, explicitly, stops the
  // implicit conversion in front of the AAC encoder from dropping the end of a mixed track.
  const end = `${LOUDNESS},aresample=48000[a]`;
  if (song && voice) {
    return [
      `[1:a]${fit},volume=0.35[m]`,
      `[2:a]${fit},asplit=2[v1][v2]`,
      `[m][v1]sidechaincompress=threshold=0.01:ratio=12:attack=5:release=350:makeup=2[duck]`,
      `[v2][duck]amix=inputs=2:duration=first:dropout_transition=2,${tail(1.2)},${end}`,
    ];
  }
  if (song) return [`[1:a]${fit},afade=t=in:d=0.3,${tail(1.2)},${end}`];
  if (voice) return [`[1:a]${fit},${tail(0.6)},${end}`];
  return ["[1:a]anull,aresample=48000[a]"];
}

export function finishArgs({ body, out, plan, statementsPath, fxPath, song, voice, workDir }) {
  const D = plan.durationSec;
  const style = resolveStyle(plan.style);
  const inputs = ["-i", body];
  if (song) inputs.push("-ss", n3(song.startSec || 0), "-i", song.file);
  if (voice) inputs.push("-i", voice.file);
  if (!song && !voice) inputs.push("-f", "lavfi", "-t", n3(D), "-i", "anullsrc=r=48000:cl=stereo");
  const video = [style.grade, statementsPath && assFilter(statementsPath), fxPath && assFilter(fxPath)].filter(Boolean);
  const graph = [`[0:v]${video.join(",") || "null"}[v]`, ...audioGraph({ song, voice, D })].join(";");
  const script = path.join(workDir, "finish.txt");
  const args = [
    "-hide_banner", "-v", "error", "-y",
    ...inputs,
    "-filter_complex_script", script,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    "-t", n3(D),
    out,
  ];
  return { args, sideFiles: [{ path: script, text: graph }] };
}
