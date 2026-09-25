import { spawnSync } from "child_process";

/**
 * Video encoders an Ambient render can use. "amf" is the AMD graphics chip's
 * H.264 encoder: several times faster than x264 on a laptop and it leaves the
 * CPU free, at slightly lower quality for the size. Values are initial
 * settings to confirm in the first real run (docs/vocal-removal.md,
 * "Measured on this laptop").
 */
export const ENCODERS = Object.freeze(["cpu", "amf"]);

export function videoCodecArgs(encoder) {
  if (encoder === "amf") {
    return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "22", "-qp_p", "24"];
  }
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"];
}

function realProbe() {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const r = spawnSync(ff, ["-hide_banner", "-encoders"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return String(r.stdout || "");
}
let _probe = realProbe;
let cached = null;
export function _setEncodersProbe(fn) { _probe = fn; cached = null; }
export function _resetEncodersProbe() { _probe = realProbe; cached = null; }

/** Whether this machine's ffmpeg has the AMD encoder. Probed once. */
export function amfAvailable() {
  if (cached === null) {
    try { cached = /\bh264_amf\b/.test(_probe()); } catch { cached = false; }
  }
  return cached;
}
