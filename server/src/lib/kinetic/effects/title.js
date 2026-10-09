import { fitSize } from "../text.js";
import { CENTRE, maxWidthFor } from "../layout.js";
import { caseText, fontsFor, holdEnd, inkAllowance, lineEvent } from "./common.js";

const BORD = 6;
const SHAD = 4;
const INTRO_MIN = 1.5;
const INTRO_MAX = 3;
const SECOND_LINE_DELAY = 0.25;

/** Split words into two lines as even in length as possible (one line for a single word). */
export function splitTitle(words) {
  if (words.length < 2) return [words];
  let best = 1;
  let bestDiff = Infinity;
  for (let k = 1; k < words.length; k += 1) {
    const a = words.slice(0, k).map((x) => x.text).join(" ").length;
    const b = words.slice(k).map((x) => x.text).join(" ").length;
    if (Math.abs(a - b) < bestDiff) { best = k; bestDiff = Math.abs(a - b); }
  }
  return [words.slice(0, best), words.slice(best)];
}

/** Two big centred lines in the hit font: the first in the body colour, the last in the hit colour. */
function titleEvents({ words, look, w, h, aspect, end, rot }) {
  const fonts = fontsFor(look, words.map((x) => x.text).join(" "));
  const split = splitTitle(words);
  const lines = split.map((ln, li) => ln.map((x) => ({
    ...x, colour: li === split.length - 1 ? fonts.hit.colour : fonts.body.colour,
  })));
  const maxWidth = maxWidthFor({ side: false }, w, aspect) * 0.92;
  const preferred = aspect === "tall" ? Math.round(w * 0.22) : Math.round(h * 0.26);
  const budget = maxWidth - inkAllowance(preferred, { bord: BORD, shad: SHAD, italic: fonts.hit.italic, bold: fonts.hit.bold });
  const fs = fitSize(fonts.hit.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, budget, 40);
  const anchor = CENTRE[aspect] || CENTRE.wide;
  const lineGap = fs * 1.0;
  const y0 = anchor.y * h - ((lines.length - 1) * lineGap) / 2;
  return lines.map((ln, i) => lineEvent({
    start: ln[0].t, end, x: anchor.x * w, y: y0 + i * lineGap, fs, family: fonts.hit.family,
    rot, pop: 150, bord: BORD, shad: SHAD, outline: look.outline, words: ln, layer: 2,
  }));
}

/** The first phrase as a full-screen two-line title, revealed on its own beat. */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase, rot } = planned;
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start }));
  return titleEvents({ words, look, w, h, aspect, end: holdEnd(phrase, nextStart), rot: Math.sign(rot) || -1 });
}

/**
 * An opt-in title card before the first lyric: up from 0 s, the second line
 * a beat later, gone just before the first phrase (on screen 1.5–3 s).
 */
export function titleCard({ text, look, w, h, aspect, firstStart }) {
  const parts = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  // A missing first-lyric time would make the end NaN: show the card for the full 3 s instead.
  const first = Number.isFinite(Number(firstStart)) ? Number(firstStart) : INTRO_MAX + 0.05;
  const end = Number(Math.min(INTRO_MAX, Math.max(INTRO_MIN, first - 0.05)).toFixed(2));
  const lines = splitTitle(parts.map((p) => ({ text: caseText(look, p) })));
  const words = lines.flatMap((ln, li) => ln.map((x) => ({ text: x.text, t: li * SECOND_LINE_DELAY })));
  return titleEvents({ words, look, w, h, aspect, end, rot: -1 });
}
