import path from "node:path";
import { loadFont, measureText } from "../fontMetrics.js";
import { FONT_DIR } from "../videoFilters.js";

export const fontPath = (file) => path.join(FONT_DIR, file);

/**
 * Pixel width of `text` drawn at ASS size `fs`. libass makes the font's
 * cell (win ascent + descent) `fs` pixels tall, so the em is smaller than fs.
 */
export function widthAt(file, text, fs) {
  const f = loadFont(fontPath(file));
  return measureText(fontPath(file), String(text), fs * (f.unitsPerEm / f.cellUnits));
}

/** The largest size up to `preferred` at which every line fits `maxWidth`, but never below `min`. */
export function fitSize(file, lines, preferred, maxWidth, min = 24) {
  let fs = Math.round(preferred);
  for (const line of lines) {
    const w = widthAt(file, line, fs);
    if (w > maxWidth) fs = Math.floor((fs * maxWidth) / w);
  }
  return Math.max(min, fs);
}

/** Whether the font has a glyph for every non-space character of `text`. */
export function covers(file, text) {
  const f = loadFont(fontPath(file));
  for (const ch of String(text)) {
    if (/\s/u.test(ch)) continue;
    if (f.glyphOf(ch.codePointAt(0)) === 0) return false;
  }
  return true;
}

/** Plain text safe inside an ASS Dialogue: no override blocks, no breaks. */
export function assEscape(text) {
  return String(text).replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\r?\n/g, " ");
}

export function assColour(hex) {
  const h = String(hex).replace("#", "").toUpperCase();
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
}

export function assTime(sec) {
  const cs = Math.max(0, Math.round(Number(sec) * 100) || 0);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
