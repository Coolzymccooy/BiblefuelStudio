// A crowd reply under its call: the look's hit font filled with the body colour, outlined in the
// hit colour, tilted +6°, popping in at 175%, with sparks on the last word (spec §6.2).
import { ECHO, isTall, maxWidthFor } from "../layout.js";
import { widthAt } from "../text.js";
import { bodyScale, caseText, fontsFor, holdEnd, inkAllowance, lineEvent, shortsCentre, shortsMargin, sparksEvent, wrapWords } from "./common.js";

const BORD = 5;
const SHAD = 3;
const POP = 175;
const TILT = 6;
const MIN_FS = 24;

export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
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
  const end = holdEnd(phrase, nextStart);
  const lineGap = fs * 1.1;
  const widest = Math.max(...lines.map((ln) => widthAt(fonts.hit.file, ln.map((x) => x.text).join(" "), fs)));
  const margin = shortsMargin({ aspect, lineGap, fs, bord: BORD, rot: TILT, width: widest, pop: POP });
  const cy = shortsCentre({ aspect, cy: anchor.y * h, blockHeight: lines.length * lineGap, margin, h });
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  const events = lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.hit.family, rot: TILT, pop: POP,
    bord: BORD, shad: SHAD, outline: fonts.hit.colour, words: ln, bold: fonts.hit.bold, italic: fonts.hit.italic, layer: 1,
  }));
  const lastLine = lines[lines.length - 1];
  const lastWidth = widthAt(fonts.hit.file, lastLine.map((x) => x.text).join(" "), fs);
  const sparkR = Math.round(Math.min(w, h) * 0.05);
  const sparkMaxX = (isTall(aspect) ? 0.88 : 0.94) * w - 1.6 * sparkR;
  const sparks = sparksEvent({
    x: Math.min(anchor.x * w + lastWidth / 2 - w * 0.01, sparkMaxX),
    y: y0 + (lines.length - 1) * lineGap - fs * 0.55,
    at: lastLine[lastLine.length - 1].t, r: sparkR, colour: fonts.hit.colour,
    until: Number.isFinite(phrase.holdUntil) ? end : undefined,
  });
  if (sparks) events.push(sparks);
  return events;
}
