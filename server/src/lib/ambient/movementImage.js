import fs from "fs";
import path from "path";
import { sniffImage, imageHeaderSize, UNDECODABLE_IMAGE_ERROR } from "../imageSniff.js";

export { sniffImage, UNDECODABLE_IMAGE_ERROR };

/**
 * Putting a picture of your own on a movement, instead of a generated one.
 *
 * Two sources, and neither lets the client name an arbitrary server path:
 *   - an upload: the path POST /api/media/upload-background returned. It must
 *     be a file that route produced — flat in THIS tenant's outputs, named
 *     bg-image-<uuid>.<ext> — and its bytes must really be an image ffmpeg
 *     5.1 decodes.
 *   - a library entry, by id. The path comes from the tenant's own index.
 *
 * Either way the movement ends up pointing at the flat image-library pool, the
 * same place generated stills live, so it is served, reused and pruned by the
 * code that already handles those.
 */

const UPLOAD_NAME = /^bg-image-[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;

/** Checked before the file is read: registerImage loads it whole to hash it. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * The real path of an upload this tenant made, or null.
 *
 * Only the file NAME is taken from the client; the folder is always this
 * tenant's outputs. The client's string is never opened as a path, so a `..`,
 * another tenant's folder, or a UNC share (an outbound SMB connection on a
 * Windows host) cannot even be attempted. realpath then confirms the name
 * is not a link that leads back out.
 *
 * @param {string} outputDir the tenant's outputs folder (req.ctx.outputDir)
 * @param {unknown} raw client-supplied path, as the upload route returned it
 * @param {RegExp} [namePattern] the upload names allowed; images by default
 * @returns {string|null}
 */
export function resolveOwnUpload(outputDir, raw, namePattern = UPLOAD_NAME) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || !outputDir) return null;
  const name = s.split(/[\\/]/).pop();
  if (!namePattern.test(name)) return null;
  let jail;
  let resolved;
  try {
    jail = fs.realpathSync(outputDir);
    resolved = fs.realpathSync(path.join(jail, name));
  } catch {
    return null;
  }
  return path.relative(jail, resolved) === name ? resolved : null;
}

/** Larger than any phone camera or AI image; a render decodes every one whole. */
export const MAX_IMAGE_SIDE = 8192;
export const MAX_IMAGE_PIXELS = 40_000_000;

/**
 * Refuse a picture a render can't use or would choke on. A small file can
 * declare a huge canvas, and a render decodes each scene's picture whole,
 * so 30 of those could take the server's memory with them. The size comes
 * from the file's header: even ffprobe decodes the picture to report it.
 */
async function checkImageShape(file, kind) {
  const size = imageHeaderSize(file, kind);
  if (size?.animated) {
    return { ok: false, error: "That's an animated picture. Use a still JPG or PNG." };
  }
  if (!size) return { ok: false, error: UNDECODABLE_IMAGE_ERROR };
  if (size.w > MAX_IMAGE_SIDE || size.h > MAX_IMAGE_SIDE || size.w * size.h > MAX_IMAGE_PIXELS) {
    return { ok: false, error: `That picture is ${size.w}×${size.h}, too large for a video. Use one under ${MAX_IMAGE_SIDE} pixels a side.` };
  }
  return { ok: true };
}

/**
 * The client's view of the library: ids and URLs, never server paths.
 *
 * @param {Array<object>} items entries from readLibrary(dataDir).items
 */
export function libraryImageView(items) {
  return [...(items || [])]
    .filter((it) => it?.id && it?.publicUrl)
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .map((it) => ({
      id: it.id,
      url: it.publicUrl,
      aspect: it.aspect || "",
      source: it.provider === "upload" ? "upload" : "generated",
      createdAt: Number(it.createdAt) || 0,
    }));
}

/**
 * Resolve the body of PUT /:id/movements/:movementId/image to a library entry.
 *
 * @param {{ dataDir: string, outputDir: string, project: object, body: object,
 *           items: Array<object>, register: Function }} args
 * @returns {Promise<{ ok: true, entry: object, source: "upload"|"library" }
 *                  | { ok: false, status: number, error: string }>}
 */
export async function resolveMovementImage({ dataDir, outputDir, project, body, items, register }) {
  if (body?.libraryId) {
    const entry = (items || []).find((it) => it?.id === String(body.libraryId));
    if (!entry || !entry.path || !fs.existsSync(entry.path)) {
      return { ok: false, status: 400, error: "that image is no longer in your library" };
    }
    return { ok: true, entry, source: "library" };
  }

  const file = resolveOwnUpload(outputDir, body?.uploadPath);
  if (!file) return { ok: false, status: 400, error: "that upload was not found — try uploading it again" };
  if (fs.statSync(file).size > MAX_IMAGE_BYTES) {
    return { ok: false, status: 400, error: "That photo is over 25 MB. Use a smaller copy — a phone's standard size is plenty for video." };
  }
  const kind = sniffImage(file);
  if (!kind) return { ok: false, status: 400, error: UNDECODABLE_IMAGE_ERROR };
  const shape = await checkImageShape(file, kind);
  if (!shape.ok) return { ok: false, status: 400, error: shape.error };

  // No prompt on purpose: no embedding and no categories means the reuse
  // matcher never substitutes your photo into a scene on its own. It is only
  // ever there when you choose it.
  const entry = await register({
    dataDir, outputDir, sourcePath: file, prompt: "", style: "",
    aspect: project.aspect === "portrait" ? "portrait" : "landscape",
    provider: "upload", projectId: project.projectId,
    ext: kind === "jpeg" ? "jpg" : kind,
  });
  if (!entry?.path) return { ok: false, status: 500, error: "could not save that image" };
  return { ok: true, entry, source: "upload" };
}
