// Ink-box estimates for ASS events, shared by the caption tests. Not a test file itself.
import { FALLBACK_FONT, SOFT_FONT } from "./looks.js";
import { widthAt } from "./text.js";

/** The font file behind a family name, for the look that drew the line. */
export function fileFor(look, family) {
  for (const f of [look.body, look.hit, SOFT_FONT, FALLBACK_FONT]) if (f.family === family) return f.file;
  throw new Error(`unknown family ${family}`);
}

const num = (re, s, fallback) => (re.exec(s) ? Number(re.exec(s)[1]) : fallback);

/**
 * A pessimistic ink box for one text event: the text rectangle (width from the
 * engine's own helper, half-height 0.525 fs + outline), turned by its \frz,
 * at the pop-in's peak scale, with the 8 px the entry move starts lower.
 * Returns the highest and lowest pixel it can reach, and the right edge.
 * `shadowBottom` is `bottom` plus the drop shadow at peak scale.
 */
export function inkBox(line, look) {
  const head = line.match(/\{[^}]*\}/)[0];
  const text = line.slice(line.indexOf("{")).replace(/\{[^}]*\}/g, "").replace(/\\N/g, " ");
  const family = /\\fn([^\\}]+)/.exec(head)[1];
  const fs = num(/\\fs(\d+)/, head);
  const bord = num(/\\bord(\d+(?:\.\d+)?)/, head, 0);
  const shad = num(/\\shad(\d+(?:\.\d+)?)/, head, 0);
  const rot = (num(/\\frz(-?\d+(?:\.\d+)?)/, head, 0) * Math.PI) / 180;
  const peak = num(/\\fscy(\d+)/, head, 100) / 100;
  const move = /\\move\((-?\d+),(-?\d+),(-?\d+),(-?\d+)/.exec(head);
  const pos = /\\pos\((-?\d+),(-?\d+)\)/.exec(head);
  const [x, y0, y1] = move ? [Number(move[3]), Number(move[2]), Number(move[4])] : [Number(pos[1]), Number(pos[2]), Number(pos[2])];
  const width = widthAt(fileFor(look, family), text.trim(), fs);
  const halfH = 0.525 * fs + bord;
  const vert = (width / 2) * Math.abs(Math.sin(rot)) + halfH * Math.abs(Math.cos(rot));
  const horiz = (width / 2) * Math.abs(Math.cos(rot)) + halfH * Math.abs(Math.sin(rot));
  const bottom = Math.max(y0, y1) + peak * vert;
  return {
    top: Math.min(y0, y1) - peak * vert,
    bottom,
    shadowBottom: bottom + peak * shad,
    right: x + peak * horiz,
    settledRight: x + horiz,
    text: text.trim(),
  };
}

/** A spark burst fans upwards from its origin by up to 1.4 r (r = 5% of the short side), drawn at 115%. */
export function sparkTop(line, w, h) {
  const pos = /\\pos\((-?\d+),(-?\d+)\)/.exec(line);
  return Number(pos[2]) - 1.4 * Math.round(Math.min(w, h) * 0.05) * 1.15 - 4;
}

/**
 * The vertical reach of any Dialogue event, shadow included: a clipped event
 * (frame band, quote underline) is bounded by its clip; a drawing with no clip
 * is a spark burst, which fans upwards from its origin; anything else is text.
 */
export function eventInk(line, look, { w, h }) {
  const clip = /\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/.exec(line);
  if (clip) return { top: Number(clip[2]), bottom: Number(clip[4]) };
  if (/\\p1/.test(line)) {
    const pos = /\\pos\((-?\d+),(-?\d+)\)/.exec(line);
    return { top: sparkTop(line, w, h), bottom: Number(pos[2]) + 4 };
  }
  const box = inkBox(line, look);
  return { top: box.top, bottom: box.shadowBottom };
}

/** Start time of a Dialogue line, in seconds. */
export function startOf(line) {
  const [hh, mm, ss] = line.split(",")[1].split(":");
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}
