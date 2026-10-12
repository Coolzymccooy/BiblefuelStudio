import fs from "node:fs";

/**
 * Photos become working images before any shot renders: upright, and sized
 * so zoompan has 2x the output to work with (smooth zooms). Tall photos are
 * cover-cropped to 9:16 around the upper middle, where faces usually are;
 * wide ones keep their shape for the pan and split moves.
 *
 * Rotation is done here from the EXIF tag, with -noautorotate on the input:
 * ffmpeg 8 auto-rotates JPEGs and 5.1 (prod) does not, so relying on either
 * would make dev and prod disagree.
 */
export const WORK = Object.freeze({ tallW: 2160, tallH: 3840, wideH: 2160 });

/** Wide working images are capped at 4:1 (8640 wide at height 2160). */
const PANORAMA_MAX_RATIO = 4;
const PANORAMA_MAX_W = WORK.wideH * PANORAMA_MAX_RATIO;

const ROTATE = { 2: "hflip", 3: "hflip,vflip", 4: "vflip", 5: "transpose=0", 6: "transpose=1", 7: "transpose=3", 8: "transpose=2" };

/**
 * Orientation from the TIFF block at buf[t..limit). Every read is bounds
 * checked against `limit`, so hostile offsets or counts return 1 instead of
 * reading past the segment.
 */
function tiffOrientation(buf, t, limit) {
  if (t + 8 > limit) return 1;
  const order = buf.toString("ascii", t, t + 2);
  if (order !== "II" && order !== "MM") return 1;
  const le = order === "II";
  const u16 = (o) => (o + 2 <= limit ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : -1);
  const u32 = (o) => (o + 4 <= limit ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : -1);
  const ifdOffset = u32(t + 4);
  if (ifdOffset < 0) return 1;
  const ifd = t + ifdOffset;
  const count = u16(ifd);
  if (count < 0) return 1;
  for (let k = 0; k < count; k += 1) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > limit) return 1;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/**
 * Walks the JPEG segments before the image data looking for APP1 Exif.
 * Malformed lengths, a segment that runs past the bytes read, or SOS (the
 * image data) all stop the walk with 1.
 */
function readExifOrientation(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return 1;
    let m = pos + 1;
    while (m < buf.length && buf[m] === 0xff) m += 1; // fill bytes may precede a marker
    if (m + 3 > buf.length) return 1;
    const marker = buf[m];
    if (marker === 0xda) return 1; // image data: no EXIF after this point
    const len = buf.readUInt16BE(m + 1);
    if (len < 2) return 1;
    const end = m + 1 + len;
    const body = m + 3;
    if (marker === 0xe1 && end <= buf.length && buf.toString("binary", body, body + 6) === "Exif\0\0") {
      return tiffOrientation(buf, body + 6, end);
    }
    pos = end;
  }
  return 1;
}

/**
 * JPEG EXIF orientation (1..8); 1 for any other file or any read problem.
 * Input is untrusted: non-regular files (directories, FIFOs) are refused
 * before open so a pipe upload cannot block the read, and any remaining
 * failure falls through to 1.
 */
export function orientationOf(file) {
  try {
    if (!fs.statSync(file).isFile()) return 1;
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(128 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      return readExifOrientation(buf.subarray(0, n));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 1;
  }
}

/**
 * ffmpeg args that write the upright working image for one photo.
 * `width` and `height` are the STORED dimensions as ffprobe reports them, before any rotation.
 */
export function workImageArgs({ src, out, width, height, orientation }) {
  const rotate = ROTATE[orientation] || "";
  const swaps = orientation >= 5 && orientation <= 8;
  const w = swaps ? height : width;
  const h = swaps ? width : height;
  const shape = w > h ? "wide" : "tall";
  const panoramaCap = w > PANORAMA_MAX_RATIO * h ? `,crop='min(iw,${PANORAMA_MAX_W})':ih` : "";
  const fit = shape === "tall"
    ? `scale=${WORK.tallW}:${WORK.tallH}:force_original_aspect_ratio=increase,crop=${WORK.tallW}:${WORK.tallH}:(iw-ow)/2:(ih-oh)*0.38,setsar=1`
    : `scale=-2:${WORK.wideH}${panoramaCap},setsar=1`;
  const vf = rotate ? `${rotate},${fit}` : fit;
  return {
    shape,
    args: ["-hide_banner", "-v", "error", "-y", "-noautorotate", "-i", src, "-vf", vf, "-frames:v", "1", "-q:v", "2", out],
  };
}
