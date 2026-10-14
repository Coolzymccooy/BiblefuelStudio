// A crowd reply under its call: the look's hit font filled with the body colour, outlined in the
// hit colour, tilted +6°, popping in at 175%, with sparks on the last word (spec §6.2).
import { ECHO, isTall, maxWidthFor } from "../layout.js";
import { widthAt } from "../text.js";
import { bodyScale, caseText, fontsFor, holdEnd, inkAllowance, lineEvent, shortsCentre, shortsMargin, shortsReach, sparksEvent, wrapWords } from "./common.js";

const BORD = 5;
const SHAD = 3;
const POP = 175;
const TILT = 6;
const MIN_FS = 24;

/** Where the echo's lines go: its fonts, words wrapped onto lines, size, line pitch and first line's y. */
function layout({ phrase, look, w, h, aspect }) {
  const text = caseText(look, phrase.words.map((x) => x.text).join(" "));
  const fonts = fontsFor(look, text, { soft: phrase.soft === true });
  const anchor = ECHO[aspect];
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.body.colour }));
  const maxWidth = maxWidthFor({ side: false }, w, aspect);
  let fs = Math.round((isTall(aspect) ? w : h) * 0.105 * bodyScale(fonts.hit));
  const budget = (size) => maxWidth - inkAllowance(size, { bord: BORD, shad: SHAD, italic: fonts.hit.italic, bold: fonts.hit.bold });
  let lines = wrapWords(words, fonts.hit.file, fs, budget(fs));
  while (lines.length > 2 && fs > MIN_FS) {
    fs = Math.max(MIN_FS, Math.floor(fs * 0.92));
    lines = wrapWords(words, fonts.hit.file, fs, budget(fs));
  }
  const lineGap = fs * 1.1;
  const widths = lines.map((ln) => widthAt(fonts.hit.file, ln.map((x) => x.text).join(" "), fs));
  const margin = shortsMargin({ aspect, lineGap, fs, bord: BORD, rot: TILT, width: Math.max(...widths), pop: POP });
  const cy = shortsCentre({ aspect, cy: anchor.y * h, blockHeight: lines.length * lineGap, margin, h });
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  const sparkR = Math.round(Math.min(w, h) * 0.05);
  const sparkY = y0 + (lines.length - 1) * lineGap - fs * 0.55;
  return { fonts, anchor, lines, fs, lineGap, widths, y0, sparkR, sparkY };
}

/**
 * The highest pixel the echo's ink can reach (a pixel y), from the same layout `render` draws:
 * each line tilted at the pop-in's peak scale with its outline, rounded to the whole pixel, and
 * the spark burst fanning up from its last word at 115%. A call over this echo keeps above it.
 */
export function echoInkTop({ phrase, look, w, h, aspect }) {
  const { lines, fs, lineGap, widths, y0, sparkR, sparkY } = layout({ phrase, look, w, h, aspect });
  // shortsReach counts the 8 px the entry move starts lower plus 1 px of rounding; the top is
  // reached at the settled position, so take the 8 px back off and keep the rounding pixel.
  const tops = lines.map((_, i) => y0 + i * lineGap - (shortsReach({ fs, bord: BORD, rot: TILT, width: widths[i], pop: POP }) - 8));
  return Math.min(...tops, sparkY - 1.4 * sparkR * 1.15 - 4.5);
}

export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
  const { fonts, anchor, lines, fs, lineGap, y0, sparkR, sparkY } = layout({ phrase, look, w, h, aspect });
  const end = holdEnd(phrase, nextStart);
  const events = lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.hit.family, rot: TILT, pop: POP,
    bord: BORD, shad: SHAD, outline: fonts.hit.colour, words: ln, bold: fonts.hit.bold, italic: fonts.hit.italic, layer: 1,
  }));
  const lastLine = lines[lines.length - 1];
  const lastWidth = widthAt(fonts.hit.file, lastLine.map((x) => x.text).join(" "), fs);
  const sparkMaxX = (isTall(aspect) ? 0.88 : 0.94) * w - 1.6 * sparkR;
  const sparks = sparksEvent({
    x: Math.min(anchor.x * w + lastWidth / 2 - w * 0.01, sparkMaxX),
    y: sparkY,
    at: lastLine[lastLine.length - 1].t, r: sparkR, colour: fonts.hit.colour,
    until: Number.isFinite(phrase.holdUntil) ? end : undefined,
  });
  if (sparks) events.push(sparks);
  return events;
}
