import { LOWER, maxWidthFor } from "../layout.js";
import { bodyScale, caseText, fontsFor, holdEnd, inkAllowance, lineEvent, wrapWords } from "./common.js";

const MIN_FS = 24;
const BORD = 4;
const SHAD = 2;

/**
 * Words pop in on one or two lines in the lower safe band. A long phrase
 * shrinks until it wraps to two lines; if it still needs more at the minimum
 * size, every line is kept, because showing every word beats the 2-line ideal.
 */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")));
  const anchor = LOWER[aspect];
  const maxWidth = maxWidthFor({ side: false }, w, aspect);
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.body.colour }));
  let fs = Math.round((aspect === "tall" ? w * 0.12 : h * 0.11) * bodyScale(fonts.body));
  // Held back at the starting size, which bounds the ink at every smaller size too.
  const budget = maxWidth - inkAllowance(fs, { bord: BORD, shad: SHAD, italic: fonts.body.italic, bold: fonts.body.bold });
  let lines = wrapWords(words, fonts.body.file, fs, budget);
  while (lines.length > 2 && fs > MIN_FS) {
    fs = Math.max(MIN_FS, Math.floor(fs * 0.92));
    lines = wrapWords(words, fonts.body.file, fs, budget);
  }
  const end = holdEnd(phrase, nextStart);
  const lineGap = fs * 1.05;
  const y0 = anchor.y * h - ((lines.length - 1) * lineGap) / 2;
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot: 0, pop: 120, bord: BORD, shad: SHAD, outline: look.outline, words: ln,
    bold: fonts.body.bold, italic: fonts.body.italic,
  }));
}
