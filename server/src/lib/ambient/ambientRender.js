import fs from "fs";
import path from "path";
import { toFilterScriptArgs } from "../story/storyRender.js";
import { buildXfadeChain } from "../story/sceneTransitions.js";
import { kenBurnsVariedFilter } from "../kenBurnsVaried.js";
import { escapeFontPath, fontFileFor } from "../videoFilters.js";
import { captionPages, balanceLines, pageWindows } from "./captionPages.js";

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
/** A held verse fades with its picture's dissolve instead of popping. */
const CAPTION_FADE_SEC = MOVEMENT_TRANSITION_SEC;
/** Verse size as a share of the frame's shorter side: 42px at 1080. */
const CAPTION_SIZE = 0.039;
/** The reference line under a verse, relative to the verse's size. */
const REFERENCE_SCALE = 0.64;
/** Longest comfortable line, whatever the width allows. */
const MAX_LINE_CHARS = 70;
/** Under one frame at 24 fps: the gap between one page and the next. */
const PAGE_GAP_SEC = 0.03;
/** Average glyph width of the caption face, as a share of its size. */
const GLYPH_WIDTH = 0.47;

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
 * Caption size and line lengths for a frame. The size is fixed (a passage now
 * pages instead of shrinking), and a line is as long as the width comfortably
 * holds: about seventy characters on landscape, forty-five on portrait.
 */
function captionMetrics(width, height) {
  const size = Math.round(Math.min(width, height) * CAPTION_SIZE);
  const lineChars = Math.min(MAX_LINE_CHARS, Math.floor((width * 0.84) / (size * GLYPH_WIDTH)));
  return { size, lineChars, pageChars: lineChars * 2 - 6 };
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
 * The reference under a verse. KJV, the default, is named in the video's
 * description; any other translation is named here too, because its publisher
 * requires the attribution wherever the text appears.
 */
function referenceLine(drop, project) {
  if (!drop.reference) return "";
  const translation = String(drop.translation || project?.translation || "kjv").toLowerCase();
  return translation === "kjv" ? drop.reference : `${drop.reference} · ${translation.toUpperCase()}`;
}

/**
 * One drawtext per line (see the note at the call site). A drop's passage is
 * shown a page at a time — a verse, on at most two balanced lines — and the
 * pages take turns across the drop's window. White text on a soft shadow and
 * a faint outline, no boxes: per-line boxes of different widths read as a
 * stack of highlighter strips over the picture.
 */
function captionFilters({ project, voiced, movements, width, height, workDir }) {
  // A bundled serif rather than ffmpeg's default monospace. The monospace
  // default is the single thing that most makes burned scripture read as
  // machine output; the font ships in the repo so it exists on the server.
  const fontPath = fontFileFor({ fontFamily: "serif" });
  const fontArg = fontPath ? `:fontfile='${escapeFontPath(fontPath)}'` : "";
  const span = project?.captionSpan === "section" ? "section" : "spoken";
  const centred = project?.captionPosition === "centre";
  const { size, lineChars, pageChars } = captionMetrics(width, height);
  const lineHeight = Math.round(size * CAPTION_LINE_HEIGHT);
  const refSize = Math.round(size * REFERENCE_SCALE);
  const shadow = Math.max(1, Math.round(size / 21));
  // A hairline keeps white text off a bright sky or sunlit ground without
  // a box; the small reference line gets the same, so it is not the one
  // that disappears.
  const outline = Math.max(1, Math.round(size / 28));
  const drawn = [];

  const line = (name, text, fontSize, y, win, colour) => {
    const file = path.join(workDir, `caption-${name}.txt`);
    fs.writeFileSync(file, text, "utf8");
    // escapeFontPath, not a plain slash swap: a bare drive colon ends the
    // drawtext option and ffmpeg rejects the whole filtergraph.
    drawn.push(
      // expansion=none: scripture is drawn exactly as written; with it on,
      // a "%" or "\" in the text is read as a drawtext command.
      `drawtext=textfile='${escapeFontPath(file)}'${fontArg}:expansion=none:` +
      `fontcolor=${colour}:fontsize=${fontSize}:` +
      `shadowcolor=black@0.6:shadowx=0:shadowy=${shadow}:borderw=${outline}:bordercolor=black@0.3:` +
      `x=(w-text_w)/2:y=${y}:` +
      `enable='between(t,${win.start.toFixed(2)},${win.end.toFixed(2)})'` +
      (win.fade ? fadeAlpha(win.start, win.end) : ""),
    );
  };

  voiced.forEach((d, i) => {
    if (!d.text) return;
    const win = captionWindow(d, span, movements);
    if (!win) return;
    const reference = span === "section" ? referenceLine(d, project) : "";
    const refGap = reference ? Math.round(size * 0.55) : 0;
    const pages = captionPages(d, pageChars);
    const windows = pageWindows(win.start, win.end, pages, { minSec: span === "spoken" ? 0 : undefined });
    windows.forEach((pw, k) => {
      // between() is inclusive at both ends: a page ends a frame early so two
      // pages are never drawn over each other at the change.
      const end = k < windows.length - 1 ? pw.end - PAGE_GAP_SEC : pw.end;
      const pageWin = { start: pw.start, end, fade: win.fade };
      const lines = balanceLines(pages[k], lineChars);
      const blockHeight = lines.length * lineHeight + (reference ? refGap + refSize : 0);
      // Low in the frame by default, clear of the bottom edge; centre sits
      // the block mid-frame.
      const top = centred
        ? Math.round((height - blockHeight) / 2)
        : Math.round(height * CAPTION_BOTTOM - blockHeight);
      lines.forEach((text, j) => line(`${i}-${k}-${j}`, text, size, top + j * lineHeight, pageWin, "white"));
      if (reference) {
        line(`${i}-${k}-ref`, reference, refSize, top + lines.length * lineHeight + refGap, pageWin, "white@0.88");
      }
    });
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
    const drawn = captionFilters({ project, voiced, movements, width, height, workDir });
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
