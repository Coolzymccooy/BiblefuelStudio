import fs from "fs";

/**
 * What an image file really is, from its first bytes.
 *
 * Shared by every door a picture comes in through. A name or a mime proves
 * nothing: an iPhone HEIC once arrived as image/* and was saved as ".jpg",
 * prod's ffmpeg 5.1 cannot decode HEIC, and the render that trusted the name
 * died an hour in.
 */

export const UNDECODABLE_IMAGE_ERROR =
  "That photo's format can't be used in a video. Save it as JPG or PNG and upload it again " +
  "(on iPhone: Settings → Camera → Formats → Most Compatible).";

/**
 * What the file's first bytes say it is: the only formats accepted anywhere.
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
