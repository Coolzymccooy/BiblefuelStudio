import fs from "fs";
import { spawn } from "child_process";

/**
 * Output frame and per-scene framing for Story renders.
 *
 * A Story video has one output frame (portrait, landscape or square, the same
 * three the Render tab offers). Each scene's picture is then either:
 *   - "cover": scaled to fill the frame and centre-cropped. Right for pictures
 *     already (nearly) the frame's shape, such as generated scene images.
 *   - "contain": shown whole, over a blurred copy of itself filling the frame.
 *     Right for a picture of another shape, typically an uploaded landscape
 *     clip in a portrait video, where a crop throws away most of the picture.
 *
 * The choice is made by measuring the media, not by where it came from, so
 * clips uploaded before this existed are framed correctly without re-upload.
 */

export const FIT_COVER = "cover";
export const FIT_CONTAIN = "contain";

const ASPECTS = new Set(["portrait", "landscape", "square"]);

/** One of portrait | landscape | square; anything else is portrait. */
export function normalizeStoryAspect(aspect) {
  return ASPECTS.has(aspect) ? aspect : "portrait";
}

const envSize = (value, fallback) => Math.max(240, Number(value) || fallback);

/**
 * Render size for an output frame. Each frame keeps its own env override, so
 * tuning one never changes the others. Portrait stays 720x1280 by default: a
 * long kinetic render at 1080x1920 stalls a modest CPU box.
 */
export function storyFrameSize(aspect, env = process.env) {
  switch (normalizeStoryAspect(aspect)) {
    case "landscape":
      return {
        width: envSize(env.STORY_RENDER_LANDSCAPE_WIDTH, 1280),
        height: envSize(env.STORY_RENDER_LANDSCAPE_HEIGHT, 720),
      };
    case "square": {
      const side = envSize(env.STORY_RENDER_SQUARE_SIZE, 1080);
      return { width: side, height: side };
    }
    default:
      return {
        width: envSize(env.STORY_RENDER_WIDTH, 720),
        height: envSize(env.STORY_RENDER_HEIGHT, 1280),
      };
  }
}

/**
 * How far a picture's shape may differ from the frame's before it is shown
 * whole instead of cropped.
 *
 * Your own media (an upload, a picture you picked) is held tightly: 15% keeps
 * near-matches (a 1080x1920 image in a 720x1280 frame) on the full-bleed fill,
 * and anything further off is shown whole, because you chose that picture.
 *
 * A generated image keeps the full-bleed fill it always had unless a crop would
 * lose about half of it. A provider that ignores the requested size returns a
 * square, which in 9:16 is a ratio of 1.78 and was always cropped; a portrait
 * image left in a project switched to landscape (3.16) is shown whole.
 */
const OWN_MEDIA_TOLERANCE = 0.15;
const GENERATED_TOLERANCE = 0.8;

export function chooseSceneFit({ mediaWidth, mediaHeight, frameWidth, frameHeight, generated = false }) {
  const mw = Number(mediaWidth);
  const mh = Number(mediaHeight);
  if (!(mw > 0 && mh > 0 && frameWidth > 0 && frameHeight > 0)) return FIT_COVER;
  const ratio = (mw / mh) / (frameWidth / frameHeight);
  const tolerance = generated ? GENERATED_TOLERANCE : OWN_MEDIA_TOLERANCE;
  return Math.abs(Math.log(ratio)) <= Math.log(1 + tolerance) ? FIT_COVER : FIT_CONTAIN;
}

/**
 * Display size from `ffprobe -show_streams -of json` output: the stored
 * width scaled by the sample aspect ratio, then, for a phone clip stored
 * landscape with a 90/270 degree rotation, the sides swapped, since it plays
 * portrait. Returns null for anything unreadable.
 */
export function parseProbeSize(json) {
  let stream;
  try {
    stream = JSON.parse(json)?.streams?.[0];
  } catch {
    return null;
  }
  const stored = Number(stream?.width);
  const height = Number(stream?.height);
  if (!(stored > 0 && height > 0)) return null;
  // Anamorphic video stores non-square pixels: 1440x1080 at 4:3 plays as
  // 1920x1080. "0:1" (unknown) and "1:1" leave the width as stored.
  const [sarNum, sarDen] = String(stream.sample_aspect_ratio || "").split(":").map(Number);
  const sar = sarNum > 0 && sarDen > 0 ? sarNum / sarDen : 1;
  const width = Math.round(stored * sar);
  const sideRotation = (stream.side_data_list || []).find((d) => d && d.rotation !== undefined)?.rotation;
  const rotation = Number(sideRotation ?? stream.tags?.rotate ?? 0);
  const quarterTurn = Math.abs(rotation) % 180 === 90;
  return quarterTurn ? { width: height, height: width } : { width, height };
}

/** Display size of an image or video's first video stream, or null. Never rejects. */
export function probeMediaSize(filePath, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    let proc;
    try {
      proc = spawn(ffprobe, [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,sample_aspect_ratio:stream_tags=rotate:stream_side_data=rotation",
        "-of", "json", filePath,
      ]);
    } catch {
      resolve(null);
      return;
    }
    let out = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      finish(null);
    }, timeoutMs);
    if (timer.unref) timer.unref();
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("error", () => finish(null));
    proc.on("close", () => finish(parseProbeSize(out)));
  });
}

// The picture a scene actually shows: its own clip when that is still on disk
// (the renderer plays it), otherwise the still.
function sceneMediaPath(scene) {
  if (typeof scene.videoPath === "string" && scene.videoPath !== "" && fs.existsSync(scene.videoPath)) {
    return scene.videoPath;
  }
  return scene.imagePath;
}

// A generated still (not a clip of your own, which is always your media).
function isGeneratedStill(scene) {
  const playsClip = typeof scene.videoPath === "string" && scene.videoPath !== "";
  return !playsClip && scene.imageSource === "generated";
}

// At most this many ffprobes run at once: a long story with many distinct
// pictures would otherwise start one process per picture in a single burst.
const PROBE_CONCURRENCY = 6;

/**
 * New scenes, each with `fit` set from its own media's shape against the
 * frame. Each distinct file is measured once (a long-form beat cut repeats the
 * same images many times), a few at a time. A media file that cannot be
 * measured keeps the cover fill, so framing can never fail a render; that is
 * logged, since it brings back the crop for that scene.
 */
export async function withSceneFits(scenes, { width, height, probe = probeMediaSize }) {
  const files = [...new Set(scenes.map(sceneMediaPath).filter(Boolean))];
  const sizes = new Map();
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const file = files[next];
      next += 1;
      let size = null;
      try { size = await probe(file); } catch { size = null; }
      if (!size) console.warn(`[story] could not measure ${file}; its scene is cropped to fill`);
      sizes.set(file, size);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, files.length) }, worker));
  return scenes.map((scene) => {
    const size = sizes.get(sceneMediaPath(scene));
    const fit = chooseSceneFit({
      mediaWidth: size?.width, mediaHeight: size?.height, frameWidth: width, frameHeight: height,
      generated: isGeneratedStill(scene),
    });
    return { ...scene, fit };
  });
}
