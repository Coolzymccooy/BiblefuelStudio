import { LOWER, maxWidthFor, isTall } from "../layout.js";
import { widthAt } from "../text.js";
import { blockMargin, bodyScale, caseText, fitsAbove, fontsFor, holdEnd, inkAllowance, lineEvent, shortsCentre, wrapWords } from "./common.js";

const MIN_FS = 24;
const BORD = 4;
const SHAD = 2;
const POP = 120;

/**
 * Words pop in on one or two lines in the lower safe band. A long phrase
 * shrinks until it wraps to two lines; if it still needs more at the minimum
 * size, every line is kept, because showing every word beats the 2-line ideal.
 */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")), { soft: phrase.soft === true });
  const anchor = LOWER[aspect];
  const maxWidth = maxWidthFor({ side: false }, w, aspect);
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.body.colour }));
  let fs = Math.round((isTall(aspect) ? w * 0.12 : h * 0.11) * bodyScale(fonts.body));
  // Held back at the starting size, which bounds the ink at every smaller size too.
  const budget = maxWidth - inkAllowance(fs, { bord: BORD, shad: SHAD, italic: fonts.body.italic, bold: fonts.body.bold });
  const { clearBelow } = phrase;
  const widestAt = (size, lns) => Math.max(...lns.map((ln) => widthAt(fonts.body.file, ln.map((x) => x.text).join(" "), size)));
  const marginAt = (size, lns) => blockMargin({ aspect, lineGap: size * 1.05, clearBelow, fs: size, bord: BORD, shad: SHAD, width: widestAt(size, lns), pop: POP });
  // A call over its echo also shrinks until it fits above the echo.
  const fits = (size, lns) => !Number.isFinite(clearBelow)
    || fitsAbove({ clearBelow, blockHeight: lns.length * size * 1.05, margin: marginAt(size, lns), h, aspect });
  let lines = wrapWords(words, fonts.body.file, fs, budget);
  while ((lines.length > 2 || !fits(fs, lines)) && fs > MIN_FS) {
    fs = Math.max(MIN_FS, Math.floor(fs * 0.92));
    lines = wrapWords(words, fonts.body.file, fs, budget);
  }
  const end = holdEnd(phrase, nextStart);
  const lineGap = fs * 1.05;
  const margin = marginAt(fs, lines);
  const cy = shortsCentre({ aspect, cy: anchor.y * h, blockHeight: lines.length * lineGap, margin, h, clearBelow });
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot: 0, pop: POP, bord: BORD, shad: SHAD, outline: look.outline, words: ln,
    bold: fonts.body.bold, italic: fonts.body.italic,
  }));
}
