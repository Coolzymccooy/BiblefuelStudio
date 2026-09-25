import fs from "fs";
import path from "path";
import { toFilterScriptArgs } from "../story/storyRender.js";
import { buildXfadeChain } from "../story/sceneTransitions.js";
import { kenBurnsVariedFilter } from "../kenBurnsVaried.js";
import { escapeFontPath, fontFileFor } from "../videoFilters.js";

/**
 * Ambient render — one ffmpeg pass producing a music-first scripture video.
 *
 * The audio graph is the reason this file exists. Story mixes a quiet bed under
 * a continuous voice; here the bed IS the product and the voice arrives a
 * handful of times an hour. So the bed sets the length (`duration=first` with
 * the bed first) and the sparse voice track drives a sidechain that dips the
 * music only while a verse speaks.
 *
 * Prod runs ffmpeg 5.1. Everything goes out through `toFilterScriptArgs`;
 * an inline `-filter_complex` must never reach the spawn.
 */

/** Encoder frame rate. Ken Burns MUST be told this same number — see below. */
export const FPS = 24;

/**
 * A slow dissolve suits ambient where a 0.5s cut would not. `safeTransitionSec`
 * inside buildXfadeChain still clamps this against short movements.
 */
export const MOVEMENT_TRANSITION_SEC = 1.5;

/** Baseline-to-baseline spacing as a multiple of the font size. */
const CAPTION_LINE_HEIGHT = 1.4;
/** The caption block never reaches past this fraction of the frame height. */
const CAPTION_BOTTOM = 0.9;
/** …nor takes more than this share of the frame. A long verse shrinks to fit. */
const CAPTION_MAX_BLOCK = 0.32;
/** A held verse fades with its picture's dissolve instead of popping. */
const CAPTION_FADE_SEC = MOVEMENT_TRANSITION_SEC;
/** The reference line under a held verse, relative to the verse's size. */
const REFERENCE_SCALE = 0.62;

