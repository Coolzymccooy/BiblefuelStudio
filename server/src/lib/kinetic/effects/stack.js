import { fitSize } from "../text.js";
import { slotsFor, maxWidthFor, clampBlockY } from "../layout.js";
import { bodyScale, caseText, fontsFor, holdEnd, keyWordIndex, lineEvent } from "./common.js";

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
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")));
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
  const preferred = Math.round((aspect === "tall" ? w * 0.14 : h * 0.13) * bodyScale(fonts.body));
  const fs = fitSize(fonts.body.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, maxWidth);
  const lineGap = fs * 1.05;
  const blockHeight = lines.length * lineGap;
  const cy = clampBlockY(slot.y * h, blockHeight, h, aspect);
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  const end = holdEnd(phrase, nextStart);
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: slot.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot, pop: 135, bord: 5, shad: 3, outline: look.outline, words: ln,
    bold: fonts.body.bold, italic: fonts.body.italic,
  }));
}
