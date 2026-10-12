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

const ROTATE = { 2: "hflip", 3: "hflip,vflip", 4: "vflip", 5: "transpose=0", 6: "transpose=1", 7: "transpose=3", 8: "transpose=2" };

function readExifOrientation(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let pos = 2;
  while (pos + 4 <= buf.length && buf[pos] === 0xff) {
    const marker = buf[pos + 1];
    const len = buf.readUInt16BE(pos + 2);
    if (marker === 0xe1 && buf.toString("binary", pos + 4, pos + 10) === "Exif\0\0") {
      const t = pos + 10;
      const le = buf.toString("ascii", t, t + 2) === "II";
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      const entries = u16(ifd);
      for (let k = 0; k < entries; k += 1) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda) return 1; // image data: no EXIF before it
    pos += 2 + len;
  }
  return 1;
}

/**
 * JPEG EXIF orientation (1..8); 1 for any other file or any read problem.
 * Input is untrusted: out-of-range reads throw inside readExifOrientation and
 * are caught here, and non-regular files (directories, FIFOs) are refused
 * before open so a pipe upload cannot block the read.
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

/** ffmpeg args that write the upright working image for one photo. */
export function workImageArgs({ src, out, width, height, orientation }) {
  const rotate = ROTATE[orientation] || "";
  const swaps = orientation >= 5 && orientation <= 8;
  const w = swaps ? height : width;
  const h = swaps ? width : height;
  const shape = w > h ? "wide" : "tall";
  const fit = shape === "tall"
    ? `scale=${WORK.tallW}:${WORK.tallH}:force_original_aspect_ratio=increase,crop=${WORK.tallW}:${WORK.tallH}:(iw-ow)/2:(ih-oh)*0.38,setsar=1`
    : `scale=-2:${WORK.wideH},setsar=1`;
  const vf = rotate ? `${rotate},${fit}` : fit;
  return {
    shape,
    args: ["-hide_banner", "-v", "error", "-y", "-noautorotate", "-i", src, "-vf", vf, "-frames:v", "1", "-q:v", "2", out],
  };
}
