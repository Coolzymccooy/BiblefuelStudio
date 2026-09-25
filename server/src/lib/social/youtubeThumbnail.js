import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { escapeFontPath, fontFileFor } from "../videoFilters.js";
import { balanceLines } from "../ambient/captionPages.js";

/**
 * Make any picture a YouTube-ready thumbnail: 1280x720 JPEG under 2 MB,
 * cropped to fill (never letterboxed), optionally with the video's title.
 *
 * YouTube refuses thumbnails over 2 MB, and a phone photo or a generated
 * PNG is often bigger, so the upload succeeded while its thumbnail failed.
 *
 * Prod runs ffmpeg 5.1: only long-standing filters here (scale, crop, geq,
 * drawtext), and the title goes through textfiles, never argv.
 */

export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const W = 1280;
const H = 720;
const TITLE_MAX_SIZE = 84;
const TITLE_GLYPH_WIDTH = 0.5;
const TAGLINE_MAX_SIZE = 30;
const TAGLINE_MAX_CHARS = 48;
const TAGLINE_COLOUR = "0xF1D9A0";
const RULE_WIDTH = 120;
/** 40 MP: any real photo; refuses a tiny file that declares a vast canvas. */
const MAX_SOURCE_PIXELS = 40_000_000;
/** One still takes well under a second; this is a stuck or hostile input. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @param {string} src
 * @param {string} out
 * @param {{ titleFiles?: string[], fontSize?: number, quality?: number }} [opts]
 * @returns {{ args: string[] }}
 */
export function buildThumbnailArgs(src, out, {
  titleFiles = [], fontSize = TITLE_MAX_SIZE, quality = 2, taglineFile = null, taglineSize = TAGLINE_MAX_SIZE, inputCodec = null,
} = {}) {
  const steps = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
  ];
  if (titleFiles.length || taglineFile) {
    // Darken the lower part smoothly so the title reads at phone-grid size
    // over any picture; the top of the picture is untouched.
    const shade = "(1-0.5*clip((Y/H-0.4)/0.6,0,1))";
    steps.push("format=rgb24", `geq=r='r(X,Y)*${shade}':g='g(X,Y)*${shade}':b='b(X,Y)*${shade}'`);
    const fontPath = fontFileFor({ fontFamily: "serif" });
    const fontArg = fontPath ? `:fontfile='${escapeFontPath(fontPath)}'` : "";
    const lineHeight = Math.round(fontSize * 1.2);
    const top = Math.round(H * 0.9 - titleFiles.length * lineHeight);
    titleFiles.forEach((file, i) => {
      steps.push(
        // expansion=none: a title is text. With it on, "100% Faith" drew
        // nothing and "%{localtime}" printed the server's clock.
        `drawtext=textfile='${escapeFontPath(file)}'${fontArg}:expansion=none:fontcolor=white:fontsize=${fontSize}:` +
        `shadowcolor=black@0.6:shadowx=0:shadowy=3:borderw=2:bordercolor=black@0.35:` +
        `x=(w-text_w)/2:y=${top + i * lineHeight}`,
      );
    });
    if (taglineFile) {
      // A small spaced-out line above the title with a short gold rule
      // between them: what makes a still read as a poster, not a screenshot.
      const posterPath = fontFileFor({ fontFamily: "poster" });
      const posterArg = posterPath ? `:fontfile='${escapeFontPath(posterPath)}'` : "";
      const ruleY = titleFiles.length ? top - 22 : Math.round(H * 0.9);
      steps.push(
        `drawbox=x=${(W - RULE_WIDTH) / 2}:y=${ruleY}:w=${RULE_WIDTH}:h=3:color=${TAGLINE_COLOUR}@0.9:t=fill`,
        `drawtext=textfile='${escapeFontPath(taglineFile)}'${posterArg}:expansion=none:fontcolor=${TAGLINE_COLOUR}:fontsize=${taglineSize}:` +
        `shadowcolor=black@0.6:shadowx=0:shadowy=2:x=(w-text_w)/2:y=${ruleY - 18 - taglineSize}`,
      );
    }
  }
  return {
    // Read as exactly one still: image2 with no %d patterns, and a pixel cap
    // checked before the whole canvas is decoded into memory.
    args: [
      "-hide_banner", "-loglevel", "error", "-y",
      "-max_pixels", String(MAX_SOURCE_PIXELS), "-f", "image2", "-pattern_type", "none",
      // image2 picks its decoder from the file NAME. Generated pictures are
      // JPEG bytes saved as .png, so name the real one when it is known.
      ...(inputCodec ? ["-c:v", inputCodec] : []),
      "-i", src,
      "-vf", steps.join(","), "-frames:v", "1", "-q:v", String(quality), out,
    ],
  };
}

