/**
 * Gentle drift — the slow movement that keeps a long ambient video from
 * reading as a frozen frame.
 *
 * A picture breathes: it eases in to a slight zoom and back out, once a
 * minute, for as long as it is on screen. Not one push-in across the picture:
 * a picture stays up for ~15 minutes (one per verse drop), and 4% spread over
 * that is a pixel every few seconds, which no one sees as movement.
 *
 * Not zoompan, which Story uses. zoompan crops on whole pixels, so a zoom this
 * slow held still, then jumped, every second or two: measured on a real
 * picture, 467 of 479 frames didn't move at all. The perspective warp
 * resamples every frame at sub-pixel precision.
 *
 * Linear, not cubic, interpolation: at a 4% zoom the two are indistinguishable
 * even magnified, and on a real two-picture render cubic took 2.2x a still's
 * encode time against linear's 1.4x.
 *
 * Prod runs ffmpeg 5.1: perspective, its `eval=frame` and the `in` counter
 * date from years before it. Verified by real renders on ffmpeg 8 only.
 */

/** The deepest point of the breath: 4% in, the top of the usual 2-4%. */
export const DRIFT_ZOOM = 0.04;
/** One breath, in and back out. At 4% the frame edge peaks near 2 px/s at 1080p. */
export const DRIFT_PERIOD_SEC = 60;

/**
 * A perspective filter that breathes the picture in and out. Put it after
 * `fps=<fps>` so its frame counter runs at the video's own rate.
 *
 * Zoom at frame n is 1 + Z(1 - cos 2πn/P)/2: exactly 1 at the first frame (the
 * picture as the still shows it), Z at half a period, eased at both turns.
 *
 * @param {{ fps: number }} opts
 * @returns {string} ffmpeg filter substring, free of commas and colons inside
 *   its expressions
 */
export function driftFilter({ fps }) {
  const rate = Math.max(1, Math.round(Number(fps) || 0));
  const period = DRIFT_PERIOD_SEC * rate;
  const zoom = `(1+${DRIFT_ZOOM / 2}*(1-cos(2*PI*in/${period})))`;
  // Each edge moves in by this share of the frame: (1 - 1/zoom) / 2.
  const inset = `(1-1/${zoom})/2`;
  const x = `W*${inset}`;
  const y = `H*${inset}`;
  return (
    `perspective=` +
    `x0='${x}':y0='${y}':` +
    `x1='W-${x}':y1='${y}':` +
    `x2='${x}':y2='H-${y}':` +
    `x3='W-${x}':y3='H-${y}':` +
    `interpolation=linear:eval=frame`
  );
}
