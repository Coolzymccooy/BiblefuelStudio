import { covers, fitSize, widthAt, assColour, assTime } from "../text.js";
import { slotsFor, maxWidthFor, clampBlockY } from "../layout.js";
import { bodyScale, caseText, fontsFor, holdEnd, inkAllowance, keyWordIndex, lineEvent, wrapWords } from "./common.js";

const MIN_FS = 24;
const BORD = 4;
const SHAD = 2;
const DRAW_MS = 350;

/** Curly quotes where the font has them, straight ones where it doesn't. */
function marks(file) {
  return covers(file, "“”") ? ["“", "”"] : ['"', '"'];
}

/** A hand-drawn underline as an ASS drawing: a slightly wavy stroke `width` wide. */
export function underlineShape(width, thickness) {
  const W = Math.round(width);
  const t = Math.max(3, Math.round(thickness));
  const a = Math.round(W / 3);
  const b = Math.round((2 * W) / 3);
  return `m 0 ${t} b ${a} 0 ${b} ${2 * t} ${W} ${t} l ${W} ${2 * t} b ${b} ${3 * t} ${a} ${t} 0 ${2 * t}`;
}

/** The underline draws itself left to right: a clip that widens from nothing to the full stroke. */
export function underlineEvent({ x0, y, width, thickness, at, end, colour }) {
  const left = Math.round(x0);
  const top = Math.round(y);
  const right = left + Math.round(width);
  const bottom = top + Math.max(3, Math.round(thickness)) * 3 + 2;
  return `Dialogue: 1,${assTime(at)},${assTime(end)},Kinetic,,0,0,0,,`
    + `{\\an7\\pos(${left},${top})\\bord0\\shad0\\1c${assColour(colour)}\\fad(0,160)`
    + `\\clip(${left},${top - 2},${left},${bottom})\\t(0,${DRAW_MS},\\clip(${left},${top - 2},${right},${bottom}))\\p1}`
    + `${underlineShape(width, thickness)}{\\p0}`;
}

/**
 * The phrase in quotation marks at its slot, on one or two lines, with an
 * underline that draws itself under the last line as the last word lands.
 */
export function render({ planned, look, energy, w, h, aspect, nextStart }) {
  const { phrase, hook } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")));
  const [open, close] = marks(fonts.body.file);
  const slots = slotsFor(aspect);
  const slot = slots[planned.slot % slots.length];
  const key = keyWordIndex(phrase.words.map((x) => x.text));
  const last = phrase.words.length - 1;
  const words = phrase.words.map((x, i) => ({
    text: `${i === 0 ? open : ""}${caseText(look, x.text)}${i === last ? close : ""}`,
    t: x.start,
    colour: hook || (energy !== "calm" && i === key) ? fonts.hit.colour : fonts.body.colour,
  }));
  const maxWidth = maxWidthFor(slot, w, aspect);
  let fs = Math.round((aspect === "tall" ? w * 0.12 : h * 0.11) * bodyScale(fonts.body));
  // Held back at the starting size, which bounds the ink at every smaller size too.
  const budget = maxWidth - inkAllowance(fs, { bord: BORD, shad: SHAD, italic: fonts.body.italic, bold: fonts.body.bold });
  let lines = wrapWords(words, fonts.body.file, fs, budget);
  while (lines.length > 2 && fs > MIN_FS) {
    fs = Math.max(MIN_FS, Math.floor(fs * 0.92));
    lines = wrapWords(words, fonts.body.file, fs, budget);
  }
  const texts = lines.map((ln) => ln.map((x) => x.text).join(" "));
  fs = fitSize(fonts.body.file, texts, fs, budget, MIN_FS); // a single long word can still be too wide
  const lineGap = fs * 1.05;
  const thickness = Math.max(3, fs * 0.07);
  // The underline's rounded drawing can run ~4 px past 3 × thickness, so the block allows for it.
  const blockHeight = lines.length * lineGap + thickness * 3 + 4;
  const cy = clampBlockY(slot.y * h, blockHeight, h, aspect);
  const y0 = cy - blockHeight / 2 + lineGap / 2;
  const end = holdEnd(phrase, nextStart);
  const events = lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: slot.x * w, y: y0 + i * lineGap, fs, family: fonts.body.family,
    rot: 0, pop: 125, bord: BORD, shad: SHAD, outline: look.outline, words: ln,
    bold: fonts.body.bold, italic: fonts.body.italic,
  }));
  const width = Math.max(...texts.map((t) => widthAt(fonts.body.file, t, fs))) * 0.9;
  events.push(underlineEvent({
    x0: slot.x * w - width / 2,
    y: y0 + (lines.length - 1) * lineGap + fs * 0.5,
    width,
    thickness,
    at: phrase.words[last].start,
    end,
    colour: fonts.hit.colour,
  }));
  return events;
}
