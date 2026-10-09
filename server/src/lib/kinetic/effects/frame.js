import { covers, fitSize, widthAt, assEscape, assColour, assTime } from "../text.js";
import { caseText, fontsFor, holdEnd, inkAllowance, lineEvent } from "./common.js";
import { chunk } from "./stack.js";

const BORD = 6; // the centre lines' outline and shadow
const SHAD = 4;
const SPEED = 0.06; // bands scroll this share of the frame's long side per second
const MAX_REPEATS = 40;

/** The rectangle the bands run round. Tall frames keep clear of the TikTok/Reels controls. */
export function frameBox(w, h, aspect) {
  return aspect === "tall"
    ? { left: 0.06 * w, top: 0.05 * h, right: 0.88 * w, bottom: 0.82 * h }
    : { left: 0.04 * w, top: 0.05 * h, right: 0.96 * w, bottom: 0.95 * h };
}

function bandEvent({ start, end, from, to, rot, clip, family, fs, colour, outline, text }) {
  const r = (v) => Math.round(v);
  return `Dialogue: 0,${assTime(start)},${assTime(end)},Kinetic,,0,0,0,,`
    + `{\\an5\\move(${r(from[0])},${r(from[1])},${r(to[0])},${r(to[1])})`
    + `\\clip(${clip.map(r).join(",")})\\fn${family}\\fs${fs}\\frz${rot}`
    + `\\bord2\\shad0\\3c${assColour(outline)}\\1c${assColour(colour)}\\alpha&H20&\\fad(200,200)}${assEscape(text)}`;
}

/**
 * The phrase repeated round all four edges as scrolling bands (top and
 * bottom run opposite ways, the sides run up and down), with the phrase
 * stacked big in the centre. Made for a song's hook.
 */
export function render({ planned, look, w, h, aspect, nextStart }) {
  const { phrase } = planned;
  const shown = caseText(look, phrase.words.map((x) => x.text).join(" "));
  const fonts = fontsFor(look, shown);
  const band = fonts.body;
  const box = frameBox(w, h, aspect);
  const bandFs = Math.round(Math.min(w, h) * (aspect === "tall" ? 0.06 : 0.055));
  const sep = covers(band.file, "•") ? " • " : " / ";
  const unit = `${shown}${sep}`;
  const unitWidth = Math.max(1, widthAt(band.file, unit, bandFs));
  const start = phrase.start;
  const end = holdEnd(phrase, nextStart);
  const shift = SPEED * Math.max(w, h) * (end - start);
  const inset = bandFs * 0.6;
  const bandText = (edge) => unit.repeat(Math.min(MAX_REPEATS, Math.ceil((edge + shift) / unitWidth) + 1)).trimEnd();
  const across = bandText(box.right - box.left);
  const down = bandText(box.bottom - box.top);
  const acrossLen = widthAt(band.file, across, bandFs);
  const downLen = widthAt(band.file, down, bandFs);
  const common = {
    start, end, clip: [box.left, box.top, box.right, box.bottom],
    family: band.family, fs: bandFs, colour: band.colour, outline: look.outline,
  };
  const topY = box.top + inset;
  const bottomY = box.bottom - inset;
  const leftX = box.left + inset;
  const rightX = box.right - inset;
  const events = [
    // Top scrolls left and bottom scrolls right; each starts flush with one end of its edge.
    bandEvent({ ...common, text: across, rot: 0, from: [box.left + acrossLen / 2, topY], to: [box.left + acrossLen / 2 - shift, topY] }),
    bandEvent({ ...common, text: across, rot: 0, from: [box.right - acrossLen / 2, bottomY], to: [box.right - acrossLen / 2 + shift, bottomY] }),
    // Left reads bottom to top and scrolls up; right reads top to bottom and scrolls down.
    bandEvent({ ...common, text: down, rot: 90, from: [leftX, box.top + downLen / 2], to: [leftX, box.top + downLen / 2 - shift] }),
    bandEvent({ ...common, text: down, rot: -90, from: [rightX, box.bottom - downLen / 2], to: [rightX, box.bottom - downLen / 2 + shift] }),
  ];
  const words = phrase.words.map((x) => ({ text: caseText(look, x.text), t: x.start, colour: fonts.hit.colour }));
  const lines = chunk(words);
  const room = (box.right - box.left) - 2 * (inset + bandFs);
  const preferred = aspect === "tall" ? Math.round(w * 0.16) : Math.round(h * 0.15);
  const budget = room * 0.9 - inkAllowance(preferred, { bord: BORD, shad: SHAD, italic: fonts.hit.italic, bold: fonts.hit.bold });
  const fs = fitSize(fonts.hit.file, lines.map((ln) => ln.map((x) => x.text).join(" ")), preferred, budget, 32);
  const lineGap = fs * 1.0;
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const y0 = cy - ((lines.length - 1) * lineGap) / 2;
  lines.forEach((ln, i) => events.push(lineEvent({
    start: ln[0].t, end, x: cx, y: y0 + i * lineGap, fs, family: fonts.hit.family,
    rot: 0, pop: 140, bord: BORD, shad: SHAD, outline: look.outline, words: ln, layer: 2,
  })));
  return events;
}
