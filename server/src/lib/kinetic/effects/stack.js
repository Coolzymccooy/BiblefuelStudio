import { fitSize, widthAt } from "../text.js";
import { slotsFor, maxWidthFor, clampBlockY, isTall } from "../layout.js";
import { blockMargin, bodyScale, caseText, fitsAbove, fontsFor, holdEnd, inkAllowance, keyWordIndex, lineEvent } from "./common.js";

const MIN_FS = 24; // fitSize's own floor
const BORD = 5;
const POP = 135;
const SHAD = 3;
const MAX_WORDS_PER_LINE = 2;
const MAX_CHARS_PER_LINE = 12;

export function chunk(words) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    const text = [...cur, w].map((x) => x.text).join(" ");
    if (cur.length && (cur.length >= MAX_WORDS_PER_LINE || text.length > MAX_CHARS_PER_LINE)) {
      lines.push(cur);
      cur = [w];
    } else {
      cur.push(w);
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

/** The phrase as short stacked lines, tilted, at the planned slot. */
export function render({ planned, look, energy, w, h, aspect, nextStart }) {
  const { phrase, hook, rot } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")), { soft: phrase.soft === true });
  const slots = slotsFor(aspect);
  const slot = slots[planned.slot % slots.length];
  const key = keyWordIndex(phrase.words.map((x) => x.text));
  const words = phrase.words.map((x, i) => ({
    text: caseText(look, x.text),
    t: x.start,
    colour: hook || (energy !== "calm" && i === key) ? fonts.hit.colour : fonts.body.colour,
  }));
  const lines = chunk(words);
  const maxWidth = maxWidthFor(slot, w, aspect);
  const preferred = Math.round((isTall(aspect) ? w * 0.14 : h * 0.13) * bodyScale(fonts.body));
  const budget = maxWidth - inkAllowance(preferred, { bord: BORD, shad: SHAD, italic: fonts.body.italic, bold: fonts.body.bold });
  const { clearBelow } = phrase;
  const marginAt = (size) => blockMargin({
    aspect, lineGap: size * 1.05, clearBelow, fs: size, bord: BORD, shad: SHAD, rot, pop: POP,
    width: Math.max(...lines.map((ln) => widthAt(fonts.body.file, ln.map((x) => x.text).join(" "), size))),
  });
  let fs = fitSize(fonts.body.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, budget);
  // A call over its echo also shrinks until it fits above the echo, down to fitSize's floor.
  while (Number.isFinite(clearBelow) && fs > MIN_FS
    && !fitsAbove({ clearBelow, blockHeight: lines.length * fs * 1.05, margin: marginAt(fs), h, aspect })) {
    fs = Math.max(MIN_FS, Math.floor(fs * 0.92));
  }
  const lineGap = fs * 1.05;
  const blockHeight = lines.length * lineGap;
  const margin = marginAt(fs);
  const cy = clampBlockY(slot.y * h, blockHeight + 2 * margin, h, aspect, clearBelow);
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  const end = holdEnd(phrase, nextStart);
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: slot.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot, pop: POP, bord: BORD, shad: SHAD, outline: look.outline, words: ln,
    bold: fonts.body.bold, italic: fonts.body.italic,
  }));
}
