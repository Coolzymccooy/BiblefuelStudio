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

function readAt(fd, pos, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, pos);
  return n === length ? buf : null;
}

function jpegSize(fd, fileSize) {
  let pos = 2;
  for (let guard = 0; guard < 10_000 && pos + 4 <= fileSize; guard += 1) {
    const head = readAt(fd, pos, 4);
    if (!head || head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) { pos += 1; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { pos += 2; continue; } // no length
    // Start of frame: every SOFn except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const sof = readAt(fd, pos + 5, 4);
      return sof ? { w: sof.readUInt16BE(2), h: sof.readUInt16BE(0) } : null;
    }
    pos += 2 + head.readUInt16BE(2);
  }
  return null;
}

function webpSize(fd) {
  const head = readAt(fd, 12, 18);
  if (!head) return null;
  const chunk = head.toString("ascii", 0, 4);
  if (chunk === "VP8X") {
    const animated = (head[8] & 0x02) !== 0;
    return { w: head.readUIntLE(12, 3) + 1, h: head.readUIntLE(15, 3) + 1, animated };
  }
  if (chunk === "VP8 ") {
    if (head[11] !== 0x9d || head[12] !== 0x01 || head[13] !== 0x2a) return null;
    return { w: head.readUInt16LE(14) & 0x3fff, h: head.readUInt16LE(16) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (head[8] !== 0x2f) return null;
    const bits = head.readUInt32LE(9);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * The picture's width and height as its header declares them, without
 * decoding a pixel (even ffprobe decodes the whole picture to say). A WebP
 * also says whether it is animated. Null when the header can't be read.
 *
 * @param {string} file
 * @param {"png"|"jpeg"|"webp"} kind from sniffImage
 * @returns {{ w: number, h: number, animated?: boolean } | null}
 */
export function imageHeaderSize(file, kind) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    if (kind === "png") {
      const ihdr = readAt(fd, 12, 12);
      if (!ihdr || ihdr.toString("ascii", 0, 4) !== "IHDR") return null;
      return { w: ihdr.readUInt32BE(4), h: ihdr.readUInt32BE(8) };
    }
    if (kind === "jpeg") return jpegSize(fd, fs.fstatSync(fd).size);
    if (kind === "webp") return webpSize(fd);
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
