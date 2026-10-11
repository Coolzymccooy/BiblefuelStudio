import fs from "fs";
import path from "path";
import { toFilterScriptArgs } from "../story/storyRender.js";
import { buildXfadeChain } from "../story/sceneTransitions.js";
import { driftFilter } from "./ambientMotion.js";
import { escapeFontPath, fontFileFor } from "../videoFilters.js";
import { captionPages, balanceLines, pageWindows } from "./captionPages.js";
import { videoCodecArgs } from "./encoders.js";
import { logoOverlay } from "../branding.js";
import { isStudioLook, resolveEnergy } from "../kinetic/looks.js";
import { studioCaptionFilter } from "../kinetic/filter.js";
import { hasLibass } from "../kinetic/capability.js";
import { SEED_MAX } from "../kinetic/renderCaptions.js";

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
/** Under Studio the reference reads beside 53-150 px phrases, so it is larger than the classic 0.64. */
const STUDIO_REFERENCE_SCALE = 1.1;
/**
 * Longest Studio page. The serif pages run about twice this (two lines of ~45
 * characters), but the engine fits a long phrase by shrinking it toward the
 * serif's size; cut near its own 28-character / five-word phrases, a verse
 * keeps the big hand-lettered look. Windows are shared out across the extra
 * pages by pageWindows, which never drops a word.
 */
const STUDIO_PAGE_CHARS = 36;
/** Reading pace for a held Studio page: seconds each word takes to appear. */
const REVEAL_SEC_PER_WORD = 0.4;
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
 * What is said and when: for each voiced drop, its window, its reference line
 * and its pages with their windows. The serif drawtext captions and the Studio
 * (libass) captions both draw from this one plan, so their timings cannot
 * drift apart.
 */
function captionPlan({ project, voiced, movements, width, height, pageChars }) {
  const span = project?.captionSpan === "section" ? "section" : "spoken";
  const metrics = captionMetrics(width, height);
  const drops = [];
  voiced.forEach((d, i) => {
    if (!d.text) return;
    const win = captionWindow(d, span, movements);
    if (!win) return;
    const reference = span === "section" ? referenceLine(d, project) : "";
    const pages = captionPages(d, pageChars ?? metrics.pageChars);
    const windows = pageWindows(win.start, win.end, pages, { minSec: span === "spoken" ? 0 : undefined });
    drops.push({
      i,
      win,
      reference,
      pages: windows.map((pw, k) => ({
        text: pages[k],
        start: pw.start,
        // between() is inclusive at both ends: a page ends a frame early so two
        // pages are never drawn over each other at the change.
        end: k < windows.length - 1 ? pw.end - PAGE_GAP_SEC : pw.end,
      })),
    });
  });
  return { metrics, drops };
}

/**
 * The look shared by every drawtext line: a bundled serif rather than ffmpeg's
 * default monospace (the single thing that most makes burned scripture read as
 * machine output; the font ships in the repo so it exists on the server), and
 * a soft shadow plus a hairline outline in place of a box.
 */
function drawtextStyle(size) {
  const fontPath = fontFileFor({ fontFamily: "serif" });
  return {
    fontArg: fontPath ? `:fontfile='${escapeFontPath(fontPath)}'` : "",
    shadow: Math.max(1, Math.round(size / 21)),
    // A hairline keeps white text off a bright sky or sunlit ground without
    // a box; the small reference line gets the same, so it is not the one
    // that disappears.
    outline: Math.max(1, Math.round(size / 28)),
  };
}

/** One drawtext line, its text written to `file` (textfile= sidesteps quoting). */
function drawtextLine({ file, text, fontSize, y, win, colour, style }) {
  fs.writeFileSync(file, text, "utf8");
  // escapeFontPath, not a plain slash swap: a bare drive colon ends the
  // drawtext option and ffmpeg rejects the whole filtergraph.
  return (
    // expansion=none: scripture is drawn exactly as written; with it on,
    // a "%" or "\" in the text is read as a drawtext command.
    `drawtext=textfile='${escapeFontPath(file)}'${style.fontArg}:expansion=none:` +
    `fontcolor=${colour}:fontsize=${fontSize}:` +
    `shadowcolor=black@0.6:shadowx=0:shadowy=${style.shadow}:borderw=${style.outline}:bordercolor=black@0.3:` +
    `x=(w-text_w)/2:y=${y}:` +
    `enable='between(t,${win.start.toFixed(2)},${win.end.toFixed(2)})'` +
    (win.fade ? fadeAlpha(win.start, win.end) : "")
  );
}

/**
 * One drawtext per line (see the note at the call site). A drop's passage is
 * shown a page at a time — a verse, on at most two balanced lines — and the
 * pages take turns across the drop's window. White text on a soft shadow and
 * a faint outline, no boxes: per-line boxes of different widths read as a
 * stack of highlighter strips over the picture.
 */
