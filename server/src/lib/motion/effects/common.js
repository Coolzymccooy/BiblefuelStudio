import path from "node:path";
import { FONT_DIR, escapeFontPath } from "../../videoFilters.js";

/** Anton, escaped for a drawtext fontfile inside a filtergraph. */
export const FONT_ANTON = escapeFontPath(path.join(FONT_DIR, "Anton.ttf"));

/** A number for a filter expression: fixed decimals, never exponent notation. */
export const num = (n, d = 3) => Number(n).toFixed(d);

/** a..b by t, with t clamped to 0..1. */
export const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, Number(t) || 0));

/** Frames a shot covers. Both ends are rounded to frames, so consecutive shots tile exactly. */
export function frameCount(shot, fps) {
  return Math.max(1, Math.round(shot.end * fps) - Math.round(shot.start * fps));
}

/** zoompan x/y that keep the anchor (0..1 of the picture) in place while zooming. */
export function anchoredXY(anchor) {
  return { x: `(iw-iw/zoom)*${num(anchor.x)}`, y: `(ih-ih/zoom)*${num(anchor.y)}` };
}

/** One zoompan over a still: ctx.frames frames at the output size. */
export function zoompan({ input, output, z, x, y, ctx }) {
  return `${input}zoompan=z='${z}':x='${x}':y='${y}':d=${ctx.frames}:s=${ctx.w}x${ctx.h}:fps=${ctx.fps}${output}`;
}
