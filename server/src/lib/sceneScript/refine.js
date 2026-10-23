/**
 * Free refine for a shot: which part of the clip plays, how fast, mirrored
 * or not, how it is framed, and its colour grade. Stored on the shot and
 * applied in the render; the clip file is never changed, so one library clip
 * can serve many videos differently. Shared by the server and the Remotion
 * composition, so keep it free of Node-only imports.
 */

export const XFADE_SEC = 0.45; // seconds of cross-dissolve between shots

export const RATE_MIN = 0.5;
export const RATE_MAX = 2;
export const ZOOM_MAX = 2;
const MIN_PLAY_SEC = 0.5;
// An out point this close to the clip's end is the end (a slider snaps to its step, not the exact length).
const END_SNAP_SEC = 0.1;
const MAX_CLIP_SEC = 60;
// Stop this far before the clip's end: the last frames of a download can be missing.
const END_GUARD_SEC = 0.08;

/** CSS filters for each grade. The client's preview keeps a twin of this map (sceneScript/refine.ts). */
export const GRADES = Object.freeze({
  none: "",
  warm: "sepia(0.22) saturate(1.12) hue-rotate(-6deg)",
  cool: "saturate(0.92) hue-rotate(12deg) brightness(1.03)",
  golden: "sepia(0.35) saturate(1.25) brightness(1.04) contrast(1.04)",
  faded: "contrast(0.86) brightness(1.06) saturate(0.78)",
  vivid: "saturate(1.3) contrast(1.08)",
  mono: "grayscale(1) contrast(1.12)",
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * A refine from an edit, within its limits, or null when it leaves the clip
 * as made. clipDur bounds the in and out points when it is known.
 */
export function normaliseRefine(input, clipDur) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const length = Number(clipDur) > 0 ? Number(clipDur) : MAX_CLIP_SEC;
  const inSec = round2(clamp(num(input.in, 0), 0, Math.max(0, length - MIN_PLAY_SEC)));
  let out = num(input.out, null);
  if (out !== null) {
    out = round2(clamp(out, inSec + MIN_PLAY_SEC, length));
    if (Number(clipDur) > 0 && out >= length - END_SNAP_SEC) out = null;
  }
  // Anything but a number is "fit the shot".
  const chosen = num(input.rate, null);
  const rate = chosen === null ? null : round2(clamp(chosen, RATE_MIN, RATE_MAX));
  const zoom = round2(clamp(num(input.zoom, 1), 1, ZOOM_MAX));
  // Framing moves the frame within the zoom's overflow, so at zoom 1 there is nothing to move.
  const framed = zoom > 1;
  const refine = {
    in: inSec,
    out,
    rate,
    flip: input.flip === true,
    zoom,
    x: framed ? round2(clamp(num(input.x, 0), -1, 1)) : 0,
    y: framed ? round2(clamp(num(input.y, 0), -1, 1)) : 0,
    grade: typeof input.grade === "string" && Object.hasOwn(GRADES, input.grade) ? input.grade : "none",
  };
  const unchanged = refine.in === 0 && refine.out === null && refine.rate === null && !refine.flip
    && refine.zoom === 1 && refine.x === 0 && refine.y === 0 && refine.grade === "none";
  return unchanged ? null : refine;
}

/**
 * How a shot's clip plays in a place len seconds long: the source span
 * (from, to), the speed, and how long the last frame is held when even half
 * speed runs out of clip. With no chosen speed the clip is slowed just enough
 * to fill its place, never sped up; a chosen speed is slowed only if it would
 * run out.
 */
export function shotPlayback({ refine, clipDur, len }) {
  const known = Number(clipDur) > 0;
  const from = known ? clamp(num(refine?.in, 0), 0, clipDur) : 0;
  const to = known ? clamp(num(refine?.out, clipDur), from, clipDur) : from + len + END_GUARD_SEC;
  const usable = Math.max(0, to - from - END_GUARD_SEC);
  const fit = usable / len;
  const wanted = refine?.rate ?? 1;
  const rate = Math.max(RATE_MIN, Math.min(wanted, fit));
  const hold = Math.max(0, len - usable / rate);
  return { rate, from, to, hold: hold > 1e-9 ? hold : 0 };
}

/** How the refined clip looks: mirror, zoom and framing, and the grade's CSS filter. */
export function refineLook(refine) {
  return {
    filter: GRADES[refine?.grade] || "",
    flip: refine?.flip === true,
    zoom: num(refine?.zoom, 1),
    x: num(refine?.x, 0),
    y: num(refine?.y, 0),
  };
}