export function dimsFor(aspect) {
  if (aspect === "portrait") return { width: 1080, height: 1920 };
  if (aspect === "square") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

/**
 * Wrap verse text for burning. drawtext does not wrap, so a long verse would
 * run off both edges of the frame as a single line.
 */
export function wrapText(text, maxChars = 42) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if ((line + " " + w).length <= maxChars) line += ` ${w}`;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Wrap a verse and pick a font size the block actually fits in.
 *
 * "He maketh me to lie down in green pastures…" is four lines at the base
 * size; "Come unto me, all ye that labour…" is seven. A fixed size renders
 * the short one well and pushes the long one off the frame, so the size
 * shrinks (to a readable floor) until the block is within its share of the
 * height.
 *
 * @param {string} text
 * @param {number} height frame height in px
 * @returns {{ lines: string[], size: number }}
 */
export function layOutCaption(text, height) {
  const maxBlock = height * CAPTION_MAX_BLOCK;
  const base = Math.round(height * 0.038);
  const floor = Math.round(height * 0.024);
  for (let size = base; size >= floor; size -= 2) {
    // Longer lines at a smaller size, so shrinking wins on two fronts.
    const lines = wrapText(text, Math.round(42 * (base / size)));
    if (lines.length * size * CAPTION_LINE_HEIGHT <= maxBlock) return { lines, size };
  }
  // Nothing fits: take the floor rather than truncating scripture.
  return { lines: wrapText(text, Math.round(42 * (base / floor))), size: floor };
}

/**
 * When a verse is on screen.
 *
 *   spoken  — only while it is heard (the original behaviour, and what a
 *             project saved before the choice existed still gets).
 *   section — for as long as its picture is up: the movement that contains
 *             it. A ten-minute session otherwise shows ten seconds of
 *             scripture and nine minutes fifty of a bare image.
 */
function captionWindow(drop, span, movements) {
  const atMs = Number(drop.atMs) || 0;
  if (span === "section") {
    const m = movements.find((mv, i) => atMs >= mv.startMs && (atMs < mv.endMs || i === movements.length - 1));
    if (m) return { start: m.startMs / 1000, end: m.endMs / 1000, fade: true };
  }
  if (!(Number(drop.durationMs) > 0)) return null;
  return { start: atMs / 1000, end: (atMs + Number(drop.durationMs)) / 1000, fade: false };
}

/** drawtext alpha: in over CAPTION_FADE_SEC, out over the same, 1 between. */
function fadeAlpha(start, end) {
  const f = Math.min(CAPTION_FADE_SEC, (end - start) / 3);
  const s = start.toFixed(2);
  const e = end.toFixed(2);
  const inEnd = (start + f).toFixed(2);
  const outStart = (end - f).toFixed(2);
  const fs = f.toFixed(2);
  return `:alpha='if(lt(t,${inEnd}),(t-${s})/${fs},if(gt(t,${outStart}),(${e}-t)/${fs},1))'`;
}

/**
 * One drawtext per line (see the note at the call site), laid out against the
 * block's own height, with the reference beneath a held verse.
 */
function captionFilters({ project, voiced, movements, height, workDir }) {
  // A bundled serif rather than ffmpeg's default monospace. The monospace
  // default is the single thing that most makes burned scripture read as
  // machine output; the font ships in the repo so it exists on the server.
  const fontPath = fontFileFor({ fontFamily: "serif" });
  const fontArg = fontPath ? `:fontfile='${escapeFontPath(fontPath)}'` : "";
  const span = project?.captionSpan === "section" ? "section" : "spoken";
  const centred = project?.captionPosition === "centre";
  const drawn = [];

  const line = (i, j, text, size, y, win, colour) => {
    const file = path.join(workDir, `caption-${i}-${j}.txt`);
    fs.writeFileSync(file, text, "utf8");
    // escapeFontPath, not a plain slash swap: a bare drive colon ends the
    // drawtext option and ffmpeg rejects the whole filtergraph.
    drawn.push(
      `drawtext=textfile='${escapeFontPath(file)}'${fontArg}:` +
      `fontcolor=${colour}:fontsize=${size}:` +
      `box=1:boxcolor=black@0.42:boxborderw=${Math.round(size * 0.35)}:` +
      `x=(w-text_w)/2:y=${y}:` +
      `enable='between(t,${win.start.toFixed(2)},${win.end.toFixed(2)})'` +
      (win.fade ? fadeAlpha(win.start, win.end) : ""),
    );
  };

  voiced.forEach((d, i) => {
    if (!d.text) return;
    const win = captionWindow(d, span, movements);
    if (!win) return;
    const { lines, size } = layOutCaption(d.text, height);
    const lineHeight = Math.round(size * CAPTION_LINE_HEIGHT);
    const reference = span === "section" && d.reference
      ? `${d.reference} · ${String(d.translation || project?.translation || "kjv").toUpperCase()}`
      : "";
    const refSize = Math.round(size * REFERENCE_SCALE);
    const refGap = reference ? Math.round(size * 0.6) : 0;
    const blockHeight = lines.length * lineHeight + (reference ? refGap + refSize : 0);
    // Lower third by default, never past the safe bottom margin — a long verse
    // grows upward instead of off the frame. Centre sits the block mid-frame.
    const top = centred
      ? Math.round((height - blockHeight) / 2)
      : Math.round(Math.min(height * 0.70, height * CAPTION_BOTTOM - blockHeight));
    lines.forEach((text, j) => line(i, j, text, size, top + j * lineHeight, win, "white"));
    if (reference) {
      line(i, lines.length, reference, refSize, top + lines.length * lineHeight + refGap, win, "white@0.8");
    }
  });
  return drawn;
}

/**
 * Build the ffmpeg invocation.
 *
 * INPUT ORDER IS LOAD-BEARING and every filter label below indexes off it:
 *   0..K-1  movement images   (-loop 1 -t <padded> -i file)
 *   K       the assembled bed (-i file)
 *   K+1..   voiced drops      (-i file), in drops order
 *
 * @param {object} project
 * @param {{ bedPath: string, images: string[], drops: Array<object>, outPath: string, workDir?: string }} io
 * @returns {{ args: string[], filter: string, scriptFile: string|null }}
 */
export function buildAmbientFfmpegArgs(project, { bedPath, images, drops, outPath, workDir }) {
  if (!bedPath) throw new Error("ambient render: no bed — there is no video without it");
  const { width, height } = dimsFor(project?.aspect);
  const targetSec = Number(project?.targetSec) || 0;
  if (!(targetSec > 0)) throw new Error("ambient render: targetSec must be positive");

  const movements = (project?.movements || []).map((m, i) => ({
    ...m,
    durationSec: Math.max(1, ((Number(m.endMs) || 0) - (Number(m.startMs) || 0)) / 1000),
    image: images[i] || null,
  })).filter((m) => m.image);

  if (movements.length === 0) throw new Error("ambient render: no movement images");

  const xfade = buildXfadeChain(movements, { transitionSec: MOVEMENT_TRANSITION_SEC });

  const args = ["-y"];
  // --- image inputs -------------------------------------------------------
  movements.forEach((m, i) => {
    const dur = xfade.paddedDurations[i] ?? m.durationSec;
    args.push("-loop", "1", "-t", String(dur.toFixed(3)), "-i", m.image);
  });
  const bedIdx = movements.length;
  args.push("-i", bedPath);

  const voiced = (drops || []).filter((d) => d.audioPath && d.status !== "error");
  voiced.forEach((d) => args.push("-i", d.audioPath));

  // --- video --------------------------------------------------------------
  const parts = [];
  movements.forEach((m, i) => {
    const dur = xfade.paddedDurations[i] ?? m.durationSec;
    const chain = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
    ];
    if (project?.motion === "drift") {
      // kenBurnsVariedFilter defaults fps to 30. Passing the encoder's 24
      // explicitly is not optional: the default makes the drift run fast.
      chain.push(kenBurnsVariedFilter(width, height, dur, FPS, i % 2 === 0 ? "in" : "out"));
    }
    chain.push("setsar=1", `fps=${FPS}`);
    parts.push(`[${i}:v]${chain.join(",")}[s${i}]`);
  });
  parts.push(...xfade.filters);
  const videoOut = movements.length === 1 ? "[s0]" : "[vcat]";

  // --- captions -----------------------------------------------------------
  // Burned only where there is something to say. `textfile=` sidesteps the
  // escaping minefield of quotes, colons and apostrophes in verse text.
  //
  // ONE drawtext PER LINE, not one per verse with embedded newlines. Two
  // reasons, both found by looking at a rendered frame:
  //   1. This ffmpeg draws the LF in a multi-line textfile as a missing-glyph
  //      box at the end of every line. Splitting the lines removes the
  //      newline from the text entirely, so there is nothing to mis-shape.
  //   2. A fixed `y=h*0.72` ran a four-line verse off the bottom of the
  //      frame. Per-line placement lets the block be sized and positioned
  //      against its own height.
  let captionIn = videoOut;
  if (project?.captions && project.captions !== "none" && workDir) {
    const drawn = captionFilters({ project, voiced, movements, height, workDir });
    if (drawn.length > 0) {
      parts.push(`${captionIn}${drawn.join(",")}[vout]`);
      captionIn = "[vout]";
    }
  }

  // --- audio --------------------------------------------------------------
  // aresample on every input: amix and sidechaincompress require a common
  // sample rate, and uploaded tracks are a mixed bag of 44.1k and 48k.
  parts.push(
    `[${bedIdx}:a]aresample=48000,atrim=0:${targetSec},asetpts=N/SR/TB,` +
    `volume=${Number(project?.bed?.volume ?? 0.85)}[bed]`,
  );

  let audioOut = "[bed]";
  if (voiced.length > 0) {
    voiced.forEach((d, i) => {
      const ms = Math.max(0, Math.round(Number(d.atMs) || 0));
      parts.push(
        `[${bedIdx + 1 + i}:a]aresample=48000,adelay=${ms}:all=1,` +
        `apad=whole_dur=${targetSec}[d${i}]`,
      );
    });
    if (voiced.length === 1) {
      parts.push(`[d0]anull[voice]`);
    } else {
      const ins = voiced.map((_, i) => `[d${i}]`).join("");
      // normalize=0 is essential: amix's default divides by input count, so
      // eight sparse drops would each come out at an eighth of their level.
      parts.push(`${ins}amix=inputs=${voiced.length}:normalize=0:duration=shortest[voice]`);
    }
    const duck = project?.duck || {};
    parts.push(`[voice]asplit=2[vc][vm]`);
    parts.push(
      `[bed][vc]sidechaincompress=` +
      `threshold=${duck.threshold ?? 0.02}:ratio=${duck.ratio ?? 8}:` +
      `attack=${duck.attackMs ?? 20}:release=${duck.releaseMs ?? 800}[ducked]`,
    );
    parts.push(`[ducked][vm]amix=inputs=2:normalize=0:duration=first[aout]`);
    audioOut = "[aout]";
  }

  const filter = parts.join(";\n");
  args.push(
    "-filter_complex", filter,
    "-map", captionIn,
    "-map", audioOut,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-t", String(targetSec),
    outPath,
  );

  const { args: scripted, scriptFile } = toFilterScriptArgs(args, outPath);
  return { args: scripted, filter, scriptFile };
}
