import { fitSize, widthAt } from "../text.js";
import { CENTRE, maxWidthFor, isTall } from "../layout.js";
import { blockMargin, bodyScale, caseText, fitsAbove, fontsFor, holdEnd, inkAllowance, lineEvent, shortsCentre, sparksEvent } from "./common.js";

const MIN_FS = 48;
const BORD = 6;
const SHAD = 4;
const POP = 150;

/** A short phrase slammed huge in the hit font, with sparks on its last word. */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase, rot } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")), { soft: phrase.soft === true });
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.hit.colour }));
  const lines = words.length <= 2 ? [words] : [words.slice(0, Math.ceil(words.length / 2)), words.slice(Math.ceil(words.length / 2))];
  const maxWidth = maxWidthFor({ side: false }, w, aspect) * 0.95;
  const preferred = Math.round((isTall(aspect) ? w * 0.26 : h * 0.30) * bodyScale(fonts.hit));
  const budget = maxWidth - inkAllowance(preferred, { bord: BORD, shad: SHAD, italic: fonts.hit.italic, bold: fonts.hit.bold });
  const anchor = CENTRE[aspect];
  const tilt = Math.sign(rot) * Math.min(2, Math.abs(rot));
  const { clearBelow } = phrase;
  const marginAt = (size) => blockMargin({
    aspect, lineGap: size * 1.0, clearBelow, fs: size, bord: BORD, shad: SHAD, rot: tilt, pop: POP,
    width: Math.max(...lines.map((ln) => widthAt(fonts.hit.file, ln.map((x) => x.text).join(" "), size))),
  });
  let fs = fitSize(fonts.hit.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, budget, MIN_FS);
  // A call over its echo also shrinks until it fits above the echo, down to the slam's floor.
  while (Number.isFinite(clearBelow) && fs > MIN_FS
    && !fitsAbove({ clearBelow, blockHeight: lines.length * fs * 1.0, margin: marginAt(fs), h, aspect })) {
    fs = Math.max(MIN_FS, Math.floor(fs * 0.92));
  }
  const lineGap = fs * 1.0;
  const margin = marginAt(fs);
  const cy = shortsCentre({ aspect, cy: anchor.y * h, blockHeight: lines.length * lineGap, margin, h, clearBelow });
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  const end = holdEnd(phrase, nextStart);
  const sparkR = Math.round(Math.min(w, h) * 0.05);
  const sparkMaxX = (isTall(aspect) ? 0.88 : 0.94) * w - 1.6 * sparkR;
  const events = lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.hit.family,
    rot: tilt, pop: POP, bord: BORD, shad: SHAD, outline: look.outline, words: ln,
  }));
  const lastLine = lines[lines.length - 1];
  const lastWidth = widthAt(fonts.hit.file, lastLine.map((x) => x.text).join(" "), fs);
  const sparks = sparksEvent({
    x: Math.min(anchor.x * w + lastWidth / 2 - w * 0.01, sparkMaxX),
    y: y0 + (lines.length - 1) * lineGap - fs * 0.55,
    at: lastLine[lastLine.length - 1].t,
    r: sparkR,
    colour: fonts.hit.colour,
    until: Number.isFinite(phrase.holdUntil) ? end : undefined,
  });
  if (sparks) events.push(sparks);
  return events;
}
