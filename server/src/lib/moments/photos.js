import fs from "node:fs";
import path from "node:path";
import { resolveOwnUpload, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_IMAGE_PIXELS } from "../ambient/movementImage.js";
import { sniffImage, imageHeaderSize, UNDECODABLE_IMAGE_ERROR } from "../imageSniff.js";
import { readLibrary } from "../imageGen/imageLibrary.js";
import { resolveTrackFile } from "../ambient/stages.js";

/**
 * A Moment's photos are refs, never paths: an own upload (by file NAME,
 * resolved only inside the user's outputs) or an item in the user's own
 * image library. Every check a render needs happens here, from the file's
 * header, so a bad photo is caught when it is added, not an hour into a render.
 */
const NOT_FOUND = "that photo was not found. Try adding it again.";

function fileFor(ctx, ref, items) {
  if (ref?.kind === "upload") {
    const file = resolveOwnUpload(ctx.outputDir, ref.path);
    return file ? { file, url: `/outputs/${path.basename(file)}` } : null;
  }
  if (ref?.kind === "library") {
    const entry = (items || []).find((it) => it?.id === String(ref.id || ""));
    if (!entry?.path || !fs.existsSync(entry.path)) return null;
    return { file: entry.path, url: entry.publicUrl || `/outputs/${path.basename(entry.path)}` };
  }
  return null;
}

export function resolvePhoto(ctx, ref, { items } = {}) {
  const lib = items ?? readLibrary(ctx.dataDir).items;
  const found = fileFor(ctx, ref, lib);
  if (!found) return { ok: false, error: NOT_FOUND };
  let bytes;
  try { bytes = fs.statSync(found.file).size; } catch { return { ok: false, error: NOT_FOUND }; }
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: "That photo is over 25 MB. Use a smaller copy." };
  const kind = sniffImage(found.file);
  if (!kind) return { ok: false, error: UNDECODABLE_IMAGE_ERROR };
  const size = imageHeaderSize(found.file, kind);
  if (!size || !(size.w >= 1) || !(size.h >= 1)) return { ok: false, error: UNDECODABLE_IMAGE_ERROR };
  if (size.animated) return { ok: false, error: "That's an animated picture. Use a still JPG or PNG." };
  if (size.w > MAX_IMAGE_SIDE || size.h > MAX_IMAGE_SIDE || size.w * size.h > MAX_IMAGE_PIXELS) {
    return { ok: false, error: `That picture is ${size.w}×${size.h}, too large for a video.` };
  }
  return { ok: true, file: found.file, url: found.url, width: size.w, height: size.h };
}

export function resolvePhotos(ctx, refs) {
  const items = readLibrary(ctx.dataDir).items;
  const photos = [];
  for (let i = 0; i < refs.length; i += 1) {
    const r = resolvePhoto(ctx, refs[i], { items });
    if (!r.ok) return { ok: false, error: `Photo ${i + 1}: ${r.error}` };
    const ref = refs[i].kind === "upload" ? { kind: "upload", path: path.basename(r.file) } : { kind: "library", id: String(refs[i].id) };
    photos.push({ ref, url: r.url, width: r.width, height: r.height });
  }
  return { ok: true, photos };
}

/** The song's file: a bundled track, the user's own library, or their own upload. */
export function resolveSong(ctx, ref) {
  return resolveTrackFile(ctx, ref) || null;
}
