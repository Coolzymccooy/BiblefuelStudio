import { fitSize } from "../text.js";
import { LOWER, maxWidthFor } from "../layout.js";
import { caseText, fontsFor, holdEnd, lineEvent, wrapWords } from "./common.js";

/** Words pop in on one or two lines in the lower safe band. Calm and readable. */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.text));
  const anchor = LOWER[aspect];
  const maxWidth = maxWidthFor({ side: false }, w, aspect);
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.body.colour }));
  let fs = aspect === "tall" ? Math.round(w * 0.085) : Math.round(h * 0.075);
  let lines = wrapWords(words, fonts.body.file, fs, maxWidth);
  if (lines.length > 2) {
    fs = fitSize(fonts.body.file, [words.map((x) => x.text).join(" ")], fs, maxWidth * 2);
    lines = wrapWords(words, fonts.body.file, fs, maxWidth).slice(0, 2);
  }
  const end = holdEnd(phrase, nextStart);
  const lineGap = fs * 1.05;
  const y0 = anchor.y * h - ((lines.length - 1) * lineGap) / 2;
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot: 0, pop: 120, bord: 4, shad: 2, outline: look.outline, words: ln,
  }));
}
