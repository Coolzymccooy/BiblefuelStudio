import { widthAt, covers, assEscape, assColour, assTime } from "../text.js";
import { FALLBACK_FONT } from "../looks.js";

export const MIN_HOLD = 0.25;
export const MAX_HOLD = 3; // a phrase never stays up more than this past its last word
const GAP = 0.05;
const TAIL = 1.2; // last phrase: hold this long after its last word

/**
 * When a phrase leaves: just before the next one, never sooner than 0.25 s
 * after it ends, and never more than MAX_HOLD after it ends (so an
 * instrumental break does not leave a stale lyric on screen).
 */
export function holdEnd(phrase, nextStart) {
  const floor = phrase.end + MIN_HOLD;
  const ceiling = Number.isFinite(nextStart)
    ? Math.min(nextStart - GAP, phrase.end + MAX_HOLD)
    : phrase.end + TAIL;
  return Number(Math.max(floor, ceiling).toFixed(2));
}

export function caseText(look, s) {
  return look.uppercase ? String(s).toLocaleUpperCase() : String(s);
}

/** A body font's size multiplier (1 unless the look sets `scale`). */
export function bodyScale(font) {
  const s = Number(font?.scale);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

export function fontsFor(look, text) {
  if (covers(look.body.file, text) && covers(look.hit.file, text)) return { body: look.body, hit: look.hit };
  return {
    body: { ...FALLBACK_FONT, colour: look.body.colour },
    hit: { ...FALLBACK_FONT, colour: look.hit.colour },
  };
}

/**
 * Width to hold back when fitting text, so what libass actually paints (outline,
 * shadow, faux italic slant, brush overhang) stays inside the measured box.
 */
export function inkAllowance(fs, { bord = 0, shad = 0, italic = false, bold = false } = {}) {
  return 2 * bord + shad + fs * (0.06 + (italic ? 0.22 : 0) + (bold ? 0.03 : 0));
}

/** Greedy wrap: words onto lines no wider than maxWidth. */
export function wrapWords(words, file, fs, maxWidth) {
  const lines = [];
  let current = [];
  for (const w of words) {
    const next = [...current, w];
    if (current.length && widthAt(file, next.map((x) => x.text).join(" "), fs) > maxWidth) {
      lines.push(current);
      current = [w];
    } else {
      current = next;
    }
  }
  if (current.length) lines.push(current);
  return lines;
}

/**
 * One line of text as one event. The line pops when it appears, and each
 * later word fades in on its own beat. Words never scale on their own,
 * because that would reflow the line mid-phrase.
 */
export function lineEvent({ start, end, x, y, fs, family, rot = 0, pop = 135, bord = 5, shad = 3, outline = "#000000", words, layer = 0, bold = false, italic = false }) {
  const settle = pop >= 150 ? 160 : 130;
  const style = `${bold ? "\\b1" : ""}${italic ? "\\i1" : ""}`;
  const head = `{\\an5\\move(${Math.round(x)},${Math.round(y + 8)},${Math.round(x)},${Math.round(y)},0,180)`
    + `\\fn${family}\\fs${Math.round(fs)}${style}\\frz${rot}\\bord${bord}\\shad${shad}\\3c${assColour(outline)}\\fad(50,160)`
    + `\\fscx${pop}\\fscy${pop}\\t(0,${settle},\\fscx100\\fscy100)}`;
  const body = words.map((w, i) => {
    const dt = Math.max(0, Math.round((w.t - start) * 1000));
    const reveal = i === 0 ? "" : `\\alpha&HFF&\\t(${dt},${dt + 70},\\alpha&H00&)`;
    return `{\\c${assColour(w.colour)}${reveal}}${assEscape(w.text)}`;
  }).join(" ");
  return `Dialogue: ${layer},${assTime(start)},${assTime(end)},Kinetic,,0,0,0,,${head}${body}`;
}

/** A burst of short strokes fanning upwards from (x, y) as a word lands. */
export function sparksEvent({ x, y, at, r, colour }) {
  const strokes = [];
  for (let i = 0; i < 7; i += 1) {
    const a = ((-150 + i * 22) * Math.PI) / 180;
    const p = (d, side) => [Math.round(Math.cos(a) * d - Math.sin(a) * side), Math.round(Math.sin(a) * d + Math.cos(a) * side)];
    const pts = [p(r, -3), p(r, 3), p(r * 1.4, 2), p(r * 1.4, -2)];
    strokes.push(`m ${pts[0].join(" ")} l ${pts[1].join(" ")} ${pts[2].join(" ")} ${pts[3].join(" ")}`);
  }
  return `Dialogue: 1,${assTime(at)},${assTime(at + 0.45)},Kinetic,,0,0,0,,`
    + `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\bord0\\shad0\\1c${assColour(colour)}\\fscx60\\fscy60`
    + `\\t(0,160,\\fscx115\\fscy115)\\fad(0,220)\\p1}${strokes.join(" ")}{\\p0}`;
}

/**
 * Index of a phrase's most important word: the one with the most letters
 * (punctuation does not count). On a tie the later word wins.
 */
export function keyWordIndex(words) {
  let best = 0;
  let bestLetters = -1;
  words.forEach((w, i) => {
    const letters = (String(w).match(/\p{L}/gu) || []).length;
    if (letters >= bestLetters) { best = i; bestLetters = letters; }
  });
  return best;
}
