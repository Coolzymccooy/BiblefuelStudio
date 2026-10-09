import { fitSize, widthAt } from "../text.js";
import { CENTRE, maxWidthFor } from "../layout.js";
import { caseText, fontsFor, holdEnd, lineEvent, sparksEvent } from "./common.js";

/** A short phrase slammed huge in the hit font, with sparks on its last word. */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase, rot } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.text));
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.hit.colour }));
  const lines = words.length <= 2 ? [words] : [words.slice(0, Math.ceil(words.length / 2)), words.slice(Math.ceil(words.length / 2))];
  const maxWidth = maxWidthFor({ side: false }, w, aspect) * 0.95;
  const preferred = aspect === "tall" ? Math.round(w * 0.2) : Math.round(h * 0.22);
  const fs = fitSize(fonts.hit.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, maxWidth, 48);
  const anchor = CENTRE[aspect];
  const lineGap = fs * 1.0;
  const y0 = anchor.y * h - ((lines.length - 1) * lineGap) / 2;
  const end = holdEnd(phrase, nextStart);
  const events = lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.hit.family,
    rot: Math.sign(rot) * Math.min(2, Math.abs(rot)), pop: 150, bord: 6, shad: 4, outline: look.outline, words: ln,
  }));
  const lastLine = lines[lines.length - 1];
  const lastWidth = widthAt(fonts.hit.file, lastLine.map((x) => x.text).join(" "), fs);
  events.push(sparksEvent({
    x: anchor.x * w + lastWidth / 2 - w * 0.01,
    y: y0 + (lines.length - 1) * lineGap - fs * 0.55,
    at: lastLine[lastLine.length - 1].t,
    r: Math.round(Math.min(w, h) * 0.05),
    colour: fonts.hit.colour,
  }));
  return events;
}
