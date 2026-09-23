import fs from "fs";
import path from "path";

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

export const UNDECODABLE_IMAGE_ERROR =
  "That photo's format can't be used in a video. Save it as JPG or PNG and upload it again " +
  "(on iPhone: Settings → Camera → Formats → Most Compatible).";

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
 * @returns {string|null}
 */
export function resolveOwnUpload(outputDir, raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || !outputDir) return null;
  const name = s.split(/[\\/]/).pop();
  if (!UPLOAD_NAME.test(name)) return null;
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

/**
 * What the file's first bytes say it is. The upload route names an unknown
 * image/* type ".jpg" — an iPhone HEIC included — so the name proves nothing.
 *
 * @param {string} file
 * @returns {"png"|"jpeg"|"webp"|null}
 */
export function sniffImage(file) {
  const head = Buffer.alloc(12);
  let fd;
  try {
    fd = fs.openSync(file, "r");
    fs.readSync(fd, head, 0, head.length, 0);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (head[0] === 0x89 && head.toString("ascii", 1, 4) === "PNG") return "png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
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