/**
 * The decoder a picture actually needs, from its first bytes; null when it
 * isn't a format we recognise (ffmpeg then goes by the name, as before).
 * @param {string} file
 * @returns {"mjpeg"|"png"|"webp"|"gif"|null}
 */
export function sniffImageCodec(file) {
  let head;
  try {
    const fd = fs.openSync(file, "r");
    try {
      head = Buffer.alloc(12);
      fs.readSync(fd, head, 0, 12, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "mjpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (head.toString("latin1", 0, 4) === "GIF8") return "gif";
  return null;
}

/**
 * The tagline as drawn: capitals, letters spaced apart, words further apart.
 * Too long a line is cut at a word, so the poster never runs off the edge.
 */
export function posterTagline(text) {
  let clean = drawableTitle(text).toUpperCase();
  if (clean.length > TAGLINE_MAX_CHARS) {
    const cut = clean.slice(0, TAGLINE_MAX_CHARS);
    clean = (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).replace(/[\s·|,-]+$/u, "");
  }
  return clean.split(" ").filter(Boolean).map((word) => [...word].join(" ")).join("   ");
}

/**
 * The title as the caption face can draw it. Emoji aren't in the font and
 * came out as missing-glyph boxes, so they're left off the picture (the
 * video's own title keeps them).
 */
export function drawableTitle(title) {
  return String(title || "")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const proc = spawn(ff, args, { windowsHide: true });
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* gone */ } resolve(false); }, timeoutMs);
    proc.on("error", () => { clearTimeout(timer); resolve(false); });
    proc.on("close", (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

/**
 * The prepared thumbnail's path (the caller deletes it), or null when the
 * source can't be read as a picture — the caller then sends the original and
 * YouTube's own answer is reported, as before.
 *
 * @param {string} src
 * @param {{ workDir: string, title?: string|null, tagline?: string|null, timeoutMs?: number }} opts
 */
export async function prepareThumbnail(src, { workDir, title = null, tagline = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const id = crypto.randomBytes(6).toString("hex");
  const out = path.join(workDir, `yt-thumb-${id}.jpg`);
  const titleFiles = [];
  let taglineFile = null;
  let keep = false;
  try {
    let fontSize = TITLE_MAX_SIZE;
    const text = drawableTitle(title);
    if (text) {
      const lines = balanceLines(text, 32);
      const longest = Math.max(...lines.map((l) => l.length));
      fontSize = Math.min(TITLE_MAX_SIZE, Math.floor((W * 0.88) / (longest * TITLE_GLYPH_WIDTH)));
      lines.forEach((line, i) => {
        const file = path.join(workDir, `yt-thumb-${id}-${i}.txt`);
        titleFiles.push(file);
        fs.writeFileSync(file, line, "utf8");
      });
    }
    const spaced = posterTagline(tagline);
    let taglineSize = TAGLINE_MAX_SIZE;
    if (spaced) {
      // Anton is condensed: about 0.45 of its size per glyph, spaces included.
      taglineSize = Math.min(TAGLINE_MAX_SIZE, Math.floor((W * 0.8) / (spaced.length * 0.45)));
      taglineFile = path.join(workDir, `yt-thumb-${id}-tagline.txt`);
      fs.writeFileSync(taglineFile, spaced, "utf8");
    }
    const inputCodec = sniffImageCodec(src);
    // Best quality first; step down only if the picture is too busy for 2 MB.
    for (const quality of [2, 5, 9]) {
      const ok = await run(buildThumbnailArgs(src, out, { titleFiles, fontSize, quality, taglineFile, taglineSize, inputCodec }).args, timeoutMs);
      if (!ok) return null;
      if (fs.statSync(out).size <= THUMBNAIL_MAX_BYTES) { keep = true; return out; }
    }
    keep = true;
    return out;
  } catch {
    return null;
  } finally {
    for (const f of titleFiles) fs.rmSync(f, { force: true });
    if (taglineFile) fs.rmSync(taglineFile, { force: true });
    // Anything but a returned thumbnail is ours to clean up, including a
    // first pass whose smaller retry then failed.
    if (!keep) fs.rmSync(out, { force: true });
  }
}