function captionFilters({ project, plan, width, height, workDir }) {
  const centred = project?.captionPosition === "centre";
  const { size, lineChars } = plan.metrics;
  const lineHeight = Math.round(size * CAPTION_LINE_HEIGHT);
  const refSize = Math.round(size * REFERENCE_SCALE);
  const style = drawtextStyle(size);
  const drawn = [];

  const line = (name, text, fontSize, y, win, colour) => {
    drawn.push(drawtextLine({ file: path.join(workDir, `caption-${name}.txt`), text, fontSize, y, win, colour, style }));
  };

  plan.drops.forEach(({ i, win, reference, pages }) => {
    const refGap = reference ? Math.round(size * 0.55) : 0;
    pages.forEach((page, k) => {
      const pageWin = { start: page.start, end: page.end, fade: win.fade };
      const lines = balanceLines(page.text, lineChars);
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

// The caption engine, swappable so a test can make it throw.
let studioEngine = studioCaptionFilter;
/** Replace (or with undefined, restore) the engine. Tests only. */
export function _setStudioEngineForTest(fn) {
  studioEngine = fn ?? studioCaptionFilter;
}

/** A stable 31-bit seed from a string (FNV-1a), so an old project never reshuffles. */
function seedFromId(id) {
  let h = 0x811c9dc5;
  for (const ch of String(id ?? "")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & SEED_MAX;
}

/** The project's stored seed, else one derived from its id. Never random here. */
function studioSeed(project) {
  const seed = project?.captionSeed;
  return Number.isInteger(seed) && seed >= 0 && seed <= SEED_MAX ? seed : seedFromId(project?.projectId);
}

/**
 * Studio effects captions: the pages go to the libass engine as timed lines,
 * and the reference line stays a drawtext (the engine draws phrases, not
 * citations) chained after the `ass` filter. Returns the filter chain, or
 * null when this render should use the serif captions instead (no libass, the
 * engine or the .ass write failed, or there was nothing to draw).
 *
 * `captionPosition` is deliberately ignored: the director places Studio
 * phrases itself.
 */
function studioFilters({ project, plan, width, height, workDir }) {
  try {
    // A page is held for its whole window, minutes long in section span. The
    // engine would spread its words over all of it and hold the last phrase past
    // it, so each page asks for a reading-pace reveal and to leave exactly at
    // its page end (no overlap with the next page, no hang into the next movement).
    const lines = plan.drops.flatMap((d) => d.pages.map((p) => ({
      text: p.text,
      start: p.start,
      end: p.end,
      reveal: Math.min(p.end - p.start, REVEAL_SEC_PER_WORD * p.text.split(/\s+/).filter(Boolean).length),
      holdUntil: p.end,
    })));
    const built = studioEngine({
      assPath: path.join(workDir, "captions.ass"),
      lines,
      w: width,
      h: height,
      look: project.captionPreset,
      energy: resolveEnergy(project.captionEnergy, "calm"),
      seed: studioSeed(project),
    });
    if (!built.filter) return null;
    // A fixed name: the AMF attempt and its CPU retry rewrite the same file.
    for (const f of built.sideFiles) fs.writeFileSync(f.path, f.text, "utf8");

    // Safe area: 9:16 platforms cover the bottom 18% with their own chrome.
    const { size } = plan.metrics;
    const refSize = Math.round(size * STUDIO_REFERENCE_SCALE);
    const refY = Math.round(height * (height > width ? 0.82 : CAPTION_BOTTOM) - refSize);
    const style = drawtextStyle(size);
    const references = plan.drops
      .filter((d) => d.reference)
      .map((d) => drawtextLine({
        file: path.join(workDir, `reference-${d.i}.txt`),
        text: d.reference, fontSize: refSize, y: refY, win: d.win, colour: "white@0.88", style,
      }));
    return [built.filter, ...references].join(",");
  } catch (err) {
    // An engine or file error must never fail a render: the serif captions
    // take over, exactly as they draw without a Studio look.
    console.warn(`[CAPTIONS] studio fallback: ${err?.message || err}`);
    return null;
  }
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
export function buildAmbientFfmpegArgs(project, { bedPath, images, drops, outPath, workDir, encoder = "cpu", logo = null }) {
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
      // fps first: the looped still arrives at the image demuxer's 25, and
      // the drift counts frames, so at 25 it would breathe fast.
      chain.push(`fps=${FPS}`, driftFilter({ fps: FPS }), "setsar=1");
    } else {
      chain.push("setsar=1", `fps=${FPS}`);
    }
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
    // A Studio look draws with libass, on pages cut for the engine; everything
    // else, and any Studio failure, is today's serif drawtext on its own pages.
    const studio = isStudioLook(project.captionPreset) && hasLibass()
      ? studioFilters({
        project, plan: captionPlan({ project, voiced, movements, width, height, pageChars: STUDIO_PAGE_CHARS }), width, height, workDir,
      })
      : null;
    const drawn = studio
      ? [studio]
      : captionFilters({ project, plan: captionPlan({ project, voiced, movements, width, height }), width, height, workDir });
    if (drawn.length > 0) {
      parts.push(`${captionIn}${drawn.join(",")}[vout]`);
      captionIn = "[vout]";
    }
  }
  // The account's logo (brandLogoFor) goes over everything, captions included.
  if (logo) {
    parts.push(logoOverlay(logo, { w: width, h: height, from: captionIn.slice(1, -1), to: "vlogo" }));
    captionIn = "[vlogo]";
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
    ...videoCodecArgs(encoder), "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    "-t", String(targetSec),
    outPath,
  );

  const { args: scripted, scriptFile } = toFilterScriptArgs(args, outPath);
  return { args: scripted, filter, scriptFile };
}
