import { widthAt, assEscape, assColour, assTime } from "../text.js";
import { ARC } from "../layout.js";
import { bodyScale, caseText, fontsFor, holdEnd, keyWordIndex } from "./common.js";
import { render as stack } from "./stack.js";

const MIN_SHARE = 0.6; // shrunk below 60% of its preferred size a curve reads badly: stack it instead
// Letters are grapheme clusters, so a Yoruba tone mark stays on its letter instead of floating alone.
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Letters of the phrase in order, each tagged with its word, with a space between words. */
function lettersOf(words) {
  const out = [];
  words.forEach((w, wi) => {
    if (wi > 0) out.push({ ch: " ", word: wi, space: true });
    for (const { segment } of GRAPHEMES.segment(w.text)) out.push({ ch: segment, word: wi, space: false });
  });
  return out;
}

function advance(file, letter, fs) {
  if (letter.space) return Math.max(widthAt(file, " ", fs), fs * 0.25);
  return widthAt(file, letter.ch, fs);
}

/**
 * The phrase set letter by letter along an arc in the upper part of the
 * frame, each letter turned to the curve. Letters of a word land together on
 * that word's beat. A phrase too long for the arc at a readable size is
 * stacked instead.
 */
export function render(ctx) {
  const { planned, look, energy, w, h, aspect, nextStart } = ctx;
  const { phrase, hook } = planned;
  const fonts = fontsFor(look, caseText(look, phrase.words.map((x) => x.text).join(" ")));
  const font = fonts.body;
  const key = keyWordIndex(phrase.words.map((x) => x.text));
  const words = phrase.words.map((x, i) => ({
    text: caseText(look, x.text),
    t: x.start,
    colour: hook || (energy !== "calm" && i === key) ? fonts.hit.colour : font.colour,
  }));
  const arc = ARC[aspect] || ARC.wide;
  const R = arc.r * w;
  const maxArc = 2 * R * Math.asin(Math.min(1, (arc.half * w) / R));
  const preferred = Math.round((aspect === "tall" ? w * 0.11 : h * 0.12) * bodyScale(font));
  const letters = lettersOf(words);
  const lengthAt = (size) => letters.reduce((sum, l) => sum + advance(font.file, l, size), 0);
  let fs = preferred;
  const natural = lengthAt(fs);
  if (natural > maxArc) fs = Math.floor((fs * maxArc) / natural);
  if (fs < preferred * MIN_SHARE) return stack(ctx);
  const end = holdEnd(phrase, nextStart);
  const length = lengthAt(fs);
  const ax = arc.x * w;
  const ay = arc.y * h;
  const style = `${font.bold ? "\\b1" : ""}${font.italic ? "\\i1" : ""}`;
  const events = [];
  let s = -length / 2;
  for (const l of letters) {
    const adv = advance(font.file, l, fs);
    const mid = s + adv / 2;
    s += adv;
    const text = assEscape(l.ch);
    if (l.space || !text.trim()) continue;
    const theta = mid / R;
    const x = ax + R * Math.sin(theta);
    const y = ay + R * (1 - Math.cos(theta));
    const deg = Math.round(((-theta * 180) / Math.PI) * 10) / 10;
    const word = words[l.word];
    events.push(`Dialogue: 0,${assTime(word.t)},${assTime(end)},Kinetic,,0,0,0,,`
      + `{\\an5\\pos(${Math.round(x)},${Math.round(y)})\\fn${font.family}\\fs${fs}${style}`
      + `\\frz${deg}\\bord4\\shad2\\3c${assColour(look.outline)}\\1c${assColour(word.colour)}`
      + `\\fad(60,160)\\fscx130\\fscy130\\t(0,140,\\fscx100\\fscy100)}${text}`);
  }
  return events;
}
